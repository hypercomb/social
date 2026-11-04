import { get } from '../ioc/ioc.js'
import { BEE_RESOLVER_KEY, BeeResolver } from './bee-resolver.js'
import { web } from './hypercomb.web.js'

// -------------------------------------------------
// the processor — one owner, one pass
// -------------------------------------------------
//
// `act(grammar)` is the one door through which bees pulse. A pass asks the
// resolver for the bees of each grammar it carries, pulses them in order,
// and ends with exactly one `synchronize` (doctrine `D4`: dispatched only
// here) and one scheduled optimize phase.
//
// SINGLE FLIGHT. One pass runs at a time. A call that lands while a pass is
// running does not start a second one: it joins the ONE trailing pass, which
// carries the union of every grammar asked for meanwhile and starts the
// moment the running pass ends. `await act(g)` still means what it always
// meant — "a pass that carried g has completed, my bees have pulsed" — it
// just may share that pass with other callers.
//
// FIRST PULSES. A bee's first pulse belongs to the processor too. Once the
// first act has run, every pulse-able value registered in the shell's IoC
// afterwards is an ARRIVAL: it is pulsed once with the empty grammar inside
// the next pass (the running one if it is still going, else one scheduled
// for it), never by the module that loaded it. A bee the resolver hands to a
// pass is pulsed there and is no longer an arrival.

type Pulseable = { pulse: (grammar: string) => Promise<void> | void; iocKey?: string; name?: string }

