// hypercomb-shared/ui/markup-overlay/markup-overlay.component.ts
//
// MARK UP THE SCREEN — draw on what you are looking at, photograph it, and
// hand the picture to the agents as context.
//
// A question about a screen is nearly always a question about ONE PART of it,
// and describing which part in prose is the slowest, least reliable half of
// the sentence. This surface removes that half: a transparent sheet over the
// whole app that takes ink, a shot of the screen with the ink on it, and the
// picture stored as content and put on the chat's reference shelf — the same
// shelf a pasted screenshot lands on, so the responder reads it through the
// path that already exists (chat-window `#attachImages`, llm.queen
// `references`, `_ask.cjs get-resource --text base64`).
//
// ── The three decisions worth knowing ──────────────────────────────────
//
// 1. IT NEVER ENTERS `view:active`. That mode hides the stage and the chrome
//    — exactly the pixels being photographed. The overlay is a sheet ON TOP
//    of a live screen, not a view that replaces it, which is also why Escape
//    simply takes the sheet away and gives the hexagons back.
//
// 2. THE SCREEN IS CAPTURED, NOT RECONSTRUCTED. `getDisplayMedia` is the only
//    way a page may photograph itself faithfully — the Pixi canvas is driven
//    from a worker through an OffscreenCanvas and cannot be read back from the
//    DOM, and nothing in the browser rasterises live DOM chrome. The stream is
//    kept for as long as the sheet is open, so a second shot costs no second
//    permission, and it is stopped the moment the sheet closes.
//
// 3. THE INK RIDES IN THE FRAME. The strokes are drawn into a canvas that IS
//    part of the page, so the capture already contains them — no compositing,
//    no scale arithmetic, and what the agent sees is exactly what was on the
//    screen. Only the toolbar is hidden for the frame: it is the one thing on
//    screen that is about taking the picture rather than in it.
//
// Numbers rather than typed labels: the words belong in the question, and a
// pin dropped on the screen is what ties "the button at 1 is misaligned" to a
// place. Typing on a canvas would be a second, worse composer.
//
// Registry-fed surface (registerShellSurface), never an <hc-*> tag in app.html.

