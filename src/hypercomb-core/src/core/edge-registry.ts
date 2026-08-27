// core/edge-registry.ts
//
// THE EDGE REGISTRY — which fields of a signature-bearing record are EDGES
// (dependencies whose bytes must travel) and which are REFERENTS (addresses
// or identities with no bytes behind them, which must never be fetched).
//
// WHY THIS EXISTS. Everything that computes reachability — the share/adopt
// closures, host-sync push, package publish — must agree with every writer
// about which sig-shaped values are edges. The two failure directions are
// asymmetric and both have happened:
//
//   - Treating a REFERENT as an edge sends every closure walker on a
//     permanent 404 cascade across all byte hosts (the `groupSig` lesson:
//     a group signature is sha256('group:'+meaning) — pure identity, no
//     bytes exist behind it anywhere, by construction).
//   - Missing a real edge leaves referenced bytes out of a bundle: content
//     that 404s on a fresh adopter, or worse — a precise sweeper deleting
//     live data. (GC deliberately over-approximates — any 64-hex string
//     counts — so GC is immune; the PRECISE walkers are the exposure.)
//
// That knowledge was hardcoded per-walker (decoration-closure skipped
// `groupSig`/`targetSig` inline). This registry is the one declaration both
// directions consult, in the same spirit as the pool registry: ask the
// registry, never keep a local list. A doctrine ratchet in doctrine.spec.ts
// forbids new inline referent-field comparisons.
//
// THE LIFE PRIMITIVE (documentation/life-primitive.md): every new reference is
// a meta signature. Exactly one typed payload key (`layer`, `resource`,
// `dependency`, or `bee`) is the envelope's content hop. A Life Layer's named
// refs are meta edges; its `children` is the only collection. `content` and
// `refs` remain during the legacy drain. Any new legacy dependency field is
// still a protocol decision and must be added here.

/**
 * Fields whose signature values are DEPENDENCIES — bytes that must travel
 * in any closure that carries the record. Frozen: extending this list is a
 * protocol-level decision (every walker and the native client must agree),
 * never a per-feature convenience.
 *
 *   - `layer`    — a meta envelope's growable layer payload.
 *   - `resource` — a meta envelope's raw resource-byte payload.
 *   - `dependency` — a meta envelope's raw module/dependency payload.
 *   - `bee`      — a meta envelope's raw behavior payload.
 *   - `children` — a node's ordered composition (meta signatures).
 *   - `content`  — a node's content hop (the meta-resource envelope, the
 *     generic node's "what this node says" slot).
 *   - `refs`     — a decoration record's self-declared flat closure.
 */
export const EDGE_FIELDS: readonly string[] = Object.freeze([
  'layer',
  'resource',
  'dependency',
  'bee',
  'children',
  'content',
  'refs',
])

/**
 * Sig-shaped fields that are REFERENTS — an address or identity a record
 * points AT, never bytes it owns. A closure carries dependencies, not
 * referents; fetching one 404s forever on every byte host.
 *
 *   - `groupSig`  — a group signature, sha256('group:'+meaning): pure
 *     identity, no bytes behind it by construction (core/group-signature.ts).
 *   - `targetSig` — a reference's LINEAGE address (a bag, not content) or a
 *     retire-pointer at a feedback item: in every use, a pointer at a
 *     referent.
 *
 * May grow as new referent fields are minted — adding here is how a new
 * pointer field opts out of every precise walker at once.
 */
export const REFERENT_FIELDS: readonly string[] = Object.freeze([
  'groupSig',
  'targetSig',
])

const edgeSet: ReadonlySet<string> = new Set(EDGE_FIELDS)
const referentSet: ReadonlySet<string> = new Set(REFERENT_FIELDS)

/** Is `field` a dependency-carrying edge field of the uniform node model? */
export const isEdgeField = (field: string): boolean => edgeSet.has(field)

/** Is `field` a known referent field — sig-shaped but never bytes to carry?
 *  Precise closure walkers must skip these; treating one as an edge is the
 *  permanent-404 bug class. */
export const isReferentField = (field: string): boolean => referentSet.has(field)

const SIG_RE = /^[0-9a-f]{64}$/i

/**
 * The signatures a record's EDGE FIELDS declare, shallow — the sigs found
 * directly in `children` / `content` / `refs` at the record's top level.
 * Lowercased, deduped. This is the uniform-node walk: precise walkers that
 * adopt the node model can use it as-is; walkers with historical per-kind
 * hops (decoration-closure) layer those on top.
 */
export const edgeSigsOf = (record: Record<string, unknown>): string[] => {
  const out = new Set<string>()
  for (const field of EDGE_FIELDS) {
    const value = record[field]
    if (typeof value === 'string') {
      if (SIG_RE.test(value)) out.add(value.toLowerCase())
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && SIG_RE.test(item)) out.add(item.toLowerCase())
      }
    }
  }
  return [...out]
}
