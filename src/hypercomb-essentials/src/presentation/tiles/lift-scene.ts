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
// The renderer is Pixi's own 3D (`@pixi/3d`), on a Pixi application this view
// owns. The `@pixi/3d` module namespace is handed in, never imported: the
// drone loads it lazily on mount (`await import('@pixi/3d')`), so no other
// lane ever pays for it. That is also why the scene has an application of its
// own and does not sit on the hive's stage: `@pixi/3d` joins a renderer when
// the renderer is MADE (it registers a backend loader Pixi runs in
// `autoDetectRenderer`), and the hive's renderer exists long before this view
// is opened. The application is only ever made in `LiftScene.create`, after a
// WebGL probe — never at module scope, never in a constructor.
//
// The page reads as the 2D page first: every prism sits at its tile's true
// grid centre at its true size (the same axial → pixel numbers show-cell
// draws with), and the camera opens face-on, fitted to the front layer, then
// tilts so the stack behind it shows. Render on demand: a frame is drawn only
// when something changed or is animating, and never while the tab is hidden.

import * as PIXI from 'pixi.js'
import { Application, ImageSource, Matrix, Texture } from 'pixi.js'
import type * as P from '@pixi/3d'
import { coverFit, hexCorners, hexUv, type DeckMark } from './lift-deck.js'
import { bridgeNoEvalPixi } from './pixi3d-no-eval.js'

type Pixi3D = typeof import('@pixi/3d')

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
const HALF_FOV_TAN = Math.tan((FOV * Math.PI) / 360)

type TileMesh = {
  readonly name: string
  readonly group: P.Container3D
  /** The top and bottom caps, in the mark colour. */
  readonly caps: P.Mesh3D
  readonly capMat: P.Material3D
  /** The side walls: the mark colour lifted toward white. */
  readonly walls: P.Mesh3D
  readonly wallMat: P.Material3D
  readonly edgeMat: P.FlatMaterial
  readonly face: P.Mesh3D
  readonly faceMat: P.FlatMaterial
  readonly haloMat: P.FlatMaterial
  texture: Texture | null
  pictureToken: number
  mark: DeckMark
  staged: boolean
  hovered: boolean
}

type LayerMesh = {
  readonly group: P.Container3D
  readonly tiles: Map<string, TileMesh>
  readonly ghostMat: P.FlatMaterial
  opacity: number
  z: number
}

type Tween = { from: number; to: number; start: number; duration: number }

const ease = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

const reducedMotion = (): boolean => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** Assign only on change: every material setter uploads. */
const setAlpha = (material: P.BaseMaterial3D, alpha: number): void => {
  if (material.alpha !== alpha) material.alpha = alpha
}

export class LiftScene {
  readonly #lib: Pixi3D
  readonly #host: HTMLElement
  readonly #app: Application
  readonly #canvas: HTMLCanvasElement
  readonly #view: P.View3D
  /** Everything the deck draws. `view.root` also holds the camera and the
   *  lights, so it is never cleared — this is. */
  readonly #content: P.Container3D

  #layers: LayerMesh[] = []
  #geometries: P.Geometry3D[] = []
  /** The tile a struck node belongs to. */
  readonly #owner = new Map<P.Container3D, ScenePick>()
  #radius = 32
  #flat = false
  #thickness = 6

  #target = { x: 0, y: 0, z: 0 }
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

  /** Probe WebGL, then make the application. Nothing GPU-side exists before
   *  this is called, and a failed probe makes nothing at all. */
  static async create(lib: Pixi3D, host: HTMLElement): Promise<SceneCreate> {
    // Pixi's 3D draws with WebGL2 (or WebGPU); there is no WebGL1 path.
    let probe: WebGL2RenderingContext | null = null
    try { probe = document.createElement('canvas').getContext('webgl2') } catch { probe = null }
    if (!probe) return { ok: false, reason: 'webgl' }
    // A Pixi that may not eval needs the 3D package's uniform parsers as
    // functions before the first draw (pixi3d-no-eval.ts). One it does not
    // know means a frame would throw: decline instead.
    if (bridgeNoEvalPixi(PIXI) === 'unknown-parser') {
      console.warn('[lift-scene] this Pixi cannot eval, and @pixi/3d brought a uniform parser the bridge does not know')
      return { ok: false, reason: 'renderer' }
    }
    try { probe.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* not supported */ }

    const app = new Application()
    try {
      await app.init({
        preference: 'webgl',
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
        antialias: true,
        backgroundAlpha: 0,
        // Render on demand: this scene draws its own frames.
        autoStart: false,
        sharedTicker: false,
      })
    } catch (error) {
      console.warn('[lift-scene] the renderer could not be made:', error)
      try { app.destroy(true) } catch { /* never initialised */ }
      return { ok: false, reason: 'renderer' }
    }
    try {
      return { ok: true, scene: new LiftScene(lib, host, app) }
    } catch (error) {
      console.warn('[lift-scene] the 3D view could not be made:', error)
      try { app.destroy(true, { children: true }) } catch { /* already gone */ }
      return { ok: false, reason: 'renderer' }
    }
  }

