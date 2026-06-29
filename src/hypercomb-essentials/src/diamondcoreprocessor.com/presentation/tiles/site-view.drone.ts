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
import { featureNeedsReview } from '../../sharing/feature-availability.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'

type MountState = {
  host: HTMLDivElement
  /** sig of the cell page currently mounted. */
  pageSig: string
  /** lineage segments of the cell whose page is mounted. */
  sitePath: readonly string[]
  /** unmount handler — drops style/link/script nodes and listeners. */
  unmount: () => void
}

/** Inline style for the raw-DOM exit overlay. A near-max z-index keeps it
 *  above any embedded-page content; the Material Symbols family renders the
 *  glyph set as the button's textContent. No external stylesheet, so a site's
 *  CSS can't reach it. */
const EXIT_OVERLAY_CSS = [
  'position:fixed', 'right:1.4rem', 'bottom:1.4rem', 'z-index:2147483600',
  // a round button — the website-mode "back to hexagon view" toggle reads
  // cleaner as a circle than the hive hexagon when laid over a live page
  'width:3rem', 'height:3rem', 'display:flex', 'align-items:center', 'justify-content:center',
  'border-radius:50%',
  'background:rgba(126,182,214,.92)',
  'box-shadow:0 8px 26px rgba(0,0,0,.5)', 'color:#0c1118', 'cursor:pointer',
  "font-family:'Material Symbols Outlined'", 'font-size:1.5rem', 'line-height:1', 'padding:0',
  'pointer-events:auto', 'transition:filter .16s ease',
].join(';')

/** Raw-DOM review-gate card. Same out-of-Angular, near-max-z-index discipline
 *  as the exit overlay: shown over a FOREIGN, unverified page INSTEAD of
 *  mounting it, so nothing of the page renders, runs, or fetches until the
 *  participant reviews and enables it. Cold steel chrome, no external CSS. */
