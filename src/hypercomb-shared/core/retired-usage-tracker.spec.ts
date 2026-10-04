// hypercomb-shared/core/retired-usage-tracker.spec.ts
//
// The retired usage tracker's leftovers are removed on boot — and ONLY them.

import { beforeEach, describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { retireUsageTracker } from './retired-usage-tracker.js'

class Dir {
  readonly kind = 'directory'
  readonly entriesMap = new Map<string, Dir | { kind: 'file' }>()
  constructor(readonly name: string) {}
  async *entries(): AsyncIterable<[string, unknown]> { yield* this.entriesMap.entries() }
  async removeEntry(name: string): Promise<void> {
    const entry = this.entriesMap.get(name)
    if (!entry) throw new Error(`NotFoundError: ${name}`)
    if (entry instanceof Dir && entry.entriesMap.size > 0) throw new Error(`InvalidModificationError: ${name} is not empty`)
    this.entriesMap.delete(name)
  }
}

const sig = (text: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)

const file = { kind: 'file' as const }

let root: Dir
let pool: Dir
let bucket: Dir

const store = () => ({
  hypercombRoot: root as unknown as FileSystemDirectoryHandle,
  openPool: async (meaning: string) =>
    (root.entriesMap.get(await sig(meaning)) as unknown as FileSystemDirectoryHandle) ?? null,
})

beforeEach(async () => {
  root = new Dir('root')
  pool = new Dir(await sig('usage:dwell'))
  bucket = new Dir(await sig('v1'))
  root.entriesMap.set(pool.name, pool)
  pool.entriesMap.set(bucket.name, bucket)
  bucket.entriesMap.set('a'.repeat(64), file)
  bucket.entriesMap.set('b'.repeat(64), file)
  bucket.entriesMap.set('00000000', file)
  bucket.entriesMap.set('00000001', file)
  root.entriesMap.set('c'.repeat(64), file)   // someone's content: never touched
  localStorage.setItem('hc:usage-pending', '{"x":{"c":1,"d":0,"t":0}}')
})

describe('the retired usage tracker', () => {
  it('removes its pool, its sub-bucket, every version and marker, and its pending key', async () => {
    expect(await retireUsageTracker(store())).toBe(true)
    expect(root.entriesMap.has(pool.name)).toBe(false)
    expect(root.entriesMap.has('c'.repeat(64))).toBe(true)
    expect(localStorage.getItem('hc:usage-pending')).toBeNull()
  })

  it('runs again harmlessly: a hive with nothing left is a no-op', async () => {
    await retireUsageTracker(store())
    expect(await retireUsageTracker(store())).toBe(true)
    expect([...root.entriesMap.keys()]).toEqual(['c'.repeat(64)])
  })

  it('leaves everything when the sub-bucket holds something the tracker never wrote', async () => {
    bucket.entriesMap.set('notes.txt', file)
    expect(await retireUsageTracker(store())).toBe(false)
    expect(bucket.entriesMap.size).toBe(5)
    expect(root.entriesMap.has(pool.name)).toBe(true)
  })

  it('leaves everything when the pool holds anything but the one sub-bucket', async () => {
    pool.entriesMap.set('d'.repeat(64), new Dir('d'.repeat(64)))
    expect(await retireUsageTracker(store())).toBe(false)
    expect(bucket.entriesMap.size).toBe(4)
  })

  it('never creates the pool on a hive that never had it', async () => {
    root.entriesMap.delete(pool.name)
    expect(await retireUsageTracker(store())).toBe(true)
    expect([...root.entriesMap.keys()]).toEqual(['c'.repeat(64)])
  })
})
