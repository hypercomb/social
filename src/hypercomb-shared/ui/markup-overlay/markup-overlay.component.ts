// hypercomb-shared/ui/markup-overlay/markup-overlay.component.ts
//
// ANNOTATE THE SCREEN — draw on what you are looking at, photograph it, and
// hand the picture to the agents as context.
//
// It is reachable from ANYWHERE: the command line's rail, the word
// `/annotate`, and the `d` key all open the same sheet. It used to hang off
// the notes desk's header, which made annotating a thing you did while
// writing notes; it is the opposite — you annotate the screen you are
// standing in front of, and the notes desk is just one of the things that
// might be on it.
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
// 4. IT KNOWS WHERE IT WAS DRAWN. A screen is always a screen OF somewhere,
//    and the hive already says where you are standing — so the sheet reads the
//    location on open and the picture carries it. That is what makes the
//    second door possible: START A CONVERSATION, which mints a new thread on
//    that very tile with the annotation as its only reference. No picker, no
//    second gesture naming a subject that was never in doubt.
//
// 5. A CUT SENDS ONLY WHAT MATTERS. Drag a cut around each part of the screen
//    the question is about and each goes as its own picture, taken from the
//    full-resolution frame — sharper than the downscaled whole, and a fraction
//    of what a model spends reading it (markup-cut.ts says why several cuts
//    beat one big one). A cut is not ink: its frame leaves the sheet with the
//    toolbar for the shot, and no cut at all sends the whole screen.
//
// Numbers rather than typed labels: the words belong in the question, and a
// pin dropped on the screen is what ties "the button at 1 is misaligned" to a
// place. Typing on a canvas would be a second, worse composer.
//
// Registry-fed surface (registerShellSurface), never an <hc-*> tag in app.html.

