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

  private get store(): Store { return <Store>get("@hypercomb.social/Store") }

  #actions: readonly ActionDescriptor[] = []
  #actionNames: readonly string[] = []
  #resourceCount = 0
  #finding: Promise<Bee[]> | null = null

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
  // Dynamic slot names from LayerSlotRegistry. Populated lazily — on first
  // walk we ask the registry which slot fields exist on layers and treat
  // any 64-hex value in those fields as a prewarmable resource. Falls
  // back to a static set if the registry isn't reachable yet (boot
  // ordering).
  #dynamicSlots: readonly string[] | null = null

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.#bySignature.get(signature)

  public getActionName = (signature: string): string | null =>
    this.#bySignature.get(signature)?.name ?? null

  // -------------------------------------------------
  // find — marker-driven, called by the processor
  // -------------------------------------------------

  public find = async (_grammar: string): Promise<Bee[]> => {
    // In-flight dedup: if find() is already running, wait for it
    if (this.#finding) {
      console.log('[script-preloader] find() already in progress, waiting')
      return this.#finding
    }

    const run = async (): Promise<Bee[]> => {
      const t0 = performance.now()
      // Layer-walk: layers are the source of truth. Union every signature
      // array they declare (bees, dependencies, resources, nested layers).
      // Falls back to the flat install-manifest bees list for legacy/dev.
      const layerRoots = ScriptPreloader.readManifestLayers()
      const walkStart = performance.now()
      const walked = layerRoots.length
        ? await this.#walkLayers(layerRoots)
        : { bees: ScriptPreloader.readManifestBees(), dependencies: [], resources: [] }
      const walkMs = (performance.now() - walkStart).toFixed(0)
      console.log(`[script-preloader] walked ${layerRoots.length} root(s) in ${walkMs}ms → ${walked.bees.length} bees, ${walked.dependencies.length} deps, ${walked.resources.length} resources`)

      // Prefetch __resources__ in parallel with bee loading — tiles and
      // drones that need these blobs will find them hot in the Store cache.
      const prefetchStart = performance.now()
      const prefetch = walked.resources.length
        ? Promise.allSettled(walked.resources.map(sig => this.store.preheatResource(sig)))
        : Promise.resolve([])

      // Split walked.bees into priority and rest. Priority bees declared
      // `static readonly bootPriority = true` in source; build-module
      // collected them into manifest.bootPriority. Render-critical
      // drones (show-cell, pixi host) belong here so first paint isn't
      // gated on unrelated bees finishing their load + warmup.
      const prioritySet = new Set(ScriptPreloader.readManifestBootPriority())
      const priorityBees = walked.bees.filter(s => prioritySet.has(s))
      const restBees = walked.bees.filter(s => !prioritySet.has(s))

      // Phase 1: priority bees — load + warmup + return. Caller awaits
      // this before the first render so the canvas drone is ready.
      const beeLoadStart = performance.now()
      if (priorityBees.length) {
        await this.#loadBeesFromList(priorityBees)
        const priorityMs = (performance.now() - beeLoadStart).toFixed(0)
        console.log(`[script-preloader] loaded ${priorityBees.length} priority bees in ${priorityMs}ms`)
        // Warmup priority bees right away so first pulse is hot
        const priorityWarmStart = performance.now()
        await this.#runWarmups()
        const priorityWarmMs = (performance.now() - priorityWarmStart).toFixed(0)
        console.log(`[script-preloader] warmed up priority bees in ${priorityWarmMs}ms`)
      }

      // Phase 2: rest of the bees — fire-and-forget. find() returns;
      // these bees light up interactivity in the background after the
      // canvas is already painted. Render speed is king.
      if (restBees.length) {
        const bgStart = performance.now()
        void (async () => {
          await this.#loadBeesFromList(restBees)
          const restMs = (performance.now() - bgStart).toFixed(0)
          console.log(`[script-preloader] loaded ${restBees.length} background bees in ${restMs}ms`)
          const bgWarmStart = performance.now()
          await this.#runWarmups()
          const bgWarmMs = (performance.now() - bgWarmStart).toFixed(0)
          console.log(`[script-preloader] warmed up background bees in ${bgWarmMs}ms`)
        })().catch(err => console.warn('[script-preloader] background bee load failed:', err))
      }

      await prefetch
      const prefetchMs = (performance.now() - prefetchStart).toFixed(0)
      console.log(`[script-preloader] prefetched ${walked.resources.length} resources in ${prefetchMs}ms`)

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

      return [...this.#beeCache.values()]
    }

    this.#finding = run()
    try { return await this.#finding } finally { this.#finding = null }
  }

  // -------------------------------------------------
  // layer walk — layers are the source of truth
  // -------------------------------------------------

  readonly #warmedUp = new Set<string>()

  #walkLayers = async (
    roots: string[]
  ): Promise<{ bees: string[]; dependencies: string[]; resources: string[] }> => {
    const visited = new Set<string>()
    const bees = new Set<string>()
    const dependencies = new Set<string>()
    const resources = new Set<string>()

    const visit = async (sig: string): Promise<void> => {
      const clean = this.#stripExt(sig)
      if (!clean || visited.has(clean)) return
      visited.add(clean)

      const bytes = await this.store.getLayerBytes(clean)
      if (!bytes) {
        console.warn(`[script-preloader] layer ${clean} not found in OPFS`)
        return
      }

      let layer: Record<string, unknown>
      try {
        layer = JSON.parse(new TextDecoder().decode(bytes))
      } catch (err) {
        console.warn(`[script-preloader] failed to parse layer ${clean}:`, err)
        return
      }

      for (const b of (layer['bees'] as string[] | undefined) ?? []) bees.add(this.#stripExt(b))
      for (const d of (layer['dependencies'] as string[] | undefined) ?? []) dependencies.add(this.#stripExt(d))
      for (const r of (layer['resources'] as string[] | undefined) ?? []) resources.add(this.#stripExt(r))

      // Dynamic slot pre-warm: every slot registered with
      // LayerSlotRegistry that holds 64-hex signature pointers gets its
      // values added to the resource set so Store.getResource is hot
      // when the slot's UI consumer (notes-viewer, tag chips, body
      // renderer, future slots) reads it. Slots holding inline JSON
      // payloads are skipped naturally because their values are not
      // 64-hex strings.
      const slotNames = this.#getSlotNames()
      for (const slot of slotNames) {
        const value = layer[slot]
        if (!Array.isArray(value)) continue
        for (const v of value) {
          if (typeof v !== 'string') continue
          const clean = this.#stripExt(v)
          if (this.#isSignature(clean)) resources.add(clean)
        }
      }

      // Child layer sigs: build-module emits them under `cells`; legacy/
      // user-content layers may use `layers` or `children`. Walk all three
      // so the layer-tree union is complete regardless of producer.
      const children: string[] = [
        ...(((layer['cells'] as string[] | undefined) ?? []) as string[]),
        ...(((layer['layers'] as string[] | undefined) ?? []) as string[]),
        ...(((layer['children'] as string[] | undefined) ?? []) as string[]),
      ]
      await Promise.all(children.map(visit))
    }

    await Promise.all(roots.map(visit))
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

  // Pull the list of slot names registered with LayerSlotRegistry. The
  // registry is owned by essentials and only present after that bee
  // loads; until then we fall back to a static safety net of slot names
  // known at the time of writing. Cached on first successful read so the
  // hot path stays a single Set lookup.
  #getSlotNames = (): readonly string[] => {
    if (this.#dynamicSlots) return this.#dynamicSlots
    try {
      const reg = (window as any).ioc?.get?.('@diamondcoreprocessor.com/LayerSlotRegistry')
      if (reg && typeof reg.slots === 'function') {
        const names: string[] = []
        for (const s of reg.slots()) names.push(s.slot)
        if (names.length > 0) {
          this.#dynamicSlots = names
          return names
        }
      }
    } catch { /* registry not ready */ }
    // Static fallback used until the registry is up. Mirrors the slots
    // known at the time of writing — adding a slot here is fine but the
    // registry path is the long-term source of truth.
    return ['notes', 'tags', 'body']
  }

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

  /** Read `manifest.bootPriority` — sigs of drones that build-module
   *  detected as `static readonly bootPriority = true`. Empty when no
   *  bee declared priority (older manifests, or modules that haven't
   *  opted in). */
  private static readManifestBootPriority(): string[] {
    try {
      const raw = localStorage.getItem('core-adapter.installed-manifest')
      if (!raw) return []
      const manifest = JSON.parse(raw)
      return Array.isArray(manifest?.bootPriority) ? manifest.bootPriority.filter(Boolean) : []
    } catch {
      return []
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
    // Already loaded — skip
    if (this.#beeCache.has(signature)) {
      console.log(`[script-preloader] bee ${signature} already loaded, skipping`)
      return this.#beeCache.get(signature)!
    }

    // In-flight dedup — if another caller is loading this bee, wait for it
    const existing = this.#inFlight.get(signature)
    if (existing) {
      console.log(`[script-preloader] bee ${signature} already loading, waiting`)
      return existing
    }

    const promise = this.#tryLoadBee(signature)
    this.#inFlight.set(signature, promise)
    try {
      return await promise
    } finally {
      this.#inFlight.delete(signature)
    }
  }

  #tryLoadBee = async (signature: string): Promise<Bee | null> => {
    console.log(`[script-preloader] loading bee ${signature}`)

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
    const buffer = await file.arrayBuffer()

    // Ensure namespace dependencies are loaded before the bee
    await this.#ensureDeps(signature)

    const bee = await this.store.getBee(signature, buffer)
    if (!bee) {
      console.warn(`[script-preloader] bee ${signature} returned null from getBee()`)
      return null
    }

    if (!has(bee.iocKey)) register(bee.iocKey, bee)

    this.#bySignature.set(signature, { signature, name: bee.name ?? signature })
    this.#beeCache.set(signature, bee)
    this.#resourceCount++
    this.dispatchEvent(new CustomEvent('change'))

    console.log(`[script-preloader] bee ${signature} loaded as ${bee.iocKey}`)
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
      if (this.#loadedDeps.has(depSig)) {
        console.log(`[script-preloader] dep ${depSig} already loaded for bee ${beeSig}, skipping`)
        continue
      }

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
        await import(/* @vite-ignore */ alias)
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
