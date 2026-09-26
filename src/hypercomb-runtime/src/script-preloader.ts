// hypercomb-runtime/src/script-preloader.ts
// Marker-driven bee resolver: reads signature markers from the cell tree
// and loads bee modules on demand. The processor (hypercomb.act()) is the
// sole caller of find() → pulse → synchronize.

import { Bee, type BeeResolver, EffectBus, hypercomb, mayRunBee } from '@hypercomb/core'
import { Store } from './store'
import { installedPackageSig } from './installed-package.js'
import { packedBytes } from './boot-pack.js'
import { arrivalNames, beeClassesOfDocs, quietFeatureNames, resolveArrival, type BeeClass } from './arrival-plan.js'
import { activeInstallIndex } from './install-index.js'
import {
  learnedCriticalBeeSigs,
  parseLearnedCriticalBeeSigs,
  renderCriticalStatus,
  serializeLearnedCriticalBeeSigs,
  validateCriticalBeeHints,
} from './critical-bees.js'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}

export type ReadableArtifactDescriptor = {
  readonly name: string
  readonly sig: string
  readonly of?: 'bee' | 'dependency'
  readonly type?: string
}

export type ReadableArtifact = Required<Pick<ReadableArtifactDescriptor, 'name' | 'sig'>> & {
  readonly of: 'bee' | 'dependency'
  readonly type: string
  readonly bytes: Uint8Array
}

export type ReadableArtifactProvider = {
  entries(): Promise<readonly ReadableArtifactDescriptor[]>
  readArtifact(sig: string): Promise<ReadableArtifact | null>
}

type DeferredBeeLoads = {
  pending: readonly string[]
  loads: readonly Promise<Bee | null>[]
}

export class ScriptPreloader extends EventTarget implements BeeResolver {

  // SHA-256 of canonical JSON: [] → 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
  static readonly #EMPTY_SIGS: readonly string[] = Object.freeze([])

  private get store(): Store { return <Store>get("@hypercomb.social/Store") }

  #actions: readonly ActionDescriptor[] = []
  #actionNames: readonly string[] = []
  #resourceCount = 0
  #finding: Promise<Bee[]> | null = null

  // Angular development bundles import every bee through side-effects.ts.
  // Re-reading the installed manifest and evaluating those same modules from
  // OPFS is duplicate work, and blob-module imports cannot resolve the
  // generated absolute /opfs dependency specifiers. The dev shell supplies
  // its canonical IoC instances here before first paint instead. Angular
  // pulses them once itself; processor acts must return an empty encounter
  // list, exactly like the legacy dev shell, or every action re-pulses the
  // entire application and makes navigation pay startup cost again.
  #registeredBees: readonly Bee[] | null = null
  readonly #readableArtifactProviders: ReadableArtifactProvider[] = []
  readonly #readableArtifactReads = new Map<string, Promise<ReadableArtifact | null>>()

  // Bees pulsed at least once (either by the processor's encounter loop
  // for the first wave, or individually here once they land off the
  // critical path). Ensures every bee gets exactly one initial pulse.
  readonly #firstPulsed = new Set<string>()

