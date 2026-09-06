// sharing/adopt-descendants.ts
//
// WHAT THE ADOPT WALK DESCENDS INTO from one fetched layer's bytes.
//
// Since the Life write boundary, a child slot does not hold the child layer's
// signature — it holds a META ENVELOPE, `{meta:1, layer:<sig>, relation:
// 'children', slot}`: the edge the member wears (documentation/life-primitive.md,
// core/life-primitive.ts). The closure walk fetched each envelope, parsed it,
// found no `children` in it and STOPPED — so a published hive localized as
// its root plus fourteen envelopes and not one child layer. The preview
// painted every tile by its hash, and the adopt read "uninspectable" because
// no child could be resolved. The walk has to step THROUGH an envelope to the
// layer it names, exactly as history's own resolver does locally.
//
// One pure function, so the rule is testable without a broker, a store or a
// network: given parsed bytes, which signatures does the walk go to next?

import { isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'

const SIG_RE = /^[a-f0-9]{64}$/

const asSigs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(x => String(x).toLowerCase().trim()).filter(s => SIG_RE.test(s)) : []

export interface AdoptDescendants {
  /** Layers to walk next — the envelope's target, or the child slot. */
  readonly layers: readonly string[]
  /** A resource envelope's target (notes, properties) — a leaf for the
   *  resource phase, never walked as a layer. */
  readonly resources: readonly string[]
}

export const adoptDescendantsOf = (parsed: Record<string, unknown>): AdoptDescendants => {
  if (isMetaEnvelope(parsed)) {
    const payload = metaPayloadOf(parsed)
    if (!payload || !SIG_RE.test(String(payload.sig ?? ''))) return { layers: [], resources: [] }
    const sig = String(payload.sig).toLowerCase()
    return payload.kind === 'layer' ? { layers: [sig], resources: [] } : { layers: [], resources: [sig] }
  }
  // A built module nests under `cells`, an install package under `layers`,
  // a hive branch under `children` — the first slot that holds anything wins.
  const cells = asSigs(parsed['cells'])
  if (cells.length) return { layers: cells, resources: [] }
  const layers = asSigs(parsed['layers'])
  if (layers.length) return { layers, resources: [] }
  return { layers: asSigs(parsed['children']), resources: [] }
}
