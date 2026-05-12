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
  readonly #onViewModeChange = (): void => { void this.#reconcile() }

  /** Window-level contextmenu handler. Active only in website mode —
   *  right-click navigates up one level, matching the iframe-injected
   *  hook and hexagon-view's right-button-down. The capture-phase
   *  listener fires before downstream consumers so the browser's
   *  default context menu never appears in this mode. */
  readonly #onGlobalContextMenu = (e: MouseEvent): void => {
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (!vm || vm.mode !== 'website') return
    e.preventDefault()
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    const segments = [...(lineage?.explorerSegments?.() ?? [])]
    if (segments.length === 0) return
    this.#navigate(segments.slice(0, -1))
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

    // The current cell's `context` slot may hold an HTML resource sig —
    // that's the cell's page. Each cell carries its own; lineage
    // navigation drives page changes. No bundle, no manifest, no path
    // table — the lineage IS the route.
    const cellPageSig = await this.#findContextPage(segments, store)
    if (cellPageSig) {
      await this.#mountCellPage(segments, cellPageSig, store)
      return
    }

    // No page on this cell → tear down. Walking up to find an
    // ancestor's bundle is the legacy behavior; with per-cell pages
    // every cell is responsible for its own surface.
    this.#teardown()
  }

  /** Per-cell page lookup. Reads the cell's layer at `segments`,
   *  scans its `context` slot for the first HTML-shaped resource,
   *  returns that sig. Probes the resource head to detect HTML rather
   *  than trusting position — a cell's bag is heterogeneous (prior
   *  impls, chrome refs, examples) and the renderer should pick the
   *  page kind by content, not by index. */
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
        if (segments.length > 0) this.#navigate(segments.slice(0, -1))
        return
      }
      if (href.startsWith('/')) {
        const parts = href.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
        this.#navigate(parts)
        return
      }
      const parts = href.replace(/^\.\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
      this.#navigate([...segments, ...parts])
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

  #navigate(path: readonly string[]): void {
    const lineage = this.resolve<any>('lineage')
    if (!lineage) return

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
  let out = text.replace(/resource:([0-9a-f]{64})/g, `${RESOURCE_URL_PREFIX}$1`)
  out = out.replace(/((?:src|href|data-src)=)(["'])([0-9a-f]{64})\2/g,
    (_m, attr, q, sig) => `${attr}${q}${RESOURCE_URL_PREFIX}${sig}${q}`)
  return out
}

const _siteView = new SiteViewDrone()
window.ioc.register('@diamondcoreprocessor.com/SiteViewDrone', _siteView)
