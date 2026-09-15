// assistant/context-slices.spec.ts
//
// In-memory Store stub — same fixture shape as llm-context.spec.ts's own
// (`writeLayerBytes` and `getLayerLocalBytes` backed by one map, `getPool`/
// `openPool` MemDir). Proves the contract context-slices.ts claims:
//   (a) same name + set => same sig, regardless of member order/case/dupes
//   (b) refusals: empty set, non-sig member, bad name
//   (c) the pool member exists under the slice sig and names the layer sig
//   (d) listSlices reads without create:true
//   (e) mintSlice enqueues on the drone when one is registered

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { canonicalLayerJson } from '../history/canonical-layer.js'
import {
  isSliceLayer, listSlices, mintSlice, SLICE_KIND, sliceLayer, SLICES_POOL_MEANING,
} from './context-slices.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

class MemFile {
  constructor(public data: string) {}
  async getFile(): Promise<{ text: () => Promise<string> }> {
    const held = this.data
    return { text: async () => held }
  }
  async createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> {
    return { write: async (text: string) => { this.data = text }, close: async () => {} }
  }
}

const createFlags: boolean[] = []

class MemDir {
  files = new Map<string, MemFile>()
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFile> {
    createFlags.push(opts?.create === true)
    const held = this.files.get(name)
    if (held) return held
    if (!opts?.create) throw new Error('NotFoundError')
    const made = new MemFile('')
    this.files.set(name, made)
    return made
  }
  async *entries(): AsyncGenerator<[string, { kind: 'file' } & MemFile]> {
    for (const [name, file] of this.files) yield [name, Object.assign(file, { kind: 'file' as const })]
  }
  async removeEntry(name: string): Promise<void> { this.files.delete(name) }
}

const pools = new Map<string, MemDir>()
const poolDoors: Array<{ meaning: string; door: 'open' | 'get' }> = []
const layers = new Map<string, Uint8Array>()

const store = {
  writeLayerBytes: async (signature: string, bytes: ArrayBuffer): Promise<void> => {
    layers.set(signature, new Uint8Array(bytes))
  },
  getLayerLocalBytes: async (s: string): Promise<Uint8Array | null> => layers.get(s) ?? null,
  openPool: async (meaning: string): Promise<MemDir | null> => {
    poolDoors.push({ meaning, door: 'open' })
    return pools.get(meaning) ?? null
  },
  getPool: async (meaning: string): Promise<MemDir> => {
    poolDoors.push({ meaning, door: 'get' })
    const held = pools.get(meaning)
    if (held) return held
    const made = new MemDir()
    pools.set(meaning, made)
    return made
  },
}

const iocValues = new Map<string, unknown>()
const installIoc = (): void => {
  (window as unknown as { ioc: unknown }).ioc = {
    get: <T>(key: string): T | undefined => iocValues.get(key) as T | undefined,
    register: (key: string, value: unknown): void => { iocValues.set(key, value) },
  }
}

const slicesPool = async (): Promise<MemDir> => await store.getPool(SLICES_POOL_MEANING)

beforeEach(() => {
  pools.clear()
  layers.clear()
  iocValues.clear()
  createFlags.length = 0
  poolDoors.length = 0
  installIoc()
  iocValues.set('@hypercomb.social/Store', store)
})

describe('(a) same name + set => same sig, regardless of order, case or duplicates', () => {
  it('mints one sig for the same choice however it is spelled', async () => {
    const A = sig(1)
    const B = sig(2)
    const first = await mintSlice('Travel Humidor', [A, B])
    const reordered = await mintSlice('Travel Humidor', [B, A])
    const upper = await mintSlice('Travel Humidor', [A.toUpperCase(), B])
    const duped = await mintSlice('Travel Humidor', [A, A, B, B])

    expect(first.ok).toBe(true)
    if (!first.ok || !reordered.ok || !upper.ok || !duped.ok) throw new Error('expected every mint to succeed')
    expect(reordered.sig).toBe(first.sig)
    expect(upper.sig).toBe(first.sig)
    expect(duped.sig).toBe(first.sig)
  })

  it('sliceLayer sorts and dedupes the children, lowercased', () => {
    const A = sig(3)
    const B = sig(4)
    const layer = sliceLayer('Two', [B.toUpperCase(), A, A])
    expect(layer).toEqual({ name: 'Two', kind: SLICE_KIND, children: [A, B].sort() })
  })
})

