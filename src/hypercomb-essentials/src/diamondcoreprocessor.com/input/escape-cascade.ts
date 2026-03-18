// escape-cascade.ts — centralized Escape key handler with priority cascade.
//
// Listens for the global.escape keymap command and dismisses the
// highest-priority active state: editor > selection > generic fallback.
// Replaces scattered keydown listeners with a single EffectBus subscriber.

import { EffectBus } from '@hypercomb/core'

// ── reactive state (tracked via effects already emitted by services) ──

let editorActive = false

EffectBus.on<{ active: boolean }>('editor:mode', ({ active }) => {
  editorActive = active
})

// ── cascade handler ───────────────────────────────────────────────────

EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
  if (cmd !== 'global.escape') return

  // Priority 1: close editor
  if (editorActive) {
    const drone = window.ioc.get<{ cancelEditing(): void }>('@diamondcoreprocessor.com/TileEditorDrone')
    drone?.cancelEditing()
    return
  }

  // Priority 2: clear selection (both service state and pixi overlays)
  const selection = window.ioc.get<{ count: number; clear(): void }>('@diamondcoreprocessor.com/SelectionService')
  const pixi = window.ioc.get<{ selectedAxialKeys: ReadonlySet<string>; clearSelection(): void }>('@diamondcoreprocessor.com/TileSelectionDrone')

  if ((selection && selection.count > 0) || (pixi && pixi.selectedAxialKeys.size > 0)) {
    selection?.clear()
    pixi?.clearSelection()
    return
  }

  // Priority 3: generic fallback for future consumers
  EffectBus.emit('global:escape', undefined)
})
