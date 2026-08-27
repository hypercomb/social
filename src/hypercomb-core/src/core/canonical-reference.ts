// core/canonical-reference.ts
//
// THE PORTAL REFERENCE GRAMMAR.
//
// A fixed cell name names exactly one canonical root lineage. Every appearance
// elsewhere points to that root bag. Discovery provenance is intentionally not
// part of identity: retaining an arbitrary route allowed two appearances of
// one named item to drift apart.

export const CANONICAL_REFERENCE_KIND = 'reference'
/** A candidate meaning retained inside the fixed-name root pool. */
export const CANONICAL_VARIANT_KIND = 'canonical:variant'

/** IoC seam implemented by essentials. */
export const CANONICAL_REFERENCE_SERVICE_KEY =
  '@diamondcoreprocessor.com/CanonicalReferenceService'

const SIG_RE = /^[0-9a-f]{64}$/
const BACKSLASH = String.fromCharCode(92)

/** Strip separators/control characters so a fixed name remains one segment. */
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
  name: string
  /** Lineage/bag address of `[name]`, never a content signature. */
  targetSig?: string
  requiredMarks?: readonly string[]
  requiredBouquet?: string
  /** The Portal inventory row edits the root default for future activations. */
  editsRootDefault?: boolean
}

/** Assemble a reference payload in deterministic field order. */
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
  name: string
  /** Immutable layer signature of this candidate meaning. */
  layerSig: string
}

/** Build deterministic membership in the hybrid fixed-name signature bag. */
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
  name: string
  /** Where content was discovered. Null means create an empty root. */
  sourceSegments: readonly string[] | null
  parentSegments: readonly string[]
  requiredMarks?: readonly string[]
  requiredBouquet?: string
  /** Portal inventory/editor row, not an ordinary lineage activation. */
  editsRootDefault?: boolean
}

export interface CanonicalReferenceService {
  ensureRoot(name: string, sourceSegments: readonly string[] | null): Promise<CanonicalRoot | null>
  place(options: PlaceCanonicalReferenceOptions): Promise<string | null>
}
