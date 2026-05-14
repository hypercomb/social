// hypercomb-shared/ui/selection-context-menu/egg-menu-pack.ts
//
// EggMenuPack — the vertical-menu actions for tiles that arrived via
// paired-channel sync and are currently in facade state ("eggs"). When
// the user selects one or more cells, this pack surfaces an "unlock"
// button. Clicking it emits `egg:unlock-selected` for the receive-side
// handler (in expose.drone.ts) to drop the facade flag and recursively
// materialise the subtree from the buffered layer events.
//
// Visibility: the pack becomes visible when the SelectionService
// reports any selected labels. v0 doesn't filter to facade-only —
// the click handler is a no-op on plain tiles, so the worst case is
// an unlock button that does nothing, which is preferable to wiring
// a per-tile facade probe into shared/ui (cross-package read).

import { computed, signal, type Signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import type { MenuButton, MenuItem, MenuPack } from './menu-pack'
import { MenuRegistry } from './menu-registry'

class EggMenuPackImpl {

  readonly id = 'egg'

  #selectedLabels = signal<readonly string[]>([])

  readonly visible: Signal<boolean> = computed(() => this.#selectedLabels().length > 0)

  readonly items: Signal<MenuItem[]> = computed(() => {
    const labels = this.#selectedLabels()
    if (labels.length === 0) return []
    const unlock: MenuButton = {
      id: 'unlock',
      labelKey: 'action.unlock',
      // No HCI glyph for "unlock" in the existing font — use a CSS
      // class hook so styling can target it. Falls back to the icon
      // font's default if the class isn't present in the stylesheet.
      cssClass: 'unlock-icon',
      onClick: () => {
        const current = this.#selectedLabels()
        if (current.length === 0) return
        EffectBus.emit('egg:unlock-selected', { labels: [...current] })
      },
    }
    return [unlock]
  })

  /**
   * Hook for MenuRegistry to clear the pack's selection state on hide.
   * The selection itself lives in SelectionService; we just stop
   * surfacing it.
   */
  onHide(): void {
    // Selection menu hides when the user dismisses it; the selection
    // is cleared by SelectionService's own handlers (Escape, click
    // elsewhere). We don't clear here — that would race with the
    // user's intent.
  }

  install(): void {
    EffectBus.on<{ selected: readonly string[] }>('selection:changed', (state) => {
      if (!state) return
      this.#selectedLabels.set(Array.isArray(state.selected) ? [...state.selected] : [])
    })
    MenuRegistry.register(this as unknown as MenuPack)
  }
}

export const EggMenuPack = new EggMenuPackImpl()

// Self-install on import. Side-effect registration mirrors the pattern
// used by HistoryMenuPack; idempotent via MenuRegistry id dedupe.
EggMenuPack.install()
