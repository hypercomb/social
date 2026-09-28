import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import {
  DEFAULT_HARNESS, HARNESS_DEVICE_KEY, HARNESS_POOL, HarnessStore, harnessBytes, parseHarness,
} from './harness.js'

type MemFile = { bytes: ArrayBuffer }

const memoryDir = () => {
  const files = new Map<string, MemFile>()
  const fileHandle = (name: string) => ({
    kind: 'file' as const,
    getFile: async () => {
      const file = files.get(name)
      if (!file) throw new DOMException('gone', 'NotFoundError')
      return { size: file.bytes.byteLength, text: async () => new TextDecoder().decode(file.bytes) }
    },
    createWritable: async () => {
      let staged: ArrayBuffer = new ArrayBuffer(0)
      return {
        write: async (chunk: ArrayBuffer) => { staged = chunk },
        close: async () => { files.set(name, { bytes: staged }) },
      }
    },
  })
  return {
    files,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError')
        files.set(name, { bytes: new ArrayBuffer(0) })
      }
      return fileHandle(name)
    },
    entries: async function* () {
      for (const name of [...files.keys()]) yield [name, fileHandle(name)] as const
    },
  }
}

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

const host = globalThis as { localStorage?: unknown }
let storage: ReturnType<typeof memoryStorage>
beforeEach(() => { storage = memoryStorage(); host.localStorage = storage })
afterEach(() => { delete host.localStorage })

const withPool = () => {
  const dir = memoryDir()
  const store = new HarnessStore(() => ({ getPool: async (meaning: string) => (meaning === HARNESS_POOL ? dir : null) }))
  return { dir, store }
}

describe('a harness record', () => {
  it('fills what a record leaves out from the shipped default', () => {
    const record = parseHarness({ kind: 'harness@1', name: 'Quiet Reader', leg: { rounds: 6 } })
    expect(record.name).toBe('quiet-reader')
    expect(record.leg).toEqual({ rounds: 6, reserveTokens: 8_000, keepVerbatim: 4 })
    expect(record.budget).toEqual(DEFAULT_HARNESS.budget)
    expect(record.review.held).toEqual(['do', 'write'])
    expect(record.steps).toBeUndefined()
  })

  it('refuses what is not a harness, and a harness that would auto-run a held kind', () => {
    expect(() => parseHarness({ kind: 'theme@1', name: 'x' })).toThrow('not a harness@1')
    expect(() => parseHarness({ kind: 'harness@1', name: '' })).toThrow('needs a name')
    expect(() => parseHarness({ kind: 'harness@1', name: 'bold', review: { auto: ['read', 'do'] } }))
      .toThrow("may not auto-run do")
  })

  it('may narrow: deny words, hold more kinds, fewer rounds', () => {
    const record = parseHarness({
      kind: 'harness@1', name: 'researcher',
      vocabulary: { deny: ['delete', 'move'] }, review: { held: ['table'] }, budget: { rounds: 40 },
    })
    expect(record.vocabulary.deny).toEqual(['delete', 'move'])
    expect(record.review.held).toEqual(['do', 'write', 'table'])
    expect(record.budget.rounds).toBe(40)
  })

  it('keeps only signatures as steps, instruction and doctrine', () => {
    const sig = 'a'.repeat(64)
    const record = parseHarness({ kind: 'harness@1', name: 'stepped', steps: [sig, 'not-a-sig'], instruction: 'plain text', doctrine: [sig] })
    expect(record.steps).toEqual([sig])
    expect(record.instruction).toBeUndefined()
    expect(record.doctrine).toEqual([sig])
  })

  it('signs the same policy to the same signature', async () => {
    const a = await SignatureService.sign(harnessBytes(parseHarness({ kind: 'harness@1', name: 'same', leg: { rounds: 12 } })))
    const b = await SignatureService.sign(harnessBytes(parseHarness({ kind: 'harness@1', name: 'same' })))
    expect(a).toBe(b)
  })
})

describe('the harness pool', () => {
  it('seeds the shipped default once, content-addressed, and answers it as active', async () => {
    const { dir, store } = withPool()
    const sig = await store.seed()
    expect([...dir.files.keys()]).toEqual([sig])
    expect(store.active).toEqual(DEFAULT_HARNESS)
    expect(store.activeSig).toBe(sig)
    await store.seed()
    expect(dir.files.size).toBe(1)
  })

  it('a chosen record in the pool is the active one; a stale pointer falls back to the default', async () => {
    const { dir, store } = withPool()
    await store.seed()
    const quiet = await store.import({ kind: 'harness@1', name: 'quiet', leg: { rounds: 4 } })
    expect(dir.files.size).toBe(2)
    expect(store.use(quiet)).toBe(true)
    expect(store.active.leg.rounds).toBe(4)
    expect(store.activeSig).toBe(quiet)
    storage.setItem(HARNESS_DEVICE_KEY, 'f'.repeat(64))
    expect(store.active).toEqual(DEFAULT_HARNESS)
    expect(store.use('f'.repeat(64))).toBe(false)
    expect(store.use('')).toBe(true)
    expect(store.list().map(entry => entry.record.name).sort()).toEqual(['default', 'quiet'])
  })

  it('a fresh store sweeps what an earlier one wrote', async () => {
    const { dir, store } = withPool()
    await store.seed()
    const quiet = await store.import({ kind: 'harness@1', name: 'quiet', leg: { rounds: 4 } })
    const later = new HarnessStore(() => ({ getPool: async () => dir }))
    expect(await later.sweep()).toBe(2)
    later.use(quiet)
    expect(later.active.name).toBe('quiet')
  })

  it('answers the shipped default with no store at all', async () => {
    const store = new HarnessStore(() => undefined)
    expect(await store.sweep()).toBe(0)
    expect(await store.seed()).toMatch(/^[0-9a-f]{64}$/)
    expect(store.active).toEqual(DEFAULT_HARNESS)
  })
})