  constructor(lib: Pixi3D, host: HTMLElement, app: Application) {
    this.#lib = lib
    this.#host = host
    this.#app = app
    this.#canvas = app.canvas
    this.#canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;'
    host.appendChild(this.#canvas)

    // A hemisphere fill is not divided by pi here, and a direct light is.
    this.#view = new lib.View3D({
      autoResize: true,
      environment: { skyColor: 0xe6f6ff, groundColor: 0x3a2a4a, intensity: 0.8 / Math.PI },
    })
    app.stage.addChild(this.#view)
    this.#view.camera.fov = FOV
    this.#view.camera.near = 1
    this.#view.camera.far = 10000

    this.#view.root.addChild(new lib.AmbientLight({ color: 0xffffff, intensity: 0.9 }))
    const sun = new lib.DirectionalLight({ color: 0xffffff, intensity: 1.0, position: { x: 0.45, y: 0.8, z: 1.2 } })
    sun.lookAt({ x: 0, y: 0, z: 0 })   // a light shines down its own -Z: aim it at the page
    this.#view.root.addChild(sun)
    this.#content = new lib.Container3D()
    this.#view.root.addChild(this.#content)

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
    const lib = this.#lib
    this.#radius = deck.radius > 0 ? deck.radius : 32
    this.#flat = deck.flat
    const r = this.#radius
    this.#thickness = r * 0.18

    const shapes = {
      caps: this.#capsGeometry(r),
      walls: this.#wallsGeometry(r),
      face: this.#hexGeometry(r, true),
      halo: this.#hexGeometry(r * 1.14, false),
      edges: this.#edgesGeometry(r),
    }
    this.#geometries = Object.values(shapes)

    this.#layers = deck.layers.map((layer, layerIndex) => {
      const group = new lib.Container3D()
      const tiles = new Map<string, TileMesh>()
      for (const tile of layer.tiles) {
        const tileMesh = this.#tile(tile, layerIndex, shapes)
        group.addChild(tileMesh.group)
        tiles.set(tile.name, tileMesh)
      }
      const ghostMat = new lib.FlatMaterial({ baseColor: GHOST_COLOUR, alphaMode: 'blend', alpha: 0.28 })
      for (const ghost of layer.ghosts) {
        const line = new lib.Mesh3D({
          geometry: shapes.edges, material: ghostMat,
          position: { x: ghost.x, y: -ghost.y, z: 0 },
          castShadow: false, receiveShadow: false,
        })
        line.eventMode = 'none'
        group.addChild(line)
      }
      this.#content.addChild(group)
      return { group, tiles, ghostMat, opacity: 1, z: 0 }
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
  async setPicture(layerIndex: number, name: string, url: string | null): Promise<boolean> {
    const tile = this.#layers[layerIndex]?.tiles.get(name)
    if (!tile) return false
    const token = ++tile.pictureToken
    if (!url) {
      this.#dropTexture(tile)
      this.#request()
      return true
    }
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(await (await fetch(url)).blob())
    } catch {
      return false   // undecodable: the caller tries the next candidate
    }
    if (this.#disposed || tile.pictureToken !== token || this.#layers[layerIndex]?.tiles.get(name) !== tile) {
      bitmap.close()
      return true   // superseded, not failed
    }
    const texture = new Texture({ source: new ImageSource({ resource: bitmap }) })
    // Images upload top row first, and the hex box's v runs up: the transform
    // carries the cover-fit and the flip in one matrix.
    const fit = coverFit(bitmap.width / (bitmap.height || 1), this.#radius, this.#flat)
    this.#dropTexture(tile)
    tile.texture = texture
    tile.faceMat.textures['baseColor'] = texture
    tile.faceMat.uvTransform = new Matrix(fit.repeat.u, 0, 0, -fit.repeat.v, fit.offset.u, 1 - fit.offset.v)
    tile.face.visible = true
    this.#request()
    return true
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
    const front = this.#layers[0]?.tiles.size
      ? [...this.#layers[0]!.tiles.values()]
      : this.#layers.flatMap(l => [...l.tiles.values()])
    const r = this.#radius
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const tile of front) {
      const { x, y } = tile.group.position
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    if (!front.length) { minX = -r; minY = -r; maxX = r; maxY = r }
    const width = maxX - minX + r * 2.4
    const height = maxY - minY + r * 2.4
    this.#target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: 0 }
    const aspect = this.#width / this.#height || 1
    this.#fitDistance = Math.max(height / 2 / HALF_FOV_TAN, width / 2 / (HALF_FOV_TAN * aspect), r * 4)
    this.#distance = this.#fitDistance
    this.#request()
  }

  /** Move the page under the pointer by a screen delta (px). */
  pan(dx: number, dy: number): void {
    const perPx = (2 * this.#distance * HALF_FOV_TAN) / this.#height
    const { right, up } = this.#basis()
    const t = this.#target
    this.#target = {
      x: t.x - right.x * dx * perPx + up.x * dy * perPx,
      y: t.y - right.y * dx * perPx + up.y * dy * perPx,
      z: t.z - right.z * dx * perPx + up.z * dy * perPx,
    }
    this.#userMoved = true
    this.#request()
  }

  /** Zoom by `factor` (< 1 = closer), holding the point under the pointer. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return
    const next = Math.min(this.#fitDistance * 6, Math.max(this.#radius * 2.5, this.#distance * factor))
    const applied = next / this.#distance
    const point = this.#planePoint(clientX, clientY)
    if (point) {
      const k = 1 - applied
      const t = this.#target
      this.#target = { x: t.x + (point.x - t.x) * k, y: t.y + (point.y - t.y) * k, z: t.z + (point.z - t.z) * k }
    }
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
    const point = this.#local(clientX, clientY)
    if (!point) return null
    let node: P.Container3D | null = this.#view.raycast(point)?.target ?? null
    while (node) {
      const pick = this.#owner.get(node)
      if (pick) return pick
      node = node.parent
    }
    return null
  }

  /** Where a tile's top face stands on screen, relative to the host. */
  project(layerIndex: number, name: string): { x: number; y: number; visible: boolean } | null {
    const layer = this.#layers[layerIndex]
    const tile = layer?.tiles.get(name)
    if (!layer || !tile) return null
    // No node in the deck is turned, so a tile's world place is a plain sum.
    const { x, y, z } = tile.group.position
    const at = this.#view.worldToScreen({ x, y, z: layer.z + z + this.#thickness / 2 })
    if (!at) return { x: 0, y: 0, visible: false }   // behind the camera
    const width = this.#width
    const height = this.#height
    const visible = layer.group.visible && layer.opacity > 0.08
      && at.x >= -40 && at.y >= -20 && at.x <= width + 40 && at.y <= height + 20
    return { x: at.x, y: at.y, visible }
  }

  /** On-screen size of one circumradius at the front plane, px — the names
   *  scale with the page the way the 2D labels do. */
  radiusOnScreen(): number {
    return (this.#radius * this.#height) / (2 * this.#distance * HALF_FOV_TAN)
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
    // The view follows the renderer (`autoResize`), and its camera the view.
    this.#app.renderer.resize(width, height, ratio)
    if (!this.#userMoved && this.#layers.length) this.fit()
    this.#canvas.dataset['renderSize'] = `${width}x${height}@${ratio}`
    this.#draw(performance.now())
  }

  /** The renderer's own idea of its size (CSS px) and pixel ratio. */
  get renderSize(): { width: number; height: number; pixelRatio: number } {
    const { width, height } = this.#app.renderer.screen
    return { width, height, pixelRatio: this.#app.renderer.resolution }
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
    // The canvas and the context go with the application. Pixi's global
    // pools are the hive's too, so they are left alone.
    try { this.#app.destroy(true, { children: true }) } catch { /* already gone */ }
    this.#canvas.remove()
  }

  // ── internals ────────────────────────────────────────────────────────

  /** A flat hexagon in the XY plane facing +Z. With `mapped`, its UVs lay the
   *  hex box onto the unit square — the box the hive's hex capture is taken
   *  at. */
  #hexGeometry(radius: number, mapped: boolean): P.Geometry3D {
    const corners = hexCorners(radius, this.#flat)
    const positions = [0, 0, 0]
    const normals = [0, 0, 1]
    const uvs = mapped ? [0.5, 0.5] : null
    const indices: number[] = []
    corners.forEach((c, k) => {
      positions.push(c.x, c.y, 0)
      normals.push(0, 0, 1)
      if (uvs) { const { u, v } = hexUv(c.x, c.y, radius, this.#flat); uvs.push(u, v) }
      indices.push(0, 1 + k, 1 + ((k + 1) % 6))
    })
    return new this.#lib.Geometry3D({
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      ...(uvs ? { uvs: new Float32Array(uvs) } : {}),
      indices: new Uint16Array(indices),
    })
  }

  /** The prism's two caps: the far one first, so it is drawn under the near
   *  one. */
  #capsGeometry(radius: number): P.Geometry3D {
    const corners = hexCorners(radius, this.#flat)
    const half = this.#thickness / 2
    const positions: number[] = []
    const normals: number[] = []
    const indices: number[] = []
    for (const side of [-1, 1]) {
      const base = positions.length / 3
      positions.push(0, 0, side * half)
      normals.push(0, 0, side)
      for (const c of corners) { positions.push(c.x, c.y, side * half); normals.push(0, 0, side) }
      for (let k = 0; k < 6; k++) {
        const a = base + 1 + k
        const b = base + 1 + ((k + 1) % 6)
        // Counter-clockwise seen from outside: the near cap as wound, the far one reversed.
        if (side > 0) indices.push(base, a, b)
        else indices.push(base, b, a)
      }
    }
    return new this.#lib.Geometry3D({
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
    })
  }

  /** The prism's six side walls, each with its own outward normal. */
  #wallsGeometry(radius: number): P.Geometry3D {
    const corners = hexCorners(radius, this.#flat)
    const half = this.#thickness / 2
    const positions: number[] = []
    const normals: number[] = []
    const indices: number[] = []
    for (let k = 0; k < 6; k++) {
      const a = corners[k]!
      const b = corners[(k + 1) % 6]!
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nx = (b.y - a.y) / length
      const ny = -(b.x - a.x) / length
      const base = positions.length / 3
      positions.push(a.x, a.y, -half, b.x, b.y, -half, b.x, b.y, half, a.x, a.y, half)
      for (let i = 0; i < 4; i++) normals.push(nx, ny, 0)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    return new this.#lib.Geometry3D({
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint16Array(indices),
    })
  }

  /** The prism's rim as line segments: both caps' outlines and the six
   *  uprights between them. */
  #edgesGeometry(radius: number): P.Geometry3D {
    const corners = hexCorners(radius, this.#flat)
    const half = this.#thickness / 2
    const positions: number[] = []
    for (let k = 0; k < 6; k++) {
      const a = corners[k]!
      const b = corners[(k + 1) % 6]!
      positions.push(a.x, a.y, half, b.x, b.y, half)
      positions.push(a.x, a.y, -half, b.x, b.y, -half)
      positions.push(a.x, a.y, -half, a.x, a.y, half)
    }
    return new this.#lib.Geometry3D({ positions: new Float32Array(positions), topology: 'line-list' })
  }

  #tile(
    tile: SceneTile, layerIndex: number,
    shapes: { caps: P.Geometry3D; walls: P.Geometry3D; face: P.Geometry3D; halo: P.Geometry3D; edges: P.Geometry3D },
  ): TileMesh {
    const lib = this.#lib
    const r = this.#radius
    const half = this.#thickness / 2
    const group = new lib.Container3D({ position: { x: tile.x, y: -tile.y, z: 0 } })
    // The whole tile answers a pick; its parts are tested and hand the hit up.
    group.eventMode = 'static'
    this.#owner.set(group, { layerIndex, name: tile.name })
    const unshadowed = { castShadow: false, receiveShadow: false }

    const lit = (): P.Material3D => {
      const material = new lib.Material3D({
        roughness: 0.45, metallic: 0.05, alphaMode: 'blend', alpha: FRONT_OPACITY,
        emissive: { color: 0xffffff, strength: FRONT_EMISSIVE },
      })
      // A see-through prism still hides what is behind it in its own layer.
      material.state.depthMask = true
      return material
    }
    const capMat = lit()
    const wallMat = lit()
    const walls = new lib.Mesh3D({ geometry: shapes.walls, material: wallMat, ...unshadowed })
    const caps = new lib.Mesh3D({ geometry: shapes.caps, material: capMat, ...unshadowed })
    walls.hitVolume = 'geometry'
    caps.hitVolume = 'geometry'

    const edgeMat = new lib.FlatMaterial({ alphaMode: 'blend', alpha: EDGE_OPACITY })
    const edge = new lib.Mesh3D({ geometry: shapes.edges, material: edgeMat, ...unshadowed })
    edge.eventMode = 'none'

    // The picture is a photo, not a tinted surface: unlit, full strength. The
    // mark colour lives only in the walls, rim and glow.
    const faceMat = new lib.FlatMaterial({ alphaMode: 'blend', alpha: 1, doubleSided: true })
    const face = new lib.Mesh3D({
      geometry: shapes.face, material: faceMat, visible: false,
      position: { x: 0, y: 0, z: half + r * 0.01 }, ...unshadowed,
    })
    face.hitVolume = 'geometry'

    const haloMat = new lib.FlatMaterial({ alphaMode: 'blend', alpha: 0.28 })
    haloMat.state.blendMode = 'add'
    const halo = new lib.Mesh3D({
      geometry: shapes.halo, material: haloMat,
      position: { x: 0, y: 0, z: -half - r * 0.02 }, ...unshadowed,
    })
    halo.eventMode = 'none'

    // Blended meshes draw far to near: the glow, the prism and its rim, then
    // the picture on top.
    group.addChild(halo, walls, caps, edge, face)
    const made: TileMesh = {
      name: tile.name, group, caps, capMat, walls, wallMat, edgeMat, face, faceMat, haloMat,
      texture: null, pictureToken: 0, mark: tile.mark, staged: tile.staged === true, hovered: false,
    }
    this.#paintTile(made)
    return made
  }

  /** Colour from the mark (or the staged accent). Glow strength belongs to
   *  the layer and is applied per frame in #applyDeck. */
  #paintTile(tile: TileMesh): void {
    const colour = tile.staged ? STAGED_COLOUR : MARK_COLOUR[tile.mark]
    tile.capMat.baseColor = colour
    if (tile.capMat.emissive) tile.capMat.emissive.color = colour
    tile.wallMat.baseColor = this.#towardWhite(colour, WALL_LIGHTEN)
    if (tile.wallMat.emissive) tile.wallMat.emissive.color = colour
    tile.edgeMat.baseColor = colour
    tile.haloMat.baseColor = colour
    tile.group.position.z = tile.hovered ? this.#thickness * 0.8 : 0
  }

  /** Mix a colour toward white in linear light, the way the lit surface
   *  itself is shaded. */
  #towardWhite(colour: number, amount: number): number {
    const { srgbToLinear, linearToSrgb } = this.#lib
    const channel = (shift: number): number => {
      const linear = srgbToLinear(((colour >> shift) & 0xff) / 255)
      return Math.round(Math.min(1, Math.max(0, linearToSrgb(linear + (1 - linear) * amount))) * 255)
    }
    return (channel(16) << 16) | (channel(8) << 8) | channel(0)
  }

