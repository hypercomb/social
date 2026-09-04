// hypercomb-shared/core/packed-interchange.ts
//
// EXPORT AND RESTORE — the portable interchange form.
//
//   <root>/<sig>            content bytes — layers, resources (flat, sig-named)
//   <root>/<lineageSig>/    lineage sigbags (NNNNNNNN markers, max = head)
//   <root>/<sign(meaning)>/ pools of meaning
//
// This is what makes an internal representation LEGAL rather than merely
// convenient (`documentation/protocol/conformance.md` §7): a store may hold
// records however it likes provided it can emit and ingest this form
// losslessly. The packed store keeps everything in one file, so without this
// it would be a private format with no way out — and a hive that cannot leave
// its store is a hive held hostage.
//
// WHY IT WORKS ON HANDLES, NOT ON THE ENGINE
//
// Both sides are `FileSystemDirectoryHandle`-shaped. That is deliberate: the
// SAME code exports a packed hive, a flat OPFS hive, or the native hive,
// because `native-filesystem.ts` presents all three through one interface.
// There is no packed-specific export path to keep in sync with a flat one.
//
// THE UNTAGGED ROOT
//
// A sig-named directory may be a lineage bag, a pool of meaning, or BOTH —
// for a bare-word meaning the two addresses are byte-identical. So this never
// classifies a DIRECTORY. It classifies each ENTRY: an 8-digit name is a
// marker, anything else is a pool member. A colliding address round-trips
// correctly as both without anyone having to know which it "is".
//
// UNION, NEVER REPLACE
//
// Restore merges rather than overwrites, matching the Rust implementation
// (`hypercomb-client/crates/store/src/interchange.rs`):
//
//   - content     insert if absent (signature-addressed, so dedup is free)
//   - markers     preserve the index; an occupied index is left alone
//   - pool members union by name; identical bytes are not rewritten
//
// Idempotent by construction: restoring the same source twice imports
// nothing the second time, and `Transfer.changed()` stays a truthful answer.

/** The subset of `FileSystemDirectoryHandle` this needs. Keeping it narrow is
 *  what lets the facade, real OPFS, and a test double all satisfy it. */
export interface DirectoryLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>
  entries(): AsyncIterable<[string, { kind: string }]>
}

export interface FileLike {
  getFile(): Promise<{ arrayBuffer?: () => Promise<ArrayBuffer>; size: number }>
  createWritable(): Promise<{ write(data: unknown): Promise<void>; close(): Promise<void> }>
}

/** What a transfer moved. Mirrors the Rust `Transfer` field for field, so the
 *  two implementations report the same shape. */
export interface Transfer {
  content: number
  /** Content whose bytes did not hash to their name — refused, never written. */
  contentRefused: number
  contentSkipped: number
  markers: number
  markersSkipped: number
  poolMembers: number
  poolMembersSkipped: number
}

export const emptyTransfer = (): Transfer => ({
  content: 0, contentRefused: 0, contentSkipped: 0, markers: 0, markersSkipped: 0,
  poolMembers: 0, poolMembersSkipped: 0,
})

/** Did this transfer change anything? A second run over the same source must
 *  answer false. */
export const changed = (transfer: Transfer): boolean =>
  transfer.content > 0 || transfer.markers > 0 || transfer.poolMembers > 0

import { SignatureService } from '@hypercomb/core'

const SIG = /^[0-9a-f]{64}$/i
const MARKER = /^\d{8}$/

/**
 * Bytes out of a file handle, tolerating environments whose `File` has no
 * `arrayBuffer()`.
 *
 * Not hypothetical: jsdom's File lacks it entirely (so every read here
 * silently returned null until this existed), and Safari shipped Blob without
 * it for years. `Response` is the portable way to drain a blob, and the fast
 * path is still used wherever it exists.
 */
const fileBytes = async (
  file: { arrayBuffer?: () => Promise<ArrayBuffer>; size: number },
): Promise<Uint8Array> => {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  // NOT `new Response(file)`: undici does not recognize a jsdom File as a
  // body and stringifies it, so every read came back as the literal bytes of
  // "[object File]" — corruption that looks like success. FileReader is the
  // one drain path that predates Blob.arrayBuffer everywhere it matters.
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsArrayBuffer(file as unknown as Blob)
  })
}

const readBytes = async (dir: DirectoryLike, name: string): Promise<Uint8Array | null> => {
  try {
    return await fileBytes(await (await dir.getFileHandle(name)).getFile())
  } catch { return null }
}

