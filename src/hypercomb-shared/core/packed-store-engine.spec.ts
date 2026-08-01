// hypercomb-shared/core/packed-store-engine.spec.ts
//
// The packed store's contract, and the measurement that justifies it.
//
// The engine runs over a `SyncFile` seam precisely so it is testable without
// a worker or OPFS: `MemorySyncFile` here, an OPFS SyncAccessHandle in the
// worker. Same code, both sides.

import { describe, expect, it } from 'vitest'
import {
  MemorySyncFile,
  PackedStoreEngine,
  markerFilename,
  markerIndexOf,
} from './packed-store-engine'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (raw: Uint8Array | null): string | null =>
  raw ? new TextDecoder().decode(raw) : null

/** A deterministic 64-hex address — never a real signature, just an address
 *  of the right shape. */
const address = (seed: number): string =>
  seed.toString(16).padStart(8, '0').repeat(8)

describe('packed store: content', () => {
  it('round-trips content and reports presence', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), bytes('a layer'))
    expect(text(engine.getContent(address(1)))).toBe('a layer')
    expect(engine.hasContent(address(1))).toBe(true)
    expect(engine.hasContent(address(2))).toBe(false)
    expect(engine.getContent(address(2))).toBeNull()
  })

  it('is idempotent — re-putting identical content writes nothing', () => {
    const file = new MemorySyncFile()
    const engine = PackedStoreEngine.open(file)
    engine.putContent(address(1), bytes('same'))
    const afterFirst = file.getSize()
    engine.putContent(address(1), bytes('same'))
    expect(file.getSize()).toBe(afterFirst)
  })

  it('sweeps content only when asked — the GC path', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), bytes('litter'))
    expect(engine.sweepContent(address(1))).toBe(true)
    expect(engine.hasContent(address(1))).toBe(false)
    expect(engine.sweepContent(address(1))).toBe(false)
  })
})

describe('packed store: markers', () => {
  it('head is the MAXIMUM marker, not the last written', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putMarkerAt(address(9), 5, bytes('five'))
    engine.putMarkerAt(address(9), 2, bytes('two'))
    engine.putMarkerAt(address(9), 11, bytes('eleven'))
    engine.putMarkerAt(address(9), 7, bytes('seven'))
    const head = engine.head(address(9))
    expect(head?.index).toBe(11)
    expect(text(head?.bytes ?? null)).toBe('eleven')
  })

  it('orders by INDEX, not by filename string — 11 beats 9', () => {
    // The zero-padded filename exists so lexicographic order matches
    // numeric order; the packed store keys by the number itself, and this
    // pins that they agree.
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putMarkerAt(address(3), 9, bytes('nine'))
    engine.putMarkerAt(address(3), 11, bytes('eleven'))
    expect(engine.head(address(3))?.index).toBe(11)
    expect(markerFilename(11) > markerFilename(9)).toBe(true)
  })

  it('putMarkerAt refuses to overwrite (restore preserves indices)', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    expect(engine.putMarkerAt(address(4), 0, bytes('first'))).toBe(true)
    expect(engine.putMarkerAt(address(4), 0, bytes('second'))).toBe(false)
    expect(text(engine.getMarker(address(4), 0))).toBe('first')
  })

  it('setMarker DOES overwrite — the facade path chose the filename', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.setMarker(address(4), 0, bytes('first'))
    engine.setMarker(address(4), 0, bytes('migrated shape'))
    expect(text(engine.getMarker(address(4), 0))).toBe('migrated shape')
  })

  it('removing a marker is a REAL delete, and empties the bag', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putMarkerAt(address(5), 0, bytes('only'))
    expect(engine.removeMarker(address(5), 0)).toBe(true)
    expect(engine.head(address(5))).toBeNull()
    expect(engine.bags()).not.toContain(address(5))
    expect(engine.removeMarker(address(5), 0)).toBe(false)
  })
})

