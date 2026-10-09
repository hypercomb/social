// hypercomb-shared/core/retired-statistics.spec.ts
//
// What the retired trackers left is removed on boot — and ONLY that.

import { beforeEach, describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { RETIRED_STATISTIC_KEYS, retireStatistics } from './retired-statistics.js'

class Dir {
  readonly kind = 'directory'
  readonly entriesMap = new Map<string, Dir | { kind: 'file' }>()
  constructor(readonly name: string) {}
  async *entries(): AsyncIterable<[string, unknown]> { yield* this.entriesMap.entries() }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<Dir> {
    const entry = this.entriesMap.get(name)
    if (entry instanceof Dir) return entry
    if (opts?.create) { const dir = new Dir(name); this.entriesMap.set(name, dir); return dir }
    throw new Error(`NotFoundError: ${name}`)
  }
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
const versions = (dir: Dir): Dir => {
  dir.entriesMap.set('a'.repeat(64), file)
  dir.entriesMap.set('b'.repeat(64), file)
  dir.entriesMap.set('00000000', file)
  dir.entriesMap.set('00000001', file)
  return dir
}

let root: Dir
const store = () => ({
  hypercombRoot: root as unknown as FileSystemDirectoryHandle,
  openPool: async (meaning: string) =>
    (root.entriesMap.get(await sig(meaning)) as unknown as FileSystemDirectoryHandle) ?? null,
})
const pool = async (meaning: string): Promise<Dir> => root.getDirectoryHandle(await sig(meaning), { create: true })
const bucket = async (meaning: string, subKey: string): Promise<Dir> =>
  (await pool(meaning)).getDirectoryHandle(await sig(subKey), { create: true })

beforeEach(async () => {
  root = new Dir('root')
  root.entriesMap.set('c'.repeat(64), file)   // someone's content: never touched
  versions(await bucket('usage:dwell', 'v1'))
  versions(await bucket('portals:recent', 'recent'))
  versions(await bucket('portals:recent', 'home'))
  versions(await pool('habits:spoken'))
  for (const key of RETIRED_STATISTIC_KEYS) localStorage.setItem(key, '1')
  localStorage.setItem('hc:home-portal', 'kept')
})

describe('the retired statistics', () => {
  it('removes every key, the usage pool, and the walking trail — never the home mark', async () => {
    expect(await retireStatistics(store())).toBe(true)
    for (const key of RETIRED_STATISTIC_KEYS) expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem('hc:home-portal')).toBe('kept')
    expect(root.entriesMap.has(await sig('usage:dwell'))).toBe(false)
    expect(root.entriesMap.has(await sig('habits:spoken'))).toBe(false)
    const portals = await pool('portals:recent')
    expect([...portals.entriesMap.keys()]).toEqual([await sig('home')])
    expect((await bucket('portals:recent', 'home')).entriesMap.size).toBe(4)
    expect(root.entriesMap.has('c'.repeat(64))).toBe(true)
  })

  it('runs again harmlessly', async () => {
    await retireStatistics(store())
    expect(await retireStatistics(store())).toBe(true)
    expect(root.entriesMap.size).toBe(2)
  })

  it('leaves a space alone when it holds something no tracker wrote', async () => {
    const dwell = await bucket('usage:dwell', 'v1')
    dwell.entriesMap.set('notes.txt', file)
    expect(await retireStatistics(store())).toBe(false)
    expect(dwell.entriesMap.size).toBe(5)
    // ...while the other spaces are still cleaned
    expect((await pool('portals:recent')).entriesMap.has(await sig('recent'))).toBe(false)
  })

  it('never creates a pool on a hive that never had one', async () => {
    root.entriesMap.delete(await sig('usage:dwell'))
    root.entriesMap.delete(await sig('portals:recent'))
    root.entriesMap.delete(await sig('habits:spoken'))
    expect(await retireStatistics(store())).toBe(true)
    expect([...root.entriesMap.keys()]).toEqual(['c'.repeat(64)])
  })
})
