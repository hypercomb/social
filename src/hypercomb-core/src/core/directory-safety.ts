// core/directory-safety.ts
//
// THE ENTRY DECIDES, NEVER THE DIRECTORY.
//
// The OPFS root is an untagged union of sig-named directories. One address can
// be a lineage BAG (8-digit markers), a POOL of meaning (sig-named members), a
// MOLECULE (per-author head buckets — `documentation/hypergraph-molecule-
// lineage.md`), or SEVERAL AT ONCE: for a bare-word meaning the bag address and
// the pool address are byte-identical, and that coincidence is the design, not
// a hazard.
//
// So a walker may never ask "what KIND of directory is this?" — there is no
// answer. `hypercomb-runtime/src/native-filesystem.ts` already states the rule
// the shim has always used: it classifies each ENTRY — an 8-digit name is a
// marker, anything else is a member. This module makes that rule a primitive
// so every prune, sweep, flatten and GC path can share it.
//
// WHY IT EXISTS. `/flatten` once HARD DELETED a whole pool because it resolved
// a bare-word location to an address that was also a pool, and recursively
// removed it. The fix that shipped was a REGISTRY lookup (`isPoolAddress`) —
// which works only for meanings some module happened to register. Under the
// molecule model the dangerous case is precisely the one no registry knows:
// `sign('people')` is an ordinary tile's address AND the shared molecule
// holding other participants' head buckets. A registry can never enumerate it,
// because any participant on any host may mint one by typing a word.
//
// THE RULE, STATED ONCE:
//
//   A sig-named directory may be hard-deleted ONLY IF every entry in it is a
//   marker. One member file, one author bucket, one unrecognised name — and
//   the directory is shared with something the deleter did not come for.
//
// This is strictly stronger than the registry guard and subsumes it: a
// registered pool holds members, so it fails the test without being looked up.
// An empty directory passes (there is nothing to lose), and a pure lineage bag
// passes (markers are the deleter's own history, which is what they asked to
// remove).
//
// Deleting a single ENTRY stays legal and is unaffected — removing one marker,
// one member, or one bucket you own is an ordinary write. What this module
// forbids is the recursive removal of a container whose contents you cannot
// prove are all yours.

/** An 8-digit lineage marker: `00000000`, `00000001`, … The max marker in a
 *  bag IS its head. */
export const MARKER_NAME = /^\d{8}$/

/** A 64-hex signature — a content atom, a pool member, or an author bucket. */
export const SIGNATURE_NAME = /^[0-9a-f]{64}$/i

/** What one entry of a sig-named directory is, decided by its NAME and kind —
 *  never by the directory that holds it.
 *
 *  - `marker`  — an 8-digit file: one revision of a lineage.
 *  - `member`  — a sig-named FILE: a pool member or content atom.
 *  - `bucket`  — a sig-named DIRECTORY: a per-author head bucket, or a nested
 *    pool. Always someone's writable space.
 *  - `foreign` — anything else. Unknown provenance; treat as not yours. */
export type DirectoryEntryKind = 'marker' | 'member' | 'bucket' | 'foreign'

/** Classify one entry. `isDirectory` distinguishes a member file from an
 *  author bucket — the two are both sig-named and mean different things. */
export const classifyDirectoryEntry = (
  name: string,
  isDirectory = false,
): DirectoryEntryKind => {
  const entry = String(name ?? '')
  if (MARKER_NAME.test(entry)) return 'marker'
  if (SIGNATURE_NAME.test(entry)) return isDirectory ? 'bucket' : 'member'
  return 'foreign'
}

/** One entry as a walker sees it: the two facts classification needs. */
export interface DirectoryEntry {
  name: string
  isDirectory?: boolean
}

/**
 * Why this directory must NOT be hard-deleted — or `null` when removal is
 * safe. A reason string is returned rather than a bare boolean so the refusal
 * can be logged with the thing it protected; a silent `false` is how the
 * original incident stayed invisible.
 *
 * Safe: empty, or every entry is a marker.
 * Refused: any member, bucket, or foreign entry.
 */
export const hardDeleteVeto = (entries: Iterable<DirectoryEntry>): string | null => {
  let markers = 0
  let members = 0
  let buckets = 0
  const foreign: string[] = []
  for (const entry of entries) {
    switch (classifyDirectoryEntry(entry?.name ?? '', entry?.isDirectory === true)) {
      case 'marker': markers++; break
      case 'member': members++; break
      case 'bucket': buckets++; break
      default: foreign.push(String(entry?.name ?? '')); break
    }
  }
  if (members === 0 && buckets === 0 && foreign.length === 0) return null
  const held: string[] = []
  if (members > 0) held.push(`${members} member file${members === 1 ? '' : 's'}`)
  if (buckets > 0) held.push(`${buckets} author bucket${buckets === 1 ? '' : 's'}`)
  if (foreign.length > 0) held.push(`${foreign.length} unrecognised entr${foreign.length === 1 ? 'y' : 'ies'} (${foreign.slice(0, 3).join(', ')})`)
  return `holds ${held.join(' + ')}${markers > 0 ? ` alongside ${markers} marker${markers === 1 ? '' : 's'}` : ''} — it is shared`
}

/** May this directory be removed recursively? Sugar over `hardDeleteVeto`;
 *  prefer the veto itself where the reason can be surfaced to the user. */
export const mayHardDelete = (entries: Iterable<DirectoryEntry>): boolean =>
  hardDeleteVeto(entries) === null

/**
 * Read a directory handle's entries and return the veto (or `null`).
 *
 * Fails CLOSED: if the directory cannot be enumerated, removal is refused.
 * A walker that cannot see what it is about to destroy has no business
 * destroying it.
 */
export const hardDeleteVetoFor = async (
  directory: {
    entries?: () => AsyncIterable<[string, { kind?: string }]>
    keys?: () => AsyncIterable<string>
  } | null | undefined,
): Promise<string | null> => {
  if (!directory) return 'the directory handle is missing'
  const found: DirectoryEntry[] = []
  try {
    if (typeof directory.entries === 'function') {
      for await (const [name, handle] of directory.entries()) {
        found.push({ name, isDirectory: handle?.kind === 'directory' })
      }
    } else if (typeof directory.keys === 'function') {
      // No kind available: a sig-named entry could be a member OR a bucket.
      // Either one vetoes, so the distinction does not change the answer.
      for await (const name of directory.keys()) found.push({ name })
    } else {
      return 'the directory cannot be enumerated'
    }
  } catch (err) {
    return `the directory could not be read (${String((err as Error)?.message ?? err)})`
  }
  return hardDeleteVeto(found)
}
