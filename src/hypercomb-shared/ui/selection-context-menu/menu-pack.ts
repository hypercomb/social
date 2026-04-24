// hypercomb-shared/ui/selection-context-menu/menu-pack.ts
//
// Interfaces for the generic vertical menu. Each "pack" is a cohesive
// set of buttons that belongs together semantically (selection, history,
// etc.). Packs are registered with MenuRegistry; the menu component
// renders the active pack's buttons. Packs can coexist but only one is
// active at a time so the menu surface stays focused on a single task.

import type { Signal } from '@angular/core'

/** One button inside a pack. */
export interface MenuButton {
  /** Stable id used for keying in @for and test selectors. */
  id: string
  /** i18n key for the aria-label (resolved via the `| t` pipe). */
  labelKey: string
  /** Called when the button is clicked. */
  onClick: () => void
  /**
   * Optional reactive visibility. Defaults to always visible while the
   * parent pack is active. Used e.g. for paste (only when clipboard
   * has items) or redo (only when cursor is not at head).
   */
  visible?: Signal<boolean>
  /**
   * One of two mutually-exclusive glyph sources:
   * - `hci`: a single character rendered in the HCI icon font
   *   (same convention the current selection menu uses — "F" = cut,
   *   "%" = copy, "Q" = remove, "G" = paste).
   * - `cssClass`: a CSS class for a decoratively-rendered icon (e.g.
   *   `eye-icon`, `reroll-icon`). The template applies the class to
   *   a `<span>` and the existing stylesheet draws the icon.
   */
  hci?: string
  cssClass?: string
  /**
   * Optional extra CSS modifier class (e.g. `struck` on the eye icon
   * to flip between hidden/unhidden). Applied alongside `cssClass`.
   */
  modifierClass?: Signal<string | null>
  /**
   * Optional inline colour — used for the green paste button. Prefer
   * `cssClass` for more structured styling; this is a pragmatic hook.
   */
  colour?: string
}

/** A divider between button groups. */
export interface MenuDivider {
  kind: 'divider'
}

export type MenuItem = MenuButton | MenuDivider

export const isDivider = (item: MenuItem): item is MenuDivider =>
  (item as MenuDivider).kind === 'divider'

/**
 * A behaviour pack. Owns its own visibility predicate and its ordered
 * list of items. The pack decides when it wants the menu surface by
 * flipping `visible` to true. It owns button state internally — the
 * component is purely presentational.
 */
export interface MenuPack {
  /** Stable id: 'selection' | 'history' | future ids. */
  id: string
  /**
   * Whether this pack currently wants the menu shown. Aggregated across
   * all registered packs by MenuRegistry — when any pack is visible, the
   * menu surface is shown.
   */
  visible: Signal<boolean>
  /**
   * Reactive list of items (buttons + dividers) to render when this pack
   * is the active one. Order matters; the component renders in order.
   */
  items: Signal<MenuItem[]>
  /**
   * Optional callback invoked when this pack takes over as the active
   * pack (e.g. to clear external state like tile selection when the
   * history pack activates). Called once per activation, not per render.
   */
  onActivate?: () => void
  /**
   * Optional callback invoked when the user explicitly hides the menu
   * while this pack is active. Packs that want to be non-auto-dismissing
   * (history mode) use this to reset their own `visible` flag.
   */
  onHide?: () => void
}
