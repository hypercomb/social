// viewport-inset-vars.ts — mirror the docked-panel `viewport:inset` reservations
// into CSS custom properties on the document root, so position:fixed shell chrome
// can sit BESIDE an open toolwindow instead of being covered by it.
//
// The hex canvas already has its own consumer (pixi-host.worker.ts) that squeezes
// #pixi-host into the free area — but that only reframes the tile CONTENT. The
// chrome pinned to the viewport edges (the undo/redo/save cluster, the video-close
// FAB) is position:fixed and knows nothing about an open panel, so a right-docked
// toolwindow paints straight over it. Those elements read `--hc-inset-<side>` and
// add it to their edge offset.
//
// Aggregation matches the canvas consumer exactly: the MAX reservation per edge
// across every owner (two panels on the same edge don't stack — the widest wins).
// Self-initializing singleton: the first consumer to call ensureViewportInsetVars()
// starts the subscription; the guard makes repeat calls no-ops. Started at shell
// bootstrap (edit-actions is template-mounted), so it is listening before any
// panel can open. Shell UI — EffectBus string contract only, no essentials import.

import { EffectBus } from '@hypercomb/core'

type Side = 'left' | 'right' | 'top' | 'bottom'
const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom']

let started = false

export function ensureViewportInsetVars(): void {
  if (started || typeof document === 'undefined') return
  started = true

  const insets = new Map<string, { side: Side; size: number }>()
  const root = document.documentElement

  const apply = (): void => {
    const agg: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
    for (const { side, size } of insets.values()) {
      if (size > agg[side]) agg[side] = size
    }
    for (const side of SIDES) root.style.setProperty(`--hc-inset-${side}`, `${agg[side]}px`)
  }

  EffectBus.on<{ owner?: string; side?: Side; size?: number }>('viewport:inset', (p) => {
    if (!p?.owner || !p.side) return
    if ((p.size ?? 0) > 0) insets.set(p.owner, { side: p.side, size: p.size! })
    else insets.delete(p.owner)
    apply()
  })

  // Seed the vars at 0px so consumers' calc() has a concrete value from frame one.
  apply()
}
