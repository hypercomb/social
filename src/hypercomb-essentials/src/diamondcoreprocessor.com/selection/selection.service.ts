// diamondcoreprocessor.com/core/selection/selection.service.ts
import { EffectBus } from '@hypercomb/core'

/** Minimal shape of the shared Navigation service we read from. */
interface NavigationLike {
  getSelections(): string[]
}

interface IocLike {
  get<T>(key: string): T | undefined
}

export class SelectionService extends EventTarget {
  #items = new Set<string>()
  #active: string | null = null
  #urlSyncing = false

  get selected(): ReadonlySet<string> { return this.#items }
  get count(): number { return this.#items.size }
  get active(): string | null { return this.#active }

  constructor() {
    super()

    // ── Native URL ↔ selection wiring ──────────────────────────────
    // Selection state is canonically expressed in the URL — either as
    // the path-bracket form `/parent/[a,b,c]` (preferred, shareable)
    // or the legacy hash form `#name` / `#(a,b,c)`. Navigation owns
    // the read side via `getSelections()` and recognises both.
    //
    // This service subscribes to `navigate` / `popstate` window
    // events and reconciles its in-memory set on every URL change,
    // so SelectionService and the URL stay in lock-step automatically
    // — no separate bridge drone, no event-routing surprise.
    //
    // Hash writes from tile clicks dispatch a `selection` window
    // event; we intentionally do NOT listen to that one. It fires
    // from our own writer and would feed back through here, reverting
    // a freshly-toggled click to whatever bracket the URL still
    // carries from the earlier navigation.
    const syncFromUrl = (): void => this.#syncFromUrl()
    window.addEventListener('navigate', syncFromUrl)
    window.addEventListener('popstate', syncFromUrl)
    // Deep-link load may not see a `navigate` event before the user
    // interacts. queueMicrotask defers one tick so IoC has time to
    // register Navigation; missed first calls are caught by the
    // event listeners above.
    queueMicrotask(syncFromUrl)
  }

  /** Pull current selection from the URL (via Navigation) and reconcile
   *  the in-memory set. Same-set short-circuit avoids redundant
   *  notifications and prevents any feedback with the legacy hash
   *  writer. Internal mutations (add/remove/toggle/clear) are
   *  guarded against re-entering via `#urlSyncing` so the notify
   *  callback below doesn't recurse through window listeners. */
  #syncFromUrl(): void {
    if (this.#urlSyncing) return
    const ioc = (window as { ioc?: IocLike }).ioc
    const navigation = ioc?.get<NavigationLike>('@hypercomb.social/Navigation')
    if (!navigation) return

    const desired = new Set(navigation.getSelections())
    const current = this.#items

    if (desired.size === current.size) {
      let same = true
      for (const x of desired) {
        if (!current.has(x)) { same = false; break }
      }
      if (same) return
    }

    this.#urlSyncing = true
    try {
      this.#items.clear()
      this.#active = null
      for (const name of desired) {
        this.#items.add(name)
        if (!this.#active) this.#active = name
      }
      this.#notify()
    } finally {
      this.#urlSyncing = false
    }
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