type Trailing = {
  readonly grammars: Set<string>
  readonly promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

/** Pulses per bee per grammar, passes and synchronize dispatches since the
 *  page loaded — read under `hc:verbose=1`, or by a harness. */
export type ProcessorCensus = {
  readonly passes: number
  readonly synchronizes: number
  readonly pulses: Record<string, Record<string, number>>
}

export class hypercomb extends web {
  public override act = (grammar: string = ''): Promise<void> => hypercomb.#request(grammar)

  // -------------------------------------------------
  // the latch
  // -------------------------------------------------

  /** The pass in flight (always settles; errors reach the callers, not here). */
  static #running: Promise<void> | null = null
  /** The one pass waiting behind it. */
  static #trailing: Trailing | null = null

  static #request(grammar: string): Promise<void> {
    hypercomb.#arm()
    if (hypercomb.#running) return hypercomb.#join(grammar)
    return hypercomb.#start(new Set([grammar]))
  }

  /** Join the trailing pass; `null` asks only that arrivals be pulsed. */
  static #join(grammar: string | null): Promise<void> {
    let trailing = hypercomb.#trailing
    if (!trailing) {
      let resolve: () => void = () => {}
      let reject: (error: unknown) => void = () => {}
      const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
      trailing = { grammars: new Set(), promise, resolve, reject }
      hypercomb.#trailing = trailing
    }
    if (grammar !== null) trailing.grammars.add(grammar)
    return trailing.promise
  }

  static #start(grammars: ReadonlySet<string>): Promise<void> {
    const pass = hypercomb.#pass(grammars)
    const settled = (): void => {
      hypercomb.#running = null
      const next = hypercomb.#trailing
      if (!next) return
      hypercomb.#trailing = null
      hypercomb.#start(next.grammars).then(next.resolve, next.reject)
    }
    hypercomb.#running = pass.then(settled, settled)
    return pass
  }

  // -------------------------------------------------
  // one pass
  // -------------------------------------------------

  static #pass = async (grammars: ReadonlySet<string>): Promise<void> => {
    const fresh = hypercomb.#takeArrivals()
    if (!grammars.size && !fresh.length) return

    hypercomb.#census.passes++
    let failure: { error: unknown } | null = null
    const pulse = async (bee: Pulseable, grammar: string): Promise<void> => {
      hypercomb.#pulsed.add(bee)
      hypercomb.#count(bee, grammar)
      try { await bee.pulse(grammar) } catch (error) {
        // One failing heartbeat must not silence every bee after it. The
        // pass still rejects for whoever awaited it, with the first error.
        failure ??= { error }
      }
    }

    try {
      for (const grammar of grammars) {
        const resolver = get<BeeResolver>(BEE_RESOLVER_KEY)
        const bees = resolver ? await resolver.find(grammar) : []
        for (const bee of bees) {
          // A module may register a constructor-wired product with no pulse —
          // skip it, never throw.
          if (typeof (bee as unknown as Pulseable)?.pulse !== 'function') continue
          // A bee's first pulse is always the empty grammar — "you are here" —
          // before any word reaches it, whichever pass it first meets.
          if (grammar && !hypercomb.#pulsed.has(bee as object)) await pulse(bee as unknown as Pulseable, '')
          await pulse(bee as unknown as Pulseable, grammar)
        }
      }
      // Arrivals: what registered since the first act and has not met the
      // processor yet — including anything that registered during this pass.
      for (const bee of [...fresh, ...hypercomb.#takeArrivals()]) {
        if (hypercomb.#pulsed.has(bee)) continue
        await pulse(bee, '')
      }
    } finally {
      hypercomb.#census.synchronizes++
      window.dispatchEvent(new Event('synchronize'))
      hypercomb.#scheduleOptimize()
      hypercomb.#report(grammars)
    }
    if (failure) throw (failure as { error: unknown }).error
  }

  // -------------------------------------------------
  // arrivals — the first pulse belongs to the processor
  // -------------------------------------------------

  /** Every bee that has met the processor at least once. */
  static readonly #pulsed = new WeakSet<object>()
  /** Registered since the first act, not yet pulsed. */
  static #arrivals = new Set<Pulseable>()
  static #armed = false
  static #arrivalTimer: ReturnType<typeof setTimeout> | null = null
  static #arrivalSince = 0

  /** How long an idle processor waits for a load burst to finish registering
   *  before it pulses the arrivals — and the most it will wait in all. */
  static readonly #ARRIVAL_QUIET_MS = 40
  static readonly #ARRIVAL_CEILING_MS = 250

  /** Subscribe to the shell's registry once, on the first act. Before the
   *  first act the shell owns its boot order (what it pulses, it pulses). */
  static #arm(): void {
    if (hypercomb.#armed) return
    const ioc = (globalThis as { ioc?: { onRegister?: (cb: (key: string, value: unknown) => void) => unknown } }).ioc
    if (typeof ioc?.onRegister !== 'function') return
    hypercomb.#armed = true
    ioc.onRegister((_key, value) => {
      if (!value || typeof (value as Pulseable).pulse !== 'function') return
      if (hypercomb.#pulsed.has(value as object)) return
      hypercomb.#arrivals.add(value as Pulseable)
      hypercomb.#scheduleArrivals()
    })
  }

  static #takeArrivals(): Pulseable[] {
    if (hypercomb.#arrivalTimer) { clearTimeout(hypercomb.#arrivalTimer); hypercomb.#arrivalTimer = null }
    hypercomb.#arrivalSince = 0
    const fresh = [...hypercomb.#arrivals].filter(bee => !hypercomb.#pulsed.has(bee))
    hypercomb.#arrivals = new Set()
    return fresh
  }

  /** A running pass drains arrivals itself at its end. An idle processor
   *  waits for the burst to go quiet, then runs one arrival pass. */
  static #scheduleArrivals(): void {
    if (hypercomb.#running) return
    const now = Date.now()
    if (!hypercomb.#arrivalSince) hypercomb.#arrivalSince = now
    if (hypercomb.#arrivalTimer) clearTimeout(hypercomb.#arrivalTimer)
    const left = Math.max(0, hypercomb.#ARRIVAL_CEILING_MS - (now - hypercomb.#arrivalSince))
    hypercomb.#arrivalTimer = setTimeout(() => {
      hypercomb.#arrivalTimer = null
      if (hypercomb.#running) { void hypercomb.#join(null).catch(() => {}); return }
      void hypercomb.#start(new Set()).catch(() => {})
    }, Math.min(hypercomb.#ARRIVAL_QUIET_MS, left))
  }

  // -------------------------------------------------
  // census — pulses per bee per grammar
  // -------------------------------------------------

  static #census = { passes: 0, synchronizes: 0, pulses: new Map<string, Map<string, number>>() }
  static #verbose: boolean | null = null

  static #count(bee: Pulseable, grammar: string): void {
    const key = bee.iocKey ?? bee.name ?? (bee as object).constructor?.name ?? '?'
    let mine = hypercomb.#census.pulses.get(key)
    if (!mine) hypercomb.#census.pulses.set(key, (mine = new Map()))
    mine.set(grammar, (mine.get(grammar) ?? 0) + 1)
  }

  /** The census so far. */
  public static census(): ProcessorCensus {
    const pulses: Record<string, Record<string, number>> = {}
    for (const [key, byGrammar] of hypercomb.#census.pulses) pulses[key] = Object.fromEntries(byGrammar)
    return { passes: hypercomb.#census.passes, synchronizes: hypercomb.#census.synchronizes, pulses }
  }

  /** Under `hc:verbose=1`: one line per pass, and the full census on `window.__hcPulses()`. */
  static #report(grammars: ReadonlySet<string>): void {
    if (hypercomb.#verbose === null) {
      try { hypercomb.#verbose = globalThis.localStorage?.getItem('hc:verbose') === '1' } catch { hypercomb.#verbose = false }
      if (hypercomb.#verbose) (globalThis as { __hcPulses?: () => ProcessorCensus }).__hcPulses = hypercomb.census
    }
    if (!hypercomb.#verbose) return
    let total = 0
    for (const byGrammar of hypercomb.#census.pulses.values()) for (const n of byGrammar.values()) total += n
    console.log(`[processor] pass ${hypercomb.#census.passes}: grammars=[${[...grammars].join(', ')}] pulses so far=${total} synchronize=${hypercomb.#census.synchronizes}`)
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
