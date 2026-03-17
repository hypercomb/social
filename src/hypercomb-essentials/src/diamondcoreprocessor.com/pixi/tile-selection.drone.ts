// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/tile-selection.drone.ts
// Tile selection with Ctrl+click toggle and Ctrl+drag for range select/deselect.
// Renders programmatic hex overlays: amber leader tile + green selected tiles.
// Exposes leader-relative axial coordinates for computational irreducibility.

import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.drone.js'
import type { Axial } from '../input/hex-detector.js'
import type { InputGate } from '../input/input-gate.service.js'

type CellCountPayload = { count: number; labels: string[] }

// ── colors ──────────────────────────────────────────────────────
const SELECTION_FILL = 0x22cc66
const SELECTION_FILL_ALPHA = 0.15
const SELECTION_STROKE = 0x22cc66
const SELECTION_STROKE_ALPHA = 0.6

const LEADER_FILL = 0xffaa00
const LEADER_FILL_ALPHA = 0.2
const LEADER_STROKE = 0xffaa00
const LEADER_STROKE_ALPHA = 0.8

const STROKE_WIDTH = 1.0

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

  readonly #circumRadiusPx = 32
  readonly #spacing = 38 // circumRadiusPx + gapPx

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

  // hex orientation
  #flat = false

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    selection: '@diamondcoreprocessor.com/SelectionService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'render:set-orientation', 'keymap:invoke']
  protected override emits = ['selection:changed']

  protected override heartbeat = async (): Promise<void> => {
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

    this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd in ARROW_OFFSETS) this.#handleArrowNav(cmd)
    })
  }

  protected override dispose(): void {
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
    this.#redraw()
    this.#emitChanged()
  }

  // ── keyboard navigation ──────────────────────────────────────

  #handleArrowNav(cmd: string): void {
    const offset = ARROW_OFFSETS[cmd]
    if (!offset) return

    // no leader — default to center tile
    if (!this.#leaderKey) {
      const centerKey = axialKey(0, 0)
      if (!this.#occupiedByAxial.has(centerKey)) return
      this.#leaderKey = centerKey
      this.#selected.clear()
      this.#selected.add(centerKey)
      this.#syncSelectionService(centerKey)
      this.#redraw()
      this.#emitChanged()
      return
    }

    const [qs, rs] = this.#leaderKey.split(',')
    const tq = Number(qs) + offset.dq
    const tr = Number(rs) + offset.dr
    const targetKey = axialKey(tq, tr)

    if (!this.#occupiedByAxial.has(targetKey)) return

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
    this.#redraw()
    this.#emitChanged()
  }

  #syncSelectionService(axialKeyStr: string): void {
    const entry = this.#occupiedByAxial.get(axialKeyStr)
    if (!entry) return
    const selection = this.resolve<{ clear(): void; add(label: string): void }>('selection')
    if (!selection) return
    selection.clear()
    selection.add(entry.label)
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
    this.emitEffect('selection:changed', {
      count: this.#selected.size,
      keys: Array.from(this.#selected),
      labels: this.selectedLabels,
      leader: this.leader,
      relativeAxials: this.relativeAxials,
    })
  }

  // ── hex drawing (all programmatic, no PNGs) ───────────────────

  #redraw(): void {
    if (!this.#layer) return
    this.#layer.clear()

    if (this.#selected.size === 0) return

    const r = this.#circumRadiusPx
    const ox = this.#meshOffset.x
    const oy = this.#meshOffset.y

    for (const key of this.#selected) {
      if (!this.#occupiedByAxial.has(key)) continue

      const [qs, rs] = key.split(',')
      const q = Number(qs)
      const rr = Number(rs)
      const px = this.#axialToPixel(q, rr, this.#flat)
      const cx = px.x + ox
      const cy = px.y + oy

      const isLeader = key === this.#leaderKey
      this.#drawHex(cx, cy, r, isLeader, this.#flat)
    }
  }

  #drawHex(cx: number, cy: number, r: number, isLeader: boolean, flat = false): void {
    if (!this.#layer) return

    // point-top: 30° offset; flat-top: 0° offset
    const angleOffset = flat ? 0 : Math.PI / 6
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + angleOffset
      verts.push(cx + r * Math.cos(angle))
      verts.push(cy + r * Math.sin(angle))
    }

    const fillColor = isLeader ? LEADER_FILL : SELECTION_FILL
    const fillAlpha = isLeader ? LEADER_FILL_ALPHA : SELECTION_FILL_ALPHA
    const strokeColor = isLeader ? LEADER_STROKE : SELECTION_STROKE
    const strokeAlpha = isLeader ? LEADER_STROKE_ALPHA : SELECTION_STROKE_ALPHA

    this.#layer.poly(verts, true)
    this.#layer.fill({ color: fillColor, alpha: fillAlpha })

    this.#layer.poly(verts, true)
    this.#layer.stroke({ color: strokeColor, alpha: strokeAlpha, width: STROKE_WIDTH })
  }

  // ── coordinate helpers ────────────────────────────────────────

  #axialToPixel(q: number, r: number, flat = false) {
    return flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
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
