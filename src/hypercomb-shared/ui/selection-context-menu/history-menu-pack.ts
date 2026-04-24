// hypercomb-shared/ui/selection-context-menu/history-menu-pack.ts
//
// HistoryMenuPack — the set of buttons the vertical menu shows when the
// user is navigating history (after Ctrl+Z / Ctrl+Y or clicking the
// first history button on the menu). Stays visible until the user
// explicitly hides it, per the design: history navigation is a mode
// that persists across excursions to head and back.

import { computed, signal, type Signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import type { MenuButton, MenuItem, MenuPack } from './menu-pack'
import { MenuRegistry } from './menu-registry'

type CursorState = {
  locationSig: string
  position: number
  total: number
  rewound: boolean
  at: number
}

class HistoryMenuPackImpl {

  readonly id = 'history'

  #visible = signal(false)
  #cursorTotal = signal(0)
  #cursorPosition = signal(0)
  #cursorRewound = signal(false)
  #sliderOpen = signal(false)

  readonly visible: Signal<boolean> = this.#visible.asReadonly()

  readonly items: Signal<MenuItem[]> = computed(() => {
    const total = this.#cursorTotal()
    const position = this.#cursorPosition()
    const rewound = this.#cursorRewound()
    const canUndo = position > 0
    const canRedo = position < total
    const atHead = !rewound

    const undo: MenuButton = {
      id: 'undo',
      labelKey: 'history.undo',
      hci: '<',
      onClick: () => EffectBus.emit('keymap:invoke', { cmd: 'history.undo' }),
      visible: computed(() => canUndo),
    }
    const redo: MenuButton = {
      id: 'redo',
      labelKey: 'history.redo',
      hci: '>',
      onClick: () => EffectBus.emit('keymap:invoke', { cmd: 'history.redo' }),
      visible: computed(() => canRedo),
    }
    const makeHead: MenuButton = {
      id: 'make-head',
      labelKey: 'history.make-head',
      hci: '^',
      onClick: () => EffectBus.emit('keymap:invoke', { cmd: 'history.make-head' }),
      visible: computed(() => !atHead),
    }
    const toggleSlider: MenuButton = {
      id: 'toggle-slider',
      labelKey: 'history.toggle-slider',
      hci: '|',
      onClick: () => this.#sliderOpen.set(!this.#sliderOpen()),
    }
    const hide: MenuButton = {
      id: 'hide-menu',
      labelKey: 'history.hide',
      hci: 'x',
      onClick: () => this.#visible.set(false),
    }

    return [undo, redo, makeHead, toggleSlider, { kind: 'divider' }, hide]
  })

  /**
   * When true, the menu surface expands leftward to reveal a vertical
   * drag slider for free scrubbing across layer history.
   */
  readonly sliderOpen: Signal<boolean> = this.#sliderOpen.asReadonly()

  readonly onActivate = (): void => {
    // Clear tile selection when entering history mode so the selection
    // pack's icons don't overlap with history navigation.
    EffectBus.emit('selection:changed', { selected: [] })
  }

  readonly onHide = (): void => {
    this.#visible.set(false)
    this.#sliderOpen.set(false)
  }

  /**
   * Initialise subscriptions. Called once at boot. Wires to the global
   * history cursor state so the pack's buttons always reflect the
   * current position — but *opening* the menu now only happens in
   * response to a user-initiated history action (undo / redo / seek),
   * not on the initial cursor-load that fires at boot or on every
   * page navigation. Previously the menu popped open the first time
   * any cursor-changed arrived, which included the boot-time hydration
   * emit, so the panel always appeared on load.
   */
  install(): void {
    EffectBus.on<CursorState>('history:cursor-changed', (state) => {
      if (!state) return
      this.#cursorTotal.set(state.total)
      this.#cursorPosition.set(state.position)
      this.#cursorRewound.set(state.rewound)
    })

    // Only a keyboard/menu-invoked history action (undo, redo,
    // make-head, toggle-slider, etc.) opens the panel. That maps
    // exactly to intentional history navigation — hydration events
    // don't go through keymap.
    EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (!payload?.cmd?.startsWith('history.')) return
      if (this.#visible()) return
      this.#visible.set(true)
      MenuRegistry.activate(this.id)
    })

    MenuRegistry.register(this as unknown as MenuPack)
  }
}

export const HistoryMenuPack = new HistoryMenuPackImpl()

// Self-install on import. Side-effect registration is the simplest way
// to ensure the pack is wired to EffectBus before the first history
// event fires. Idempotent: MenuRegistry.register dedupes by id.
HistoryMenuPack.install()
