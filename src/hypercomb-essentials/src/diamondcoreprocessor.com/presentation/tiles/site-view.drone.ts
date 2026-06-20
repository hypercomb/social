// diamondcoreprocessor.com/presentation/tiles/site-view.drone.ts
//
// Full-viewport site takeover. Each cell carries its own page in its
// `context` slot — when website mode is active, the current cell's
// HTML resource is fetched, rewritten, and mounted inline. Navigation
// moves between cells; each cell's page replaces the previous one.
//
// The legacy `websiteSig` bundle path (concatenated sigs + manifest
// `pages[path]` lookup) was removed: child paths required explicit
// manifest entries to render, so navigations followed a link into a
// blank page whenever the bundle hadn't enumerated that path. The
// per-cell model uses lineage-as-routing — a link to `./team`
// navigates the lineage one level down, and that cell's `context`
// page mounts. No bundle, no manifest, no path-table.

import { Drone, SITE_VIEW_IOC_KEY, RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { rewritePageRefs } from '../../sharing/decoration-closure.js'
import { WEBSITE_SLOT } from '../../commands/website-slot.js'

type MountState = {
  host: HTMLDivElement
  /** sig of the cell page currently mounted. */
  pageSig: string
  /** lineage segments of the cell whose page is mounted. */
  sitePath: readonly string[]
  /** unmount handler — drops style/link/script nodes and listeners. */
  unmount: () => void
}

export class SiteViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport site takeover. Mounts each cell\'s `context` HTML resource as the active page; lineage navigation drives page changes.'

  #mount: MountState | null = null
  #viewActive = false
  #registered = false
  #lineageBound = false
  #viewModeBound = false
  #globalContextMenuBound = false
  /**
   * Lineage of the cell where the current website session started —
   * captured the moment ViewMode flipped from hexagons → website (or
   * on boot if VM was already 'website'). Acts as the navigation
   * floor: right-click (and anchor `..`) inside the site can walk
   * up freely until segments shrink down to this length, then the
   * next "go up" exits the site instead of crossing into the parent
   * hexagon hierarchy. Null while not in a website session.
   */
  #siteEntrySegments: readonly string[] | null = null

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens: string[] = []
  protected override emits = ['view:active']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register(SITE_VIEW_IOC_KEY, this)
      this.#registered = true
    }
    if (!this.#lineageBound) {
      const lineage = this.resolve<any>('lineage')
      if (lineage?.addEventListener) {
        lineage.addEventListener('change', this.#onLineageChange)
        this.#lineageBound = true
      }
    }
    if (!this.#viewModeBound) {
      const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<EventTarget>('@hypercomb.social/ViewMode')
      if (vm?.addEventListener) {
        vm.addEventListener('change', this.#onViewModeChange)
        this.#viewModeBound = true
      }
    }
    if (!this.#globalContextMenuBound) {
      // Right-click anywhere outside the iframe (or on a cell that has
      // no per-cell page yet) → navigate up. Mirrors hexagon-view's
      // right-button-down. The handler is gated on ViewMode='website'
      // so it doesn't interfere with the hexagon canvas's own right-
      // click bindings (which already do the same thing in that mode).
      window.addEventListener('contextmenu', this.#onGlobalContextMenu, true)
      this.#globalContextMenuBound = true
    }
    // Boot-time entry capture. If ViewMode persisted as 'website'
    // across a reload, no 'change' event will fire — record the
    // current lineage as this session's site root once on boot.
    if (this.#siteEntrySegments === null) {
      const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
      if (vm?.mode === 'website') this.#captureSiteEntry()
    }
    void this.#reconcile()
  }

  protected override dispose(): void {
    const lineage = this.resolve<any>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) {
      lineage.removeEventListener('change', this.#onLineageChange)
    }
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<EventTarget>('@hypercomb.social/ViewMode')
    if (this.#viewModeBound && vm?.removeEventListener) {
      vm.removeEventListener('change', this.#onViewModeChange)
    }
    if (this.#globalContextMenuBound) {
      window.removeEventListener('contextmenu', this.#onGlobalContextMenu, true)
    }
    this.#teardown()
  }

  readonly #onLineageChange = (): void => { void this.#reconcile() }
  readonly #onViewModeChange = (): void => {
    // Track session entry: capture on hexagons → website, drop on exit.
    // Boundary check in #onGlobalContextMenu / onAnchorClick keys off this.
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (vm?.mode === 'website') {
      if (this.#siteEntrySegments === null) this.#captureSiteEntry()
    } else {
      this.#siteEntrySegments = null
    }
    void this.#reconcile()
  }

  #captureSiteEntry(): void {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    this.#siteEntrySegments = [...(lineage?.explorerSegments?.() ?? [])]
  }

  /** Window-level contextmenu handler. Active only in website mode —
   *  right-click as a universal "back to the site" gesture. The
   *  capture-phase listener fires before downstream consumers so the
   *  browser's default context menu never appears in this mode.
   *
   *  The "site root" is the cell where this website session began
   *  (`#siteEntrySegments`), not the hypercomb lineage root. Three
   *  cases, keyed on the relationship between current segments and
   *  the site entry:
   *
   *   • Inside the site (descendant of entry) → walk up one level.
   *   • At the site root (segments equal entry) → no-op. We stay
   *     rather than walking up into `/`, which usually has no
   *     content. The way out is the `/website` toggle, not right-
   *     click.
   *   • Outside the site (sibling or unrelated cell, e.g. an
   *     `<a href="/dashboard">` link navigated to a route not under
   *     the site root) → jump back to the entry. Without this the
   *     user gets stranded on a blank route with no page mounted.
   *
   *  We do NOT exit website mode in any case: the gesture is a
   *  back-to-the-site, not a back-to-hexagons. */
  readonly #onGlobalContextMenu = (e: MouseEvent): void => {
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (!vm || vm.mode !== 'website') return
    e.preventDefault()
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    const segments = [...(lineage?.explorerSegments?.() ?? [])]
    const entry = this.#siteEntrySegments ?? []
    const insideSite = segments.length >= entry.length
      && entry.every((seg, i) => segments[i] === seg)
    if (insideSite) {
      if (segments.length <= entry.length) return
      this.#navigate(segments.slice(0, -1))
      return
    }
    void this.#navigate(entry)
  }

  async #reconcile(): Promise<void> {
    const lineage = this.resolve<any>('lineage')
    const store = this.resolve<any>('store')
    if (!lineage || !store?.hypercombRoot || !store?.getResource) return

    // The website surface is gated on ViewMode. Hexagons mode → tear
    // down regardless of what's in the cell's slots; the user is
    // navigating tiles, not reading pages. `/website` (or any toggle
    // that flips ViewMode to 'website') brings the page back. Per-cell
    // mounting is opt-in by the user, not auto-on whenever a context
    // page exists.
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (vm && vm.mode !== 'website') {
      this.#teardown()
      return
    }

    // Strip any stale tile-selection hash so the address bar reads
    // cleanly while in website mode (where selection has no consumer).
    if (window.location.hash) {
      try {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      } catch { /* private mode / older browser — non-fatal */ }
    }

    const segments: string[] = [...(lineage.explorerSegments?.() ?? [])]

    // The cell's page lives in one of three places, queried in order:
    //   1. The `website` slot — the explicit, first-class page slot: a
    //      flat array of HTML resource sigs (newest = current), no
    //      decoration envelope. The migration target.
    //   2. The `decorations` slot — sigs into `__resources__` of shape
    //      `{ kind: 'visual:website:page', payload: { htmlSig } }`. The
    //      prior visual-bee home; read-through so already-built sites
    //      keep rendering.
    //   3. The legacy `context` slot — raw HTML resource sigs. Oldest
    //      data lives here; falls back when neither above is present.
    // Each cell carries its own; lineage navigation drives page changes.
    // No bundle, no manifest, no path table — the lineage IS the route.
    let cellPageSig = await this.#findWebsitePage(segments)
    if (!cellPageSig) {
      cellPageSig = await this.#findDecorationPage(segments, store)
    }
    if (!cellPageSig) {
      cellPageSig = await this.#findContextPage(segments, store)
    }
    if (cellPageSig) {
      await this.#mountCellPage(segments, cellPageSig, store)
      return
    }

    // No page on this cell → tear down. Walking up to find an
    // ancestor's bundle is the legacy behavior; with per-cell pages
    // every cell is responsible for its own surface.
    this.#teardown()
  }

  /** First-class page lookup: the cell's `website` slot holds the page's
   *  HTML resource signature DIRECTLY (no decoration envelope). The
   *  newest entry is the current page. Checked BEFORE the decoration and
   *  context scans so a migrated cell renders from its explicit slot,
   *  while un-migrated cells fall through unchanged.
   *
   *  The slot is page-only by contract, so the sig is trusted and handed
   *  straight to #mountCellPage (which fetches + mounts it). Returns null
   *  when the slot is absent or empty — the caller then tries the legacy
   *  decoration and context paths, so nothing built before this slot
   *  existed goes dark. */
  async #findWebsitePage(segments: readonly string[]): Promise<string | null> {
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    const history = ioc?.get<{
      sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (locationSig: string) => Promise<Record<string, unknown> | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null

    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const slot = layer[WEBSITE_SLOT]
      const sigs: string[] = Array.isArray(slot)
        ? slot.map((s: unknown) => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s))
        : []
      return sigs.length ? sigs[sigs.length - 1] : null
    } catch {
      return null
    }
  }

  /** Decoration-based page lookup (the visual-bee migration target).
   *  Reads the cell's `decorations` slot, loads each sig from
   *  `__resources__`, filters by the website bee's declared
   *  `decorationKind` (looked up via VisualBeeRegistry), and returns the
   *  first match's `payload.htmlSig` — the HTML resource the renderer
   *  ultimately mounts.
   *
   *  Decoration JSONs live in `__resources__` (the shared content store)
   *  so peer-supplied decorations come through the same fetch pipeline
   *  as any other resource — adopter sees peer's `decorations` slot
   *  sigs in the merkle tree, and resolving them through getResource
   *  works whether the content is local or pulled from a relay.
   *
   *  Returns null if VisualBeeRegistry is unavailable, the website bee
   *  isn't registered yet, the cell has no `decorations` slot, or no
   *  entries match the kind. The caller then falls back to the legacy
   *  `context` slot for cells whose pages haven't been migrated. */
  async #findDecorationPage(
    segments: readonly string[],
    store: {
      getResource?: (sig: string) => Promise<Blob | null>
    },
  ): Promise<string | null> {
    if (!store.getResource) return null
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    if (!ioc) return null

    const registry = ioc.get<{
      get: (view: string) => { decorationKind: string } | undefined
    }>('@diamondcoreprocessor.com/VisualBeeRegistry')
    const bee = registry?.get('website')
    if (!bee?.decorationKind) return null

    const history = ioc.get<{
      sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (locationSig: string) => Promise<{ decorations?: unknown } | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null

    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const decorations = (layer as { decorations?: unknown }).decorations
      const sigs: string[] = Array.isArray(decorations)
        ? decorations.map((s: unknown) => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s))
        : []
      for (const decorationSig of sigs) {
        const blob = await store.getResource(decorationSig)
        if (!blob) continue
        try {
          const record = JSON.parse(await blob.text()) as {
            kind?: string
            payload?: { htmlSig?: string }
          }
          if (record?.kind !== bee.decorationKind) continue
          const htmlSig = record?.payload?.htmlSig
          if (typeof htmlSig === 'string' && /^[0-9a-f]{64}$/.test(htmlSig)) {
            return htmlSig
          }
        } catch { /* malformed record — skip */ }
      }
    } catch { /* fall through — caller will try legacy context */ }
    return null
  }

  /** Legacy per-cell page lookup. Reads the cell's layer at `segments`,
   *  scans its `context` slot for the first HTML-shaped resource,
   *  returns that sig. Probes the resource head to detect HTML rather
   *  than trusting position — a cell's bag is heterogeneous (prior
   *  impls, chrome refs, examples) and the renderer should pick the
   *  page kind by content, not by index.
   *
   *  Used as fallback when `#findDecorationPage` returns null — i.e. for
   *  cells whose pages were written before the visual-bee migration. */
  async #findContextPage(
    segments: readonly string[],
    store: { getResource: (sig: string) => Promise<Blob | null> },
  ): Promise<string | null> {
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    const history = ioc?.get<{
      sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (locationSig: string) => Promise<{ context?: unknown } | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null

    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const context = (layer as { context?: unknown }).context
      const sigs: string[] = Array.isArray(context)
        ? context.map((s: unknown) => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s))
        : []
      for (const sig of sigs) {
        const blob = await store.getResource(sig)
        if (!blob) continue
        // 64 bytes is enough to spot a doctype, root tag, or BOM-prefixed xml.
        const head = await blob.slice(0, 64).text()
        if (/^\s*(?:﻿)?(<!doctype|<html|<svg|<\?xml)/i.test(head)) return sig
      }
    } catch { /* fall through — caller will try legacy bundle path */ }
    return null
  }

  /** Mount the per-cell HTML inline in the live document. No iframe,
   *  no shadow DOM. The author's HTML is parsed, its `<style>` blocks
   *  are appended to <head> (tagged with a marker so we can lift them
   *  cleanly on unmount), its `<script>` blocks are recreated as live
   *  script elements so they actually run, and its `<body>` content
   *  is dropped into a host div pinned over the viewport.
   *
   *  CSS like `html { background: var(--bg) }` applies to the live
   *  page's html element — which is exactly the right scope: in
   *  website mode every other surface is `display:none` via the
   *  `hc-view-website` body class, so the page IS the cell's content.
   *  No selector rewrites needed.
   *
   *  Navigation: anchor clicks bubble to the host's click listener,
   *  which intercepts internal hrefs and updates lineage. The
   *  resource is already warm — the layer-slot preloader walks
   *  `context` slot sigs into the resource cache when the layer is
   *  visited, so render is a synchronous DOM operation. */
  async #mountCellPage(
    segments: readonly string[],
    pageSig: string,
    store: { getResource: (sig: string) => Promise<Blob | null> },
  ): Promise<void> {
    // Same per-cell page already mounted — just update the sitePath
    // marker so navigate() math stays correct on follow-up clicks.
    if (this.#mount && this.#mount.pageSig === pageSig) {
      this.#mount.sitePath = [...segments]
      return
    }

    const blob = await store.getResource(pageSig)
    if (!blob) { this.#teardown(); return }
    const rawHtml = await blob.text()

    this.#teardown()

    const parsed = new DOMParser().parseFromString(rewriteCellPageRefs(rawHtml), 'text/html')

    // Lift <style> from parsed head into the live document head, tagged
    // so unmount can remove exactly these (and not anyone else's).
    const styleNodes: HTMLStyleElement[] = []
    for (const s of Array.from(parsed.querySelectorAll('style'))) {
      const live = document.createElement('style')
      live.setAttribute('data-hc-cell-page', pageSig)
      live.textContent = s.textContent ?? ''
      document.head.appendChild(live)
      styleNodes.push(live)
    }

    // Hoist <link rel="stylesheet"> too, same lifecycle.
    const linkNodes: HTMLLinkElement[] = []
    for (const l of Array.from(parsed.querySelectorAll('link[rel="stylesheet"]'))) {
      const live = document.createElement('link')
      live.setAttribute('data-hc-cell-page', pageSig)
      for (const a of Array.from(l.attributes)) live.setAttribute(a.name, a.value)
      document.head.appendChild(live)
      linkNodes.push(live)
    }

    // Move <body> children into a host div pinned over the viewport.
    const host = document.createElement('div')
    host.id = 'hc-site-view-host'
    host.style.cssText =
      'position:fixed;inset:0;z-index:59988;overflow:auto;'
    // The site host IS the page's scroll surface. Without this opt-out the
    // always-on hex wheel-zoom handler (MousewheelZoomInput) preventDefaults
    // every wheel/trackpad event over the full-viewport canvas — which is only
    // visually suppressed in website mode, still full-rect in layout — so the
    // page can't scroll and tall pages clip. `data-consumes-wheel` makes that
    // handler bail when the event is inside us (same hatch the history-viewer
    // overlay uses), restoring native scroll.
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    const body = parsed.body
    if (body) {
      while (body.firstChild) host.appendChild(body.firstChild)
    }

    // Re-create <script> elements so they actually execute. innerHTML
    // / appendChild of inert <script> nodes won't run; cloning into a
    // fresh element triggers parser-style execution. Run pre-paint /
    // head scripts in their authored order before body scripts so any
    // theme-stamping fires before render.
    const scriptNodes: HTMLScriptElement[] = []
    const runScripts = (sources: readonly HTMLScriptElement[]): void => {
      for (const s of sources) {
        const live = document.createElement('script')
        for (const a of Array.from(s.attributes)) live.setAttribute(a.name, a.value)
        live.textContent = s.textContent ?? ''
        host.appendChild(live)
        scriptNodes.push(live)
      }
    }
    runScripts(Array.from(parsed.head.querySelectorAll('script')))
    runScripts(Array.from(host.querySelectorAll('script')).filter(s => !scriptNodes.includes(s)))

    // Internal-anchor click → lineage navigate. Bubbling listener on
    // the host catches every click on an inflated <a>; external,
    // hash, and resource: URLs pass through.
    const onAnchorClick = (e: Event): void => {
      const target = e.target as Element | null
      const a = target?.closest?.('a')
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href || /^(https?:|mailto:|tel:|data:|\/\/|#)/i.test(href)) return
      if (href.startsWith(RESOURCE_URL_PREFIX)) return
      e.preventDefault()
      if (href === '..' || href === '../') {
        // Same site-entry floor as right-click — clicking `..` at or
        // below the site root is a no-op. We don't exit website mode
        // here; the user only asked to block nav past root, not to
        // be ejected back to hexagons.
        const entry = this.#siteEntrySegments ?? []
        if (segments.length <= entry.length) return
        void this.#navigate(segments.slice(0, -1))
        return
      }
      if (href.startsWith('/')) {
        const parts = href.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
        void this.#navigate(parts)
        return
      }
      const parts = href.replace(/^\.\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
      void this.#navigate([...segments, ...parts])
    }
    host.addEventListener('click', onAnchorClick, true)

    this.#mount = {
      host,
      pageSig,
      sitePath: [...segments],
      unmount: () => {
        host.removeEventListener('click', onAnchorClick, true)
        for (const node of styleNodes) node.remove()
        for (const node of linkNodes) node.remove()
        for (const node of scriptNodes) node.remove()
      },
    }
  }

  #teardown(): void {
    if (this.#mount) {
      try { this.#mount.unmount() } catch { /* noop */ }
      this.#mount.host.remove()
      this.#mount = null
    }
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    this.emitEffect<{ active: boolean }>('view:active', { active })
  }

  /**
   * True only when the cell at `segments` is DEFINITELY page-less: its layer
   * resolves but carries no mountable page (neither a `visual:website:page`
   * decoration nor a legacy `context` page). Returns false when we can't tell —
   * no store/history, or the layer doesn't resolve (cold cache / not yet
   * committed) — so a momentary cold read never blocks a valid link; only a
   * confirmed dead-end is. Powers the #navigate guard below.
   */
  async #isDefinitelyPageless(segments: readonly string[]): Promise<boolean> {
    const store = this.resolve<any>('store')
    const history = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{
      sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (sig: string) => Promise<unknown | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!store?.getResource || !history) return false
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => null)
    if (!locSig) return false
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return false   // unresolved (cold/missing) — don't block
    let pageSig = await this.#findDecorationPage(segments, store)
    if (!pageSig) pageSig = await this.#findContextPage(segments, store)
    return !pageSig            // layer present but no page → confirmed dead-end
  }

  async #navigate(path: readonly string[]): Promise<void> {
    const lineage = this.resolve<any>('lineage')
    if (!lineage) return

    // Never strand the user on a page-less node. In website mode a cell with no
    // page renders NOTHING — a click that lands there tears the site down to a
    // blank "empty website mode" screen. If the destination is definitely
    // page-less (its layer resolves but has no page), ignore the navigation and
    // stay on the current page. Uses the same page resolution #reconcile mounts
    // with, so the guard and the eventual mount never disagree; a cold/
    // unresolved read is never treated as page-less, so valid links still work.
    if (await this.#isDefinitelyPageless(path)) return

    // Tile selections live in `window.location.hash`. They're a hex-
    // mode feature — selecting tiles to act on. In website mode the
    // hash has no consumer and just sticks around as a stale "#" in
    // the address bar through every navigation (Navigation.go reads
    // `window.location.hash` and re-appends it on every push). Strip
    // it here before the lineage steps so the cleaned URL is what
    // gets pushed.
    if (window.location.hash) {
      try {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      } catch { /* private mode / older browser — non-fatal */ }
    }

    const current: string[] = [...(lineage.explorerSegments?.() ?? [])]
    const next = [...path]
    let common = 0
    while (common < current.length && common < next.length && current[common] === next[common]) common++
    for (let i = 0; i < current.length - common; i++) lineage.explorerUp?.()
    for (let i = common; i < next.length; i++) lineage.explorerEnter?.(next[i])
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-cell page ref rewrite. Resource and bare-sig src/href references
// are rewritten to `/@resource/<sig>`. No manifest-keyed `asset:<name>`
// lookup — per-cell pages reference resources directly by sig.
// ──────────────────────────────────────────────────────────────────────────

function rewriteCellPageRefs(text: string): string {
  // The rewrite shares its ref patterns with the closure walk's
  // `extractPageRefSigs` (both in decoration-closure.ts), so the set of
  // resources the renderer resolves can never diverge from the set the
  // host-push / adopt closure carries — divergence would mean missing images
  // on an imported machine.
  return rewritePageRefs(text, RESOURCE_URL_PREFIX)
}

const _siteView = new SiteViewDrone()
window.ioc.register('@diamondcoreprocessor.com/SiteViewDrone', _siteView)
