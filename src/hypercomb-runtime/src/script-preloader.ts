// hypercomb-runtime/src/script-preloader.ts
// Marker-driven bee resolver: reads signature markers from the cell tree
// and loads bee modules on demand. The processor (hypercomb.act()) is the
// sole caller of find() → pulse → synchronize.

import { Bee, type BeeResolver, EffectBus, hypercomb, mayRunBee } from '@hypercomb/core'
import { Store } from './store'
import { installedPackageSig } from './installed-package.js'
import { arrivalNames, beeClassesOfDocs, guardArrival, quietFeatureNames, resolveArrival, type BeeClass } from './arrival-plan.js'
import { hiveArrival, selectedHive } from './hive.js'
import { cutHive, mintHive, saveHive, validateHive, type HiveProblem } from './hive-author.js'
import { exportSurfaceSignature, liveCoreExports } from './core-surface.js'
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

type WalkedPackage = {
  bees: readonly string[]
  dependencies: readonly string[]
  resources: readonly string[]
  criticalBees: readonly string[]
  classes: ReadonlyMap<string, BeeClass>
}

export class ScriptPreloader extends EventTarget implements BeeResolver {

  // SHA-256 of canonical JSON: [] → 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
  static readonly #EMPTY_SIGS: readonly string[] = Object.freeze([])

  private get store(): Store { return <Store>get("@hypercomb.social/Store") }

  #actions: readonly ActionDescriptor[] = []
  #actionNames: readonly string[] = []
  #resourceCount = 0
  #finding: Promise<Bee[]> | null = null

