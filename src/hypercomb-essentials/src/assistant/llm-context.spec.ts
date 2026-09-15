// assistant/llm-context.spec.ts
//
// Mirrors the fixture style of molecule/molecule-index.cold-path.spec.ts:
// in-memory pools, a stubbed Store, and no real OPFS. Proves the contract
// llm-context.ts claims:
//   (a) same input => byte-identical record after a wipe
//   (b) NEVER LOAD-BEARING — project() gives identical text warm or cold
//   (c) the reader never opens a pool or a file handle with create:true
//   (d) a v mismatch and every malformed file read as null; cold still answers
//   (e) no 64-hex run survives in a written record, even in note text
//   (f) complete-or-absent: an unresolvable resource, or over-cap, yields null
//   (g) the minting drone: skip-on-hit, batch on commit, enqueue validates

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import {
  LLM_CONTEXT_DERIVATION, LLM_CONTEXT_MEANING,
  LlmContextService, llmContextReader, MAX_PROJECTION_CHARS, projectLayer, readableRecord,
} from './llm-context.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

// ── an in-memory pool (molecule-index.cold-path.spec.ts's fixture) ────────

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

/** Every `create` flag any reader asked for, so "the reader cannot mint" is
 *  asserted rather than assumed. */
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
  async removeEntry(name: string): Promise<void> { this.files.delete(name) }
}

const pools = new Map<string, MemDir>()
/** Which Store door was used to reach a pool — the whole proof that
 *  `readRecord` never calls the CREATING door. */
const poolDoors: Array<{ meaning: string; door: 'open' | 'get' }> = []

const layers = new Map<string, Uint8Array>()
const resources = new Map<string, Uint8Array>()
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const setLayer = (s: string, value: unknown): void => { layers.set(s, encode(value)) }
const setResource = (s: string, value: unknown): void => { resources.set(s, encode(value)) }

const store = {
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
  // A minimal duck-typed stand-in for Blob, exposing only `.text()` — the
  // jsdom test environment's real `Blob` implements neither `.text()` nor
  // `.arrayBuffer()`, which a real browser Blob always does.
  getResourceLocal: async (s: string): Promise<Blob | null> => {
    const bytes = resources.get(s)
    if (!bytes) return null
    return { text: async () => new TextDecoder().decode(bytes) } as unknown as Blob
  },
  getLayerLocalBytes: async (s: string): Promise<Uint8Array | null> => layers.get(s) ?? null,
}

const iocValues = new Map<string, unknown>()
const installIoc = (): void => {
  (window as unknown as { ioc: unknown }).ioc = {
    get: <T>(key: string): T | undefined => iocValues.get(key) as T | undefined,
    register: (key: string, value: unknown): void => { iocValues.set(key, value) },
    list: (): unknown[] => [...iocValues.values()],
  }
}

const contextPool = async (): Promise<MemDir> => await store.getPool(LLM_CONTEXT_MEANING)

beforeEach(() => {
  pools.clear()
  layers.clear()
  resources.clear()
  iocValues.clear()
  createFlags.length = 0
  poolDoors.length = 0
  installIoc()
  iocValues.set('@hypercomb.social/Store', store)
  // EffectBus is a process-wide singleton with last-value replay: without
  // this, a drone constructed in a LATER test immediately replays an
  // earlier test's 'content:wrote' emit the moment it subscribes.
  EffectBus.clear()
})

// ── the fixture tile ───────────────────────────────────────────────────

const TILE = sig(1)
const NOTE_A = sig(2)
const NOTE_B = sig(3)
const NOTE_B_CHILD = sig(4)
const PROPS = sig(5)
const CHILD_1 = sig(6)
const CHILD_2 = sig(7)

const setupBasicTile = (): void => {
  setLayer(TILE, {
    name: 'Humidor',
    notes: [NOTE_A, NOTE_B],
    properties: [PROPS],
    decorations: [sig(20), sig(21)],
    children: [CHILD_1, CHILD_2],
  })
  setResource(NOTE_A, { note: 'Buy more cedar', children: [], tags: ['shopping'] })
  setResource(NOTE_B, { note: 'Rotate stock', shape: 'circle', mark: 'todo', children: [NOTE_B_CHILD] })
  setResource(NOTE_B_CHILD, { note: 'Check humidity first', children: [] })
  setResource(PROPS, {
    index: 3, imageSig: sig(50), link: 'https://example.com',
    tags: ['favorite'], hideText: true, substrate: true,
  })
}

