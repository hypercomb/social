// diamondcoreprocessor.com/history/canonical-layer.ts
//
// THE CANONICAL LAYER FORM — the single source of truth for turning a layer
// into the exact bytes that get hashed into its signature.
//
// Extracted from HistoryService so it stands alone as a PURE function with no
// browser, IoC, or EffectBus dependency. That is a protocol requirement, not a
// tidiness one: a second implementation (Hypercomb.Net) must reproduce these
// bytes exactly, and the conformance vector generator has to be able to import
// this without booting a shell. HistoryService re-exports it as a static so
// every existing caller is unchanged.
//
// Rules:
//   - `name` always present, always first. The layer's only intrinsic.
//   - All other fields are SLOTS (open set; drones plug in via
//     LayerSlotRegistry). They follow `name` in alphabetical order by key for
//     stable byte output regardless of registration / mutation order.
//     Slot-agnostic: `children` is just one slot among many — no special
//     positioning.
//   - Slot values kept as-is (each slot is responsible for its own internal
//     canonical form — sorted arrays, sorted nested keys). Empty arrays, empty
//     objects, undefined and null are dropped to keep the sparse-layer
//     invariant.
//
// Byte form is `JSON.stringify` of the result: no whitespace, keys emitted in
// insertion order (name first, then sorted slots). A conforming implementation
// MUST emit the same separators (`,` / `:` with no spaces) and the same
// JSON string escaping.

/** Canonical layer shape — `name` plus an open set of slots. */
export type CanonicalLayerContent = {
  name: string
  children?: string[]
  [slot: string]: unknown
}

/**
 * Canonicalize a layer so byte-equal content produces byte-equal JSON.
 * Pure and total — never throws, never reads ambient state.
 */
export const canonicalizeLayer = <T extends CanonicalLayerContent>(layer: T): T => {
  const out = { name: layer.name } as T
  const slotKeys = Object.keys(layer).filter(k => k !== 'name').sort()
  for (const key of slotKeys) {
    const v = layer[key]
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
    ;(out as CanonicalLayerContent)[key] = v
  }
  return out
}

/** The exact bytes hashed to produce a layer's signature. */
export const canonicalLayerJson = (layer: CanonicalLayerContent): string =>
  JSON.stringify(canonicalizeLayer(layer))
