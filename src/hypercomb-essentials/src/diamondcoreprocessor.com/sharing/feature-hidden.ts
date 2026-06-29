// diamondcoreprocessor.com/sharing/feature-hidden.ts
//
// The READ side of the feature-HIDDEN pool (essentials) — the source the
// activation/visibility LENS reads from.
//
// A feature the participant has HIDDEN must not ACTIVATE or be DRAWN — render,
// run, stream, or surface its overlay icon — even though its bytes are present.
// Hiding is the retainable "off" / curation control: in a swarm view full of
// features you don't own, it clears away the ones you don't want while keeping
// them restorable. The feature's identity sits in a local signature pool
// (written shell-side by `features-viewer/feature-hidden.ts`); this module reads
// it and answers, at resolution time, "is the feature (kind @ location) hidden?"
//
// ONE SOURCE, TWO READ SHAPES:
//   • `hiddenKeysSync()` — a synchronous snapshot of the hidden-key set, for the
//     hot decoration-kind index (overlay `visibleWhen`, the features-panel feed,
//     capability checks) which can't await per tile per frame. Maintained live
//     from `feature:hidden` / `feature:restored` so a hide takes effect at once.
//   • `isFeatureHidden()` — async, for the `site-view` page-mount gate (already
//     in an async reconcile). Both read the SAME pool + the SAME key, so the
//     filter is derived in one place however it's consumed.
//
// Mirrors the verification gate's reader/writer split: the shell WRITES the
// `kind:'hidden'` record, essentials READS it; no cross-import, agreement only
// on the record shape. Participant-local — `'hidden'` is not a syncable
// optimization kind, so it never leaves this machine. The pool's signature
// naming uses no underscores; see the writer for the interim-substrate note.

import { EffectBus } from '@hypercomb/core'

type StoreLike = {
  getOptimization?: (sig: string) => Promise<Blob | null>
  listOptimizations?: () => Promise<string[]>
}

const EMPTY: ReadonlySet<string> = new Set<string>()

const norm = (segments: readonly string[]): string[] =>
  segments.map(s => String(s ?? '').trim()).filter(Boolean)

/** Canonical membership key — MUST match the shell writer's `hiddenKey`
 *  (kept in lockstep by convention, not import). */
export function hiddenKey(featKind: string, segments: readonly string[]): string {
  return `${featKind} ${norm(segments).join('/')}`
}

// Live set of hidden keys. Hydrated once from the pool (covers hides from a
// prior session), then MAINTAINED in place from the panel's hide/restore events
// so synchronous readers (the index) see a change immediately — no null-and-
// rebuild window where a just-hidden feature flickers back. Cheap: the pool is
// local and only the participant's own panel mutates it.
let cache: Set<string> | null = null
let loading: Promise<void> | null = null
let wired = false

function keyFromEvent(p: { featKind?: unknown; segments?: unknown } | undefined): string | null {
  const featKind = String(p?.featKind ?? '').trim()
  if (!featKind) return null
  const segments = Array.isArray(p?.segments) ? (p!.segments as unknown[]).map(s => String(s ?? '')) : []
  return hiddenKey(featKind, segments)
}

function wire(): void {
  if (wired) return
  wired = true
  // Optimistic, synchronous maintenance — the write already hit the pool
  // before these fire (the panel awaits put/remove), so the set stays truthful.
  EffectBus.on('feature:hidden', (p: { featKind?: unknown; segments?: unknown } | undefined) => {
    const k = keyFromEvent(p); if (!k) return
    ;(cache ??= new Set<string>()).add(k)
  })
  EffectBus.on('feature:restored', (p: { featKind?: unknown; segments?: unknown } | undefined) => {
    const k = keyFromEvent(p); if (k && cache) cache.delete(k)
  })
}

async function buildKeys(): Promise<Set<string>> {
  const out = new Set<string>()
  const store = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<StoreLike>('@hypercomb.social/Store')
  if (!store?.listOptimizations || !store?.getOptimization) return out
  let sigs: string[] = []
  try { sigs = await store.listOptimizations() } catch { return out }
  for (const sig of sigs) {
    try {
      const blob = await store.getOptimization(sig)
      if (!blob) continue
      const rec = JSON.parse(await blob.text()) as { kind?: string; appliesTo?: unknown; payload?: { featKind?: unknown } }
      if (rec?.kind !== 'hidden') continue
      const featKind = String(rec.payload?.featKind ?? '').trim()
      if (!featKind) continue
      const appliesTo = Array.isArray(rec.appliesTo) ? rec.appliesTo.map(s => String(s ?? '')) : []
      out.add(hiddenKey(featKind, appliesTo))
    } catch { /* malformed member — skip */ }
  }
  return out
}

/** Kick off the one-time hydration from the pool, folding the result INTO the
 *  live cache (union — any hide/restore that landed during the async read is
 *  preserved). Idempotent. */
function ensureWarm(): void {
  wire()
  if (cache || loading) return
  loading = buildKeys().then(set => {
    if (cache) { for (const k of set) cache.add(k) } else { cache = set }
    loading = null
  })
}

/** Synchronous snapshot of the hidden-key set for the hot index. May be empty
 *  on the very first call (hydration is async) but warms immediately and is
 *  maintained live thereafter. */
export function hiddenKeysSync(): ReadonlySet<string> {
  ensureWarm()
  return cache ?? EMPTY
}

/** Async hidden-key set — awaits first hydration. For non-hot-path callers. */
export async function hiddenKeys(): Promise<ReadonlySet<string>> {
  ensureWarm()
  if (loading) await loading
  return cache ?? EMPTY
}

/** Is the feature (decoration kind) at this location hidden → suppressed? */
export async function isFeatureHidden(segments: readonly string[], featKind: string): Promise<boolean> {
  if (!featKind) return false
  return (await hiddenKeys()).has(hiddenKey(featKind, segments))
}