const EXPECTED_TEXT = [
  'Humidor',
  'decorations: 2',
  'notes:',
  '  Buy more cedar #shopping',
  '  Rotate stock',
  '    Check humidity first',
  'properties:',
  '  hideText: true',
  '  link: https://example.com',
  '  tags: favorite',
].join('\n')

describe('projectLayer — the rule', () => {
  it('produces deterministic, slot-sorted, sig-free text (children never emitted)', async () => {
    setupBasicTile()
    const layer = JSON.parse(new TextDecoder().decode(layers.get(TILE)!))
    const readResource = async (s: string): Promise<Uint8Array | null> => resources.get(s) ?? null
    const text = await projectLayer(layer, readResource)
    expect(text).toBe(EXPECTED_TEXT)
    expect(text).not.toMatch(/[0-9a-f]{64}/i)
  })
})

describe('(a) same input => byte-identical record after a wipe', () => {
  it('re-derives to byte-identical bytes once the pool is emptied', async () => {
    setupBasicTile()
    const service = new LlmContextService()
    const first = await service.derive(TILE)
    expect(first?.text).toBe(EXPECTED_TEXT)
    await service.writeRecord(TILE, first!)
    const pool = await contextPool()
    const before = pool.files.get(TILE)!.data

    await pool.removeEntry(TILE)
    const fresh = new LlmContextService()
    const second = await fresh.derive(TILE)
    await fresh.writeRecord(TILE, second!)
    expect(pool.files.get(TILE)!.data).toBe(before)
  })
})

describe('(b) NEVER LOAD-BEARING — project() answers identically warm or cold', () => {
  it('gives the same text whether the pool holds a record or not, and flips `minted`', async () => {
    const service = new LlmContextService()
    setupBasicTile()

    const cold = await service.project(TILE)
    expect(cold?.minted).toBe(false)
    expect(cold?.text).toBe(EXPECTED_TEXT)

    await service.writeRecord(TILE, { v: LLM_CONTEXT_DERIVATION, text: cold!.text })
    const warmService = new LlmContextService()
    const warm = await warmService.project(TILE)
    expect(warm?.minted).toBe(true)
    expect(warm?.text).toBe(cold?.text)

    const pool = await contextPool()
    await pool.removeEntry(TILE)
    const coldAgain = await new LlmContextService().project(TILE)
    expect(coldAgain?.minted).toBe(false)
    expect(coldAgain?.text).toBe(cold?.text)
  })
})

describe('(c) the reader cannot mint', () => {
  it('never opens a pool or a file handle with create:true', async () => {
    setupBasicTile()
    const service = new LlmContextService()
    createFlags.length = 0
    poolDoors.length = 0

    expect(await service.readRecord(TILE)).toBeNull()

    expect(poolDoors.every(d => d.door === 'open')).toBe(true)
    expect(createFlags.length).toBe(0) // the pool did not exist yet — no handle was even attempted
  })

  it('still never opens with create:true once a record exists to read', async () => {
    setupBasicTile()
    const writer = new LlmContextService()
    const record = await writer.derive(TILE)
    await writer.writeRecord(TILE, record!)

    createFlags.length = 0
    poolDoors.length = 0
    const reader = new LlmContextService()
    const held = await reader.readRecord(TILE)
    expect(held?.text).toBe(EXPECTED_TEXT)

    expect(poolDoors.some(d => d.door === 'get')).toBe(false)
    expect(createFlags.some(Boolean), 'the reader opened a handle for creation').toBe(false)
  })
})

describe('(d) version mismatch and malformed files read as null; the cold path still answers', () => {
  it('rejects every malformed shape and still lets project() answer', async () => {
    setupBasicTile()
    const writer = new LlmContextService()
    await writer.writeRecord(TILE, (await writer.derive(TILE))!)
    const pool = await contextPool()

    for (const bad of ['{}', '[]', 'null', 'not json', JSON.stringify({ v: LLM_CONTEXT_DERIVATION + 1, text: 'x' })]) {
      pool.files.set(TILE, new MemFile(bad))
      const service = new LlmContextService()
      expect(await service.readRecord(TILE), bad).toBeNull()
      const projected = await service.project(TILE)
      expect(projected?.text, bad).toBe(EXPECTED_TEXT)
      expect(projected?.minted, bad).toBe(false)
    }
  })

  it('readableRecord rejects a text over the cap even if a file claims otherwise', () => {
    expect(readableRecord({ v: LLM_CONTEXT_DERIVATION, text: 'x'.repeat(MAX_PROJECTION_CHARS + 1) })).toBeNull()
    expect(readableRecord({ v: LLM_CONTEXT_DERIVATION, text: 'ok' })).toEqual({ v: LLM_CONTEXT_DERIVATION, text: 'ok' })
  })
})

