// games/lazy-overlay.ts
//
// OPEN LOADS THE GAME (atomic-modules-plan.md, step 4b). A game's bee is tiny
// and loads with the hive; the game itself — its overlay and every atom the
// overlay reaches — loads only when somebody opens it. This holds the one
// lifecycle all four game bees share:
//
//   open      starts the load and mounts when it lands. While it loads the
//             game already counts as ACTIVE, so every caller that asks
//             `isActive()` right after `open()` (the toggle, the queen's
//             message, the game view's watch) sees the answer it always did.
//   close     unmounts, or cancels a load still in flight: a game closed
//             before it arrived never mounts.
//   prefetch  loads the code without opening anything. The tile walk
//             calls it (history.service.ts preloadFromRoot → the game view's
//             descriptor → game-play.ts prefetchGameFace) for a tile within
//             reach whose face is this game, so its first open is warm.
//
// A dependency: it registers nothing; the bee that owns the game wires it.

export type OverlayLike = {
  mount(): void
  unmount(): void
  isMounted(): boolean
}

/** Resolves to a factory: given the close callback, make the overlay. */
export type OverlayLoader<T extends OverlayLike> = () => Promise<(onClose: () => void) => T>

export class LazyOverlay<T extends OverlayLike> {
  readonly #load: OverlayLoader<T>
  readonly #onClose: () => void
  readonly #onChange: () => void
  #factory: Promise<(onClose: () => void) => T> | null = null
  #overlay: T | null = null
  #pending: ((overlay: T) => void)[] | null = null
  #generation = 0

  constructor(load: OverlayLoader<T>, onClose: () => void, onChange: () => void) {
    this.#load = load
    this.#onClose = onClose
    this.#onChange = onChange
  }

  /** The mounted overlay, or null while closed or still loading. */
  get current(): T | null { return this.#overlay }

  isActive(): boolean { return this.#pending !== null || !!this.#overlay?.isMounted() }

  /** Load the game's code once, without opening it. A failed load is
   *  forgotten, so the next open tries again. */
  prefetch(): Promise<(onClose: () => void) => T> {
    this.#factory ??= this.#load().catch(error => {
      this.#factory = null
      throw error
    })
    return this.#factory
  }

  /** Open, then run `then` on the mounted overlay. Already open: `then` runs
   *  on the open one (at once, or when the load in flight lands). */
  open(then?: (overlay: T) => void): void {
    if (this.#overlay?.isMounted()) { then?.(this.#overlay); return }
    if (this.#pending) { if (then) this.#pending.push(then); return }
    const generation = ++this.#generation
    this.#pending = then ? [then] : []
    this.prefetch().then(make => {
      if (generation !== this.#generation) return
      const waiting = this.#pending ?? []
      this.#pending = null
      this.#overlay = make(this.#onClose)
      this.#overlay.mount()
      for (const run of waiting) run(this.#overlay)
      this.#onChange()
    }, error => {
      if (generation !== this.#generation) return
      this.#pending = null
      console.warn('[lazy-overlay] the game failed to load', error)
      this.#onChange()
    })
  }

  /** Unmount, or cancel a load in flight. True when there was something to close. */
  close(): boolean {
    const had = this.#pending !== null || this.#overlay !== null
    this.#generation++
    this.#pending = null
    this.#overlay?.unmount()
    this.#overlay = null
    return had
  }
}
