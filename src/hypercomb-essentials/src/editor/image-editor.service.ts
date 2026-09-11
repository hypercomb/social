// editor/image-editor.service.ts
//
// THE PICTURE BEING FRAMED — its original, and a framing per orientation.
//
// This used to be a second Pixi application: a WebGL context per open, a
// sprite, and a gold hex stroke living in the very container the save
// rendered from. Hiding the stroke for the capture kept it out of most saves
// and not all of them, and an in-flight init, a load racing a load, or a save
// that flipped the live canvas between orientations could each leave the
// wrong thing on screen or in the bytes.
//
// Now it is a MODEL and nothing else. It holds the original bytes, their
// natural size, and one framing per orientation (`undefined` = never framed,
// which means the default: centred, covering). The crop stage in the tile
// editor view draws it with a transformed <img>; the save captures it with
// `hex-capture.ts`, off screen, from the original. There is nothing to hide
// from a capture because nothing but the picture is ever in one.
//
// ONLY THE LATEST LOAD LANDS. Every load takes a generation number; a decode
// that finishes after a newer load began is dropped and its bitmap closed.
// A NEW picture resets BOTH orientations' framing — keeping the old picture's
// numbers is how a replaced picture came to be saved as a postage stamp in a
// dark box in whichever orientation nobody was looking at.
//
// The IoC shape of the old service is kept (`hasImage`, `orientation`,
// `loadImage`, `getTransform`, `setOrientation`, `captureSmall`, `destroy`,
// `initialize`) — the drop, paste and link doors call it.

import {
  clampFraming,
  constraintBox,
  containScale,
  coverScale,
  defaultFraming,
  hexBox,
  leavesGaps,
  readFraming,
  DEFAULT_HEX_SIDE,
  type CropMode,
  type Framing,
  type HexOrientation,
  type Size,
} from './crop-math.js'
import { captureHexSmall, decodePicture } from './hex-capture.js'

type SettingsShape = { hexagonSide?: number }

const ORIENTATIONS: readonly HexOrientation[] = ['point-top', 'flat-top']

const other = (orientation: HexOrientation): HexOrientation =>
  orientation === 'point-top' ? 'flat-top' : 'point-top'

const sameFraming = (a: Framing | undefined, b: Framing | undefined): boolean =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.scale - b.scale) < 1e-9)

export type StoredFramings = { point?: unknown; flat?: unknown }

export class ImageEditorService extends EventTarget {

  #source: Blob | null = null
  #bitmap: ImageBitmap | null = null
  #natural: Size | null = null
  #url = ''
  #framing: Record<HexOrientation, Framing | undefined> = { 'point-top': undefined, 'flat-top': undefined }
  #baseline: Record<HexOrientation, Framing | undefined> = { 'point-top': undefined, 'flat-top': undefined }
  #orientation: HexOrientation = 'point-top'
  #linked = true
  #mode: CropMode = 'fill'
  #generation = 0
  #pictureChanged = false
  #removed = false
  #loading = false
  #failed = false
  #ready: Promise<void> = Promise.resolve()

  // ── state ─────────────────────────────────────────────────────

