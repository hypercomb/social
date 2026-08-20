// mirror-sink.spec.ts — a backup saves as it goes, and never re-fetches.
//
// Content is IMMUTABLE and named by the hash of its own bytes. Two things fall
// out of that, and this file pins both:
//
//   1. A destination that already holds a signature has the complete answer.
//      Fetching it again can only produce the same bytes, so the walk must not
//      go near the network for it. This is the difference between a backup
//      that re-downloads the hive on every pass and one that finishes
//      instantly when it is already current.
//   2. Bytes belong to the destination the moment they verify, not after the
//      whole closure resolves. A walk interrupted at ninety percent must leave
//      ninety percent SAVED, not nothing.
//
// The one wrinkle is descent: a record names further content INSIDE itself, so
// skipping it outright would stop the walk. Only a record can do that, and a
// record is JSON — so the decision costs ONE BYTE. An already-saved item is
// skipped after peeking a `{` or `[` that never came, and read back in full
// only when it is genuinely a record. Anything past the record ceiling is not
// even peeked.
//
// That byte is the whole steady state. Reading every already-saved item back
// in full would make a pass over an unchanged backup cost as much as building
// a new one — measured on a real hive, 10,784 files of which THREE exceed 1 MB,
// so a full read-back is 205 MB of disk to discover nothing changed.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.drone.js').ContentBrokerDrone

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)

const MANIFEST = SIG('a')
const NESTED_RECORD = SIG('b')
const IMAGE = SIG('c')

const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

let served: Map<string, Uint8Array>
let fetched: string[]

/** A destination that starts with whatever it is handed. */
const makeSink = (initial: Map<string, Uint8Array> = new Map()) => {
  const held = new Map(initial)
  const reads: string[] = []
  const peeks: string[] = []
  const writes: string[] = []
  let failWrites = false
  return {
    held,
    reads,
    peeks,
    writes,
    failNextWrites: () => { failWrites = true },
    sink: {
      has: async (sig: string) => held.get(sig)?.byteLength ?? null,
      read: async (sig: string) => { reads.push(sig); return held.get(sig) ?? null },
      peek: async (sig: string, bytes: number) => {
        peeks.push(sig)
        return held.get(sig)?.slice(0, bytes) ?? null
      },
      write: async (sig: string, bytes: Uint8Array) => {
        if (failWrites) throw new Error('destination is gone')
        writes.push(sig)
        held.set(sig, bytes)
      },
    },
  }
}

const makeBroker = () => {
  const broker = new ContentBrokerDrone()
  ;(broker as unknown as { fetchBySig: unknown }).fetchBySig = vi.fn(async (sig: string) => {
    fetched.push(sig)
    return served.get(sig) ?? null
  })
  return broker
}

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.drone.js'))
})

beforeEach(() => {
  fetched = []
  served = new Map<string, Uint8Array>([
    [MANIFEST, json({ turns: [{ role: 'user', contentSig: NESTED_RECORD }] })],
    [NESTED_RECORD, json({ body: 'hello', imageSig: IMAGE })],
    [IMAGE, new TextEncoder().encode('PNG pretend-bytes')],
  ])
})

describe('a mirrored walk', () => {
  it('hands every resolved item to the destination as it verifies', async () => {
    const { sink, held, writes } = makeSink()
    const broker = makeBroker()

    const stats = await broker.adoptResources([MANIFEST], {
      deepResources: true,
      quiet: true,
      mirror: sink,
    })

    expect(writes).toEqual([MANIFEST, NESTED_RECORD, IMAGE])
    expect(held.get(IMAGE)).toEqual(served.get(IMAGE))
    expect(stats.mirrored).toBe(3)
    expect(stats.alreadyMirrored).toBe(0)
    expect(stats.mirrorFailed).toBe(0)
  })

  it('never fetches what the destination already holds', async () => {
    // The whole closure is already backed up — the second pass must be free.
    const { sink, writes } = makeSink(new Map(served))
    const broker = makeBroker()

    const stats = await broker.adoptResources([MANIFEST], {
      deepResources: true,
      quiet: true,
      mirror: sink,
    })

    expect(fetched).toEqual([])
    expect(writes).toEqual([])
    expect(stats.alreadyMirrored).toBe(3)
    expect(stats.mirrored).toBe(0)
  })

  it('still descends through a small record it already holds', async () => {
    // Only the manifest is saved. Skipping it outright would strand the two
    // items it names — the walk has to read it back to find them.
    const { sink, reads, writes } = makeSink(new Map([[MANIFEST, served.get(MANIFEST)!]]))
    const broker = makeBroker()

    await broker.adoptResources([MANIFEST], { deepResources: true, quiet: true, mirror: sink })

    expect(reads).toEqual([MANIFEST])
    expect(fetched).not.toContain(MANIFEST)
    expect(writes).toEqual([NESTED_RECORD, IMAGE])
  })

  it('never reads an already-saved item back unless it could be a record', async () => {
    // The steady state. An image cannot name further content, so one byte is
    // the whole decision — reading it back in full would make a pass over an
    // unchanged backup cost as much as building a new one.
    const image = SIG('f')
    const bytes = new TextEncoder().encode('PNG definitely-not-json')
    served.set(image, bytes)
    const { sink, reads, peeks } = makeSink(new Map([[image, bytes]]))
    const broker = makeBroker()

    await broker.adoptResources([image], { deepResources: true, quiet: true, mirror: sink })

    expect(peeks).toEqual([image])
    expect(reads).toEqual([])
    expect(fetched).toEqual([])
  })

  it('skips an already-saved item too large to be a record, without reading it', async () => {
    // 9 MB is past the record ceiling, so nothing inside it could name more
    // content. Reading it back would be pure I/O for no possible finding.
    const big = SIG('e')
    served.set(big, new Uint8Array(9 * 1024 * 1024))
    const { sink, reads, peeks } = makeSink(new Map([[big, new Uint8Array(9 * 1024 * 1024)]]))
    const broker = makeBroker()

    await broker.adoptResources([big], { deepResources: true, quiet: true, mirror: sink })

    // Above the ceiling it does not even pay the byte.
    expect(reads).toEqual([])
    expect(peeks).toEqual([])
    expect(fetched).toEqual([])
  })

  it('counts a destination that fails rather than swallowing it', async () => {
    // A backup that cannot say which items it failed to save is the failure
    // this whole path exists to prevent.
    const { sink, failNextWrites } = makeSink()
    failNextWrites()
    const broker = makeBroker()

    const stats = await broker.adoptResources([MANIFEST], {
      deepResources: true,
      quiet: true,
      mirror: sink,
    })

    expect(stats.mirrorFailed).toBeGreaterThan(0)
    expect(stats.mirrored).toBe(0)
    // and the walk still completed rather than aborting on the first bad write
    expect(stats.leaves).toBe(3)
  })

  it('leaves an unmirrored walk exactly as it was', async () => {
    const broker = makeBroker()
    const stats = await broker.adoptResources([MANIFEST], { deepResources: true, quiet: true })

    expect(fetched).toContain(IMAGE)
    expect(stats.mirrored).toBe(0)
    expect(stats.alreadyMirrored).toBe(0)
    expect(stats.mirrorFailed).toBe(0)
  })
})
