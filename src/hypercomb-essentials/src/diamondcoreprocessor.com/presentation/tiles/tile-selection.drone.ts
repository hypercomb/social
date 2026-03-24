// diamondcoreprocessor.com/pixi/tile-selection.drone.ts
import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { Axial } from '../../navigation/hex-detector.js'
import type { InputGate } from '../../navigation/input-gate.service.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY } from '../grid/hex-geometry.js'

type CellCountPayload = { count: number; labels: string[] }

// ── colors ──────────────────────────────────────────────────────
// Selected tile
const SELECTION_FILL              = 0x22cc66
const SELECTION_FILL_ALPHA        = 0.12
const SELECTION_STROKE            = 0x22cc66
const SELECTION_STROKE_MIN_ALPHA  = 0.35
const SELECTION_STROKE_MAX_ALPHA  = 0.75
const SELECTION_STROKE_WIDTH      = 1.0

// Inner inset border
const INSET_OFFSET                = 3
const INSET_STROKE_ALPHA          = 0.25
const INSET_STROKE_WIDTH          = 0.75

// Vertex accent markers (selected)
const VERTEX_RADIUS               = 2.5
const VERTEX_COLOR                = 0xc8975a
const VERTEX_ALPHA                = 0.85

// Leader/active tile
const LEADER_FILL                 = 0xffaa00
const LEADER_FILL_ALPHA           = 0.15
const LEADER_STROKE               = 0xffaa00
const LEADER_STROKE_MIN_ALPHA     = 0.50
const LEADER_STROKE_MAX_ALPHA     = 0.90
const LEADER_STROKE_WIDTH         = 2.5

// Leader outer glow halo
const HALO_OFFSET                 = 5
const HALO_FILL                   = 0xffaa00
const HALO_FILL_ALPHA             = 0.10

// Leader vertex markers (larger with ring)
const LEADER_VERTEX_RADIUS        = 3.5
const LEADER_VERTEX_RING_RADIUS   = 5.0
const LEADER_VERTEX_RING_WIDTH    = 0.75
const LEADER_VERTEX_RING_ALPHA    = 0.50

// Animation
const PULSE_PERIOD_MS             = 3000
const ANIM_FPS_CAP                = 30

export type LeaderInfo = { q: number; r: number; label: string } | null
export type RelativeAxial = { q: number; r: number; dq: number; dr: number; label: string }

