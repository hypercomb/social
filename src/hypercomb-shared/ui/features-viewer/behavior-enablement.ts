// hypercomb-shared/ui/features-viewer/behavior-enablement.ts
//
// The WRITE side of the behavior-enablement lens (shell) — the roster's
// global switches and the per-tile "wake here" exception. The READER lives
// essentials-side in `sharing/behavior-enablement.ts`; the two never import
// each other — they agree ONLY on the localStorage keys, the record shapes,
// and the `behavior:enablement-changed` event (the hidden/verified split).
//
// Model (one switch, one meaning):
//   • `hc:behavior-global-off` — decoration kinds turned OFF on the roster.
//     Off = dormant everywhere AND withheld from every swarm. Absence = ON:
//     only exceptions are stored, so an untouched roster shares everything.
//   • `hc:behavior-wake` — { "/path": [kinds] } local ON exceptions. A wake
//     covers its subtree; it outranks a global off (and a publisher's
//     withheld mark) at that tile. Never touched by the global flip, so
//     re-enabling globally simply wakes everything wherever it lives.

import { EffectBus, normalizeCell } from '@hypercomb/core'

export const GLOBAL_OFF_KEY = 'hc:behavior-global-off'
export const WAKE_KEY = 'hc:behavior-wake'
export const ENABLEMENT_CHANGED = 'behavior:enablement-changed'

/** Canonical absolute path — every segment normalized; MUST match the
 *  essentials reader's `behaviorPath` (lockstep by convention, not import). */
export function behaviorPath(segments: readonly string[]): string {
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean).map(s => normalizeCell(s) || s)
  return '/' + segs.join('/')
}

export function readGlobalOffKinds(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(GLOBAL_OFF_KEY) ?? '[]')
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

export function isKindGloballyOff(kind: string): boolean {
  return readGlobalOffKinds().includes(kind)
}

/** Flip a behavior kind on/off globally. Emits the change event so every
 *  reader cache invalidates and every surface repaints at once. */
export function setKindGlobalOn(kind: string, on: boolean): void {
  const k = String(kind ?? '').trim()
  if (!k) return
  const list = readGlobalOffKinds()
  const has = list.includes(k)
  let next = list
  if (on && has) next = list.filter(x => x !== k)
  else if (!on && !has) next = [...list, k]
  if (next === list) return
  try { localStorage.setItem(GLOBAL_OFF_KEY, JSON.stringify(next)) } catch { /* private-browsing */ }
  EffectBus.emit(ENABLEMENT_CHANGED, { kind: k, on })
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
