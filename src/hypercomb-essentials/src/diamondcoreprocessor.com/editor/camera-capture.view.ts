// camera-capture.view.ts — the in-hive camera, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/camera-capture: same surface name
// (hc-camera-capture), same order band (225 — above the tile editor's 220,
// because the editor is what this opens INTO), the same single effect in
// (`camera:capture-open`) and the same effects out (`toast:show` on failure,
// and the owner-counted `view:active` mode while the viewfinder covers the
// screen). The participant sees the same full-screen viewfinder, delivered
// as a module instead of compiled into the shell.
//
// WHAT IT IS FOR. The mobile bar's centre button is the shutter: take a
// picture, get a tile. The frame it captures goes straight into the image
// router that already backs pasting an image
// (`@diamondcoreprocessor.com/ImagePasteWorker#createTileFromImage`) — a new
// cell is created at the current location and the tile editor opens on it
// with the photo loaded, so framing and naming happen where they always have.
// It lands beside image-drop.drone.ts on purpose: those are the two ways an
// image reaches a tile from outside the editor.
//
// The in-editor camera (tile-editor) stays what it is: replace the image of a
// tile you are already editing. This one is the other direction — no tile yet.
//
// ── THE STREAM IS THE WHOLE DISCIPLINE ───────────────────────────────────
// getUserMedia opens a REAL DEVICE and lights a REAL LAMP on the front of the
// participant's machine. Rule 7 (tear down what you wire) has teeth here: a
// leaked MediaStream is worse than a leaked listener because it is VISIBLE.
// Every exit stops every track, and there are exactly five of them:
//
//   1. the × button            → #close()
//   2. the shutter             → #shoot() calls #close() BEFORE the editor
//                                opens, so no stream runs behind a modal
//   3. Escape                  → #onKeyDown → #close()
//   4. a failed #flip()        → #close()
//   5. disconnectedCallback    → #close() (the host moved or removed us)
//
// There is NO backdrop path: the Angular overlay had no click handler, so
// tapping the field does nothing here either. Inventing one would be a new
// exit that the original never had.
//
// Two gaps the Angular version left open, closed here because both end in a
// lamp that never goes out (called out in the report as deliberate):
//   • two `camera:capture-open` in flight both passed `if (active()) return`
//     — the second stream overwrote `#stream` and the first could never be
//     stopped. `#opening` closes that window.
//   • the surface torn down WHILE the permission prompt is up: close() found
//     `#stream === null`, then the promise resolved and handed a live stream
//     to a dead element. Both async paths re-check `isConnected` and stop the
//     stream they were handed rather than adopting it.
//
// ── LIFECYCLE ────────────────────────────────────────────────────────────
// The Angular template was wrapped in `@if (active())`, so the overlay only
// existed while the camera was open. A registry-fed element is mounted ONCE
// at boot and stays, so the overlay is built once, kept DETACHED, and
// attached only while active — `querySelector('.camera-overlay')` answers
// exactly when the template's `@if` used to, and the live <video> node
// (with its listeners) is moved, never rebuilt.
//
// THE REPLAY IS NOT A GESTURE. `EffectBus.on` replays the last value, and
// `camera:capture-open` is a COMMAND that opens a device. Angular subscribed
// once at boot, before anything had ever emitted, so the replay was always
// empty. An element re-subscribes whenever the shell-surfaces host MOVES it
// (a DOM move fires disconnected+connected), which after one camera session
// would replay the open and light the camera with nobody asking. The
// subscribe-time call is dropped — that is not catch-up logic, it is
// reproducing Angular's boot exactly while refusing to open a lens on a
// re-order.
//
// Its strings ship WITH it (camera-capture.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { CAMERA_CAPTURE_TRANSLATIONS } from './camera-capture.i18n.js'

const SURFACE_NAME = 'hc-camera-capture'

/** The mode-registry owner token. Renamed with the surface (nothing keys off
 *  the old `@hypercomb.shared/CameraCaptureComponent` string — the back-gesture
 *  registry looks owners up in its own map and the camera never registered an
 *  entry there), and it is the SAME string on both enter and exit, which is
 *  the only thing owner-counting actually requires. */
const OWNER = '@diamondcoreprocessor.com/CameraCaptureElement'

/** Longest edge of the stored frame. A phone sensor hands back 3–4k pixels of
 *  square crop; the tile never renders anywhere near that, and the bytes are
 *  content-addressed forever. Cap on the way in, not on the way out. */