  get hasImage(): boolean { return this.#natural !== null }
  get orientation(): HexOrientation { return this.#orientation }
  get linked(): boolean { return this.#linked }
  set linked(value: boolean) { this.setLinked(value) }
  get mode(): CropMode { return this.#mode }
  /** The original bytes being framed — what a save stores as `large.image`. */
  get source(): Blob | null { return this.#source }
  /** The decoded original, for captures. Owned here; never close it. */
  get bitmap(): ImageBitmap | null { return this.#bitmap }
  get natural(): Size | null { return this.#natural }
  /** An object URL of the original, for the stage's <img>. Owned here. */
  get url(): string { return this.#url }
  /** True once a picture other than the tile's own was loaded (or it was removed). */
  get pictureChanged(): boolean { return this.#pictureChanged }
  get removed(): boolean { return this.#removed }
  get loading(): boolean { return this.#loading }
  get failed(): boolean { return this.#failed }
  /** Resolves when the most recent load has landed (or failed). */
  get ready(): Promise<void> { return this.#ready }

  get side(): number {
    const side = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
      ?.get?.('@diamondcoreprocessor.com/Settings') as SettingsShape | undefined
    return typeof side?.hexagonSide === 'number' && side.hexagonSide > 0 ? side.hexagonSide : DEFAULT_HEX_SIDE
  }

  // ── lifecycle ─────────────────────────────────────────────────

  /** Kept for callers of the Pixi editor. The view owns the stage now; this
   *  only adopts an orientation if one is given. */
  readonly initialize = async (_host?: HTMLElement, _size?: number, orientation?: HexOrientation): Promise<void> => {
    if (orientation) this.#orientation = orientation
  }

  /** Forget the picture and every framing. Any load still decoding is dropped. */
  readonly reset = (orientation: HexOrientation = 'point-top'): void => {
    this.#generation++
    this.#release()
    this.#framing = { 'point-top': undefined, 'flat-top': undefined }
    this.#baseline = { 'point-top': undefined, 'flat-top': undefined }
    this.#orientation = orientation
    this.#linked = true
    this.#mode = 'fill'
    this.#pictureChanged = false
    this.#removed = false
    this.#loading = false
    this.#failed = false
    this.#ready = Promise.resolve()
    this.#emit()
  }

  readonly destroy = (): void => this.reset()

  // ── loading ───────────────────────────────────────────────────

  /** The tile's OWN picture, with the framings it was saved at. Opens in Fit
   *  when a stored framing leaves the hexagon uncovered — the numbers are kept
   *  exactly, never silently re-clamped. */
  readonly loadOriginal = (blob: Blob, stored: StoredFramings = {}): Promise<void> => {
    const point = readFraming(stored.point)
    const flat = readFraming(stored.flat)
    return this.#load(blob, { 'point-top': point, 'flat-top': flat }, false)
  }

  /** A NEW picture. Both orientations start from the default framing. */
  readonly loadImage = (blob: Blob, transform?: { x: number; y: number; scale: number }): Promise<void> => {
    const framing = readFraming(transform)
    return this.#load(blob, { 'point-top': framing, 'flat-top': framing }, true)
  }

  /** The drop, paste and link doors: the model accepts a picture whether or not
   *  the editor's view has mounted, so there is nothing to wait for. */
  readonly loadImageWhenReady = (blob: Blob): Promise<void> => this.loadImage(blob)

  #load(blob: Blob, framings: Record<HexOrientation, Framing | undefined>, changed: boolean): Promise<void> {
    const generation = ++this.#generation
    this.#loading = true
    this.#failed = false
    this.#emit()
    const run = (async () => {
      let bitmap: ImageBitmap
      try {
        bitmap = await decodePicture(blob)
      } catch (err) {
        if (generation !== this.#generation) return
        console.warn('[image-editor] could not decode picture', err)
        this.#loading = false
        this.#failed = true
        this.#emit()
        return
      }
      if (generation !== this.#generation) { bitmap.close(); return }
      this.#release()
      this.#source = blob
      this.#bitmap = bitmap
      this.#natural = { width: bitmap.width, height: bitmap.height }
      this.#url = URL.createObjectURL(blob)
      this.#framing = { ...framings }
      this.#linked = sameFraming(framings['point-top'], framings['flat-top'])
      this.#mode = ORIENTATIONS.some(o => {
        const f = framings[o]
        return !!f && leavesGaps(f, this.#natural!, hexBox(o, this.side))
      }) ? 'fit' : 'fill'
      this.#baseline = changed ? { 'point-top': undefined, 'flat-top': undefined } : { ...framings }
      this.#pictureChanged = changed
      this.#removed = false
      this.#loading = false
      this.#emit()
    })()
    this.#ready = run
    return run
  }

  /** Take the picture off the tile. The original stays in history and in the
   *  store; this only stops the tile wearing it. */
  readonly removePicture = (): void => {
    this.#generation++
    this.#release()
    this.#framing = { 'point-top': undefined, 'flat-top': undefined }
    this.#mode = 'fill'
    this.#linked = true
    this.#pictureChanged = true
    this.#removed = true
    this.#loading = false
    this.#ready = Promise.resolve()
    this.#emit()
  }

  // ── framing ───────────────────────────────────────────────────

  /** The box a framing for this orientation has to satisfy right now. */
  readonly boxFor = (orientation: HexOrientation = this.#orientation): Size =>
    constraintBox(orientation, this.#linked, this.side)

  /** The framing in force for an orientation: stored or default, clamped to
   *  the current mode and linking. */
  readonly framingFor = (orientation: HexOrientation = this.#orientation): Framing => {
    const natural = this.#natural
    if (!natural) return { x: 0, y: 0, scale: 1 }
    const stored = this.#framing[orientation] ?? defaultFraming(natural, this.side)
    if (this.#mode === 'fit') {
      // Fit is permissive on purpose: a framing opened below cover keeps its
      // exact numbers. Only enlargement past the ceiling and travel past the
      // box are refused.
      const box = this.boxFor(orientation)
      const min = Math.min(containScale(natural, box), coverScale(natural, box), stored.scale)
      return clampFraming(stored, natural, box, stored.scale < min + 1e-9 ? 'fit' : 'fit')
    }
    return clampFraming(stored, natural, this.boxFor(orientation), 'fill')
  }

  /** Set the framing for an orientation (both, while linked). Clamped. */
  readonly setFraming = (framing: Framing, orientation: HexOrientation = this.#orientation): void => {
    const natural = this.#natural
    if (!natural) return
    const clamped = clampFraming(framing, natural, this.boxFor(orientation), this.#mode)
    this.#framing[orientation] = clamped
    if (this.#linked) this.#framing[other(orientation)] = clamped
    this.#emit()
  }

  readonly setOrientation = async (
    orientation: HexOrientation,
    transform?: { x: number; y: number; scale: number },
  ): Promise<void> => {
    this.#orientation = orientation
    const framing = readFraming(transform)
    if (framing && this.#natural) this.setFraming(framing, orientation)
    else this.#emit()
  }

  readonly setLinked = (linked: boolean): void => {
    if (linked === this.#linked) return
    this.#linked = linked
    if (linked && this.#natural) {
      // One framing for both, re-clamped to the square that holds both boxes.
      const active = this.#framing[this.#orientation] ?? defaultFraming(this.#natural, this.side)
      const clamped = clampFraming(active, this.#natural, this.boxFor(this.#orientation), this.#mode)
      this.#framing['point-top'] = clamped
      this.#framing['flat-top'] = clamped
    }
    this.#emit()
  }

  readonly setMode = (mode: CropMode): void => {
    if (mode === this.#mode) return
    this.#mode = mode
    const natural = this.#natural
    if (natural && mode === 'fill') {
      for (const o of ORIENTATIONS) {
        const f = this.#framing[o]
        if (f) this.#framing[o] = clampFraming(f, natural, this.boxFor(o), 'fill')
      }
    }
    this.#emit()
  }

  /** Back to the default: centred, covering, both orientations together. */
  readonly resetFraming = (): void => {
    this.#framing = { 'point-top': undefined, 'flat-top': undefined }
    this.#linked = true
    this.#mode = 'fill'
    this.#emit()
  }

  /** Has the framing moved since the picture was opened? */
  get framingChanged(): boolean {
    if (!this.#natural) return false
    return ORIENTATIONS.some(o => !sameFraming(this.framingFor(o), this.#baselineFor(o)))
  }

  #baselineFor(orientation: HexOrientation): Framing {
    const natural = this.#natural!
    const stored = this.#baseline[orientation] ?? defaultFraming(natural, this.side)
    return stored
  }

  /** Legacy: the current orientation's framing. */
  readonly getTransform = (): { x: number; y: number; scale: number } => this.framingFor()

  // ── capture ───────────────────────────────────────────────────

  /** One orientation's small picture from the original. `fill` is the
   *  participant's own colour behind a picture set to Fit, and nothing else. */
  readonly capture = async (orientation: HexOrientation, fill?: string | null): Promise<Blob> => {
    await this.#ready
    const bitmap = this.#bitmap
    if (!bitmap) throw new Error('no picture to capture')
    return await captureHexSmall(bitmap, {
      orientation,
      framing: this.framingFor(orientation),
      fill: this.#mode === 'fit' ? fill : null,
      side: this.side,
    })
  }

  /** Legacy shape: the current orientation. The box comes from the side. */
  readonly captureSmall = async (_hexWidth?: number, _hexHeight?: number): Promise<Blob> =>
    this.capture(this.#orientation)

  // ── internals ─────────────────────────────────────────────────

  #release(): void {
    if (this.#bitmap) {
      try { this.#bitmap.close() } catch { /* already closed */ }
    }
    if (this.#url) URL.revokeObjectURL(this.#url)
    this.#bitmap = null
    this.#source = null
    this.#natural = null
    this.#url = ''
  }

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/ImageEditorService',
  new ImageEditorService(),
)
