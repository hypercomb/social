// diamondcoreprocessor.com/presentation/tiles/slides-view.drone.ts
//
// Full-viewport SLIDES takeover — the presentation sibling of SiteViewDrone /
// HomeViewDrone / TutorViewDrone. When ViewMode is 'slides', the current cell
// (the DECK) renders as a PowerPoint-style, screen-by-screen deck of its
// children instead of the hex grid. One slide fills the viewport; arrow keys /
// on-screen chevrons step through; a counter and dot strip track position;
// Escape / right-click / the exit button return to hexagons.
//
// ── A UNIVERSAL viewer AND player ────────────────────────────────────
//
// A slide is not just a picture. Whatever a child tile points at becomes the
// slide, and ONE stage renders every kind:
//   • image  — painted as a background layer (diagrams, photos, SVG)
//   • video  — native <video> with controls
//   • audio  — native <audio> with controls
//   • embed  — a provider page in an iframe (YouTube via the nocookie host)
// So a deck can mix a diagram, a screen recording, a track, and a YouTube
// video, and you step through them all in one presentation.
//
// Slides are the deck cell's CHILDREN, so adding a child "just plugs in" on the
// next collect (cell:added / decorations:changed). Each child resolves via, in
// order: a `visual:diagram:slide` decoration (payload { contentSig, format,
// title?, caption?, order? }) → a `visual:lightbox:gallery` decoration
// (payload.images[]) → the child's own LINK.
//
// The link is a TILE PROPERTY (`properties[0].link` — where the attach flow
// writes it), NOT a top-level layer field, and it is read from the child's OWN
// lineage-bag head (the parent's children-slot sig can lag it). Reading
// `child.link` off the parent's ref layer was why attached diagrams never
// appeared. See #childLink / #collectSlides.
//
// KIND resolution: a content-addressed resource (bare sig, or a
// `/@resource/<sig>` URL in any form, relative or absolute) is fetched via
// `Store.getResource` and its BLOB'S OWN MIME decides image/video/audio — a
// signature has no extension, and the SW serves that route as
// `application/octet-stream`, so the bytes are the only honest signal. A plain
// URL is classified from the link itself (provider embed → image → media file).
// Object URLs are cached by sig and revoked on teardown.
//
// Images render as a `background-image` (background-size:contain) on a
// definite-size <div> — NOT an <img> — because an SVG with only a viewBox and
// no width/height (common for exported/mermaid diagrams) has no intrinsic size
// and collapses an <img> to 0×0 even with an explicit CSS width.
//
// Media never autoplays (browsers block unmuted autoplay, and a deck that
// starts blaring on navigation is hostile); stepping away pauses and unmounts
// the player so nothing keeps running off-screen.
//
// Mirrors HomeViewDrone's lifecycle (lineage + ViewMode listeners, re-entrancy
// guard, fixed host below the Pixi layer, `view:active` canvas/chrome hiding —
// zero shell edits) and PhotoView's image fit (object-fit:contain, max vw/vh).

