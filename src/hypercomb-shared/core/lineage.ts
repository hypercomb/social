// hypercomb-shared/core/lineage.ts
// synchronize is dispatched only by the processor — lineage fires 'change' on itself

import { EffectBus } from '@hypercomb/core'
import type { Navigation } from './navigation'
import type { Store } from './store'

// global get/register/list available via ioc.web.ts

export class Lineage extends EventTarget {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get store(): Store { return get('@hypercomb.social/Store') as Store }
  private get navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }

  // -------------------------------------------------
  // explorer path (domain-relative)
  // -------------------------------------------------

  private explorerPath: string[] = []
  public explorerSegments = (): readonly string[] => this.explorerPath

  public explorerEnter = (name: string): void => {
    const seg = (name ?? '').trim()
    if (!seg || seg === '.' || seg === '..') return

    // perf trail: navigation T0 (no-op on shells without __hcNav)
    ;(window as unknown as { __hcNav?: (l: string, e?: string) => void }).__hcNav?.('nav:start', seg)

    // do not normalize explorer names
    this.explorerPath = [...this.explorerPath, seg]
    this.invalidate()

    // explorer drives navigation (best effort)
    try {
      this.navigation.goRaw(this.explorerPath)
    } catch {
      // fallback: still notify followers even if navigation isn't ready
      this.dispatchNavigateFallback()
    }
  }

  public explorerUp = (): void => {
    if (this.explorerPath.length === 0) return
    this.explorerPath = this.explorerPath.slice(0, -1)
    this.invalidate()

    // explorer drives navigation (best effort)
    try {
      this.navigation.goRaw(this.explorerPath)
    } catch {
      this.dispatchNavigateFallback()
    }
  }

  // keeps old name so you don't have to refactor callers
  // this now means "show domain root"
  public showDomainRoot = (): void => {
    this.explorerPath = []
    this.invalidate()

    // explorer drives navigation (best effort)
    try {
      this.navigation.goRaw([])
    } catch {
      this.dispatchNavigateFallback()
    }
  }

  public explorerLabel = (): string => {
    return '/' + this.explorerPath.join('/')
  }

  // -------------------------------------------------
  // sigbag + current layer — the canonical layer-as-truth accessors.
  //
  // The navigation primitive IS the sigbag — "where the user is" =
  // "which <lineageSig>/ bag (at the OPFS root) they're addressing".
  // (Legacy `__history__/`/`__hive__/`/`hypercomb.io/` bags are
  // read-fallback drain sources; HistoryService unions them.) Every reader
  // that wants "what tiles exist here?" or "what's this location's
  // state?" should go through these two methods. There is ONE source
  // of truth for sigbag computation (HistoryService.sign), and ONE
  // place we cache the resolution per navigation step.
  //
  // Invalidation: explorerPath change → invalidate() → fsRevision++
  //   → cache entries that don't match the new revision are stale.
  //   Both methods short-circuit on cached revision match.
  // -------------------------------------------------

  #cachedSig: { revision: number; sig: string } | null = null
  #pendingSig: { revision: number; promise: Promise<string> } | null = null
  #cachedLayer: { revision: number; layer: unknown } | null = null
  #pendingLayer: { revision: number; promise: Promise<unknown> } | null = null

  /** The sigbag for the current explorerPath. Delegates to
   *  HistoryService.sign (the single source of truth) and memoizes per
   *  fsRevision. Returns '' if HistoryService isn't registered yet. */
  public currentSig = async (): Promise<string> => {
    const revision = this.#fsRevision
    if (this.#cachedSig?.revision === revision) return this.#cachedSig.sig
    if (this.#pendingSig?.revision === revision) return this.#pendingSig.promise

    const promise = (async (): Promise<string> => {
      const history = get('@diamondcoreprocessor.com/HistoryService') as
        { sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string> } | undefined
      if (!history?.sign) return ''
      const sig = await history.sign(this)
      if (this.#fsRevision === revision) {
        this.#cachedSig = { revision, sig }
      }
      return sig
    })()

    this.#pendingSig = { revision, promise }
    promise.finally(() => {
      if (this.#pendingSig?.promise === promise) this.#pendingSig = null
    })
    return promise
  }

  /** The current layer for the user's lineage location — the
   *  authoritative "what's here" view. Resolved as
   *  HistoryService.currentLayerAt(currentSig()). Cached per
   *  fsRevision so a render that asks for the layer multiple times
   *  pays one resolve. Returns null if HistoryService isn't ready
   *  or there's no committed layer at the location yet. */
  public currentLayer = async (): Promise<unknown> => {
    const revision = this.#fsRevision
    if (this.#cachedLayer?.revision === revision) return this.#cachedLayer.layer
    if (this.#pendingLayer?.revision === revision) return this.#pendingLayer.promise

    const promise = (async (): Promise<unknown> => {
      const sig = await this.currentSig()
      if (!sig) return null
      const history = get('@diamondcoreprocessor.com/HistoryService') as
        { currentLayerAt?: (s: string) => Promise<unknown> } | undefined
      if (!history?.currentLayerAt) return null
      const layer = await history.currentLayerAt(sig)
      if (this.#fsRevision === revision) {
        this.#cachedLayer = { revision, layer }
      }
      return layer
    })()

    this.#pendingLayer = { revision, promise }
    promise.finally(() => {
      if (this.#pendingLayer?.promise === promise) this.#pendingLayer = null
    })
    return promise
  }

  // Per-revision memoization. invalidate() bumps #fsRevision on any FS change,
  // so the cache is auto-invalidated. In-flight dedup is keyed on revision so
  // a stale walk that resolves after a new invalidate() can't poison the cache.
  #cachedExplorerDir: { revision: number; dir: FileSystemDirectoryHandle | null } | null = null
  #pendingExplorerDir: { revision: number; promise: Promise<FileSystemDirectoryHandle | null> } | null = null

  public explorerDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const revision = this.#fsRevision

    if (this.#cachedExplorerDir?.revision === revision) {
      return this.#cachedExplorerDir.dir
    }

    if (this.#pendingExplorerDir?.revision === revision) {
      return this.#pendingExplorerDir.promise
    }

    const promise = (async (): Promise<FileSystemDirectoryHandle | null> => {
      let dir: FileSystemDirectoryHandle | null = null
      try {
        // The user-content name tree lives at the OPFS root
        // (`hypercombRoot === opfsRoot`). tryResolveFrom drives the
        // #materialized/#missing UI state off this canonical source.
        dir = await this.tryResolveFrom(this.store.hypercombRoot, this.explorerPath)
        // UNION drain-window fallback: a name folder still stranded under
        // a legacy content root (`__hive__/`, `hypercomb.io/`) until
        // Store's relocation drains it would otherwise report the path
        // unmaterialized. Probe those sources WITHOUT touching
        // #materialized/#missing (a stateless resolve) — a legacy hit is
        // the real directory, and the state stays owned by the canonical
        // pass above.
        if (!dir) {
          for (const legacy of [this.store.legacyHive, this.store.legacyHypercombIo]) {
            if (!legacy) continue
            const hit = await this.#resolveStateless(legacy, this.explorerPath)
            if (hit) { dir = hit; break }
          }
        }
      } catch {
        dir = null
      }
      if (this.#fsRevision === revision) {
        this.#cachedExplorerDir = { revision, dir }
      }
      return dir
    })()

    this.#pendingExplorerDir = { revision, promise }
    promise.finally(() => {
      if (this.#pendingExplorerDir?.promise === promise) {
        this.#pendingExplorerDir = null
      }
    })

    return promise
  }

  // -------------------------------------------------
  // status
  // -------------------------------------------------

  #ready = false
  #materialized = true
  #missing: readonly string[] = []
  #fsRevision = 0

  // Self-heal: after a navigation settles, an authoritative walk trims any
  // phantom tail from the address (see #healPath). #lastHealedPath memoizes
  // the last path we confirmed fully-real so fs-only invalidations (editing,
  // sync) don't re-walk an unchanged, already-valid path every tick.
  #healTimer: ReturnType<typeof setTimeout> | null = null
  #lastHealedPath = ''

  public get ready(): boolean { return this.#ready }
  public get materialized(): boolean { return this.#materialized }
  public get missing(): readonly string[] { return this.#missing }

  public changed = (): number => this.#fsRevision

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    super()
    // follow url changes (programmatic + back/forward)
    window.addEventListener('navigate', this.followLocation)
    window.addEventListener('popstate', this.followLocation)

    // OPFS mutations — bump fsRevision so per-revision caches
    // (listCellFolders, branchSet, explorerDir) see fresh disk state.
    // `fs:changed` is the bulk-emit signal: workers fire it BEFORE
    // committing layer state so renders triggered by the cascade
    // (cursor.onNewLayer) see post-mutation OPFS without triggering
    // additional per-cell layer commits.
    EffectBus.on('fs:changed', this.invalidate)
    EffectBus.on('cell:added', this.invalidate)
    EffectBus.on('cell:removed', this.invalidate)

    // best-effort initial sync (safe if nav/store aren't ready yet)
    this.followLocation()

    this.#ready = true
    this.dispatchEvent(new CustomEvent('change'))
  }

  public initialize = async (): Promise<void> => {
    this.followLocation()
    this.#ready = true
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -------------------------------------------------
  // domain resolution (used by navigation/search)
  // -------------------------------------------------

  public tryResolve = async (
    segments: readonly string[],
    start?: FileSystemDirectoryHandle
  ): Promise<FileSystemDirectoryHandle | null> => {
    if (!start) return null
    return await this.tryResolveFrom(start, segments)
  }

  private readonly tryResolveFrom = async (
    start: FileSystemDirectoryHandle,
    segments: readonly string[]
  ): Promise<FileSystemDirectoryHandle | null> => {

    let dir = start

    for (let i = 0; i < segments.length; i++) {
      const seg = (segments[i] ?? '').trim()
      if (!seg) continue

      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        const wasMaterialized = this.#materialized
        const hadMissing = this.#missing.length > 0
        this.#materialized = false
        this.#missing = segments.slice(i)
        if (wasMaterialized || !hadMissing) this.dispatchEvent(new CustomEvent('change'))
        return null
      }
    }

    if (!this.#materialized || this.#missing.length > 0) {
      this.#materialized = true
      this.#missing = []
      this.dispatchEvent(new CustomEvent('change'))
    }
    return dir
  }

  /** Resolve a name path under `start` WITHOUT mutating #materialized /
   *  #missing — the drain-window fallback used by explorerDir to probe a
   *  legacy content root. Returns the handle or null; no side effects, no
   *  'change' event. */
  readonly #resolveStateless = async (
    start: FileSystemDirectoryHandle,
    segments: readonly string[],
  ): Promise<FileSystemDirectoryHandle | null> => {
    let dir = start
    for (const raw of segments) {
      const seg = (raw ?? '').trim()
      if (!seg) continue
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        return null
      }
    }
    return dir
  }

  public addMarker = async (_segments: readonly string[], _signature: string): Promise<void> => {
    // no-op: directory-based markers removed
  }

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  private readonly invalidate = (): void => {
    this.#fsRevision = this.#fsRevision + 1
    this.dispatchEvent(new CustomEvent('change'))
    // Self-heal DISABLED — it made a freshly-created tile un-enterable until a
    // page refresh. A create renders the new tile incrementally (cell:added,
    // viaUpdate) BEFORE its parent-head commit (importTree) lands. Clicking the
    // just-appeared tile fires this invalidate → #scheduleHeal, whose oracle
    // (deepestRealPrefix) reads the parent's children from the not-yet-updated
    // head, finds the child "absent" AUTHORITATIVELY (not cold, so the cold
    // guard doesn't spare it), and replaceRaw()s the address back to the parent.
    // Net: you couldn't navigate into a new tile without refreshing (which warms
    // the heads so the heal stops mis-clamping). `main` has no self-heal and
    // navigates correctly; matching that. The common double-click phantom-URL
    // race is already closed by TileOverlayDrone's prevent-guard, so dropping
    // this backstop only forgoes auto-repair of rare typed/stale phantom URLs.
    // this.#scheduleHeal()
  }

  // -------------------------------------------------
  // self-heal — repair a phantom address
  //
  // A too-early / double-click can append a URL segment for a child that
  // doesn't exist at the new level (the prevent guard in TileOverlayDrone
  // closes the common click race; this is the backstop for anything that
  // still arrives — typed URL, shared link, back/forward, sync). Without
  // repair the bad segment sticks and each further stale click deepens it
  // (`/a/b/c` → `/a/b/c/c` → …), disjoint from the real tree.
  //
  // The oracle is HistoryService.deepestRealPrefix — it uses the SAME child
  // resolution the renderer uses (each child layer's own `.name`), so a
  // membership test matches what actually paints as a navigable tile. It
  // NEVER clamps on cold/uncertain data (a false clamp of a real-but-not-yet-
  // warm location is worse than the phantom), preserves empty-but-real leaves
  // and virtual sub-layers (they are real children), and keeps segment[0] as
  // an always-valid variable root.
  // -------------------------------------------------

  readonly #scheduleHeal = (): void => {
    // Only walk when the path actually changed — fs-only invalidations on an
    // already-validated path are skipped. Debounced so a burst coalesces.
    const key = this.explorerPath.join('')
    if (key === this.#lastHealedPath) return
    if (this.#healTimer) clearTimeout(this.#healTimer)
    this.#healTimer = setTimeout(() => { this.#healTimer = null; void this.#healPath() }, 0)
  }

  readonly #healPath = async (): Promise<void> => {
    const path = this.explorerPath
    if (path.length <= 1) { this.#lastHealedPath = path.join(''); return }

    const revision = this.#fsRevision
    const history = get('@diamondcoreprocessor.com/HistoryService') as
      { deepestRealPrefix?: (s: readonly string[]) => Promise<{ prefix: string[]; cold: boolean }> } | undefined
    if (!history?.deepestRealPrefix) return // not ready yet — a later change re-triggers

    let result: { prefix: string[]; cold: boolean }
    try { result = await history.deepestRealPrefix(path) }
    catch { return }

    // Abandon if the location moved while we resolved — the newer path
    // scheduled its own heal.
    if (this.#fsRevision !== revision) return
    if (!this.sameSegments(this.explorerPath, path)) return

    // Uncertain read — never clamp on non-authoritative data. Leave
    // #lastHealedPath unset so a subsequent invalidation re-walks once warm.
    if (result.cold) return

    if (result.prefix.length >= path.length) {
      // Fully real — remember it so we don't re-walk on every fs tick.
      this.#lastHealedPath = path.join('')
      return
    }

    // Phantom tail — repair the address back to the deepest real ancestor.
    this.explorerPath = result.prefix
    try { this.navigation.replaceRaw(result.prefix) } catch { /* nav not ready */ }
    this.invalidate()
    console.warn(`[hypercomb] lineage: healed phantom address /${path.join('/')} -> /${result.prefix.join('/')}`)
  }

  private readonly followLocation = (): void => {
    try {
      // explorer path must stay lossless; use raw decoded URL segments
      const next = this.navigation.segmentsRaw()

      // do not spam invalidations if nothing changed
      if (this.sameSegments(this.explorerPath, next)) return

      this.explorerPath = next
      this.invalidate()
    } catch {
      // ignore until nav is ready
    }
  }

  private readonly sameSegments = (a: readonly string[], b: readonly string[]): boolean => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if ((a[i] ?? '') !== (b[i] ?? '')) return false
    }
    return true
  }

  private readonly dispatchNavigateFallback = (): void => {
    try {
      window.dispatchEvent(new Event('navigate'))
    } catch {
      // ignore
    }
  }
}

register('@hypercomb.social/Lineage', new Lineage())
console.log('[hypercomb] lineage: explorerDir memoized per fsRevision (2026-05-01)')
