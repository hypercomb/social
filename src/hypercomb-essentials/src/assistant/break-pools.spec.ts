// assistant/break-pools.spec.ts
//
// THE FOLD AGAINST A POOL — the half of breaks.ts that touches OPFS, run on
// in-memory directory handles shaped like the real ones (a created file exists,
// empty, before its writable closes). What is pinned is what a real hive relies
// on: copy → verify → remove, exactly what was folded and nothing else; litter
// cleared only once it is old enough not to be a write still in flight; an
// update that lands in place.

import { afterEach, describe, expect, it } from 'vitest'
import {
  BREAK_LOG_POOL, BREAK_QUEUE_POOL,
  appendBreak, compactBreaks, listBreaks, updateIssue,
  type BreakRecord,
} from './breaks.js'

type MemFile = { text: string; lastModified: number }

const memoryDir = () => {
  const files = new Map<string, MemFile>()
  const fileHandle = (name: string) => ({
    kind: 'file' as const,
    getFile: async () => {
      const file = files.get(name)
      if (!file) throw new DOMException('gone', 'NotFoundError')
      return { text: async () => file.text, lastModified: file.lastModified }
    },
    createWritable: async () => {
      let staged = ''
      return {
        write: async (chunk: string) => { staged = chunk },
        close: async () => { files.set(name, { text: staged, lastModified: Date.now() }) },
        abort: async () => { /* nothing staged lands */ },
      }
    },
  })
  return {
    files,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError')
        files.set(name, { text: '', lastModified: Date.now() })
      }
      return fileHandle(name)
    },
    removeEntry: async (name: string) => {
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError')
    },
    entries: async function* () {
      for (const name of [...files.keys()]) yield [name, fileHandle(name)] as const
    },
  }
}

const host = globalThis as { get?: unknown }

const withPools = () => {
  const queue = memoryDir()
  const log = memoryDir()
  const pools: Record<string, unknown> = { [BREAK_QUEUE_POOL]: queue, [BREAK_LOG_POOL]: log }
  host.get = (key: string) =>
    key === '@hypercomb.social/Store' ? { getPool: async (meaning: string) => pools[meaning] ?? null } : undefined
  return { queue, log }
}

afterEach(() => { delete host.get })

const FP = 'f'.repeat(64)
const OTHER = 'e'.repeat(64)

const record = (over: Partial<BreakRecord> = {}): BreakRecord => ({
  kind: 'break@1', fingerprint: FP, type: 'error', message: 'tile is undefined', stack: '', source: '',
  origin: 'http://localhost:4250', route: '/', session: 's1', sessionAt: 1_000,
  count: 1, firstAt: 1_000, lastAt: 1_000, ...over,
})

describe('the fold, against a pool', () => {
  it('folds records into issues, then drains exactly what it folded', async () => {
    const { queue, log } = withPools()
    expect(await appendBreak(record())).toBe(true)
    expect(await appendBreak(record({ session: 's2', count: 3, firstAt: 2_000, lastAt: 2_500 }))).toBe(true)
    expect(await appendBreak(record({ fingerprint: OTHER, message: 'other' }))).toBe(true)
    expect(queue.files.size).toBe(3)

    const result = await compactBreaks(10_000)
    expect(result).toMatchObject({ folded: 3, issues: 2, unwritten: 0 })
    expect([...(result?.created ?? [])].sort()).toEqual([OTHER, FP])
    expect(queue.files.size).toBe(0)
    expect(log.files.size).toBe(2)

    const listed = await listBreaks()
    expect(listed?.queued).toBe(0)
    expect(listed?.issues.find(i => i.fingerprint === FP)).toMatchObject({ count: 4, sessions: 2, status: 'new' })

    expect(await compactBreaks(11_000)).toMatchObject({ folded: 0, created: [], issues: 2 })
  })

  it('clears half-written litter once it is a minute old, never a write still in flight', async () => {
    const { queue } = withPools()
    queue.files.set('stale', { text: '', lastModified: 0 })
    queue.files.set('in-flight', { text: '', lastModified: 100_000 })
    await compactBreaks(120_000)
    expect([...queue.files.keys()]).toEqual(['in-flight'])
  })

  it('updates an issue in place, and says when there is none', async () => {
    withPools()
    await appendBreak(record())
    await compactBreaks(1_000)
    expect(await updateIssue(FP, { status: 'chosen', mode: 'investigate', offered: true }, 2_000))
      .toMatchObject({ status: 'chosen', mode: 'investigate', offeredAt: 2_000 })
    expect((await listBreaks())?.issues[0]).toMatchObject({ status: 'chosen', offeredAt: 2_000 })
    expect(await updateIssue(OTHER, { status: 'open' })).toBe('no-issue')
  })

  it('reports an unavailable store rather than pretending the queue is empty', async () => {
    host.get = () => undefined
    expect(await appendBreak(record())).toBe(false)
    expect(await listBreaks()).toBeNull()
    expect(await compactBreaks()).toBeNull()
  })
})

describe('what the hive refuses', () => {
  it('refuses a patch whose status precondition no longer holds, and changes nothing', async () => {
    withPools()
    await appendBreak(record())
    await compactBreaks(1_000)
    await updateIssue(FP, { status: 'chosen', mode: 'fix', offered: true }, 2_000)
    expect(await updateIssue(FP, { title: 'rewritten', interpretation: 'steered', status: 'open', onlyIfStatus: 'new' }, 3_000))
      .toBe('refused')
    const [kept] = (await listBreaks())?.issues ?? []
    expect(kept).toMatchObject({ status: 'chosen', mode: 'fix', offeredAt: 2_000 })
    expect(kept?.title).toBeUndefined()
    expect(kept?.interpretation).toBeUndefined()
  })

  it('applies the same patch while the precondition holds', async () => {
    withPools()
    await appendBreak(record())
    await compactBreaks(1_000)
    expect(await updateIssue(FP, { title: 'tile missing', status: 'open', onlyIfStatus: 'new' }, 2_000))
      .toMatchObject({ status: 'open', title: 'tile missing' })
  })
})
