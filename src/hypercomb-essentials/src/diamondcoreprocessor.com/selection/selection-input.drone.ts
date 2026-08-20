// diamondcoreprocessor.com/selection/selection-input.drone.ts
import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import { Application, Container, Point } from 'pixi.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import type { Axial } from '../navigation/hex-detector.js'
import type { SelectionService } from './selection.service.js'
import type { InputGate } from '../navigation/input-gate.service.js'
import type { OrderProjection } from '../history/order-projection.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[]; externalLabels?: string[] }

/** SwarmAdoptDrone, asked STRUCTURALLY. An older bundle (or a hive with the
 *  sharing drones absent) simply resolves undefined — then there is no wand
 *  and ctrl behaves exactly as it always did. */
const SWARM_ADOPT_KEY = '@diamondcoreprocessor.com/SwarmAdoptDrone'
type WandOracle = { wandEligible?: (label: string) => boolean }
/** `toggle` carries the ADD-TO-SET intent that ctrl/meta expresses on a
 *  pointer. A finger has no modifier keys, so sampling mode sets it instead —
 *  the intent is the same ("pick this one too"), only the way of saying it
 *  differs. Without it a tap would REPLACE the set and picking a second tile
 *  would drop the first. */
type TileClickPayload = { q: number; r: number; label: string; index: number; ctrlKey: boolean; metaKey: boolean; toggle?: boolean }

class SelectionInputDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description =
    'Translates pointer clicks and drag gestures into tile selection changes — and, over somebody else\'s tiles in a swarm, into the wand that takes them; with a pheromone bouquet in hand, ctrl+click becomes the collecting walk that gathers tiles into the grouping (select stands down for both gestures).'

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

  // ── THE WAND ────────────────────────────────────────────────────────
  // In a swarm, ctrl+press over somebody else's tile MEANS take-this. The
  // gesture is a wand: the tile under the press is taken, and so is every
  // witnessed tile the pointer crosses while it stays down. For its whole
  // duration the ordinary select is suppressed — adoption supplants it, and
  // two meanings on one gesture is how they get in each other's way.
  #wandActive = false     // a wand gesture is in progress
  #wandArmed = false      // ...and the modifier is still down (sweeping)

  // ── THE COLLECTING WALK ─────────────────────────────────────────────
  // While the Pheromones window has a bouquet in hand (`tags:apply-pending`
  // active), ctrl+press over a tile COLLECTS it into the grouping — it
  // stages the tile (`tags:apply-paint`; Done commits) instead of toggling
  // the selection. Ctrl is the canonical add-to-set gesture, and with marks
  // in hand the set being built IS the grouping, so select stands down for
  // the gesture exactly as it does for the wand. A drag sweeps, with the
  // intent fixed at press time (an uncollected first tile collects, a
  // collected one releases); walking the hive stays untouched — plain
  // clicks navigate, there is no brush and no takeover.
  #scentArmed = false
  /** Tiles already in the grouping, mirrored from `tags:apply-pending
   *  {cells}` — a ctrl+press on one of them releases it instead. */
  #scentStaged = new Set<string>()
  /** An in-flight collect stroke; `sweeping` drops on modifier keyup (the
   *  gesture itself ends on pointerup, which must still swallow the trailing
   *  click — same shape as the wand). */
  #scentStroke: { add: boolean; sweeping: boolean } | null = null
  /** Labels the renderer reported as somebody else's (`render:cell-count`
   *  externalLabels) — the wand never touches a tile of your own. */
  #externalLabels = new Set<string>()
  /** An armed picking mode (the swarm's pick-tiles pill, the mobile
   *  picker) is a deliberate build-a-set session with its own keep verb.
   *  The wand stands down inside one rather than folding behind its back.
   *  Two modes, two flags: one disarming must not clear the other's. */
  #sampleArmed = false
  #selectModeArmed = false

  // ── THE SWAP ────────────────────────────────────────────────────────
  // The clipboard window is open. On a pointer, a click on a tile TAKES it
  // into the window and ctrl+click WALKS in — neither is a selection, so
  // select stands down for the whole mode exactly as it does for the wand.
  // Without this the ctrl press would still start a paint/wand/collect
  // stroke underneath a gesture that means something else entirely.
  #clipboardArmed = false

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

  protected override listens = ['render:host-ready', 'render:cell-count', 'render:mesh-offset', 'render:set-orientation', 'tile:click', 'navigation:guard-start', 'navigation:guard-end', 'move:mode', 'move:drag-end', 'sample:mode', 'select:mode', 'tags:apply-pending', 'clipboard:open']
  protected override emits: string[] = ['selection:painted', 'swarm:wand', 'tags:apply-paint']

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
      this.#externalLabels = new Set(payload.externalLabels ?? [])
      this.#rebuildOccupiedMap()
    })

    // An explicit picking mode is armed — the wand yields to it (see
    // #pickingArmed). Both modes suppress navigation and turn taps into
    // picks; the keep verb they offer is the acquisition path there.
    this.onEffect<{ active?: boolean }>('sample:mode', (p) => { this.#sampleArmed = !!p?.active })
    this.onEffect<{ active?: boolean }>('select:mode', (p) => { this.#selectModeArmed = !!p?.active })

    // Swap mode on/off — announced by the clipboard window itself
    // (last-value replayed, so a late drone is current at once).
    this.onEffect<{ open?: boolean }>('clipboard:open', (p) => { this.#clipboardArmed = p?.open === true })

    // A bouquet in hand (sticky, PheromoneTilesDrone owns it). `cells` is the
    // grouping so far — a ctrl+press needs it to choose collect vs release.
    this.onEffect<{ active?: boolean; cells?: string[] }>('tags:apply-pending', (p) => {
      this.#scentArmed = p?.active === true
      this.#scentStaged = new Set(Array.isArray(p?.cells) ? p.cells : [])
      if (!this.#scentArmed) this.#scentStroke = null
    })

    // click selection via tile:click effect from TileOverlayDrone
    this.onEffect<TileClickPayload>('tile:click', (payload) => {
      if (this.#justDragged) return
      if (this.#navigationBlocked) return
      const selection = this.#selection()
      if (!selection) return

      if (payload.ctrlKey || payload.metaKey || payload.toggle) {
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
      if (this.#dragActive || this.#pendingDrag || this.#reorderDragActive || this.#wandActive || this.#scentStroke) {
        this.#dragActive = false
        this.#pendingDrag = false
        this.#pendingStartLabel = null
        this.#reorderDragActive = false
        this.#reorderSourceLabel = null
        this.#wandActive = false
        this.#wandArmed = false
        this.#scentStroke = null
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

    // A pointer drag-to-move/copy just ended — the trailing native click
    // would otherwise re-toggle the dragged tile's selection. Suppress the
    // next tile:click, the same guard our own drag-select uses (#endDrag).
    this.onEffect('move:drag-end', () => {
      this.#justDragged = true
      requestAnimationFrame(() => { this.#justDragged = false })
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
    // Swap mode owns every pointer gesture on a tile while the clipboard
    // window is open (take on click, walk on ctrl+click). Standing down here
    // keeps the wand, the collecting walk and the paint out of its way — one
    // press, one meaning.
    if (this.#clipboardArmed) return
    if (this.#navigationBlocked) return
    if (this.#dragActive || this.#reorderDragActive || this.#pendingDrag) return
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return
    if (e.target !== this.#canvas) return

    const label = this.#labelAtClient(e.clientX, e.clientY)
    if (!label) return

    const selection = this.#selection()
    if (!selection) return

    if (!this.#gate?.claim('tile-selection')) return

    // ── THE WAND comes FIRST ────────────────────────────────────────
    // Ctrl+press over somebody else's tile is not a selection at all: it
    // is "this one is mine now". It outranks every other reading of the
    // same press — the copy-drag hand-off below, the paint, and the
    // trailing ctrl-click's toggle (suppressed in #endWand) — because in
    // a swarm that IS what ctrl+press means, and a second meaning riding
    // along would only get in its way.
    if ((e.ctrlKey || e.metaKey) && this.#wandEligible(label)) {
      this.#activePointerId = e.pointerId
      this.#wandActive = true
      this.#wandArmed = true
      this.#touched.clear()
      this.#sweepWand(label)
      return
    }

    // ── THE COLLECTING WALK comes next ──────────────────────────────
    // A bouquet in hand: ctrl+press collects this tile into the grouping
    // (or releases a collected one), a drag sweeps the same intent. It
    // outranks the copy-drag hand-off and the select paint below — while
    // marks are in hand, ctrl means "this one too", into the GROUPING.
    if ((e.ctrlKey || e.metaKey) && this.#scentArmed) {
      this.#activePointerId = e.pointerId
      this.#scentStroke = { add: !this.#scentStaged.has(label), sweeping: true }
      this.#touched.clear()
      this.#collectScent(label)
      return
    }

    // Press on an already-selected tile — hand off to DesktopMoveInput, which
    // owns drag-to-move (plain) AND Ctrl-drag-to-COPY. This now fires for Ctrl
    // too: Ctrl-drag a selected tile = copy, not paint. A Ctrl-CLICK (no drag)
    // to toggle/deselect is still delivered via tile:click on pointerup, and a
    // real drag suppresses that click (move:drag-end → #justDragged).
    if (selection.isSelected(label)) {
      this.#gate?.release('tile-selection')
      return
    }

    // ctrl+drag on an UNSELECTED tile: immediate paint (original behavior)
    if (e.ctrlKey || e.metaKey) {
      this.#activePointerId = e.pointerId
      this.#dragActive = true
      this.#touched.clear()
      this.#lastOp = selection.isSelected(label) ? 'remove' : 'add'
      this.#applyOp(label)
      return
    }

    // no ctrl/meta held — release gate and let tile:click handle it
    this.#gate?.release('tile-selection')
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.#activePointerId) return

    // A wand in progress: every witnessed tile the pointer crosses is taken
    // (once — #touched). Dragging is optional; a plain press already took
    // the first one.
    if (this.#wandActive) {
      const label = this.#labelAtClient(e.clientX, e.clientY)
      if (label) this.#sweepWand(label)
      return
    }

    // A collect stroke in progress: every tile the pointer crosses joins the
    // grouping (or leaves it — the intent was fixed at press), once each.
    if (this.#scentStroke) {
      const label = this.#labelAtClient(e.clientX, e.clientY)
      if (label) this.#collectScent(label)
      return
    }

    // pending drag: check if pointer moved beyond threshold to promote to real drag
    if (this.#pendingDrag) {
      const dx = e.clientX - this.#pendingStartX
      const dy = e.clientY - this.#pendingStartY
      if (dx * dx + dy * dy >= SelectionInputDrone.#DRAG_THRESHOLD * SelectionInputDrone.#DRAG_THRESHOLD) {
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
    if (this.#wandActive) { this.#endWand(); return }
    if (this.#scentStroke) { this.#endScentStroke(); return }
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
    if (this.#wandActive) { this.#endWand(); return }
    if (this.#scentStroke) { this.#endScentStroke(); return }
    this.#reorderDragActive = false
    this.#reorderSourceLabel = null
    this.#pendingDrag = false
    this.#pendingStartLabel = null
    this.#endDrag()
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== 'Control' && e.key !== 'Meta') return
    // Releasing the modifier mid-wand stops the sweep but does NOT end the
    // gesture: the pointer is still down, and the click it will fire must
    // still be swallowed (#endWand on pointerup does that). Ending here
    // instead let a trailing plain click land as a fresh selection.
    if (this.#wandActive) { this.#wandArmed = false; return }
    // Same rule for a collect stroke: stop sweeping, but the gesture ends on
    // pointerup so the trailing click is still swallowed there.
    if (this.#scentStroke) { this.#scentStroke.sweeping = false; return }
    if (this.#dragActive) this.#endDrag()
  }

  #onBlur = (): void => {
    if (this.#wandActive) { this.#endWand(); return }
    if (this.#scentStroke) { this.#endScentStroke(); return }
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

  // ── wand helpers ───────────────────────────────────────────

  /** Is this press a wand? Two keys, both cheap and synchronous so the
   *  decision can be made ON POINTERDOWN: the renderer says the tile is
   *  somebody else's (external), and SwarmAdoptDrone says a live peer
   *  offers it here in a zone. Either one alone is not enough — a stack
   *  variant is external without being takeable, and a name you already
   *  hold can be offered without being external. */
  #wandEligible(label: string): boolean {
    if (this.#sampleArmed || this.#selectModeArmed) return false
    if (!this.#externalLabels.has(label)) return false
    const adopt = window.ioc?.get?.(SWARM_ADOPT_KEY) as WandOracle | undefined
    return !!adopt?.wandEligible?.(label)
  }

  /** One tile, once per gesture. Ineligible tiles the sweep crosses are
   *  marked touched too, so a long drag over your own tiles costs one
   *  check each and never re-asks. */
  #sweepWand(label: string): void {
    if (!this.#wandArmed) return
    if (this.#touched.has(label)) return
    this.#touched.add(label)
    if (!this.#wandEligible(label)) return
    // SwarmAdoptDrone owns what taking means (the one-level fold, the
    // tombstone clear, every guard) — this drone only says where the wand
    // touched. NOTHING is added to the selection: the wand supplants it.
    //
    // TRANSIENT, deliberately: a gesture is a moment, not a state. A
    // replayed last-value would re-take a tile for any listener that
    // subscribes later (a re-registered bundle), including one the
    // participant has since given back.
    EffectBus.emitTransient('swarm:wand', { label })
  }

  #endWand(): void {
    if (!this.#wandActive) return
    this.#wandActive = false
    this.#wandArmed = false
    this.#activePointerId = null
    this.#touched.clear()
    this.#gate?.release('tile-selection')
    // The gesture's trailing click must not toggle a selection — the same
    // one-frame guard the paint drag uses.
    this.#justDragged = true
    requestAnimationFrame(() => { this.#justDragged = false })
  }

  // ── collecting-walk helpers ────────────────────────────────────────

  /** One tile, once per stroke: stage it into (or release it from) the
   *  grouping. Pure intent on the wire — PheromoneTilesDrone stages, the hive
   *  marks it, the panel lists it, and only Done writes. */
  #collectScent(label: string): void {
    const stroke = this.#scentStroke
    if (!stroke?.sweeping) return
    if (this.#touched.has(label)) return
    this.#touched.add(label)
    EffectBus.emit('tags:apply-paint', { label, add: stroke.add })
  }

  /** The pointer came up: the stroke is over. The collected tiles persist —
   *  they are the grouping, and Done in the panel commits them — only the
   *  gesture state ends here. Trailing-click guard as for the wand. */
  #endScentStroke(): void {
    if (!this.#scentStroke) return
    this.#scentStroke = null
    this.#activePointerId = null
    this.#touched.clear()
    this.#gate?.release('tile-selection')
    this.#justDragged = true
    requestAnimationFrame(() => { this.#justDragged = false })
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

    // The paint reports what it painted. It no longer carries adoption:
    // taking somebody else's tile is the WAND (see #sweepWand), a gesture
    // of its own that suppresses selection instead of riding on it — one
    // press must not mean two things at once.
    EffectBus.emit('selection:painted', { label, op: this.#lastOp })
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

const _tileSelection = new SelectionInputDrone()
window.ioc.register('@diamondcoreprocessor.com/SelectionInputDrone', _tileSelection)
