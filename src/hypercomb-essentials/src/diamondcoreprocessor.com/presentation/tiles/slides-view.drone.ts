// diamondcoreprocessor.com/presentation/tiles/slides-view.drone.ts
//
// Full-viewport SLIDES takeover — the presentation sibling of SiteViewDrone /
// HomeViewDrone / TutorViewDrone. When ViewMode is 'slides', the current cell
// (the DECK) renders as a PowerPoint-style, screen-by-screen slideshow of its
// child DIAGRAM tiles instead of the hex grid. One slide fills the viewport;
// arrow keys / on-screen chevrons step through; a counter and dot strip track
// position; Escape / right-click / the exit button return to hexagons.
//
// Slides are the deck cell's CHILDREN, so adding a diagram child tile "just
// plugs in" on the next collect (cell:added / decorations:changed). Each child
// becomes a slide via, in resolution order:
//   1. a `visual:diagram:slide` decoration  → payload { contentSig, format,
//      title?, caption?, order? }  (canonical, richest)
//   2. a `visual:lightbox:gallery` decoration → payload.images[]  (each image a
//      slide; the existing gallery tiles)
//   3. the child's own `link` slot pointing at an image resource
//      (`/@resource/<sig>` or a bare 64-hex sig) — the existing `/diagrams`
//      tiles, so they present with zero migration.
//
// Rendering: each slide is addressed by its content SIGNATURE and painted as a
// `background-image` (background-size:contain) on a definite-size <div> — NOT an
// <img>, because an SVG with only a viewBox and no width/height (common for
// exported/mermaid diagrams) has no intrinsic size and collapses an <img> to
// 0×0. The bytes are fetched via `Store.getResource(sig)` and shown as an OBJECT
// URL — NOT the `/@resource/<sig>` route — because the service worker serves that
// route as `application/octet-stream` (it infers MIME from the URL tail, and a
// bare sig has none), which won't render as an image; the store blob carries its
// own correct MIME. Object URLs are cached by sig and revoked on teardown.
// (Inline-SVG theming is a future enhancement.)
//
// Mirrors HomeViewDrone's lifecycle (lineage + ViewMode listeners, re-entrancy
// guard, fixed host below the Pixi layer, `view:active` canvas/chrome hiding —
// zero shell edits) and PhotoView's image fit (object-fit:contain, max vw/vh).

import { Drone, RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { childSigsOf } from '../../history/layer-placement.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import { DECK_KIND, SLIDE_KIND } from '../../commands/present.queen.js'

const SLIDES_VIEW = 'slides'
const SIG = /^[0-9a-f]{64}$/
const GALLERY_KIND = 'visual:lightbox:gallery'

/** Steel accent shared with the site-view exit chrome — cold/clean, no glow. */
const STEEL = 'rgba(126,182,214,0.92)'
const DIM = 'rgba(207,226,238,0.55)'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}
type StoreShape = { getResource(sig: string): Promise<Blob | null> }

type Slide = { sig: string; title: string; caption?: string }

type MountState = {
  host: HTMLDivElement
  /** Identity of the mounted DECK — the current location. Slides within it may
   *  change freely (children added/removed) without a remount. */
  deckKey: string
  slides: Slide[]
  stage: HTMLDivElement
  titleEl: HTMLElement
  captionEl: HTMLElement
  counterEl: HTMLElement
  dots: HTMLElement
  empty: HTMLElement
}

