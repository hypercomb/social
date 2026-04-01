// diamondcoreprocessor.com/editor/image-editor.service.ts
import { Application, Container, Graphics, Sprite, Texture, RenderTexture, Rectangle } from 'pixi.js'
import type { HexOrientation } from '../preferences/settings.js'

export class ImageEditorService extends EventTarget {

  #app: Application | null = null
  #container: Container | null = null
  #sprite: Sprite | null = null
  #hexFrame: Graphics | null = null
  #hostElement: HTMLElement | null = null
  #initialized = false

  #isDragging = false
  #dragStart = { x: 0, y: 0 }

  // ── pinch zoom state ───────────────────────────────────────────
  #pointers = new Map<number, { x: number; y: number }>()
  #isPinching = false
  #pinchStartDist = 0
  #pinchStartScale = 1

  #size = 0  // always square: editorSize × editorSize
  #borderColor = '#c8975a'
  #backgroundColor = 0xd0d0d4
  #orientation: HexOrientation = 'point-top'
  #linked = true

  // ── public state ───────────────────────────────────────────────

  get hasImage(): boolean { return this.#sprite !== null }
  get orientation(): HexOrientation { return this.#orientation }
  get linked(): boolean { return this.#linked }
  set linked(value: boolean) { this.#linked = value }

  // ── lifecycle ──────────────────────────────────────────────────

  readonly initialize = async (
    hostElement: HTMLElement,
    size: number,
    orientation: HexOrientation = 'point-top'
  ): Promise<void> => {
    if (this.#initialized) return

    this.#hostElement = hostElement
    this.#orientation = orientation
    this.#size = size

    this.#app = new Application()

    await this.#app.init({
      width: size,
      height: size,
      backgroundColor: 0xd0d0d4,
      antialias: true,
      autoDensity: true,
    })

    this.#app.stage.eventMode = 'static'
    this.#app.canvas.style.display = 'block'
    this.#app.canvas.style.width = '100%'
    this.#app.canvas.style.height = '100%'
    this.#app.canvas.style.cursor = 'auto'
    this.#app.canvas.style.touchAction = 'none'
    hostElement.appendChild(this.#app.canvas)

    this.#container = new Container()
    this.#container.eventMode = 'static'
    this.#container.hitArea = new Rectangle(0, 0, size, size)
    this.#app.stage.addChild(this.#container)

    const canvas = this.#app.canvas
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    canvas.addEventListener('pointermove', this.#onPointerMove)
    canvas.addEventListener('pointerup', this.#onPointerUp)
    canvas.addEventListener('pointercancel', this.#onPointerUp)
    canvas.addEventListener('wheel', this.#onWheel, { passive: false })

    this.#drawHexFrame()

    this.#initialized = true
    this.#emit()
  }

  readonly destroy = (): void => {
    if (!this.#initialized) return

    const canvas = this.#app?.canvas ?? null

    canvas?.removeEventListener('pointerdown', this.#onPointerDown)
    canvas?.removeEventListener('pointermove', this.#onPointerMove)
    canvas?.removeEventListener('pointerup', this.#onPointerUp)
    canvas?.removeEventListener('pointercancel', this.#onPointerUp)
    canvas?.removeEventListener('wheel', this.#onWheel)
    this.#app?.stage.removeChildren()
    this.#app?.stop()
    this.#app?.destroy()

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
    this.#isPinching = false
    this.#pointers.clear()
    this.#orientation = 'point-top'
    this.#linked = true
    this.#emit()
  }

  // ── orientation switching ────────────────────────────────────────
  // Canvas stays the same size. Only the hex frame changes.

  readonly setOrientation = async (
    orientation: HexOrientation,
    transform?: { x: number; y: number; scale: number }
  ): Promise<void> => {
    if (!this.#app || !this.#container || !this.#initialized) return
    if (orientation === this.#orientation) return

    this.#orientation = orientation

    // reposition sprite if a saved transform was provided
    if (this.#sprite && transform) {
      const half = this.#size / 2
      this.#sprite.x = transform.x + half
      this.#sprite.y = transform.y + half
      this.#sprite.scale.set(transform.scale)
    }

    // redraw hex frame for new orientation (centered in same square)
    this.#drawHexFrame()
    this.#emit()
  }

  // ── image loading ──────────────────────────────────────────────

  readonly loadImage = async (
    blob: Blob,
    transform?: { x: number; y: number; scale: number }
  ): Promise<void> => {
    if (!this.#initialized || !this.#container || !this.#app) return

    if (this.#sprite) {
      this.#container.removeChild(this.#sprite)
      this.#sprite.destroy()
      this.#sprite = null
    }

    const bitmap = await createImageBitmap(blob)
    const texture = Texture.from(bitmap)
    const half = this.#size / 2

    this.#sprite = new Sprite(texture)
    this.#sprite.anchor.set(0.5)

    if (transform) {
      this.#sprite.x = transform.x + half
      this.#sprite.y = transform.y + half
      this.#sprite.scale.set(transform.scale)
    } else {
      this.#sprite.x = half
      this.#sprite.y = half
      const scaleX = this.#size / bitmap.width
      const scaleY = this.#size / bitmap.height
      this.#sprite.scale.set(Math.max(scaleX, scaleY))
    }

    this.#container.addChildAt(this.#sprite, 0)
    this.#emit()
  }

  // ── capture ────────────────────────────────────────────────────
  // Renders the hex region (not the full square) to a WebP blob.
  // The hex is centered in the square canvas, so we offset the
  // container to crop to the hex bounding box.

  readonly captureSmall = async (
    hexWidth: number,
    hexHeight: number
  ): Promise<Blob> => {
    if (!this.#app || !this.#container) {
      throw new Error('ImageEditorService not initialized')
    }

    const renderer = this.#app.renderer
    const renderTexture = RenderTexture.create({
      width: hexWidth,
      height: hexHeight,
      resolution: 1,
      scaleMode: 'nearest',
      antialias: false,
    })

    // offset container so hex center (size/2, size/2) maps to output center
    const offsetX = hexWidth / 2 - this.#size / 2
    const offsetY = hexHeight / 2 - this.#size / 2
    this.#container.x = offsetX
    this.#container.y = offsetY

    renderer.render({
      container: this.#container,
      target: renderTexture,
      clear: true,
      clearColor: this.#backgroundColor,
    } as any)

    // restore
    this.#container.x = 0
    this.#container.y = 0

    const canvas = renderer.extract.canvas(renderTexture) as HTMLCanvasElement
    renderTexture.destroy(true)

    return await this.#canvasToBlob(canvas)
  }

  // ── transform state ────────────────────────────────────────────

  readonly getTransform = (): { x: number; y: number; scale: number } => {
    if (!this.#sprite) return { x: 0, y: 0, scale: 1 }
    const half = this.#size / 2
    return {
      x: this.#sprite.x - half,
      y: this.#sprite.y - half,
      scale: this.#sprite.scale.x,
    }
  }

  // ── hex frame border ───────────────────────────────────────────
  // Programmatic hex polygon outline centered within the square canvas.
  // Matches the branch indicator / border ring style (full hexagon stroke).

  readonly setBackgroundColor = (color: string): void => {
    if (!this.#app) return
    const parsed = color
      ? (parseInt(color.replace('#', ''), 16) || 0xd0d0d4)
      : 0xd0d0d4
    this.#backgroundColor = parsed
    this.#app.renderer.background.color = parsed
  }

  readonly setBorderColor = (color: string): void => {
    this.#borderColor = color && /^#?[0-9a-fA-F]{6}$/.test(color.replace('#', ''))
      ? (color.startsWith('#') ? color : `#${color}`)
      : '#c8975a'
    this.#drawHexFrame()
  }

  #drawHexFrame(): void {
    if (!this.#container) return

    // remove old frame graphic
    if (this.#hexFrame) {
      this.#container.removeChild(this.#hexFrame)
      this.#hexFrame.destroy()
      this.#hexFrame = null
    }

    const isFlat = this.#orientation === 'flat-top'

    // hex dimensions matching settings: point-top 346×400, flat-top 400×346
    const hexW = isFlat ? 400 : 346
    const hexH = isFlat ? 346 : 400

    // center of the hex within the square canvas
    const cx = this.#size / 2
    const cy = this.#size / 2

    const strokeWidth = 14.44

    // inset vertices by half stroke width so outer edge stays flush with hex boundary
    const inset = strokeWidth / 2
    const hw = (hexW / 2) - inset
    const hh = (hexH / 2) - inset

    // build 6 vertices
    const verts: number[] = []
    if (isFlat) {
      // flat-top hex vertices (wide horizontally)
      verts.push(cx + hw, cy)           // right
      verts.push(cx + hw / 2, cy + hh)  // bottom-right
      verts.push(cx - hw / 2, cy + hh)  // bottom-left
      verts.push(cx - hw, cy)           // left
      verts.push(cx - hw / 2, cy - hh)  // top-left
      verts.push(cx + hw / 2, cy - hh)  // top-right
    } else {
      // point-top hex vertices (tall vertically)
      verts.push(cx, cy - hh)           // top
      verts.push(cx + hw, cy - hh / 2)  // top-right
      verts.push(cx + hw, cy + hh / 2)  // bottom-right
      verts.push(cx, cy + hh)           // bottom
      verts.push(cx - hw, cy + hh / 2)  // bottom-left
      verts.push(cx - hw, cy - hh / 2)  // top-left
    }

    const color = parseInt(this.#borderColor.replace('#', ''), 16) || 0xc8975a

    this.#hexFrame = new Graphics()
    this.#hexFrame.eventMode = 'none'

    // stroke outline matching branch indicator style
    this.#hexFrame.poly(verts, true)
    this.#hexFrame.stroke({ color, alpha: 0.7, width: strokeWidth })

    this.#container.addChild(this.#hexFrame)
  }

  // ── pointer handling (drag + pinch zoom) ───────────────────────

  #clientToLocal(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.#app!.canvas
    const rect = canvas.getBoundingClientRect()
    const scaleX = this.#size / rect.width
    const scaleY = this.#size / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#sprite || !this.#app) return

    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.#pointers.size === 2) {
      // second finger → enter pinch, cancel any drag
      this.#isDragging = false
      this.#isPinching = true
      const [a, b] = [...this.#pointers.values()]
      this.#pinchStartDist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      this.#pinchStartScale = this.#sprite.scale.x
      this.#app.canvas.style.cursor = 'auto'
    } else if (this.#pointers.size === 1 && !this.#isPinching) {
      // single finger → start drag
      const local = this.#clientToLocal(e.clientX, e.clientY)
      this.#dragStart.x = local.x - this.#sprite.x
      this.#dragStart.y = local.y - this.#sprite.y
      this.#isDragging = true
      this.#app.canvas.style.cursor = 'grabbing'
    }
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#sprite || !this.#app) return
    if (!this.#pointers.has(e.pointerId)) return

    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.#isPinching && this.#pointers.size >= 2) {
      const [a, b] = [...this.#pointers.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      let newScale = (dist / this.#pinchStartDist) * this.#pinchStartScale
      newScale = Math.max(0.05, Math.min(10, newScale))
      this.#sprite.scale.set(newScale)
      this.#syncTransform()
    } else if (this.#isDragging && !this.#isPinching) {
      const local = this.#clientToLocal(e.clientX, e.clientY)
      this.#sprite.position.set(
        local.x - this.#dragStart.x,
        local.y - this.#dragStart.y,
      )
    }
  }

  #onPointerUp = (e: PointerEvent): void => {
    this.#pointers.delete(e.pointerId)

    if (this.#isPinching) {
      // end pinch — do NOT transition to drag
      if (this.#pointers.size < 2) {
        this.#isPinching = false
        this.#syncTransform()
      }
    }

    if (this.#pointers.size === 0) {
      this.#isDragging = false
      this.#isPinching = false
      if (this.#app) this.#app.canvas.style.cursor = 'auto'
      this.#syncTransform()
    }
  }

  // ── wheel zoom ────────────────────────────────────────────────

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
    const service = (window as any).ioc?.get?.('@diamondcoreprocessor.com/TileEditorService')
    if (service?.updateTransform) {
      const t = this.getTransform()
      service.updateTransform(t.x, t.y, t.scale, this.#orientation)
      if (this.#linked) {
        const other: HexOrientation = this.#orientation === 'point-top' ? 'flat-top' : 'point-top'
        service.updateTransform(t.x, t.y, t.scale, other)
      }
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
