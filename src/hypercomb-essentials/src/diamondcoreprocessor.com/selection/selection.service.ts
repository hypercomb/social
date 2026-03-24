// diamondcoreprocessor.com/core/selection/selection.service.ts
import { EffectBus } from '@hypercomb/core'

export class SelectionService extends EventTarget {
  #items = new Set<string>()
  #active: string | null = null

  get selected(): ReadonlySet<string> { return this.#items }
  get count(): number { return this.#items.size }
  get active(): string | null { return this.#active }

  constructor() {
    super()
  }

  add(label: string): void {
    if (this.#items.has(label)) return
    this.#items.add(label)
    if (!this.#active) this.#active = label
    this.#notify()
  }

  remove(label: string): void {
    if (!this.#items.delete(label)) return
    if (this.#active === label) this.#active = this.#items.size > 0 ? this.#items.values().next().value! : null
    this.#notify()
  }

  toggle(label: string): void {
    if (this.#items.has(label)) {
      this.#items.delete(label)
      if (this.#active === label) this.#active = this.#items.size > 0 ? this.#items.values().next().value! : null
    } else {
      this.#items.add(label)
      if (!this.#active) this.#active = label
    }
    this.#notify()
  }

  setActive(label: string): void {
    if (!this.#items.has(label) || this.#active === label) return
    this.#active = label
    this.#notify()
  }

  clear(): void {
    if (this.#items.size === 0) return
    this.#items.clear()
    this.#active = null
    this.#notify()
  }

  isSelected(label: string): boolean {
    return this.#items.has(label)
  }

  #notify(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('selection:changed', { selected: Array.from(this.#items), active: this.#active })
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/SelectionService',
  new SelectionService()
)