import { Drone, RESOURCE_URL_PREFIX, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { childSigsOf } from '../../history/layer-placement.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import { DECK_KIND, SLIDE_KIND } from '../../commands/present.queen.js'
import { isImageUrl } from '../../link/photo.js'
import { embedUrlFor, mediaKindForUrl, kindForMime, type PlayableKind } from '../../link/media.js'

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

/** How a slide renders. `auto` = content-addressed bytes whose real kind is
 *  read from the blob's MIME at paint time (a signature carries no extension);
 *  every other kind is decided up-front from the link. */
type SlideKind = 'auto' | PlayableKind

// `src` is EITHER a 64-hex resource signature (content in OPFS → object URL +
// MIME) OR a full URL: an external image, a direct media file, or a provider
// EMBED url. ONE stage renders all of them — that's the universal player.
type Slide = { kind: SlideKind; src: string; title: string; caption?: string }

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
  /** Cache of resolved slide bytes: content sig → { object URL, blob MIME }.
   *  The MIME is what decides image vs video vs audio for a bare signature.
   *  URLs are revoked on teardown. */
  #resolved = new Map<string, { url: string; mime: string }>()
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
      case ' ': case 'Spacebar': {
        // On a MEDIA slide the spacebar belongs to the PLAYER (play/pause) —
        // that is what makes this a player and not just a viewer. On any other
        // slide it advances, the presentation convention. Arrows always
        // navigate, so a deck stays steppable either way.
        e.preventDefault(); e.stopImmediatePropagation()
        const media = this.#stageMedia()
        if (!media) { this.#step(1); return }
        if (media.paused) void media.play().catch(() => { /* refused — leave paused */ })
        else media.pause()
        return
      }
      case 'ArrowRight': case 'ArrowDown': case 'PageDown':
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
        const ref = await history.getLayerBySig(String(sig))
        if (!ref) { childIndex++; continue }
        const name = typeof ref['name'] === 'string' ? (ref['name'] as string) : ''
        // Re-resolve the child's CURRENT layer via its OWN lineage bag. The
        // parent's children-slot sig can lag the child's head, and tile
        // properties — where an attached link/diagram lives — sit on that head:
        // reading the parent's stale ref shows `{ name }` only and the slide is
        // missed. Fall back to the ref layer when the head can't be signed yet.
        let child: Record<string, unknown> = ref
        if (name) {
          try {
            const freshSig = await history.sign({ explorerSegments: () => [...segments, name] })
            const fresh = freshSig ? await history.currentLayerAt(freshSig) : null
            if (fresh) child = fresh
          } catch { /* keep the ref layer */ }
        }
        const found = await this.#slidesFromChild(child, name, childIndex, store)
        out.push(...found)
        childIndex++
      }
    } catch { /* cold read — render the empty guide, retry on next reconcile */ }
    out.sort((a, b) => a.order - b.order)
    return out.map(({ kind, src, title, caption }) => ({ kind, src, title, caption }))
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
          kind: 'auto' as const,
          src: contentSig,
          title: (typeof titleRaw === 'string' && titleRaw.trim()) ? titleRaw : name,
          caption: typeof captionRaw === 'string' ? captionRaw : undefined,
          order: typeof orderRaw === 'number' ? orderRaw : childIndex,
        }]
      }
    }
    if (gallery && gallery.length) {
      return gallery.map((imgSig, i) => ({
        kind: 'auto' as const,
        src: imgSig,
        title: gallery!.length > 1 ? `${name} ${i + 1}` : name,
        order: childIndex + i / 1000,
      }))
    }

    // 3: the child's own LINK — whatever the tile points at IS the slide. The
    // link is a TILE PROPERTY (`properties[0].link`, where the attach flow
    // writes it), with a legacy top-level `link` as fallback.
    const link = await this.#childLink(child, store)
    const slide = this.#slideFromLink(link, name, childIndex)
    return slide ? [slide] : []
  }

  /** Classify a link into a playable slide — the whole point of the universal
   *  player. Order matters: a content-addressed resource wins (its kind comes
   *  from the blob's MIME, so an attached mp4 plays and an svg paints); then a
   *  provider EMBED (YouTube → nocookie iframe); then a direct image; then a
   *  direct media file. Null for anything else — a plain hyperlink is
   *  navigation, not a slide, and contributes nothing. */
  #slideFromLink(link: string, title: string, order: number): (Slide & { order: number }) | null {
    if (!link) return null
    const sig = this.#resourceSig(link)
    if (sig) return { kind: 'auto', src: sig, title, order }
    const embed = embedUrlFor(link)
    if (embed) return { kind: 'embed', src: embed, title, order }
    if (isImageUrl(link)) return { kind: 'image', src: link, title, order }
    const media = mediaKindForUrl(link)
    if (media) return { kind: media, src: link, title, order }
    return null
  }

  /** The child tile's link. Attached links/diagrams live in the tile's
   *  canonical PROPERTIES resource (`properties[0]` → JSON → `link`), NOT a
   *  top-level layer field — that's why a plain `child.link` read missed every
   *  attached diagram. Falls back to a legacy top-level `link` for tiles that
   *  stored it inline. Empty when the tile has no link. */
  async #childLink(child: Record<string, unknown>, store: StoreShape): Promise<string> {
    const slot = child['properties']
    const propSig = Array.isArray(slot) && typeof slot[0] === 'string' ? slot[0] : ''
    if (SIG.test(propSig)) {
      try {
        const blob = await store.getResource(propSig)
        if (blob) {
          const props = JSON.parse(await blob.text()) as Record<string, unknown>
          const link = props['link']
          if (typeof link === 'string' && link.trim()) return link.trim()
        }
      } catch { /* unreadable/malformed props — fall back to a legacy inline link */ }
    }
    return typeof child['link'] === 'string' ? (child['link'] as string).trim() : ''
  }

  /** The 64-hex content sig a link value points at, when it is a resource link:
   *  a bare sig, or a `/@resource/<sig>` URL in ANY form — RELATIVE
   *  (`/@resource/<sig>`) or ABSOLUTE (`http://host/@resource/<sig>[/name.ext]`).
   *  Matches link/photo.ts's includes-based resolver; a startsWith check missed
   *  absolute links a tile can legitimately store. Null for non-resource links. */
  #resourceSig(link: string): string | null {
    if (!link) return null
    if (SIG.test(link)) return link
    const at = link.indexOf(RESOURCE_URL_PREFIX)
    if (at >= 0) {
      const tail = link.slice(at + RESOURCE_URL_PREFIX.length).split(/[/?#]/)[0] ?? ''
      return SIG.test(tail) ? tail : null
    }
    return null
  }

  /** Resolve a slide to the concrete { kind, url } the stage renders. An
   *  `auto` slide is content-addressed: fetch the bytes once and let the blob's
   *  own MIME decide image vs video vs audio. Every other kind was already
   *  settled from the link and its src is directly usable (an external image or
   *  media file needs no CORS to DISPLAY/PLAY, only to read pixels/samples). */
  async #resolveSlide(slide: Slide): Promise<{ kind: PlayableKind; url: string } | null> {
    if (slide.kind !== 'auto') return { kind: slide.kind, url: slide.src }
    const { url, mime } = await this.#resolveSig(slide.src)
    return url ? { kind: kindForMime(mime), url } : null
  }

  /** Resolve a content sig to a same-origin object URL plus the blob's own MIME
   *  — the only kind signal a bare signature carries. Cached; revoked on
   *  teardown. */
  async #resolveSig(sig: string): Promise<{ url: string; mime: string }> {
    const cached = this.#resolved.get(sig)
    if (cached) return cached
    const store = this.resolve<StoreShape>('store')
    if (!store?.getResource) return { url: '', mime: '' }
    try {
      const blob = await store.getResource(sig)
      if (!blob) return { url: '', mime: '' }
      const entry = { url: URL.createObjectURL(blob), mime: blob.type || '' }
      this.#resolved.set(sig, entry)
      return entry
    } catch { return { url: '', mime: '' } }
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

    // Stage — a definite-size box the slide's element mounts INTO. ONE stage,
    // many kinds: an image paints as a background layer (see #mediaElement for
    // why not an <img>), a video/audio mounts a native player, a provider mounts
    // an iframe. flex:0 0 auto stops the flex host from shrinking it; centering
    // keeps a smaller player (audio, a short video) in the middle.
    const stage = document.createElement('div')
    stage.style.cssText =
      'width:92vw;height:86vh;flex:0 0 auto;overflow:hidden;' +
      'display:flex;align-items:center;justify-content:center;'
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
    const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
    empty.textContent = i18n?.t('slides.empty') ?? 'No diagram tiles here yet. Add a child tile, then run /present slide on it to connect an SVG or image.'
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
    m.stage.style.display = hasSlides ? 'flex' : 'none'
    m.dots.style.display = hasSlides ? 'flex' : 'none'
    if (!hasSlides) {
      m.titleEl.textContent = ''
      m.captionEl.textContent = ''
      m.counterEl.textContent = ''
      this.#clearStage(m)
      return
    }

    const index = Math.max(0, Math.min(i, n - 1))
    this.#index = index
    const slide = m.slides[index]

    m.titleEl.textContent = slide.title
    m.captionEl.textContent = slide.caption ?? ''
    m.counterEl.textContent = `${index + 1} / ${n}`
    this.#renderDots(m, n, index)

    // Stop + drop whatever the PREVIOUS slide mounted before painting the next
    // one — a video must never keep playing off-screen behind a later slide.
    this.#clearStage(m)

    const token = ++this.#showToken
    void this.#resolveSlide(slide).then(res => {
      if (token !== this.#showToken || this.#mount !== m) return // superseded / torn down
      if (!res) return
      m.stage.appendChild(this.#mediaElement(res.kind, res.url))
    })
  }

  /** The native player mounted on the CURRENT slide, when it has one. Drives
   *  the spacebar's play/pause vs advance decision. */
  #stageMedia(): HTMLMediaElement | null {
    return (this.#mount?.stage.querySelector('video, audio') as HTMLMediaElement | null) ?? null
  }

  /** Empty the stage, stopping anything that was playing. Pausing + dropping
   *  the src before removal matters: a detached <video> that still holds a src
   *  can keep buffering, and an <iframe> only stops when it leaves the DOM. */
  #clearStage(m: MountState): void {
    const media = m.stage.querySelector('video, audio') as HTMLMediaElement | null
    if (media) {
      try { media.pause() } catch { /* already gone */ }
      media.removeAttribute('src')
      try { media.load() } catch { /* best-effort */ }
    }
    m.stage.replaceChildren()
  }

  /** Build the element for one resolved slide — the universal player's only
   *  branch point.
   *
   *  IMAGE is a background layer on a definite-size div, NOT an <img>: an SVG
   *  with only a viewBox and no width/height (common for exported/mermaid
   *  diagrams) has no intrinsic size and collapses an <img> to 0×0 even with an
   *  explicit CSS width, whereas a background image simply fits the box.
   *
   *  VIDEO/AUDIO get native controls and are NOT autoplayed — browsers block
   *  unmuted autoplay anyway, and a deck that starts blaring on navigation is
   *  hostile. Space toggles play/pause on these slides (see #onKeyDown).
   *
   *  EMBED is a provider iframe (YouTube via the nocookie host). It is
   *  sandboxed: the frame keeps its OWN origin so the player works, but it
   *  cannot navigate the app away or submit forms into it. */
  #mediaElement(kind: PlayableKind, url: string): HTMLElement {
    if (kind === 'embed') {
      const frame = document.createElement('iframe')
      frame.src = url
      frame.style.cssText = 'width:100%;height:100%;border:none;background:#000;'
      frame.allow = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
      frame.setAttribute('allowfullscreen', '')
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups')
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
      return frame
    }

    if (kind === 'video' || kind === 'audio') {
      const media = document.createElement(kind) as HTMLVideoElement | HTMLAudioElement
      media.src = url
      media.controls = true
      media.preload = 'metadata'
      media.style.cssText = kind === 'video'
        ? 'max-width:100%;max-height:100%;background:#000;outline:none;'
        : 'width:min(38rem,90%);outline:none;'
      return media
    }

    const layer = document.createElement('div')
    layer.style.cssText =
      'width:100%;height:100%;' +
      'background-position:center;background-repeat:no-repeat;background-size:contain;'
    layer.style.backgroundImage = `url("${url}")`
    return layer
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
      // Stop anything playing before the host leaves the DOM.
      this.#clearStage(this.#mount)
      this.#mount.host.remove()
      this.#mount = null
    }
    for (const { url } of this.#resolved.values()) {
      try { URL.revokeObjectURL(url) } catch { /* noop */ }
    }
    this.#resolved.clear()
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