const REVIEW_GATE_CSS = [
  'position:fixed', 'inset:0', 'z-index:2147483600',
  'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:1rem',
  'background:#0c1118', 'color:#cfe2ee', 'padding:2rem', 'text-align:center',
  "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
].join(';')

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

  /**
   * Raw-DOM exit overlay — the GUARANTEED way out of website mode. It is
   * created outside Angular by the renderer itself (the one piece of code that
   * is provably running whenever a site is on screen), appended straight to
   * <body> at a near-max z-index, and shown for the entire duration of website
   * mode — even on a page-less dead-end. No component, no signal binding, no
   * load-order failure mode: if a site can show, this button is there. Clicking
   * it resolves ViewMode fresh and drops back to the hive.
   */
  #exitOverlay: HTMLButtonElement | null = null
  #exitTogglesBound = false
  /** Raw-DOM review gate — shown over a FOREIGN, unverified page in place of
   *  mounting it. While present, the page is NOT in the document: no scripts
   *  run, no resources stream. Cleared once the feature is verified (or on
   *  exit / a switch to a local page). */
  #reviewOverlay: HTMLDivElement | null = null
  #featureVerifiedBound = false
  /** The current site's toggle identity, mirrored from ViewBee's
   *  `view-toggles:changed` so the exit wears the site's own glyph + label;
   *  falls back to a generic "back to tiles" glyph on a cell with no page. */
  #siteIcon = ''
  #siteLabel = ''

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
    if (!this.#featureVerifiedBound) {
      // A review→accept (or bypass) in the features panel flips a foreign
      // website from quarantined to verified; re-reconcile so it mounts now.
      this.onEffect('feature:verified', () => { void this.#reconcile() })
      // Hide / restore in the features panel turns this page off / back on.
      this.onEffect('feature:hidden', () => { void this.#reconcile() })
      this.onEffect('feature:restored', () => { void this.#reconcile() })
      this.#featureVerifiedBound = true
    }
    if (!this.#exitTogglesBound) {
      // Mirror the site's own icon/label onto the exit overlay from the same
      // ViewBee broadcast the command-line toggle uses (late-replay seeds it).
      this.onEffect<{ toggles?: Array<{ view: string; icon: string; label: string }> }>('view-toggles:changed', (p) => {
        const list = p?.toggles
        const w = Array.isArray(list) ? list.find(t => t?.view === 'website') : undefined
        this.#siteIcon = (w?.icon ?? '').trim()
        this.#siteLabel = (w?.label ?? '').trim()
        this.#refreshExitOverlay()
      })
      this.#exitTogglesBound = true
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
    this.#removeExitOverlay()
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
      this.#removeExitOverlay()
      this.#removeReviewGate()
      this.#teardown()
      return
    }
    // In website mode the raw-DOM exit overlay is ALWAYS present — even on a
    // page-less cell — so there is always a guaranteed way back to the hive.
    if (vm?.mode === 'website') this.#ensureExitOverlay()

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
      // Verification gate. A FOREIGN page — adopted into the hive, or published
      // by a domain that isn't yours — must NOT activate (mount, run its
      // scripts, stream its resources) until it is VERIFIED: reviewed-and-
      // accepted, bypassed, or from a trusted/community domain. Your own
      // authoring is never gated. Showing the review gate INSTEAD of mounting
      // is what keeps an un-adopted feature's heavy payload off the wire.
      // Hidden gate (takes precedence — it's the retainable "off"). If the
      // participant has HIDDEN this cell's website feature, it stays inert:
      // no mount, no scripts, no fetch. Restoring it from the features panel
      // re-reconciles and brings it back. The feature's identity is the website
      // bee's decoration kind — the same kind the panel writes the hide for.
      const websiteKind = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ get: (view: string) => { decorationKind?: string } | undefined }>('@diamondcoreprocessor.com/VisualBeeRegistry')
        ?.get('website')?.decorationKind
      if (websiteKind && await isFeatureHidden(segments, websiteKind)) {
        this.#removeReviewGate()
        this.#teardown()
        return
      }

      const publisher = this.#pagePublisherDomain(cellPageSig)
      if (featureNeedsReview(segments, cellPageSig, publisher)) {
        this.#teardown()
        this.#showReviewGate(segments, cellPageSig)
        return
      }
      this.#removeReviewGate()
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

    // Snapshot the live <html>/<body> inline background BEFORE the page's
    // scripts run. A site theme-stamps by writing a background straight onto
    // <html>/<body> — an inline mutation that removing its <style> nodes can't
    // undo — so without this the stamped background bleeds into the hive when
    // you leave website mode. Restored on unmount → exiting a site returns to
    // the hive's own theme background (dark by default). Only background props
    // are touched; other inline styles / CSS vars on those elements are left
    // alone (e.g. --hc-header-bottom the chrome sets on <html>).
    const htmlStyle = document.documentElement.style
    const bodyStyle = document.body.style
    const prevBg = {
      hBg: htmlStyle.background, hColor: htmlStyle.backgroundColor, hImg: htmlStyle.backgroundImage,
      bBg: bodyStyle.background, bColor: bodyStyle.backgroundColor, bImg: bodyStyle.backgroundImage,
    }

    // Snapshot the hive's own theme attribute too. A site carries its own
    // light/dark choice and stamps it straight onto <html data-theme> — the
    // SAME attribute the hive's --md-* tokens key off — via a pre-paint script
    // (`document.documentElement.setAttribute('data-theme', …)`) plus an in-page
    // toggle. Removing the page's <style> nodes can't undo an attribute write,
    // so without this the site's theme (e.g. light) leaks into the hive chrome
    // when you switch back to hexagon mode. Captured before the page scripts run
    // and restored on unmount. null = the hive default (system / unset), so it
    // restores by REMOVING the attribute rather than writing an empty string.
    const prevTheme = document.documentElement.getAttribute('data-theme')

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
    // hash, and resource: URLs pass through. Resolution is
    // hierarchy-aware (see #resolveAndNavigate): an href is read against the
    // site's OWN position in the tree, not blindly from the hive root.
    const onAnchorClick = (e: Event): void => {
      const target = e.target as Element | null
      const a = target?.closest?.('a')
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href || /^(https?:|mailto:|tel:|data:|\/\/|#)/i.test(href)) return
      if (href.startsWith(RESOURCE_URL_PREFIX)) return
      e.preventDefault()
      void this.#resolveAndNavigate(href, segments)
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
        // Revert any background a page script stamped onto <html>/<body> so the
        // hive's own theme background (or dark default) shows again on exit.
        htmlStyle.background = prevBg.hBg
        htmlStyle.backgroundColor = prevBg.hColor
        htmlStyle.backgroundImage = prevBg.hImg
        bodyStyle.background = prevBg.bBg
        bodyStyle.backgroundColor = prevBg.bColor
        bodyStyle.backgroundImage = prevBg.bImg
        // Restore the hive's own theme — a site stamps its light/dark choice
        // onto <html data-theme>, which otherwise persists into hexagon mode and
        // shows the site's light styles where the hive should be dark.
        if (prevTheme === null) document.documentElement.removeAttribute('data-theme')
        else document.documentElement.setAttribute('data-theme', prevTheme)
      },
    }
  }

  // ── raw-DOM exit overlay ───────────────────────────────────────────────

  /** Ensure the exit button exists in <body> and reflects the current site's
   *  glyph/label. Idempotent — safe to call on every reconcile. */
  #ensureExitOverlay(): void {
    if (!this.#exitOverlay) {
      const btn = document.createElement('button')
      btn.id = 'hc-site-exit'
      btn.type = 'button'
      btn.style.cssText = EXIT_OVERLAY_CSS
      btn.addEventListener('click', () => {
        const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
          ?.get<{ setMode(m: string): void }>('@hypercomb.social/ViewMode')
        vm?.setMode('hexagons')
      })
      // Hover affordance without a stylesheet — cheap inline listeners.
      btn.addEventListener('pointerenter', () => { btn.style.filter = 'brightness(1.12)' })
      btn.addEventListener('pointerleave', () => { btn.style.filter = 'none' })
      document.body.appendChild(btn)
      this.#exitOverlay = btn
    }
    this.#refreshExitOverlay()
  }

  #refreshExitOverlay(): void {
    const btn = this.#exitOverlay
    if (!btn) return
    btn.textContent = this.#siteIcon || 'grid_view'
    const label = this.#siteLabel || 'Back to tiles'
    btn.title = label
    btn.setAttribute('aria-label', label)
  }

  #removeExitOverlay(): void {
    if (this.#exitOverlay) {
      this.#exitOverlay.remove()
      this.#exitOverlay = null
    }
  }

  // ── feature-verification gate ──────────────────────────────────────────

  /** The publisher domain attributed to a page sig (learned from the mesh /
   *  adopt hand-off via the broker's address graph). Empty when unknown —
   *  which, for adopted content, the gate treats as "not trusted" (fail-closed:
   *  unknown-origin foreign code stays inert until reviewed). */
  #pagePublisherDomain(sig: string): string {
    try {
      const broker = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ getKnownDomains?: (s: string) => string[] }>('@diamondcoreprocessor.com/ContentBrokerDrone')
      return broker?.getKnownDomains?.(sig)?.[0] ?? ''
    } catch { return '' }
  }

  /** Show the review gate over a foreign, unverified page INSTEAD of mounting
   *  it. The page never enters the document, so its scripts don't run and its
   *  resources don't stream. The "Review & enable" action hands the page sig to
   *  the features panel (`feature:review:open`), where the participant reviews
   *  the code and accepts — which writes the verified sig and re-reconciles. */
  #showReviewGate(segments: readonly string[], sig: string): void {
    this.#ensureExitOverlay()   // keep the guaranteed way back to the hive
    let card = this.#reviewOverlay
    if (!card) {
      card = document.createElement('div')
      card.id = 'hc-feature-review'
      card.style.cssText = REVIEW_GATE_CSS
      const title = document.createElement('div')
      title.style.cssText = 'font-size:1.25rem;font-weight:600;color:#eaf3f9'
      title.textContent = 'Feature not enabled'
      const body = document.createElement('div')
      body.style.cssText = 'max-width:34rem;line-height:1.5;opacity:.85'
      body.textContent = 'This page comes from another participant and has not been reviewed. Review its code, then enable it — nothing runs until you do.'
      const review = document.createElement('button')
      review.type = 'button'
      review.className = 'hc-review-btn'
      review.textContent = 'Review & enable'
      review.style.cssText = 'margin-top:.5rem;padding:.6rem 1.2rem;border:1px solid rgba(126,182,214,.6);border-radius:.4rem;background:rgba(126,182,214,.16);color:#eaf3f9;cursor:pointer;font-size:.95rem'
      card.append(title, body, review)
      document.body.appendChild(card)
      this.#reviewOverlay = card
    }
    const btn = card.querySelector('.hc-review-btn') as HTMLButtonElement | null
    if (btn) btn.onclick = () => this.emitEffect('feature:review:open', {
      cell: segments[segments.length - 1] ?? '',
      segments: [...segments],
      sig,
      kind: 'website',
      label: this.#siteLabel || 'Website',
    })
  }

  #removeReviewGate(): void {
    if (this.#reviewOverlay) {
      this.#reviewOverlay.remove()
      this.#reviewOverlay = null
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

  /**
   * Does the cell at `segments` have a mountable page in any slot? The
   * positive counterpart to {@link #isDefinitelyPageless}, used to pick the
   * right reading of an ambiguous link. Cold / unresolved layers report false
   * (we can't confirm a page), so a momentarily-cold candidate is simply not
   * preferred over a warm one — never a false positive.
   */
  async #hasPage(segments: readonly string[]): Promise<boolean> {
    const store = this.resolve<any>('store')
    if (!store?.getResource) return false
    let sig = await this.#findWebsitePage(segments)
    if (!sig) sig = await this.#findDecorationPage(segments, store)
    if (!sig) sig = await this.#findContextPage(segments, store)
    return !!sig
  }

  /**
   * Resolve an internal href against the site's OWN place in the hive, then
   * navigate. This is the fix for links that ignore their position in the
   * hierarchy: the gen skill is *supposed* to emit full absolute paths
   * (`/dolphin/about`), but pages routinely carry site-relative links
   * (`/about`, `/`) or bare child names — and a path read blindly from the
   * hive root lands on a cell that doesn't exist and renders a blank "new
   * place." We build a few hierarchy-aware candidates and take the FIRST that
   * actually has a page; the literal reading stays the head candidate so
   * well-formed full-path links never regress, and the fallback at the end
   * keeps a click from being silently swallowed.
   *
   *   `..`        → up one level, never above the site-entry floor.
   *   `/a/b`      → [a,b] from the hive root (documented wire form), else
   *                 [...siteRoot, a, b] (site-relative: `/about` → the site's
   *                 own about page; `/` → the site home, not the hive root).
   *   `a/b` `./x` → [...here, a, b] (child), else [...parent, a, b] (sibling),
   *                 else [...siteRoot, a, b] (site-relative).
   */
  async #resolveAndNavigate(href: string, segments: readonly string[]): Promise<void> {
    const entry = this.#siteEntrySegments ?? []

    if (href === '..' || href === '../') {
      // Same site-entry floor as right-click — `..` at or below the site root
      // is a no-op (we don't eject back to hexagons, only block nav past root).
      if (segments.length <= entry.length) return
      await this.#navigate(segments.slice(0, -1))
      return
    }

    let candidates: string[][]
    if (href.startsWith('/')) {
      const parts = href.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
      candidates = [
        parts,                  // absolute from the hive root (documented form)
        [...entry, ...parts],   // site-relative: under the site's own root
      ]
    } else {
      const parts = href.replace(/^\.\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
      candidates = [
        [...segments, ...parts],               // child (documented relative form)
        [...segments.slice(0, -1), ...parts],  // sibling
        [...entry, ...parts],                  // site-relative
      ]
    }

    // De-dupe (entry === [] collapses site-relative onto absolute, etc.), then
    // take the first candidate that DEFINITELY has a page.
    const seen = new Set<string>()
    const uniq = candidates.filter(c => {
      const k = c.join(' ')
      if (seen.has(k)) return false
      seen.add(k); return true
    })
    for (const c of uniq) {
      if (await this.#hasPage(c)) { await this.#navigate(c); return }
    }
    // Nothing resolves to a page — navigate the literal reading. #navigate's
    // own dead-end guard still keeps us off a confirmed page-less cell.
    if (uniq[0]) await this.#navigate(uniq[0])
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
