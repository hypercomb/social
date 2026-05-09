// diamondcoreprocessor.com/presentation/tiles/site-view.drone.ts
//
// Full-viewport site takeover driven by a single decoration.
//
// Listens to Lineage. On every navigation:
//   1. Walk root → current cell looking for `websiteSig` on any ancestor.
//      The nearest ancestor with a bundle wins; its cell is the SITE ROOT.
//   2. Fetch the bundle, parse concatenated 64-char sigs.
//   3. First sig → manifest JSON. Lookup `pages[pathRelativeToSiteRoot]`
//      (or `entry` fallback) → page HTML sig.
//   4. Fetch page HTML, rewrite `resource:<sig>` / `asset:<name>` refs,
//      mount in Shadow DOM. Pixi host hides via view:active effect.
//   5. On intra-site navigation: update without remount. On exit (no
//      ancestor carries websiteSig), unmount and re-show Pixi.
//
// Nothing in this drone cares how the bundle was authored — a Claude
// Code skill writes it at design time. The runtime just unpacks and
// renders.

import {
  Drone,
  type TileContentHandle,
  type TileContentRegistry,
  type TileContentRenderer,
  type TileMountContext,
  type TileRenderFrame,
  type WebsiteManifest,
  TILE_CONTENT_REGISTRY_IOC_KEY,
  SITE_VIEW_IOC_KEY,
  CELL_WEBSITE_PROPERTY,
  CELL_RENDERER_PROPERTY,
  RESOURCE_URL_PREFIX,
  parseBundle,
} from '@hypercomb/core'
import { readCellProperties, isSignature } from '../../editor/tile-properties.js'

class Registry implements TileContentRegistry {
  readonly #byKey = new Map<string, TileContentRenderer>()
  readonly #byKind = new Map<string, TileContentRenderer[]>()
  register(renderer: TileContentRenderer): void {
    if (this.#byKey.has(renderer.key)) this.unregister(renderer.key)
    this.#byKey.set(renderer.key, renderer)
    const bucket = this.#byKind.get(renderer.kind) ?? []
    bucket.push(renderer)
    bucket.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    this.#byKind.set(renderer.kind, bucket)
  }
  unregister(key: string): void {
    const r = this.#byKey.get(key); if (!r) return
    this.#byKey.delete(key)
    const bucket = this.#byKind.get(r.kind)?.filter(x => x.key !== key) ?? []
    if (bucket.length) this.#byKind.set(r.kind, bucket)
    else this.#byKind.delete(r.kind)
  }
  resolve(kind: string): TileContentRenderer | null {
    return this.#byKind.get(kind)?.[0] ?? null
  }
}

type MountState = {
  handle: TileContentHandle
  host: HTMLDivElement
  kind: string
  siteSig: string
  sitePath: readonly string[]
}

export class SiteViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport site takeover. Reads a `websiteSig` decoration on the nearest ancestor, unpacks the bundle, and renders the page matching the current lineage path.'