  // THE WALK, ONCE PER PACKAGE. What the layers declare can change only when
  // the install pointer or the manifest text changes, so the manifest is
  // parsed and the layers walked once per such key — never per act. The
  // negative cache rides the same key: a bee that failed to load is reported
  // once and not asked for again until the package changes.
  #packageKey: string | null = null
  #manifest: { layers: string[]; bees: string[]; dependencies: string[] } = { layers: [], bees: [], dependencies: [] }
  #walked: WalkedPackage | null = null
  /** Bee signature → why it did not load (not found, null product, threw). */
  readonly #failed = new Map<string, unknown>()

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
      // Done once per package (see #readManifest): a later act finds the
      // walk already held and pays only for what is still unloaded.
      const manifest = this.#readManifest()
      const layerRoots = manifest.layers
      const tWalk = performance.now()
      const fresh = !this.#walked
      let walked: WalkedPackage = this.#walked ?? (layerRoots.length
        ? await this.#walkLayers(layerRoots)
        : {
            bees: manifest.bees,
            dependencies: ScriptPreloader.#EMPTY_SIGS,
            resources: ScriptPreloader.#EMPTY_SIGS,
            criticalBees: ScriptPreloader.#EMPTY_SIGS,
            classes: new Map<string, BeeClass>(),
          })
      if (fresh) {
        // WHAT LOADS is the activation record's bee list — acquire.ts writes
        // every bee the root names minus the units the participant turned off
        // (package-units.ts). The layers say what EXISTS; the record says what
        // runs. The render-critical bees stay regardless: without them there is
        // no hive to turn anything back on from.
        const enabled = manifest.bees
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
        this.#walked = walked
        this.#package = { classes: walked.classes, bees: new Set(walked.bees) }
        // A package turned off while the hive runs (recompose) takes its
        // sleepers with it: what no longer runs must not be woken either.
        if (layerRoots.length) this.#dropSleepersOutside(new Set(walked.bees))
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
      if (fresh && walked.resources.length) this.#preheatAtIdle(walked.resources)

      // THE ARRIVAL (arrival-plan.ts): a published branch that names what
      // its arrival needs loads that and nothing more; the rest of the
      // package stays passive until the visitor approaches it.
      if (fresh && layerRoots.length) await this.#decideArrival(walked)
      if (fresh && layerRoots.length) this.#noteSleepers(walked)
      const passive = this.#passive
      const sleeping = this.#asleep()

      const tBees = performance.now()
      let deferredBeeLoads: DeferredBeeLoads | null = null
      if (walked.bees.length) {
        deferredBeeLoads = passive
          ? await this.#loadArrival(walked.bees.filter(sig => !passive.has(sig) && !this.#idleHive.has(sig) && !sleeping.has(sig)))
          : await this.#loadBeesPrioritized(walked.bees.filter(sig => !sleeping.has(sig)), walked.criticalBees)
      }
      const beesMs = performance.now() - tBees

      // Warmup hooks (e.g. atlas seeding) — fire and forget. Drones must
      // render correctly without their warmup having completed.
      void this.#runWarmups()

      // Enforce manifest: dispose and evict bees that are no longer enabled.
      // This is the trust boundary — if DCP says a bee is off, it must not pulse.
      // The enabled set changes only with the package key, so a held walk
      // has nothing to evict.
      if (fresh && walked.bees.length) {
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
            this.#dismissCompany(sig, bee)
            this.#beeCache.delete(sig)
            this.#bySignature.delete(sig)
            this.#warmedUp.delete(sig)
            this.#retired.add(sig)
            this.#resourceCount = Math.max(0, this.#resourceCount - 1)
            evicted = true
          }
        }
        if (evicted) this.#refreshProjection()
      }

      const findMs = performance.now() - tFind
      // Said when something happened: a walk, or loads. A held walk with
      // nothing to load is the common act and stays quiet.
      if (fresh || deferredBeeLoads) {
        console.log(`[script-preloader] find: total=${findMs.toFixed(0)}ms walk=${walkMs.toFixed(0)}ms bees=${beesMs.toFixed(0)}ms (${walked.bees.length}b/${walked.dependencies.length}d/${walked.resources.length}r)${this.#failed.size ? ` ${this.#failed.size} failed` : ''}`)
      }

      if (!ScriptPreloader.#firstFindMarked) {
        ScriptPreloader.#firstFindMarked = true
        ;(window as any).__hcBoot?.(`first preloader.find done (total=${findMs.toFixed(0)}ms walk=${walkMs.toFixed(0)}ms bees=${beesMs.toFixed(0)}ms)`)
      }

      // This exact snapshot is the processor's pass. A bee that lands after
      // it (a background import finishing at any later microtask) is an
      // ARRIVAL: the processor hears its registration and gives it its first
      // pulse itself (core/hypercomb.ts) — nothing here pulses.
      const encounterEntries = [...this.#beeCache.entries()]
        .filter(([, bee]) => typeof (bee as any)?.pulse === 'function')
      if (deferredBeeLoads) {
        this.#finishBeeLoadsInBackground(deferredBeeLoads.pending, deferredBeeLoads.loads)
      }
      if (this.#idleHive.size) this.#loadIdleHive()

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

  /** Forget every sleeper the selection no longer runs. The dev shell's own
   *  sleepers (keyed by loader, never by signature) are not the package's. */
  #dropSleepersOutside = (enabled: ReadonlySet<string>): void => {
    const gone = (sig: string): boolean => !this.#devLoaders.has(sig) && !enabled.has(sig)
    let words = false
    for (const sig of [...this.#sleeping.keys()]) if (gone(sig)) { this.#sleeping.delete(sig); words = true }
    for (const sig of [...this.#viewSleeping.keys()]) if (gone(sig)) this.#viewSleeping.delete(sig)
    for (const sig of [...this.#effectSleeping.keys()]) if (gone(sig)) this.#effectSleeping.delete(sig)
    for (const sig of [...this.#woken]) if (gone(sig)) this.#woken.delete(sig)
    for (const sig of [...(this.#passive ?? [])]) if (gone(sig)) this.#passive!.delete(sig)
    for (const sig of [...this.#idleHive]) if (gone(sig)) this.#idleHive.delete(sig)
    if (words) EffectBus.emit('loader:sleeping', { words: this.sleepingWords() })
  }

  // -------------------------------------------------
  // a bee's company — what its module registered beside it
  // -------------------------------------------------
  //
  // THE BEE WIRES (essentials atomic-modules-plan.md): a bee's module registers
  // its own queen and services at module scope, so switching the bee off while
  // the hive runs must take them too — or the word of a game that is off still
  // answers. A module evaluates in one synchronous run, so every registration
  // made before the next microtask belongs to one module: that run is the
  // bee's company. Two bees found in one run cannot be told apart (`owners`),
  // and recompose then leaves the switch to a restart.

  /** One synchronous run of registrations. */
  #run: { keys: string[]; owners: number } | null = null
  readonly #runOf = new WeakMap<object, { keys: string[]; owners: number }>()
  /** Bee signature → the run its instance registered in. */
  readonly #company = new Map<string, { keys: string[]; owners: number }>()
  #watching = 0
  #unwatchRegistrations: (() => void) | null = null

  /** Listen for registrations while at least one bee is being evaluated. */
  #watchRegistrations = (): (() => void) => {
    if (this.#watching++ === 0) {
      try {
        this.#unwatchRegistrations = window.ioc.onRegister?.((key: string, value: unknown) => {
          if (!this.#run) {
            const run = { keys: [] as string[], owners: 0 }
            this.#run = run
            queueMicrotask(() => { if (this.#run === run) this.#run = null })
          }
          this.#run.keys.push(key)
          if (value && typeof value === 'object') this.#runOf.set(value, this.#run)
        }) ?? null
      } catch { this.#unwatchRegistrations = null }
    }
    let done = false
    return () => {
      if (done) return
      done = true
      if (--this.#watching > 0) return
      this.#unwatchRegistrations?.()
      this.#unwatchRegistrations = null
    }
  }

  #noteCompany = (signature: string, bee: Bee): void => {
    const run = this.#runOf.get(bee)
    if (!run || this.#company.get(signature) === run) return
    run.owners++
    this.#company.set(signature, run)
  }

  /** Dispose and unregister what an evicted bee's module registered beside it. */
  #dismissCompany = (signature: string, bee: unknown): void => {
    const run = this.#company.get(signature)
    this.#company.delete(signature)
    if (!run || run.owners > 1) return
    for (const key of run.keys) {
      const value = window.ioc.get(key) as { markDisposed?: () => void } | undefined
      if (value === undefined || value === bee) continue
      // Only what that run registered: a key since taken by another holder stays.
      if (typeof value !== 'object' || this.#runOf.get(value) !== run) continue
      try { value.markDisposed?.() } catch { /* best effort */ }
      window.ioc.unregister(key)
    }
  }

  // -------------------------------------------------
  // recompose — on and off while the hive runs
  // -------------------------------------------------

  /** Bees evicted in this session, by signature. */
  readonly #retired = new Set<string>()

  /**
   * THE SELECTION CHANGED AND THE HIVE KEEPS RUNNING (jwize, 2026-11-10:
   * "shouldn't we be able to add and remove features in realtime from the
   * hosts window?"). Turning a package on or off rewrites the activation
   * record from bytes already held (acquire.ts applyUnits); this makes the
   * running hive match it without a restart: one processor pass walks the new
   * record, loads and pulses what came on, and disposes what went off.
   *
   * True when the hive now runs the record. False changes NOTHING, and the
   * caller restarts as it always did. It is false whenever a restart is the
   * only honest way:
   *
   *   • a bee going off is running and declares no `dispose()` — whatever it
   *     wired by hand (a DOM listener, a timer, a surface) would outlive it.
   *     `dispose()` is the bee saying it can let go while the hive runs;
   *   • what its module registered beside it (its queen, its services) cannot
   *     be told from another bee's (#company) — they would be left behind;
   *   • the record names different namespace bundles — the import map is
   *     bound when the page loads;
   *   • a bee coming back was evicted earlier and is imported by a stable
   *     address (a door that serves modules): the browser would hand back the
   *     module it already ran, and nothing would register;
   *   • the shell runs its bees from source, reads only, or has not walked a
   *     package yet.
   */
  public recompose = async (): Promise<boolean> => {
    if (this.#registeredBees || !this.#walked) return false
    if ((globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) return false
    if (this.#finding) await this.#finding.catch(() => undefined)

    let raw = ''
    try { raw = localStorage.getItem('core-adapter.installed-manifest') ?? '' } catch { return false }
    const key = `${installedPackageSig() ?? ''}|${raw}`
    if (key === this.#packageKey) return true
    const next = ScriptPreloader.#parseManifest(raw)
    if (!next.layers.length || !next.bees.length) return false

    const bundles = new Set(this.#manifest.dependencies)
    if (next.dependencies.length !== bundles.size || next.dependencies.some(sig => !bundles.has(sig))) return false

    const walked = await this.#walkLayers(next.layers)
    const keep = new Set([...next.bees, ...walked.criticalBees])
    const enabled = new Set(walked.bees.filter(sig => keep.has(sig)))
    for (const [sig, bee] of this.#beeCache) {
      if (enabled.has(sig)) continue
      const leaving = bee as unknown as { markDisposed?: unknown; dispose?: unknown }
      if (typeof leaving?.markDisposed !== 'function' || typeof leaving?.dispose !== 'function') return false
      if ((this.#company.get(sig)?.owners ?? 1) > 1) return false
    }
    if ((globalThis as { __HC_MODULE_ROOT__?: boolean }).__HC_MODULE_ROOT__ === true
      && [...enabled].some(sig => this.#retired.has(sig))) return false

    // The processor's pass is the one door: find() reads the new record,
    // loads what came on (pulsed in this same pass) and evicts what went off.
    await new hypercomb().act('')
    return this.#packageKey === key
  }

  static #parseManifest(raw: string): { layers: string[]; bees: string[]; dependencies: string[] } {
    const list = (value: unknown): string[] => Array.isArray(value) ? value.filter(Boolean).map(String) : []
    try {
      const manifest = raw ? JSON.parse(raw) as Record<string, unknown> : null
      return { layers: list(manifest?.['layers']), bees: list(manifest?.['bees']), dependencies: list(manifest?.['dependencies']) }
    } catch { return { layers: [], bees: [], dependencies: [] } }
  }

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
    await this.foreground(async () => {
      this.#warmFirst(sigs)
      await Promise.allSettled(sigs.map(sig => this.#wakeLoad(sig)))
      await new hypercomb().act('')
    })
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
   *  otherwise. Its first heartbeat is the processor's: the registration is
   *  an arrival, pulsed in the next pass (core/hypercomb.ts) — in the dev
   *  shell too, whose resolver returns no bees of its own. */
  #wakeLoad = async (id: string): Promise<Bee | null> => {
    const load = this.#devLoaders.get(id)
    if (!load) return this.#loadBeeBySignature(id)
    const before = new Set(window.ioc.list())
    try { await load() } catch (err) {
      console.warn(`[script-preloader] dev sleeper ${id} failed to load:`, err)
      return null
    }
    for (const key of window.ioc.list()) {
      if (before.has(key)) continue
      const bee = window.ioc.get(key) as Bee | undefined
      if (bee) return bee
    }
    return null
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
    await this.foreground(async () => {
      this.#warmFirst(sigs)
      await Promise.allSettled(sigs.map(sig => this.#wakeLoad(sig)))
      await new hypercomb().act('')
    })
  }

  /** Wake the queen who answers `word`; null when none is asleep for it. */
  public wakeWord = async (word: string): Promise<Bee | null> => {
    const wanted = String(word ?? '').trim().toLowerCase()
    const found = [...this.#sleeping].find(([, entry]) => entry.command === wanted)
    if (!found) return null
    const [sig] = found
    this.#sleeping.delete(sig)
    this.#woken.add(sig)
    const bee = await this.foreground(async () => {
      this.#warmFirst([sig])
      return this.#wakeLoad(sig)
    })
    EffectBus.emit('loader:sleeping', { words: this.sleepingWords() })
    return bee
  }

  /** Bees the arrival left asleep. Null: no plan — every bee loads as always. */
  #passive: Set<string> | null = null
  /** What the arrival plan named — never put to sleep, whatever else holds. */
  #arrivalBees: ReadonlySet<string> = new Set()
  #arrivalDecided = false
  #arrivalCritical: readonly string[] = ScriptPreloader.#EMPTY_SIGS
  /** A hive's tier 1: loaded in idle batches after the arrival is up. */
  #idleHive: Set<string> = new Set()
  /** What the last walk found: the class index and the package's bees — what a
   *  hive is cut and checked against. Null before the first walk. */
  #package: { classes: ReadonlyMap<string, BeeClass>; bees: ReadonlySet<string> } | null = null

  /** CUT A HIVE FROM THIS SESSION (hive-author.ts): the bees that ran become the
   *  faces, the hive is checked against the package, minted under its own
   *  signature and kept in the store. Nothing is published. The word `hive`
   *  asks for this over IoC; a module never imports the runtime. */
  authorHive = async (options: { name: string; depth?: 0 | 1 | 2 }): Promise<
    | { ok: true; sig: string; faces: string[]; notes: HiveProblem[] }
    | { ok: false; error: string; problems?: HiveProblem[] }
  > => {
    const walked = this.#package
    if (!walked) return { ok: false, error: 'No package has been walked yet.' }
    const packageSig = installedPackageSig()
    if (!packageSig) return { ok: false, error: 'No installed package here (a dev shell imports modules directly).' }
    const live = await liveCoreExports()
    if (!live) return { ok: false, error: 'The core surface cannot be read here.' }
    const draft = cutHive({
      observed: this.#beeCache.keys(),
      classes: walked.classes,
      packageBees: walked.bees,
      name: options.name,
      package: packageSig,
      core: await exportSurfaceSignature([...live]),
      depth: options.depth,
    })
    const minted = await mintHive(draft, walked.classes, walked.bees)
    if (!minted) return { ok: false, error: 'The hive does not hold up against the package.', problems: validateHive(draft, walked.classes, walked.bees) }
    try { await saveHive(this.store, minted) } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true, sig: minted.sig, faces: [...draft.arrival], notes: minted.problems }
  }

  static readonly #IDLE_HIVE_BATCH = 3

  /** Load the hive's idle tier a few bees at a time, only when the main thread
   *  has nothing better to do, each batch finished (and pulsed) before the next
   *  is asked for. Whatever the wake-all has already taken is skipped. */
  #loadIdleHive = (): void => {
    const asleep = this.#asleep()
    const queue = [...this.#idleHive].filter(sig => !this.#beeCache.has(sig) && !asleep.has(sig) && !this.#failed.has(sig))
    this.#idleHive = new Set()
    if (!queue.length) return
    const whenIdle = this.#whenIdle
    const pump = (): void => {
      const batch = queue.splice(0, ScriptPreloader.#IDLE_HIVE_BATCH).filter(sig => !this.#beeCache.has(sig))
      if (!batch.length) { if (queue.length) whenIdle(pump); return }
      const loads = batch.map(sig => this.#loadBeeBySignature(sig))
      this.#finishBeeLoadsInBackground(batch, loads)
      void Promise.allSettled(loads).then(() => { if (queue.length) whenIdle(pump) })
    }
    whenIdle(pump)
  }

  #decideArrival = async (walked: { bees: readonly string[]; criticalBees: readonly string[]; classes: ReadonlyMap<string, BeeClass> }): Promise<void> => {
    if (this.#arrivalDecided) return
    this.#arrivalDecided = true
    // A HIVE (hive.ts) outranks a published arrival plan: the entrance chose it.
    const hive = await selectedHive()
    if (hive && hive.depth >= 2) return
    const names = hive ? hive.arrival : await arrivalNames()
    if (!names) return
    const planned = hive
      ? hiveArrival(hive, walked.classes, new Set(walked.bees), new Set(walked.criticalBees))!
      : { ...resolveArrival(names, walked.classes, new Set(walked.bees)), idle: new Set<string>() }
    const { bees, idle, missing } = planned
    if (missing.length) console.warn(`[script-preloader] arrival plan names what this package does not carry: ${missing.join(', ')}`)
    // What the arrival came to — the shell's arrival trial reports it.
    EffectBus.emit('loader:arrival', { now: bees.size, passive: bees.size ? walked.bees.length - bees.size : 0, missing })
    if (!bees.size) return
    this.#arrivalBees = bees
    // A hive's tier 1 is neither now nor passive: it loads at idle once the
    // arrival is up (#loadIdleHive), and joins the wake if the arrival stalls.
    this.#idleHive = new Set(walked.bees.filter(sig => idle.has(sig) && !bees.has(sig) && !this.#beeCache.has(sig)))
    this.#passive = new Set(walked.bees.filter(sig => !bees.has(sig) && !this.#idleHive.has(sig) && !this.#beeCache.has(sig)))
    this.#arrivalCritical = walked.criticalBees
    console.log(`[script-preloader] arrival: ${bees.size} bees now, ${this.#idleHive.size} at idle, ${this.#passive.size} passive until approached`)
    // Late-value replay: an approach that happened before this line still
    // wakes them.
    EffectBus.on('loader:activate', () => { this.#activatePassive() })
    // Within range of the approach, fetch them ahead of it (#preloadPassive).
    EffectBus.on('loader:preload', () => { this.#preloadPassive() })
    this.#watchRange()
    // A plan that leaves what the reader needs asleep must not strand them:
    // hexagons, or no view in time, wakes the rest (arrival-plan.ts).
    guardArrival(EffectBus, reason => {
      console.log(`[script-preloader] arrival ${reason === 'hexagons' ? 'opened as hexagons' : 'stalled'}: waking the passive bees`)
      EffectBus.emit('loader:activate', { reason: `arrival-${reason}` })
    })
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
        await this.#clearOfForeground()
        if (this.#preloadStopped) return
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
    const pending = sigs.filter(sig => this.#isSignature(sig) && !this.#beeCache.has(sig) && !this.#failed.has(sig))
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
    // A hive's idle tier not yet loaded joins the wake: the approach cannot
    // wait on a queue meant for spare time.
    const passive = new Set([...(this.#passive ?? []), ...this.#idleHive])
    this.#idleHive = new Set()
    if (!passive.size) return
    this.#passive = new Set()
    // A queen asleep until her word stays asleep: stepping into the hive is
    // not asking for her.
    const asleep = this.#asleep()
    const pending = [...passive].filter(sig => !this.#beeCache.has(sig) && !asleep.has(sig) && !this.#failed.has(sig))
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

  // -------------------------------------------------
  // the view you are in goes first
  // -------------------------------------------------
  //
  // jwize, 2026-11-11: "any list can be expanded warmed up and it is optimized
  // and it is shown first in any race if you are in the view and its resources
  // as well." Whatever the participant is in — a view entered, a word said, a
  // window opened — holds the foreground: its bees and its own resources load
  // at once, and every background queue (the idle hive, the resource preheat,
  // the passive preload lanes) waits until it is done, then carries on where it
  // stopped. Background work only ever fills spare time.

  #foreground = 0
  readonly #parked: Array<() => void> = []
  #clear: Array<() => void> = []

  /** Run `work` in the foreground: nothing in the background moves until it
   *  settles. Windows reach this over IoC (a module never imports the runtime). */
  public foreground = async <T>(work: () => Promise<T>): Promise<T> => {
    this.#foreground++
    try { return await work() } finally {
      if (--this.#foreground === 0) {
        const clear = this.#clear
        this.#clear = []
        for (const resolve of clear) resolve()
        const parked = this.#parked.splice(0)
        for (const run of parked) this.#whenIdle(run)
      }
    }
  }

  /** Resolves once nothing holds the foreground. */
  #clearOfForeground = (): Promise<void> =>
    this.#foreground === 0 ? Promise.resolve() : new Promise<void>(resolve => { this.#clear.push(resolve) })

  /** Background work: at idle, and only while nothing holds the foreground. No
   *  idle callback (older Safari, some workers) — a plain delay still gets it
   *  off the first-paint path. */
  #whenIdle = (run: () => void): void => {
    const go = (): void => { if (this.#foreground > 0) this.#parked.push(run); else run() }
    if (this.#foreground > 0) { this.#parked.push(run); return }
    if (typeof (globalThis as any).requestIdleCallback === 'function') (globalThis as any).requestIdleCallback(go)
    else setTimeout(go, ScriptPreloader.#PREHEAT_FALLBACK_MS)
  }

  /** Warm the resources of the layers these bees belong to, now and ahead of
   *  the idle queue — the view's own pictures and data, not the package's. */
  #warmFirst = (bees: readonly string[]): void => {
    const wanted = new Set(bees)
    const mine: string[] = []
    for (const layer of this.#layerCache.values()) {
      if (!layer.bees.some(bee => wanted.has(bee))) continue
      for (const sig of layer.resources) if (!this.#warmed.has(sig)) mine.push(sig)
    }
    if (!mine.length) return
    for (const sig of mine) { this.#warmed.add(sig); this.#preheated.add(sig) }
    void Promise.allSettled(mine.map(sig => this.store.preheatResource(sig)))
  }

  /** Resources already warmed in the foreground. */
  readonly #warmed = new Set<string>()

  /** Resources already queued for preheat — the walk repeats across finds,
   *  and re-reading what a previous pass already warmed is pure waste. */
  readonly #preheated = new Set<string>()

  /** Feed the preheat queue during idle time, `#PREHEAT_BATCH` at a time,
   *  waiting for each batch before asking for the next slice. */
  #preheatAtIdle = (sigs: readonly string[]): void => {
    const queue = sigs.filter(sig => !this.#preheated.has(sig))
    if (!queue.length) return
    for (const sig of queue) this.#preheated.add(sig)

    const whenIdle = this.#whenIdle

    const pump = (): void => {
      const batch = queue.splice(0, ScriptPreloader.#PREHEAT_BATCH).filter(sig => !this.#warmed.has(sig))
      if (!batch.length) { if (queue.length) whenIdle(pump); return }
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

  /** The installed manifest's roots and enabled bees, parsed once per
   *  package key (install pointer + manifest text). A changed key drops the
   *  held walk and the negative cache: the next find walks the new package
   *  and may try again what failed under the old one. */
  #readManifest(): { layers: string[]; bees: string[]; dependencies: string[] } {
    let raw = ''
    try { raw = localStorage.getItem('core-adapter.installed-manifest') ?? '' } catch { raw = '' }
    const key = `${installedPackageSig() ?? ''}|${raw}`
    if (key === this.#packageKey) return this.#manifest
    this.#packageKey = key
    this.#walked = null
    this.#failed.clear()
    // An unreadable manifest is nothing to walk.
    this.#manifest = ScriptPreloader.#parseManifest(raw)
    return this.#manifest
  }

  /** Bees of the live package that did not load, with why — said once each. */
  public get failedBees(): ReadonlyMap<string, unknown> { return this.#failed }

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
   * Non-critical bees that arrive after find() returns are arrivals: the
   * processor pulses each once as it registers (core/hypercomb.ts) — drones
   * whose heartbeat wires EffectBus listeners (NostrMeshDrone,
   * PairedChannelDrone) require that first pulse or their listeners never
   * register.
   */
  #loadBeesPrioritized = async (
    sigs: readonly string[],
    signedCriticalBees: readonly string[],
  ): Promise<DeferredBeeLoads | null> => {
    const pending = sigs.filter(sig => sig && this.#isSignature(sig) && !this.#beeCache.has(sig) && !this.#failed.has(sig))
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
    // The finisher pulses nothing: each bee that lands here registered
    // itself, and the processor pulses every arrival once (core/hypercomb.ts).
    void (async () => {
      await Promise.allSettled(loads)
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

  /** What the last write said — the finisher runs once per load batch, and
   *  the mapping it learns is the same every time; one write per change. */
  static #learnedWritten = ''

  /** Persist the sigs of the bees that declare the first-paint lane so an
   *  older package with no signed hint can hit the fast path next boot.
   *  The mark is read off the bee, never a class-name list, and the cache is
   *  bound to the exact installed package signature. */
  static #updateLearnedCriticalSigs(beeCache: Map<string, Bee>): void {
    try {
      const packageSig = installedPackageSig()
      const sigs = learnedCriticalBeeSigs(beeCache)
      if (!packageSig || !sigs) return
      const serialized = serializeLearnedCriticalBeeSigs(packageSig, sigs)
      if (serialized === ScriptPreloader.#learnedWritten) return
      ScriptPreloader.#learnedWritten = serialized
      localStorage.setItem('hc:critical-bee-sigs', serialized)
      console.log(`[script-preloader] cached ${sigs.length} package-bound critical bee signatures`)
    } catch (err) {
      console.warn('[script-preloader] failed to persist critical bee sigs:', err)
    }
  }

  #loadBeesFromList = async (sigs: string[]): Promise<void> => {
    const pending = sigs.filter(sig => sig && this.#isSignature(sig) && !this.#beeCache.has(sig) && !this.#failed.has(sig))
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
    // Remembered failure: said once when it happened, not retried every act.
    // (A bee held in the brood is not a failure — a hand may still accept it.)
    if (this.#failed.has(signature)) return null
    const existing = this.#inFlight.get(signature)
    if (existing) return existing

    const promise = this.#tryLoadBee(signature)
    this.#inFlight.set(signature, promise)
    try {
      const bee = await promise
      if (!bee && !this.#heldBack.has(signature)) this.#failed.set(signature, new Error('bee did not load'))
      return bee
    } catch (error) {
      this.#failed.set(signature, error)
      throw error
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
    if (handle) {
      buffer = await (await handle.getFile()).arrayBuffer()
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
    const unwatch = this.#watchRegistrations()
    let bee: Bee | null
    try { bee = await this.store.getBee(signature, buffer) } finally { unwatch() }
    tEval = performance.now() - tEvalStart
    if (bee) this.#noteCompany(signature, bee)
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
