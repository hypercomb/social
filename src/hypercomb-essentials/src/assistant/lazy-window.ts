// assistant/lazy-window.ts - a window that arrives with its first open.
//
// THE WINDOW ARRIVES WITH ITS FIRST OPEN, not at boot (atomic-modules-plan.md,
// "adopt the proper load"): nothing needs its code until a word or a light asks,
// so it loads then, once. The view subscribes to its open effect as it is made
// and the bus REPLAYS the press that loaded it, so the first press opens it like
// every later one. A press sent with emitTransient() is never replayed, so THE
// DOOR CARRIES THAT PRESS ITSELF: it asks the bus whether a replay is coming,
// and when none is, hands the made view the press that loaded it. Either send
// opens the window on its first press. The view's IoC key is spelled by the
// caller: importing even a constant from the view would keep it on boot. And
// the caller PLACES the view in IoC — registration is the bee's act (doctrine
// ratchet "a dependency never registers"); this helper only loads and builds.

import { EffectBus } from '@hypercomb/core'

type Closable = { close: () => void }

export type LazyWindow<V extends Closable> = {
  /** The open effect the door listens for. */
  effect: string
  /** Registers the built view under the key the bee spells. */
  place: (view: V) => void
  /** Loads the view's module and hands back its class. */
  load: () => Promise<new () => V>
  /** What to call it in a message: "Providers console". */
  what: string
  /** Console tag for a construction failure: "llm". */
  tag: string
}

export const lazyWindow = <V extends Closable>({ effect, place, load, what, tag }: LazyWindow<V>): void => {
  let loading: Promise<void> | null = null
  let built = false
  /** Presses heard while the view loads. The replay plays only the last, and
   *  every press toggles - so an even count ends closed. */
  let presses = 0
  /** What the last press carried, for the press the door hands on itself. */
  let last: unknown

  EffectBus.on(effect, (payload: unknown) => {
    if (built) return
    presses++
    last = payload
    loading ??= load().then(View => {
      // BUILT ONCE, even when making it throws: it subscribes before its replay
      // opens it, so a second one would answer every later press twice.
      built = true
      try {
        // A subscriber made now hears the bus's kept press at once, or nothing.
        let replayed = false
        EffectBus.on(effect, () => { replayed = true })()
        const view = new View()
        place(view)
        if (replayed) { if (presses % 2 === 0) view.close() }
        else if (presses % 2 === 1) EffectBus.emitTransient(effect, last)
      } catch (error) {
        console.error(`[${tag}] the ${what} could not be made`, error)
      }
    }, (error: unknown) => {
      // A failed load says so, and the next press tries again.
      loading = null
      presses = 0
      EffectBus.emit('activity:log', { message: `Could not load the ${what}: ${error instanceof Error ? error.message : String(error)}` })
    })
  })
}
