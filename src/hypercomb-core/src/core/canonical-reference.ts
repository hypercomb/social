// core/canonical-reference.ts
//
// THE PORTAL REFERENCE GRAMMAR.
//
// A fixed cell name names exactly one canonical root lineage:
//
//   name "people" -> segments ["people"] -> sign(lineageKey(["people"]))
//
// Every appearance of that item elsewhere is a reference to this root bag.
// The source route used to discover/promote the item is intentionally absent
// from the record: provenance is not identity, and retaining an arbitrary deep
// route is what allowed two appearances of one named item to drift apart.
//
// This module lives in core because shell-level Portals and essentials slash
// commands both mint references. The JSON bytes are content identity, so field
// order and omission rules must have one owner.

export const CANONICAL_REFERENCE_KIND = 'reference'
/** A candidate meaning retained inside the fixed-name root pool. The root's
 * history markers still select one current head; these records preserve every
 * other same-name layer as an addressable alternative instead of overwriting
 * it or throwing it away. */
export const CANONICAL_VARIANT_KIND = 'canonical:variant'

/** IoC seam implemented by essentials. Shared can place canonical references
 * without importing a module implementation. */
export const CANONICAL_REFERENCE_SERVICE_KEY =
  '@diamondcoreprocessor.com/CanonicalReferenceService'

const SIG_RE = /^[0-9a-f]{64}$/
const BACKSLASH = String.fromCharCode(92)

/** A fixed name is also a path segment. Strip separators/control characters at
 * every input boundary so the name can never address a different lineage. */
export const canonicalReferenceName = (raw: string): string =>
  [...String(raw ?? '')]
    .filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31)
    .join('')
    .trim()

/** The one route a named item may be referenced through. */
export const canonicalRootSegments = (rawName: string): readonly string[] => {
  const name = canonicalReferenceName(rawName)
  return name ? [name] : []
}

/** Sorted, deduped, blank-free; empty means absent in the payload. */
export const normalizeReferenceMarks = (marks: readonly string[]): string[] =>
  [...new Set(marks.map(m => String(m ?? '').trim()).filter(Boolean))].sort()

export interface CanonicalReferencePayloadOptions {
  /** Fixed item name. It alone derives `targetSegments`. */
  name: string
  /** Lineage/bag address of `[name]`, never a content signature. */
  targetSig?: string
  requiredMarks?: readonly string[]
  requiredBouquet?: string
  /** This appearance is the Portal's default-authoring surface. Its editor
   * writes the canonical root for future activations. Ordinary appearances
   * omit this and keep their own selected variant/details. */
  editsRootDefault?: boolean
}

/** Assemble a reference payload in the one deterministic field order. */
export const buildCanonicalReferencePayload = (
  opts: CanonicalReferencePayloadOptions,
): Record<string, unknown> => {
  const targetSegments = canonicalRootSegments(opts.name)
  const payload: Record<string, unknown> = { targetSegments: [...targetSegments] }
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
  /** Fixed pool/root name. */
  name: string
  /** Immutable layer signature of this candidate meaning. */
  layerSig: string
}

/** Build the deterministic membership record stored in the hybrid `/<name>`
 * signature bag. Provenance is deliberately outside content identity: the
 * same layer discovered through two routes remains one atomic candidate.
 * `refs` makes the candidate's merkle closure explicit to generic sharing and
 * archive walkers. */
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

export interface CanonicalRoot {
  readonly name: string
  readonly segments: readonly string[]
  readonly targetSig: string
}

export interface PlaceCanonicalReferenceOptions {
  /** Fixed identity/root name and leaf name. */
  name: string
  /** Where content was discovered. Null means create a new empty root. */
  sourceSegments: readonly string[] | null
  /** Lineage that receives the reference appearance. */
  parentSegments: readonly string[]
  requiredMarks?: readonly string[]
  requiredBouquet?: string
  /** Portal inventory/editor row, not an ordinary lineage activation. */
  editsRootDefault?: boolean
}

export interface CanonicalReferenceService {
  /** Ensure `/<name>` exists and is present in the hive root complement. */
  ensureRoot(name: string, sourceSegments: readonly string[] | null): Promise<CanonicalRoot | null>
  /** Ensure the root, then place one lineage appearance pointing to it. */
  place(options: PlaceCanonicalReferenceOptions): Promise<string | null>
}