import { Component, ElementRef, signal, viewChild, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'

const OWNER = '@hypercomb.shared/MarkupOverlayComponent'

/** Longest edge of the stored shot. The vision models resize anything larger
 *  than ~1568px on the long edge before they look at it, so capturing beyond
 *  this spends bytes — and hive bytes are forever — to be downscaled anyway.
 *  Below it, small UI text stays legible, which is the whole point. */
const MAX_SHOT_PX = 1568

/** How long a fresh frame is waited for before the shot is called failed. A
 *  tab capture delivers one within a frame or two; a stream that has been
 *  revoked from the browser's own sharing bar delivers none at all. */
const FRAME_TIMEOUT_MS = 1_500

/** Ink width and the pin radius, in CSS pixels — one stroke weight, because a
 *  markup that needs a thickness control has stopped being a gesture. */
const INK_WIDTH = 3
const PIN_RADIUS = 13

/** The palette. Bright on purpose: this ink is drawn over a screenshot, not
 *  over a panel, and it has to survive both a dark hive and a bright one. The
 *  values live here rather than in the stylesheet because the canvas is
 *  painted from TypeScript and the swatches are painted FROM this list. */
const INKS = ['#ff4d4d', '#ffb020', '#3ddc84', '#48c6ff', '#ff6bd6', '#f5f7fa'] as const

/** Number pins carry dark digits — every ink above is light enough that a
 *  dark glyph is the readable one, at both ends of the palette. */
const PIN_TEXT = '#101418'

type Tool = 'pen' | 'arrow' | 'box' | 'pin'
type Point = { x: number; y: number }
type Shape =
  | { tool: 'pen'; ink: string; points: Point[] }
  | { tool: 'arrow'; ink: string; from: Point; to: Point }
  | { tool: 'box'; ink: string; from: Point; to: Point }
  | { tool: 'pin'; ink: string; at: Point; n: number }

/** The hive's content store, over IoC — a picture is content like any other
 *  and is addressed by the signature of its bytes. */
type StoreLike = { putResource?(blob: Blob): Promise<string> }

const SIG_RE = /^[0-9a-f]{64}$/

const ioc = (): { get<T>(key: string): T | undefined } | undefined =>
  (window as unknown as { ioc?: { get<T>(key: string): T | undefined } }).ioc

@Component({
  selector: 'hc-markup-overlay',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './markup-overlay.component.html',
  styleUrls: ['./markup-overlay.component.scss'],
})
export class MarkupOverlayComponent implements OnInit, OnDestroy {

  // The ref is `sheet`, not `ink`: a template reference variable SHADOWS a
  // component member of the same name, and `#ink` turned every `ink()` read
  // in this template into a call on the canvas element.
  readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('sheet')

  readonly active = signal(false)
  readonly tool = signal<Tool>('pen')
  readonly ink = signal<string>(INKS[0])
  /** THE BAR IS OUT OF THE FRAME. True only across the two frames either side
   *  of the grab — never across the permission dialog, which the participant
   *  answers with the toolbar still in front of them and which no amount of
   *  waiting on our side can hurry. Keeping these two states apart is what
   *  stops a dismissed picker from leaving the sheet without its controls. */
  readonly shooting = signal(false)
  /** A shot is in progress, dialog and all — the controls are inert until it
   *  is done, however it ends. */
  readonly busy = signal(false)
  /** Something is on the sheet — the send and clear controls are only real
   *  once there is ink to send. */
  readonly marked = signal(false)

  readonly inks = INKS

  /** Which tile the annotations window was showing when the sheet opened. It
   *  names the picture, so a shelf of shots is readable without opening them. */
  readonly subject = signal('')

  #shapes: Shape[] = []
  #drawing: Shape | null = null
  #pins = 0

  #stream: MediaStream | null = null
  #video: HTMLVideoElement | null = null
  #cleanups: Array<() => void> = []

  ngOnInit(): void {
    this.#cleanups.push(EffectBus.on<{ cellLabel?: string }>('markup:open', payload => {
      this.open(String(payload?.cellLabel ?? ''))
    }))
    this.#cleanups.push(EffectBus.on('markup:close', () => this.close()))
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('resize', this.#onResize)
  }

  ngOnDestroy(): void {
    for (const off of this.#cleanups) off()
    this.#cleanups = []
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('resize', this.#onResize)
    this.#release()
  }

  // ── opening and closing ────────────────────────────────────────────

  /** A fresh sheet every time. Ink kept from a previous question would be
   *  drawn over a screen that has since moved on. */
  open(subject = ''): void {
    if (this.active()) return
    this.subject.set(subject)
    this.#shapes = []
    this.#drawing = null
    this.#pins = 0
    this.marked.set(false)
    this.active.set(true)
    // The canvas exists only once `active` has rendered it.
    setTimeout(() => { this.#size(); this.#paint() }, 0)
  }

  close(): void {
    if (!this.active()) return
    this.active.set(false)
    this.shooting.set(false)
    this.#release()
  }

  /** Stop sharing. A capture stream left running is a browser telling the
   *  participant their screen is being watched, which it no longer is. */
  #release(): void {
    this.#stream?.getTracks().forEach(track => track.stop())
    this.#stream = null
    if (this.#video) { this.#video.srcObject = null; this.#video = null }
  }

  // ── the sheet ──────────────────────────────────────────────────────

  pick(tool: Tool): void { this.tool.set(tool) }
  pickInk(colour: string): void { this.ink.set(colour) }

  undo(): void {
    this.#shapes.pop()
    this.#pins = this.#shapes.reduce((n, shape) => (shape.tool === 'pin' ? n + 1 : n), 0)
    this.marked.set(this.#shapes.length > 0)
    this.#paint()
  }

  clear(): void {
    this.#shapes = []
    this.#pins = 0
    this.marked.set(false)
    this.#paint()
  }

  onPointerDown(event: PointerEvent): void {
    if (this.busy()) return
    const canvas = this.canvasRef()?.nativeElement
    if (!canvas) return
    canvas.setPointerCapture(event.pointerId)
    const at = { x: event.clientX, y: event.clientY }
    const ink = this.ink()

    if (this.tool() === 'pin') {
      this.#shapes.push({ tool: 'pin', ink, at, n: ++this.#pins })
      this.marked.set(true)
      this.#paint()
      return
    }
    const shape: Shape = this.tool() === 'pen'
      ? { tool: 'pen', ink, points: [at] }
      : { tool: this.tool() as 'arrow' | 'box', ink, from: at, to: at }
    this.#drawing = shape
    this.#shapes.push(shape)
    this.marked.set(true)
    this.#paint()
  }

  onPointerMove(event: PointerEvent): void {
    const shape = this.#drawing
    if (!shape) return
    const at = { x: event.clientX, y: event.clientY }
    if (shape.tool === 'pen') shape.points.push(at)
    else if (shape.tool !== 'pin') shape.to = at
    this.#paint()
  }

  onPointerUp(event: PointerEvent): void {
    const canvas = this.canvasRef()?.nativeElement
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    // A pen stroke of one point and a box of no size are a misclick, not a
    // mark — drop them rather than leaving an invisible shape in the stack.
    const shape = this.#drawing
    this.#drawing = null
    if (shape && this.#empty(shape)) {
      this.#shapes = this.#shapes.filter(held => held !== shape)
      this.marked.set(this.#shapes.length > 0)
      this.#paint()
    }
  }

  #empty(shape: Shape): boolean {
    if (shape.tool === 'pen') return shape.points.length < 2
    if (shape.tool === 'pin') return false
    return Math.abs(shape.to.x - shape.from.x) < 4 && Math.abs(shape.to.y - shape.from.y) < 4
  }

  // ── painting ───────────────────────────────────────────────────────

  #onResize = (): void => {
    if (!this.active()) return
    this.#size()
    this.#paint()
  }

  /** Device pixels for sharpness, CSS pixels for the arithmetic — the
   *  transform is set once per paint so every stroke is authored in the same
   *  coordinates the pointer reports. */
  #size(): void {
    const canvas = this.canvasRef()?.nativeElement
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(window.innerWidth * ratio)
    canvas.height = Math.round(window.innerHeight * ratio)
  }

  #paint(): void {
    const canvas = this.canvasRef()?.nativeElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ratio = window.devicePixelRatio || 1
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio)

    // Every mark carries a soft dark halo. The ink has to read over a bright
    // panel and over the dark hive in the same shot, and a halo is what makes
    // one palette legible on both without dimming the screen underneath.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = 4
    ctx.lineWidth = INK_WIDTH
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (const shape of this.#shapes) {
      ctx.strokeStyle = shape.ink
      ctx.fillStyle = shape.ink
      if (shape.tool === 'pen') this.#pen(ctx, shape.points)
      else if (shape.tool === 'box') this.#box(ctx, shape.from, shape.to)
      else if (shape.tool === 'arrow') this.#arrow(ctx, shape.from, shape.to)
      else this.#pin(ctx, shape.at, shape.n)
    }
  }

  #pen(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
    if (points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
  }

  #box(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
    ctx.beginPath()
    ctx.rect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y))
    ctx.stroke()
  }

  #arrow(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    const head = 14
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
  }

  #pin(ctx: CanvasRenderingContext2D, at: Point, n: number): void {
    ctx.beginPath()
    ctx.arc(at.x, at.y, PIN_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = PIN_TEXT
    ctx.font = `700 ${PIN_RADIUS + 2}px ui-monospace, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(n), at.x, at.y + 1)
    ctx.restore()
  }

  // ── the shot ───────────────────────────────────────────────────────

  /** Take the picture and put it on the chat's shelf. The sheet closes on
   *  success: the mark has become the picture, and leaving it up would invite
   *  a second shot of a screen that is now covered by a toast. */
  async send(): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    let blob: Blob | null = null
    try {
      // THE PERMISSION FIRST, the hiding second. The browser's picker sits
      // over the page, so nothing is gained by taking the toolbar away before
      // it is answered — and a refusal would otherwise leave the sheet bare.
      const stream = await this.#displayStream()
      if (stream) {
        this.shooting.set(true)
        // Two frames: one for the toolbar's removal to be laid out, one for
        // it to have been painted before the capture reads the compositor.
        await this.#nextPaint()
        await this.#nextPaint()
        blob = await this.#shoot(stream)
      }
    } finally {
      this.shooting.set(false)
      this.busy.set(false)
    }

    if (!blob) {
      EffectBus.emit('toast:show', { type: 'warning', title: 'markup', message: this.#say('markup.nopicture') })
      return
    }

    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    let sig = ''
    if (store?.putResource) {
      try { sig = await store.putResource(blob) } catch { sig = '' }
    }
    if (!SIG_RE.test(sig)) {
      EffectBus.emit('toast:show', { type: 'warning', title: 'markup', message: this.#say('markup.nostore') })
      return
    }

    const subject = this.subject().trim()
    EffectBus.emit('chat:attach-picture', {
      sig,
      name: subject ? `marked-up screen — ${subject}` : 'marked-up screen',
      kind: blob.type || 'image/png',
      size: blob.size,
    })
    EffectBus.emit('toast:show', { type: 'success', title: 'markup', message: this.#say('markup.attached') })
    this.close()
  }

  #nextPaint(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
  }

  /** One frame of the shared surface, as PNG. Null when there is no frame to
   *  be had — a stream revoked from the browser's own sharing bar between the
   *  grant and the grab still hands back a track that decodes nothing. */
  async #shoot(stream: MediaStream): Promise<Blob | null> {
    const video = await this.#playing(stream)
    if (!video) return null

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null

    const scale = Math.min(1, MAX_SHOT_PX / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
  }

  /** The capture stream, asked for once and kept while the sheet is open. A
   *  second shot of the same markup session must not cost a second
   *  permission prompt — the participant already said yes to this. */
  async #displayStream(): Promise<MediaStream | null> {
    if (this.#stream?.active) return this.#stream
    const media = navigator.mediaDevices as MediaDevices | undefined
    if (!media?.getDisplayMedia) return null

    // CURRENT TAB FIRST — the hive is what is being marked up, and Chromium
    // turns `preferCurrentTab` into a single confirm instead of a picker.
    // The plain form is the fallback for every browser that rejects the hint
    // (it is a Chromium extension to the standard options).
    const preferred = {
      video: { frameRate: { ideal: 5 } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    }
    for (const options of [preferred, { video: true, audio: false }]) {
      try {
        this.#stream = await media.getDisplayMedia(options as DisplayMediaStreamOptions)
        break
      } catch (error) {
        // A refusal is the participant's answer and must not be retried with
        // a second dialog; only an unsupported OPTION falls through.
        if ((error as DOMException)?.name === 'NotAllowedError') return null
        this.#stream = null
      }
    }
    if (!this.#stream) return null

    // Stopping the share from the browser's bar ends the stream; the next
    // shot then asks again rather than photographing a dead track.
    this.#stream.getVideoTracks()[0]?.addEventListener('ended', () => { this.#release() })
    return this.#stream
  }

  /** A <video> playing the stream, with a FRESH frame in it. `drawImage` on a
   *  video that has not yet decoded one paints nothing at all. */
  async #playing(stream: MediaStream): Promise<HTMLVideoElement | null> {
    if (!this.#video) {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      this.#video = video
    }
    const video = this.#video
    if (video.srcObject !== stream) {
      video.srcObject = stream
      try { await video.play() } catch { /* a muted stream may autoplay; if it did not, the frame wait decides */ }
    }
    const framed = await this.#nextVideoFrame(video)
    return framed ? video : null
  }

  #nextVideoFrame(video: HTMLVideoElement): Promise<boolean> {
    const withCallback = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
    return new Promise<boolean>(resolve => {
      let settled = false
      const done = (ok: boolean): void => { if (!settled) { settled = true; resolve(ok) } }
      setTimeout(() => done(video.readyState >= 2), FRAME_TIMEOUT_MS)
      if (typeof withCallback.requestVideoFrameCallback === 'function') {
        withCallback.requestVideoFrameCallback(() => done(true))
        return
      }
      const poll = (): void => {
        if (settled) return
        if (video.readyState >= 2) { done(true); return }
        requestAnimationFrame(poll)
      }
      poll()
    })
  }

  #say(key: string): string {
    const i18n = ioc()?.get('@hypercomb.social/I18n') as { t?(key: string): string } | undefined
    return i18n?.t?.(key) ?? key
  }

  // ── keys ───────────────────────────────────────────────────────────

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active()) return
    if (event.key === 'Escape') {
      // ESCAPE SHOWS THE HEXAGONS. The sheet is the thing covering them.
      event.preventDefault()
      event.stopPropagation()
      this.close()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.stopPropagation()
      this.undo()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void this.send()
    }
  }
}

// Above the tile editor (100002) and the camera (100003) in the stylesheet,
// and mounted between the portal overlay and the dialogs here — the sheet
// covers the app, and only the toast may sit over it.
registerShellSurface({
  name: 'hc-markup-overlay',
  owner: OWNER,
  component: MarkupOverlayComponent,
  order: 235,
})