export class TileSelectionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'tile selection with leader tile and relative axial math'

  #app: Application | null = null
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: Application['renderer'] | null = null

  #layer: Graphics | null = null

  #meshOffset = { x: 0, y: 0 }

  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY

  #cellCount = 0
  #cellLabels: string[] = []
  #occupiedByAxial = new Map<string, { index: number; label: string }>()

  // ── selection state ───────────────────────────────────────────
  #selected = new Set<string>() // axial keys "q,r"
  #leaderKey: string | null = null // axial key of the leader tile
  // ── drag state ────────────────────────────────────────────────
  #dragActive = false
  #dragOp: 'add' | 'remove' | null = null
  #touched = new Set<string>()
  #lastDragAxial: Axial | null = null

  #gate: InputGate | null = null
  #listening = false
  #effectsRegistered = false

  // hex orientation
  #flat = false

  // ── animation state ───────────────────────────────────────────
  #tickerBound = false
  #pulsePhase = 0
  #lastFrameTime = 0

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    selection: '@diamondcoreprocessor.com/SelectionService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'render:set-orientation', 'render:geometry-changed', 'keymap:invoke', 'selection:changed']
  protected override emits = ['selection:changed']

  // flag to prevent feedback loops: this drone emits selection:changed and also listens to it
  #syncing = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#app = payload.app
      this.#renderContainer = payload.container
      this.#canvas = payload.canvas
      this.#renderer = payload.renderer
      this.#gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null
      this.#initLayer()
      this.#attachListeners()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
      this.#redraw()
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#cellCount = payload.count
      this.#cellLabels = payload.labels
      this.#rebuildOccupiedMap()
      this.#pruneStaleSelections()
      this.#redraw()
    })

    this.onEffect<{ flat: boolean }>('render:set-orientation', (payload) => {
      this.#flat = payload.flat
      this.#redraw()
    })

    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      this.#geo = geo
      this.#redraw()
    })

    this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd in ARROW_OFFSETS) { this.#handleArrowNav(cmd); return }
    })

    // Sync from SelectionService (e.g. command line command-driven selection)
    // SelectionService emits { selected: string[], active: string | null }
    // This drone emits { count, keys, labels, leader, relativeAxials } — ignore own emissions
    this.onEffect<Record<string, unknown>>('selection:changed', (payload) => {
      if (this.#syncing) return
      if (!Array.isArray(payload?.['selected'])) return // only handle SelectionService payloads

      const targetLabels = new Set(payload['selected'] as string[])

      // Convert labels → axial keys
      const targetKeys = new Set<string>()
      for (const [key, entry] of this.#occupiedByAxial) {
        if (targetLabels.has(entry.label)) targetKeys.add(key)
      }

      // Only update if different
      if (targetKeys.size === this.#selected.size && [...targetKeys].every(k => this.#selected.has(k))) return

      this.#selected.clear()
      for (const k of targetKeys) this.#selected.add(k)
      this.#leaderKey = targetKeys.size > 0 ? [...targetKeys][0] : null
      this.#syncing = true
      this.#redraw()
      this.#syncing = false

      if (this.#selected.size > 0) this.#startAnimation()
      else this.#stopAnimation()
    })
  }

  protected override dispose(): void {
    this.#stopAnimation()
    if (this.#listening) {
      document.removeEventListener('mousedown', this.#onMouseDown)
      document.removeEventListener('mousemove', this.#onMouseMove)
      document.removeEventListener('mouseup', this.#onMouseUp)
      this.#listening = false
    }
    if (this.#layer) {
      this.#layer.destroy()
      this.#layer = null
    }
  }

  // ── animation lifecycle ──────────────────────────────────────

  #startAnimation(): void {
    if (this.#tickerBound || !this.#app) return
    this.#tickerBound = true
    this.#lastFrameTime = 0
    this.#app.ticker.add(this.#onAnimTick)
  }

  #stopAnimation(): void {
    if (!this.#tickerBound || !this.#app) return
    this.#app.ticker.remove(this.#onAnimTick)
    this.#tickerBound = false
    this.#pulsePhase = 0
  }

  #onAnimTick = (): void => {
    if (!this.#app || this.#selected.size === 0) return

    const now = performance.now()
    const minInterval = 1000 / ANIM_FPS_CAP
    if (now - this.#lastFrameTime < minInterval) return
    this.#lastFrameTime = now

    this.#pulsePhase = (now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS
    this.#redraw()
  }

  // ── public API ────────────────────────────────────────────────

  get selectedAxialKeys(): ReadonlySet<string> {
    return this.#selected
  }

  get selectedLabels(): string[] {
    const out: string[] = []
    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key)
      if (entry) out.push(entry.label)
    }
    return out
  }

  /** The leader tile — first tile selected, origin for relative axial math */
  get leader(): LeaderInfo {
    if (!this.#leaderKey) return null
    const entry = this.#occupiedByAxial.get(this.#leaderKey)
    if (!entry) return null
    const [qs, rs] = this.#leaderKey.split(',')
    return { q: Number(qs), r: Number(rs), label: entry.label }
  }

  /**
   * Selected tiles as axial coordinates relative to the leader.
   * dq/dr = tile.q - leader.q, tile.r - leader.r
   * Leader itself has dq=0, dr=0.
   */
  get relativeAxials(): RelativeAxial[] {
    const l = this.leader
    if (!l) return []
    const out: RelativeAxial[] = []
    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key)
      if (!entry) continue
      const [qs, rs] = key.split(',')
      const q = Number(qs)
      const r = Number(rs)
      out.push({ q, r, dq: q - l.q, dr: r - l.r, label: entry.label })
    }
    return out
  }

  clearSelection(): void {
    if (this.#selected.size === 0 && !this.#leaderKey) return
    this.#selected.clear()
    this.#leaderKey = null
    this.#stopAnimation()
    this.#redraw()
    this.#emitChanged()
    this.#syncSelectionService()
  }

  // ── keyboard navigation ──────────────────────────────────────

  #handleArrowNav(cmd: string): void {
    const offset = ARROW_OFFSETS[cmd]
    if (!offset) return

    // no leader — default to center tile (or first occupied)
    if (!this.#leaderKey) {
      const centerKey = axialKey(0, 0)
      if (this.#occupiedByAxial.has(centerKey)) {
        this.#leaderKey = centerKey
        this.#selected.clear()
        this.#selected.add(centerKey)
        this.#syncSelectionService(centerKey)
      } else {
        // pick first occupied tile if center is empty
        const first = this.#occupiedByAxial.keys().next().value
        if (!first) return
        this.#leaderKey = first
        this.#selected.clear()
        this.#selected.add(first)
        this.#syncSelectionService(first)
      }
      this.#startAnimation()
      this.#redraw()
      this.#emitChanged()
      return
    }

    const [qs, rs] = this.#leaderKey.split(',')
    let tq = Number(qs) + offset.dq
    let tr = Number(rs) + offset.dr

    // scan in direction, skipping empty spaces, until we find an occupied tile or go out of bounds
    while (TileSelectionDrone.#inBounds(tq, tr)) {
      const targetKey = axialKey(tq, tr)
      if (this.#occupiedByAxial.has(targetKey)) {
        if (this.#selected.has(targetKey)) {
          // target already in selection — promote to leader, keep selection
          this.#leaderKey = targetKey
        } else {
          // target outside selection — collapse to single
          this.#leaderKey = targetKey
          this.#selected.clear()
          this.#selected.add(targetKey)
          this.#syncSelectionService(targetKey)
        }
        this.#startAnimation()
        this.#redraw()
        this.#emitChanged()
        return
      }
      tq += offset.dq
      tr += offset.dr
    }
    // no occupied tile found in this direction — do nothing
  }

  static #inBounds(q: number, r: number): boolean {
    const s = -q - r
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= 50
  }

  #syncSelectionService(_axialKeyStr?: string): void {
    const selection = this.resolve<{ clear(): void; add(label: string): void; remove(label: string): void }>('selection')
    if (!selection) return
    // Sync the full selection set to SelectionService
    this.#syncing = true
    selection.clear()
    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key)
      if (entry) selection.add(entry.label)
    }
    this.#syncing = false
  }

  // ── layer setup ───────────────────────────────────────────────

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Graphics()
    this.#layer.zIndex = 5000
    this.#renderContainer.addChild(this.#layer)
    this.#renderContainer.sortableChildren = true
  }

  // ── listener setup ────────────────────────────────────────────

  #attachListeners(): void {
    if (this.#listening) return
    this.#listening = true
    document.addEventListener('mousedown', this.#onMouseDown)
    document.addEventListener('mousemove', this.#onMouseMove)
    document.addEventListener('mouseup', this.#onMouseUp)
  }

  // ── mouse handlers ────────────────────────────────────────────

  #onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    if (!e.ctrlKey && !e.metaKey) return
    if (!this.#canvas) return
    if (this.#isInteractiveTarget(e.target)) return

    const rect = this.#canvas.getBoundingClientRect()
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (!axial) return

    const key = axialKey(axial.q, axial.r)
    const isOccupied = this.#occupiedByAxial.has(key)

    if (!this.#gate?.claim('tile-selection')) return

    this.#dragActive = true
    this.#touched.clear()
    this.#lastDragAxial = axial

    if (isOccupied) {
      const isSelected = this.#selected.has(key)
      if (isSelected && this.#selected.size > 1) {
        // promote to leader instead of removing
        this.#leaderKey = key
        this.#dragOp = null
        this.#redraw()
        this.#emitChanged()
      } else {
        this.#dragOp = isSelected ? 'remove' : 'add'
        this.#applyOp(key)
      }
    } else {
      this.#dragOp = 'add'
    }

    e.preventDefault()
    e.stopPropagation()
  }

  #onMouseMove = (e: MouseEvent): void => {
    if (!this.#dragActive || !this.#dragOp) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (!axial) return

    if (this.#lastDragAxial && this.#lastDragAxial.q === axial.q && this.#lastDragAxial.r === axial.r) return
    this.#lastDragAxial = axial

    const key = axialKey(axial.q, axial.r)
    if (!this.#occupiedByAxial.has(key)) return

    this.#applyOp(key)

    e.preventDefault()
    e.stopPropagation()
  }

  #onMouseUp = (_e: MouseEvent): void => {
    if (!this.#dragActive) return
    this.#gate?.release('tile-selection')
    this.#dragActive = false
    this.#dragOp = null
    this.#touched.clear()
    this.#lastDragAxial = null
  }

  // ── selection logic ───────────────────────────────────────────

  #applyOp(key: string): void {
    if (this.#touched.has(key)) return
    this.#touched.add(key)

    if (this.#dragOp === 'add') {
      // first tile added becomes leader
      if (this.#selected.size === 0) this.#leaderKey = key
      this.#selected.add(key)
    } else if (this.#dragOp === 'remove') {
      this.#selected.delete(key)
      // if leader was removed, promote next selected tile (or clear)
      if (key === this.#leaderKey) {
        const next = this.#selected.values().next()
        this.#leaderKey = next.done ? null : next.value
      }
    }

    this.#redraw()
    this.#emitChanged()
    this.#syncSelectionService()

    if (this.#selected.size > 0) this.#startAnimation()
    else this.#stopAnimation()
  }

  #pruneStaleSelections(): void {
    let pruned = false
    for (const key of this.#selected) {
      if (!this.#occupiedByAxial.has(key)) {
        this.#selected.delete(key)
        pruned = true
      }
    }
    if (this.#leaderKey && !this.#occupiedByAxial.has(this.#leaderKey)) {
      const next = this.#selected.values().next()
      this.#leaderKey = next.done ? null : next.value
      pruned = true
    }
    if (pruned) this.#emitChanged()
  }

  #emitChanged(): void {
    this.#syncing = true
    this.emitEffect('selection:changed', {
      count: this.#selected.size,
      keys: Array.from(this.#selected),
      labels: this.selectedLabels,
      leader: this.leader,
      relativeAxials: this.relativeAxials,
    })
    this.#syncing = false
  }

  // ── hex drawing (all programmatic, no PNGs) ───────────────────

  #redraw(): void {
    if (!this.#layer) return
    this.#layer.clear()

    if (this.#selected.size === 0) return

    const ox = this.#meshOffset.x
    const oy = this.#meshOffset.y
    const axial = this.resolve<any>('axial')

    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key)
      if (!entry) continue

      const [qs, rs] = key.split(',')
      const q = Number(qs)
      const r = Number(rs)
      const pos = this.#axialToPixel(q, r, this.#flat)
      const cx = pos.x + ox
      const cy = pos.y + oy

      const isLeader = key === this.#leaderKey
      this.#drawHex(cx, cy, this.#geo.circumRadiusPx, isLeader, this.#flat)
    }

  }

  #hexVerts(cx: number, cy: number, r: number, angleOffset: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + angleOffset
      verts.push(cx + r * Math.cos(angle))
      verts.push(cy + r * Math.sin(angle))
    }
    return verts
  }

  #drawHex(cx: number, cy: number, r: number, isLeader: boolean, flat = false): void {
    if (!this.#layer) return

    const angleOffset = flat ? 0 : Math.PI / 6
    const verts = this.#hexVerts(cx, cy, r, angleOffset)

    // sinusoidal pulse: 0..1
    const sin01 = (Math.sin(this.#pulsePhase * Math.PI * 2) + 1) / 2

    if (isLeader) {
      // ── outer glow halo ───────────────────────────────
      const haloVerts = this.#hexVerts(cx, cy, r + HALO_OFFSET, angleOffset)
      this.#layer.poly(haloVerts, true)
      this.#layer.fill({ color: HALO_FILL, alpha: HALO_FILL_ALPHA })

      // ── fill ──────────────────────────────────────────
      this.#layer.poly(verts, true)
      this.#layer.fill({ color: LEADER_FILL, alpha: LEADER_FILL_ALPHA })

      // ── pulsing border (counter-phase) ────────────────
      const leaderAlpha = LEADER_STROKE_MIN_ALPHA +
        (1 - sin01) * (LEADER_STROKE_MAX_ALPHA - LEADER_STROKE_MIN_ALPHA)
      this.#layer.poly(verts, true)
      this.#layer.stroke({ color: LEADER_STROKE, alpha: leaderAlpha, width: LEADER_STROKE_WIDTH })

      // ── inner inset border ────────────────────────────
      const insetVerts = this.#hexVerts(cx, cy, r - INSET_OFFSET, angleOffset)
      this.#layer.poly(insetVerts, true)
      this.#layer.stroke({ color: LEADER_STROKE, alpha: INSET_STROKE_ALPHA, width: INSET_STROKE_WIDTH })

      // ── prominent vertex markers with ring ────────────
      for (let i = 0; i < 12; i += 2) {
        const vx = verts[i], vy = verts[i + 1]
        this.#layer.circle(vx, vy, LEADER_VERTEX_RING_RADIUS)
        this.#layer.stroke({ color: VERTEX_COLOR, alpha: LEADER_VERTEX_RING_ALPHA, width: LEADER_VERTEX_RING_WIDTH })
        this.#layer.circle(vx, vy, LEADER_VERTEX_RADIUS)
        this.#layer.fill({ color: VERTEX_COLOR, alpha: VERTEX_ALPHA })
      }
    } else {
      // ── fill ──────────────────────────────────────────
      this.#layer.poly(verts, true)
      this.#layer.fill({ color: SELECTION_FILL, alpha: SELECTION_FILL_ALPHA })

      // ── breathing edge pulse ──────────────────────────
      const selAlpha = SELECTION_STROKE_MIN_ALPHA +
        sin01 * (SELECTION_STROKE_MAX_ALPHA - SELECTION_STROKE_MIN_ALPHA)
      this.#layer.poly(verts, true)
      this.#layer.stroke({ color: SELECTION_STROKE, alpha: selAlpha, width: SELECTION_STROKE_WIDTH })

      // ── inner inset border ────────────────────────────
      const insetVerts = this.#hexVerts(cx, cy, r - INSET_OFFSET, angleOffset)
      this.#layer.poly(insetVerts, true)
      this.#layer.stroke({ color: SELECTION_STROKE, alpha: INSET_STROKE_ALPHA, width: INSET_STROKE_WIDTH })

      // ── vertex accent markers ─────────────────────────
      for (let i = 0; i < 12; i += 2) {
        this.#layer.circle(verts[i], verts[i + 1], VERTEX_RADIUS)
        this.#layer.fill({ color: VERTEX_COLOR, alpha: VERTEX_ALPHA })
      }
    }
  }

  // ── coordinate helpers ────────────────────────────────────────

  #axialToPixel(q: number, r: number, flat = false) {
    return flat
      ? { x: 1.5 * this.#geo.spacing * q, y: Math.sqrt(3) * this.#geo.spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#geo.spacing * (q + r / 2), y: this.#geo.spacing * 1.5 * r }
  }

  #clientToAxial(cx: number, cy: number): Axial | null {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return null
    const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
    if (!detector) return null

    const pixiGlobal = this.#clientToPixiGlobal(cx, cy)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const meshLocalX = local.x - this.#meshOffset.x
    const meshLocalY = local.y - this.#meshOffset.y
    return detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat)
  }

  #clientToPixiGlobal(cx: number, cy: number) {
    const events = (this.#renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas!.getBoundingClientRect()
    const screen = this.#renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }

  // ── occupied lookup ───────────────────────────────────────────

  #rebuildOccupiedMap(): void {
    this.#occupiedByAxial.clear()
    const axial = this.resolve<any>('axial')
    if (!axial?.items) return

    for (let i = 0; i < this.#cellCount; i++) {
      const coord = axial.items.get(i) as Axial | undefined
      const label = this.#cellLabels[i]
      if (!coord || !label) break
      this.#occupiedByAxial.set(axialKey(coord.q, coord.r), { index: i, label })
    }
  }

  #isInteractiveTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false
    return !!target.closest('input, textarea, button, select, option, a, [contenteditable="true"], [contenteditable=""], [role="textbox"]')
  }

  #isInsideRect(x: number, y: number, rect: DOMRect): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
}

// ── arrow-key direction offsets ─────────────────────────────────
const ARROW_OFFSETS: Record<string, { dq: number; dr: number }> = {
  'navigation.moveLeft':  { dq: -1, dr:  0 },
  'navigation.moveRight': { dq:  1, dr:  0 },
  'navigation.moveUp':    { dq:  0, dr: -1 },
  'navigation.moveDown':  { dq:  0, dr:  1 },
}

function axialKey(q: number, r: number): string {
  return `${q},${r}`
}

const _tileSelection = new TileSelectionDrone()
window.ioc.register('@diamondcoreprocessor.com/TileSelectionDrone', _tileSelection)