describe('(e) no signature survives in the written text', () => {
  it('strips a 64-hex run quoted inside a note\'s own text', async () => {
    const NOTE = sig(30)
    setLayer(TILE, { name: 'Tagged', notes: [NOTE] })
    setResource(NOTE, { note: `see the old batch ${sig(99)} for context`, children: [] })
    const service = new LlmContextService()
    const record = await service.derive(TILE)
    expect(record).not.toBeNull()
    expect(record!.text).not.toMatch(/[0-9a-f]{64}/i)
    expect(record!.text).toContain('see the old batch')
    await service.writeRecord(TILE, record!)
    const pool = await contextPool()
    expect(pool.files.get(TILE)!.data).not.toMatch(/[0-9a-f]{64}/i)
  })
})

describe('(f) complete-or-absent', () => {
  it('yields null and writes nothing when a note resource is not local', async () => {
    const MISSING_NOTE = sig(40)
    setLayer(TILE, { name: 'Half here', notes: [MISSING_NOTE] })
    // Deliberately never call setResource(MISSING_NOTE, ...).
    const service = new LlmContextService()
    expect(await service.derive(TILE)).toBeNull()
    expect(await service.project(TILE)).toBeNull()
    const pool = await contextPool()
    expect(pool.files.has(TILE)).toBe(false)
  })

  it('yields null and writes nothing when the properties resource is not local', async () => {
    const MISSING_PROPS = sig(41)
    setLayer(TILE, { name: 'Half here too', properties: [MISSING_PROPS] })
    const service = new LlmContextService()
    expect(await service.derive(TILE)).toBeNull()
    const pool = await contextPool()
    expect(pool.files.has(TILE)).toBe(false)
  })

  it('yields null when the assembled text would exceed the cap', async () => {
    const HUGE_NOTE = sig(42)
    setLayer(TILE, { name: 'Overflowing', notes: [HUGE_NOTE] })
    setResource(HUGE_NOTE, { note: 'x'.repeat(MAX_PROJECTION_CHARS + 500), children: [] })
    const service = new LlmContextService()
    expect(await service.derive(TILE)).toBeNull()
    expect(await service.project(TILE)).toBeNull()
  })
})

describe('the registered read surface', () => {
  it('exposes only readRecord and project — derive and writeRecord never reach ioc.get', async () => {
    setupBasicTile()
    const surface = llmContextReader(new LlmContextService())
    expect(typeof surface.readRecord).toBe('function')
    expect(typeof surface.project).toBe('function')
    expect((surface as unknown as { derive?: unknown }).derive).toBeUndefined()
    expect((surface as unknown as { writeRecord?: unknown }).writeRecord).toBeUndefined()
    // and the surface behaves exactly like the underlying service, for the read half
    const projected = await surface.project(TILE)
    expect(projected?.text).toBe(EXPECTED_TEXT)
  })
})

describe('(g) the minting drone', () => {
  it('a pass with nothing pending writes nothing; a commit funds one; a second pass is a no-op; enqueue validates', async () => {
    setupBasicTile()
    const { LlmContextDrone } = await import('./llm-context.drone.js')
    const drone = new LlmContextDrone()

    await drone.optimize()
    expect((await contextPool()).files.size, 'an idle pass with nothing pending minted something').toBe(0)

    EffectBus.emit('content:wrote', { sig: TILE, kind: 'layer' })
    await drone.optimize()
    const pool = await contextPool()
    expect(pool.files.has(TILE)).toBe(true)
    expect(JSON.parse(pool.files.get(TILE)!.data).text).toBe(EXPECTED_TEXT)

    const before = pool.files.get(TILE)!.data
    await drone.optimize()
    expect(pool.files.get(TILE)!.data).toBe(before)

    drone.enqueue('not-a-signature')
    expect(drone.pendingCount).toBe(0)
    drone.enqueue(TILE)
    expect(drone.pendingCount).toBe(1)
  })

  it('ignores a non-layer commit and an empty sig', async () => {
    const { LlmContextDrone } = await import('./llm-context.drone.js')
    const drone = new LlmContextDrone()
    EffectBus.emit('content:wrote', { sig: TILE, kind: 'resource' })
    EffectBus.emit('content:wrote', { sig: '', kind: 'layer' })
    expect(drone.pendingCount).toBe(0)
  })
})
