// sharing/retired-push-pool.spec.ts
//
// THE RETIRED PUSH CHANNEL'S COLLECTOR, driven against an in-memory OPFS.
//
// `publish-gesture.spec.ts` ratchets the SHAPE (the service is gone, the
// collector never calls a Store read that stages to a host, the queue removal
// sits downstream of the presence check). These tests drive the real code and
// pin the BEHAVIOUR, because the whole risk in this module is one direction:
// it deletes. The load-bearing case is not "did it reclaim the duplicate" —
// it is "did it refuse to touch the entry it could not vouch for".

import { describe, it, expect, beforeEach } from 'vitest'
import { collectRetiredPushPool } from './retired-push-pool.js'

// -------------------------------------------------
// in-memory OPFS (the slice the collector touches)
// -------------------------------------------------

class MockFile {
  kind = 'file' as const
  constructor(public name: string, public bytes: Uint8Array) {}
  async getFile(): Promise<File> {
    return { size: this.bytes.byteLength } as unknown as File
  }
}

class MockDir {
  kind = 'directory' as const
  files = new Map<string, MockFile>()
  dirs = new Map<string, MockDir>()
  constructor(public name = '') {}

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    const hit = this.files.get(name)
    if (hit) return hit
    if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
    const made = new MockFile(name, new Uint8Array(0))
    this.files.set(name, made)
    return made
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    const hit = this.dirs.get(name)
    if (hit) return hit
    if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
    const made = new MockDir(name)
    this.dirs.set(name, made)
    return made
  }

  /** NON-RECURSIVE, like the real thing: removing a directory that still has
   *  entries THROWS. This is the whole safety mechanism for the four source
   *  dirs, so the double must model it or the tests prove nothing. */
  async removeEntry(name: string): Promise<void> {
    if (this.files.delete(name)) return
    const dir = this.dirs.get(name)
    if (!dir) throw new DOMException('NotFoundError', 'NotFoundError')
    if (dir.files.size || dir.dirs.size) {
      throw new DOMException('InvalidModificationError', 'InvalidModificationError')
    }
    this.dirs.delete(name)
  }

  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const [n, h] of this.files) yield [n, h]
    for (const [n, d] of this.dirs) yield [n, d]
  }

  put(name: string, bytes: Uint8Array): void {
    this.files.set(name, new MockFile(name, bytes))
  }
}

// -------------------------------------------------
// helpers
// -------------------------------------------------

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** A plausible content signature. Not the hash of `bytes` — the collector
 *  never hashes, it matches name + length, which is the contract under test. */
const sigOf = (label: string): string => label.padEnd(64, '0').slice(0, 64)

const body = (text: string): Uint8Array => new TextEncoder().encode(text)

const HELD = sigOf('aaaa')      // duplicate whose canonical copy is present
const ORPHAN = sigOf('bbbb')    // duplicate with NO canonical copy — the risk
const SHORT = sigOf('cccc')     // canonical present but a different length
const BEE = sigOf('dddd')       // canonical lives in the bees pool

let root: MockDir
let pushPool: MockDir
let receiptsPool: MockDir
let pushAddress: string
let receiptsAddress: string

const collect = () => collectRetiredPushPool(root as unknown as FileSystemDirectoryHandle)

beforeEach(async () => {
  pushAddress = await sha256Hex('push')
  receiptsAddress = await sha256Hex('receipts')

  root = new MockDir()
  pushPool = await root.getDirectoryHandle(pushAddress, { create: true })
  receiptsPool = await root.getDirectoryHandle(receiptsAddress, { create: true })
})

// -------------------------------------------------

