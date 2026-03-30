// hypercomb-shared/core/script-preloader.ts
// Marker-driven bee resolver: reads signature markers from the seed tree
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
      // Load bees from cached install manifest
      const manifestBees = ScriptPreloader.readManifestBees()
      if (manifestBees.length) {
        await this.#loadBeesFromList(manifestBees)
      }

      return [...this.#beeCache.values()]
    }

    this.#finding = run()
    try { return await this.#finding } finally { this.#finding = null }
  }

  // -------------------------------------------------
  // manifest-driven loading (primary path)
  // -------------------------------------------------

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

  #loadBeesFromList = async (sigs: string[]): Promise<void> => {
    const pending = sigs.filter(sig => sig && this.#isSignature(sig) && !this.#beeCache.has(sig))
    if (!pending.length) return

    EffectBus.emit('loader:bees-progress', { loading: pending.length, total: this.#beeCache.size + pending.length })

    let loaded = 0
    for (const sig of pending) {
      try {
        const bee = await this.#loadBeeBySignature(sig)
        if (bee) loaded++
      } catch { /* skip failed */ }
    }

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
