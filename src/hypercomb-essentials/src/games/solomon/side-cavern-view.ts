// A side-view cavern as a place you walk: one canvas, the Solomon renderer
// drawing the whole cavern in world units, and a camera following Dana along
// it — smooth side to side, eased up and down but never letting a long fall
// carry her out of view. The mouth takes her back up; the way deeper, and
// any square a story has made lead elsewhere, take her on.

import { SIM_DT, TILE, WALL, BRICK, CRACKED } from './engine.js'
import { Renderer } from './renderer.js'
import { SideCavernRun, type SideCavernDefinition } from './side-cavern.js'
import { squareName } from './labyrinth.js'
import type { MoveInput } from './chamber.js'
import type { PlaceSeed, StorySeat } from './place.js'
import { VEIL_ZOOM, veilGridPicture, type VeilDirection, type VeilLeg, type VeilPicture, type VeilRgb } from './place-veil.js'
import type { PlaceRuntime, RuntimeArrival, RuntimeShell } from './place-runtimes.js'
import type { Cell } from './engine.js'

/** The window onto the cavern, in squares. */
const VIEW_COLS = 20
const VIEW_ROWS = 12
/** How fast the camera closes on Dana (per second): side to side, up and down. */
const X_FOLLOW = 9
const Y_FOLLOW = 5

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const STONE: VeilRgb = [88, 72, 60], CLAY: VeilRgb = [196, 118, 44], AIR: VeilRgb = [22, 18, 28], WAY: VeilRgb = [120, 190, 230]

export class SideCavernRuntime implements PlaceRuntime {
  readonly place: string
  readonly host: HTMLElement
  readonly run: SideCavernRun
  readonly #shell: RuntimeShell
  readonly #root: HTMLDivElement
  readonly #canvas: HTMLCanvasElement
  readonly #ctx: CanvasRenderingContext2D | null
  readonly #renderer: Renderer | null
  readonly #viewW: number
  readonly #viewH: number
  #scaleBack = 1
  #fitKey = ''
  #cam = { x: 0, y: 0 }
  #camReady = false
  #acc = 0
  #time = 0
  #jumpHeld = false
  /** Squares a story made lead elsewhere, by entrance id. */
  #seated: ReadonlyMap<string, Cell> | null = null
  readonly #windows = new Map<string, HTMLCanvasElement | null>()