describe('packed store: pools', () => {
  it('round-trips members and lists them', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putPool(address(6), 'clip-one', bytes('x'))
    engine.putPool(address(6), 'clip-two', bytes('y'))
    expect(engine.poolMembers(address(6)).sort()).toEqual(['clip-one', 'clip-two'])
    expect(text(engine.getPool(address(6), 'clip-two'))).toBe('y')
  })

  it('carries sub-bucket members as prefixed keys', () => {
    // Document pools nest one level (`<pool>/<sign(subKey)>/<sig>`). The
    // prefixed key IS the representation — pool keys are arbitrary strings.
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putPool(address(7), `${address(8)}/${address(1)}`, bytes('ja.json'))
    expect(engine.poolMembers(address(7))).toEqual([`${address(8)}/${address(1)}`])
  })

  it('removing a member is a REAL delete', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putPool(address(6), 'gone', bytes('x'))
    expect(engine.removePool(address(6), 'gone')).toBe(true)
    expect(engine.getPool(address(6), 'gone')).toBeNull()
    expect(engine.removePool(address(6), 'gone')).toBe(false)
  })
})

describe('packed store: the untagged root', () => {
  it('a colliding address is ONE directory holding markers AND members', () => {
    // A bare-word pool and a same-named tile's bag are byte-identical
    // addresses. The store never classifies the directory — only entries.
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    const collided = address(12)
    engine.putMarkerAt(collided, 0, bytes('marker'))
    engine.putPool(collided, 'member', bytes('pool record'))

    const names = engine.dirEntries(collided).map(e => e.name).sort()
    expect(names).toEqual(['00000000', 'member'])

    const dirs = engine.rootEntries().filter(e => e.directory && e.name === collided)
    expect(dirs).toHaveLength(1)
  })

  it('classifies entries by name: 8 digits = marker, else pool member', () => {
    expect(markerIndexOf('00000042')).toBe(42)
    expect(markerIndexOf('0000042')).toBeNull()
    expect(markerIndexOf('i18n.json')).toBeNull()
    expect(markerIndexOf(address(1))).toBeNull()
  })

  it('surfaces content as files and bags/pools as directories', () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), bytes('layer bytes'))
    engine.putMarkerAt(address(2), 0, bytes('m'))
    const entries = engine.rootEntries()
    expect(entries).toContainEqual({ name: address(1), directory: false })
    expect(entries).toContainEqual({ name: address(2), directory: true })
  })
})

describe('packed store: durability', () => {
  it('reopens to the identical state', () => {
    const file = new MemorySyncFile()
    const first = PackedStoreEngine.open(file)
    first.putContent(address(1), bytes('layer'))
    first.putMarkerAt(address(2), 3, bytes('marker'))
    first.putPool(address(2), 'member', bytes('record'))

    const reopened = PackedStoreEngine.open(file)
    expect(text(reopened.getContent(address(1)))).toBe('layer')
    expect(reopened.head(address(2))?.index).toBe(3)
    expect(text(reopened.getPool(address(2), 'member'))).toBe('record')
  })

  it('survives a torn tail — intact records live, the torn one is dropped', () => {
    const file = new MemorySyncFile()
    const engine = PackedStoreEngine.open(file)
    engine.putContent(address(1), bytes('committed'))
    engine.putContent(address(2), bytes('interrupted mid-write'))
    file.chopTail(6) // an append that never finished

    const reopened = PackedStoreEngine.open(file)
    expect(text(reopened.getContent(address(1)))).toBe('committed')
    expect(reopened.hasContent(address(2))).toBe(false)

    // And the store keeps working: the next append truncates the torn bytes.
    reopened.putContent(address(3), bytes('after recovery'))
    expect(text(PackedStoreEngine.open(file).getContent(address(3)))).toBe('after recovery')
  })

  it('refuses to touch a file that is not a pack', () => {
    const file = new MemorySyncFile()
    file.write(0, bytes('this is somebody else’s file entirely'))
    expect(() => PackedStoreEngine.open(file)).toThrow(/not a hive\.pack/)
  })

  it('tombstones survive a reopen', () => {
    const file = new MemorySyncFile()
    const engine = PackedStoreEngine.open(file)
    engine.putMarkerAt(address(2), 0, bytes('m'))
    engine.removeMarker(address(2), 0)
    expect(PackedStoreEngine.open(file).head(address(2))).toBeNull()
  })

  it('compaction preserves every live record and drops the garbage', () => {
    const file = new MemorySyncFile()
    const engine = PackedStoreEngine.open(file)
    engine.putContent(address(1), bytes('kept'))
    engine.putContent(address(2), bytes('swept'))
    engine.sweepContent(address(2))
    engine.putMarkerAt(address(3), 4, bytes('marker'))
    engine.putPool(address(3), 'member', bytes('record'))

    const target = new MemorySyncFile()
    const compacted = engine.compactInto(target)
    expect(text(compacted.getContent(address(1)))).toBe('kept')
    expect(compacted.hasContent(address(2))).toBe(false)
    expect(compacted.head(address(3))?.index).toBe(4)
    expect(text(compacted.getPool(address(3), 'member'))).toBe('record')
    expect(target.getSize()).toBeLessThan(file.getSize())
  })
})

