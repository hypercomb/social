import { SignatureService, type Signature } from './core/signature.service.js'

/**
 * Layer v2 — the core primitive.
 *
 * Each field is a content-addressed signature pointing to a resource.
 * The hierarchy IS the history: parent = previous state, derivable
 * from lineage by removing the last segment.
 */
export type LayerV2 = {
  v: 2
  lineage: Signature
  bees: Signature
  deps: Signature
  resources: Signature
  children: Signature
}

/** Ordered fields for canonical JSON (deterministic signing). */
const LAYER_FIELDS = ['v', 'lineage', 'bees', 'deps', 'resources', 'children'] as const

// ── helpers ──

function toBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

// ── layer signing ──

/**
 * Canonical JSON for a layer — fields in deterministic order.
 */
export function layerCanonical(layer: LayerV2): string {
  const ordered: Record<string, unknown> = {}
  for (const key of LAYER_FIELDS) ordered[key] = layer[key]
  return JSON.stringify(ordered)
}

/**
 * Sign a layer, returning its content-addressed signature.
 */
export async function signLayer(layer: LayerV2): Promise<Signature> {
  return SignatureService.sign(toBuffer(layerCanonical(layer)))
}

// ── lineage ──

/**
 * Compute the signature for a lineage (ordered path segments).
 *
 *   computeLineageSig([])                    → sig of '[]'
 *   computeLineageSig(['cigars'])            → sig of '["cigars"]'
 *   computeLineageSig(['cigars', 'cohiba'])  → sig of '["cigars","cohiba"]'
 */
export async function computeLineageSig(segments: string[]): Promise<Signature> {
  return SignatureService.sign(toBuffer(JSON.stringify(segments)))
}

/**
 * Compute the parent lineage signature (one segment shorter).
 * Returns the root lineage sig when given a single-segment lineage.
 */
export async function computeParentLineageSig(segments: string[]): Promise<Signature> {
  return computeLineageSig(segments.slice(0, -1))
}

// ── list resources ──

/**
 * Compute the signature for a sorted list of signatures.
 *
 * 1. Sort alphabetically
 * 2. Join with '\n'
 * 3. Sign the result
 *
 * Empty list → sig of ''.
 * Identical sets across layers share the same signature.
 */
export async function computeListSig(sigs: string[]): Promise<Signature> {
  const sorted = [...sigs].sort()
  const content = sorted.join('\n')
  return SignatureService.sign(toBuffer(content))
}

/**
 * Produce the canonical content of a list resource (for storage).
 * Sorted alphabetically, joined with newlines.
 */
export function listResourceContent(sigs: string[]): string {
  return [...sigs].sort().join('\n')
}

/**
 * Parse a list resource back into an array of signatures.
 */
export function parseListResource(content: string): string[] {
  if (content === '') return []
  return content.split('\n')
}
