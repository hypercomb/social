// hypercomb-shared/ui/features-viewer/feature-hidden.ts
//
// The WRITE side of the feature-HIDDEN pool (shell UI).
//
// Hiding a feature does NOT delete it — it moves the feature's identity into a
// participant-local SIGNATURE POOL so it stops activating but can be looked
// back at / restored later. A hide is one record:
//
//   { kind: 'hidden', appliesTo: <location segments>, payload: { featKind, view, label } }
//
// A feature is identified by (decoration kind, location) — `featKind` is the
// stable identity (e.g. 'visual:website:page'), `appliesTo` is WHERE it is
// attached. The READER — essentials `sharing/feature-hidden.ts` — scans the
// same pool and makes a matching feature inert at activation time. The two
// never import each other; they agree ONLY on the kind string + record shape,
// exactly as feature-verified.ts ↔ feature-availability.ts agree on a key.
//
// POOL NAMING: the hidden pool's signature naming carries NO underscores — the
// kind is the clean word `'hidden'` and members are sha256-named. It is NOT in
// Store's #SYNCABLE_OPTIMIZATION_KINDS ({feedback,qa,qa-answer}) so it stays on
// this participant's machine (a local view/off preference, like adopted-roots).
//
// INTERIM SUBSTRATE: the records physically ride the shared sign('optimization')
// pool today (the legacy `__optimization__` dir is a drain source Store absorbs
// on boot). The canonical home is a `sign('hidden')` meaning pool — a future
// split that must copy existing members per-record and keep 'hidden' out of
// Store's syncable kinds. Swapping the substrate is internal to this module;
// the exported API does not change.

import { EffectBus } from '@hypercomb/core'

const SIG_RE = /^[a-f0-9]{64}$/

/** Runtime service locator — shared must never statically import essentials. */
const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

type StoreLike = {
  initialize?: () => Promise<void>
  putOptimization?: (blob: Blob) => Promise<string>
  getOptimization?: (sig: string) => Promise<Blob | null>
  removeOptimization?: (sig: string) => Promise<boolean>
  listOptimizations?: () => Promise<string[]>
}

/** The feature identity a hide record carries, plus the record's own signature
 *  (the pool member id) so the panel can RESTORE it by sig. */
export interface HiddenFeature {
  /** The record's signature — the pool member to remove on restore. */
  recordSig: string
  /** Stable feature identity: its decoration kind (e.g. 'visual:website:page'). */
  featKind: string
  view: string
  label: string
  /** Location segments the feature is attached at (the hide scope). */
  appliesTo: string[]
}

const norm = (segments: readonly string[]): string[] =>
  segments.map(s => String(s ?? '').trim()).filter(Boolean)

/** Canonical membership key: a feature is hidden at a scope iff some record
 *  shares its featKind AND its location. Shared with the essentials reader by
 *  convention (same shape), not by import. */
export function hiddenKey(featKind: string, segments: readonly string[]): string {
  return `${featKind} ${norm(segments).join('/')}`
}

/** Write a hide record into the pool. Idempotent by content: hiding the same
 *  feature at the same scope dedupes to one member. Returns the record
 *  signature, or null when no Store is available. */
export async function hideFeature(feature: {
  featKind: string; view: string; label: string; segments: readonly string[]
}): Promise<string | null> {
  const segments = norm(feature.segments)
  EffectBus.emit('feature:hidden', {
    featKind: feature.featKind, view: feature.view, segments,
  })
  const store = get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.putOptimization) {
    EffectBus.emit('feature:restored', {
      featKind: feature.featKind, view: feature.view, segments,
    })
    return null
  }
  try { await store.initialize?.() } catch {
    EffectBus.emit('feature:restored', {
      featKind: feature.featKind, view: feature.view, segments,
    })
    return null
  }
  const record = {
    kind: 'hidden',
    appliesTo: segments,
    payload: { featKind: feature.featKind, view: feature.view, label: feature.label },
    mark: 'persistent',
  }
  try {
    const sig = await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
    EffectBus.emit('feature:activation-settled', {
      hidden: true, featKind: feature.featKind, view: feature.view, segments,
    })
    return sig
  } catch {
    EffectBus.emit('feature:restored', {
      featKind: feature.featKind, view: feature.view, segments,
    })
    return null
  }
}

