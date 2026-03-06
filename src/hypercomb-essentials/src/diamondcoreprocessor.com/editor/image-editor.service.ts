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
    // force canvas to fill its container (Angular view encapsulation
    // prevents the SCSS canvas rule from reaching this dynamic element)
    this.#app.canvas.style.display = 'block'
    this.#app.canvas.style.width = '100%'
    this.#app.canvas.style.height = '100%'
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

  readonly setBackgroundColor = (color: string): void => {
    if (!this.#app) return
    const parsed = color
      ? (parseInt(color.replace('#', ''), 16) || 0x1e1e1e)
      : 0x1e1e1e
    this.#app.renderer.background.color = parsed
  }

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

    // 346×400 hex frame path — uniform scale at 95%, centered.
    // Source bounds: x[27.090419..118.63625] y[122.41302..228.24639]
    const srcMinX = 27.090419, srcMinY = 122.41302
    const srcW = 91.545831, srcH = 105.83337
    const s = (h / srcH) * 0.95
    const ox = (w - srcW * s) / 2
    const oy = (h - srcH * s) / 2
    const tx = (x: number) => (x - srcMinX) * s + ox
    const ty = (y: number) => (y - srcMinY) * s + oy

    // Top segment: E5 + E0 (vertex notch at top)
    g.poly([
      tx(72.37841),  ty(122.41302),
      tx(72.38031),  ty(122.57015),
      tx(27.090464), ty(148.28408),
      tx(33.725412), ty(151.94819),
      tx(72.51886),  ty(129.8225),
      tx(111.96115), ty(151.60047),
      tx(118.5763),  ty(147.89634),
      tx(72.655554), ty(122.56596),
      tx(72.657454), ty(122.41302),
      tx(72.52014),  ty(122.49132),
      tx(72.37841),  ty(122.41302),
    ])
    g.fill({ color: c })

    // Right segment: E1
    g.poly([
      tx(118.63625), ty(149.75438),
      tx(112.09408), ty(153.57921),
      tx(112.09408), ty(197.09393),
      tx(118.63625), ty(200.80823),
      tx(118.63625), ty(149.75438),
    ])
    g.fill({ color: c })

    // Left segment: E4
    g.poly([
      tx(27.090419), ty(149.85118),
      tx(27.090419), ty(200.905),
      tx(33.72413),  ty(197.01923),
      tx(33.63259),  ty(153.56485),
      tx(27.090419), ty(149.85118),
    ])
    g.fill({ color: c })

    // Bottom segment: E2 + E3 (vertex notch at bottom)
    g.poly([
      tx(112.1281),  ty(198.67179),
      tx(73.232596), ty(220.82317),
      tx(33.727223), ty(198.97709),
      tx(27.193095), ty(202.75949),
      tx(73.071161), ty(228.09345),
      tx(73.069261), ty(228.24639),
      tx(73.206574), ty(228.16809),
      tx(73.348217), ty(228.24639),
      tx(73.347017), ty(228.08866),
      tx(118.63624), ty(202.37534),
      tx(112.1281),  ty(198.67179),
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