  #dropTexture(tile: TileMesh): void {
    tile.face.visible = false
    if (!tile.texture) return
    tile.faceMat.textures['baseColor'] = Texture.WHITE
    const bitmap = tile.texture.source.resource as ImageBitmap | undefined
    tile.texture.destroy(true)
    try { bitmap?.close?.() } catch { /* already closed */ }
    tile.texture = null
  }

  #clearMeshes(): void {
    for (const layer of this.#layers) {
      for (const tile of layer.tiles.values()) this.#dropTexture(tile)
      // Nodes only: the shapes are shared and the materials are destroyed below.
      layer.group.destroy({ children: true })
      for (const tile of layer.tiles.values()) {
        tile.capMat.destroy()
        tile.wallMat.destroy()
        tile.edgeMat.destroy()
        tile.faceMat.destroy()
        tile.haloMat.destroy()
      }
      layer.ghostMat.destroy()
    }
    for (const geometry of this.#geometries) geometry.destroy(true)
    this.#geometries = []
    this.#layers = []
    this.#owner.clear()
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
      layer.z = z
      layer.group.position.z = z
      layer.group.visible = opacity > 0.01
      // A layer dealt off, or faded nearly out, is skipped by a pick with
      // everything under it.
      layer.group.eventMode = opacity < 0.08 ? 'none' : 'passive'
      // The picture stays full strength at the front and thins with its
      // prism behind it. It is never tinted.
      const faceOpacity = depth >= 0 ? Math.min(1, opacity / FRONT_OPACITY) : presence
      const haloOpacity = (depth >= 0 && depth < 1 ? 0.28 - 0.12 * depth : 0.16) * presence
      for (const tile of layer.tiles.values()) {
        const tileGlow = glow + (tile.hovered ? 0.3 : 0) + (tile.staged ? 0.1 : 0)
        setAlpha(tile.capMat, opacity)
        setAlpha(tile.wallMat, opacity)
        if (tile.capMat.emissive && tile.capMat.emissive.strength !== tileGlow) tile.capMat.emissive.strength = tileGlow
        if (tile.wallMat.emissive && tile.wallMat.emissive.strength !== tileGlow) tile.wallMat.emissive.strength = tileGlow
        setAlpha(tile.edgeMat, EDGE_OPACITY * presence)
        setAlpha(tile.faceMat, faceOpacity)
        setAlpha(tile.haloMat, haloOpacity)
      }
      setAlpha(layer.ghostMat, 0.32 * Math.max(0.35, presence))
    })
  }

  /** Where the camera stands, relative to what it looks at. */
  #offset(): { x: number; y: number; z: number } {
    const d = this.#distance
    return {
      x: d * Math.sin(this.#tilt) * Math.sin(this.#azimuth),
      y: -d * Math.sin(this.#tilt) * Math.cos(this.#azimuth),
      z: d * Math.cos(this.#tilt),
    }
  }

  /** The camera's right and up, in the world: +Y is up, and the tilt stops
   *  short of looking along it. */
  #basis(): { right: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } } {
    const o = this.#offset()
    const d = Math.hypot(o.x, o.y, o.z) || 1
    const back = { x: o.x / d, y: o.y / d, z: o.z / d }
    // right = normalise(cross(+Y, back)); up = cross(back, right)
    const rl = Math.hypot(back.z, back.x) || 1
    const right = { x: back.z / rl, y: 0, z: -back.x / rl }
    const up = {
      x: back.y * right.z - back.z * right.y,
      y: back.z * right.x - back.x * right.z,
      z: back.x * right.y - back.y * right.x,
    }
    return { right, up }
  }

  #updateCamera(): void {
    const camera = this.#view.camera
    const o = this.#offset()
    const t = this.#target
    camera.position.set(t.x + o.x, t.y + o.y, t.z + o.z)
    camera.lookAt(t, { x: 0, y: 1, z: 0 })
    const depth = this.#radius * LAYER_GAP * (this.#layers.length + 2)
    camera.near = Math.max(0.5, this.#distance * 0.02)
    camera.far = this.#distance * 4 + depth * 2
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
    this.#app.render()
    try { this.onFrame?.() } catch (error) { console.error('[lift-scene] frame listener threw:', error) }
    if (moving) this.#request()
  }

  readonly #onWindowResize = (): void => { this.resize() }

  readonly #onVisibility = (): void => {
    if (!document.hidden) this.#request()
  }

  /** A client point in the canvas's own CSS pixels — the space the view's
   *  picking and projection speak. */
  #local(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.#canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((clientX - rect.left) / rect.width) * this.#width,
      y: ((clientY - rect.top) / rect.height) * this.#height,
    }
  }

  /** The point under the pointer on the front plane (z = 0). */
  #planePoint(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    const point = this.#local(clientX, clientY)
    if (!point) return null
    this.#updateCamera()
    const lib = this.#lib
    const hit = this.#view.screenToWorld(point, new lib.Plane(new lib.Vector3(0, 0, 1), 0))
    return hit ? { x: hit.x, y: hit.y, z: hit.z } : null
  }
}