describe('(b) refusals', () => {
  it('refuses an empty set', async () => {
    expect(sliceLayer('Empty', [])).toBeNull()
    const result = await mintSlice('Empty', [])
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('at least one member') })
  })

  it('refuses a non-signature member', async () => {
    expect(sliceLayer('Bad', ['not-a-sig'])).toBeNull()
    const result = await mintSlice('Bad', ['not-a-sig'])
    expect(result.ok).toBe(false)
  })

  it.each([
    ['empty name', ''],
    ['a slash', 'roadmap/2026'],
    ['a backslash', String.raw`roadmap\2026`],
    ['a control character', 'roadmap\n2026'],
    ['over 128 characters', 'x'.repeat(129)],
  ])('refuses a name with %s', async (_label, name) => {
    const A = sig(5)
    expect(sliceLayer(name, [A])).toBeNull()
    const result = await mintSlice(name, [A])
    expect(result.ok).toBe(false)
  })

  it('a slice may reference another slice\'s sig — that is allowed, not a refusal', () => {
    const OTHER_SLICE = sig(6)
    expect(sliceLayer('Nested', [OTHER_SLICE])).not.toBeNull()
  })
})

describe('(c) the pool member names the slice\'s own layer sig', () => {
  it('writes a member under the slice sig holding { kind, name, layerSig }', async () => {
    const A = sig(7)
    const result = await mintSlice('Roadmap Bits', [A])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const bytes = layers.get(result.sig)
    expect(bytes).toBeDefined()
    expect(new TextDecoder().decode(bytes!)).toBe(canonicalLayerJson({ name: 'Roadmap Bits', kind: SLICE_KIND, children: [A] }))
    expect(await SignatureService.sign(bytes!.buffer as ArrayBuffer)).toBe(result.sig)

    const pool = await slicesPool()
    const member = pool.files.get(result.sig)
    expect(member).toBeDefined()
    expect(JSON.parse(member!.data)).toEqual({ kind: SLICE_KIND, name: 'Roadmap Bits', layerSig: result.sig })
  })
})

describe('(d) listSlices reads without create:true', () => {
  it('lists every minted slice and never opens the pool for writing', async () => {
    const A = sig(8)
    const B = sig(9)
    await mintSlice('First', [A])
    await mintSlice('Second', [B])

    createFlags.length = 0
    const listed = await listSlices()
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'First' }),
      expect.objectContaining({ name: 'Second' }),
    ]))
    expect(listed.length).toBe(2)
    expect(createFlags.some(Boolean)).toBe(false)
  })

  it('answers empty when the pool has never been created', async () => {
    expect(await listSlices()).toEqual([])
  })
})

describe('(e) mintSlice enqueues the new sig on the drone when one is registered', () => {
  it('calls enqueue with the minted sig', async () => {
    const enqueue = vi.fn()
    iocValues.set('@diamondcoreprocessor.com/LlmContextDrone', { enqueue })
    const A = sig(10)
    const result = await mintSlice('Enqueued', [A])
    expect(result.ok).toBe(true)
    if (result.ok) expect(enqueue).toHaveBeenCalledWith(result.sig)
  })

  it('does not throw when no drone is registered', async () => {
    const A = sig(11)
    await expect(mintSlice('No Drone', [A])).resolves.toMatchObject({ ok: true })
  })
})

describe('isSliceLayer', () => {
  it('recognises a slice layer and rejects anything else', () => {
    expect(isSliceLayer({ name: 'x', kind: SLICE_KIND, children: [sig(1)] })).toBe(true)
    expect(isSliceLayer({ name: 'x' })).toBe(false)
    expect(isSliceLayer({ name: 'x', kind: SLICE_KIND })).toBe(false)
    expect(isSliceLayer(null)).toBe(false)
  })
})