  readonly #registry = new Registry()
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
      this.#registry.register(defaultWebsiteRenderer)
      window.ioc.register(TILE_CONTENT_REGISTRY_IOC_KEY, this.#registry)
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

    // 1) Per-cell page (NEW): the current cell's `context` slot may
    //    hold an HTML resource sig — that's the cell's implementation.
    //    No bundle, no manifest. Each cell carries its own.
    const cellPageSig = await this.#findContextPage(segments, store)
    if (cellPageSig) {
      await this.#mountCellPage(segments, cellPageSig, store)
      return
    }

    // 2) Legacy: walk ancestors for a `websiteSig` bundle.
    const found = await this.#findNearestWebsite(store.hypercombRoot, segments)

    if (!found) {
      this.#teardown()
      return
    }

    const { siteSig, sitePath, kind } = found
    const pagePath = segments.slice(sitePath.length)
    const renderer = this.#registry.resolve(kind)
    if (!renderer) { this.#teardown(); return }

    // Same site mounted already — just update the frame.
    if (this.#mount && this.#mount.siteSig === siteSig && this.#mount.kind === kind) {
      const frame: TileRenderFrame = { pagePath, fullPath: segments }
      try { this.#mount.handle.update(frame) } catch { /* noop */ }
      this.#mount.sitePath = sitePath
      return
    }

    // Different site or no mount yet → load bundle and mount fresh.
    const manifest = await this.#loadManifest(store, siteSig)
    if (!manifest) { this.#teardown(); return }

    this.#teardown()
    this.#setViewActive(true)

    const host = document.createElement('div')
    host.id = 'hc-site-view-host'
    host.style.cssText =
      'position:fixed;inset:0;z-index:59988;background:#fff;overflow:hidden;'
    document.body.appendChild(host)

    const frame: TileRenderFrame = { pagePath, fullPath: segments }
    const ctx: TileMountContext = {
      host,
      manifest,
      getResource: (sig) => store.getResource(sig),
      frame,
      navigate: (path) => this.#navigate(path),
    }

    try {
      const handle = await renderer.mount(ctx)
      this.#mount = { handle, host, kind, siteSig, sitePath }
    } catch (err) {
      console.warn('[site-view] renderer failed:', err)
      host.remove()
      this.#setViewActive(false)
    }
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
    if (this.#mount && this.#mount.kind === 'cell-page' && this.#mount.siteSig === pageSig) {
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
      kind: 'cell-page',
      siteSig: pageSig,
      sitePath: [...segments],
      handle: {
        update: () => { /* per-cell pages re-mount when sig changes */ },
        unmount: () => {
          host.removeEventListener('click', onAnchorClick, true)
          for (const node of styleNodes) node.remove()
          for (const node of linkNodes) node.remove()
          for (const node of scriptNodes) node.remove()
        },
      },
    }
  }

  async #findNearestWebsite(
    root: FileSystemDirectoryHandle,
    segments: readonly string[]
  ): Promise<{ siteSig: string; sitePath: readonly string[]; kind: string } | null> {
    // Walk from current cell UP — first ancestor (or self) with
    // websiteSig wins. Walking root-down then picking the deepest is
    // equivalent; we do root-down because it aligns with OPFS handles.
    let dir: FileSystemDirectoryHandle | null = root
    const visited: Array<{ dir: FileSystemDirectoryHandle; path: string[] }> = [{ dir: root, path: [] }]
    for (const seg of segments) {
      if (!dir) break
      try { dir = await dir.getDirectoryHandle(seg) } catch { dir = null; break }
      if (dir) visited.push({ dir, path: [...visited[visited.length - 1].path, seg] })
    }

    // Scan deepest first — closer ancestor wins.
    for (let i = visited.length - 1; i >= 0; i--) {
      const { dir, path } = visited[i]
      const props: Record<string, unknown> = await readCellProperties(dir).catch(() => ({} as Record<string, unknown>))
      const sig = props[CELL_WEBSITE_PROPERTY]
      if (!isSignature(sig)) continue

      let kind = 'website'
      const override = props[CELL_RENDERER_PROPERTY]
      if (override && typeof override === 'object' && typeof (override as any).kind === 'string') {
        kind = (override as any).kind
      }
      return { siteSig: sig as string, sitePath: path, kind }
    }

    return null
  }

  async #loadManifest(store: any, siteSig: string): Promise<WebsiteManifest | null> {
    try {
      const bundleBlob = await store.getResource(siteSig)
      if (!bundleBlob) return null
      const bundleText = await bundleBlob.text()
      const sigs = parseBundle(bundleText)
      if (sigs.length === 0) return null

      const manifestSig = sigs[0]
      const manifestBlob = await store.getResource(manifestSig)
      if (!manifestBlob) return null
      const manifest = JSON.parse(await manifestBlob.text()) as WebsiteManifest
      if (manifest?.version !== 1) return null
      return manifest
    } catch { return null }
  }

  #teardown(): void {
    if (this.#mount) {
      try { this.#mount.handle.unmount() } catch { /* noop */ }
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
// Default 'website' renderer — fetch page HTML, rewrite refs, render.
// ──────────────────────────────────────────────────────────────────────────

const defaultWebsiteRenderer: TileContentRenderer = {
  key: '@diamondcoreprocessor.com/DefaultWebsiteRenderer',
  kind: 'website',
  priority: 0,
  mount: async (ctx) => {
    const shadow = ctx.host.attachShadow({ mode: 'open' })
    const viewport = document.createElement('div')
    viewport.style.cssText =
      'position:absolute;inset:0;overflow:auto;font:14px system-ui,sans-serif;background:#fafafa;color:#222;'
    shadow.appendChild(viewport)

    if (ctx.manifest.title) {
      try { document.title = ctx.manifest.title } catch { /* noop */ }
    }

    const render = async (frame: TileRenderFrame): Promise<void> => {
      const pageSig = pickPage(ctx.manifest, frame.pagePath)
      if (!pageSig) {
        viewport.innerHTML = defaultNotFound(frame.pagePath)
        return
      }
      const html = await readText(ctx.getResource, pageSig)
      if (!html) {
        viewport.innerHTML = defaultNotFound(frame.pagePath)
        return
      }
      viewport.innerHTML = rewriteAssetUrls(html, ctx.manifest)
      // Scroll back to top on page change (common web expectation).
      viewport.scrollTo({ top: 0 })
    }

    const onAnchorClick = (e: Event): void => {
      const a = e.composedPath().find((n): n is HTMLAnchorElement =>
        n instanceof HTMLAnchorElement)
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href || /^(https?:|mailto:|tel:|data:|\/\/)/i.test(href)) return
      if (href.startsWith(RESOURCE_URL_PREFIX)) return
      e.preventDefault()
      // Resolve relative to current lineage path — the site-view drone
      // does the common-prefix math.
      const sitePrefix = ctx.frame.fullPath.slice(0, ctx.frame.fullPath.length - ctx.frame.pagePath.length)
      if (href === '..' || href === '../') {
        const currentPage = ctx.frame.pagePath
        if (currentPage.length === 0) return
        ctx.navigate([...sitePrefix, ...currentPage.slice(0, -1)])
        return
      }
      if (href.startsWith('/')) {
        // Absolute within the site
        const parts = href.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
        ctx.navigate([...sitePrefix, ...parts])
        return
      }
      const parts = href.replace(/^[./]+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
      ctx.navigate([...sitePrefix, ...ctx.frame.pagePath, ...parts])
    }
    viewport.addEventListener('click', onAnchorClick, true)

    await render(ctx.frame)

    return {
      update: (frame) => { void render(frame) },
      unmount: () => {
        viewport.removeEventListener('click', onAnchorClick, true)
        shadow.replaceChildren()
      },
    }
  },
}

function pickPage(manifest: WebsiteManifest, pagePath: readonly string[]): string | null {
  const key = pagePath.join('/')
  return manifest.pages?.[key] ?? manifest.entry ?? manifest.pages?.[''] ?? null
}

async function readText(
  getResource: (sig: string) => Promise<Blob | null>,
  sig: string
): Promise<string | null> {
  try {
    const blob = await getResource(sig)
    return blob ? await blob.text() : null
  } catch { return null }
}

/**
 * Rewrite these reference forms to `/@resource/<sig>`:
 *   - `resource:<64-hex>`
 *   - `asset:<name>`  → manifest.assets[name]
 *   - bare 64-hex on src/href attributes
 */
function rewriteAssetUrls(text: string, manifest: WebsiteManifest): string {
  let out = text.replace(/resource:([0-9a-f]{64})/g, `${RESOURCE_URL_PREFIX}$1`)
  out = out.replace(/((?:src|href|data-src)=)(["'])([0-9a-f]{64})\2/g,
    (_m, attr, q, sig) => `${attr}${q}${RESOURCE_URL_PREFIX}${sig}${q}`)
  if (manifest.assets) {
    out = out.replace(/asset:([^"'\s<>()]+)/g, (_m, name) => {
      const sig = manifest.assets?.[name]
      return sig ? `${RESOURCE_URL_PREFIX}${sig}` : _m
    })
  }
  return out
}

/** Per-cell version: same `resource:<sig>` and bare-sig src/href
 *  rewrites, but no manifest-keyed `asset:<name>` lookup since per-
 *  cell pages don't carry a manifest. Authors using named assets
 *  reference them by sig directly or via cross-cell links. */
function rewriteCellPageRefs(text: string): string {
  let out = text.replace(/resource:([0-9a-f]{64})/g, `${RESOURCE_URL_PREFIX}$1`)
  out = out.replace(/((?:src|href|data-src)=)(["'])([0-9a-f]{64})\2/g,
    (_m, attr, q, sig) => `${attr}${q}${RESOURCE_URL_PREFIX}${sig}${q}`)
  return out
}

function defaultNotFound(path: readonly string[]): string {
  return `<main style="padding:2rem;max-width:720px;margin:0 auto;font:14px system-ui,sans-serif">
    <h1>Page not found</h1>
    <p>No entry for <code>/${path.join('/')}</code> in this site's manifest.</p>
  </main>`
}

const _siteView = new SiteViewDrone()
window.ioc.register('@diamondcoreprocessor.com/SiteViewDrone', _siteView)
