// hypercomb-shared/ui/features-viewer/behavior-enablement.ts
//
// The WRITE side of the behavior-enablement lens (shell) — the pool's
// global lights. The READER lives essentials-side in
// `sharing/behavior-enablement.ts`; the two never import each other — they
// agree ONLY on the localStorage keys, the record shapes, and the
// `behavior:enablement-changed` event (the hidden/verified split).
//
// Model (OPT-IN — everything is off until it is lit in the pool):
//   • `hc:behavior-global-on` — THE truth once it exists: the decoration
//     kinds whose global light is ON. A kind it doesn't name is OFF — a new
//     module's behavior, a foreign decoration, anything that arrives later,
//     all dark until someone lights it in the pool. The essentials side
//     seeds this list once, on boot, from the census minus the legacy
//     off-list, so a hive that predates the opt-in model keeps exactly the
//     lights it had.
//   • `hc:behavior-global-off` — the LEGACY list, still answered while the
//     on-list hasn't been seeded, and kept written as a MIRROR afterwards
//     (kinds explicitly turned off) because the swarm's withheld wire
//     (kind 30208) needs an enumerable list to broadcast.
//   • `hc:behavior-seeded` — the cohort ledger: which groups of kinds have
//     already had their lights decided, so no seed runs twice. `'*'` means
//     the hive STARTED DARK and no cohort may ever light itself here.
//   • `hc:behavior-wake` — { "/path": [kinds] } local ON exceptions,
//     honored by the essentials READER for records that already exist. This
//     side no longer writes them: the wake writer had no UI and no callers,
//     so it was removed (2026-09-01) rather than carried as dead surface.

import { EffectBus } from '@hypercomb/core'

export const GLOBAL_ON_KEY = 'hc:behavior-global-on'
export const GLOBAL_OFF_KEY = 'hc:behavior-global-off'
/** Cohorts whose lights have been decided (essentials owns the seeding —
 *  this side only stamps `'*'` for a dark start). Agreed by key, like the
 *  rest of this lens. */
export const SEEDED_COHORTS_KEY = 'hc:behavior-seeded'
export const ENABLEMENT_CHANGED = 'behavior:enablement-changed'

function readStringArray(key: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/** True once the opt-in on-list has been seeded — from then on it is the
 *  single truth and the off-list is only the withheld-wire mirror. */
export function hasGlobalOnList(): boolean {
  try { return localStorage.getItem(GLOBAL_ON_KEY) != null } catch { return false }
}

/** A BRAND-NEW install starts DARK: the opt-in on-list is materialized
 *  EMPTY, so every behaviour — every view, every decoration kind the module
 *  graph brings — is globally off until the participant lights it in the
 *  Beehaviors roster. Called by the shell at the one moment it can tell a
 *  fresh hive from an existing one: cold `ensureInstall`, before any bee has
 *  registered and long before essentials' census seed (`seedGlobalOnKinds`)
 *  could light everything. Writing the list here is what makes that seed a
 *  no-op for the rest of this hive's life.
 *
 *  It also stamps the cohort ledger `'*'` — DARK START. A cohort seed
 *  (essentials' `seedCohortOn`) lights behaviour that already worked
 *  hive-wide before the roster learned to switch it, so that it doesn't
 *  read as breaking; a hive that opened with NOTHING lit has no such past,
 *  and the stamp is what stops a light appearing in it behind the
 *  participant's back — now, and for every cohort that comes later.
 *
 *  No-op once the list exists — an existing hive keeps exactly the lights it
 *  had, and re-running a cold install never darkens it. No change event: the
 *  bus has no subscribers this early, and the first read is the truth. */
export function seedDarkOnFreshInstall(): boolean {
  if (hasGlobalOnList()) return false
  try {
    localStorage.setItem(GLOBAL_ON_KEY, '[]')
    localStorage.setItem(SEEDED_COHORTS_KEY, JSON.stringify(['*']))
  } catch { return false }
  return true
}

export function readGlobalOffKinds(): string[] {
  return readStringArray(GLOBAL_OFF_KEY)
}

export function isKindGloballyOff(kind: string): boolean {
  if (hasGlobalOnList()) return !readStringArray(GLOBAL_ON_KEY).includes(kind)
  return readGlobalOffKinds().includes(kind)
}

/** Flip one global light. Writes the on-list (the truth, once seeded) AND
 *  the off-list mirror in the same gesture, then emits the change event so
 *  every reader cache invalidates and every surface repaints at once. */
export function setKindGlobalOn(kind: string, on: boolean): void {
  const k = String(kind ?? '').trim()
  if (!k) return
  let changed = false
  if (hasGlobalOnList()) {
    const list = readStringArray(GLOBAL_ON_KEY)
    const has = list.includes(k)
    if (on && !has) { changed = true; write(GLOBAL_ON_KEY, [...list, k]) }
    else if (!on && has) { changed = true; write(GLOBAL_ON_KEY, list.filter(x => x !== k)) }
  }
  const off = readGlobalOffKinds()
  const wasOff = off.includes(k)
  if (on && wasOff) { changed = true; write(GLOBAL_OFF_KEY, off.filter(x => x !== k)) }
  else if (!on && !wasOff) { changed = true; write(GLOBAL_OFF_KEY, [...off, k]) }
  if (!changed) return
  EffectBus.emit(ENABLEMENT_CHANGED, { kind: k, on })
}

function write(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* private-browsing */ }
}
