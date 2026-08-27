// diamondcoreprocessor.com/history/meta-record.ts
//
// The META RECORD — a slot entry that says more about what it points at.
//
// ── The promotion model ───────────────────────────────────────────────
//
// A slot entry is a 64-hex signature. Normally that signature IS the
// content: an anonymous fact, no speaker. When a participant or an agent
// needs to say something ABOUT that content — who attached it, to whom,
// as what relation — the entry is PROMOTED: it becomes the signature of a
// meta record which POINTS AT the same content.
//
//     notes: [noteSig, metaSig, noteSig]      ← all three legal, today
//
// Bare is the degenerate case, so there is no migration and no dual-read
// era: promoted and unpromoted entries live in the same array, and a tile
// nobody ever said anything about never grows a byte.
//
// ── Why the meta POINTS AT content instead of wrapping it ─────────────
//
// Wrapping would put `agent` and `at` inside the hashed bytes of the
// content, so the same note written by two agents would produce two
// addresses and deduplication would die at the wrapper. Pointing keeps
// the split that makes the whole system work:
//
//     BYTES ARE ANONYMOUS AND SHARED.  META IS SPECIFIC AND OWNED.
//
// Two agents leaving the same note is ONE content record and TWO metas —
// which is exactly right, because the content was the same and the acts
// were not.
//
// ── Self-declaring, never sniffed ─────────────────────────────────────
//
// A slot entry is 64 hex whether it addresses content or a meta, so
// resolution must not guess. A meta declares itself with `meta: 1` and
// names its target in `layer`. Nothing infers metaness from shape — a
// resource can be JSON too.
//
// ── The one invariant, at three call sites ────────────────────────────
//
// An entry's IDENTITY is its target. Every traversal must resolve through
// the meta rather than stopping at it:
//
//   1. THE DIFFER — or promotion reads as "removed X, added Y", so the
//      first time an agent touches anything the trail fabricates a
//      delete-and-add for content that never changed. (`identityOf`,
//      consumed by layer-diff.)
//   2. THE LIVENESS TEST — or `child-sig-guard`'s cold-mint preserve
//      treats a promoted entry as a husk and reverts it. (A meta carries
//      a non-empty `layer`, so `isBareLayer` already reads it as live;
//      meta-record.spec locks that in rather than trusting it.)
//   3. THE SEAL WALK — or the commitment silently loses every subtree
//      below a promoted entry, and a seal that omits is worse than no
//      seal because it looks complete.
//
// ── What a hash does and does not prove ───────────────────────────────
//
// `sign()` authenticates BYTES, not CLAIMS. A meta asserting
// `agent: <someone>` hashes perfectly while being a lie, so `agent` is
// only as trustworthy as whoever could write the record. Locally that
// needs already-compromised code and is not the threat model; records
// arriving from another participant are a different matter and get
// checked at the boundary — never here. This module is pure: it decides
// shape and identity, and asserts nothing about trust.

/** A promoted slot entry: says something about the content it points at. */
export type MetaRecord = {
  /** Self-declaration. Present and truthy on every meta record. */
  meta: 1
  /** The target this record speaks about — a content/layer signature. */
  layer: string
  /** Participant signature of who attached it. A claim, not a proof. */
  agent?: string
  /** Participant signatures this was addressed to. Empty/absent = unaddressed. */
  recipients?: string[]
  /** How the parent holds the target — declared here so the field name
   *  on the parent is a convenience index, not the only place the
   *  meaning lives. Without this a new concern needs a registered slot,
   *  which is the code-change-to-classify trap. */
  relation?: string
  /** Wall-clock ms from whoever wrote it. Orders bags against each other;
   *  across participants it is for READING, never for deciding. */
  at?: number
  [field: string]: unknown
}

const SIG = /^[0-9a-f]{64}$/

/**
 * True when a value is a self-declared meta record.
 *
 * Declaration only — never shape-sniffing. A record without `meta: 1` is
 * content even if it happens to carry a `layer` field, because a resource
 * is allowed to be JSON with any keys it likes.
 */
export const isMetaRecord = (value: unknown): value is MetaRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record['meta'] === 1 && typeof record['layer'] === 'string' && SIG.test(record['layer'] as string)
}

/**
 * The identity a slot entry stands for — its target when promoted, itself
 * when bare.
 *
 * `resolved` supplies meta records the caller already fetched. Only
 * entries whose signatures DIFFER between two layers ever need resolving,
 * so the cost is O(changes), not O(size): identical entries are skipped
 * without a fetch and the merkle economy survives. An unresolved entry
 * falls back to itself, which degrades to today's behaviour rather than
 * throwing.
 */
export const identityOf = (
  entry: string,
  resolved?: ReadonlyMap<string, MetaRecord | null | undefined>,
): string => {
  const record = resolved?.get(entry)
  return isMetaRecord(record) ? record.layer : entry
}

/**
 * Signatures that must be fetched before two entry lists can be compared
 * on identity — the union of both sides minus what they already share.
 *
 * Entries present on BOTH sides are byte-identical by definition (the
 * signature is the hash), so they cannot have been promoted between the
 * two snapshots and never need resolving.
 */
export const entriesNeedingResolution = (
  prev: readonly string[],
  next: readonly string[],
): string[] => {
  const shared = new Set(prev.filter(entry => next.includes(entry)))
  const out = new Set<string>()
  for (const entry of [...prev, ...next]) {
    if (!shared.has(entry) && SIG.test(entry)) out.add(entry)
  }
  return [...out]
}

/**
 * Mint a meta record for `layer`. Field order is fixed so canonical bytes
 * are deterministic — two participants promoting the same target with the
 * same claims must produce the same signature, or dedup silently dies.
 * Absent optionals are omitted rather than written as null, for the same
 * reason (`canonicalizeLayer` drops empties; this matches it).
 */
export const mintMetaRecord = (fields: {
  layer: string
  agent?: string
  recipients?: readonly string[]
  relation?: string
  at?: number
}): MetaRecord => {
  if (!SIG.test(fields.layer)) throw new Error(`meta-record: target is not a signature: ${fields.layer}`)
  const record: MetaRecord = { meta: 1, layer: fields.layer }
  if (fields.relation) record.relation = fields.relation
  if (fields.agent) record.agent = fields.agent
  if (fields.recipients && fields.recipients.length > 0) record.recipients = [...fields.recipients]
  if (typeof fields.at === 'number') record.at = fields.at
  return record
}
