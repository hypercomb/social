// hypercomb-shared/core/packed-store-scale-probe.ts
//
// THE SCALE PROBE — does the packed store hold up at the size that started
// all this?
//
// The unit benchmark in `packed-store-engine.spec.ts` runs the engine over an
// in-memory buffer. It proves the ALGORITHM (one sequential read, head is a
// map max, no enumeration) but it never touches OPFS, the worker, the RPC
// hop, or the drain. Those are exactly where a browser can still disappoint:
// a SyncAccessHandle is not a memory buffer, and moving 8,000 records
// one-at-a-time through copy -> verify -> remove is real work.
//
// So this seeds a hive at the MEASURED shape — 603 bags, 8,006 markers, the
// tree whose flat cold scan took 13.6 seconds — in a real browser, and
// measures three things that matter:
//
//   1. the flat scan, here, on this machine (the honest local baseline)
//   2. the drain: how long the one-way migration actually takes
//   3. the packed cold open, and whether every head still reads back
//
// SAFETY. This WRITES to OPFS, so it is not a toy. Three guards:
//
//   - Every address it creates is derived from `PROBE_NAMESPACE`, so probe
//     data is identifiable and `cleanup()` removes exactly what `seed()`
//     made and nothing else. It never enumerates-and-deletes.
//   - `seed()` refuses unless passed `{ iUnderstandThisWritesToOpfs: true }`.
//   - Run it on a SCRATCH ORIGIN (a spare port), never the origin holding a
//     hive you care about. The probe cannot tell the difference, and 603
//     synthetic bags in a real tree would be a mess to unpick even with
//     cleanup.

const PROBE_NAMESPACE = 'packed-store-scale-probe:'

/** The measured shape of the tree that motivated the whole port. */
export const PROBE_BAGS = 603
export const PROBE_MARKERS = 8_006
/** A marker is ~77 bytes in the real tree. */
const MARKER_BYTES = 77

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')

const sign = async (text: string): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

/** Probe bag addresses are DERIVED, never random — so a later run (or a
 *  cleanup after a reload) can name exactly the same set without a manifest
 *  to lose. */
export const probeBagAddress = (index: number): Promise<string> =>
  sign(`${PROBE_NAMESPACE}bag:${index}`)

const markerFilename = (index: number): string => String(index).padStart(8, '0')

/** Deterministic marker bytes, so verification can assert CONTENT and not
 *  merely presence — a drain that moved the right number of wrong bytes
 *  would otherwise pass. */
const markerBytes = (bag: number, index: number): Uint8Array => {
  const body = `${PROBE_NAMESPACE}${bag}:${index}:`
  return new TextEncoder().encode(body.padEnd(MARKER_BYTES, '.'))
}

/** How many markers bag `i` carries, spreading PROBE_MARKERS across
 *  PROBE_BAGS so the totals land exactly on the measured shape. */
const depthOf = (bag: number): number => {
  const base = Math.floor(PROBE_MARKERS / PROBE_BAGS)
  return base + (bag < PROBE_MARKERS % PROBE_BAGS ? 1 : 0)
}

export interface SeedReport {
  bags: number
  markers: number
  ms: number
}

/**
 * Write the flat layout: `<root>/<bagSig>/00000000…` — exactly what the
 * shell's own flat store looks like, so the drain has nothing special to
 * cope with.
 *
 * Resumable: a bag that already has its full marker count is skipped, so a
 * seed interrupted by a reload can be re-run.
 */
export const seed = async (
  options?: { iUnderstandThisWritesToOpfs?: boolean; onProgress?: (done: number) => void },
): Promise<SeedReport> => {
  if (!options?.iUnderstandThisWritesToOpfs) {
    throw new Error(
      '[scale-probe] refusing to seed: this writes 603 directories and 8,006 files ' +
      'into this origin\'s OPFS. Run it on a scratch origin and pass ' +
      '{ iUnderstandThisWritesToOpfs: true }.',
    )
  }
  const started = performance.now()
  const root = await navigator.storage.getDirectory()
  let markers = 0

  for (let bag = 0; bag < PROBE_BAGS; bag++) {
    const address = await probeBagAddress(bag)
    const dir = await root.getDirectoryHandle(address, { create: true })
    const depth = depthOf(bag)

    // Resume: count what is already there before rewriting it.
    let present = 0
    for await (const _ of (dir as unknown as AsyncIterable<unknown>)) present++
    if (present >= depth) { markers += present; options?.onProgress?.(markers); continue }

    for (let index = 0; index < depth; index++) {
      const handle = await dir.getFileHandle(markerFilename(index), { create: true })
      const writable = await handle.createWritable()
      await writable.write(markerBytes(bag, index) as unknown as BufferSource)
      await writable.close()
      markers++
    }
    options?.onProgress?.(markers)
  }

  return { bags: PROBE_BAGS, markers, ms: performance.now() - started }
}