export class SlidesViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport slides takeover. When ViewMode is "slides", plays the current cell\'s child diagram tiles as a screen-by-screen slideshow.'

  #mount: MountState | null = null
  #index = 0
  /** Guards async image resolution against a newer #show landing first. */
  #showToken = 0
  /** Cache of resolved slide bytes: content sig → object URL. Revoked on teardown. */
  #objectUrls = new Map<string, string>()
  #viewActive = false
  #registered = false
  #lineageBound = false
  #viewModeBound = false
  #contextMenuBound = false
  #keyBound = false
  #effectsBound = false
  /** Guards re-entrant async reconciles; a queued flag coalesces bursts. */
  #reconciling = false
  #queued = false

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens: string[] = []
  protected override emits = ['view:active']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/SlidesViewDrone', this)
      this.#registered = true
    }
    if (!this.#lineageBound) {
      const lineage = this.resolve<EventTarget & { addEventListener?: typeof EventTarget.prototype.addEventListener }>('lineage')
      if (lineage?.addEventListener) {
        lineage.addEventListener('change', this.#onChange)
        this.#lineageBound = true
      }
    }
    if (!this.#viewModeBound) {
      const vm = this.#vm()
      if (vm?.addEventListener) {
        vm.addEventListener('change', this.#onChange)
        this.#viewModeBound = true
      }
    }
    if (!this.#contextMenuBound) {
      // Right-click anywhere in slides mode = exit back to hexagons (tutor/home
      // precedent). Capture phase; inert in every other mode.
      window.addEventListener('contextmenu', this.#onContextMenu, true)
      this.#contextMenuBound = true
    }
    if (!this.#keyBound) {
      // Arrow / space / escape navigation. Capture + stopImmediatePropagation so
      // the global escape cascade and hex key handlers never see it while up.
      window.addEventListener('keydown', this.#onKeyDown, true)
      this.#keyBound = true
    }
    if (!this.#effectsBound) {
      // Keep the deck fresh when children / decorations change under it — a new
      // diagram tile plugs in on the next collect.
      this.onEffect('decorations:changed', () => { void this.#reconcile() })
      this.onEffect('cell:added', () => { void this.#reconcile() })
      this.onEffect('cell:removed', () => { void this.#reconcile() })
      // Hide / restore in the Beehaviors panel turns this behaviour off / back on.
      this.onEffect('feature:hidden', () => { void this.#reconcile() })
      this.onEffect('feature:restored', () => { void this.#reconcile() })
      this.#effectsBound = true
    }
    void this.#reconcile()
  }

  protected override dispose(): void {
    const lineage = this.resolve<EventTarget & { removeEventListener?: typeof EventTarget.prototype.removeEventListener }>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) lineage.removeEventListener('change', this.#onChange)
    const vm = this.#vm()
    if (this.#viewModeBound && vm?.removeEventListener) vm.removeEventListener('change', this.#onChange)
    if (this.#contextMenuBound) window.removeEventListener('contextmenu', this.#onContextMenu, true)
    if (this.#keyBound) window.removeEventListener('keydown', this.#onKeyDown, true)
    this.#teardown()
  }

  // ── reactivity ─────────────────────────────────────────────

  readonly #onChange = (): void => { void this.#reconcile() }

  readonly #onContextMenu = (e: MouseEvent): void => {
    const vm = this.#vm()
    if (!vm || vm.mode !== SLIDES_VIEW) return
    e.preventDefault()
    vm.setMode('hexagons')
  }

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    const vm = this.#vm()
    if (!vm || vm.mode !== SLIDES_VIEW) return
    switch (e.key) {
      case 'Escape':
        e.preventDefault(); e.stopImmediatePropagation(); vm.setMode('hexagons'); return
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Spacebar':
        e.preventDefault(); e.stopImmediatePropagation(); this.#step(1); return
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
        e.preventDefault(); e.stopImmediatePropagation(); this.#step(-1); return
      case 'Home':
        e.preventDefault(); e.stopImmediatePropagation(); this.#show(0); return
      case 'End':
        e.preventDefault(); e.stopImmediatePropagation(); this.#show(Number.MAX_SAFE_INTEGER); return
    }
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  #history(): HistoryShape | undefined {
    return window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
  }

  // ── reconcile / collect ────────────────────────────────────

  async #reconcile(): Promise<void> {
    if (this.#reconciling) { this.#queued = true; return }
    this.#reconciling = true
    try {
      const vm = this.#vm()
      if (!vm || vm.mode !== SLIDES_VIEW) { this.#teardown(); return }

      const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
      const store = this.resolve<StoreShape>('store')
      const history = this.#history()
      if (!lineage || !store?.getResource || !history) return

      const segments: string[] = [...(lineage.explorerSegments?.() ?? [])]
      // Honor the Beehaviors panel's off switch: a hidden deck stays inert (torn
      // down) until restored — the same hidden-pool gate SiteViewDrone uses.
      if (await isFeatureHidden(segments, DECK_KIND)) { this.#teardown(); return }
      const slides = await this.#collectSlides(segments, history, store)
      if (this.#vm()?.mode !== SLIDES_VIEW) { this.#teardown(); return } // flipped mid-read

      const deckKey = segments.join('/')
      if (this.#mount && this.#mount.deckKey === deckKey) {
        // Same deck — refresh the slide set in place, keep position where we can.
        this.#mount.slides = slides
        this.#show(this.#index)
        return
      }
      this.#mountDeck(deckKey, slides)
    } finally {
      this.#reconciling = false
      if (this.#queued) { this.#queued = false; void this.#reconcile() }
    }
  }

  /** Walk the deck cell's children and resolve each to zero-or-more slides.
   *  Children are read through the parent's child-sig slot (getLayerBySig), so a
   *  never-navigated child (empty own bag) still resolves. Ordered by each
   *  slide's `order` (else child order). */
  async #collectSlides(segments: readonly string[], history: HistoryShape, store: StoreShape): Promise<Slide[]> {
    const out: Array<Slide & { order: number }> = []
    try {
      const deckSig = await history.sign({ explorerSegments: () => segments })
      const deckLayer = await history.currentLayerAt(deckSig)
      if (!deckLayer) return []
      const childSigs = childSigsOf(deckLayer as Parameters<typeof childSigsOf>[0])
      let childIndex = 0
      for (const sig of childSigs) {
        const child = await history.getLayerBySig(String(sig))
        if (!child) { childIndex++; continue }
        const name = typeof child['name'] === 'string' ? (child['name'] as string) : ''
        const found = await this.#slidesFromChild(child, name, childIndex, store)
        out.push(...found)
        childIndex++
      }
    } catch { /* cold read — render the empty guide, retry on next reconcile */ }
    out.sort((a, b) => a.order - b.order)
    return out.map(({ sig, title, caption }) => ({ sig, title, caption }))
  }

  /** Resolve one child layer to its slide(s): slide-decoration → gallery → link. */
  async #slidesFromChild(
    child: Record<string, unknown>,
    name: string,
    childIndex: number,
    store: StoreShape,
  ): Promise<Array<Slide & { order: number }>> {
    const decorationSigs = Array.isArray(child['decorations'])
      ? (child['decorations'] as unknown[]).map(s => String(s)).filter(s => SIG.test(s))
      : []

    // 1 + 2: decoration-driven slides.
    let slidePayload: Record<string, unknown> | null = null
    let gallery: string[] | null = null
    for (const sig of decorationSigs) {
      const blob = await store.getResource(sig)
      if (!blob) continue
      try {
        const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: Record<string, unknown> }
        if (rec?.kind === SLIDE_KIND && rec.payload) { slidePayload = rec.payload; break }
        if (rec?.kind === GALLERY_KIND) {
          const imgs = rec.payload?.['images']
          if (Array.isArray(imgs)) gallery = imgs.map(s => String(s)).filter(s => SIG.test(s))
        }
      } catch { /* malformed record — skip */ }
    }

    if (slidePayload) {
      const contentSig = String(slidePayload['contentSig'] ?? '')
      if (SIG.test(contentSig)) {
        const orderRaw = slidePayload['order']
        const titleRaw = slidePayload['title']
        const captionRaw = slidePayload['caption']
        return [{
          sig: contentSig,
          title: (typeof titleRaw === 'string' && titleRaw.trim()) ? titleRaw : name,
          caption: typeof captionRaw === 'string' ? captionRaw : undefined,
          order: typeof orderRaw === 'number' ? orderRaw : childIndex,
        }]
      }
    }
    if (gallery && gallery.length) {
      return gallery.map((imgSig, i) => ({
        sig: imgSig,
        title: gallery!.length > 1 ? `${name} ${i + 1}` : name,
        order: childIndex + i / 1000,
      }))
    }

    // 3: the child's own `link` slot, only when it points at a resource (an
    // image diagram) — never an external hyperlink (that's navigation).
    const link = typeof child['link'] === 'string' ? (child['link'] as string).trim() : ''
    const sig = this.#resourceSig(link)
    if (sig) return [{ sig, title: name, order: childIndex }]

    return []
  }

  /** The 64-hex content sig a link value points at, when it is a resource link
   *  (a `/@resource/<sig>` URL or a bare sig). Null for external / non-resource
   *  links, which are not diagrams. */
  #resourceSig(link: string): string | null {
    if (!link) return null
    if (SIG.test(link)) return link
    if (link.startsWith(RESOURCE_URL_PREFIX)) {
      const tail = link.slice(RESOURCE_URL_PREFIX.length).split(/[?#]/)[0] ?? ''
      return SIG.test(tail) ? tail : null
    }
    return null
  }

  /** Resolve a content sig to a same-origin object URL carrying the blob's own
   *  MIME (so an SVG renders in <img>). Cached; revoked on teardown. */
  async #urlForSig(sig: string): Promise<string> {
    const cached = this.#objectUrls.get(sig)
    if (cached) return cached
    const store = this.resolve<StoreShape>('store')
    if (!store?.getResource) return ''
    try {
      const blob = await store.getResource(sig)
      if (!blob) return ''
      const url = URL.createObjectURL(blob)
      this.#objectUrls.set(sig, url)
      return url
    } catch { return '' }
  }

  // ── DOM ────────────────────────────────────────────────────

  #mountDeck(deckKey: string, slides: Slide[]): void {
    this.#teardown()

    const host = document.createElement('div')
    host.id = 'hc-slides-view-host'
    host.style.cssText =
      'position:fixed;inset:0;z-index:59988;overflow:hidden;background:#05040f;' +
      'display:flex;align-items:center;justify-content:center;font-family:inherit;'
    // Opt out of the always-on hex wheel-zoom handler so wheel isn't swallowed.
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    // Stage — a definite-size box painted with the slide as a BACKGROUND image
    // (background-size:contain), not an <img>. This renders reliably regardless
    // of the source's intrinsic dimensions: an SVG with only a viewBox and no
    // width/height (common for exported/mermaid diagrams) has no intrinsic size
    // and collapses an <img> to 0×0 even with an explicit CSS width, whereas a
    // background image simply fits the definite box. flex:0 0 auto stops the
    // flex host from shrinking it.
    const stage = document.createElement('div')
    stage.style.cssText =
      'width:92vw;height:86vh;flex:0 0 auto;' +
      'background-position:center;background-repeat:no-repeat;background-size:contain;'
    host.appendChild(stage)

    // Title (top) + caption (bottom).
    const titleEl = document.createElement('div')
    titleEl.style.cssText =
      'position:absolute;top:18px;left:0;right:0;text-align:center;color:#eaf3f9;' +
      'font-size:16px;font-weight:600;letter-spacing:.01em;pointer-events:none;padding:0 96px;'
    host.appendChild(titleEl)

    const captionEl = document.createElement('div')
    captionEl.style.cssText =
      `position:absolute;bottom:52px;left:0;right:0;text-align:center;color:${DIM};` +
      'font-size:13px;line-height:1.5;pointer-events:none;padding:0 96px;'
    host.appendChild(captionEl)

    // Prev / next chevrons.
    host.appendChild(this.#chevron('‹', 'left', () => this.#step(-1)))
    host.appendChild(this.#chevron('›', 'right', () => this.#step(1)))

    // Counter (top-right) + exit (bottom-right).
    const counterEl = document.createElement('div')
    counterEl.style.cssText =
      `position:absolute;top:18px;right:20px;color:${DIM};font-size:13px;` +
      'font-variant-numeric:tabular-nums;pointer-events:none;'
    host.appendChild(counterEl)

    host.appendChild(this.#exitButton())

    // Dot strip (bottom center).
    const dots = document.createElement('div')
    dots.style.cssText =
      'position:absolute;bottom:22px;left:0;right:0;display:flex;gap:8px;' +
      'justify-content:center;align-items:center;flex-wrap:wrap;padding:0 120px;'
    host.appendChild(dots)

    // Empty-state guide (shown when the deck has no diagram tiles yet).
    const empty = document.createElement('div')
    empty.style.cssText = `color:${DIM};font-size:15px;line-height:1.6;text-align:center;max-width:34rem;padding:2rem;`
    empty.textContent = 'No diagram tiles here yet. Add a child tile, then run /present slide on it to connect an SVG or image.'
    host.appendChild(empty)

    this.#mount = { host, deckKey, slides, stage, titleEl, captionEl, counterEl, dots, empty }
    this.#index = 0
    this.#setViewActive(true)
    this.#show(0)
  }

  #chevron(glyph: string, side: 'left' | 'right', onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = glyph
    btn.style.cssText =
      `position:absolute;${side}:12px;top:50%;transform:translateY(-50%);` +
      'width:3rem;height:3rem;display:flex;align-items:center;justify-content:center;' +
      'border:none;border-radius:50%;background:rgba(255,255,255,0.06);color:#eaf3f9;' +
      'font-size:1.8rem;line-height:1;cursor:pointer;transition:background .16s ease;'
    btn.addEventListener('click', onClick)
    btn.addEventListener('pointerenter', () => { btn.style.background = 'rgba(126,182,214,0.22)' })
    btn.addEventListener('pointerleave', () => { btn.style.background = 'rgba(255,255,255,0.06)' })
    return btn
  }

  #exitButton(): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'grid_view'
    btn.title = 'Back to the hive'
    btn.setAttribute('aria-label', 'Back to the hive')
    btn.style.cssText =
      'position:absolute;bottom:16px;right:20px;width:3rem;height:3rem;' +
      'display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;' +
      `background:${STEEL};color:#0c1118;cursor:pointer;` +
      "font-family:'Material Symbols Outlined';font-size:1.5rem;line-height:1;padding:0;" +
      'box-shadow:0 8px 26px rgba(0,0,0,.5);transition:filter .16s ease;'
    btn.addEventListener('click', () => this.#vm()?.setMode('hexagons'))
    btn.addEventListener('pointerenter', () => { btn.style.filter = 'brightness(1.12)' })
    btn.addEventListener('pointerleave', () => { btn.style.filter = 'none' })
    return btn
  }

  /** Move `delta` slides from the current index (clamped, no wrap). */
  #step(delta: number): void {
    this.#show(this.#index + delta)
  }

  /** Render slide `i` (clamped). Title / caption / counter / dots update
   *  synchronously; the image bytes resolve asynchronously (store → object URL)
   *  and are applied only if this remains the current slide. */
  #show(i: number): void {
    const m = this.#mount
    if (!m) return
    const n = m.slides.length

    // Empty deck — show the guide, hide the stage chrome.
    const hasSlides = n > 0
    m.empty.style.display = hasSlides ? 'none' : 'block'
    m.stage.style.display = hasSlides ? 'block' : 'none'
    m.dots.style.display = hasSlides ? 'flex' : 'none'
    if (!hasSlides) {
      m.titleEl.textContent = ''
      m.captionEl.textContent = ''
      m.counterEl.textContent = ''
      m.stage.style.backgroundImage = 'none'
      return
    }

    const index = Math.max(0, Math.min(i, n - 1))
    this.#index = index
    const slide = m.slides[index]

    m.titleEl.textContent = slide.title
    m.captionEl.textContent = slide.caption ?? ''
    m.counterEl.textContent = `${index + 1} / ${n}`
    this.#renderDots(m, n, index)

    const token = ++this.#showToken
    void this.#urlForSig(slide.sig).then(url => {
      if (token !== this.#showToken || this.#mount !== m) return // superseded / torn down
      m.stage.style.backgroundImage = url ? `url("${url}")` : 'none'
    })
  }

  /** Dot strip — one tappable dot per slide (hidden past a sane cap to avoid a
   *  wall of dots; the counter still tracks position). */
  #renderDots(m: MountState, n: number, index: number): void {
    if (n > 40) { m.dots.style.display = 'none'; return }
    m.dots.style.display = 'flex'
    if (m.dots.childElementCount !== n) {
      m.dots.replaceChildren()
      for (let i = 0; i < n; i++) {
        const dot = document.createElement('button')
        dot.type = 'button'
        dot.style.cssText =
          'width:9px;height:9px;padding:0;border:none;border-radius:50%;cursor:pointer;' +
          'background:rgba(255,255,255,0.22);transition:background .16s ease;'
        dot.addEventListener('click', () => this.#show(i))
        m.dots.appendChild(dot)
      }
    }
    const children = m.dots.children
    for (let i = 0; i < children.length; i++) {
      (children[i] as HTMLElement).style.background = i === index ? STEEL : 'rgba(255,255,255,0.22)'
    }
  }

  // ── teardown ───────────────────────────────────────────────

  #teardown(): void {
    if (this.#mount) {
      this.#mount.host.remove()
      this.#mount = null
    }
    for (const url of this.#objectUrls.values()) {
      try { URL.revokeObjectURL(url) } catch { /* noop */ }
    }
    this.#objectUrls.clear()
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    this.emitEffect<{ active: boolean }>('view:active', { active })
  }
}

const _slidesView = new SlidesViewDrone()
window.ioc.register('@diamondcoreprocessor.com/SlidesViewDrone', _slidesView)
