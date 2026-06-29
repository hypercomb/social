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
// INTERIM SUBSTRATE: the records physically ride the shared `__optimization__`
// pool today because that is the only signature pool that exists in
// `development`. The canonical home is a `sign('hidden')` meaning pool — pending
// the parked no-underscore storage migration. Swapping the substrate is
// internal to this module; the exported API does not change.

const SIG_RE = /^[a-f0-9]{64}$/

/** Runtime service locator — shared must never statically import essentials. */
const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

type StoreLike = {
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
  const store = get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.putOptimization) return null
  const record = {
    kind: 'hidden',
    appliesTo: norm(feature.segments),
    payload: { featKind: feature.featKind, view: feature.view, label: feature.label },
    mark: 'persistent',
  }
  try {
    return await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
  } catch {
    return null
  }
}

/** Restore a hidden feature — remove its pool member by signature. */
export async function restoreFeature(recordSig: string): Promise<boolean> {
  const s = String(recordSig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return false
  const store = get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.removeOptimization) return false
  try { return await store.removeOptimization(s) } catch { return false }
}

/** Every hide record currently in the pool. Scans the substrate and keeps only
 *  `kind:'hidden'` members. Used by the panel to (a) filter hidden features out
 *  of the active lists and (b) populate the "show hidden" view with a restore
 *  affordance. */
export async function loadHidden(): Promise<HiddenFeature[]> {
  const store = get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.listOptimizations || !store?.getOptimization) return []
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
