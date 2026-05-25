// hypercomb-shared/ui/selection-context-menu/history-menu-pack.ts
//
// HistoryMenuPack — the set of buttons the vertical menu shows when the
// user is navigating history. Hidden by default; opens only via the
// `/history` slash command (registered in essentials) which calls
// `toggle()` through IoC. Undo / redo keystrokes still work — they
// don't pop the panel open.

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
   * Flip the panel between hidden and visible. Bound to the
   * `/history` slash command (see `history.queen.ts` in essentials);
   * the queen resolves this pack via IoC and calls toggle directly.
   */
  readonly toggle = (): void => {
    if (this.#visible()) {
      this.onHide()
      return
    }
    this.#visible.set(true)
    MenuRegistry.activate(this.id)
  }

  /**
   * Initialise subscriptions. Called once at boot. Wires to the global
   * history cursor state so the pack's buttons always reflect the
   * current position. The panel itself does NOT auto-open on
   * cursor-changed or keymap:invoke any more — visibility is owned
   * by the `/history` toggle (and the in-menu hide button). Undo /
   * redo keystrokes still go through, they just don't pop the surface.
   */
  install(): void {
    EffectBus.on<CursorState>('history:cursor-changed', (state) => {
      if (!state) return
      this.#cursorTotal.set(state.total)
      this.#cursorPosition.set(state.position)
      this.#cursorRewound.set(state.rewound)
    })

    MenuRegistry.register(this as unknown as MenuPack)

    // IoC handle for the `/history` slash command. Essentials can't
    // import shared types (dependency direction), so the queen
    // resolves a minimal `{ toggle, visible }` shape by key.
    try {
      ;(globalThis as { ioc?: { register: (k: string, v: unknown) => void } }).ioc?.register?.(
        '@hypercomb.social/HistoryMenuPack',
        { toggle: this.toggle, visible: this.visible },
      )
    } catch { /* ioc not ready in some test envs — non-fatal */ }
  }
}

export const HistoryMenuPack = new HistoryMenuPackImpl()

// Self-install on import. Side-effect registration is the simplest way
// to ensure the pack is wired to EffectBus before the first history
// event fires. Idempotent: MenuRegistry.register dedupes by id.
HistoryMenuPack.install()
