// presentation/tiles/lift-scene.ts
//
// THE LIFT SCENE — the page's tiles lifted off the grid into 3D, with the
// page's other layers stacked behind it like a slide deck.
//
// Pixels only. What the layers ARE, how they mark, what a roll stages, is the
// deck (lift-deck.ts); when anything is written is the drone's business
// (lift-view.drone.ts). This file draws what it is handed and answers two
// questions about the drawing: which tile is under this point (`pick`), and
// where on screen does this tile stand (`project`) — the second is what lets
// the tile NAMES stay DOM text over the scene.
//
// The `three` module namespace is handed in, never imported: the drone loads
// it lazily on mount (`await import('three')`), so no other lane ever pays
// for it, and this module is readable without WebGL. Likewise the renderer is
// only ever made in `LiftScene.create`, after a WebGL probe — never at module
// scope, never in a constructor.
//
// The page reads as the 2D page first: every prism sits at its tile's true
// grid centre at its true size (the same axial → pixel numbers show-cell
// draws with), and the camera opens face-on, fitted to the front layer, then
// tilts so the stack behind it shows. Render on demand: a frame is drawn only
// when something changed or is animating, and never while the tab is hidden.

import type * as T from 'three'
import { coverFit, hexCorners, hexUv, type DeckMark } from './lift-deck.js'

type Three = typeof import('three')

/** One tile as the scene draws it. `x`/`y` are the hive's pixel centre
 *  (y down, as on the canvas). */
export interface SceneTile {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly mark: DeckMark
  readonly staged?: boolean
}

export interface SceneLayer {
  readonly tiles: readonly SceneTile[]
  /** Where the FRONT layer has a tile and this layer does not. */
  readonly ghosts: readonly { readonly name: string; readonly x: number; readonly y: number }[]
}

export interface SceneDeck {
  readonly layers: readonly SceneLayer[]
  /** Circumradius of a tile, hive pixels. */
  readonly radius: number
  readonly flat: boolean
}

export type ScenePick = { readonly layerIndex: number; readonly name: string }

export type SceneCreate =
  | { readonly ok: true; readonly scene: LiftScene }
  | { readonly ok: false; readonly reason: 'webgl' | 'renderer' }

// Saturated on purpose: the deck is the colour, and the hues are the marks.
const MARK_COLOUR: Readonly<Record<DeckMark, number>> = {
  common: 0x19c7d6,   // teal / cyan
  changed: 0xffa21f,  // amber
  partial: 0xff3d8e,  // rose / magenta
}
const STAGED_COLOUR = 0xa66bff  // violet
const GHOST_COLOUR = 0xc8d6e0

/** Prism opacity: the front layer, the first layer behind it, and the floor
 *  every deeper layer falls to and never goes below. */
const FRONT_OPACITY = 0.88
const BACK_OPACITY = 0.55
const DEEP_OPACITY = 0.35
const DEEP_FALLOFF = 0.85
/** Self-glow: the front layer, and every layer behind it. */
const FRONT_EMISSIVE = 0.35
const DEEP_EMISSIVE = 0.2
/** The rim each prism draws in its mark colour, on every layer. */
const EDGE_OPACITY = 0.6
/** How far a side wall is lifted toward white, so the lift reads as thickness. */
const WALL_LIGHTEN = 0.38
/** Distance between layers, in circumradii. */
const LAYER_GAP = 1.6
const TILT_OPEN = (50 * Math.PI) / 180
const TILT_MAX = (80 * Math.PI) / 180
const FLIP_MS = 250
const TILT_MS = 400
const FOV = 40

