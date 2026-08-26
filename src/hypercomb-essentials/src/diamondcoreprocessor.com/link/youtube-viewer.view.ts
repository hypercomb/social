// youtube-viewer.view.ts — the full-screen video takeover, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/youtube-viewer: same surface name
// (hc-youtube-viewer), same order band (350), same single effect in
// (`viewer:open` with kind 'youtube'), same body classes (`viewer-open` /
// `viewer-active`), same two exits. The participant sees the same video,
// delivered as a module instead of compiled into the shell. It lands in
// `link/` beside link-open.worker.ts — the drone that emits the payload that
// opens it — and beside youtube.ts, which knows what a YouTube link is.
//
// WHAT IT IS FOR. Tapping a tile that holds a YouTube link plays the video
// IN the hive rather than throwing the participant out to a browser tab. The
// takeover is total (the Pixi canvas is suppressed under `body.viewer-open`,
// the header and controls bar fade out), which is exactly why the way back
// must be unmissable: the exit FAB is ALWAYS present while the viewer is
// open — it dims with the chrome but never disappears, so a hive full of
// black can't read as a hive that broke. Backdrop click and Escape close too.
// Moving the pointer reveals the chrome again; it auto-hides after 3s.
//
// THE ESCAPE HATCH. An embed can refuse to play for reasons the hive can
// neither see nor fix (the owner disallowed embedding, tracking prevention
// starved the player of storage), and the refusal renders INSIDE a
// cross-origin iframe — unreadable from here by construction. So the second
// FAB is armed at open time, BEFORE the player has had any chance to refuse:
// one tap hands the video to the OS browser and drops the dead overlay.
//
// THE ANGULAR WRAPPER THAT DISAPPEARS. The original bound the embed URL into
// `[src]`, and a BINDING into an iframe src is what forces
// DomSanitizer.bypassSecurityTrustResourceUrl / SafeResourceUrl. Here the URL
// is assigned to the element property directly, so the sanitizer and its type
// are simply gone — the URL itself is built exactly as before, same params,
// same origin term, same referrerpolicy attribute.
//
// LIFECYCLE NOTE. The Angular version wrapped its markup in `@if (embedUrl())`,
// so nothing existed while no video was playing. A registry-fed element is
// mounted ONCE at boot and stays, so the overlay is built DETACHED and only
// attached while a video is up — `display:none` would still answer
// querySelector, and an overlay at z-index 10000 that merely claims to be
// hidden is the worst possible failure mode for this particular surface.
//
// Its strings ship WITH it (youtube-viewer.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus,
  I18N_IOC_KEY,
  ensureViewportInsetVars,
  openExternalLink,
  parseYouTubeVideoId,
  type I18nProvider,
} from '@hypercomb/core'
import { YOUTUBE_VIEWER_TRANSLATIONS } from './youtube-viewer.i18n.js'

const SURFACE_NAME = 'hc-youtube-viewer'

/** The `viewer:open` contract. `label` is carried by emitters and unused here
 *  — the video names itself once it plays. */
type ViewerOpenPayload = { kind: string; url: string; label?: string }

/** How long the chrome stays up after the last pointer movement. */
const CHROME_HIDE_DELAY = 3000

// Same contract as the shell pipe. Neither of this surface's two keys takes
// parameters (they are whole labels: "Close video", "Watch on YouTube"), so
// there is no interpolation to do — the fallback is the English catalog text,
// and a bare host with no i18n reads identically.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  if (value && value !== key) return value
  return fallback
}

