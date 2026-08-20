// hypercomb-shared/ui/features-viewer/behavior-enablement.ts
//
// The WRITE side of the behavior-enablement lens (shell) — the pool's
// global lights and the per-tile "wake here" exception. The READER lives
// essentials-side in `sharing/behavior-enablement.ts`; the two never import
// each other — they agree ONLY on the localStorage keys, the record shapes,
// and the `behavior:enablement-changed` event (the hidden/verified split).
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
//   • `hc:behavior-wake` — { "/path": [kinds] } local ON exceptions. A wake
//     covers its subtree; it outranks a global off (and a publisher's
//     withheld mark) at that tile. Never touched by the global flip, so
//     re-lighting globally simply wakes everything wherever it lives.

import { EffectBus, normalizeCell } from '@hypercomb/core'

export const GLOBAL_ON_KEY = 'hc:behavior-global-on'
export const GLOBAL_OFF_KEY = 'hc:behavior-global-off'
export const WAKE_KEY = 'hc:behavior-wake'
export const ENABLEMENT_CHANGED = 'behavior:enablement-changed'

/** Canonical absolute path — every segment normalized; MUST match the
 *  essentials reader's `behaviorPath` (lockstep by convention, not import). */
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

/** True once the opt-in on-list has been seeded — from then on it is the
 *  single truth and the off-list is only the withheld-wire mirror. */
export function hasGlobalOnList(): boolean {
  try { return localStorage.getItem(GLOBAL_ON_KEY) != null } catch { return false }
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

function readWakeMap(): Record<string, string[]> {
  try {
    const obj = JSON.parse(localStorage.getItem(WAKE_KEY) ?? '{}')
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, string[]> = {}
    for (const [p, kinds] of Object.entries(obj as Record<string, unknown>)) {
      if (Array.isArray(kinds)) out[p] = kinds.filter((k): k is string => typeof k === 'string')
    }
    return out
  } catch { return {} }
}

/** True when a wake exception exists EXACTLY at this path (what the panel's
 *  wake toggle reflects — subtree coverage is the reader's concern). */
export function isWokenExactlyAt(kind: string, segments: readonly string[]): boolean {
  return (readWakeMap()[behaviorPath(segments)] ?? []).includes(kind)
}

/** Set/clear the local ON exception for a kind at a tile. */
export function setWakeAt(segments: readonly string[], kind: string, awake: boolean): void {
  const k = String(kind ?? '').trim()
  if (!k) return
  const map = readWakeMap()
  const p = behaviorPath(segments)
  const kinds = map[p] ?? []
  const has = kinds.includes(k)
  if (awake && !has) map[p] = [...kinds, k]
  else if (!awake && has) {
    const next = kinds.filter(x => x !== k)
    if (next.length > 0) map[p] = next
    else delete map[p]
  } else return
  try { localStorage.setItem(WAKE_KEY, JSON.stringify(map)) } catch { /* private-browsing */ }
  EffectBus.emit(ENABLEMENT_CHANGED, { kind: k, root: p, awake })
}
