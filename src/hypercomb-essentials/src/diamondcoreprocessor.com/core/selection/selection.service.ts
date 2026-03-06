// hypercomb-essentials/src/diamondcoreprocessor.com/core/selection/selection.service.ts
// Pure selection state — tracks which seed labels are currently selected.

import { EffectBus } from '@hypercomb/core'

export class SelectionService extends EventTarget {
  #items = new Set<string>()

  get selected(): ReadonlySet<string> { return this.#items }
  get count(): number { return this.#items.size }

  constructor() {
    super()
    document.addEventListener('keydown', this.#onKeyDown)
  }

  add(label: string): void {
    if (this.#items.has(label)) return
    this.#items.add(label)
    this.#notify()
  }

  remove(label: string): void {
    if (!this.#items.delete(label)) return
    this.#notify()
  }

  toggle(label: string): void {
    if (this.#items.has(label)) this.#items.delete(label)
    else this.#items.add(label)
    this.#notify()
  }

  clear(): void {
    if (this.#items.size === 0) return
    this.#items.clear()
    this.#notify()
  }

  isSelected(label: string): boolean {
    return this.#items.has(label)
  }

  #notify(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('selection:changed', { selected: Array.from(this.#items) })
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.clear()
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/SelectionService',
  new SelectionService()
)