const writeBytes = async (dir: DirectoryLike, name: string, bytes: Uint8Array): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(bytes) } finally { await writable.close() }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const listing = async (dir: DirectoryLike): Promise<Array<[string, string]>> => {
  const out: Array<[string, string]> = []
  for await (const [name, handle] of dir.entries()) out.push([name, handle.kind])
  return out
}

/**
 * Write `source` out in the interchange form.
 *
 * Writes INTO the target; never deletes. Exporting into a directory that
 * already holds a hive unions the two, the same way restore does — so an
 * export is a backup that can be taken repeatedly into one folder.
 */
export const exportInterchange = async (
  source: DirectoryLike,
  target: DirectoryLike,
): Promise<Transfer> => transfer(source, target, 'export')

/**
 * How an OCCUPIED marker index is treated. This is the one place export and
 * restore genuinely disagree, so it is a parameter rather than two copies of
 * the walk:
 *
 *   export  — the target is a backup folder and the source is authoritative,
 *             so differing bytes are written.
 *   restore — the TARGET is the live hive. A marker index already holding
 *             something is history that this import must not rewrite; the
 *             incoming one is skipped. (Rust: `put_marker_at` returns false
 *             on an occupied index rather than replacing it.)
 *
 * Content never differs by definition — it is addressed by its own hash — and
 * pool members union by name in both directions.
 */
type Mode = 'export' | 'restore'

const transfer = async (
  source: DirectoryLike,
  target: DirectoryLike,
  mode: Mode,
): Promise<Transfer> => {
  const moved = emptyTransfer()

  for (const [name, kind] of await listing(source)) {
    if (!SIG.test(name)) continue // not part of the hive

    if (kind === 'file') {
      // Content is immutable and addressed by its hash, so a target that
      // already has this signature already has these exact bytes.
      const existing = await readBytes(target, name)
      if (existing) { moved.contentSkipped++; continue }
      const bytes = await readBytes(source, name)
      if (!bytes) continue
      // THE NAME IS THE HASH, OR NOTHING IS WRITTEN. The name was lifted from
      // the SOURCE listing — a folder on a disk, a peer's export — and until
      // this line nothing had checked that the bytes under it are the bytes it
      // claims. A restore that trusted the listing put a stranger's bytes
      // into the live hive under a signature this client never verified: the
      // same gap writeLayerBytes was closed for (write-conformance check 1,
      // found by the census adjudication). Refused, counted, never written.
      const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      if ((await SignatureService.sign(exact)).toLowerCase() !== name.toLowerCase()) {
        moved.contentRefused++
        continue
      }
      await writeBytes(target, name, bytes)
      moved.content++
      continue
    }

    // A sig-named directory: a bag, a pool, or both. Classify the ENTRIES.
    const from = await source.getDirectoryHandle(name)
    const to = await target.getDirectoryHandle(name, { create: true })
    for (const [entry, entryKind] of await listing(from)) {
      if (entryKind === 'directory') {
        // A document-pool sub-bucket. One level, per the layout.
        const subFrom = await from.getDirectoryHandle(entry)
        const subTo = await to.getDirectoryHandle(entry, { create: true })
        for (const [leaf, leafKind] of await listing(subFrom)) {
          if (leafKind !== 'file') continue
          const bytes = await readBytes(subFrom, leaf)
          if (!bytes) continue
          const existing = await readBytes(subTo, leaf)
          if (existing && sameBytes(existing, bytes)) { moved.poolMembersSkipped++; continue }
          await writeBytes(subTo, leaf, bytes)
          moved.poolMembers++
        }
        continue
      }

      const bytes = await readBytes(from, entry)
      if (!bytes) continue
      const existing = await readBytes(to, entry)
      const isMarker = MARKER.test(entry)

      if (existing) {
        if (sameBytes(existing, bytes)) {
          // Already identical — a no-op either way, and reporting it as a
          // change would make `changed()` lie about a second run.
          if (isMarker) moved.markersSkipped++
          else moved.poolMembersSkipped++
          continue
        }
        if (isMarker && mode === 'restore') {
          // An occupied index in the LIVE hive. That marker is history; an
          // import must not rewrite it. Preserve, count as skipped.
          moved.markersSkipped++
          continue
        }
      }

      await writeBytes(to, entry, bytes)
      if (isMarker) moved.markers++
      else moved.poolMembers++
    }
  }

  return moved
}

/**
 * Ingest a directory in the interchange form.
 *
 * Unrecognized files and directories are IGNORED rather than treated as
 * errors — a hive folder may reasonably contain a README, and refusing the
 * whole restore over one stray file would be worse than skipping it.
 */
export const restoreInterchange = async (
  source: DirectoryLike,
  target: DirectoryLike,
): Promise<Transfer> => transfer(source, target, 'restore')
