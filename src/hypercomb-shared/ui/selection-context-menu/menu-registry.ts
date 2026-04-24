// hypercomb-shared/ui/selection-context-menu/menu-registry.ts
//
// Registry of vertical-menu packs. Consumers register a MenuPack via
// `register()`; the component reads `activePack()` (a signal) and
// renders its items when any pack is visible.
//
// Semantics:
//  - Multiple packs may be registered simultaneously (selection,
//    history, future ones).
//  - Only one pack is "active" at a time. Active = visible AND most
//    recently activated.
//  - When a newly-visible pack appears, it takes over (onActivate
//    fires) and the previously-active pack is expected to relinquish
//    the surface either by flipping its own visibility or by ignoring
//    the user hiding the menu.

import { computed, signal, type Signal } from '@angular/core'
import type { MenuPack } from './menu-pack'

const STORAGE_KEY = 'hc:vertical-menu-last-pack'

class MenuRegistryImpl {

  #packs = signal<readonly MenuPack[]>([])
  /** id of pack most recently activated (took over the surface). */
  #lastActivatedId = signal<string | null>(null)

  /** Live list of visible packs (derived). */
  readonly visiblePacks: Signal<readonly MenuPack[]> = computed(() => {
    const all = this.#packs()
    return all.filter(p => p.visible())
  })

  /**
   * The currently active pack, or null. Resolved as:
   *   1. The visible pack whose id is `#lastActivatedId`, if still visible.
   *   2. Otherwise the first visible pack in registration order.
   */
  readonly activePack: Signal<MenuPack | null> = computed(() => {
    const visible = this.visiblePacks()
    if (visible.length === 0) return null
    const lastId = this.#lastActivatedId()
    if (lastId) {
      const found = visible.find(p => p.id === lastId)
      if (found) return found
    }
    return visible[0]
  })

  /** Is any pack visible? */
  readonly anyVisible: Signal<boolean> = computed(() => this.visiblePacks().length > 0)

  /**
   * Register a pack. Idempotent by id — re-registering the same id
   * replaces the previous entry (useful during HMR).
   */
  register(pack: MenuPack): void {
    const existing = this.#packs()
    const without = existing.filter(p => p.id !== pack.id)
    this.#packs.set([...without, pack])
  }

  /** Unregister a pack by id. */
  unregister(id: string): void {
    this.#packs.set(this.#packs().filter(p => p.id !== id))
    if (this.#lastActivatedId() === id) this.#lastActivatedId.set(null)
  }

  /**
   * Promote a pack to active. Fires the pack's `onActivate` hook if it
   * newly became active. Persists to localStorage so the same pack
   * re-activates across refresh if still visible.
   */
  activate(id: string): void {
    if (this.#lastActivatedId() === id) return
    const pack = this.#packs().find(p => p.id === id)
    if (!pack) return
    this.#lastActivatedId.set(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* storage unavailable */ }
    pack.onActivate?.()
  }

  /**
   * User asked to hide the menu. Delegates to the active pack's
   * `onHide` (so the pack itself decides what "hide" means — e.g.
   * the history pack flips its own visibility flag off).
   */
  hideActive(): void {
    const pack = this.activePack()
    pack?.onHide?.()
  }

  /** Read the persisted last-active pack id, if any. */
  restoreLastActivated(): void {
    try {
      const id = localStorage.getItem(STORAGE_KEY)
      if (id) this.#lastActivatedId.set(id)
    } catch { /* ignore */ }
  }
}

export const MenuRegistry = new MenuRegistryImpl()
export type MenuRegistry = typeof MenuRegistry