const MAX_PHOTO_PX = 1024

type ImageRouter = { createTileFromImage?: (blob: Blob) => Promise<void> }
type ModeRegistry = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

// Same contract as the shell pipe: the live provider resolves the key, and the
// fallback is the English catalog text so a bare host with no i18n reads
// identically. None of this surface's five keys take params.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The viewfinder's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(CAMERA_CAPTURE_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — nothing can leak out of the viewfinder. SCSS nesting is flattened
// by hand; `var(--hc-*)` is left alone. There are no @keyframes to namespace.
//
// Kept verbatim from the SCSS, with the reasoning:
//   - Z-INDEX 100003: one above the tile editor (100002), because the editor
//     is what the shutter OPENS — the viewfinder must sit over it until the
//     frame is handed across, and `#close()` runs before the hand-off anyway.
//   - The hex mask is the frame you are shooting for: what lands inside is
//     what the tile shows. Everything outside is DIMMED, not cropped — the
//     capture is the centre square, so the corners still carry.
//   - `.mat-sym` is a GLOBAL class (shared/styles/_material-tokens.scss)
//     carrying the icon font; only the size override was component-scoped,
//     and only the size override is repeated here.
// The mask properties were already written with their -webkit- twins in the
// source, so nothing depends on Angular's autoprefixer here.
const HEX_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='white'/%3E%3Cpolygon points='200,0 373,100 373,300 200,400 27,300 27,100' fill='black'/%3E%3C/svg%3E")`

