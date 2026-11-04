// The marker byte protocol shared by full history and cold host locations.
import { markerName } from './directory-safety.js'

const SIG = /^[a-f0-9]{64}$/
const MARKER = /^\d{8}$/

export const layerMarkerBytes = (layer: string): Uint8Array => {
  if (!SIG.test(layer)) throw new Error('A location marker needs a signed layer')
  return new TextEncoder().encode(JSON.stringify({ layer }))
}

export interface MarkerHead { name: string; layer: string }

/** The marker record at `name`: the layer it points at. Throws when the
 *  marker is absent or is not a location marker. */
export const readLayerMarker = async (bag: FileSystemDirectoryHandle, name: string): Promise<MarkerHead> => {
  try {
    const bytes = await (await bag.getFileHandle(name)).getFile()
    const record = JSON.parse(await bytes.text()) as { layer?: unknown }
    if (!SIG.test(String(record.layer))) throw new Error(`Invalid location marker ${name}`)
    return { name, layer: String(record.layer) }
  } catch { throw new Error(`Unreadable location marker ${name}`) }
}

export const latestLayerMarker = async (bag: FileSystemDirectoryHandle):
  Promise<MarkerHead | null> => {
  let latest = ''
  for await (const [name, handle] of bag.entries()) {
    if (handle.kind === 'file' && MARKER.test(name) && name > latest) latest = name
  }
  if (!latest) return null
  return readLayerMarker(bag, latest)
}

/** Is there a FILE named `name` in `bag`? Absent is false. A directory at
 *  that name or an unreadable bag throws, so a caller never mistakes
 *  "could not look" for "not there". */
export const markerFileExists = async (bag: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
  try { await bag.getFileHandle(name, { create: false }); return true } catch (error) {
    if ((error as { name?: string })?.name === 'NotFoundError') return false
    throw error
  }
}

/**
 * THE HEAD MEMO. `latestLayerMarker` walks every entry of a bag to find the
 * highest name, and every head read paid that walk — a document read, a
 * head lookup, a marker allocation — O(entries) each, O(n²) across a long
 * history. Marker names are a dense sequence, so once the head is known ONE
 * targeted lookup answers whether it still is: the next name in sequence is
 * absent, or another writer (a second tab of the same hive) has advanced the
 * bag and the memo walks forward to the new max. A full scan happens only on
 * the first read of a key and when the forward walk runs past its bound.
 * The caller chooses the key — one bag, or one (pool, sub-bucket) — because
 * a directory handle carries no identity across calls.
 *
 * An accelerator, never truth: a write that trusts it still goes through
 * `writeLayerMarker`, which refuses to replace an existing marker, so a memo
 * that is behind costs one refused write and a re-read, never a revision.
 */
export class MarkerHeadMemo {
  /** Insertion-ordered; a note or a hit moves the key to the end. `null` =
   *  scanned and no marker was there. */
  readonly #heads = new Map<string, MarkerHead | null>()
  readonly #cap: number
  /** How far past the memo a forward walk goes before it scans instead; a
   *  peer rarely lands more than a few markers between two reads. */
  static readonly FORWARD_WALK = 32

  constructor(cap = 4096) { this.#cap = Math.max(1, cap) }

  /** What the memo holds for `key`, without touching the directory.
   *  `undefined` = never scanned; `null` = scanned and empty. */
  peek = (key: string): MarkerHead | null | undefined => this.#heads.get(key)

  /** This tab wrote `head` under `key`, or learned it from a scan. */
  note = (key: string, head: MarkerHead | null): void => {
    this.#heads.delete(key)
    this.#heads.set(key, head)
    while (this.#heads.size > this.#cap) {
      const oldest = this.#heads.keys().next().value
      if (oldest === undefined) break
      this.#heads.delete(oldest)
    }
  }

  /** Markers under `key` were removed or rewritten outside this memo. */
  forget = (key: string): void => { this.#heads.delete(key) }

  /** The head of `bag`, revalidated against the directory with targeted
   *  lookups where the memo holds an answer and a full scan where it does
   *  not. Throws exactly where `latestLayerMarker` throws. */
  head = async (key: string, bag: FileSystemDirectoryHandle): Promise<MarkerHead | null> => {
    const known = this.#heads.get(key)
    if (known !== undefined) {
      try {
        const probed = await this.#probe(bag, known)
        if (probed !== undefined) { this.note(key, probed); return probed }
      } catch { /* the probe could not answer — scan */ }
    }
    const scanned = await latestLayerMarker(bag)
    this.note(key, scanned)
    return scanned
  }

  /** Walk forward from `known`: the first absent name in sequence is the
   *  end and the name before it is the head. `undefined` when the walk ran
   *  past its bound (scan instead). An empty memo probes 00000000. */
  readonly #probe = async (
    bag: FileSystemDirectoryHandle, known: MarkerHead | null,
  ): Promise<MarkerHead | null | undefined> => {
    let index = known ? Number(known.name) : -1
    let latest = known?.name ?? ''
    for (let step = 0; ; step++) {
      const next = markerName(index + 1)
      if (next === null) break                       // at the ceiling: the memo is the max
      if (!(await markerFileExists(bag, next))) break
      if (step >= MarkerHeadMemo.FORWARD_WALK) return undefined
      latest = next
      index += 1
    }
    if (!latest) return null
    if (known && latest === known.name) return known
    return readLayerMarker(bag, latest)
  }
}

/** A caller may supply HistoryService's cached next name; cold writers scan.
 *  The layer bytes must already be stored before this pointer is appended. */
export const writeLayerMarker = async (
  bag: FileSystemDirectoryHandle, layer: string, next?: string,
): Promise<{ name: string; bytes: Uint8Array }> => {
  const current = next ? null : await latestLayerMarker(bag)
  const name = next ?? markerName(current ? Number(current.name) + 1 : 0)
  if (!name || !MARKER.test(name) || (current && name <= current.name)) {
    throw new Error('Location marker sequence is invalid or exhausted')
  }
  const bytes = layerMarkerBytes(layer)
  // A second writer may have claimed this name after our scan. Never replace
  // a marker: it is an immutable revision even when the next commit races.
  // The refusal is NAMED so a writer can tell "another tab got here first —
  // re-read the head and re-apply" apart from a broken write.
  try {
    await bag.getFileHandle(name, { create: false })
    throw Object.assign(new Error(`Location marker ${name} already exists`), { name: 'MarkerExistsError' })
  } catch (error) {
    if ((error as { name?: string })?.name !== 'NotFoundError') throw error
  }
  const handle = await bag.getFileHandle(name, { create: true })
  const writer = await handle.createWritable()
  // KEEP THE WRITE'S OWN ERROR. `finally { close() }` on a write that failed
  // (a full device) threw "Cannot close a ERRORED writable stream" in place of
  // the QuotaExceededError, so no caller could ever say "out of space".
  try {
    await writer.write(bytes.buffer as ArrayBuffer)
    await writer.close()
  } catch (error) {
    try { await writer.abort() } catch { /* already errored */ }
    throw error
  }
  return { name, bytes }
}
