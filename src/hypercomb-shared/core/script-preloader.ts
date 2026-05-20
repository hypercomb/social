// hypercomb-shared/core/script-preloader.ts
// Marker-driven bee resolver: reads signature markers from the cell tree
// and loads bee modules on demand. The processor (hypercomb.act()) is the
// sole caller of find() → pulse → synchronize.

import { Bee, type BeeResolver, EffectBus } from '@hypercomb/core'
import { Store } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}

export class ScriptPreloader extends EventTarget implements BeeResolver {

  // SHA-256 of canonical JSON: [] → 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
  static readonly #EMPTY_SIGS: readonly string[] = Object.freeze([])

  // Render-critical IoC keys. find() resolves as soon as every key here
  // is registered; remaining bees keep loading in background. This is the
  // minimum set required to paint the first hive frame: Pixi host, hex
  // math, layout solver, the cell renderer, and its prerequisites.
  //
  // Keep this list small — every entry blocks first paint. If a drone
  // belongs here, it should be because the visible grid genuinely cannot
  // render without it. Anything tile-action / overlay / network / history
  // related does NOT belong here.
  static readonly #RENDER_CRITICAL_KEYS: readonly string[] = Object.freeze([
    '@diamondcoreprocessor.com/PixiHostWorker',
    '@diamondcoreprocessor.com/Settings',
    '@diamondcoreprocessor.com/AxialService',
    '@diamondcoreprocessor.com/LayoutService',
    '@diamondcoreprocessor.com/ShowCellDrone',
    // Hot-reloaded class name in dev shell (esbuild collision-rename adds
    // a `_` prefix). Production sees the un-prefixed form.
    '@diamondcoreprocessor.com/_ShowCellDrone',
    '@diamondcoreprocessor.com/BackgroundDrone',
  ])

  private get store(): Store { return <Store>get("@hypercomb.social/Store") }

  #actions: readonly ActionDescriptor[] = []
  #actionNames: readonly string[] = []
  #resourceCount = 0
  #finding: Promise<Bee[]> | null = null

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

  readonly #bySignature = new Map<string, ActionDescriptor>()
  readonly #beeCache = new Map<string, Bee>()
  readonly #loadedDeps = new Set<string>()
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

  public find = async (_grammar: string): Promise<Bee[]> => {
    if (this.#finding) return this.#finding

    const run = async (): Promise<Bee[]> => {
      const tFind = performance.now()

      // Layer-walk: layers are the source of truth. Union every signature
      // array they declare (bees, dependencies, resources, nested layers).
      // Falls back to the flat install-manifest bees list for legacy/dev.
      const layerRoots = ScriptPreloader.readManifestLayers()
      const tWalk = performance.now()
      const walked = layerRoots.length
        ? await this.#walkLayers(layerRoots)
        : { bees: ScriptPreloader.readManifestBees(), dependencies: ScriptPreloader.#EMPTY_SIGS, resources: ScriptPreloader.#EMPTY_SIGS }
      const walkMs = performance.now() - tWalk

      // Background cache warming — `preheatResource` is just `getResource`,
      // so cold reads work fine. Awaiting these would scale first paint
      // linearly with tile count; pulse must not wait on preloader work.
      if (walked.resources.length) {
        void Promise.allSettled(walked.resources.map(sig => this.store.preheatResource(sig)))
      }

      const tBees = performance.now()
      if (walked.bees.length) {
        await this.#loadBeesPrioritized(walked.bees)
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
            console.log(`[script-preloader] evicting disabled bee ${sig} (${bee.iocKey})`)
            const key = bee.iocKey
            bee.markDisposed()
            window.ioc.unregister(key)
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

      return [...this.#beeCache.values()]
    }

    this.#finding = run()
    try { return await this.#finding } finally { this.#finding = null }
  }

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
  }>()

  #walkLayers = async (
    roots: string[]
  ): Promise<{ bees: string[]; dependencies: string[]; resources: string[] }> => {
    const visited = new Set<string>()
    const bees = new Set<string>()
    const dependencies = new Set<string>()
    const resources = new Set<string>()

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
          parsed = {
            bees: ((layer['bees'] as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
            dependencies: ((layer['dependencies'] as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
            resources: ((layer['resources'] as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
            children: ((layer['layers'] as string[] | undefined) ?? []).map(s => this.#stripExt(s)).filter(Boolean),
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

      await Promise.all(parsed.children.map(visit))
    }

    await Promise.all(roots.map(visit))

    console.log(`[script-preloader] walkLayers: ${visited.size} layers (${opfsReads} OPFS reads = ${opfsMs.toFixed(0)}ms, ${cacheHits} cache hits, parse ${parseMs.toFixed(0)}ms)`)

    return {
      bees: [...bees].filter(Boolean),
      dependencies: [...dependencies].filter(Boolean),
      resources: [...resources].filter(Boolean),
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
   * Two strategies, picked based on whether we have a learned sig→iocKey
   * cache from prior boots:
   *
   *   FAST PATH (warm cache): we already know which sigs are render-
   *     critical. Load JUST those in wave 1, awaited. The remaining
   *     ~48 bees start AFTER critical finishes, in background. Critical
   *     gets exclusive use of the browser's eval thread for ~6 modules
   *     instead of competing with 48 — empirically the difference between
   *     ~400ms (everything jammed in parallel) and ~50ms (just critical).
   *
   *   COLD PATH (no cache): we don't know which sigs map to critical IoC
   *     keys yet, so we fall back to the onRegister race — start all
   *     loads, resolve as soon as the six critical keys appear. Slower
   *     than the warm path, but populates the cache so the next boot is
   *     fast.
   *
   * Non-critical bees that arrive after find() returns get their own
   * first pulse from the background continuation — drones whose
   * heartbeat wires EffectBus listeners (NostrMeshDrone, PairedChannelDrone)
   * require this or their listeners never register.
   */
  #loadBeesPrioritized = async (sigs: string[]): Promise<void> => {
    const pending = sigs.filter(sig => sig && this.#isSignature(sig) && !this.#beeCache.has(sig))
    if (!pending.length) return

    EffectBus.emit('loader:bees-progress', { loading: pending.length, total: this.#beeCache.size + pending.length })

    // iOS: sequential load. Concurrent dynamic imports + concurrent drone
    // constructors during live Pixi rendering exceed the WKWebView
    // renderer-process budget and kill the page (was crashing in the
    // rest-pending wave after boot completed). Serial loading trades
    // a few seconds of boot time for not crashing.
    if (/iP(hone|ad|od)/i.test(navigator.userAgent)) {
      const tIOS = performance.now()
      for (const sig of pending) {
        await this.#loadBeeBySignature(sig).catch(() => null)
      }
      for (const sig of this.#beeCache.keys()) this.#firstPulsed.add(sig)
      this.#refreshProjection()
      ScriptPreloader.#updateLearnedCriticalSigs(this.#beeCache)
      const iosMs = performance.now() - tIOS
      const iosMsg = `[script-preloader] iOS serial wave (${pending.length}) loaded in ${iosMs.toFixed(0)}ms`
      console.log(iosMsg)
      try { localStorage.setItem('hc:perf-last-boot', `${Date.now()}:${iosMsg}`) } catch {}
      EffectBus.emit('loader:bees-done', {
        loaded: this.#beeCache.size,
        failed: pending.length - this.#beeCache.size,
        total: this.#beeCache.size,
      })
      return
    }

    const learnedCritical = ScriptPreloader.#readLearnedCriticalSigs()
    const criticalSet = new Set(learnedCritical.filter(sig => pending.includes(sig)))

    // ── FAST PATH ────────────────────────────────────────────────
    if (criticalSet.size > 0) {
      const criticalPending = pending.filter(sig => criticalSet.has(sig))
      const restPending = pending.filter(sig => !criticalSet.has(sig))

      const tWave1 = performance.now()
      await Promise.allSettled(criticalPending.map(sig => this.#loadBeeBySignature(sig)))
      const wave1Ms = performance.now() - tWave1

      // Encounter loop will pulse these. Mark them.
      for (const sig of this.#beeCache.keys()) this.#firstPulsed.add(sig)

      const fastMsg = `[script-preloader] FAST critical wave (${criticalPending.length}) loaded in ${wave1Ms.toFixed(0)}ms; ${restPending.length} backgrounded`
      console.log(fastMsg)
      try { localStorage.setItem('hc:perf-last-boot', `${Date.now()}:${fastMsg}`) } catch {}

      // Background: load the rest and pulse them individually.
      void (async () => {
        const restLoads = restPending.map(sig => this.#loadBeeBySignature(sig))
        await Promise.allSettled(restLoads)
        for (const [sig, bee] of this.#beeCache) {
          if (this.#firstPulsed.has(sig)) continue
          this.#firstPulsed.add(sig)
          try { await bee.pulse('') } catch (err) {
            console.warn(`[script-preloader] late pulse failed for ${bee.iocKey}:`, err)
          }
        }
        this.#refreshProjection()
        ScriptPreloader.#updateLearnedCriticalSigs(this.#beeCache)
        EffectBus.emit('loader:bees-done', {
          loaded: this.#beeCache.size,
          failed: pending.length - this.#beeCache.size,
          total: this.#beeCache.size,
        })
      })()
      return
    }

    // ── COLD PATH (no cache yet) ─────────────────────────────────
    const allLoads = pending.map(sig => this.#loadBeeBySignature(sig))

    const critical = ScriptPreloader.#RENDER_CRITICAL_KEYS
    const tCriticalStart = performance.now()
    const criticalReady = new Promise<void>(resolve => {
      const stillNeeded = new Set<string>(critical)
      for (const k of [...stillNeeded]) {
        if (window.ioc.has?.(k)) stillNeeded.delete(k)
      }
      if (stillNeeded.size === 0) { resolve(); return }

      let unsub: (() => void) | undefined
      unsub = window.ioc.onRegister?.((key) => {
        if (!stillNeeded.has(key)) return
        stillNeeded.delete(key)
        if (stillNeeded.size === 0) {
          unsub?.()
          resolve()
        }
      })
      if (!unsub) {
        void Promise.allSettled(allLoads).then(() => resolve())
      }
    })

    await Promise.race([
      criticalReady,
      Promise.allSettled(allLoads).then(() => {}),
    ])
    const criticalMs = performance.now() - tCriticalStart

    for (const sig of this.#beeCache.keys()) this.#firstPulsed.add(sig)

    console.log(`[script-preloader] COLD critical bees ready in ${criticalMs.toFixed(0)}ms; populating sig→iocKey cache for next boot`)

    void (async () => {
      await Promise.allSettled(allLoads)
      for (const [sig, bee] of this.#beeCache) {
        if (this.#firstPulsed.has(sig)) continue
        this.#firstPulsed.add(sig)
        try { await bee.pulse('') } catch (err) {
          console.warn(`[script-preloader] late pulse failed for ${bee.iocKey}:`, err)
        }
      }
      this.#refreshProjection()
      ScriptPreloader.#updateLearnedCriticalSigs(this.#beeCache)
      EffectBus.emit('loader:bees-done', {
        loaded: this.#beeCache.size,
        failed: pending.length - this.#beeCache.size,
        total: this.#beeCache.size,
      })
    })()
  }

  /** Read learned critical-bee sigs from prior boots. Empty on first run. */
  static #readLearnedCriticalSigs(): readonly string[] {
    try {
      const raw = localStorage.getItem('hc:critical-bee-sigs')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter(s => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s))
        : []
    } catch { return [] }
  }

  /** Persist learned sig→iocKey mapping for render-critical bees so the
   *  next boot can hit the fast path. Best-effort; failures are silent.
   *
   *  Matches by constructor.name string, not by instance identity. Dev-
   *  shell hot-reload creates parallel class objects: the instance in
   *  `window.ioc` (registered first by a stale module) can be a different
   *  object than the one in `beeCache` (created fresh by `store.getBee`).
   *  Instance comparison fails. Constructor.name is stable across the
   *  module-boundary because esbuild keeps the class name. */
  static #updateLearnedCriticalSigs(beeCache: Map<string, Bee>): void {
    try {
      const criticalClassNames = new Set<string>()
      for (const key of ScriptPreloader.#RENDER_CRITICAL_KEYS) {
        const className = key.split('/').pop()
        if (className) criticalClassNames.add(className)
      }
      const sigs: string[] = []
      const seenKeys: string[] = []
      const distinctInstances = new Set<unknown>()
      for (const [sig, bee] of beeCache) {
        distinctInstances.add(bee)
        const iocKey = (bee as any)?.iocKey ?? '(null)'
        seenKeys.push(iocKey)
        const className = iocKey.split('/').pop()
        if (className && criticalClassNames.has(className)) sigs.push(sig)
      }
      localStorage.setItem('hc:critical-bee-sigs', JSON.stringify(sigs))
      console.log(`[script-preloader] cached ${sigs.length} critical sigs (saw ${seenKeys.length} bees, ${distinctInstances.size} distinct instances); want=${[...criticalClassNames].join(',')}; got_first5=${seenKeys.slice(0, 5).join('|')}`)
    } catch (err) {
      console.warn('[script-preloader] failed to persist critical bee sigs:', err)
    }
  }

  #loadBeesFromList = async (sigs: string[]): Promise<void> => {
    const pending = sigs.filter(sig => sig && this.#isSignature(sig) && !this.#beeCache.has(sig))
    if (!pending.length) return

    EffectBus.emit('loader:bees-progress', { loading: pending.length, total: this.#beeCache.size + pending.length })

    // On iOS: load sequentially. getBee() snapshots IoC before import and checks
    // new keys after — concurrent HTTP/2 imports complete in the same microtask
    // batch, so all concurrent getBee() calls see the same IoC diff and return
    // the same first new key (wrong drone). Serial execution isolates each
    // snapshot-import-check so every bee gets its own correct instance.
    // On desktop: parallel load is safe (imports resolve more sequentially).
    let loaded = 0
    if (/iP(hone|ad|od)/i.test(navigator.userAgent)) {
      for (const sig of pending) {
        const bee = await this.#loadBeeBySignature(sig).catch(() => null)
        if (bee !== null) loaded++
      }
    } else {
      const results = await Promise.allSettled(pending.map(sig => this.#loadBeeBySignature(sig)))
      loaded = results.filter(r => r.status === 'fulfilled' && r.value !== null).length
    }

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
    const tStart = performance.now()
    let tOpfs = 0, tDeps = 0, tEval = 0

    // On iOS, store.getBee() ignores the buffer and imports from /content/__bees__/
    // directly. Skip the OPFS read — getFileHandle throws on fresh/partial installs
    // and would block bee loading before getBee() ever runs.
    let buffer: ArrayBuffer
    if (/iP(hone|ad|od)/i.test(navigator.userAgent)) {
      buffer = new ArrayBuffer(0)
    } else {
      // Try __bees__/{sig}.js then __bees__/{sig}
      let handle: FileSystemFileHandle | null = null
      try {
        handle = await this.store.bees.getFileHandle(`${signature}.js`)
      } catch {
        try {
          handle = await this.store.bees.getFileHandle(signature)
        } catch {
          console.warn(`[script-preloader] bee ${signature} not found in OPFS`)
          return null
        }
      }
      const file = await handle.getFile()
      buffer = await file.arrayBuffer()
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
    // The original concern was "two instances subscribing to the same
    // events on dev shell"; in practice the bee module's `register` call
    // overwrites whatever was registered before, so only one instance
    // ever ends up in IoC. The OPFS instance wins on every shell.
    register(bee.iocKey, bee)

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

    for (const depSig of needed) {
      if (this.#loadedDeps.has(depSig)) continue

      // Reverse lookup: find alias for this dep signature
      // aliasMap values may have .js suffix (stored as filenames); strip when comparing
      let alias: string | undefined
      for (const [a, s] of aliasMap) {
        if (s.replace(/\.js$/i, '') === depSig) { alias = a; break }
      }
      if (!alias) {
        console.warn(`[script-preloader] no alias found for dep ${depSig} (bee ${beeSig})`)
        continue
      }

      try {
        console.log(`[script-preloader] loading dep ${depSig} (${alias}) for bee ${beeSig}`)
        const target = /iP(hone|ad|od)/i.test(navigator.userAgent)
          ? `/content/__dependencies__/${depSig}.js`
          : alias
        await import(/* @vite-ignore */ target)
        this.#loadedDeps.add(depSig)
        console.log(`[script-preloader] dep ${depSig} loaded`)
      } catch (err) {
        console.warn(`[script-preloader] failed to load dep ${depSig} for bee ${beeSig}:`, err)
      }
    }
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