// The viewer's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(YOUTUBE_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the DOCUMENT-level chrome fade (not this element's own styles) ────────
// Deliberately unprefixed: these rules address the shell's chrome, not the
// viewer's markup, and they are keyed off the body classes this element
// toggles. Kept byte-for-byte from the Angular original, id and all — the id
// guard is what keeps the transition safe if the shared component is still
// loaded in the same document.
//
// NOTE: hiding the Pixi canvas under `.viewer-open` is NOT done here. It is
// the shared `suppress-canvas-under('.viewer-open')` rule compiled into the
// shell styles.scss (visibility + canvas pointer-events). A hand-rolled
// `#pixi-host { visibility:hidden }` here was incomplete — it left the
// pointer-events:auto <canvas> eating clicks through the viewer. This style
// tag only fades the chrome; the `viewer-open` body class triggers the shared
// canvas-suppress rule.
// The undo/redo/save cluster shares the bottom-right corner with the video's
// close FAB, so it must not sit over the video at all — it's hidden for the
// WHOLE takeover (`viewer-open`), not just once the chrome auto-hides
// (`viewer-active`). The header + controls-bar still only fade on auto-hide.
const VIEWER_STYLE_ID = 'hc-viewer-chrome-style'
const ensureViewerStyle = (): void => {
  if (document.getElementById(VIEWER_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = VIEWER_STYLE_ID
  style.textContent = `
    .header-bar, hc-controls-bar { transition: opacity 0.5s ease; }
    body.viewer-active .header-bar,
    body.viewer-active hc-controls-bar { opacity: 0; pointer-events: none; }
    body.viewer-open hc-edit-actions { display: none; }
  `
  document.head.appendChild(style)
}

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing can leak out of the viewer. `display:contents` is kept from the
// original: every child here is position:fixed, so the host is a pure
// bookkeeping node and must never introduce a box of its own.
//
// The two FABs are the reason `.chrome-hidden` exists as a class rather than a
// straight `display` flip: they fade to 0.45 and shed their labels, but stay
// hittable — including their explicit `cursor:pointer`, which exempts them
// from the backdrop's `cursor:none`. A dimmed exit is still an exit; a missing
// one is a trap.
//
// `--hc-inset-right` slides the exit left of any right-docked toolwindow (0
// when no panel is open) and the `env(safe-area-inset-bottom)` term keeps it
// off the home indicator on notched phones. Both are load-bearing for the one
// guaranteed way out. No @keyframes here, so nothing needs namespacing.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .viewer-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;justify-content:center;align-items:center;z-index:10000;background:rgba(0,0,0,.92);cursor:pointer}
${SURFACE_NAME} .viewer-backdrop.chrome-hidden{cursor:none}
${SURFACE_NAME} .video-container{position:relative;width:90vw;max-width:1600px;aspect-ratio:16 / 9;cursor:default}
${SURFACE_NAME} .chrome-hidden .video-container{cursor:none}
${SURFACE_NAME} .video-container iframe{width:100%;height:100%;border:none;border-radius:4px;box-shadow:0 0 60px rgba(0,0,0,.6)}
${SURFACE_NAME} .exit-fab{position:fixed;right:calc(1.4rem + var(--hc-inset-right,0px));bottom:calc(1.4rem + env(safe-area-inset-bottom,0px));z-index:10001;display:flex;align-items:center;gap:.6rem;min-height:3rem;border:none;border-radius:var(--hc-radius-pill);padding:0 .75rem 0 1.1rem;background:rgba(126,182,214,.92);color:#0c1118;box-shadow:0 8px 26px rgba(0,0,0,.5);cursor:pointer;transition:filter .16s ease,opacity .5s ease,gap .5s ease,padding .5s ease}
${SURFACE_NAME} .exit-fab:hover{filter:brightness(1.12);opacity:1}
${SURFACE_NAME} .chrome-hidden .exit-fab{opacity:.45;gap:0;padding:0 .75rem;cursor:pointer}
${SURFACE_NAME} .watch-fab{position:fixed;left:calc(1.4rem + var(--hc-inset-left,0px));bottom:calc(1.4rem + env(safe-area-inset-bottom,0px));z-index:10001;display:flex;align-items:center;gap:.6rem;min-height:3rem;border:1px solid rgba(255,255,255,.22);border-radius:var(--hc-radius-pill);padding:0 1.1rem 0 .75rem;background:rgba(18,24,32,.82);color:#dfe8f0;box-shadow:0 8px 26px rgba(0,0,0,.5);cursor:pointer;transition:filter .16s ease,opacity .5s ease,gap .5s ease,padding .5s ease}
${SURFACE_NAME} .watch-fab:hover{filter:brightness(1.25);opacity:1}
${SURFACE_NAME} .chrome-hidden .watch-fab{opacity:.45;gap:0;padding:0 .75rem;cursor:pointer}
${SURFACE_NAME} .watch-glyph{font-family:'Material Symbols Outlined';font-size:1.35rem;line-height:1}
${SURFACE_NAME} .watch-label,${SURFACE_NAME} .exit-label{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:.95rem;font-weight:600;line-height:1;white-space:nowrap;max-width:12rem;overflow:hidden;transition:opacity .5s ease,max-width .5s ease}
${SURFACE_NAME} .chrome-hidden .watch-label,${SURFACE_NAME} .chrome-hidden .exit-label{opacity:0;max-width:0}
${SURFACE_NAME} .exit-glyph{font-family:'Material Symbols Outlined';font-size:1.5rem;line-height:1}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-youtube-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class YoutubeViewerElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  /** The overlay chrome, built ONCE and kept — the backdrop carries the click
   *  and pointermove listeners and the two FABs carry the two exits, so
   *  re-creating them per video would rewire four listeners for nothing.
   *  Built DETACHED; `#showViewer` attaches it, `#close` takes it back out. */
  #backdrop: HTMLDivElement | null = null
  #container: HTMLDivElement | null = null
  #watchButton: HTMLButtonElement | null = null
  #watchLabel: HTMLSpanElement | null = null
  #exitButton: HTMLButtonElement | null = null
  #exitLabel: HTMLSpanElement | null = null

  /** The playing video, or null when nothing is up. The Angular original held
   *  this as two signals (embedUrl + watchUrl); they were only ever set and
   *  cleared together, so one nullable record says the same thing. `embedUrl`
   *  non-null IS "the viewer is open" — the `@if` condition, preserved. */
  #video: { embedUrl: string; watchUrl: string } | null = null

  /** Chrome up (true) or auto-hidden (false). Drives `.chrome-hidden` on the
   *  backdrop and `body.viewer-active` together, exactly as the signal did. */
  #chromeVisible = true

  #chromeTimer: ReturnType<typeof setTimeout> | null = null

  connectedCallback(): void {
    ensureViewerStyle()
    installCss()
    // The exit FAB offsets by --hc-inset-right so a docked panel can't cover
    // the one guaranteed way out; make sure the var is being published even if
    // this viewer is the first chrome to need it. Idempotent.
    ensureViewportInsetVars()
    this.#build()

    // Last-value replay means a late mount still receives the current viewer
    // request — there is no catch-up to write here. (The Angular component
    // subscribed from its constructor and got the same replay.)
    this.#offs.push(
      EffectBus.on<ViewerOpenPayload>('viewer:open', (payload) => this.#onViewerOpen(payload)),
      // THE PIPE WAS IMPURE. The original resolved both labels through the `t`
      // pipe, declared `pure: false`, so every change-detection tick re-read
      // them and `/language ja` re-labelled an OPEN viewer on the spot. An
      // element renders when it decides to, so the locale switch has to be a
      // reason to re-resolve — otherwise the video keeps playing over two
      // stale buttons, and those buttons are the ONLY two exits.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )

    // Escape closes. The Angular original used
    // `@HostListener('document:keydown.escape')` — DOCUMENT, BUBBLE phase, no
    // preventDefault — so this is the same listener, spelled out. Bubble (not
    // capture) is deliberate: the Escape cascade's other owners get their say
    // first, which is why this one is guarded on the viewer actually being up.
    document.addEventListener('keydown', this.#onKeyDown)
    this.#offs.push(() => document.removeEventListener('keydown', this.#onKeyDown))
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    // A surface that leaves must not leave a video playing behind it, nor the
    // body classes that keep the hive's chrome suppressed. `ngOnDestroy` did
    // exactly this (`#exitViewerMode`); `#close` is that plus the teardown of
    // the overlay the `@if` used to own.
    this.#close()
    this.#backdrop = null
    this.#container = null
    this.#watchButton = null
    this.#watchLabel = null
    this.#exitButton = null
    this.#exitLabel = null
    this.replaceChildren()
  }

  // ── chrome (built once, detached) ────────────────────────────────────
  #build(): void {
    if (this.#backdrop) return

    const backdrop = document.createElement('div')
    backdrop.className = 'viewer-backdrop'
    backdrop.addEventListener('click', () => this.#onBackdropClick())
    // Pointer movement reveals the chrome (the natural "where am I" gesture)
    // and keeps it up while the pointer is active. Only fires over our own
    // elements — the iframe swallows pointer events over the video itself.
    backdrop.addEventListener('pointermove', () => this.#onPointerMove())

    const container = document.createElement('div')
    container.className = 'video-container'
    // The template's `(click)="$event.stopPropagation()"` — clicking the video
    // must not reach the backdrop's close.
    container.addEventListener('click', event => event.stopPropagation())

    // The escape hatch, mirrored opposite the exit so the two guaranteed
    // actions bracket the video rather than crowd one corner.
    const watchButton = document.createElement('button')
    watchButton.type = 'button'
    watchButton.className = 'watch-fab'
    watchButton.addEventListener('click', event => {
      event.stopPropagation()
      this.#watchOnYouTube()
    })
    const watchGlyph = document.createElement('span')
    watchGlyph.className = 'watch-glyph'
    watchGlyph.textContent = 'open_in_new'
    const watchLabel = document.createElement('span')
    watchLabel.className = 'watch-label'
    watchButton.append(watchGlyph, watchLabel)

    // The guaranteed way out — same identity as the website-mode exit FAB
    // (site-view.drone.ts EXIT_OVERLAY_CSS): steel-blue pill, bottom-right,
    // Material glyph. Label first, glyph second — the mirror of the watch FAB.
    const exitButton = document.createElement('button')
    exitButton.type = 'button'
    exitButton.className = 'exit-fab'
    exitButton.addEventListener('click', event => {
      event.stopPropagation()
      this.#close()
    })
    const exitLabel = document.createElement('span')
    exitLabel.className = 'exit-label'
    const exitGlyph = document.createElement('span')
    exitGlyph.className = 'exit-glyph'
    exitGlyph.textContent = 'close'
    exitButton.append(exitLabel, exitGlyph)

    backdrop.append(container, watchButton, exitButton)

    this.#backdrop = backdrop
    this.#container = container
    this.#watchButton = watchButton
    this.#watchLabel = watchLabel
    this.#exitButton = exitButton
    this.#exitLabel = exitLabel
  }

  // ── the one effect in ────────────────────────────────────────────────
  #onViewerOpen(payload: ViewerOpenPayload | undefined): void {
    // POLARITY KEPT. The original returned on `payload.kind !== 'youtube'` and
    // again on a video id it could not parse — an unparseable link opens
    // NOTHING and leaves any video already up alone. Both guards read exactly
    // as they did; only the optional chain is new, so a foreign emitter's
    // empty payload returns instead of throwing inside the handler.
    if (payload?.kind !== 'youtube') return

    const videoId = parseYouTubeVideoId(payload.url)
    if (!videoId) return

    // `origin` is YouTube's documented requirement for an iframe embed: the
    // player validates the embedding page before configuring itself, and
    // without it some shells and privacy modes answer with "error 153 —
    // video player configuration error" instead of a video. It must be the
    // EMBEDDING page's origin, whatever that is (https://hypercomb.social on
    // the web, http://tauri.localhost inside the native client).
    //
    // No DomSanitizer: the URL goes onto the element property directly, which
    // is not a template binding, so there is nothing for Angular's sanitizer
    // to have bypassed. Same string, same params, same order.
    this.#video = {
      embedUrl:
        `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` +
        `&origin=${encodeURIComponent(location.origin)}`,
      // The canonical watch URL for the escape hatch, armed alongside the
      // embed and BEFORE the player has had any chance to refuse — we can
      // never detect the refusal, so the way out cannot be conditional on it.
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    }
    this.#showViewer()
    this.#enterViewerMode()
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──
  /** Attach the overlay and give it a FRESH iframe. The frame is the one thing
   *  deliberately re-created per video: Angular's `@if` destroyed the whole
   *  subtree on close, and that is what stops the audio — a kept frame would
   *  either keep playing or reload its src the moment it was re-attached. */
  #showViewer(): void {
    const video = this.#video
    const backdrop = this.#backdrop
    const container = this.#container
    if (!video || !backdrop || !container) return

    const frame = document.createElement('iframe')
    // `referrerpolicy` is LOAD-BEARING, not hygiene. The player validates the
    // embedding page from the HTTP `Referer` header, and the host serves
    // `Referrer-Policy: same-origin` — which sends NO referrer at all
    // cross-origin, so YouTube answers "error 153 — video player configuration
    // error" instead of a video. An element-level policy overrides the
    // document's, so this frame gets the origin back without loosening
    // referrers anywhere else (the portal overlay keeps its deliberate
    // `no-referrer`). The `origin` query term on the src is a different
    // mechanism — postMessage addressing — and does not satisfy this check.
    // Same attribute, same reason, as the slides player's embed frame.
    // (scripts/drive-youtube-embed-referrer.cjs is the acceptance driver.)
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    frame.setAttribute('frameborder', '0')
    frame.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
    )
    frame.setAttribute('allowfullscreen', '')
    frame.src = video.embedUrl
    container.replaceChildren(frame)

    this.#relabel()
    this.#applyChrome()
    // Back in, if it was out. Moving a live node, never re-creating it.
    if (backdrop.parentNode !== this) this.replaceChildren(backdrop)
  }

  /** Re-resolve both labels from the catalog. Called on open and on every
   *  `locale:changed` — the impure-pipe rule. Title and aria-label carry the
   *  same key the visible text does, exactly as the template bound them. */
  #relabel(): void {
    const watch = t('viewer.watchOnYouTube', 'Watch on YouTube')
    this.#watchButton?.setAttribute('title', watch)
    this.#watchButton?.setAttribute('aria-label', watch)
    if (this.#watchLabel) this.#watchLabel.textContent = watch

    const close = t('viewer.close', 'Close video')
    this.#exitButton?.setAttribute('title', close)
    this.#exitButton?.setAttribute('aria-label', close)
    if (this.#exitLabel) this.#exitLabel.textContent = close
  }

  /** The template's `[class.chrome-hidden]="!chromeVisible()"`. */
  #applyChrome(): void {
    this.#backdrop?.classList.toggle('chrome-hidden', !this.#chromeVisible)
  }

  // ── the exits — every one of them lands in the same #close ────────────
  /** The way out when the player refused. One tap hands the video to the OS
   *  browser (a new tab on the web) and drops the dead overlay, so a refused
   *  embed is never a dead end. No watch URL means no video is up, and the
   *  original returned WITHOUT closing — kept. */
  #watchOnYouTube(): void {
    const url = this.#video?.watchUrl
    if (!url) return
    openExternalLink(url)
    this.#close()
  }

  /** Backdrop click is a two-stage control, as it always was: while the chrome
   *  is hidden the click only brings it back (so a stray tap in the dark can't
   *  end the video); with the chrome up, it closes. */
  #onBackdropClick(): void {
    if (!this.#chromeVisible) {
      this.#showChrome()
      return
    }
    this.#close()
  }

  #onPointerMove(): void {
    if (!this.#chromeVisible) {
      this.#showChrome()
      return
    }
    this.#scheduleHideChrome()
  }

  /** Document keydown, bubble phase — the `@HostListener('document:keydown.escape')`
   *  the original carried. Guarded on a video actually being up, so Escape
   *  with no viewer open is somebody else's key. */
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    // UNMODIFIED ONLY. `keydown.escape` in Angular is not "the Escape key" —
    // KeyEventsPlugin composes a full code from the held modifiers, so a
    // Ctrl-Escape press produced `control.escape` and never matched this
    // binding. A bare `event.key === 'Escape'` closes on chords the original
    // ignored, which is how a port silently steals a shortcut from whoever
    // owns Ctrl/Alt/Shift/Meta-Escape.
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
    if (this.#video) this.#close()
  }

  /** The single exit. Every path — exit FAB, watch FAB, backdrop, Escape,
   *  disconnect — comes through here exactly once and leaves the same state:
   *  no video, no overlay in the DOM, no body classes, no pending timer. */
  #close(): void {
    this.#video = null
    // Drop the frame FIRST: taking the iframe out of the document destroys its
    // browsing context, which is what actually stops the audio.
    this.#container?.replaceChildren()
    this.#backdrop?.remove()
    this.#exitViewerMode()
  }

  // ── the takeover ─────────────────────────────────────────────────────
  #enterViewerMode(): void {
    document.body.classList.add('viewer-open')
    this.#chromeVisible = true
    this.#applyChrome()
    this.#scheduleHideChrome()
    // NOTE, kept from the original: entering does NOT clear `viewer-active`.
    // Every close does (`#exitViewerMode`), so the only way to reach here with
    // it still set is a second `viewer:open` arriving while the first video is
    // playing with its chrome auto-hidden — the header would stay faded until
    // the next pointer move. Faithful to the Angular version; changing it here
    // would be a silent behaviour divergence in a port.
  }

  #exitViewerMode(): void {
    this.#clearChromeTimer()
    this.#chromeVisible = true
    this.#applyChrome()
    document.body.classList.remove('viewer-active')
    document.body.classList.remove('viewer-open')
  }

  #showChrome(): void {
    this.#chromeVisible = true
    this.#applyChrome()
    document.body.classList.remove('viewer-active')
    this.#scheduleHideChrome()
  }

  #scheduleHideChrome(): void {
    this.#clearChromeTimer()
    this.#chromeTimer = setTimeout(() => {
      // The video may have ended its life between the schedule and the fire.
      // Same guard the original had on `embedUrl()`.
      if (!this.#video) return
      this.#chromeVisible = false
      this.#applyChrome()
      document.body.classList.add('viewer-active')
    }, CHROME_HIDE_DELAY)
  }

  #clearChromeTimer(): void {
    if (this.#chromeTimer) {
      clearTimeout(this.#chromeTimer)
      this.#chromeTimer = null
    }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts this tag
// directly in its own template) still needs the tag to be a real element
// rather than an inert unknown one — so the define cannot wait on the
// registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, YoutubeViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/YoutubeViewerElement',
    element: SURFACE_NAME,
    order: 350,
  })
})