import { Component, ElementRef, computed, signal, viewChild, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { cutRegions, type Region } from './markup-cut'

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

/** The shorter side a cut needs to be a picture rather than a slip of the
 *  pointer, in CSS pixels. */
const MIN_CUT_PX = 12

/** A cut's frame and number are about taking the picture, never in it, so
 *  they wear one neutral ink rather than the palette. */
const CUT_INK = '#f5f7fa'

/** The palette. Bright on purpose: this ink is drawn over a screenshot, not
 *  over a panel, and it has to survive both a dark hive and a bright one. The
 *  values live here rather than in the stylesheet because the canvas is
 *  painted from TypeScript and the swatches are painted FROM this list. */
const INKS = ['#ff4d4d', '#ffb020', '#3ddc84', '#48c6ff', '#ff6bd6', '#f5f7fa'] as const

/** Number pins carry dark digits — every ink above is light enough that a
 *  dark glyph is the readable one, at both ends of the palette. */
const PIN_TEXT = '#101418'

type Tool = 'pen' | 'arrow' | 'box' | 'pin' | 'cut'
type Point = { x: number; y: number }
type Shape =
  | { tool: 'pen'; ink: string; points: Point[] }
  | { tool: 'arrow'; ink: string; from: Point; to: Point }
  | { tool: 'box'; ink: string; from: Point; to: Point }
  | { tool: 'pin'; ink: string; at: Point; n: number }
  | { tool: 'cut'; from: Point; to: Point }

/** What one press of a door photographs: a picture per cut, or the whole
 *  screen. `uncut` — cuts were drawn, but the surface shared was not this tab,
 *  so the whole screen went instead. */
type Shot = { blobs: Blob[]; uncut: boolean }

/** The hive's content store, over IoC — a picture is content like any other
 *  and is addressed by the signature of its bytes. */
type StoreLike = { putResource?(blob: Blob): Promise<string> }

/** WHERE YOU ARE STANDING. The one fact the sheet needs from the hive: the
 *  segments of the layer on screen, which is the location the annotation is
 *  OF and the tile a conversation started from it belongs to. */
type LineageLike = { explorerSegments?(): readonly string[] }

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
  /** How many cuts are on the sheet — once there is one, the hint says what
   *  the doors will send. */
  readonly cuts = signal(0)

  readonly inks = INKS

  /** WHERE THE SHEET WAS OPENED — the layer's segments, read once on open and
   *  never re-read: a picture is of the screen at a moment, and the moment
   *  that matters is the one the participant started drawing on. Empty is the
   *  hive's own root, which is a location like any other. */
  readonly location = signal<readonly string[]>([])

  /** That location as a participant reads it — `/dolphin/site`, or the hive. */
  readonly where = computed(() =>
    this.location().length ? '/' + this.location().join('/') : this.#say('markup.hive'))

  #shapes: Shape[] = []
  #drawing: Shape | null = null
  #pins = 0

  #stream: MediaStream | null = null
  #video: HTMLVideoElement | null = null
  #cleanups: Array<() => void> = []

  ngOnInit(): void {
    this.#cleanups.push(EffectBus.on<{ path?: readonly string[] }>('markup:open', payload => {
      this.open(Array.isArray(payload?.path) ? payload!.path! : undefined)
    }))
    this.#cleanups.push(EffectBus.on('markup:close', () => this.close()))
    // THE KEY IS THE SAME ACT — `d` (keyboard/default-keymap.ts) comes through
    // the keymap's one lane, exactly as `c` reaches the chat window, so the
    // press, the rail button and the word all land in `open`.
    this.#cleanups.push(EffectBus.on<{ cmd?: string }>('keymap:invoke', payload => {
      if (payload?.cmd !== 'markup.open') return
      if (this.active()) this.close()
      else this.open()
    }))
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
   *  drawn over a screen that has since moved on.
   *
   *  `path` is for a caller that knows better than the hive does; everyone
   *  else gets the layer on screen, which is the answer in every case anyone
   *  has needed so far. */
  open(path?: readonly string[]): void {
    if (this.active()) return
    this.location.set(path ? [...path] : this.#here())
    this.#shapes = []
    this.#drawing = null
    this.#pins = 0
    this.#tally()
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

  /** The layer on screen, as segments. A hive that has not registered its
   *  lineage yet answers with the root, which is where it is. */
  #here(): readonly string[] {
    const lineage = ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined
    return (lineage?.explorerSegments?.() ?? [])
      .map(segment => String(segment ?? '').trim())
      .filter(Boolean)
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
    this.#tally()
    this.#paint()
  }

  clear(): void {
    this.#shapes = []
    this.#pins = 0
    this.#tally()
    this.#paint()
  }

  /** Recount what is on the sheet after anything changed it. */
  #tally(): void {
    this.marked.set(this.#shapes.length > 0)
    this.cuts.set(this.#shapes.filter(shape => shape.tool === 'cut').length)
  }

  onPointerDown(event: PointerEvent): void {
    if (this.busy()) return
    const canvas = this.canvasRef()?.nativeElement
    if (!canvas) return
    canvas.setPointerCapture(event.pointerId)
    const at = { x: event.clientX, y: event.clientY }
    const ink = this.ink()
    const tool = this.tool()

    if (tool === 'pin') {
      this.#shapes.push({ tool: 'pin', ink, at, n: ++this.#pins })
      this.marked.set(true)
      this.#paint()
      return
    }
    const shape: Shape = tool === 'pen' ? { tool: 'pen', ink, points: [at] }
      : tool === 'cut' ? { tool: 'cut', from: at, to: at }
      : { tool, ink, from: at, to: at }
    this.#drawing = shape
    this.#shapes.push(shape)
    this.#tally()
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
      this.#tally()
      this.#paint()
    }
  }

  #empty(shape: Shape): boolean {
    if (shape.tool === 'pen') return shape.points.length < 2
    if (shape.tool === 'pin') return false
    const width = Math.abs(shape.to.x - shape.from.x)
    const height = Math.abs(shape.to.y - shape.from.y)
    // A cut becomes a picture of its own, so a sliver on EITHER side is a slip.
    if (shape.tool === 'cut') return width < MIN_CUT_PX || height < MIN_CUT_PX
    return width < 4 && height < 4
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

  /** `shot` paints the sheet as the capture must see it: the ink, and none of
   *  the cut frames — they decide what is sent and are not part of it. */
  #paint(shot = false): void {
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

    let cut = 0
    for (const shape of this.#shapes) {
      if (shape.tool === 'cut') {
        cut++
        if (!shot) this.#cut(ctx, shape.from, shape.to, cut)
        continue
      }
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

  /** A cut's frame: dashed, in the neutral ink, numbered in the order its
   *  picture will be sent. The number sits OUTSIDE the frame's corner when
   *  there is room, so it covers nothing the cut is about. */
  #cut(ctx: CanvasRenderingContext2D, from: Point, to: Point, n: number): void {
    const x = Math.min(from.x, to.x)
    const y = Math.min(from.y, to.y)
    const tab = 18
    const top = y >= tab ? y - tab : y
    ctx.save()
    ctx.strokeStyle = CUT_INK
    ctx.fillStyle = CUT_INK
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    ctx.strokeRect(x, y, Math.abs(to.x - from.x), Math.abs(to.y - from.y))
    ctx.fillRect(x, top, tab, tab)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = PIN_TEXT
    ctx.font = '700 12px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(n), x + tab / 2, top + tab / 2 + 1)
    ctx.restore()
  }

  // ── the shot ───────────────────────────────────────────────────────

  /** Take the picture and put it on the chat's shelf. The sheet closes on
   *  success: the mark has become the picture, and leaving it up would invite
   *  a second shot of a screen that is now covered by a toast.
   *
   *  TWO DOORS, one act. `fresh` is the difference between "this belongs in
   *  what we are already talking about" and "this is a new thing to talk
   *  about" — and the second is the whole reason the sheet reads a location:
   *  a new conversation has to be a conversation ABOUT somewhere, and the
   *  somewhere is where you were standing when you drew. */
  async send(fresh = false): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    let shot: Shot | null = null
    try {
      // THE PERMISSION FIRST, the hiding second. The browser's picker sits
      // over the page, so nothing is gained by taking the toolbar away before
      // it is answered — and a refusal would otherwise leave the sheet bare.
      const stream = await this.#displayStream()
      if (stream) {
        this.shooting.set(true)
        // The cut frames leave with the toolbar: both are about taking the
        // picture, not in it.
        this.#paint(true)
        // Two frames: one for the toolbar's removal to be laid out, one for
        // it to have been painted before the capture reads the compositor.
        await this.#nextPaint()
        await this.#nextPaint()
        shot = await this.#shoot(stream)
      }
    } finally {
      this.shooting.set(false)
      this.busy.set(false)
      this.#paint()
    }

    if (!shot) {
      EffectBus.emit('toast:show', { type: 'warning', title: 'markup', message: this.#say('markup.nopicture') })
      return
    }

    // COMPLETE OR NOTHING. A shelf holding cut 1 of 3 reads as the whole
    // annotation; a failure gets retried, a fragment gets misread.
    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    const sigs: string[] = []
    for (const blob of shot.blobs) {
      let sig = ''
      if (store?.putResource) {
        try { sig = await store.putResource(blob) } catch { sig = '' }
      }
      if (!SIG_RE.test(sig)) {
        EffectBus.emit('toast:show', { type: 'warning', title: 'markup', message: this.#say('markup.nostore') })
        return
      }
      sigs.push(sig)
    }

    const where = this.where()
    const total = shot.blobs.length
    EffectBus.emit('chat:attach-picture', {
      // EVERY PICTURE IN ONE LANDING. Separate landings would race a fresh
      // conversation emptying the shelf, and the bus replays only the last.
      pictures: shot.blobs.map((blob, index) => ({
        sig: sigs[index],
        name: total > 1
          ? this.#say('markup.name.part', { where, n: String(index + 1), total: String(total) })
          : this.#say('markup.name', { where }),
        kind: blob.type || 'image/png',
        size: blob.size,
      })),
      // THE LOCATION RIDES WITH THE PICTURE. The chat window reads it two
      // ways: as the crumb under the reference's name, and — with `fresh` —
      // as the tile the new conversation belongs to.
      path: this.location(),
      fresh,
    })
    EffectBus.emit('toast:show', shot.uncut
      ? { type: 'warning', title: 'markup', message: this.#say('markup.uncut') }
      : {
          type: 'success',
          title: 'markup',
          message: fresh ? this.#say('markup.started', { where })
            : total > 1 ? this.#say('markup.attached.cuts', { n: String(total) })
            : this.#say('markup.attached'),
        })
    this.close()
  }

  #nextPaint(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
  }

  /** The pictures in one frame of the shared surface, as PNG: one per cut, or
   *  the whole frame when there are none. Every cut comes from the SAME frame,
   *  copied once at full resolution — a live screen keeps moving between one
   *  encode and the next. Null when there is no frame to be had — a stream
   *  revoked from the browser's own sharing bar between the grant and the
   *  grab still hands back a track that decodes nothing. */
  async #shoot(stream: MediaStream): Promise<Shot | null> {
    const video = await this.#playing(stream)
    if (!video) return null

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null

    const frame = document.createElement('canvas')
    frame.width = width
    frame.height = height
    const frameCtx = frame.getContext('2d')
    if (!frameCtx) return null
    frameCtx.drawImage(video, 0, 0)

    const cuts = this.#shapes.flatMap(shape => (shape.tool === 'cut' ? [shape] : []))
    // A tab reports itself as `browser`. A window or a monitor holds the page
    // somewhere inside it, where a cut drawn in page pixels cannot be found.
    const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface
    const regions = cuts.length && (!surface || surface === 'browser')
      ? cutRegions(cuts, { width: window.innerWidth, height: window.innerHeight }, { width, height }) ?? []
      : []

    const blobs: Blob[] = []
    for (const region of regions.length ? regions : [{ x: 0, y: 0, width, height }]) {
      const blob = await this.#picture(frame, region)
      if (!blob) return null
      blobs.push(blob)
    }
    return { blobs, uncut: cuts.length > 0 && regions.length === 0 }
  }

  /** One region of the frame as PNG, downscaled only when its long edge
   *  passes the budget the vision models would read it at anyway. */
  #picture(frame: HTMLCanvasElement, region: Region): Promise<Blob | null> {
    const scale = Math.min(1, MAX_SHOT_PX / Math.max(region.width, region.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(region.width * scale))
    canvas.height = Math.max(1, Math.round(region.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.resolve(null)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(frame, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height)
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
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

  #say(key: string, params?: Record<string, string>): string {
    const i18n = ioc()?.get('@hypercomb.social/I18n') as
      { t?(key: string, params?: Record<string, string>): string } | undefined
    return i18n?.t?.(key, params) ?? key
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
      // Shift is the second door: a new conversation rather than the open one.
      void this.send(event.shiftKey)
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