  public get actions(): readonly ActionDescriptor[] { return this.#actions }
  public get actionNames(): readonly string[] { return this.#actionNames }
  public get resourceCount(): number { return this.#resourceCount }

  /** Dev mode: mark directly-imported bees as loaded so the command line unlocks. */
  public setResourceCount(count: number): void {
    this.#resourceCount = count
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Dev-shell adapter: use bees already imported and registered by Angular. */
  public useRegisteredBees(bees: readonly Bee[]): void {
    this.#registeredBees = [...new Set(bees)]
    this.setResourceCount(this.#registeredBees.length)
  }

  /** Register inert, content-addressed artifacts that the preloader did not
   * evaluate itself, such as TypeScript sources embedded in the dev source map. */
  public registerReadableArtifacts(provider: ReadableArtifactProvider): void {
    if (this.#readableArtifactProviders.includes(provider)) return
    this.#readableArtifactProviders.push(provider)
    this.#readableArtifactReads.clear()
    this.dispatchEvent(new CustomEvent('change'))
  }

  public readableArtifacts = async (): Promise<readonly ReadableArtifactDescriptor[]> => {
    const own = this.#actions.map(action => ({
      name: action.name,
      sig: action.signature,
      of: 'bee' as const,
      type: 'text/javascript',
    }))
    const provided = (await Promise.all(
      this.#readableArtifactProviders.map(provider => provider.entries().catch(() => []))
    )).flat()
    return [...own, ...provided]
  }

  public readArtifact = async (sig: string): Promise<ReadableArtifact | null> => {
    const clean = this.#stripExt(sig).toLowerCase()
    if (!this.#isSignature(clean)) return null
    const hit = this.#readableArtifactReads.get(clean)
    if (hit) return hit
    const read = (async (): Promise<ReadableArtifact | null> => {
      for (const provider of this.#readableArtifactProviders) {
        const artifact = await provider.readArtifact(clean).catch(() => null)
        if (artifact) return artifact
      }
      return null
    })()
    this.#readableArtifactReads.set(clean, read)
    return read
  }

  readonly #bySignature = new Map<string, ActionDescriptor>()
  readonly #beeCache = new Map<string, Bee>()
  readonly #loadedDeps = new Set<string>()
  /** Dependency sig → alias, rebuilt whenever the alias map is replaced. */
  #aliasBySig = new Map<string, string>()
  #aliasBySigOf: Map<string, string> | null = null
  /** Signatures the brood held back, so the refusal is said once per session. */
  readonly #heldBack = new Set<string>()
  // In-flight dedup: prevents two callers from loading the same bee concurrently
  readonly #inFlight = new Map<string, Promise<Bee | null>>()

  // one-shot boot marker: first find() call done
  static #firstFindMarked = false

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.#bySignature.get(signature)

  public getActionName = (signature: string): string | null =>
    this.#bySignature.get(signature)?.name ?? null

  // -------------------------------------------------
  // find — marker-driven, called by the processor
  // -------------------------------------------------

  /**
   * THE BOOT LANE (documentation/atomic-modules-plan.md, step 6). A boot bee
   * registers a service the runtime or the shell reads before any other bee
   * loads — the history service, the input gate. The package root names them
   * (`bootBees`, accepted from the root only, like `criticalBees`), and a
   * shell calls this right after the dependencies load, before the runtime
   * initializer and the shell itself start. Every later load finds them
   * already held. A root that names none costs one layer read. A shell that
   * keeps its own install record (meadowverse) names its root; every other
   * shell reads the live package.
   */
  public loadBootBees = async (root: string | null = installedPackageSig()): Promise<void> => {
    if (!root || !this.store) return
    let named: unknown
    try {
      const bytes = await this.store.getLayerBytes(root)
      named = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)['bootBees'] : undefined
    } catch { return }
    const sigs = (Array.isArray(named) ? named : [])
      .map(entry => this.#stripExt(String(entry ?? '')).toLowerCase())
      .filter(sig => /^[a-f0-9]{64}$/.test(sig))
    if (!sigs.length) return
    const results = await Promise.allSettled(sigs.map(sig => this.#loadBeeBySignature(sig)))
    const failed = results.filter(r => r.status === 'rejected' || !r.value).length
    console.log(`[script-preloader] boot lane: ${sigs.length - failed} of ${sigs.length} boot bees loaded`)
  }

  public find = async (_grammar: string): Promise<Bee[]> => {
    if (this.#registeredBees) {
      if (!ScriptPreloader.#firstFindMarked) {
        ScriptPreloader.#firstFindMarked = true
        console.log(`[script-preloader] using ${this.#registeredBees.length} Angular-registered bees; OPFS module walk skipped`)
        ;(window as any).__hcBoot?.('first preloader.find done (registered Angular bees; OPFS skipped)')
      }
      return []
    }

    if (this.#finding) return this.#finding

    const run = async (): Promise<Bee[]> => {
      const tFind = performance.now()

      // Layer-walk: layers are the source of truth. Union every signature
      // array they declare (bees, dependencies, resources, nested layers).
      // Falls back to the flat install-manifest bees list for legacy/dev.
      const layerRoots = ScriptPreloader.readManifestLayers()
      const tWalk = performance.now()
      let walked = layerRoots.length
        ? await this.#walkLayers(layerRoots)
        : {
            bees: ScriptPreloader.readManifestBees(),
            dependencies: ScriptPreloader.#EMPTY_SIGS,
            resources: ScriptPreloader.#EMPTY_SIGS,
            criticalBees: ScriptPreloader.#EMPTY_SIGS,
            classes: new Map<string, BeeClass>(),
          }
      // WHAT LOADS is the activation record's bee list — acquire.ts writes
      // every bee the root names minus the units the participant turned off
      // (package-units.ts). The layers say what EXISTS; the record says what
      // runs. The render-critical bees stay regardless: without them there is
      // no hive to turn anything back on from.
      const enabled = ScriptPreloader.readManifestBees()
      if (layerRoots.length && enabled.length) {
        const keep = new Set([...enabled, ...walked.criticalBees])
        walked = { ...walked, bees: walked.bees.filter(sig => keep.has(sig)) }
      }
      // FEATURES FOR PARTICIPANTS ONLY: a read-only reader never loads a bee
      // under a layer its publisher's `features:participant` pool names —
      // not at arrival, not on the approach. Decided once.
      if (layerRoots.length && (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) {
        const quiet = await this.#quietBees(layerRoots)
        if (quiet.size) walked = { ...walked, bees: walked.bees.filter(sig => !quiet.has(sig)) }
      }
      const walkMs = performance.now() - tWalk

      // Cache warming, AT IDLE AND IN SMALL BATCHES.
      //
      // Not awaiting is not the same as not costing. Measured on the native
      // client (boot IO census, real hive): by first paint the shell had read
      // 479 resources / 41.7 MB — to draw a page of NINE tiles. Every one of
      // those reads is a real store round trip that the renderer's own reads
      // then queue behind, and the whole flood is fired here, at the worst
      // possible moment, for a package whose resources mostly belong to views
      // the user has not opened.
      //
      // Preheating is a nice-to-have: `preheatResource` is just `getResource`,
      // and every consumer already works cold. So it yields — `requestIdleCallback`
      // hands us time only when the main thread has nothing better to do, which
      // is exactly the priority this deserves, and a small batch keeps the
      // transport free for reads someone is actually waiting on.
      if (walked.resources.length) this.#preheatAtIdle(walked.resources)

      // THE ARRIVAL (arrival-plan.ts): a published branch that names what
      // its arrival needs loads that and nothing more; the rest of the
      // package stays passive until the visitor approaches it.
      if (layerRoots.length) await this.#decideArrival(walked)
      if (layerRoots.length) this.#noteSleepers(walked)
      const passive = this.#passive
      const sleeping = this.#asleep()

      const tBees = performance.now()
      let deferredBeeLoads: DeferredBeeLoads | null = null
      if (walked.bees.length) {
        deferredBeeLoads = passive
          ? await this.#loadArrival(walked.bees.filter(sig => !passive.has(sig) && !sleeping.has(sig)))
          : await this.#loadBeesPrioritized(walked.bees.filter(sig => !sleeping.has(sig)), walked.criticalBees)
      }
      const beesMs = performance.now() - tBees

      // Warmup hooks (e.g. atlas seeding) — fire and forget. Drones must
      // render correctly without their warmup having completed.
      void this.#runWarmups()

      // Enforce manifest: dispose and evict bees that are no longer enabled.
      // This is the trust boundary — if DCP says a bee is off, it must not pulse.
      if (walked.bees.length) {
        const enabledSet = new Set(walked.bees)
        let evicted = false
        for (const [sig, bee] of this.#beeCache) {
          if (!enabledSet.has(sig)) {
            // Pulse-less UI drones are plain classes — markDisposed and
            // iocKey may not exist; dispose/unregister best-effort.
            const key = (bee as any)?.iocKey
            console.log(`[script-preloader] evicting disabled bee ${sig} (${key ?? '(no iocKey)'})`)
            ;(bee as any)?.markDisposed?.()
            if (typeof key === 'string' && key.length > 0) window.ioc.unregister(key)
            this.#beeCache.delete(sig)
            this.#bySignature.delete(sig)
            this.#warmedUp.delete(sig)
            this.#resourceCount = Math.max(0, this.#resourceCount - 1)
            evicted = true
          }
        }
        if (evicted) this.#refreshProjection()
      }

      const findMs = performance.now() - tFind
      const findMsg = `[script-preloader] find: total=${findMs.toFixed(0)}ms walk=${walkMs.toFixed(0)}ms bees=${beesMs.toFixed(0)}ms (${walked.bees.length}b/${walked.dependencies.length}d/${walked.resources.length}r)`
      console.log(findMsg)
      try { localStorage.setItem('hc:perf-find-last', `${Date.now()}:${findMsg}`) } catch {}

      if (!ScriptPreloader.#firstFindMarked) {
        ScriptPreloader.#firstFindMarked = true
        ;(window as any).__hcBoot?.(`first preloader.find done (total=${findMs.toFixed(0)}ms walk=${walkMs.toFixed(0)}ms bees=${beesMs.toFixed(0)}ms)`)
      }

      // Atomically assign pulse ownership. A background import can finish at
      // any microtask boundary, so taking a live cache snapshot in find() and
      // letting a separate continuation infer ownership caused timing-specific
      // double pulses. Everything in this exact snapshot belongs to the
      // processor encounter; the finisher owns only later arrivals.
      const encounterEntries = [...this.#beeCache.entries()]
        .filter(([, bee]) => typeof (bee as any)?.pulse === 'function')
      for (const [sig] of encounterEntries) this.#firstPulsed.add(sig)
      if (deferredBeeLoads) {
        this.#finishBeeLoadsInBackground(deferredBeeLoads.pending, deferredBeeLoads.loads)
      }

      // Pulse-less module products (EventTarget UI drones, constructor-wired
      // services) are legitimate cache residents but never reach the loop.
      return encounterEntries.map(([, bee]) => bee)
    }

    this.#finding = run()
    try { return await this.#finding } finally { this.#finding = null }
  }

  // -------------------------------------------------
  // the arrival — passive by default, ready at a moment's notice
  // -------------------------------------------------

  /** QUEENS ASLEEP UNTIL THEIR WORD (essentials scripts/passive-queen.ts): a
   *  queen whose loading only readies her word is not loaded until the word
   *  is used. The layer docs carry her word and description, so the command
   *  line lists and runs her without her module; `wakeWord` loads her the
   *  moment she is asked for. Keyed by bee signature. */
  readonly #sleeping = new Map<string, { command: string; description: string; className: string }>()
  readonly #woken = new Set<string>()

  /** VIEWS ASLEEP UNTIL THEY ARE ENTERED (essentials passive-queen.ts
   *  viewSleeper): a renderer that declares the views it renders, and acts
   *  nowhere else, loads when the view mode enters one of them or
   *  `view:open-for-tile` names one — then one cycle runs. */
  readonly #viewSleeping = new Map<string, { renders: readonly string[]; className: string }>()
  #viewWakeBound = false

  /** BEES ASLEEP UNTIL AN EFFECT (essentials passive-queen.ts
   *  effectSleeper): a bee that declares the effects that wake it loads when
   *  the first one is emitted; the bus replays that emission to it. */
  readonly #effectSleeping = new Map<string, { wakesOn: readonly string[]; className: string }>()
  readonly #effectWatched = new Set<string>()

  /** Every bee asleep, queens, views and effect sleepers — what no load may start. */
  #asleep = (): ReadonlySet<string> => new Set([...this.#sleeping.keys(), ...this.#viewSleeping.keys(), ...this.#effectSleeping.keys()])

  /** Wake every bee asleep for `effect`, then run one cycle. */
  #wakeOnEffect = async (effect: string): Promise<void> => {
    const sigs = [...this.#effectSleeping].filter(([, entry]) => entry.wakesOn.includes(effect)).map(([sig]) => sig)
    if (!sigs.length) return
    for (const sig of sigs) {
      this.#effectSleeping.delete(sig)
      this.#woken.add(sig)
    }
    await Promise.allSettled(sigs.map(sig => this.#wakeLoad(sig)))
    await new hypercomb().act('')
  }

  /** Subscribe once per waking effect. Replayed on subscribe: an effect
   *  already sent still wakes its bee. */
  #watchEffect = (effect: string): void => {
    if (this.#effectWatched.has(effect)) return
    this.#effectWatched.add(effect)
    EffectBus.on(effect, () => { void this.#wakeOnEffect(effect) })
  }

  /** The two ways a view is entered — the mode changes, or a tile opens it —
   *  each wake that view's renderers. Bound once. */
  #bindViewWake = (): void => {
    if (this.#viewWakeBound) return
    this.#viewWakeBound = true
    // Replayed on subscribe: a view opened before this line still wakes.
    EffectBus.on<{ view?: string }>('view:open-for-tile', payload => { void this.wakeView(String(payload?.view ?? '')) })
    const ioc = window.ioc as { whenReady?: (key: string, cb: (value: unknown) => void) => void }
    ioc.whenReady?.('@hypercomb.social/ViewMode', (value) => {
      const vm = value as EventTarget & { mode?: string }
      const enter = (): void => { void this.wakeView(String(vm.mode ?? '')) }
      vm.addEventListener?.('change', enter)
      enter()
    })
  }

  #quiet: Set<string> | null = null

  /** Every bee under a layer whose name the quiet list carries, sub-layers
   *  included — read from the walk's own layer cache. */
  #quietBees = async (roots: readonly string[]): Promise<Set<string>> => {
    if (this.#quiet) return this.#quiet
    const names = await quietFeatureNames()
    const quiet = new Set<string>()
    const seen = new Set<string>()
    const visit = (sig: string, inside: boolean): void => {
      const layer = this.#layerCache.get(this.#stripExt(sig))
      if (!layer || seen.has(sig)) return
      seen.add(sig)
      const within = inside || names.has(layer.name)
      if (within) for (const bee of layer.bees) quiet.add(bee)
      for (const child of layer.children) visit(child, within)
    }
    if (names.size) for (const root of roots) visit(this.#stripExt(root), false)
    if (quiet.size) console.log(`[script-preloader] ${quiet.size} participant-only bees never load for this reader (${[...names].join(', ')})`)
    this.#quiet = quiet
    return quiet
  }

  // -------------------------------------------------
  // the dev shell's sleepers
  // -------------------------------------------------

  /** How the dev shell loads a sleeper: the module, by its own import. */
  readonly #devLoaders = new Map<string, () => Promise<unknown>>()

  /** THE DEV SHELL SLEEPS THE SAME BEES (hypercomb-essentials
   *  sleeping-effects.ts, generated by prepare with the rules the package
   *  build uses). The dev shell imports its bees directly, so it hands over
   *  loaders instead of signatures; the same triggers wake them. */
  public useSleepers = (entries: ReadonlyArray<{
    readonly load: () => Promise<unknown>
    readonly command?: string
    readonly description?: string
    readonly renders?: readonly string[]
    readonly wakesOn?: readonly string[]
  }>): void => {
    entries.forEach((entry, index) => {
      const id = `dev:${index}`
      if (this.#devLoaders.has(id)) return
      this.#devLoaders.set(id, entry.load)
      if (entry.command) {
        this.#sleeping.set(id, { command: entry.command.toLowerCase(), description: entry.description ?? entry.command, className: entry.command })
      } else if (entry.renders?.length) {
        this.#viewSleeping.set(id, { renders: entry.renders, className: id })
      } else if (entry.wakesOn?.length) {
        this.#effectSleeping.set(id, { wakesOn: entry.wakesOn, className: id })
        for (const effect of entry.wakesOn) this.#watchEffect(effect)
      }
    })
    if (this.#viewSleeping.size) this.#bindViewWake()
    console.log(`[script-preloader] dev: ${this.#sleeping.size} queens, ${this.#viewSleeping.size} views, ${this.#effectSleeping.size} effect bees asleep`)
    EffectBus.emit('loader:sleeping', { words: this.sleepingWords() })
  }

  /** Load one sleeper: by its dev loader when it has one, by signature
   *  otherwise. The dev processor pulses no bee it did not start with, so a
   *  bee a dev module registers gets its first heartbeat here. */
  #wakeLoad = async (id: string): Promise<Bee | null> => {
    const load = this.#devLoaders.get(id)
    if (!load) return this.#loadBeeBySignature(id)
    const before = new Set(window.ioc.list())
    try { await load() } catch (err) {
      console.warn(`[script-preloader] dev sleeper ${id} failed to load:`, err)
      return null
    }
    let first: Bee | null = null
    for (const key of window.ioc.list()) {
      if (before.has(key)) continue
      const bee = window.ioc.get(key) as Bee | undefined
      if (!bee) continue
      first ??= bee
      if (typeof (bee as any).pulse === 'function') {
        try { await bee.pulse('') } catch (err) { console.warn(`[script-preloader] woken ${key} failed its first pulse:`, err) }
      }
    }
    return first
  }

  #noteSleepers = (walked: { bees: readonly string[]; classes: ReadonlyMap<string, BeeClass> }): void => {
    const inPackage = new Set(walked.bees)
    let effectSleepers = 0
    for (const [className, cls] of walked.classes) {
      if (!cls.passive || cls.command || cls.renders?.length || !cls.wakesOn?.length || !inPackage.has(cls.sig)) continue
      if (this.#beeCache.has(cls.sig) || this.#woken.has(cls.sig) || this.#effectSleeping.has(cls.sig) || this.#arrivalBees.has(cls.sig)) continue
      this.#effectSleeping.set(cls.sig, { wakesOn: cls.wakesOn, className })
      effectSleepers++
      for (const effect of cls.wakesOn) this.#watchEffect(effect)
    }
    if (effectSleepers) console.log(`[script-preloader] ${effectSleepers} bees asleep until their effect`)
    for (const [className, cls] of walked.classes) {
      if (!cls.passive || cls.command || !cls.renders?.length || !inPackage.has(cls.sig)) continue
      if (this.#beeCache.has(cls.sig) || this.#woken.has(cls.sig) || this.#viewSleeping.has(cls.sig) || this.#arrivalBees.has(cls.sig)) continue
      this.#viewSleeping.set(cls.sig, { renders: cls.renders, className })
    }
    if (this.#viewSleeping.size && !this.#viewWakeBound) {
      console.log(`[script-preloader] ${this.#viewSleeping.size} views asleep until entered`)
      this.#bindViewWake()
    }
    let added = false
    for (const [className, cls] of walked.classes) {
      if (!cls.passive || !cls.command || !inPackage.has(cls.sig)) continue
      if (this.#beeCache.has(cls.sig) || this.#woken.has(cls.sig) || this.#sleeping.has(cls.sig) || this.#arrivalBees.has(cls.sig)) continue
      this.#sleeping.set(cls.sig, { command: cls.command.toLowerCase(), description: cls.description ?? cls.command, className })
      added = true
    }
    if (!added) return
    console.log(`[script-preloader] ${this.#sleeping.size} queens asleep until their word`)
    EffectBus.emit('loader:sleeping', { words: this.sleepingWords() })
  }

  /** The words of the queens still asleep, for the command line's lists. */
  public sleepingWords = (): Array<{ command: string; description: string; className: string }> =>
    [...this.#sleeping.values()].map(entry => ({ ...entry }))

  /** Wake every renderer asleep for `view`, then run one cycle so each
   *  meets the mode it was woken into. */
  public wakeView = async (view: string): Promise<void> => {
    const wanted = String(view ?? '').trim()
    if (!wanted) return
    const sigs = [...this.#viewSleeping].filter(([, entry]) => entry.renders.includes(wanted)).map(([sig]) => sig)
    if (!sigs.length) return
    for (const sig of sigs) {
      this.#viewSleeping.delete(sig)
      this.#woken.add(sig)
    }
    await Promise.allSettled(sigs.map(sig => this.#wakeLoad(sig)))
    await new hypercomb().act('')
  }

  /** Wake the queen who answers `word`; null when none is asleep for it. */
  public wakeWord = async (word: string): Promise<Bee | null> => {
    const wanted = String(word ?? '').trim().toLowerCase()
    const found = [...this.#sleeping].find(([, entry]) => entry.command === wanted)
    if (!found) return null
    const [sig] = found
    this.#sleeping.delete(sig)
    this.#woken.add(sig)
    const bee = await this.#wakeLoad(sig)
    EffectBus.emit('loader:sleeping', { words: this.sleepingWords() })
    return bee
  }

  /** Bees the arrival left asleep. Null: no plan — every bee loads as always. */
  #passive: Set<string> | null = null
  /** What the arrival plan named — never put to sleep, whatever else holds. */
  #arrivalBees: ReadonlySet<string> = new Set()
  #arrivalDecided = false
  #arrivalCritical: readonly string[] = ScriptPreloader.#EMPTY_SIGS

  #decideArrival = async (walked: { bees: readonly string[]; criticalBees: readonly string[]; classes: ReadonlyMap<string, BeeClass> }): Promise<void> => {
    if (this.#arrivalDecided) return
    this.#arrivalDecided = true
    const names = await arrivalNames()
    if (!names) return
    const { bees, missing } = resolveArrival(names, walked.classes, new Set(walked.bees))
    if (missing.length) console.warn(`[script-preloader] arrival plan names what this package does not carry: ${missing.join(', ')}`)
    // What the arrival came to — the shell's arrival trial reports it.
    EffectBus.emit('loader:arrival', { now: bees.size, passive: bees.size ? walked.bees.length - bees.size : 0, missing })
    if (!bees.size) return
    this.#arrivalBees = bees
    this.#passive = new Set(walked.bees.filter(sig => !bees.has(sig) && !this.#beeCache.has(sig)))
    this.#arrivalCritical = walked.criticalBees
    console.log(`[script-preloader] arrival: ${bees.size} bees now, ${this.#passive.size} passive until approached`)
    // Late-value replay: an approach that happened before this line still
    // wakes them.
    EffectBus.on('loader:activate', () => { this.#activatePassive() })
    // Within range of the approach, fetch them ahead of it (#preloadPassive).
    EffectBus.on('loader:preload', () => { this.#preloadPassive() })
    this.#watchRange()
  }

  // ── WITHIN RANGE: preload what the approach would wake ─────────────────
  // A door into the hive marks itself `data-hc-approach` (the site view's
  // exit). When the reader comes within range of one — the pointer near it,
  // focus on it, a press starting on it — the passive bees are FETCHED at low
  // priority, six at a time, never run: a good chance that what the
  // approach needs is already here. The approach itself stops the queue, so
  // its own loads go first (renderers leading).

  static readonly #RANGE_PX = 160
  static readonly #PRELOAD_LANES = 6
  #preloadStarted = false
  #preloadStopped = false

  #watchRange = (): void => {
    if (typeof document === 'undefined') return
    const DOOR = '[data-hc-approach]'
    let x = 0
    let y = 0
    let frame = 0
    const stop = (): void => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('focusin', onReach, true)
      document.removeEventListener('pointerdown', onReach, true)
      if (frame) cancelAnimationFrame(frame)
    }
    const inRange = (): void => { stop(); EffectBus.emit('loader:preload', { reason: 'range' }) }
    const onReach = (event: Event): void => {
      if ((event.target as Element | null)?.closest?.(DOOR)) inRange()
    }
    const onMove = (event: PointerEvent): void => {
      x = event.clientX
      y = event.clientY
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        for (const door of document.querySelectorAll<HTMLElement>(DOOR)) {
          const box = door.getBoundingClientRect()
          if (!box.width && !box.height) continue
          const dx = Math.max(box.left - x, 0, x - box.right)
          const dy = Math.max(box.top - y, 0, y - box.bottom)
          if (Math.hypot(dx, dy) <= ScriptPreloader.#RANGE_PX) { inRange(); return }
        }
      })
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('focusin', onReach, true)
    document.addEventListener('pointerdown', onReach, true)
    EffectBus.on('loader:activate', stop)
  }

  /** Fetch (never run) the passive bees a door away. Only door-served modules
   *  have an address to preload; the renderers go first, as they wake. */
  #preloadPassive = (): void => {
    const passive = this.#passive
    if (this.#preloadStarted || this.#preloadStopped || !passive?.size) return
    if ((globalThis as { __HC_MODULE_ROOT__?: boolean }).__HC_MODULE_ROOT__ !== true) return
    this.#preloadStarted = true
    const asleep = this.#asleep()
    const pending = [...passive].filter(sig => !this.#beeCache.has(sig) && !asleep.has(sig))
    const bees = [
      ...pending.filter(sig => this.#arrivalCritical.includes(sig)),
      ...pending.filter(sig => !this.#arrivalCritical.includes(sig)),
    ]
    // Each bee's dependencies come in at load, not through its own imports
    // (#ensureDeps) — queue them just ahead of the bee.
    const depsOf = (globalThis as { __hypercombBeeDeps?: Record<string, string[]> }).__hypercombBeeDeps ?? {}
    const queued = new Set<string>()
    const ordered: string[] = []
    for (const bee of bees) {
      for (const dep of depsOf[bee] ?? []) {
        if (this.#loadedDeps.has(dep) || queued.has(dep)) continue
        queued.add(dep)
        ordered.push(dep)
      }
      if (!queued.has(bee)) { queued.add(bee); ordered.push(bee) }
    }
    const integrity = (globalThis as { __hypercombImportIntegrity?: Record<string, string> }).__hypercombImportIntegrity ?? {}
    console.log(`[script-preloader] within range: preloading ${bees.length} passive bees, ${ordered.length - bees.length} dependencies`)
    let next = 0
    const lane = async (): Promise<void> => {
      while (next < ordered.length && !this.#preloadStopped) {
        const sig = ordered[next++]
        await new Promise<void>(resolve => {
          const link = document.createElement('link')
          link.rel = 'modulepreload'
          link.href = `/${sig}`
          link.setAttribute('fetchpriority', 'low')
          const hash = integrity[`/${sig}`]
          if (hash) link.integrity = hash
          link.onload = link.onerror = () => resolve()
          document.head.append(link)
        })
      }
    }
    for (let i = 0; i < ScriptPreloader.#PRELOAD_LANES; i++) void lane()
  }

  /** Load exactly the arrival's bees, together, and hand them to the
   *  background finisher — which pulses them and says `loader:bees-done`
   *  for this arrival, so nothing downstream waits on the whole package. */
  #loadArrival = async (sigs: readonly string[]): Promise<DeferredBeeLoads | null> => {
    const pending = sigs.filter(sig => this.#isSignature(sig) && !this.#beeCache.has(sig))
    if (!pending.length) return null
    const loads = pending.map(sig => this.#loadBeeBySignature(sig))
    await Promise.allSettled(loads)
    return { pending, loads }
  }

  /** The visitor approached the rest (it left the page for the hive, or a
   *  bee asked): wake every passive bee — the renderers first, so the hive
   *  paints while the others arrive — then run one cycle, trunk to leaf, so
   *  every bee (the woken ones included) meets the place the visitor is in. */
  #activatePassive = (): void => {
    // The approach outranks the preload: stop feeding it.
    this.#preloadStopped = true
    const passive = this.#passive
    if (!passive?.size) return
    this.#passive = new Set()
    // A queen asleep until her word stays asleep: stepping into the hive is
    // not asking for her.
    const asleep = this.#asleep()
    const pending = [...passive].filter(sig => !this.#beeCache.has(sig) && !asleep.has(sig))
    if (!pending.length) return
    console.log(`[script-preloader] approached: waking ${pending.length} passive bees`)
    const first = pending.filter(sig => this.#arrivalCritical.includes(sig))
    const rest = pending.filter(sig => !this.#arrivalCritical.includes(sig))
    void (async () => {
      const firstLoads = first.map(sig => this.#loadBeeBySignature(sig))
      await Promise.allSettled(firstLoads)
      const loads = [...firstLoads, ...rest.map(sig => this.#loadBeeBySignature(sig))]
      this.#finishBeeLoadsInBackground(pending, loads)
      await Promise.allSettled(loads)
      await new hypercomb().act('')
    })()
  }

  /** Resources already queued for preheat — the walk repeats across finds,
   *  and re-reading what a previous pass already warmed is pure waste. */
  readonly #preheated = new Set<string>()

  /** Feed the preheat queue during idle time, `#PREHEAT_BATCH` at a time,
   *  waiting for each batch before asking for the next slice. */
  #preheatAtIdle = (sigs: readonly string[]): void => {
    const queue = sigs.filter(sig => !this.#preheated.has(sig))
    if (!queue.length) return
    for (const sig of queue) this.#preheated.add(sig)

    // No idle callback (older Safari, some workers) — a plain delay still
    // gets the flood off the first-paint path, which is the whole point.
    const whenIdle: (run: () => void) => void =
      typeof (globalThis as any).requestIdleCallback === 'function'
        ? run => (globalThis as any).requestIdleCallback(() => run())
        : run => { setTimeout(run, ScriptPreloader.#PREHEAT_FALLBACK_MS) }

    const pump = (): void => {
      const batch = queue.splice(0, ScriptPreloader.#PREHEAT_BATCH)
      if (!batch.length) return
      void Promise.allSettled(batch.map(sig => this.store.preheatResource(sig)))
        .then(() => { if (queue.length) whenIdle(pump) })
    }
    whenIdle(pump)
  }

  static readonly #PREHEAT_BATCH = 4
  static readonly #PREHEAT_FALLBACK_MS = 1500

  // -------------------------------------------------
  // layer walk — layers are the source of truth
  // -------------------------------------------------

  readonly #warmedUp = new Set<string>()

  // Per-signature parse cache. Layer sigs are immutable by definition
  // (SHA-256 of canonical bytes), so once parsed the structure is forever
  // valid — there is no invalidation case. Subsequent walks reuse the
  // arrays directly with no OPFS read and no JSON parse.
  readonly #layerCache = new Map<string, {
    bees: string[]
    dependencies: string[]
    resources: string[]
    children: string[]
    name: string
    criticalBees?: unknown
    classes: Array<[string, BeeClass]>
  }>()

  #walkLayers = async (
    roots: string[]
  ): Promise<{ bees: string[]; dependencies: string[]; resources: string[]; criticalBees: string[]; classes: Map<string, BeeClass> }> => {
    const visited = new Set<string>()
    const classes = new Map<string, BeeClass>()
    const bees = new Set<string>()
    const dependencies = new Set<string>()
    const resources = new Set<string>()
    const activeRoot = installedPackageSig()
    let rootCriticalBees: unknown

    let opfsReads = 0
    let cacheHits = 0
    let opfsMs = 0
    let parseMs = 0

    const visit = async (sig: string): Promise<void> => {
      const clean = this.#stripExt(sig)
      if (!clean || visited.has(clean)) return
      visited.add(clean)

      let parsed = this.#layerCache.get(clean)
      if (parsed) {
        cacheHits++
      } else {
        const tOpfs = performance.now()
        const bytes = await this.store.getLayerBytes(clean)
        opfsMs += performance.now() - tOpfs
        opfsReads++
        if (!bytes) {
          console.warn(`[script-preloader] layer ${clean} not found in OPFS`)
          return
        }

        const tParse = performance.now()
        try {
          const layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
          // `cells` is the current signed-layer shape. `layers` remains a
          // read-only fallback for packages emitted before the rename.
          const childRefs = Array.isArray(layer['cells']) ? layer['cells'] : layer['layers']
          parsed = {
            bees: ((layer['bees'] as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
            dependencies: ((layer['dependencies'] as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
            resources: ((layer['resources'] as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
            children: ((childRefs as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
            name: String(layer['name'] ?? ''),
            criticalBees: layer['criticalBees'],
            classes: beeClassesOfDocs(layer['docs']),
          }
          this.#layerCache.set(clean, parsed)
        } catch (err) {
          console.warn(`[script-preloader] failed to parse layer ${clean}:`, err)
          return
        }
        parseMs += performance.now() - tParse
      }

      for (const b of parsed.bees) bees.add(b)
      for (const d of parsed.dependencies) dependencies.add(d)
      for (const r of parsed.resources) resources.add(r)
      for (const [name, cls] of parsed.classes) if (!classes.has(name)) classes.set(name, cls)
      // Startup intent is accepted only from the package root. Child-layer
      // fields are ordinary unknown metadata, so they can never influence
      // scheduling even if an older/custom publisher happens to use the name.
      if (activeRoot && clean === activeRoot) rootCriticalBees = parsed.criticalBees

      await Promise.all(parsed.children.map(visit))
    }

    await Promise.all(roots.map(visit))

    console.log(`[script-preloader] walkLayers: ${visited.size} layers (${opfsReads} OPFS reads = ${opfsMs.toFixed(0)}ms, ${cacheHits} cache hits, parse ${parseMs.toFixed(0)}ms)`)

    const enabledBees = [...bees].filter(Boolean)
    const criticalBees = validateCriticalBeeHints(rootCriticalBees, enabledBees)
    if (rootCriticalBees !== undefined && !criticalBees) {
      console.warn('[script-preloader] ignoring invalid root criticalBees hint; using validated fallback scheduling')
    }

    return {
      bees: enabledBees,
      dependencies: [...dependencies].filter(Boolean),
      resources: [...resources].filter(Boolean),
      criticalBees: criticalBees ?? [],
      classes,
    }
  }

  #runWarmups = async (): Promise<void> => {
    const pending: Promise<void>[] = []
    for (const [sig, bee] of this.#beeCache) {
      if (this.#warmedUp.has(sig)) continue
      this.#warmedUp.add(sig)
      if (typeof bee.warmup !== 'function') continue
      const result = bee.warmup()
      if (result instanceof Promise) {
        pending.push(result.catch(err =>
          console.warn(`[script-preloader] warmup failed for ${bee.iocKey}:`, err)))
      }
    }
    if (pending.length) {
      EffectBus.emit('loader:warmup-progress', { count: pending.length })
      await Promise.allSettled(pending)
      EffectBus.emit('loader:warmup-done', { count: pending.length })
    }
  }

  #stripExt = (s: string): string =>
    typeof s === 'string' ? s.replace(/\.(js|json)$/i, '') : ''

  // -------------------------------------------------
  // manifest-driven loading (primary path)
  // -------------------------------------------------

  private static readManifestLayers(): string[] {
    try {
      const raw = localStorage.getItem('core-adapter.installed-manifest')
      if (!raw) return []
      const manifest = JSON.parse(raw)
      return Array.isArray(manifest?.layers) ? manifest.layers.filter(Boolean) : []
    } catch {
      return []
    }
  }

  private static readManifestBees(): string[] {
    try {
      const raw = localStorage.getItem('core-adapter.installed-manifest')
      if (!raw) return []
      const manifest = JSON.parse(raw)
      return Array.isArray(manifest?.bees) ? manifest.bees.filter(Boolean) : []
    } catch {
      return []
    }
  }

  /**
   * Priority-aware bee loading.
   *
   * Two strategies, picked from package-bound metadata:
   *
   *   FAST PATH: the signed package root names the render-critical sigs
   *     (or an older package has a package-bound learned cache). Load JUST
   *     those in wave 1, awaited. The remaining
   *     ~48 bees start AFTER critical finishes, in background. Critical
   *     gets exclusive use of the browser's eval thread for ~6 modules
   *     instead of competing with 48 — empirically the difference between
   *     ~400ms (everything jammed in parallel) and ~50ms (just critical).
   *
   *   COLD PATH (no usable hint): we don't know which sigs map to critical
   *     IoC keys yet, so we fall back to the onRegister race — start all
   *     loads, resolve as soon as the six critical keys appear. Slower
   *     than the warm path, but populates the cache so the next boot is
   *     fast.
   *
   * Non-critical bees that arrive after find() returns get their own
   * first pulse from the background continuation — drones whose
   * heartbeat wires EffectBus listeners (NostrMeshDrone, PairedChannelDrone)
   * require this or their listeners never register.
   */
  #loadBeesPrioritized = async (
    sigs: readonly string[],
    signedCriticalBees: readonly string[],
  ): Promise<DeferredBeeLoads | null> => {
    const pending = sigs.filter(sig => sig && this.#isSignature(sig) && !this.#beeCache.has(sig))
    if (!pending.length) return null

    EffectBus.emit('loader:bees-progress', { loading: pending.length, total: this.#beeCache.size + pending.length })

    const learnedCritical = signedCriticalBees.length
      ? ScriptPreloader.#EMPTY_SIGS
      : ScriptPreloader.#readLearnedCriticalSigs(sigs)
    const criticalSource = signedCriticalBees.length ? 'signed root' : 'learned cache'
    const criticalSet = new Set(
      (signedCriticalBees.length ? signedCriticalBees : learnedCritical)
        .filter(sig => sigs.includes(sig)),
    )

    // ── FAST PATH ────────────────────────────────────────────────
    if (criticalSet.size > 0) {
      const criticalPending = pending.filter(sig => criticalSet.has(sig))
      const restPending = pending.filter(sig => !criticalSet.has(sig))

      const tWave1 = performance.now()
      const criticalLoads = criticalPending.map(sig => this.#loadBeeBySignature(sig))
      await Promise.allSettled(criticalLoads)
      const wave1Ms = performance.now() - tWave1
      const status = renderCriticalStatus(window.ioc)

      if (status.ready) {
        const fastMsg = `[script-preloader] FAST ${criticalSource} wave (${criticalPending.length}) loaded in ${wave1Ms.toFixed(0)}ms; ${restPending.length} backgrounded`
        console.log(fastMsg)
        try { localStorage.setItem('hc:perf-last-boot', `${Date.now()}:${fastMsg}`) } catch {}

        const restLoads = restPending.map(sig => this.#loadBeeBySignature(sig))
        return { pending, loads: [...criticalLoads, ...restLoads] }
      }

      // A hint is scheduling advice, never a readiness assertion. If a
      // critical module failed or the hint was incomplete, start everything
      // else and use the same readiness/all-settled gate as a cold boot.
      if (!signedCriticalBees.length) ScriptPreloader.#clearLearnedCriticalSigs()
      console.warn(
        `[script-preloader] ${criticalSource} wave incomplete after ${wave1Ms.toFixed(0)}ms; ` +
        `falling back (${ScriptPreloader.#formatMissingCritical(status.missing)})`,
      )

      const tFallback = performance.now()
      const fallback = await this.#loadUntilRenderCritical(restPending)
      const fallbackMs = performance.now() - tFallback

      const fallbackMsg = fallback.ready
        ? `[script-preloader] FALLBACK critical services ready in ${fallbackMs.toFixed(0)}ms`
        : `[script-preloader] FALLBACK all bees settled in ${fallbackMs.toFixed(0)}ms with critical services missing: ${ScriptPreloader.#formatMissingCritical(fallback.missing)}`
      console.log(fallbackMsg)
      try { localStorage.setItem('hc:perf-last-boot', `${Date.now()}:${fallbackMsg}`) } catch {}
      return { pending, loads: [...criticalLoads, ...fallback.loads] }
    }

    // ── COLD PATH (no cache yet) ─────────────────────────────────
    const tCriticalStart = performance.now()
    const cold = await this.#loadUntilRenderCritical(pending)
    const criticalMs = performance.now() - tCriticalStart

    const coldMsg = cold.ready
      ? `[script-preloader] COLD critical services ready in ${criticalMs.toFixed(0)}ms; populating package-bound cache`
      : `[script-preloader] COLD all bees settled in ${criticalMs.toFixed(0)}ms with critical services missing: ${ScriptPreloader.#formatMissingCritical(cold.missing)}`
    console.log(coldMsg)
    try { localStorage.setItem('hc:perf-last-boot', `${Date.now()}:${coldMsg}`) } catch {}
    return { pending, loads: cold.loads }
  }

  /** Install the readiness listener before module evaluation starts, then
   *  return as soon as the visual prerequisites register or every requested
   *  module settles. The latter keeps a broken package diagnosable without
   *  turning startup into an infinite wait. */
  #loadUntilRenderCritical = async (
    sigs: readonly string[],
  ): Promise<{ loads: Promise<Bee | null>[]; ready: boolean; missing: ReadonlyArray<ReadonlyArray<string>> }> => {
    let signalled = false
    let signalReady: () => void = () => { /* assigned by the promise */ }
    const criticalReady = new Promise<void>(resolve => { signalReady = resolve })
    const check = (): void => {
      if (signalled || !renderCriticalStatus(window.ioc).ready) return
      signalled = true
      signalReady()
    }

    let unsubscribe: (() => void) | undefined
    try { unsubscribe = window.ioc.onRegister?.(() => { check() }) } catch { /* all-settled remains the fallback */ }
    check()

    const loads = sigs.map(sig => this.#loadBeeBySignature(sig))
    try {
      await Promise.race([
        criticalReady,
        Promise.allSettled(loads).then(() => undefined),
      ])
    } finally {
      unsubscribe?.()
    }

    const status = renderCriticalStatus(window.ioc)
    return { loads, ...status }
  }

  #finishBeeLoadsInBackground = (
    pending: readonly string[],
    loads: readonly Promise<Bee | null>[],
  ): void => {
    void (async () => {
      await Promise.allSettled(loads)
      for (const [sig, bee] of this.#beeCache) {
        if (this.#firstPulsed.has(sig)) continue
        this.#firstPulsed.add(sig)
        // Pulse-less entries are legitimate: EventTarget UI drones
        // (palette, toast, notes…) are constructor-wired and don't
        // participate in the pulse cycle.
        if (typeof (bee as any)?.pulse !== 'function') continue
        try { await bee.pulse('') } catch (err) {
          console.warn(`[script-preloader] late pulse failed for ${bee.iocKey}:`, err)
        }
      }
      this.#refreshProjection()
      ScriptPreloader.#updateLearnedCriticalSigs(this.#beeCache)
      const loaded = pending.filter(sig => this.#beeCache.has(sig)).length
      EffectBus.emit('loader:bees-done', {
        loaded,
        failed: pending.length - loaded,
        total: this.#beeCache.size,
      })
    })()
  }

  static #formatMissingCritical(missing: ReadonlyArray<ReadonlyArray<string>>): string {
    return missing
      .map(group => group.map(key => key.split('/').pop() ?? key).join('|'))
      .join(', ')
  }

  /** Read learned critical-bee sigs only when they belong to this exact live
   *  package and remain members of its signed bee inventory. */
  static #readLearnedCriticalSigs(enabled: Iterable<string>): readonly string[] {
    try {
      const packageSig = installedPackageSig()
      const raw = localStorage.getItem('hc:critical-bee-sigs')
      if (!packageSig || !raw) return []
      return parseLearnedCriticalBeeSigs(raw, packageSig, enabled) ?? []
    } catch { return [] }
  }

  static #clearLearnedCriticalSigs(): void {
    try { localStorage.removeItem('hc:critical-bee-sigs') } catch { /* best-effort cache */ }
  }

  /** Persist a complete sig→class mapping for render-critical bees so an
   *  older package with no signed hint can hit the fast path next boot.
   *  Names come from iocKey (or constructor.name), never instance identity,
   *  and the cache is bound to the exact installed package signature. */
  static #updateLearnedCriticalSigs(beeCache: Map<string, Bee>): void {
    try {
      const packageSig = installedPackageSig()
      const sigs = learnedCriticalBeeSigs(beeCache)
      if (!packageSig || !sigs) return
      localStorage.setItem(
        'hc:critical-bee-sigs',
        serializeLearnedCriticalBeeSigs(packageSig, sigs),
      )
      console.log(`[script-preloader] cached ${sigs.length} package-bound critical bee signatures`)
    } catch (err) {
      console.warn('[script-preloader] failed to persist critical bee sigs:', err)
    }
  }

  #loadBeesFromList = async (sigs: string[]): Promise<void> => {
    const pending = sigs.filter(sig => sig && this.#isSignature(sig) && !this.#beeCache.has(sig))
    if (!pending.length) return

    EffectBus.emit('loader:bees-progress', { loading: pending.length, total: this.#beeCache.size + pending.length })

    const results = await Promise.allSettled(
      pending.map(sig => this.#loadBeeBySignature(sig))
    )
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value !== null).length

    if (loaded) {
      this.#refreshProjection()
      EffectBus.emit('loader:bees-done', { loaded, failed: pending.length - loaded, total: this.#beeCache.size })
    }
  }

  #loadBeeBySignature = async (signature: string): Promise<Bee | null> => {
    if (this.#beeCache.has(signature)) return this.#beeCache.get(signature)!
    const existing = this.#inFlight.get(signature)
    if (existing) return existing

    const promise = this.#tryLoadBee(signature)
    this.#inFlight.set(signature, promise)
    try {
      return await promise
    } finally {
      this.#inFlight.delete(signature)
    }
  }

  #tryLoadBee = async (signature: string): Promise<Bee | null> => {
    // THE BROOD GATE (core/brood.ts). This is the one point where a signature
    // becomes running code, so it is the one place worth asking. Held and
    // unruled — or refused — never evaluates; nothing else in this method has
    // run yet, so the bytes are not even read. Anything never held passes
    // straight through: the brood adds a gate, it does not replace admission.
    if (!(await mayRunBee(signature))) {
      if (!this.#heldBack.has(signature)) {
        this.#heldBack.add(signature)
        console.warn(`[script-preloader] bee ${signature.slice(0, 12)}… is held in the brood — accept it by hand before it can run`)
      }
      return null
    }
    const tStart = performance.now()
    let tOpfs = 0, tDeps = 0, tEval = 0

    // sign('bees') pool first ({sig}.js then bare {sig}), then the same
    // names in the legacy `__bees__` drain dir while the Store's detached
    // absorb is still emptying it. Content-addressed — any hit is the
    // same bytes.
    let handle: FileSystemFileHandle | null = null
    for (const dir of [this.store.bees, this.store.legacyBees]) {
      if (!dir) continue
      for (const name of [`${signature}.js`, signature]) {
        try { handle = await dir.getFileHandle(name); break } catch { /* keep falling back */ }
      }
      if (handle) break
    }
    // A VISITOR INSTALLED FROM THE INDEX holds no modules (install-index.ts):
    // the bee is imported from the door by its signature — no bytes needed
    // where the door serves modules at the root, fetched from it otherwise.
    let buffer: ArrayBuffer
    const held = handle
    if (held) {
      const bytes = await packedBytes(signature, async () => new Uint8Array(await (await held.getFile()).arrayBuffer()))
      buffer = bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : new ArrayBuffer(0)
    } else if (activeInstallIndex()) {
      buffer = (globalThis as { __HC_MODULE_ROOT__?: boolean }).__HC_MODULE_ROOT__ === true
        ? new ArrayBuffer(0)
        : await fetch(`/content/${signature}`).then(res => res.ok ? res.arrayBuffer() : new ArrayBuffer(0)).catch(() => new ArrayBuffer(0))
    } else {
      console.warn(`[script-preloader] bee ${signature} not found in OPFS`)
      return null
    }
    tOpfs = performance.now() - tStart

    // Ensure namespace dependencies are loaded before the bee
    const tDepsStart = performance.now()
    await this.#ensureDeps(signature)
    tDeps = performance.now() - tDepsStart

    const tEvalStart = performance.now()
    const bee = await this.store.getBee(signature, buffer)
    tEval = performance.now() - tEvalStart
    if (!bee) {
      console.warn(`[script-preloader] bee ${signature} returned null from getBee()`)
      return null
    }

    // store.getBee evaluates the bee module, whose top-level side-effect
    // already called `register(iocKey, new SomeDrone())` and returned that
    // SAME instance. So `bee` here === window.ioc.get(bee.iocKey).
    // We do NOT call markDisposed() on it — that would dispose the live
    // instance everyone else (PanningDrone, ZoomDrone, …) is pointing at.
    // IoC registration is FIRST-WINS, and ioc.web's register DISPOSES a
    // rejected different instance (ghost cleanup). This alias write passes
    // the LIVE canonical instance, so it must never reach that disposal
    // path: only register when the computed key is free. An occupied
    // alias (two bundles whose classes share a name) just keeps its first
    // holder. Guard: a bee whose iocKey can't resolve (no namespace /
    // constructor name) must not register under the literal "undefined".
    const aliasKey = (bee as any)?.iocKey
    if (typeof aliasKey === 'string' && aliasKey.length > 0 && window.ioc.get(aliasKey) === undefined) {
      register(aliasKey, bee)
    }

    this.#bySignature.set(signature, { signature, name: bee.name ?? signature })
    this.#beeCache.set(signature, bee)
    this.#resourceCount++
    this.dispatchEvent(new CustomEvent('change'))

    const total = performance.now() - tStart
    // Only log slow bees (>30ms) to keep console quiet on the common case.
    if (total > 30) {
      console.log(`[script-preloader] SLOW ${total.toFixed(0)}ms (opfs=${tOpfs.toFixed(0)} deps=${tDeps.toFixed(0)} eval=${tEval.toFixed(0)}) ${bee.iocKey}`)
    }
    return bee
  }

  // -------------------------------------------------
  // lazy dep loading — ensures namespace deps are
  // imported before a bee that needs them
  // -------------------------------------------------

  #ensureDeps = async (beeSig: string): Promise<void> => {
    const map = (globalThis as any).__hypercombBeeDeps as Record<string, string[]> | undefined
    if (!map) return
    const needed = map[beeSig]
    if (!needed?.length) return

    const aliasMap = (globalThis as any).__hypercombAliasMap as Map<string, string> | undefined
    if (!aliasMap) return

    // Reverse index, once per alias map. Its values may carry the .js suffix
    // (stored as filenames); the index is keyed on the bare signature.
    if (this.#aliasBySigOf !== aliasMap) {
      this.#aliasBySig = new Map([...aliasMap].map(([alias, sig]) => [sig.replace(/\.js$/i, ''), alias]))
      this.#aliasBySigOf = aliasMap
    }

    // ALL AT ONCE (bee-deps.ts). The list holds the bee's whole atom closure,
    // so every module in it is asked for together; one at a time, or left to
    // the bee's own imports, each level of an import chain waits for the level
    // above to arrive. Evaluation order is still the module graph's own.
    await Promise.all(needed.filter(depSig => !this.#loadedDeps.has(depSig)).map(async depSig => {
      const alias = this.#aliasBySig.get(depSig)
      if (!alias) {
        console.warn(`[script-preloader] no alias found for dep ${depSig} (bee ${beeSig})`)
        return
      }
      try {
        await import(/* @vite-ignore */ alias)
        this.#loadedDeps.add(depSig)
      } catch (err) {
        console.warn(`[script-preloader] failed to load dep ${depSig} for bee ${beeSig}:`, err)
      }
    }))
  }

  // -------------------------------------------------
  // preload (legacy — state reset only)
  // -------------------------------------------------

  public preload = async (): Promise<void> => {
    this.#bySignature.clear()
    this.#beeCache.clear()
    this.#warmedUp.clear()
    this.#actions = []
    this.#actionNames = []
    this.#resourceCount = 0
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -------------------------------------------------
  // projections
  // -------------------------------------------------

  #refreshProjection = (): void => {
    const list = [...this.#bySignature.values()].sort((a, b) => a.name.localeCompare(b.name))
    this.#actions = list
    this.#actionNames = list.map(a => (a.name ?? '').replace(/-/g, ' '))
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -------------------------------------------------
  // utilities
  // -------------------------------------------------

  #isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)
}

register('@hypercomb.social/ScriptPreloader', new ScriptPreloader())
console.log('[hypercomb] script-preloader: cache-hit-quiet (2026-05-01)')
