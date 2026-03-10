// hypercomb-essentials/src/diamondcoreprocessor.com/editor/image-editor.service.ts
// Manages a Pixi Application for image editing: drag, zoom, hex-masked capture.
// Ported from legacy TileImageComponent + ImageCaptureManager.

import { Application, Container, Sprite, Texture, RenderTexture, Rectangle } from 'pixi.js'

export class ImageEditorService extends EventTarget {

  #app: Application | null = null
  #container: Container | null = null
  #sprite: Sprite | null = null
  #hexFrame: Sprite | null = null
  #hostElement: HTMLElement | null = null
  #initialized = false

  #isDragging = false
  #dragStart = { x: 0, y: 0 }

  #hexWidth = 0
  #hexHeight = 0
  #borderColor = '#c8975a'
  #backgroundColor = 0x1e1e1e
  #svgSource: string | null = null

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

    // hex frame border — loaded from SVG, color-swappable
    await this.#loadHexFrame()

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
  // Includes the hex frame border — the snapshot IS the cell visual.

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
  // Loaded from /local.svg at exact canvas dimensions.
  // Dynamic color via SVG fill attribute replacement.

  readonly setBackgroundColor = (color: string): void => {
    if (!this.#app) return
    const parsed = color
      ? (parseInt(color.replace('#', ''), 16) || 0x1e1e1e)
      : 0x1e1e1e
    this.#backgroundColor = parsed
    this.#app.renderer.background.color = parsed
  }

  readonly setBorderColor = (color: string): void => {
    this.#borderColor = color && /^#?[0-9a-fA-F]{6}$/.test(color.replace('#', ''))
      ? (color.startsWith('#') ? color : `#${color}`)
      : '#c8975a'
    void this.#loadHexFrame()
  }

  async #loadHexFrame(): Promise<void> {
    if (!this.#container) return

    // fetch SVG source once
    if (!this.#svgSource) {
      try {
        const resp = await fetch('/local.svg')
        this.#svgSource = await resp.text()
      } catch { return }
    }

    // replace all fill colors in the SVG with the current border color
    const colored = this.#svgSource.replace(/fill:#[0-9a-fA-F]{6}/g, `fill:${this.#borderColor}`)

    // blob → Image element (handles SVG filters/namespaces) → Pixi Texture
    const blob = new Blob([colored], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url
    try { await img.decode() } catch { URL.revokeObjectURL(url); return }
    URL.revokeObjectURL(url)
    const texture = Texture.from(img)

    // remove old frame sprite
    if (this.#hexFrame) {
      this.#container.removeChild(this.#hexFrame)
      this.#hexFrame.destroy()
      this.#hexFrame = null
    }

    this.#hexFrame = new Sprite(texture)
    this.#hexFrame.eventMode = 'none'
    // stretch SVG (346×400 integer) to exact canvas dims (346.41×400)
    this.#hexFrame.width = this.#hexWidth
    this.#hexFrame.height = this.#hexHeight
    this.#container.addChild(this.#hexFrame)
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
