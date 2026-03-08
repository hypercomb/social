// revolucionstyle.com/wheel/flavor-wheel.service.ts
// Flavor wheel selection state — tracks which flavors are selected.

import { EffectBus } from '@hypercomb/core'
import type { FlavorProfile } from '../journal/journal-entry.js'

export class FlavorWheelService extends EventTarget {

  #selected = new Set<string>()
  #visible = false

  // ── getters ────────────────────────────────────────────────────

  get selected(): ReadonlySet<string> { return this.#selected }
  get visible(): boolean { return this.#visible }
  get count(): number { return this.#selected.size }

  get profile(): FlavorProfile {
    return { selected: Array.from(this.#selected) }
  }

  // ── open / close ───────────────────────────────────────────────

  readonly open = (profile?: FlavorProfile): void => {
    this.#selected.clear()
    if (profile?.selected) {
      for (const id of profile.selected) this.#selected.add(id)
    }
    this.#visible = true
    this.#emit()
  }

  readonly close = (): void => {
    this.#visible = false
    this.#emit()
  }

  // ── selection ──────────────────────────────────────────────────

  readonly toggle = (flavorId: string): void => {
    if (this.#selected.has(flavorId)) this.#selected.delete(flavorId)
    else this.#selected.add(flavorId)
    this.#emit()
    EffectBus.emit<FlavorProfile>('wheel:selection-changed', this.profile)
  }

  readonly selectCategory = (flavorIds: string[]): void => {
    const allSelected = flavorIds.every(id => this.#selected.has(id))
    for (const id of flavorIds) {
      if (allSelected) this.#selected.delete(id)
      else this.#selected.add(id)
    }
    this.#emit()
    EffectBus.emit<FlavorProfile>('wheel:selection-changed', this.profile)
  }

  readonly isSelected = (flavorId: string): boolean =>
    this.#selected.has(flavorId)

  readonly isCategoryFullySelected = (flavorIds: string[]): boolean =>
    flavorIds.every(id => this.#selected.has(id))

  readonly isCategoryPartiallySelected = (flavorIds: string[]): boolean =>
    flavorIds.some(id => this.#selected.has(id)) && !this.isCategoryFullySelected(flavorIds)

  // ── internal ───────────────────────────────────────────────────

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@revolucionstyle.com/FlavorWheelService',
  new FlavorWheelService(),
)
