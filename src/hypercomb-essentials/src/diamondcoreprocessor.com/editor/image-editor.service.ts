// hypercomb-essentials/src/diamondcoreprocessor.com/editor/image-editor.service.ts
// Manages a Pixi Application for image editing: drag, zoom, hex-masked capture.
// Ported from legacy TileImageComponent + ImageCaptureManager.

import { Application, Container, Graphics, Sprite, Texture, RenderTexture, Rectangle } from 'pixi.js'

export class ImageEditorService extends EventTarget {

  #app: Application | null = null
  #container: Container | null = null
  #sprite: Sprite | null = null
  #hexFrame: Graphics | null = null
  #hostElement: HTMLElement | null = null
  #initialized = false

  #isDragging = false
  #dragStart = { x: 0, y: 0 }

  #hexWidth = 0
  #hexHeight = 0
  #borderColor = 0xc8975a

  // ── public state ───────────────────────────────────────────────

  get hasImage(): boolean { return this.#sprite !== null }

  // ── lifecycle ──────────────────────────────────────────────────

  readonly initialize = async (
    hostElement: HTMLElement,
    width: number,
    height: number
  ): Promise<void> => {
    if (this.#initialized) return

    this.#hostElement = hostElement
    this.#hexWidth = width
    this.#hexHeight = height

    this.#app = new Application()

    await this.#app.init({
      width,
      height,
      backgroundColor: 0x1e1e1e,
      antialias: true,
      autoDensity: true,
    })

    this.#app.stage.eventMode = 'static'
    this.#app.canvas.style.cursor = 'auto'
    hostElement.appendChild(this.#app.canvas)

    // create main container with hit area for pointer events
    this.#container = new Container()
    this.#container.eventMode = 'dynamic'
    this.#container.cursor = 'move'
    this.#container.hitArea = new Rectangle(0, 0, width, height)
    this.#container.on('pointerdown', this.#onPointerDown)
    this.#app.stage.addChild(this.#container)

    // listen for wheel on the canvas element
    this.#app.canvas.addEventListener('wheel', this.#onWheel, { passive: false })

    // hex frame border — 4 segments drawn directly in canvas coords.
    // Source SVG bounds mapped to canvas via uniform scale-to-height + center-x.
    this.#hexFrame = new Graphics()
    this.#hexFrame.eventMode = 'none'
    this.#container.addChild(this.#hexFrame)
    this.#drawHexFrame()

    this.#initialized = true
    this.#emit()
  }

  readonly destroy = (): void => {
    if (!this.#initialized) return

    // grab canvas ref before destroy nullifies it
    const canvas = this.#app?.canvas ?? null

    canvas?.removeEventListener('wheel', this.#onWheel)
    this.#container?.removeAllListeners()
    this.#app?.stage.removeChildren()
    this.#app?.stop()
    this.#app?.destroy()

    // remove canvas from DOM
    if (this.#hostElement && canvas) {
      try { this.#hostElement.removeChild(canvas) } catch { /* already gone */ }
    }

    this.#app = null
    this.#container = null
    this.#sprite = null
    this.#hexFrame = null
    this.#hostElement = null
    this.#initialized = false
    this.#isDragging = false
    this.#emit()
  }

  // ── image loading ──────────────────────────────────────────────

  readonly loadImage = async (
    blob: Blob,
    transform?: { x: number; y: number; scale: number }
  ): Promise<void> => {
    if (!this.#container || !this.#app) return

    // remove existing sprite
    if (this.#sprite) {
      this.#container.removeChild(this.#sprite)
      this.#sprite.destroy()
      this.#sprite = null
    }

    const bitmap = await createImageBitmap(blob)
    const texture = Texture.from(bitmap)

    this.#sprite = new Sprite(texture)
    this.#sprite.anchor.set(0.5)

    // apply saved transform or center the image
    if (transform) {
      this.#sprite.x = transform.x + this.#hexWidth / 2
      this.#sprite.y = transform.y + this.#hexHeight / 2
      this.#sprite.scale.set(transform.scale)
    } else {
      // fit image into hex dimensions
      this.#sprite.x = this.#hexWidth / 2
      this.#sprite.y = this.#hexHeight / 2
      const scaleX = this.#hexWidth / bitmap.width
      const scaleY = this.#hexHeight / bitmap.height
      this.#sprite.scale.set(Math.max(scaleX, scaleY))
    }

    this.#container.addChildAt(this.#sprite, 0)
    this.#emit()
  }

  // ── capture ────────────────────────────────────────────────────
  // Renders the container at hex dimensions to a WebP blob.
  // No layer overlays — just the positioned/scaled image.

  readonly captureSmall = async (
    width: number,
    height: number
  ): Promise<Blob> => {
    if (!this.#app || !this.#container) {
      throw new Error('ImageEditorService not initialized')
    }

    const renderer = this.#app.renderer
    const renderTexture = RenderTexture.create({
      width,
      height,
      resolution: 1,
      scaleMode: 'nearest',
      antialias: false,
    })

    renderer.render({
      container: this.#container,
      target: renderTexture,
      clear: true,
    } as any)

    const canvas = renderer.extract.canvas(renderTexture) as HTMLCanvasElement
    renderTexture.destroy(true)

    return await this.#canvasToBlob(canvas)
  }

  // ── transform state ────────────────────────────────────────────

  readonly getTransform = (): { x: number; y: number; scale: number } => {
    if (!this.#sprite) return { x: 0, y: 0, scale: 1 }

    return {
      x: this.#sprite.x - this.#hexWidth / 2,
      y: this.#sprite.y - this.#hexHeight / 2,
      scale: this.#sprite.scale.x,
    }
  }

  // ── hex frame border ───────────────────────────────────────────
  // 4 filled segments drawn in source SVG coordinates.
  // Pixi pivot+scale maps source bbox to canvas dimensions.
  // Top: E5+E0 (vertex notch), Right: E1, Left: E4, Bottom: E2+E3 (vertex notch)

  readonly setBorderColor = (color: string): void => {
    this.#borderColor = color
      ? (parseInt(color.replace('#', ''), 16) || 0xc8975a)
      : 0xc8975a
    this.#drawHexFrame()
  }

  #drawHexFrame(): void {
    const g = this.#hexFrame
    if (!g) return
    g.clear()

    const c = this.#borderColor
    const w = this.#hexWidth
    const h = this.#hexHeight

    // Map source SVG path bounds to canvas via uniform scale-to-height.
    // Source bounds: x[27.090419..103.57464] y[122.41302..213.95472]
    const srcMinX = 27.090419, srcMinY = 122.41302
    const srcW = 76.484221, srcH = 91.5417
    const s = h / srcH
    const ox = (w - srcW * s) / 2
    const tx = (x: number) => (x - srcMinX) * s + ox
    const ty = (y: number) => (y - srcMinY) * s

    // Top segment: E5 + E0 (vertex notch at top)
    g.poly([
      tx(64.927386), ty(122.41302),
      tx(64.928936), ty(122.54893),
      tx(27.090419), ty(144.79047),
      tx(32.63375),  ty(147.95978),
      tx(65.044691), ty(128.82193),
      tx(97.997719), ty(147.65902),
      tx(103.52451), ty(144.45509),
      tx(65.158896), ty(122.54531),
      tx(65.160447), ty(122.41302),
      tx(65.045725), ty(122.48072),
      tx(64.927386), ty(122.41302),
    ])
    g.fill({ color: c })

    // Right segment: E1
    g.poly([
      tx(103.57464),  ty(146.06222),
      tx(98.108823),  ty(149.37055),
      tx(98.108823),  ty(187.00908),
      tx(103.57464),  ty(190.2218),
      tx(103.57464),  ty(146.06222),
    ])
    g.fill({ color: c })

    // Left segment: E4
    g.poly([
      tx(27.090419),  ty(146.14594),
      tx(27.090419),  ty(190.30552),
      tx(32.632716),  ty(186.94448),
      tx(32.556235),  ty(149.35815),
      tx(27.090419),  ty(146.14594),
    ])
    g.fill({ color: c })

    // Bottom segment: E2 + E3 (vertex notch at bottom)
    g.poly([
      tx(98.137245),  ty(188.37385),
      tx(65.641037),  ty(207.53392),
      tx(32.6353),    ty(188.63792),
      tx(27.176202),  ty(191.90955),
      tx(65.506162),  ty(213.82243),
      tx(65.504612),  ty(213.95472),
      tx(65.619333),  ty(213.88702),
      tx(65.737672),  ty(213.95472),
      tx(65.736639),  ty(213.81829),
      tx(103.57464),  ty(191.57727),
      tx(98.137245),  ty(188.37385),
    ])
    g.fill({ color: c })
  }

  // ── drag handling ──────────────────────────────────────────────

  #onPointerDown = (e: any): void => {
    if (!this.#sprite || !this.#container) return

    const start = this.#container.toLocal(e.global)
    this.#dragStart.x = start.x - this.#sprite.x
    this.#dragStart.y = start.y - this.#sprite.y

    this.#app!.stage.on('pointermove', this.#onPointerMove)
    this.#app!.stage.on('pointerup', this.#onPointerUp)
    this.#app!.stage.on('pointerupoutside', this.#onPointerUp)

    this.#isDragging = true
    this.#app!.canvas.style.cursor = 'grabbing'
  }

  #onPointerMove = (e: any): void => {
    if (!this.#isDragging || !this.#sprite || !this.#container) return
    const pos = this.#container.toLocal(e.global)
    this.#sprite.position.set(
      pos.x - this.#dragStart.x,
      pos.y - this.#dragStart.y,
    )
  }

  #onPointerUp = (): void => {
    this.#isDragging = false
    this.#app?.stage.off('pointermove', this.#onPointerMove)
    this.#app?.stage.off('pointerup', this.#onPointerUp)
    this.#app?.stage.off('pointerupoutside', this.#onPointerUp)
    if (this.#app) this.#app.canvas.style.cursor = 'auto'

    this.#syncTransform()
  }

  // ── zoom handling ──────────────────────────────────────────────

  #onWheel = (event: WheelEvent): void => {
    if (!this.#sprite || !this.#app) return
    event.preventDefault()

    const factor = event.deltaY > 0 ? 0.95 : 1.05
    let newScale = this.#sprite.scale.x * factor
    newScale = Math.max(0.05, Math.min(10, newScale))
    this.#sprite.scale.set(newScale)

    this.#syncTransform()
  }

  // ── internal helpers ───────────────────────────────────────────

  #syncTransform(): void {
    // push transform to TileEditorService (if available)
    const service = (window as any).ioc?.get?.('@diamondcoreprocessor.com/TileEditorService')
    if (service?.updateTransform) {
      const t = this.getTransform()
      service.updateTransform(t.x, t.y, t.scale)
    }
  }

  #canvasToBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
        'image/webp',
      ),
    )

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/ImageEditorService',
  new ImageEditorService(),
)
