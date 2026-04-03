// diamondcoreprocessor.com/input/selection/tile-selection.drone.ts
import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import { Application, Container, Point } from 'pixi.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import type { Axial } from '../navigation/hex-detector.js'
import type { SelectionService } from './selection.service.js'
import type { InputGate } from '../navigation/input-gate.service.js'
import type { OrderProjection } from '../history/order-projection.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[] }
type TileClickPayload = { q: number; r: number; label: string; index: number; ctrlKey: boolean; metaKey: boolean }

class TileSelectionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description =
    'Translates pointer clicks and drag gestures into tile selection changes.'

  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: Application['renderer'] | null = null

  #meshOffset = { x: 0, y: 0 }
  #cellCount = 0
  #cellLabels: string[] = []
  #cellCoords: Axial[] = []
  #occupiedByAxial = new Map<string, { index: number; label: string }>()

  // drag-select gesture state
  #dragActive = false
  #activePointerId: number | null = null
  #lastOp: 'add' | 'remove' | null = null
  #touched = new Set<string>()
  #justDragged = false

  // selection-mode drag: pending until pointer moves beyond threshold
  #pendingDrag = false
  #pendingStartLabel: string | null = null
  #pendingStartX = 0
  #pendingStartY = 0
  static #DRAG_THRESHOLD = 5 // px

  // move mode — drag-to-reorder
  #moveMode = false
  #reorderDragActive = false
  #reorderSourceLabel: string | null = null

  // navigation click guard — blocks clicks during layer transitions
  #navigationBlocked = false
  #navigationGuardTimer: ReturnType<typeof setTimeout> | null = null

  #gate: InputGate | null = null
  #listening = false
  #effectsRegistered = false

  // hex orientation
  #flat = false

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    selection: '@diamondcoreprocessor.com/SelectionService',
  }

  protected override listens = ['render:host-ready', 'render:cell-count', 'render:mesh-offset', 'render:set-orientation', 'tile:click', 'navigation:guard-start', 'navigation:guard-end', 'move:mode']
  protected override emits: string[] = []

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#canvas = payload.canvas
      this.#renderer = payload.renderer
      this.#gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null
      this.#attachListeners()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#cellCount = payload.count
      this.#cellLabels = payload.labels
      this.#cellCoords = payload.coords
      this.#rebuildOccupiedMap()
    })

    // click selection via tile:click effect from TileOverlayDrone
    this.onEffect<TileClickPayload>('tile:click', (payload) => {
      if (this.#justDragged) return
      if (this.#navigationBlocked) return
      const selection = this.#selection()
      if (!selection) return

      if (payload.ctrlKey || payload.metaKey) {
        selection.toggle(payload.label)
      } else if (selection.isSelected(payload.label)) {
        selection.setActive(payload.label)
      } else {
        selection.clear()
        selection.add(payload.label)
      }
    })

    // orientation
    this.onEffect<{ flat: boolean }>('render:set-orientation', (payload) => {
      this.#flat = payload.flat
    })

    // navigation guard — block clicks during layer transitions and reset drag state
    this.onEffect('navigation:guard-start', () => {
      this.#navigationBlocked = true
      // Abort any in-progress drag/pending gesture so stale state doesn't bleed into the new view
      if (this.#dragActive || this.#pendingDrag || this.#reorderDragActive) {
        this.#dragActive = false
        this.#pendingDrag = false
        this.#pendingStartLabel = null
        this.#reorderDragActive = false
        this.#reorderSourceLabel = null
        this.#activePointerId = null
        this.#lastOp = null
        this.#touched.clear()
        this.#gate?.release('tile-selection')
      }
      if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer)
      this.#navigationGuardTimer = setTimeout(() => { this.#navigationBlocked = false }, 200)
    })
    // authoritative move mode state from MoveDrone
    this.onEffect<{ active: boolean }>('move:mode', (payload) => {
      this.#moveMode = !!payload?.active
    })

    this.onEffect('navigation:guard-end', () => {
      this.#navigationBlocked = false
      if (this.#navigationGuardTimer) { clearTimeout(this.#navigationGuardTimer); this.#navigationGuardTimer = null }
    })
  }

  protected override dispose(): void {
    if (this.#listening) {
      document.removeEventListener('pointerdown', this.#onPointerDown)
      document.removeEventListener('pointermove', this.#onPointerMove)
      document.removeEventListener('pointerup', this.#onPointerUp)
      document.removeEventListener('pointercancel', this.#onPointerCancel)
      document.removeEventListener('keyup', this.#onKeyUp)
      window.removeEventListener('blur', this.#onBlur)
      this.#listening = false
    }
  }

  // ── listener setup ──────────────────────────────────────────

  #attachListeners(): void {
    if (this.#listening) return
    this.#listening = true
    document.addEventListener('pointerdown', this.#onPointerDown)
    document.addEventListener('pointermove', this.#onPointerMove)
    document.addEventListener('pointerup', this.#onPointerUp)
    document.addEventListener('pointercancel', this.#onPointerCancel)
    document.addEventListener('keyup', this.#onKeyUp)
    window.addEventListener('blur', this.#onBlur)
  }

  // ── pointer handlers ────────────────────────────────────────

  #onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    if (this.#navigationBlocked) return
    if (this.#dragActive || this.#reorderDragActive || this.#pendingDrag) return
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return

    const label = this.#labelAtClient(e.clientX, e.clientY)
    if (!label) return

    const selection = this.#selection()
    if (!selection) return

    if (!this.#gate?.claim('tile-selection')) return

    // move mode: start reorder drag when clicking a selected tile
    if (this.#moveMode && !e.ctrlKey && !e.metaKey && selection.isSelected(label)) {
      this.#activePointerId = e.pointerId
      this.#reorderDragActive = true
      this.#reorderSourceLabel = label
      return
    }

    // ctrl+drag: immediate paint (original behavior)
    if (e.ctrlKey || e.metaKey) {
      this.#activePointerId = e.pointerId
      this.#dragActive = true
      this.#touched.clear()
      this.#lastOp = selection.isSelected(label) ? 'remove' : 'add'
      this.#applyOp(label)
      return
    }

    // selection-mode drag: wait for movement threshold before committing to drag
    this.#activePointerId = e.pointerId
    this.#pendingDrag = true
    this.#pendingStartLabel = label
    this.#pendingStartX = e.clientX
    this.#pendingStartY = e.clientY
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.#activePointerId) return

    // pending drag: check if pointer moved beyond threshold to promote to real drag
    if (this.#pendingDrag) {
      const dx = e.clientX - this.#pendingStartX
      const dy = e.clientY - this.#pendingStartY
      if (dx * dx + dy * dy >= TileSelectionDrone.#DRAG_THRESHOLD * TileSelectionDrone.#DRAG_THRESHOLD) {
        this.#pendingDrag = false
        this.#dragActive = true
        this.#touched.clear()
        const selection = this.#selection()
        if (selection && this.#pendingStartLabel) {
          this.#lastOp = selection.isSelected(this.#pendingStartLabel) ? 'remove' : 'add'
          this.#applyOp(this.#pendingStartLabel)
        }
        const label = this.#labelAtClient(e.clientX, e.clientY)
        if (label) this.#applyOp(label)
      }
      return
    }

    if (!this.#dragActive || !this.#lastOp) return

    const label = this.#labelAtClient(e.clientX, e.clientY)
    if (label) this.#applyOp(label)
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.#activePointerId) return
    if (this.#reorderDragActive) {
      this.#endReorderDrag(e.clientX, e.clientY)
      return
    }

    // pending drag that never crossed threshold → treat as click (change active)
    if (this.#pendingDrag) {
      this.#pendingDrag = false
      this.#activePointerId = null
      this.#gate?.release('tile-selection')
      // don't set #justDragged — let tile:click through for active change
      return
    }

    this.#endDrag()
  }

  #onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.#activePointerId) return
    this.#reorderDragActive = false
    this.#reorderSourceLabel = null
    this.#pendingDrag = false
    this.#pendingStartLabel = null
    this.#endDrag()
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (!this.#dragActive) return
    if (e.key === 'Control' || e.key === 'Meta') this.#endDrag()
  }

  #onBlur = (): void => {
    if (this.#dragActive) this.#endDrag()
  }

  // ── drag helpers ────────────────────────────────────────────

  #endDrag(): void {
    if (this.#dragActive) {
      this.#gate?.release('tile-selection')
      this.#justDragged = true
      requestAnimationFrame(() => { this.#justDragged = false })
    }
    this.#dragActive = false
    this.#activePointerId = null
    this.#lastOp = null
    this.#touched.clear()
  }

  #applyOp(label: string): void {
    if (this.#touched.has(label)) return
    this.#touched.add(label)

    const selection = this.#selection()
    if (!selection || !this.#lastOp) return

    if (this.#lastOp === 'add') {
      if (!selection.isSelected(label)) selection.add(label)
    } else {
      if (selection.isSelected(label)) selection.remove(label)
    }
  }

  #selection(): SelectionService | undefined {
    return this.resolve<SelectionService>('selection')
  }

  // ── coordinate mapping (same pattern as TileOverlayDrone) ──

  #labelAtClient(cx: number, cy: number): string | undefined {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return undefined

    const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
    if (!detector) return undefined

    const pixiGlobal = this.#clientToPixiGlobal(cx, cy)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const meshLocalX = local.x - this.#meshOffset.x
    const meshLocalY = local.y - this.#meshOffset.y
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat)

    const entry = this.#occupiedByAxial.get(axialKey(axial.q, axial.r))
    if (!entry || entry.index >= this.#cellCount) return undefined
    return entry.label
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

  // ── reorder drag ───────────────────────────────────────────

  #endReorderDrag(cx: number, cy: number): void {
    const targetLabel = this.#labelAtClient(cx, cy)
    this.#reorderDragActive = false
    this.#activePointerId = null

    const selection = this.#selection()
    if (!targetLabel || !selection || targetLabel === this.#reorderSourceLabel) {
      this.#reorderSourceLabel = null
      return
    }

    // compute new order: move all selected labels to the target position
  const selected = new Set(selection.selected)
    const currentOrder = [...this.#cellLabels].slice(0, this.#cellCount)
    if (currentOrder.length === 0) { this.#reorderSourceLabel = null; return }

    const targetIdx = currentOrder.indexOf(targetLabel)
    if (targetIdx === -1) { this.#reorderSourceLabel = null; return }

    // remove selected from current positions
    const remaining = currentOrder.filter(l => !selected.has(l))
    // find where target ended up in remaining
    const insertIdx = remaining.indexOf(targetLabel)
    // insert selected right after target
    const selectedInOrder = currentOrder.filter(l => selected.has(l))
    remaining.splice(insertIdx + 1, 0, ...selectedInOrder)

    this.#reorderSourceLabel = null

    // persist via OrderProjection + trigger processor
    const orderProjection = (window as any).ioc?.get?.('@diamondcoreprocessor.com/OrderProjection') as OrderProjection | undefined
    if (orderProjection) {
      void orderProjection.reorder(remaining).then(() => void new hypercomb().act())
    }
  }

  #rebuildOccupiedMap(): void {
    this.#occupiedByAxial.clear()

    for (let i = 0; i < this.#cellCount; i++) {
      const coord = this.#cellCoords[i]
      const label = this.#cellLabels[i]
      if (!coord || !label) break
      this.#occupiedByAxial.set(axialKey(coord.q, coord.r), { index: i, label })
    }
  }
}

function axialKey(q: number, r: number): string {
  return `${q},${r}`
}

const _tileSelection = new TileSelectionDrone()
window.ioc.register('@diamondcoreprocessor.com/SelectionInputDrone', _tileSelection)
