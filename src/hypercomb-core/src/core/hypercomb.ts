import { get } from '../ioc/ioc.js'
import { BEE_RESOLVER_KEY, BeeResolver } from './bee-resolver.js'
import { web } from './hypercomb.web.js'

export class hypercomb extends web {
  public override act = async (grammar: string = ''): Promise<void> => {
    try {
      const resolver = get<BeeResolver>(BEE_RESOLVER_KEY)
      const bees = resolver ? await resolver.find(grammar) : []

      for (const bee of bees) {
        await bee.pulse(grammar)
      }
    } finally {
      window.dispatchEvent(new Event('synchronize'))
      hypercomb.#scheduleOptimize()
    }
  }

  // -------------------------------------------------
  // optimize phase — derived caches, never truth
  // -------------------------------------------------

  // Coalesced: a burst of act() calls collapses into one idle pass. The
  // flag clears at run START so an act() landing mid-pass schedules a
  // fresh one — its state changes still get derived.
  static #optimizePending = false

  static #scheduleOptimize = (): void => {
    if (hypercomb.#optimizePending) return
    hypercomb.#optimizePending = true

    const run = async (): Promise<void> => {
      hypercomb.#optimizePending = false
      // Enumerate window.ioc (where bees self-register in every shell)
      // rather than the resolver — dev imports bees directly and never
      // populates the preloader's cache.
      const ioc = (globalThis as any).ioc
      if (!ioc?.list) return
      for (const key of ioc.list() as string[]) {
        const bee = ioc.get(key) as { optimize?: () => Promise<void> } | undefined
        if (typeof bee?.optimize !== 'function') continue
        try { await bee.optimize() } catch { /* derived-cache work must never break the app */ }
      }
    }

    const idle = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined
    if (idle) idle(() => { void run() }, { timeout: 2000 })
    else setTimeout(() => { void run() }, 50)
  }
}