export interface ScanReport {
  bags: number
  headsRead: number
  ms: number
  /** File operations the scan paid: one listing per bag plus one read per
   *  head. The packed store's equivalent is a single open. */
  fileOps: number
}

/**
 * The flat cold scan, measured HERE — enumerate every bag, find its maximum
 * marker, read it. This is the operation the localStorage head index existed
 * to dodge and the one the packed store replaces.
 *
 * Deliberately does what the flat store does: it does not know the bag list
 * in advance, so it enumerates the root.
 */
export const measureFlatScan = async (): Promise<ScanReport> => {
  const started = performance.now()
  const root = await navigator.storage.getDirectory()
  const probeAddresses = new Set<string>()
  for (let bag = 0; bag < PROBE_BAGS; bag++) probeAddresses.add(await probeBagAddress(bag))

  let bags = 0
  let headsRead = 0
  let fileOps = 0
  for await (const [name, handle] of (root as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind !== 'directory' || !probeAddresses.has(name)) continue
    bags++
    const dir = handle as FileSystemDirectoryHandle
    let max = -1
    for await (const [entry] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      const index = /^\d{8}$/.test(entry) ? Number(entry) : -1
      if (index > max) max = index
      fileOps++
    }
    if (max >= 0) {
      const file = await (await dir.getFileHandle(markerFilename(max))).getFile()
      await file.arrayBuffer()
      headsRead++
      fileOps++
    }
  }
  return { bags, headsRead, ms: performance.now() - started, fileOps }
}

export interface VerifyReport {
  bags: number
  headsMatched: number
  mismatches: string[]
  ms: number
}

/**
 * Read every probe head back THROUGH WHATEVER STORE IS MOUNTED — flat before
 * the drain, packed after it — and check the bytes are the ones seeded.
 *
 * This is the half that matters more than any timing: a fast migration that
 * loses or corrupts a record is worthless.
 */
export const verifyHeads = async (): Promise<VerifyReport> => {
  const started = performance.now()
  const root = await navigator.storage.getDirectory()
  let matched = 0
  const mismatches: string[] = []

  for (let bag = 0; bag < PROBE_BAGS; bag++) {
    const address = await probeBagAddress(bag)
    const head = depthOf(bag) - 1
    try {
      const dir = await root.getDirectoryHandle(address)
      const file = await (await dir.getFileHandle(markerFilename(head))).getFile()
      const actual = new Uint8Array(await file.arrayBuffer())
      const expected = markerBytes(bag, head)
      let same = actual.length === expected.length
      if (same) for (let i = 0; i < expected.length; i++) if (actual[i] !== expected[i]) { same = false; break }
      if (same) matched++
      else mismatches.push(`${address.slice(0, 12)}#${head}: bytes differ`)
    } catch (error) {
      mismatches.push(`${address.slice(0, 12)}#${head}: ${(error as Error).name}`)
    }
  }
  return { bags: PROBE_BAGS, headsMatched: matched, mismatches: mismatches.slice(0, 10), ms: performance.now() - started }
}

/**
 * Remove exactly what `seed()` created — the derived addresses, nothing else.
 *
 * Never enumerates the root looking for things to delete. If a probe bag is
 * already gone (drained into the pack, say) that is not an error.
 */
export const cleanup = async (): Promise<{ removed: number; markers: number }> => {
  const root = await navigator.storage.getDirectory()
  let removed = 0
  let markers = 0

  for (let bag = 0; bag < PROBE_BAGS; bag++) {
    const address = await probeBagAddress(bag)

    // MARKER BY MARKER, not `removeEntry` on the bag.
    //
    // Removing a top-level sig entry is a NO-OP in the packed store, by
    // design — that is the content-deletion doctrine, and a bag is not a
    // directory there, it is a key range. So a recursive remove silently
    // does nothing once the probe has been drained, and a cleanup that
    // reports success while leaving 8,006 records behind is worse than no
    // cleanup at all. Markers ARE real deletes, so remove those.
    try {
      const dir = await root.getDirectoryHandle(address)
      for (let index = 0; index < depthOf(bag); index++) {
        try { await dir.removeEntry(markerFilename(index)); markers++ } catch { /* gone */ }
      }
    } catch { /* bag absent — nothing to do */ }

    // And drop the flat directory too, for the pre-drain case where it is a
    // real OPFS directory.
    try { await root.removeEntry(address, { recursive: true }); removed++ } catch { /* packed, or absent */ }
  }
  return { removed, markers }
}

/** Expose the probe for console-driven runs in the dev shell. */
export const installScaleProbe = (): void => {
  ;(globalThis as unknown as Record<string, unknown>)['hypercombScaleProbe'] = {
    seed, measureFlatScan, verifyHeads, cleanup, PROBE_BAGS, PROBE_MARKERS,
  }
}
