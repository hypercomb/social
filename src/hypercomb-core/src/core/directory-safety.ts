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

// ---------------------------------------------------------------------------
// THE MARKER CEILING
// ---------------------------------------------------------------------------
//
// A marker name is EXACTLY eight digits. `String(100000000).padStart(8, '0')`
// is a no-op — it yields a NINE-digit name that `MARKER_NAME` then rejects
// forever, so the marker is written but invisible to every reader, and the
// next mint re-reads it, adds one, and stays out of range. There is no repair
// path short of renaming on disk. Make it inexpressible rather than merely
// guarded: every minting site goes through `markerName`, which refuses.

/** The largest index an 8-digit marker name can carry. */
export const MARKER_CEILING = 99_999_999

/** The marker name for `index`, or `null` when it cannot be one — negative,
 *  non-integer, or past `MARKER_CEILING`. A caller that gets `null` must
 *  refuse to write, never pad-and-hope. */
export const markerName = (index: number): string | null => {
  if (!Number.isSafeInteger(index) || index < 0 || index > MARKER_CEILING) return null
  return String(index).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// DOCUMENT-POOL SWEEPS
// ---------------------------------------------------------------------------
//
// A "one current document" pool holds exactly one member: writing a new
// document drops the old one. That sweep is correct there and CATASTROPHIC at
// a molecule address, where the succession atoms and gathered members are
// exactly the same shape — 64-hex FILES. `kind === 'file'` is not a shape
// guard.
//
// Two independent conditions must agree before a byte is unlinked:
//
//   1. THE ADDRESS IS PROVABLY THE CALLER'S. Positive proof, never a caller's
//      assertion: either a `subKey` sub-bucket (a molecule address only ever
//      exists at the ROOT, so one level down is space this caller minted), or
//      a colon-carrying meaning (`lineageKey` folds every non-letter/digit to
//      `-`, so no tile name reaches it). A bare word — or a meaning no
//      registry has heard of — is NOT proof, and the sweep does not run. The
//      registry is consulted only to GRANT permission, never to deny it.
//
//   2. THE STRUCTURE AGREES. `documentSweepVeto` refuses the WHOLE sweep on
//      ANY marker, ANY author bucket, ANY foreign name.
//
// Neither alone may destroy anything. And deleting is never REQUIRED for
// correctness: `getPoolDoc` returns the first non-empty member, so a refused
// sweep costs a stale read, while proceeding costs another participant's
// molecule irreversibly. Every refusal carries its reason.

/**
 * Why a document sweep must NOT run here — or `null` when every entry is a
 * member FILE (or the directory is empty). Stricter than `hardDeleteVeto`:
 * markers veto too, because a marker is positive proof that someone's lineage
 * lives at this address.
 */
export const documentSweepVeto = (entries: Iterable<DirectoryEntry>): string | null => {
  let markers = 0
  let buckets = 0
  const foreign: string[] = []
  for (const entry of entries) {
    switch (classifyDirectoryEntry(entry?.name ?? '', entry?.isDirectory === true)) {
      case 'marker': markers++; break
      case 'bucket': buckets++; break
      case 'member': break
      default: foreign.push(String(entry?.name ?? '')); break
    }
  }
  if (markers === 0 && buckets === 0 && foreign.length === 0) return null
  const held: string[] = []
  if (markers > 0) held.push(`${markers} lineage marker${markers === 1 ? '' : 's'}`)
  if (buckets > 0) held.push(`${buckets} author bucket${buckets === 1 ? '' : 's'}`)
  if (foreign.length > 0) held.push(`${foreign.length} unrecognised entr${foreign.length === 1 ? 'y' : 'ies'} (${foreign.slice(0, 3).join(', ')})`)
  return `holds ${held.join(' + ')} — it is not this caller's document space`
}

/** Enumerate a handle into entries, or return the REASON it could not be
 *  read. Shared by every fail-closed reader in this module. */
const readDirectoryEntries = async (
  directory: {
    entries?: () => AsyncIterable<[string, { kind?: string }]>
    keys?: () => AsyncIterable<string>
  } | null | undefined,
): Promise<DirectoryEntry[] | string> => {
  if (!directory) return 'the directory handle is missing'
  const found: DirectoryEntry[] = []
  try {
    if (typeof directory.entries === 'function') {
      for await (const [name, handle] of directory.entries()) {
        found.push({ name, isDirectory: handle?.kind === 'directory' })
      }
    } else if (typeof directory.keys === 'function') {
      for await (const name of directory.keys()) found.push({ name })
    } else {
      return 'the directory cannot be enumerated'
    }
  } catch (err) {
    return `the directory could not be read (${String((err as Error)?.message ?? err)})`
  }
  return found
}

/** Read a handle and return the document-sweep veto. Fails CLOSED. */
export const documentSweepVetoFor = async (
  directory: {
    entries?: () => AsyncIterable<[string, { kind?: string }]>
    keys?: () => AsyncIterable<string>
  } | null | undefined,
): Promise<string | null> => {
  const found = await readDirectoryEntries(directory)
  if (typeof found === 'string') return found
  return documentSweepVeto(found)
}

// ---------------------------------------------------------------------------
// NAMED-SET REMOVAL
// ---------------------------------------------------------------------------
//
// The caller names what IT minted; each name is classified individually. A
// manifest may only ever NARROW a removal set, never widen it: the removal
// set is always `caller-minted names ∩ member-shaped entries`. A half-synced
// replica normally holds members whose manifest has not arrived yet — a
// widening manifest would delete exactly what it just replicated.
//
// The plan is refused WHOLE, never partially: a partial sweep leaves a
// directory in a state nobody designed.

/** What a named removal may do here. `refused` non-null means remove nothing. */
export interface SweepPlan {
  remove: string[]
  refused: string | null
}

/**
 * Plan the removal of `own` from `entries`.
 *
 * Refuses the whole plan when the directory holds ANY marker (positive proof
 * someone's lineage lives here), or when a name the caller asked to remove is
 * an author bucket. Otherwise removes only the entries that are both named by
 * the caller AND present.
 */
export const planNamedRemoval = (
  entries: Iterable<DirectoryEntry>,
  own: Iterable<string>,
): SweepPlan => {
  const owned = new Set<string>()
  for (const name of own) owned.add(String(name ?? ''))
  const present: DirectoryEntry[] = []
  for (const entry of entries) present.push({ name: String(entry?.name ?? ''), isDirectory: entry?.isDirectory === true })

  const markers = present.filter(e => classifyDirectoryEntry(e.name, e.isDirectory) === 'marker')
  if (markers.length > 0) {
    return { remove: [], refused: `holds ${markers.length} lineage marker${markers.length === 1 ? '' : 's'} — a lineage lives at this address` }
  }

  const remove: string[] = []
  for (const entry of present) {
    if (!owned.has(entry.name)) continue
    if (classifyDirectoryEntry(entry.name, entry.isDirectory) === 'bucket') {
      return { remove: [], refused: `the plan names ${entry.name.slice(0, 8)}…, which is an author bucket` }
    }
    remove.push(entry.name)
  }
  return { remove, refused: null }
}

/** Read a handle and plan a named removal. Fails CLOSED. */
export const planNamedRemovalFor = async (
  directory: {
    entries?: () => AsyncIterable<[string, { kind?: string }]>
    keys?: () => AsyncIterable<string>
  } | null | undefined,
  own: Iterable<string>,
): Promise<SweepPlan> => {
  const found = await readDirectoryEntries(directory)
  if (typeof found === 'string') return { remove: [], refused: found }
  return planNamedRemoval(found, own)
}