type TileMesh = {
  readonly name: string
  readonly group: T.Group
  readonly body: T.Mesh
  /** The top and bottom caps, in the mark colour. */
  readonly bodyMat: T.MeshStandardMaterial
  /** The side walls: the mark colour lifted toward white. */
  readonly wallMat: T.MeshStandardMaterial
  readonly edge: T.LineSegments
  readonly edgeMat: T.LineBasicMaterial
  readonly face: T.Mesh
  readonly faceMat: T.MeshBasicMaterial
  readonly halo: T.Mesh
  readonly haloMat: T.MeshBasicMaterial
  texture: T.Texture | null
  pictureToken: number
  mark: DeckMark
  staged: boolean
  hovered: boolean
}

type LayerMesh = {
  readonly group: T.Group
  readonly tiles: Map<string, TileMesh>
  readonly ghostMat: T.LineBasicMaterial
  opacity: number
}

type Tween = { from: number; to: number; start: number; duration: number }

const ease = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

const reducedMotion = (): boolean => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export class LiftScene {
  readonly #three: Three
  readonly #host: HTMLElement
  readonly #canvas: HTMLCanvasElement
  readonly #renderer: T.WebGLRenderer
  readonly #scene: T.Scene
  readonly #camera: T.PerspectiveCamera
  readonly #raycaster: T.Raycaster
  readonly #loader: T.TextureLoader

  #layers: LayerMesh[] = []
  #geometries: T.BufferGeometry[] = []
  #radius = 32
  #flat = false
  #thickness = 6

  #target: T.Vector3
  #distance = 1000
  #fitDistance = 1000
  #tilt = 0
  #azimuth = 0
  #flip = 0
  #flipTarget = 0
  #flipTween: Tween | null = null
  #tiltTween: Tween | null = null
  #hover: ScenePick | null = null
  /** Once the participant pans, zooms or turns, a resize stops refitting. */
  #userMoved = false

  #raf = 0
  #disposed = false
  /** The CSS size last handed to the renderer. Camera aspect, the label
   *  projection, pan and the on-screen radius all read THESE numbers, so
   *  nothing can disagree with what was drawn. */
  #width = 1
  #height = 1
  #pixelRatio = 1
  readonly #observer: ResizeObserver | null

  /** Called after every drawn frame — the drone places the DOM names here. */
  onFrame: (() => void) | null = null

  /** Probe WebGL, then make the renderer. Nothing GPU-side exists before
   *  this is called, and a failed probe makes nothing at all. */
  static create(three: Three, host: HTMLElement): SceneCreate {
    const canvas = document.createElement('canvas')
    const attributes = { alpha: true, antialias: true, premultipliedAlpha: true }
    // three r163+ draws with WebGL2 only; older builds still accept WebGL1.
    const revision = Number.parseInt(String((three as { REVISION?: string }).REVISION ?? '0'), 10)
    let context: WebGLRenderingContext | WebGL2RenderingContext | null = null
    try {
      context = (canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null)
        ?? (revision >= 163 ? null : canvas.getContext('webgl', attributes) as WebGLRenderingContext | null)
    } catch { context = null }
    if (!context) return { ok: false, reason: 'webgl' }
    let renderer: T.WebGLRenderer
    try {
      renderer = new three.WebGLRenderer({ canvas, context: context as WebGLRenderingContext, alpha: true, antialias: true })
    } catch {
      return { ok: false, reason: 'renderer' }
    }
    return { ok: true, scene: new LiftScene(three, host, canvas, renderer) }
  }

  constructor(three: Three, host: HTMLElement, canvas: HTMLCanvasElement, renderer: T.WebGLRenderer) {
    this.#three = three
    this.#host = host
    this.#canvas = canvas
    this.#renderer = renderer
    renderer.setClearColor(0x000000, 0)
    renderer.setScissorTest(false)
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;'
    host.appendChild(canvas)

    this.#scene = new three.Scene()
    this.#camera = new three.PerspectiveCamera(FOV, 1, 1, 10000)
    this.#raycaster = new three.Raycaster()
    this.#loader = new three.TextureLoader()
    this.#target = new three.Vector3()

    this.#scene.add(new three.AmbientLight(0xffffff, 0.9))
    this.#scene.add(new three.HemisphereLight(0xe6f6ff, 0x3a2a4a, 0.8))
    const sun = new three.DirectionalLight(0xffffff, 1.0)
    sun.position.set(0.45, 0.8, 1.2)
    this.#scene.add(sun)

    document.addEventListener('visibilitychange', this.#onVisibility)
    window.addEventListener('resize', this.#onWindowResize)
    // Size once now (the canvas is in the DOM), on every observer callback
    // after, and once more after the next layout in case this ran before it.
    this.resize()
    this.#observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null
    this.#observer?.observe(host)
    requestAnimationFrame(() => { if (!this.#disposed) this.resize() })
  }

  // ── deck ─────────────────────────────────────────────────────────────

  /** Rebuild every mesh for a new deck. Pictures are handed in afterwards
   *  (`setPicture`) — they arrive asynchronously, the shape does not wait. */
  setDeck(deck: SceneDeck): void {
    this.#clearMeshes()
    const three = this.#three
    this.#radius = deck.radius > 0 ? deck.radius : 32
    this.#flat = deck.flat
    const r = this.#radius
    this.#thickness = r * 0.18

    const body = new three.CylinderGeometry(r, r, this.#thickness, 6, 1)
    body.rotateX(Math.PI / 2)                 // prism axis along the camera's depth
    if (this.#flat) body.rotateZ(Math.PI / 6) // a corner right, an edge on top
    const face = this.#hexShape(r)
    face.translate(0, 0, this.#thickness / 2 + r * 0.01)
    const halo = this.#hexShape(r * 1.14)
    halo.translate(0, 0, -this.#thickness / 2 - r * 0.02)
    const edges = new three.EdgesGeometry(body)
    this.#geometries = [body, face, halo, edges]

    this.#layers = deck.layers.map((layer, layerIndex) => {
      const group = new three.Group()
      const tiles = new Map<string, TileMesh>()
      for (const tile of layer.tiles) {
        const tileMesh = this.#tile(tile, layerIndex, body, face, halo, edges)
        group.add(tileMesh.group)
        tiles.set(tile.name, tileMesh)
      }
      const ghostMat = new three.LineBasicMaterial({ color: GHOST_COLOUR, transparent: true, opacity: 0.28, depthWrite: false })
      for (const ghost of layer.ghosts) {
        const line = new three.LineSegments(edges, ghostMat)
        line.position.set(ghost.x, -ghost.y, 0)
        group.add(line)
      }
      this.#scene.add(group)
      return { group, tiles, ghostMat, opacity: 1 }
    })
    this.#flip = Math.min(this.#flip, Math.max(0, this.#layers.length - 1))
    this.#flipTarget = Math.min(this.#flipTarget, Math.max(0, this.#layers.length - 1))
    this.#hover = null
    this.#request()
  }

  get layerCount(): number { return this.#layers.length }
  /** The layer at the front, or flying there. */
  get flip(): number { return this.#flipTarget }

  /** The tile's picture (an object URL the caller owns), or null to clear it.
   *  The hex capture lands across the top face exactly as the 2D grid draws
   *  it — its framing is already baked into its pixels. */
  setPicture(layerIndex: number, name: string, url: string | null): Promise<boolean> {
    const tile = this.#layers[layerIndex]?.tiles.get(name)
    if (!tile) return Promise.resolve(false)
    const token = ++tile.pictureToken
    if (!url) {
      this.#dropTexture(tile)
      this.#request()
      return Promise.resolve(true)
    }
    return new Promise<boolean>(resolve => this.#loader.load(url, texture => {
      if (this.#disposed || tile.pictureToken !== token || this.#layers[layerIndex]?.tiles.get(name) !== tile) {
        texture.dispose()
        resolve(true)   // superseded, not failed
        return
      }
      const three = this.#three as Three & { SRGBColorSpace?: string }
      if (three.SRGBColorSpace && 'colorSpace' in texture) {
        (texture as { colorSpace: string }).colorSpace = three.SRGBColorSpace
      }
      const image = texture.image as { width?: number; height?: number } | undefined
      const fit = coverFit((image?.width ?? 0) / (image?.height || 1), this.#radius, this.#flat)
      texture.repeat.set(fit.repeat.u, fit.repeat.v)
      texture.offset.set(fit.offset.u, fit.offset.v)
      this.#dropTexture(tile)
      tile.texture = texture
      tile.faceMat.map = texture
      tile.faceMat.needsUpdate = true
      tile.face.visible = true
      this.#request()
      resolve(true)
    }, undefined, () => resolve(false)))   // undecodable: the caller tries the next candidate
  }

  /** Recolour one tile — a staged part wears the accent. */
  setTileState(layerIndex: number, name: string, state: { mark?: DeckMark; staged?: boolean }): void {
    const tile = this.#layers[layerIndex]?.tiles.get(name)
    if (!tile) return
    if (state.mark) tile.mark = state.mark
    if (state.staged !== undefined) tile.staged = state.staged
    this.#paintTile(tile)
    this.#request()
  }

  setHover(pick: ScenePick | null): void {
    const same = pick && this.#hover && pick.layerIndex === this.#hover.layerIndex && pick.name === this.#hover.name
    if (same || (!pick && !this.#hover)) return
    const before = this.#hover
    this.#hover = pick
    if (before) {
      const tile = this.#layers[before.layerIndex]?.tiles.get(before.name)
      if (tile) { tile.hovered = false; this.#paintTile(tile) }
    }
    if (pick) {
      const tile = this.#layers[pick.layerIndex]?.tiles.get(pick.name)
      if (tile) { tile.hovered = true; this.#paintTile(tile) }
    }
    this.#request()
  }

  /** Bring layer `index` to the front — the deck deals the ones before it
   *  off toward you and the chosen one settles where the page was. */
  flipTo(index: number): void {
    const clamped = Math.min(Math.max(0, this.#layers.length - 1), Math.max(0, Math.round(index)))
    if (clamped === this.#flipTarget && !this.#flipTween) return
    this.#flipTarget = clamped
    this.#flipTween = { from: this.#flip, to: clamped, start: performance.now(), duration: reducedMotion() ? 0 : FLIP_MS }
    this.#request()
  }

  // ── camera ───────────────────────────────────────────────────────────

  /** Face-on, fitted to the front layer — the page as it was — then the
   *  tilt that shows the stack. */
  open(): void {
    this.#userMoved = false
    this.fit()
    this.#tilt = 0
    this.#azimuth = 0
    this.#tiltTween = { from: 0, to: TILT_OPEN, start: performance.now() + (reducedMotion() ? 0 : 120), duration: reducedMotion() ? 0 : TILT_MS }
    this.#request()
  }

  /** Centre on the front layer and fit it to the viewport. */
  fit(): void {
    const three = this.#three
    const box = new three.Box2()
    const front = this.#layers[0]?.tiles.size
      ? [...this.#layers[0]!.tiles.values()]
      : this.#layers.flatMap(l => [...l.tiles.values()])
    for (const tile of front) box.expandByPoint(new three.Vector2(tile.group.position.x, tile.group.position.y))
    const r = this.#radius
    if (box.isEmpty()) box.set(new three.Vector2(-r, -r), new three.Vector2(r, r))
    const width = box.max.x - box.min.x + r * 2.4
    const height = box.max.y - box.min.y + r * 2.4
    this.#target.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0)
    const half = Math.tan((FOV * Math.PI) / 360)
    const aspect = this.#camera.aspect || 1
    this.#fitDistance = Math.max(height / 2 / half, width / 2 / (half * aspect), r * 4)
    this.#distance = this.#fitDistance
    this.#request()
  }

  /** Move the page under the pointer by a screen delta (px). */
  pan(dx: number, dy: number): void {
    const height = this.#height
    const perPx = (2 * this.#distance * Math.tan((FOV * Math.PI) / 360)) / height
    const three = this.#three
    this.#camera.updateMatrixWorld()
    const right = new three.Vector3().setFromMatrixColumn(this.#camera.matrixWorld, 0)
    const up = new three.Vector3().setFromMatrixColumn(this.#camera.matrixWorld, 1)
    this.#target.addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx)
    this.#userMoved = true
    this.#request()
  }

  /** Zoom by `factor` (< 1 = closer), holding the point under the pointer. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return
    const next = Math.min(this.#fitDistance * 6, Math.max(this.#radius * 2.5, this.#distance * factor))
    const applied = next / this.#distance
    const point = this.#planePoint(clientX, clientY)
    if (point) this.#target.lerp(point, 1 - applied)
    this.#distance = next
    this.#userMoved = true
    this.#request()
  }

  /** Orbit: horizontal turns the deck, vertical tilts it. */
  orbit(dx: number, dy: number): void {
    this.#tiltTween = null
    this.#userMoved = true
    this.#azimuth = Math.max(-1.2, Math.min(1.2, this.#azimuth + dx * 0.005))
    this.#tilt = Math.max(0, Math.min(TILT_MAX, this.#tilt + dy * 0.005))
    this.#request()
  }

  tiltBy(radians: number): void {
    this.#tiltTween = null
    this.#tilt = Math.max(0, Math.min(TILT_MAX, this.#tilt + radians))
    this.#request()
  }

  // ── questions about the drawing ──────────────────────────────────────

  /** The tile under a client point, frontmost first; null over empty space.
   *  A layer dealt off (or faded nearly out) is not pickable. */
  pick(clientX: number, clientY: number): ScenePick | null {
    const ndc = this.#ndc(clientX, clientY)
    if (!ndc) return null
    this.#raycaster.setFromCamera(ndc, this.#camera)
    const bodies: T.Object3D[] = []
    this.#layers.forEach(layer => {
      if (!layer.group.visible || layer.opacity < 0.08) return
      for (const tile of layer.tiles.values()) bodies.push(tile.body)
    })
    const hit = this.#raycaster.intersectObjects(bodies, false)[0]
    const data = hit?.object.userData as { layerIndex?: number; name?: string } | undefined
    return data && typeof data.layerIndex === 'number' && typeof data.name === 'string'
      ? { layerIndex: data.layerIndex, name: data.name }
      : null
  }

  /** Where a tile's top face stands on screen, relative to the host. */
  project(layerIndex: number, name: string): { x: number; y: number; visible: boolean } | null {
    const layer = this.#layers[layerIndex]
    const tile = layer?.tiles.get(name)
    if (!layer || !tile) return null
    const point = new this.#three.Vector3(0, 0, this.#thickness / 2)
    tile.group.localToWorld(point)
    point.project(this.#camera)
    const width = this.#width
    const height = this.#height
    const x = (point.x + 1) / 2 * width
    const y = (1 - point.y) / 2 * height
    const visible = layer.group.visible && layer.opacity > 0.08
      && point.z > -1 && point.z < 1 && x >= -40 && y >= -20 && x <= width + 40 && y <= height + 20
    return { x, y, visible }
  }

  /** On-screen size of one circumradius at the front plane, px — the names
   *  scale with the page the way the 2D labels do. */
  radiusOnScreen(): number {
    const height = this.#height
    return (this.#radius * height) / (2 * this.#distance * Math.tan((FOV * Math.PI) / 360))
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  /** Match the drawing buffer, the viewport and the camera to the host's CSS
   *  size, then draw at once — never leave a frame drawn at a stale size
   *  waiting on an animation frame a background tab may never deliver. */
  resize(): void {
    if (this.#disposed) return
    const width = Math.max(1, this.#host.clientWidth)
    const height = Math.max(1, this.#host.clientHeight)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    if (width === this.#width && height === this.#height && ratio === this.#pixelRatio) return
    this.#width = width
    this.#height = height
    this.#pixelRatio = ratio
    this.#renderer.setPixelRatio(ratio)
    this.#renderer.setSize(width, height, false)
    this.#renderer.setViewport(0, 0, width, height)
    this.#camera.aspect = width / height
    this.#camera.updateProjectionMatrix()
    if (!this.#userMoved && this.#layers.length) this.fit()
    this.#canvas.dataset['renderSize'] = `${width}x${height}@${ratio}`
    this.#draw(performance.now())
  }

  /** The renderer's own idea of its size (CSS px) and pixel ratio. */
  get renderSize(): { width: number; height: number; pixelRatio: number } {
    const size = this.#renderer.getSize(new this.#three.Vector2())
    return { width: size.x, height: size.y, pixelRatio: this.#renderer.getPixelRatio() }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    document.removeEventListener('visibilitychange', this.#onVisibility)
    window.removeEventListener('resize', this.#onWindowResize)
    this.#observer?.disconnect()
    this.#clearMeshes()
    this.onFrame = null
    try { this.#renderer.dispose() } catch { /* already gone */ }
    try { this.#renderer.forceContextLoss() } catch { /* not supported */ }
    this.#canvas.remove()
  }

  // ── internals ────────────────────────────────────────────────────────

  /** A hexagon face whose UVs map the hex box onto the unit square — the box
   *  the hive's hex capture is taken at. */
  #hexShape(radius: number): T.ShapeGeometry {
    const three = this.#three
    const corners = hexCorners(radius, this.#flat)
    const shape = new three.Shape()
    corners.forEach((c, i) => (i === 0 ? shape.moveTo(c.x, c.y) : shape.lineTo(c.x, c.y)))
    shape.closePath()
    const geometry = new three.ShapeGeometry(shape)
    const position = geometry.getAttribute('position')
    const uv: number[] = []
    for (let i = 0; i < position.count; i++) {
      const { u, v } = hexUv(position.getX(i), position.getY(i), radius, this.#flat)
      uv.push(u, v)
    }
    geometry.setAttribute('uv', new three.Float32BufferAttribute(uv, 2))
    return geometry
  }

  #tile(
    tile: SceneTile, layerIndex: number,
    body: T.BufferGeometry, face: T.BufferGeometry, halo: T.BufferGeometry, edges: T.BufferGeometry,
  ): TileMesh {
    const three = this.#three
    const group = new three.Group()
    group.position.set(tile.x, -tile.y, 0)
    const lit = { roughness: 0.45, metalness: 0.05, transparent: true, opacity: FRONT_OPACITY }
    const bodyMat = new three.MeshStandardMaterial({ ...lit, emissiveIntensity: FRONT_EMISSIVE })
    const wallMat = new three.MeshStandardMaterial({ ...lit, emissiveIntensity: FRONT_EMISSIVE })
    // CylinderGeometry groups: 0 = the side walls, 1 = top cap, 2 = bottom cap.
    const bodyMesh = new three.Mesh(body, [wallMat, bodyMat, bodyMat])
    bodyMesh.userData = { layerIndex, name: tile.name }
    const edgeMat = new three.LineBasicMaterial({ transparent: true, opacity: EDGE_OPACITY, depthWrite: false })
    const edgeLine = new three.LineSegments(edges, edgeMat)
    // The picture is a photo, not a tinted surface: unlit, not tone-mapped,
    // full strength. The mark colour lives only in the walls, rim and glow.
    const faceMat = new three.MeshBasicMaterial({ transparent: true, opacity: 1, side: three.DoubleSide, toneMapped: false })
    const faceMesh = new three.Mesh(face, faceMat)
    faceMesh.visible = false
    const haloMat = new three.MeshBasicMaterial({
      transparent: true, opacity: 0.28, blending: three.AdditiveBlending, depthWrite: false, toneMapped: false,
    })
    const haloMesh = new three.Mesh(halo, haloMat)
    group.add(haloMesh, bodyMesh, edgeLine, faceMesh)
    const made: TileMesh = {
      name: tile.name, group, body: bodyMesh, bodyMat, wallMat, edge: edgeLine, edgeMat,
      face: faceMesh, faceMat, halo: haloMesh, haloMat,
      texture: null, pictureToken: 0, mark: tile.mark, staged: tile.staged === true, hovered: false,
    }
    this.#paintTile(made)
    return made
  }

  /** Colour from the mark (or the staged accent). Glow strength belongs to
   *  the layer and is applied per frame in #applyDeck. */
  #paintTile(tile: TileMesh): void {
    const three = this.#three
    const colour = tile.staged ? STAGED_COLOUR : MARK_COLOUR[tile.mark]
    tile.bodyMat.color.setHex(colour)
    tile.bodyMat.emissive.setHex(colour)
    tile.wallMat.color.setHex(colour).lerp(new three.Color(0xffffff), WALL_LIGHTEN)
    tile.wallMat.emissive.setHex(colour)
    tile.edgeMat.color.setHex(colour)
    tile.haloMat.color.setHex(colour)
    tile.group.position.z = tile.hovered ? this.#thickness * 0.8 : 0
  }

  #dropTexture(tile: TileMesh): void {
    if (tile.texture) tile.texture.dispose()
    tile.texture = null
    tile.faceMat.map = null
    tile.faceMat.needsUpdate = true
    tile.face.visible = false
  }

  #clearMeshes(): void {
    for (const layer of this.#layers) {
      for (const tile of layer.tiles.values()) {
        tile.texture?.dispose()
        tile.bodyMat.dispose()
        tile.wallMat.dispose()
        tile.edgeMat.dispose()
        tile.faceMat.dispose()
        tile.haloMat.dispose()
      }
      layer.ghostMat.dispose()
      this.#scene.remove(layer.group)
    }
    for (const geometry of this.#geometries) geometry.dispose()
    this.#geometries = []
    this.#layers = []
  }

  /** Depth and opacity per layer from the (animated) flip position. A layer
   *  in front of the chosen one is dealt off toward the viewer and fades. */
  #applyDeck(): void {
    const gap = this.#radius * LAYER_GAP
    this.#layers.forEach((layer, index) => {
      const depth = index - this.#flip
      let z: number
      let opacity: number
      let glow: number
      // 0..1: how present the layer still is, for the dealt-off fade.
      let presence = 1
      if (depth >= 0) {
        z = -depth * gap
        if (depth < 1) {
          opacity = FRONT_OPACITY + (BACK_OPACITY - FRONT_OPACITY) * depth
          glow = FRONT_EMISSIVE + (DEEP_EMISSIVE - FRONT_EMISSIVE) * depth
        } else {
          opacity = Math.max(DEEP_OPACITY, BACK_OPACITY * Math.pow(DEEP_FALLOFF, depth - 1))
          glow = DEEP_EMISSIVE
        }
      } else {
        z = -depth * gap * 0.8
        presence = Math.max(0, 1 + depth)
        opacity = FRONT_OPACITY * presence
        glow = FRONT_EMISSIVE
      }
      layer.opacity = opacity
      layer.group.position.z = z
      layer.group.visible = opacity > 0.01
      // The picture stays full strength at the front and thins with its
      // prism behind it. It is never tinted.
      const faceOpacity = depth >= 0 ? Math.min(1, opacity / FRONT_OPACITY) : presence
      const haloOpacity = (depth >= 0 && depth < 1 ? 0.28 - 0.12 * depth : 0.16) * presence
      for (const tile of layer.tiles.values()) {
        const tileGlow = glow + (tile.hovered ? 0.3 : 0) + (tile.staged ? 0.1 : 0)
        tile.bodyMat.opacity = opacity
        tile.wallMat.opacity = opacity
        tile.bodyMat.emissiveIntensity = tileGlow
        tile.wallMat.emissiveIntensity = tileGlow
        tile.edgeMat.opacity = EDGE_OPACITY * presence
        tile.faceMat.opacity = faceOpacity
        tile.haloMat.opacity = haloOpacity
        // Back to front: deeper layers draw first, and inside a tile the
        // halo, then the prism and its rim, then its picture.
        tile.halo.renderOrder = -index * 4
        tile.body.renderOrder = -index * 4 + 1
        tile.edge.renderOrder = -index * 4 + 2
        tile.face.renderOrder = -index * 4 + 3
      }
      layer.ghostMat.opacity = 0.32 * Math.max(0.35, presence)
    })
  }

  #updateCamera(): void {
    const d = this.#distance
    const offset = new this.#three.Vector3(
      d * Math.sin(this.#tilt) * Math.sin(this.#azimuth),
      -d * Math.sin(this.#tilt) * Math.cos(this.#azimuth),
      d * Math.cos(this.#tilt),
    )
    this.#camera.position.copy(this.#target).add(offset)
    this.#camera.up.set(0, 1, 0)
    this.#camera.lookAt(this.#target)
    const depth = this.#radius * LAYER_GAP * (this.#layers.length + 2)
    this.#camera.near = Math.max(0.5, d * 0.02)
    this.#camera.far = d * 4 + depth * 2
    this.#camera.updateProjectionMatrix()
  }

  /** Advance the tweens; true while anything is still moving. */
  #step(now: number): boolean {
    let moving = false
    if (this.#flipTween) {
      const t = this.#flipTween
      const k = t.duration <= 0 ? 1 : (now - t.start) / t.duration
      this.#flip = t.from + (t.to - t.from) * ease(k)
      if (k >= 1) { this.#flip = t.to; this.#flipTween = null } else moving = true
    }
    if (this.#tiltTween) {
      const t = this.#tiltTween
      const k = t.duration <= 0 ? 1 : (now - t.start) / t.duration
      if (k > 0) this.#tilt = t.from + (t.to - t.from) * ease(k)
      if (k >= 1) { this.#tilt = t.to; this.#tiltTween = null } else moving = true
    }
    return moving
  }

  #request(): void {
    if (this.#disposed || this.#raf) return
    if (typeof document !== 'undefined' && document.hidden) return
    this.#raf = requestAnimationFrame(this.#frame)
  }

  readonly #frame = (now: number): void => {
    this.#raf = 0
    if (this.#disposed) return
    // A size change that slipped past the observer is caught here, before
    // anything is drawn at the old numbers.
    if (Math.max(1, this.#host.clientWidth) !== this.#width || Math.max(1, this.#host.clientHeight) !== this.#height) {
      this.resize()
      return
    }
    this.#draw(now)
  }

  #draw(now: number): void {
    const moving = this.#step(now)
    this.#applyDeck()
    this.#updateCamera()
    this.#renderer.render(this.#scene, this.#camera)
    try { this.onFrame?.() } catch (error) { console.error('[lift-scene] frame listener threw:', error) }
    if (moving) this.#request()
  }

  readonly #onWindowResize = (): void => { this.resize() }

  readonly #onVisibility = (): void => {
    if (!document.hidden) this.#request()
  }

  #ndc(clientX: number, clientY: number): T.Vector2 | null {
    const rect = this.#canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return new this.#three.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
  }

  /** The point under the pointer on the front plane (z = 0). */
  #planePoint(clientX: number, clientY: number): T.Vector3 | null {
    const ndc = this.#ndc(clientX, clientY)
    if (!ndc) return null
    this.#updateCamera()
    this.#camera.updateMatrixWorld()
    this.#raycaster.setFromCamera(ndc, this.#camera)
    const plane = new this.#three.Plane(new this.#three.Vector3(0, 0, 1), 0)
    const out = new this.#three.Vector3()
    return this.#raycaster.ray.intersectPlane(plane, out)
  }
}