describe('the retired push pool is collected, never trusted', () => {

  it('reclaims a duplicate whose canonical copy is present at the content root', async () => {
    root.put(HELD, body('the real bytes'))
    pushPool.put(`${HELD}.layer`, body('the real bytes'))

    const report = await collect()

    expect(report.reclaimed).toBe(1)
    expect(report.reclaimedBytes).toBe(body('the real bytes').byteLength)
    expect(report.kept).toBe(0)
    // the duplicate is gone, the canonical copy is untouched
    expect(pushPool.files.has(`${HELD}.layer`)).toBe(false)
    expect(root.files.has(HELD)).toBe(true)
  })

  it('KEEPS an entry with no canonical copy — those bytes may be the last ones', async () => {
    pushPool.put(`${ORPHAN}.resource`, body('the only copy'))

    const report = await collect()

    expect(report.reclaimed).toBe(0)
    expect(report.kept).toBe(1)
    expect(pushPool.files.has(`${ORPHAN}.resource`)).toBe(true)
    // and the pool survives to hold it
    expect(root.dirs.has(pushAddress)).toBe(true)
    expect(report.drained).toBe(false)
  })

  it('KEEPS an entry whose canonical copy is a different length', async () => {
    root.put(SHORT, body('short'))
    pushPool.put(`${SHORT}.layer`, body('a much longer body than the root holds'))

    const report = await collect()

    expect(report.kept).toBe(1)
    expect(pushPool.files.has(`${SHORT}.layer`)).toBe(true)
  })

  it('finds a bee in the bees pool, not at the root', async () => {
    const bees = await root.getDirectoryHandle(await sha256Hex('bees'), { create: true })
    bees.put(`${BEE}.js`, body('export const x = 1'))
    pushPool.put(`${BEE}.bee`, body('export const x = 1'))

    const report = await collect()

    expect(report.reclaimed).toBe(1)
    expect(pushPool.files.has(`${BEE}.bee`)).toBe(false)
  })

  it('removes empty receipt markers and leaves anything with content in it', async () => {
    receiptsPool.put(HELD, new Uint8Array(0))
    receiptsPool.put(ORPHAN, body('a signed acknowledgement nobody wrote'))

    const report = await collect()

    expect(report.receipts).toBe(1)
    expect(receiptsPool.files.has(HELD)).toBe(false)
    expect(receiptsPool.files.has(ORPHAN)).toBe(true)
  })

  it('leaves a name it does not recognise, and the directory that holds it', async () => {
    pushPool.put('notes-about-the-queue.txt', body('someone put this here'))

    const report = await collect()

    expect(report.reclaimed).toBe(0)
    expect(pushPool.files.has('notes-about-the-queue.txt')).toBe(true)
    expect(root.dirs.has(pushAddress)).toBe(true)
  })

  it('removes each source directory once it is actually empty', async () => {
    root.put(HELD, body('x'))
    pushPool.put(`${HELD}.layer`, body('x'))
    receiptsPool.put(HELD, new Uint8Array(0))

    const report = await collect()

    expect(report.drained).toBe(true)
    expect(root.dirs.has(pushAddress)).toBe(false)
    expect(root.dirs.has(receiptsAddress)).toBe(false)
  })

  it('drains the pre-pool legacy dirs on the same pass', async () => {
    const legacyPush = await root.getDirectoryHandle('__push__', { create: true })
    const legacyQueue = await legacyPush.getDirectoryHandle('queue', { create: true })
    const legacyReceipts = await root.getDirectoryHandle('__receipts__', { create: true })
    root.put(HELD, body('legacy bytes'))
    legacyQueue.put(`${HELD}.layer`, body('legacy bytes'))
    legacyReceipts.put(HELD, new Uint8Array(0))

    const report = await collect()

    expect(report.reclaimed).toBe(1)
    expect(report.receipts).toBe(1)
    expect(root.dirs.has('__push__')).toBe(false)
    expect(root.dirs.has('__receipts__')).toBe(false)
  })

  it('is idempotent and costs nothing once the sources are gone', async () => {
    root.put(HELD, body('x'))
    pushPool.put(`${HELD}.layer`, body('x'))

    await collect()
    const second = await collect()

    expect(second).toEqual({
      reclaimed: 0, reclaimedBytes: 0, kept: 0, receipts: 0, drained: true,
    })
  })

  it('does nothing at all without a store root — never throws on a cold boot', async () => {
    const report = await collectRetiredPushPool(null)
    expect(report).toEqual({
      reclaimed: 0, reclaimedBytes: 0, kept: 0, receipts: 0, drained: false,
    })
  })

  it('writes nothing: no handle is ever opened for creation', async () => {
    root.put(HELD, body('x'))
    pushPool.put(`${HELD}.layer`, body('x'))
    pushPool.put(`${ORPHAN}.layer`, body('orphan'))

    const created: string[] = []
    const watch = (dir: MockDir): void => {
      const file = dir.getFileHandle.bind(dir)
      const sub = dir.getDirectoryHandle.bind(dir)
      dir.getFileHandle = async (name, opts = {}) => {
        if (opts.create) created.push(`file:${name}`)
        return file(name, opts)
      }
      dir.getDirectoryHandle = async (name, opts = {}) => {
        if (opts.create) created.push(`dir:${name}`)
        const made = await sub(name, opts)
        watch(made)
        return made
      }
      for (const child of dir.dirs.values()) watch(child)
    }
    watch(root)

    await collect()

    expect(created, 'the collector only ever reads and removes').toEqual([])
  })
})
