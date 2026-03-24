// diamondcoreprocessor.com/input/escape-cascade.ts
import { EffectBus } from '@hypercomb/core'

// ── reactive state (tracked via effects already emitted by services) ──

let editorActive = false

EffectBus.on<{ active: boolean }>('editor:mode', ({ active }) => {
  editorActive = active
})

// ── cascade handler ───────────────────────────────────────────────────

EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
  if (cmd !== 'global.escape') return

  // Priority 0: command line owns Escape when focused (select mode collapse, etc.)
  const focused = document.activeElement
  if (focused instanceof HTMLInputElement && focused.classList.contains('command-input')) return

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
