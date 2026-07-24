// hypercomb-shared/core/selection-context.ts
//
// The selection notification for TOOL WINDOWS — the one shared piece behind
// "each behavior's window plugs into selection and implements its own
// response" (documentation/selection-tool-windows.md). There is deliberately
// NO central selection surface: the floating vertical menu
// (hc-selection-context-menu) was retired in favour of every window reacting
// within itself, each with its own implementation.
//
// Two publishers share the `selection:changed` event name: SelectionService
// (`#notify` → { selected, active }) and the pixi TileSelectionDrone
// (`#emitChanged` → a superset carrying axial keys / leader). Windows must not
// grow dependencies on the richer accidental shape, so this helper normalizes
// every payload down to the pair.
//
// Drones do not need this file — they already resolve SelectionService
// through IoC deps. This is for shell components, which face the
// late-registration gap (a synchronous ioc.get() at Angular construction
// time returns undefined on web).

import { EffectBus } from '@hypercomb/core'

export interface SelectionSnapshot {
  selected: readonly string[]
  active: string | null
}

export type SelectionServiceLike = EventTarget & {
  readonly selected: ReadonlySet<string>
  readonly active: string | null
  clear(): void
}

/** Subscribe a tool window to selection changes. `selection:changed` is
 *  last-value replayed, so a window mounted after the selection was made still
 *  receives the current state immediately. Returns the unsubscribe. */
export const onSelection = (cb: (sel: SelectionSnapshot) => void): (() => void) =>
  EffectBus.on<{ selected?: unknown; active?: unknown }>('selection:changed', (p) => {
    const selected = Array.isArray(p?.selected) ? (p!.selected as unknown[]).map(String) : []
    const active = typeof p?.active === 'string' ? (p.active as string) : null
    cb({ selected, active })
  })

/** Resolve the SelectionService once it registers — the late-registration-safe
 *  idiom (see notes-strip, which pioneered it). Use when a window needs the
 *  service itself (e.g. `clear()`), not just the change stream. */
export const withSelectionService = (cb: (service: SelectionServiceLike) => void): void => {
  const ioc = (globalThis as {
    ioc?: { whenReady?: (key: string, cb: (value: unknown) => void) => void }
  }).ioc
  ioc?.whenReady?.('@diamondcoreprocessor.com/SelectionService', (s) => cb(s as SelectionServiceLike))
}
