// core/canonical-reference.ts
//
// THE PORTAL REFERENCE GRAMMAR.
//
// A reference points at the SAME thing no matter how you arrived at it. Its
// payload carries the target twice, because two questions are asked of it:
//
//   targetSegments  the ROUTE — where the item was discovered, re-walked live
//                   so the reference lands on the target's current head.
//   targetSig       the IDENTITY — the target's MOLECULE address,
//                   `sign(fold(canon(name)))` (molecule-address.ts). A bag at
//                   the OPFS root that no hive has to list. Never a content
//                   hash: that would freeze the reference into a copy.
//
// Dual-read, per documentation/hypergraph-molecule-lineage.md step 2: the
// molecule first, the route as the fallback while the molecule write path
// lands. Nothing about a reference moves, copies or promotes its target — the
// root hive is one hive among hives, and the OPFS root is a STORE, not a
// collection (documentation/reference-designer.md, section 4).

export const CANONICAL_REFERENCE_KIND = 'reference'
/** A candidate meaning retained inside the fixed-name variants pool. */
export const CANONICAL_VARIANT_KIND = 'canonical:variant'

/** IoC seam implemented by essentials. */
export const CANONICAL_REFERENCE_SERVICE_KEY =
  '@diamondcoreprocessor.com/CanonicalReferenceService'

const SIG_RE = /^[0-9a-f]{64}$/
const BACKSLASH = String.fromCharCode(92)

/** Strip separators/control characters so a name remains one segment. */
export const canonicalReferenceName = (raw: string): string =>
  [...String(raw ?? '')]
    .filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31)
    .join('')
    .trim()

/** A route, every step made one safe segment; blanks dropped. */
export const canonicalReferenceRoute = (segments: readonly unknown[]): string[] =>
  segments.map(segment => canonicalReferenceName(String(segment ?? ''))).filter(Boolean)

/**
 * The one route a named item may be referenced through.
 *
 * Superseded by `canonicalReferenceRoute`, and kept because core's export
 * surface is a PROTOCOL: packages published while this name existed import it,
 * and a participant already carrying one of those packages loses the whole
 * namespace — "does not provide an export named 'canonicalRootSegments'" —
 * the moment a shell ships a core without it. Older versions keep working.
 */
export const canonicalRootSegments = (rawName: string): readonly string[] =>
  canonicalReferenceRoute([rawName])

/** Sorted, deduped, blank-free; empty means absent in the payload. */
export const normalizeReferenceMarks = (marks: readonly string[]): string[] =>
  [...new Set(marks.map(m => String(m ?? '').trim()).filter(Boolean))].sort()

export interface CanonicalReferencePayloadOptions {
  /** The route to the target — where it lives, never a copy of it. */
  targetSegments: readonly string[]
  /** Molecule address of the target's name, never a content signature. */
  targetSig?: string
  requiredMarks?: readonly string[]
  requiredBouquet?: string
  /** This appearance is the Portal's default-authoring surface. Its editor
   * writes the target itself for future activations. Ordinary appearances
   * omit this and keep their own selected variant/details. */
  editsRootDefault?: boolean
}

/** Assemble a reference payload in deterministic field order. */
export const buildCanonicalReferencePayload = (
  opts: CanonicalReferencePayloadOptions,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    targetSegments: canonicalReferenceRoute(opts.targetSegments ?? []),
  }
  if (opts.targetSig && SIG_RE.test(opts.targetSig)) payload['targetSig'] = opts.targetSig
  const marks = normalizeReferenceMarks(opts.requiredMarks ?? [])
  if (marks.length > 0) payload['requiredMarks'] = marks
  if (opts.requiredBouquet && SIG_RE.test(opts.requiredBouquet)) {
    payload['requiredBouquet'] = opts.requiredBouquet
  }
  if (opts.editsRootDefault === true) payload['editsRootDefault'] = true
  return payload
}

/** Assemble the complete content-addressed reference decoration record. */
export const buildCanonicalReferenceRecord = (
  opts: CanonicalReferencePayloadOptions,
): Record<string, unknown> => {
  const payload = buildCanonicalReferencePayload(opts)
  const refs = typeof payload['requiredBouquet'] === 'string' ? [payload['requiredBouquet']] : []
  return {
    kind: CANONICAL_REFERENCE_KIND,
    appliesTo: [],
    payload,
    ...(refs.length ? { refs } : {}),
  }
}

export interface CanonicalVariantRecordOptions {
  name: string
  /** Immutable layer signature of this candidate meaning. */
  layerSig: string
}

/** Build deterministic membership in the fixed-name variants bucket. */
export const buildCanonicalVariantRecord = (
  opts: CanonicalVariantRecordOptions,
): Record<string, unknown> | null => {
  const name = canonicalReferenceName(opts.name)
  if (!name || !SIG_RE.test(opts.layerSig)) return null
  return {
    kind: CANONICAL_VARIANT_KIND,
    name,
    payload: { layerSig: opts.layerSig },
    refs: [opts.layerSig],
  }
}

export interface PlaceCanonicalReferenceOptions {
  /** The reference tile's own name under `parentSegments`. */
  name: string
  /** Where the target lives. The reference points HERE; nothing is copied. */
  sourceSegments: readonly string[]
  parentSegments: readonly string[]
  requiredMarks?: readonly string[]
  requiredBouquet?: string
  /** Portal inventory/editor row, not an ordinary lineage activation. */
  editsRootDefault?: boolean
}

export interface CanonicalReferenceService {
  place(options: PlaceCanonicalReferenceOptions): Promise<string | null>
}
