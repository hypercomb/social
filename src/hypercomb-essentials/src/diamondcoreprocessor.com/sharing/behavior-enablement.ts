// diamondcoreprocessor.com/sharing/behavior-enablement.ts
//
// The READ side of the behavior-ENABLEMENT lens (essentials) — the third
// lens beside hidden (feature-hidden.ts) and verified (feature-availability.ts).
//
// One switch, one meaning: a behavior switched off on the GLOBAL roster is
// DORMANT everywhere — not rendered, not offered, not shared into a swarm —
// even though its decorations stay on their tiles untouched. Nothing is
// migrated or rewritten; this is pure read-time precedence:
//
//   local wake (ON, per tile/branch)  >  global OFF  >  per-tile hidden  >  ON
//
// Re-enabling a behavior globally wakes it wherever it lives; wake
// exceptions and hidden records are never touched by the global flip.
//
// Participant-local, localStorage only — never in any lineage (same principle
// as hide / clipboard / public-tiles). The WRITER (the roster switches + the
// per-tile "wake here" action) lives shell-side in
// `hypercomb-shared/ui/features-viewer/behavior-enablement.ts`; the two never
// import each other — they agree ONLY on the keys, the record shapes, and the
// `behavior:enablement-changed` EffectBus event, exactly as the hidden and
// verified lenses split their reader/writer pairs.
//
// A FOURTH dormancy source is essentials-owned: `hc:withheld-at-roots`
// records, at adopt time, which decoration kinds the PUBLISHER withheld from
// the swarm (their own global-off list, broadcast on wire kind 30208). A
// withheld kind under an adopted root renders inert with the same dormancy
// answer — the tile arrived as the signed snapshot, the behavior just doesn't
// light up. It is overridable by a local wake like any other dormancy: waking
// it is the adopter's conscious choice, and the verification gate still
// applies on top.

import { EffectBus, normalizeCell } from '@hypercomb/core'

export const GLOBAL_OFF_KEY = 'hc:behavior-global-off'
export const WAKE_KEY = 'hc:behavior-wake'
export const WITHHELD_ROOTS_KEY = 'hc:withheld-at-roots'

/** Fired (by the shell writer AND the essentials adopt recorder) after any
 *  enablement write, so caches refresh and surfaces repaint at once. */
export const ENABLEMENT_CHANGED = 'behavior:enablement-changed'

/** Canonical absolute path — every segment normalized, same rule as
 *  tile-actions' tilePath so wake roots and withheld roots prefix-match
 *  descendants however the location arrived (raw nav vs descent). */
export function behaviorPath(segments: readonly string[]): string {
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean).map(s => normalizeCell(s) || s)
  return '/' + segs.join('/')
}

function readStringArray(key: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

function readPathMap(key: string): Record<string, string[]> {
  try {
    const obj = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, string[]> = {}
    for (const [p, kinds] of Object.entries(obj as Record<string, unknown>)) {
      if (Array.isArray(kinds)) out[p] = kinds.filter((k): k is string => typeof k === 'string')
    }
    return out
  } catch { return {} }
}

// Live caches — visibleWhen runs per tile per frame, so reads must be sync
// and cheap. Invalidated on the change event (both sides emit it after every
// write) and on cross-tab `storage`.
let offCache: Set<string> | null = null
let wakeCache: Record<string, string[]> | null = null
let withheldCache: Record<string, string[]> | null = null
let wired = false

function wire(): void {
  if (wired) return
  wired = true
  EffectBus.on(ENABLEMENT_CHANGED, () => { offCache = null; wakeCache = null; withheldCache = null })
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === GLOBAL_OFF_KEY || e.key === WAKE_KEY || e.key === WITHHELD_ROOTS_KEY) {
        offCache = null; wakeCache = null; withheldCache = null
      }
    })
  } catch { /* non-window context */ }
}

/** The global-off set — decoration kinds the participant turned off on the
 *  roster. Absence means ON: we store only the exceptions, so a participant
 *  who never opens the screen shares and sees everything. */
export function readGlobalOffKinds(): ReadonlySet<string> {
  wire()
  return offCache ??= new Set(readStringArray(GLOBAL_OFF_KEY))
}

export function isKindGloballyOff(kind: string): boolean {
  return readGlobalOffKinds().has(kind)
}

/** True when a wake exception at `segments` (or any ancestor — a wake covers
 *  its subtree, so waking a site root wakes the whole scope) re-enables the
 *  kind despite a global/publisher off. */
export function isWokenAt(kind: string, segments: readonly string[]): boolean {
  wire()
  const wake = wakeCache ??= readPathMap(WAKE_KEY)
  const p = behaviorPath(segments)
  for (const [root, kinds] of Object.entries(wake)) {
    if (!kinds.includes(kind)) continue
    if (p === root || p.startsWith(root === '/' ? '/' : root + '/')) return true
  }
  return false
}

/** True when the publisher of an adopted root withheld this kind from the
 *  swarm — recorded at fold time from their 30208 broadcast. */
export function isWithheldByPublisherAt(kind: string, segments: readonly string[]): boolean {
  wire()
  const withheld = withheldCache ??= readPathMap(WITHHELD_ROOTS_KEY)
  const p = behaviorPath(segments)
  for (const [root, kinds] of Object.entries(withheld)) {
    if (!kinds.includes(kind)) continue
    if (p === root || p.startsWith(root === '/' ? '/' : root + '/')) return true
  }
  return false
}

/** THE dormancy answer every activation surface asks — icons, view toggles,
 *  panel rows, launchers. Dormant = (globally off OR publisher-withheld here)
 *  AND not locally woken. Per-tile hidden stays a separate, narrower lens
 *  (feature-hidden.ts) consulted after this one. */
export function isBehaviorDormant(kind: string, segments: readonly string[]): boolean {
  if (!kind) return false
  if (isWokenAt(kind, segments)) return false
  return isKindGloballyOff(kind) || isWithheldByPublisherAt(kind, segments)
}

/** What the swarm broadcasts as withheld (wire kind 30208): exactly the
 *  global-off list. One switch, one meaning — what's off for you is off for
 *  the swarm. */
export function withheldForShare(): string[] {
  return [...readGlobalOffKinds()]
}

/** Essentials-side writer for the adopt path ONLY: record the publisher's
 *  withheld kinds at the adopted root. Empty `kinds` clears the record. */
export function recordWithheldAtRoot(segments: readonly string[], kinds: readonly string[]): void {
  wire()
  const map = readPathMap(WITHHELD_ROOTS_KEY)
  const p = behaviorPath(segments)
  if (kinds.length > 0) map[p] = [...new Set(kinds)]
  else delete map[p]
  try { localStorage.setItem(WITHHELD_ROOTS_KEY, JSON.stringify(map)) } catch { /* private-browsing */ }
  withheldCache = null
  EffectBus.emit(ENABLEMENT_CHANGED, { root: p })
}