describe('packed store: cold open at hive scale', () => {
  // THE MEASUREMENT THAT JUSTIFIES THE DESIGN.
  //
  // Real measured tree: 603 bags, 8,006 markers. The flat layout pays a
  // per-record file operation to find each bag's head — that is the 13.6s
  // web scan and the reason the localStorage head index existed. The packed
  // store pays ONE sequential read and then answers every head from the
  // resident index.
  //
  // The flat side is not modelled from an invented constant — vitest has no
  // OPFS, so it is anchored to the MEASURED web scan: 13.6 seconds over
  // exactly this tree. That is the number the port has to beat, and using
  // anything else would let the bar be tuned until it passed.
  const BAGS = 603
  const MARKERS = 8_006
  const MEASURED_FLAT_SCAN_MS = 13_600

  const buildHive = (): MemorySyncFile => {
    const file = new MemorySyncFile()
    const engine = PackedStoreEngine.open(file)
    // Spread every marker across every bag: the first `remainder` bags carry
    // one extra, so the totals land exactly on the measured shape rather
    // than leaving the tail of the bags empty.
    const base = Math.floor(MARKERS / BAGS)
    const remainder = MARKERS % BAGS
    let written = 0
    for (let bag = 0; bag < BAGS; bag++) {
      const depth = base + (bag < remainder ? 1 : 0)
      for (let index = 0; index < depth; index++, written++) {
        // ~77 bytes, the measured marker size.
        engine.putMarkerAt(address(bag), index, bytes(`${address(written % 4096)}:${index}`.padEnd(77, ' ')))
      }
    }
    expect(engine.stats().markers).toBe(MARKERS)
    expect(engine.stats().bags).toBe(BAGS)
    return file
  }

  it('opens the whole tree and answers every head at least 100x faster than the flat scan', () => {
    const file = buildHive()

    // BEST of three. The suite runs test files in parallel, so a single
    // sample measures whatever else the machine was doing; the best run is
    // the one that actually measures the cold open. The bar is 100x — an
    // honest best-case still has to clear it by a wide margin.
    let packedMs = Infinity
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now()
      const engine = PackedStoreEngine.open(file)
      for (const bag of engine.bags()) {
        expect(engine.head(bag)).not.toBeNull()
      }
      packedMs = Math.min(packedMs, performance.now() - started)
    }

    console.log(
      `[packed-store] cold open ${BAGS} bags / ${MARKERS} markers: ` +
      `${packedMs.toFixed(1)}ms vs ${MEASURED_FLAT_SCAN_MS}ms flat — ` +
      `${(MEASURED_FLAT_SCAN_MS / packedMs).toFixed(0)}x`,
    )
    expect(packedMs).toBeGreaterThan(0)
    expect(MEASURED_FLAT_SCAN_MS / packedMs).toBeGreaterThanOrEqual(100)
  })

  it('head lookup does not enumerate — the head index has nothing left to cache', () => {
    const engine = PackedStoreEngine.open(buildHive())
    let best = Infinity
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now()
      for (let i = 0; i < 10_000; i++) engine.head(address(i % BAGS))
      best = Math.min(best, performance.now() - started)
    }
    // 10k head lookups over an 8k-marker tree, comfortably inside a frame's
    // budget. This is why HistoryService's localStorage warm-start cache is
    // DELETED rather than ported.
    expect(best).toBeLessThan(250)
  })
})