  constructor(host: HTMLElement, definition: SideCavernDefinition, shell: RuntimeShell) {
    this.place = definition.id
    this.host = host
    this.#shell = shell
    this.run = new SideCavernRun(definition)
    this.#viewW = Math.min(VIEW_COLS, definition.level.cols) * TILE
    this.#viewH = Math.min(VIEW_ROWS, definition.level.rows) * TILE
    this.#root = document.createElement('div')
    this.#root.className = 'sol-side-cavern'
    this.#root.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0c0a10;overflow:hidden'
    this.#canvas = document.createElement('canvas')
    this.#canvas.setAttribute('role', 'img')
    this.#canvas.setAttribute('aria-label', `${definition.name}: ${definition.subtitle}. Walk and jump with the arrows; Z conjures and dispels.`)
    this.#root.append(this.#canvas)
    host.append(this.#root)
    let ctx: CanvasRenderingContext2D | null = null
    try { ctx = this.#canvas.getContext('2d') } catch { ctx = null }
    this.#ctx = ctx
    this.#renderer = ctx ? new Renderer(ctx) : null
  }

  prepare(_seat: StorySeat, _cancelled: () => boolean): true { return true }
  canResume(): boolean { return true }

  show(arrival: RuntimeArrival): void {
    if (arrival.from === 'above') {
      const journey = this.#shell.journey()
      this.run.begin({ kit: journey.kit, weapon: journey.weapon, spell: journey.spell })
    } else if (arrival.from === 'below') {
      const slash = arrival.via.indexOf('/')
      if (slash > 0) this.run.returnFrom(arrival.via.slice(slash + 1))
    }
    this.#camReady = false
    this.#acc = 0
    this.host.hidden = false
  }

  hide(): void { this.host.hidden = true }

  update(dt: number, input: MoveInput): void {
    const engine = this.run.engine
    engine.input.left = input.left
    engine.input.right = input.right
    engine.input.down = input.down
    engine.input.jump = input.up || this.#jumpHeld
    this.#acc += Math.min(dt, 0.1)
    while (this.#acc >= SIM_DT) {
      this.#acc -= SIM_DT
      const step = this.run.step(SIM_DT, this.#seatedSquares())
      if (!step) continue
      if (step.kind === 'locked') {
        this.#shell.message('This cavern’s key opens the way deeper.')
        this.#shell.sound('door-locked')
        continue
      }
      this.#acc = 0
      if (step.kind === 'up') this.#shell.leave(this.place, 'mouth')
      else this.#shell.enter(this.place, step.entrance)
      break
    }
    this.#time += dt
    this.#draw(dt)
  }

  interact(): void {
    const got = this.run.engine.interact()
    if (!got) this.#shell.message(this.run.engine.state === 'gameover' ? 'Press R to try the cavern again.' : 'Walk into the mouth to go back up; the way deeper opens to this cavern’s key.')
  }

  cast(): void { this.run.engine.cast() }

  key(key: string, down: boolean, repeat: boolean): boolean {
    if (key === ' ') { this.#jumpHeld = down; return true }
    if (!down || repeat) return false
    const engine = this.run.engine
    if (key === 'x' || key === 'k') { engine.fireball(); return true }
    if (key === 'r') { if (engine.state === 'gameover') this.run.retry(); return true }
    if (key === 'c' || key === 'l') { engine.strike(); return true }
    if (key === 'v' || key === ';') { engine.castSpell(); return true }
    return false
  }

  get isDialogOpen(): boolean { return false }
  closeDialog(): void {}
  exportFacts(): unknown { return this.run.exportState() }
  restoreFacts(raw: unknown): void { this.run.restoreState(raw); this.#camReady = false }

  leaveLeg(direction: VeilDirection, at?: { readonly x: number; readonly y: number }): VeilLeg | null {
    return { element: this.#canvas, picture: this.#picture(), origin: at ? [at.x, at.y] : this.#danaOnScreen(), scale: VEIL_ZOOM[direction].leave }
  }
  arriveLeg(direction: VeilDirection): VeilLeg | null {
    return { element: this.#canvas, picture: this.#picture(), origin: this.#danaOnScreen(), scale: VEIL_ZOOM[direction].arrive }
  }
  seed(): PlaceSeed { return this.run.seed() }
  anchor(_feature: string): { readonly x: number; readonly y: number } | null { return null }
  dispose(): void { this.#root.remove() }

  // ── the camera and the picture ──────────────────────────────────────────

  #seatedSquares(): ReadonlyMap<string, Cell> {
    if (this.#seated) return this.#seated
    const squares = new Map<string, Cell>()
    const { cols, rows } = this.run.definition.level
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const entrance = squareName(col, row)
      if (this.#shell.seat(this.place, entrance)) squares.set(entrance, { col, row })
    }
    return this.#seated = squares
  }

  #camera(dt: number): { readonly x: number; readonly y: number } {
    const engine = this.run.engine, p = engine.player
    const maxX = Math.max(0, engine.width - this.#viewW), maxY = Math.max(0, engine.height - this.#viewH)
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2
    const tx = clamp(cx - this.#viewW / 2, 0, maxX), ty = clamp(cy - this.#viewH * 0.55, 0, maxY)
    if (!this.#camReady) { this.#cam = { x: tx, y: ty }; this.#camReady = true; return this.#cam }
    this.#cam.x += (tx - this.#cam.x) * Math.min(1, dt * X_FOLLOW)
    this.#cam.y += (ty - this.#cam.y) * Math.min(1, dt * Y_FOLLOW)
    // A long fall never carries her out of the window.
    this.#cam.y = clamp(clamp(this.#cam.y, cy + TILE * 1.5 - this.#viewH, cy - TILE * 1.5), 0, maxY)
    return this.#cam
  }

  #fit(): void {
    const width = this.host.clientWidth, height = this.host.clientHeight
    const key = `${width}x${height}`
    if (key === this.#fitKey) return
    this.#fitKey = key
    const scale = width > 0 && height > 0 ? Math.min(width / this.#viewW, height / this.#viewH) : 1
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    this.#canvas.width = Math.max(1, Math.round(this.#viewW * scale * dpr))
    this.#canvas.height = Math.max(1, Math.round(this.#viewH * scale * dpr))
    this.#canvas.style.width = `${Math.round(this.#viewW * scale)}px`
    this.#canvas.style.height = `${Math.round(this.#viewH * scale)}px`
    this.#scaleBack = scale * dpr
  }

  #draw(dt: number): void {
    const ctx = this.#ctx, renderer = this.#renderer
    if (!ctx || !renderer) return
    this.#fit()
    const engine = this.run.engine, scale = this.#scaleBack, cam = this.#camera(dt)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height)
    ctx.setTransform(scale, 0, 0, scale, -cam.x * scale, -cam.y * scale)
    renderer.drawWorld(engine, this.#time)
    this.#drawMouth(ctx)
    this.#drawWindows(ctx)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    renderer.drawHud(engine, this.#time, this.#viewW, this.#viewH)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** The way back up: daylight falling in through the mouth. */
  #drawMouth(ctx: CanvasRenderingContext2D): void {
    const { col, row } = this.run.definition.mouth
    const x = col * TILE, y = row * TILE
    const glow = ctx.createLinearGradient(x, y - TILE, x + TILE, y + TILE)
    glow.addColorStop(0, 'rgba(255,244,214,0.55)')
    glow.addColorStop(1, 'rgba(255,244,214,0.05)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.moveTo(x + 3, y + TILE)
    ctx.lineTo(x + 3, y + TILE * 0.35)
    ctx.quadraticCurveTo(x + TILE / 2, y - TILE * 0.05, x + TILE - 3, y + TILE * 0.35)
    ctx.lineTo(x + TILE - 3, y + TILE)
    ctx.closePath()
    ctx.fill()
  }

  /** Every square a story made lead elsewhere wears a window onto where. */
  #drawWindows(ctx: CanvasRenderingContext2D): void {
    for (const [entrance, cell] of this.#seatedSquares()) {
      if (!this.#windows.has(entrance)) this.#windows.set(entrance, this.#window(entrance))
      const picture = this.#windows.get(entrance)
      const x = cell.col * TILE + 3, y = cell.row * TILE + 3, size = TILE - 6
      ctx.fillStyle = 'rgba(120,190,230,0.35)'
      ctx.fillRect(x - 2, y - 2, size + 4, size + 4)
      if (picture) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(picture, x, y, size, size)
        ctx.imageSmoothingEnabled = true
      }
    }
  }

  #window(entrance: string): HTMLCanvasElement | null {
    const seed = this.#shell.seatSeed(this.place, entrance)
    if (!seed || seed.rgb.length < seed.cols * seed.rows * 3) return null
    const canvas = document.createElement('canvas')
    canvas.width = seed.cols
    canvas.height = seed.rows
    let context: CanvasRenderingContext2D | null = null
    try { context = canvas.getContext('2d') } catch { context = null }
    if (!context) return null
    const image = context.createImageData(seed.cols, seed.rows)
    for (let cell = 0; cell < seed.cols * seed.rows; cell++) {
      image.data[cell * 4] = seed.rgb[cell * 3]!
      image.data[cell * 4 + 1] = seed.rgb[cell * 3 + 1]!
      image.data[cell * 4 + 2] = seed.rgb[cell * 3 + 2]!
      image.data[cell * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
    return canvas
  }

  /** The window as the veil sees it: the squares on screen. */
  #picture(): VeilPicture {
    const engine = this.run.engine
    const col0 = Math.floor(this.#cam.x / TILE), row0 = Math.floor(this.#cam.y / TILE)
    const cols = Math.ceil(this.#viewW / TILE), rows = Math.ceil(this.#viewH / TILE)
    const { mouth, deeper } = this.run.definition
    return veilGridPicture(cols, rows, (col, row): VeilRgb => {
      const c = col0 + col, r = row0 + row
      if ((c === mouth.col && r === mouth.row) || (deeper && c === deeper.col && r === deeper.row)) return WAY
      const tile = engine.tileAt(c, r)
      return tile === WALL ? STONE : tile === BRICK || tile === CRACKED ? CLAY : AIR
    })
  }

  #danaOnScreen(): readonly [number, number] {
    const p = this.run.engine.player
    return [clamp((p.x + p.w / 2 - this.#cam.x) / this.#viewW, 0, 1), clamp((p.y + p.h / 2 - this.#cam.y) / this.#viewH, 0, 1)]
  }
}