/** Restore a hidden feature — remove its pool member by signature. */
export async function restoreFeature(
  recordSig: string,
  feature?: { featKind: string; view: string; segments: readonly string[] },
): Promise<boolean> {
  const s = String(recordSig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return false
  const segments = norm(feature?.segments ?? [])
  if (feature) {
    EffectBus.emit('feature:restored', {
      featKind: feature.featKind, view: feature.view, segments,
    })
  }
  const rollback = (): void => {
    if (!feature) return
    EffectBus.emit('feature:hidden', {
      featKind: feature.featKind, view: feature.view, segments, recordSig: s,
    })
  }
  const store = get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.removeOptimization) { rollback(); return false }
  try { await store.initialize?.() } catch { rollback(); return false }
  try {
    const removed = await store.removeOptimization(s)
    if (!removed) rollback()
    else if (feature) EffectBus.emit('feature:activation-settled', {
      hidden: false, featKind: feature.featKind, view: feature.view, segments,
    })
    return removed
  } catch {
    rollback()
    return false
  }
}

/** Restore every hide of `featKind` at exactly `segments`. Sig-free entry for
 *  callers that know the feature, not the pool member — scans the pool for
 *  matching records and removes each. Returns whether anything was restored. */
export async function restoreFeatureAt(
  featKind: string,
  segments: readonly string[],
): Promise<boolean> {
  const key = hiddenKey(featKind, segments)
  let any = false
  for (const rec of await loadHidden()) {
    if (hiddenKey(rec.featKind, rec.appliesTo) !== key) continue
    const removed = await restoreFeature(rec.recordSig, {
      featKind: rec.featKind, view: rec.view, segments: rec.appliesTo,
    })
    any = any || removed
  }
  return any
}

// The write surface, reachable from MODULES. Essentials may never import
// shared, and this file is the pool's ONE writer — so a queen offering a
// per-cell verb (`/postit tile` restores the hexagon by hiding the postit
// HERE) resolves this seam the same loose way everything reaches Store.
// Registered at module scope, exactly as the reader side registers
// OverlapMetrics/ContextIndex for the shell.
;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@hypercomb.social/FeatureHiddenWriter',
  { hide: hideFeature, restore: restoreFeature, restoreAt: restoreFeatureAt },
)

/** Every hide record currently in the pool. Scans the substrate and keeps only
 *  `kind:'hidden'` members. Used by the panel to (a) filter hidden features out
 *  of the active lists and (b) populate the "show hidden" view with a restore
 *  affordance. */
export async function loadHidden(): Promise<HiddenFeature[]> {
  const store = get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.listOptimizations || !store?.getOptimization) return []
  try { await store.initialize?.() } catch { return [] }
  let sigs: string[] = []
  try { sigs = await store.listOptimizations() } catch { return [] }
  const out: HiddenFeature[] = []
  for (const recordSig of sigs) {
    try {
      const blob = await store.getOptimization(recordSig)
      if (!blob) continue
      const rec = JSON.parse(await blob.text()) as {
        kind?: string; appliesTo?: unknown; payload?: { featKind?: unknown; view?: unknown; label?: unknown }
      }
      if (rec?.kind !== 'hidden') continue
      const featKind = String(rec.payload?.featKind ?? '').trim()
      if (!featKind) continue
      out.push({
        recordSig,
        featKind,
        view: String(rec.payload?.view ?? '').trim(),
        label: String(rec.payload?.label ?? '').trim() || featKind,
        appliesTo: Array.isArray(rec.appliesTo) ? rec.appliesTo.map(s => String(s ?? '')) : [],
      })
    } catch { /* malformed member — skip */ }
  }
  return out
}
