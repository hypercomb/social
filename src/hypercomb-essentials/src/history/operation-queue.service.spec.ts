import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OperationQueue, conflictsOf } from './operation-queue.service.js'

describe('conflictsOf', () => {
  it('names a tile that left the page or now wears another signature', () => {
    const live = new Map<string, string | undefined>([['a', 's1'], ['b', 's9']])
    expect(conflictsOf({ a: 's1', b: 's2', c: 's3' }, live)).toEqual(['b', 'c'])
  })

  it('checks presence only when the click knew no signature', () => {
    const live = new Map<string, string | undefined>([['a', undefined]])
    expect(conflictsOf({ a: '' }, live)).toEqual([])
    expect(conflictsOf({ a: '', gone: '' }, live)).toEqual(['gone'])
  })
})

describe('OperationQueue', () => {
  // A pool store in memory: one doc, the whole owed list.
  let doc: ArrayBuffer | null = null
  beforeEach(() => {
    doc = null
    const store = {
      getPool: async () => ({}) as FileSystemDirectoryHandle,
      getPoolDoc: async () => doc,
      putPoolDoc: async (_p: unknown, bytes: ArrayBuffer) => { doc = bytes; return 'sig' },
    }
    // The queue reads the pool after the processor's first pass; here the
    // hive is already up, so every listener hears it at once.
    const events = new EventTarget()
    ;(globalThis as any).window = {
      ioc: { get: (key: string) => key === '@hypercomb.social/Store' ? store : undefined },
      addEventListener: (type: string, fn: () => void) => { events.addEventListener(type, fn); queueMicrotask(() => events.dispatchEvent(new Event('synchronize'))) },
      removeEventListener: (type: string, fn: () => void) => events.removeEventListener(type, fn),
    }
  })
  afterEach(() => { delete (globalThis as any).window })

  it('runs acts one at a time, in the order they were made', async () => {
    const q = new OperationQueue()
    const log: string[] = []
    q.handle('step', async op => {
      log.push(`start ${op.args}`)
      await new Promise(r => setTimeout(r, 5))
      log.push(`end ${op.args}`)
      return op.args
    })
    const results = await Promise.all([q.submit('step', [], {}, 'one'), q.submit('step', [], {}, 'two')])
    expect(results).toEqual(['one', 'two'])
    expect(log).toEqual(['start one', 'end one', 'start two', 'end two'])
  })

  it('shares its lane with plain tasks', async () => {
    const q = new OperationQueue()
    const log: string[] = []
    q.handle('step', async () => { await new Promise(r => setTimeout(r, 5)); log.push('act') })
    await Promise.all([q.submit('step', [], {}, null), q.run(async () => { log.push('fold') })])
    expect(log).toEqual(['act', 'fold'])
  })

  it('replays what an earlier session left owed', async () => {
    const owed = [{ id: 'x1', kind: 'step', at: ['p'], expect: { a: 's1' }, args: 7, madeAt: 1 }]
    doc = new TextEncoder().encode(JSON.stringify(owed)).buffer as ArrayBuffer
    const q = new OperationQueue()
    const seen = new Promise(resolve => q.handle('step', async op => resolve(op)))
    expect(await seen).toMatchObject({ id: 'x1', at: ['p'], args: 7 })
    await q.run(async () => undefined)
    await new Promise(r => setTimeout(r, 0))
    expect(q.pending).toEqual([])
    expect(JSON.parse(new TextDecoder().decode(doc!))).toEqual([])
  })
})