const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .camera-overlay{position:fixed;inset:0;z-index:100003;background:#000;display:flex;align-items:center;justify-content:center}
${SURFACE_NAME} .camera-overlay video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
${SURFACE_NAME} .camera-overlay video.mirrored{transform:scaleX(-1)}
${SURFACE_NAME} .camera-hex-frame{position:absolute;inset:0;pointer-events:none;z-index:1;background:rgba(0,0,0,.6);-webkit-mask-image:${HEX_MASK};mask-image:${HEX_MASK};-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center}
${SURFACE_NAME} .camera-controls{position:absolute;bottom:0;left:0;right:0;z-index:2;display:flex;justify-content:space-around;align-items:center;padding:1.5rem;padding-bottom:calc(1.5rem + var(--hc-safe-bottom, 0px))}
${SURFACE_NAME} .camera-shutter{width:4.5rem;height:4.5rem;border-radius:50%;border:4px solid #fff;background:transparent;cursor:pointer;position:relative}
${SURFACE_NAME} .camera-shutter::after{content:'';position:absolute;inset:4px;border-radius:50%;background:#fff}
${SURFACE_NAME} .camera-shutter:active::after{background:#c8975a}
${SURFACE_NAME} .camera-shutter.busy{pointer-events:none}
${SURFACE_NAME} .camera-shutter.busy::after{background:rgba(255,255,255,.4)}
${SURFACE_NAME} .camera-control-btn{width:3rem;height:3rem;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}
${SURFACE_NAME} .camera-control-btn .mat-sym{font-size:1.4rem}
${SURFACE_NAME} .camera-hint{position:absolute;top:calc(1.25rem + var(--hc-safe-top, 0px));left:0;right:0;z-index:2;text-align:center;font-size:.8rem;letter-spacing:.04em;color:rgba(255,255,255,.72);pointer-events:none}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-camera-capture', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class CameraCaptureElement extends HTMLElement {

  #offs: Array<() => void> = []

  // ── state (the component's three signals, as plain fields) ─────────────
  #active = false
  #busy = false
  /** 'environment' (rear) first — the reason to point a phone at something is
   *  usually the thing in front of it, not your face. Survives close, exactly
   *  as the signal on the long-lived component instance did. */
  #facing: 'environment' | 'user' = 'environment'

  #stream: MediaStream | null = null
  /** True only while a getUserMedia call is in flight. `if (active()) return`
   *  alone does not cover the await, and two overlapping opens strand the
   *  first stream with no reference left to stop it. */
  #opening = false
  /** True only for the synchronous window inside `EffectBus.on` — see the
   *  replay note in the file header. */
  #subscribing = false

  // ── chrome, built once and kept ────────────────────────────────────────
  #overlay: HTMLDivElement | null = null
  #video: HTMLVideoElement | null = null
  #shutter: HTMLButtonElement | null = null
  #closeButton: HTMLButtonElement | null = null
  #flipButton: HTMLButtonElement | null = null
  #hint: HTMLDivElement | null = null

  connectedCallback(): void {
    installCss()
    this.#build()

    // The one effect in. The subscribe-time replay is dropped (header note):
    // a command that opens a lens must come from a gesture, never from a
    // re-subscribe.
    this.#subscribing = true
    const offOpen = EffectBus.on('camera:capture-open', () => {
      if (this.#subscribing) return
      void this.#open()
    })
    this.#subscribing = false

    this.#offs.push(
      offOpen,
      // THE PIPE WAS IMPURE. The Angular template resolved all five strings
      // through the `t` pipe, declared `pure: false`, so every change-detection
      // tick re-read them and `/language ja` re-labelled an OPEN viewfinder on
      // the spot — the dialog's aria-label, all three button labels and the
      // hint line. An element renders when it decides to, so the locale switch
      // has to be a reason to re-resolve, or an open camera freezes in the
      // previous language until it is closed and re-opened.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )

    // RAW listener, exactly as the component had it (`document.addEventListener`
    // in ngOnInit, removed in ngOnDestroy) — NOT `@HostListener('document:
    // keydown.escape')`. So there is deliberately no modifier guard here: this
    // spelling always fired on Ctrl/Alt/Shift/Meta-Escape too, and adding the
    // guard would itself be the regression. Same function reference on add and
    // remove, or the removal silently does nothing.
    document.addEventListener('keydown', this.#onKeyDown)

    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    document.removeEventListener('keydown', this.#onKeyDown)

    // A MOVE IS NOT A TEARDOWN. `insertBefore` on an attached node fires
    // disconnected then connected, and the shell surface host reorders its
    // survivors exactly that way whenever the registry re-syncs. The Angular
    // component was a view, not a node — a reorder never destroyed it — so
    // closing here unconditionally would shut a RUNNING camera because a
    // sibling surface happened to register. Defer one microtask and let the
    // re-attach cancel it; a genuine removal never comes back, so it still
    // closes on the very next tick.
    //
    // ngOnDestroy called close(), and it stays the exit path that matters most
    // because nobody is left to press anything. Node refs are dropped inside
    // the deferred branch, since close() clears the <video>'s srcObject.
    queueMicrotask(() => {
      if (this.isConnected) return
      this.#close()
      this.#dropNodes()
    })
  }

  /** The node references, released only on a real removal. */
  #dropNodes(): void {
    this.#overlay = null
    this.#video = null
    this.#shutter = null
    this.#closeButton = null
    this.#flipButton = null
    this.#hint = null
    this.replaceChildren()
    // #facing deliberately survives even this: the lens the participant last
    // chose is theirs, not the mount's, and the element is re-used if the
    // registry ever mounts the surface again.
  }

  // ── the device ─────────────────────────────────────────────────────────

  #modes(): ModeRegistry | undefined {
    return window.ioc?.get?.('@diamondcoreprocessor.com/ModeRegistry') as ModeRegistry | undefined
  }

  /** One lens request, on the CURRENT facing. `null` is the component's single
   *  catch: permission denied, no device, an insecure context where
   *  `navigator.mediaDevices` is undefined outright — the browser does not
   *  reliably distinguish them and neither did the original. What DIFFERS
   *  between the two callers is the response: opening raises the toast,
   *  flipping folds away (see each). The property access is inside the try on
   *  purpose, so the insecure-context TypeError lands here too. */
  async #request(): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.#facing } })
    } catch {
      return null
    }
  }

  /** Open the viewfinder. Permission denial and "no camera present" raise the
   *  SAME toast the component raised — one message naming both cases, because
   *  that is the only thing the participant was ever shown and the browser
   *  does not reliably tell them apart (a blocked device policy reports the
   *  same `NotAllowedError` a refused prompt does). Splitting it here would be
   *  inventing a distinction the original never made.
   *
   *  The strings are plain literals, not catalog keys — the Angular component
   *  hardcoded both toast messages in English and no locale file carries them.
   *  Minting keys here would ship a translation the shell never had. */
  #open = async (): Promise<void> => {
    if (this.#active || this.#opening) return
    this.#opening = true
    const stream = await this.#request()
    this.#opening = false

    if (!stream) {
      EffectBus.emit('toast:show', {
        type: 'error',
        title: 'camera',
        message: 'No camera available (or permission was denied).',
      })
      return
    }

    // Torn down while the permission prompt was up. Nobody will ever press
    // close on this one, so stop it here rather than adopt it.
    if (!this.isConnected) {
      stream.getTracks().forEach(track => track.stop())
      return
    }

    this.#stream = stream
    this.#active = true
    // Owner-counted mode, not a raw boolean broadcast: closing this viewfinder
    // must leave the chrome hidden if a website/slides view underneath is still
    // open (mode-registry.service.ts).
    this.#modes()?.enter('view:active', OWNER)
    this.#render()
    this.#bindStream()
  }

  /** Every exit funnels here. Stops every track on whatever stream we hold,
   *  clears the preview, and gives the mode back exactly once. */
  #close = (): void => {
    this.#stream?.getTracks().forEach(track => track.stop())
    this.#stream = null
    // Angular's `@if` destroyed the <video> along with the overlay, which took
    // the srcObject with it. Ours survives, so the reference has to be dropped
    // by hand — otherwise the element keeps a stopped stream alive and the
    // last frame stays frozen on screen for the next open.
    if (this.#video) this.#video.srcObject = null
    this.#busy = false
    // `if (!this.active()) return` — copied, not negated. A close on an already
    // closed viewfinder still stops any stray stream and clears busy, but must
    // not hand the mode back a second time.
    if (this.#active) {
      this.#active = false
      this.#modes()?.exit('view:active', OWNER)
    }
    this.#render()
  }

  /** Front ↔ rear. Tears the stream down and re-opens on the other lens. */
  #flip = async (): Promise<void> => {
    this.#facing = this.#facing === 'environment' ? 'user' : 'environment'
    // Repaint FIRST: the component's `[class.mirrored]` binding flipped on the
    // signal write, before the new stream existed, so the preview mirrors the
    // instant you press it.
    this.#render()

    this.#stream?.getTracks().forEach(track => track.stop())

    const stream = await this.#request()
    if (!stream) {
      // The original's failure path: NO toast, just fold away — the stream
      // that WAS working is already stopped by this point, so there is
      // nothing left to show and close() gives the mode back.
      this.#close()
      return
    }

    // Escape (or a teardown) landed while the second lens was opening. The
    // element is closed; adopting this stream would light the camera behind a
    // hidden surface.
    if (!this.isConnected || !this.#active) {
      stream.getTracks().forEach(track => track.stop())
      return
    }

    this.#stream = stream
    this.#bindStream()
  }

  /** Shutter. Centre-square crop (a tile is a hexagon — a square source is the
   *  frame that survives either orientation), capped, WebP, then handed to the
   *  router which creates the cell and opens the editor on it. */
  #shoot = async (): Promise<void> => {
    const video = this.#video
    if (!video || !video.videoWidth || this.#busy) return
    this.#busy = true
    this.#render()

    const source = Math.min(video.videoWidth, video.videoHeight)
    const sx = (video.videoWidth - source) / 2
    const sy = (video.videoHeight - source) / 2
    const size = Math.min(source, MAX_PHOTO_PX)

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) { this.#busy = false; this.#render(); return }
    ctx.drawImage(video, sx, sy, source, source, 0, 0, size, size)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/webp', 0.9),
    )

    // Stop the camera BEFORE the editor opens — the viewfinder has done its
    // job, and a live stream left running behind a modal is a battery leak.
    this.#close()
    if (!blob) return

    const router = window.ioc?.get?.('@diamondcoreprocessor.com/ImagePasteWorker') as ImageRouter | undefined
    if (!router?.createTileFromImage) {
      EffectBus.emit('toast:show', {
        type: 'error',
        title: 'camera',
        message: 'The image router is not loaded — the photo could not be placed.',
      })
      return
    }
    await router.createTileFromImage(blob)
  }

  #bindStream(): void {
    // The component needed `setTimeout(…, 0)` because `@if` had not created the
    // <video> yet when the stream arrived. Here the node is built once and is
    // already attached by the time this runs (#render precedes it), so the
    // assignment is direct — and a deferred assignment would be a window in
    // which a close could land between stopping the tracks and binding them.
    const video = this.#video
    if (video) video.srcObject = this.#stream
  }

  // ── chrome (built once, detached) ──────────────────────────────────────
  #build(): void {
    if (this.#overlay) return

    const overlay = document.createElement('div')
    overlay.className = 'camera-overlay'
    overlay.setAttribute('role', 'dialog')
    // No click handler: the Angular overlay had none, so the field is not a
    // dismiss target and a stray tap while framing cannot kill the shot.

    const video = document.createElement('video')
    // The template's `autoplay playsinline muted`. Set as properties AND
    // attributes: a dynamically created <video> needs the muted PROPERTY for
    // autoplay to be allowed, and iOS reads the playsinline ATTRIBUTE.
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.setAttribute('autoplay', '')
    video.setAttribute('muted', '')
    video.setAttribute('playsinline', '')

    const frame = document.createElement('div')
    frame.className = 'camera-hex-frame'

    const controls = document.createElement('div')
    controls.className = 'camera-controls'

    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'camera-control-btn'
    closeButton.addEventListener('click', () => { this.#close() })
    const closeIcon = document.createElement('span')
    closeIcon.className = 'mat-sym'
    closeIcon.textContent = 'close'
    closeButton.appendChild(closeIcon)

    const shutter = document.createElement('button')
    shutter.type = 'button'
    shutter.className = 'camera-shutter'
    shutter.addEventListener('click', () => { void this.#shoot() })

    const flipButton = document.createElement('button')
    flipButton.type = 'button'
    flipButton.className = 'camera-control-btn'
    flipButton.addEventListener('click', () => { void this.#flip() })
    const flipIcon = document.createElement('span')
    flipIcon.className = 'mat-sym'
    flipIcon.textContent = 'cameraswitch'
    flipButton.appendChild(flipIcon)

    controls.append(closeButton, shutter, flipButton)

    // Says what the shutter DOES, because "take a photo" and "make a tile" are
    // the same act here and nothing else on screen would tell you.
    const hint = document.createElement('div')
    hint.className = 'camera-hint'

    // Template order: video, hex frame, controls, hint.
    overlay.append(video, frame, controls, hint)

    this.#overlay = overlay
    this.#video = video
    this.#shutter = shutter
    this.#closeButton = closeButton
    this.#flipButton = flipButton
    this.#hint = hint
    // Built DETACHED — `#render` attaches it only while the camera is open, so
    // there is no transient full-screen black flash on the way through mount.
  }

  // ── labels (re-resolved on every render and on locale:changed) ──────────
  #relabel(): void {
    if (!this.#overlay) return
    this.#overlay.setAttribute('aria-label', t('camera.title', 'camera'))
    this.#closeButton?.setAttribute('aria-label', t('camera.close', 'close the camera'))
    this.#shutter?.setAttribute('aria-label', t('camera.shutter', 'take the picture'))
    this.#flipButton?.setAttribute('aria-label', t('camera.flip', 'switch camera'))
    if (this.#hint) this.#hint.textContent = t('camera.hint', 'take a picture — it becomes a tile here')
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ────
  #render(): void {
    const overlay = this.#overlay
    const video = this.#video
    const shutter = this.#shutter
    if (!overlay || !video || !shutter) return

    // `@if (active())` — a truthiness test on a boolean, so `!this.#active` is
    // its exact complement (unlike a `> 0` predicate, where negation lets NaN
    // fall through). Closed means GONE, not `display:none`: the template
    // removed the whole overlay, and `querySelector('.camera-overlay')` is the
    // DOM contract a driver would assert on. Detaching rather than rebuilding
    // keeps the <video>, the three buttons and their listeners alive.
    if (!this.#active) {
      overlay.remove()
      return
    }

    // `[class.mirrored]="facing() === 'user'"` — the front lens reads as a
    // mirror to the person holding it; the CAPTURE is not flipped, only this
    // preview (the canvas draws from the raw frame).
    video.classList.toggle('mirrored', this.#facing === 'user')
    // `[class.busy]="busy()"` — one frame at a time; the press is already
    // being turned into a tile.
    shutter.classList.toggle('busy', this.#busy)

    this.#relabel()

    // Back in, if it was out. Moving a live node, never re-creating it.
    if (overlay.parentNode !== this) this.appendChild(overlay)
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#active) return
    // No `stopPropagation` — the component did not stop it either, so Escape
    // still reaches whatever else owns the escape cascade behind us.
    if (e.key === 'Escape') { e.preventDefault(); this.#close() }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md). 225 is above the tile
// editor's 220 — the viewfinder is what the editor opens FROM.
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, CameraCaptureElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/CameraCaptureElement',
    element: SURFACE_NAME,
    order: 225,
  })
})
