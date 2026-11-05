// sequence/rail-projection.drone.ts
//
// THE PHONE READS THE HIVE AS A STRIP, AND NEVER WRITES IT.
//
// When enabled, tiles sit in three rails that run along the long side of the
// viewport: portrait = three columns you scroll up and down, landscape =
// three rows you scroll side to side, turning with the device. This drone
// owns that posture. It is a PROJECTION of the layer's order, never an
// arrangement: while it is active the renderer's slot grid
// (`AxialService.items`) is a rail matrix instead of the desktop's spiral, so
// every tile lands in a rail by the same `index` the desktop reads into the
// spiral. No layer is minted by looking, which is what lets the rails be on
// everywhere, always — enter a child, come back, reload: rails. The old lane
// mode was an arrangement COMMIT that rewrote every tile's index on each rung
// step and rotation and was thrown away on every navigation; that is why the
// phone kept falling back to a free map. See
// documentation/mobile-rails-projection.md.
//
// What it does when active:
//   • projects the rail matrix for the rung (3 / 2 / 1) and the device's long
//     axis into AxialService, and re-projects on rotation and rung change;
//   • engages the lane viewport (`setLaneViewport`) so pan, pinch, wheel and
//     every fit read the strip's axis — the finger travels ONE way only;
//   • READS the hex orientation, never owns it: point-top or flat-top, the
//     strip packs gap-free in either (matched pairings stay straight, the
//     cross pairings are plain honeycomb — see rail-grid.ts), and turning the
//     hive while the lanes are up re-projects them;
//   • publishes `lanes:changed {active, lanes}` for the chrome and
//     `render:grid-changed` for the renderer;
//   • PARKS THE VIEWPORT IT LEAVES. Each posture — the free map and the strip
//     — frames a page differently, so toggling remembers the zoom and
//     position of the posture being left, per page, and hands it back on the
//     render after the next toggle. The strip's start-edge fit is only the
//     landing for a posture this page has not been read in yet.
//
// `hc:lanes` is a participant-local on/off switch. No lane count is exposed:
// turning it on produces three centered lanes — fewer only when the page has
// fewer tiles than that, so one tile reads in one lane and two in two.

import { Drone, EffectBus } from '@hypercomb/core'
import { buildRailMatrix } from '../presentation/grid/rail-grid.js'
import {
  accumulateRailPan,
  clampRailShift,
  foldRailWheel,
  RAIL_WHEEL_REST,
  railPitch,
  railSeedScale,
  railShiftOffset,
  railStepColumns,
  railWheelPx,
  railWindowOf,
  railWindowSize,
  type RailWheel,
} from '../presentation/grid/rail-window.js'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../presentation/grid/hex-geometry.js'
import { safeArea } from '../navigation/zoom/safe-area.js'
import type { SlotMatrix } from '../presentation/grid/axial-service.js'
import { MOBILE_MODE_EFFECT } from '../preferences/mobile-pheromones.js'
import {
  laneStripHorizontal,
  setLaneViewport,
} from './lane-viewport-mode.js'

/** Participant-local lane-view toggle. It is off until the participant asks. */
export const RAILS_KEY = 'hc:lanes'
const LANES = 3
const ORIENTATION_KEY = 'hc:hex-orientation'
/** Settle time for a rotation burst before re-projecting. */
const REFLOW_MS = 160
/** Deferred so the re-render lands before the fit measures live bounds. */
const FIT_MS = 80
/** The fit's own margin, so the window is measured against the same area. */
const WINDOW_MARGIN_PX = 5
/** A pan gesture's leftover distance is forgotten after this long idle. */
const PAN_CARRY_MS = 400
/** A wheel step LANDS before the next one starts: when the renderer has
 *  painted it, but never sooner than this after it began (so a fast spin reads
 *  as steps, not a blur)… */
const LAND_MIN_MS = 70
/** …and never later than this, for a render that does not come (a hidden
 *  tab, a pass that was skipped). */
const LAND_MAX_MS = 450
/** Steps a spin may have in hand while one lands. More is inertia, not intent. */
const WHEEL_OWED_MAX = 4

type AxialLike = {
  project?: (matrix: SlotMatrix | null) => boolean
  readonly capacity?: number
  readonly projected?: boolean
}
type ZoomLike = { zoomToFit?: (snap?: boolean, source?: 'user' | 'auto' | 'auto-persist') => boolean | void }
type ViewportSnapshotLike = {
  zoom?: { scale: number; cx: number; cy: number; fit?: boolean }
  pan?: { dx: number; dy: number }
}
type ViewportLike = EventTarget & {
  readonly lastZoom?: ViewportSnapshotLike['zoom']
  readonly lastPan?: ViewportSnapshotLike['pan']
  setZoom?: (scale: number, cx: number, cy: number, fit?: boolean, source?: 'user' | 'auto' | 'auto-persist') => void
  setPan?: (dx: number, dy: number, source?: 'user' | 'auto' | 'auto-persist') => void
}
type Posture = 'map' | 'strip'
type HostLike = {
  app?: { stage?: { scale?: { x: number } } }
  renderer?: { screen: { width: number; height: number } }
  container?: { scale?: { x: number } }
  canvas?: HTMLCanvasElement
}

/** What the renderer (show-cell), the mover and the pan input ask of the
 *  strip's window over IoC — never through module scope, which each bundle
 *  inlines separately. */
export interface RailWindowApi {
  readonly active: boolean
  /** The tiles the window shows, in slot order, from the layer's dense order;
   *  null when no window is up (the caller reads the strip whole). */
  windowOf(dense: readonly string[]): string[] | null
  /** The layer's whole dense order with the window's tiles replaced by
   *  `reordered`; null if it is not a permutation of what the window shows. */
  mergeWindowOrder(reordered: readonly string[]): string[] | null
  /** Move the window `steps` steps along the strip. False at an end. */
  shiftBy(steps: number): boolean
  /** A wheel event, as the browser reports it. A notch is one step however
   *  many events carry it; each step lands before the next begins. */
  wheelBy(delta: number, deltaMode?: number): void
  /** Fold a pan distance (screen px along the strip) into steps. Returns the
   *  travel consumed: zero at an end, so a coast knows to stop. */
  panAlong(deltaPx: number): number
}

export const railsPreferenceOff = (): boolean => {
  try { return window.localStorage?.getItem(RAILS_KEY) !== 'on' } catch { return true }
}

export class RailProjectionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'arrangement'
  override description =
    'On a phone, projects the layer order into three rails that run along the long side of the screen and turn with the device — a reading posture, never a commit.'

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = [
    'render:host-ready', 'render:cell-count', MOBILE_MODE_EFFECT, 'render:set-orientation',
    'render:geometry-changed', 'lanes:toggle', 'lanes:set', 'lanes:step', 'lanes:off', 'lanes:on',
  ]
  protected override emits = [
    'lanes:changed', 'lanes:wheel', 'render:grid-changed', 'toast:show',
  ]

  #bound = false
  #active = false
  #lanes = 0
  #horizontal: boolean | null = null
  /** What the renderer is drawing, from the last `render:set-orientation`
   *  (or the standing preference before any). */
  #flat = false
  /** The orientation the current projection was packed for. */
  #projectedFlat: boolean | null = null
  #reflowTimer: ReturnType<typeof setTimeout> | null = null
  #fitTimer: ReturnType<typeof setTimeout> | null = null
  /** Owed on the render that follows: a toggle hands the posture arrived at
   *  its parked viewport (else fits); a rotation always fits. */
  #framePending: Posture | 'fit' | null = null
  /** The viewport each posture last had on each page, parked at the toggle
   *  that left it. Participant-local and in memory: a reload lands on the
   *  page's saved viewport as before. */
  #parked = new Map<string, ViewportSnapshotLike>()
  /** Tiles on the current page, from the last `render:cell-count`. */
  #count: number | null = null
  /** The page the strip was last fitted on arrival at. */
  #fittedLocation: string | null = null

  // ── the window over the strip ───────────────────────────────────────
  /** Hex size the mesh is drawn with (last `render:geometry-changed`). */
  #hexGeo: HexGeometry = DEFAULT_HEX_GEOMETRY
  #host: HostLike | null = null
  /** Slots the projection was built with: the columns that fit × lanes. */
  #capacity = 0
  /** Steps the window is shifted along the strip (0 = the strip's start). */
  #shift = 0
  /** Tiles in the layer, as last seen by the renderer's window read. */
  #total: number | null = null
  /** The layer's dense order, as last handed to `windowOf`. */
  #dense: readonly string[] | null = null
  #windowLocation: string | null = null
  #carry = 0
  #carryAt = 0
  /** The wheel gesture in progress, and the steps it still owes. */
  #wheel: RailWheel = RAIL_WHEEL_REST
  #owed = 0
  /** A step has moved the window and the renderer has not painted it yet. */
  #landing = false
  #steppedAt = 0
  #landTimer: ReturnType<typeof setTimeout> | null = null
  /** The scale the lane fit actually settled on, per shape it was measured
   *  in (#shapeKey), so walking from a three-lane page to a two-lane one and
   *  back finds both already measured. A shape not measured yet is seeded. */
  #measured = new Map<string, number>()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    this.#flat = this.#standingFlat()

    // The grid exists once the pixi host has initialised the AxialService —
    // `project()` is a no-op before that, so this is the first real apply.
    this.onEffect<HostLike>('render:host-ready', (host) => { this.#host = host ?? null; this.#apply() })
    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      if (!geo || !(geo.spacing > 0)) return
      this.#hexGeo = geo
      this.#measured.clear()
      if (this.#active) this.#apply()
    })
    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, () => this.#apply())
    // THE STRIP STARTS AT THE TOP, WHEREVER YOU ARRIVE. A projection change
    // asks the renderer for a full pass (OPFS reads, images) that lands well
    // after any fixed delay, so the fit that goes with it waits for THAT
    // render — fitting stale bounds fits the old shape. And every ARRIVAL at
    // a new page fits too: a page's own remembered viewport was framed on a
    // desktop map, and the phone reads a strip from its start edge.
    this.onEffect<{ count?: number; settled?: boolean }>('render:cell-count', ({ count, settled }) => {
      // The tiles of a wheel step are on screen: it has landed.
      if (settled !== false) this.#rendered()
      // Once the renderer reports the whole layer (`windowOf`), the count it
      // emits here is only the WINDOW's — never the layer's.
      if (typeof count === 'number' && Number.isFinite(count) && (!this.#active || this.#total === null)) this.#count = count
      const here = this.#locationKey()
      // Fewer tiles than lanes: the strip narrows to them (and widens back as
      // tiles arrive). The re-projection asks for another render, and whatever
      // frame is owed lands on that one. A partial pass is not yet a count.
      if (this.#active && settled !== false && this.#lanesFor() !== this.#lanes) {
        this.#apply()
        return
      }
      // A toggle landed: give the posture back the viewport it last had here.
      // The parked frame is absolute, so even a partial pass can take it.
      const owed = this.#framePending
      if (owed) {
        this.#framePending = null
        this.#fittedLocation = here
        if (owed !== 'fit' && this.#restore(owed, here)) return
        this.#fit()
        return
      }
      if (!this.#active) return
      const arrived = here !== this.#fittedLocation
      if (!arrived) return
      // A partial pass (tiles still streaming in) would fit a shorter strip;
      // wait for the settled one.
      if (settled === false) return
      this.#fittedLocation = here
      this.#fit()
    })

    this.onEffect<{ flat?: boolean }>('render:set-orientation', ({ flat }) => {
      const next = !!flat
      if (next === this.#flat) return
      this.#flat = next
      // The participant turned the hive: repack the lanes for it.
      if (this.#active) this.#apply()
    })

    // One switch, one layout. Older count/step emitters remain harmless
    // aliases during the transition, but can no longer change the layout.
    this.onEffect('lanes:toggle', () => { this.#setPreference(!this.#active); this.#apply(true) })
    this.onEffect('lanes:set', () => { this.#setPreference(true); this.#apply(true) })
    this.onEffect('lanes:step', () => { this.#setPreference(true); this.#apply(true) })
    this.onEffect('lanes:on', () => { this.#setPreference(true); this.#apply(true) })
    this.onEffect('lanes:off', () => { this.#setPreference(false); this.#apply() })

    // A rotation is a BURST — the bar collapses, the canvas re-lays out, and
    // the first notification can still carry the old metrics — so the check
    // waits for the settled size. `orientationchange` and `screen.orientation`
    // cover the devices where `resize` arrives late (iOS). Nothing has to be
    // re-packed and nothing is retried: the matrix is built from the device.
    window.addEventListener('resize', this.#onViewportChange)
    window.addEventListener('orientationchange', this.#onViewportChange)
    if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
      screen.orientation.addEventListener('change', this.#onViewportChange)
    }

    this.#apply()
  }

  /** Is the strip up right now? (For the harness and any surface that asks.) */
  public get active(): boolean { return this.#active }

  #locationKey(): string {
    const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  #wanted(): boolean {
    return !railsPreferenceOff()
  }

  #setPreference(on: boolean): void {
    try {
      window.localStorage?.setItem(RAILS_KEY, on ? 'on' : 'off')
    } catch { /* storage disabled — the choice holds for this session */ }
  }

  readonly #onViewportChange = (): void => {
    if (this.#reflowTimer !== null) clearTimeout(this.#reflowTimer)
    this.#reflowTimer = setTimeout(() => {
      this.#reflowTimer = null
      this.#apply()
    }, REFLOW_MS)
  }

  /** Bring the grid into line with what the phone wants right now. Idempotent:
   *  nothing is re-projected unless the rung or the long axis changed. `say`
   *  names the rung in a toast — a deliberate step deserves an answer, a
   *  rotation does not. */
  #apply(say = false): void {
    if (!this.#wanted()) { this.#release(); return }
    const lanes = this.#lanesFor()
    const horizontal = laneStripHorizontal()
    const flat = this.#flat
    // The capacity is part of the shape: a different screen, tile size or
    // orientation fits a different number of columns.
    const axial = this.resolve<AxialLike>('axial')
    if (!axial?.project) return
    const capacity = this.#windowCapacity(lanes, flat, horizontal, axial.capacity ?? 0)
    if (this.#active && this.#lanes === lanes && this.#horizontal === horizontal && this.#projectedFlat === flat
      && this.#capacity === capacity) {
      if (say) this.#toast(lanes)
      return
    }
    // Leaving the free map: park how this page was framed on it, before the
    // projection moves anything.
    const entering = !this.#active
    if (entering) this.#park('map')
    if (!axial.project(buildRailMatrix(lanes, flat, capacity, horizontal))) return

    this.#active = true
    this.#capacity = capacity
    this.#lanes = lanes
    this.#horizontal = horizontal
    this.#projectedFlat = flat
    setLaneViewport(true)
    this.emitEffect('render:grid-changed', { active: true, lanes, horizontal })
    this.#publish()
    // A rotation or a lane change re-projects the same posture: the strip is
    // re-fitted across its new shape. Only a toggle resumes a parked reading,
    // and a re-projection in the same render does not take that away.
    if (entering) this.#framePending = 'strip'
    else this.#framePending ??= 'fit'
    if (say) this.#toast(lanes)
  }

  #release(): void {
    if (!this.#active) return
    // Leaving the strip: park where the participant was reading it.
    this.#park('strip')
    const axial = this.resolve<AxialLike>('axial')
    axial?.project?.(null)
    this.#active = false
    this.#capacity = 0
    this.#shift = 0
    this.#total = null
    this.#dense = null
    this.#windowLocation = null
    this.#owed = 0
    this.#landing = false
    this.#clearLand()
    this.#lanes = 0
    this.#horizontal = null
    this.#projectedFlat = null
    setLaneViewport(false)
    this.emitEffect('render:grid-changed', { active: false, lanes: LANES, horizontal: null })
    this.#publish()
    this.#framePending = 'map'
  }

  /** Never more lanes than tiles: a page of one or two reads in that many.
   *  An unknown or empty count keeps the three. */
  #lanesFor(): number {
    const n = this.#total ?? this.#count
    return n !== null && n > 0 && n < LANES ? n : LANES
  }

  /** A strip reading is along one long axis and one lane count; the map is
   *  the same whichever way the phone is held. */
  #parkKey(posture: Posture, location: string): string {
    const shape = posture === 'strip'
      ? `${laneStripHorizontal() ? 'x' : 'y'}${this.#flat ? 'f' : 'p'}${this.#lanesFor()}`
      : ''
    return `${posture}${shape}
${location}`
  }

  #viewport(): ViewportLike | undefined {
    return window.ioc.get<ViewportLike>('@diamondcoreprocessor.com/ViewportPersistence')
  }

  /** Remember the viewport the page has right now, under the posture that
   *  framed it. Nothing to park until the page has a zoom at all. */
  #park(posture: Posture): void {
    const vp = this.#viewport()
    const zoom = vp?.lastZoom
    if (!zoom) return
    const snap: ViewportSnapshotLike = { zoom: { ...zoom } }
    if (vp?.lastPan) snap.pan = { ...vp.lastPan }
    this.#parked.set(this.#parkKey(posture, this.#locationKey()), snap)
  }

  /** Give a posture back the viewport it last had on this page. Persists as
   *  the strip's own fit does ('auto-persist': automatic, meant to stick) and
   *  announces a `restore` so the zoom and pan drones apply it. */
  #restore(posture: Posture, location: string): boolean {
    const snap = this.#parked.get(this.#parkKey(posture, location))
    const vp = this.#viewport()
    if (!snap?.zoom || !vp) return false
    const { scale, cx, cy, fit } = snap.zoom
    vp.setZoom?.(scale, cx, cy, fit === true, 'auto-persist')
    vp.setPan?.(snap.pan?.dx ?? 0, snap.pan?.dy ?? 0, 'auto-persist')
    vp.dispatchEvent(new CustomEvent('restore', { detail: snap }))
    return true
  }

  #standingFlat(): boolean {
    try { return window.localStorage?.getItem(ORIENTATION_KEY) === 'flat-top' } catch { return false }
  }

  /** The rung, for anything that shows it (the phone bar). Replayed by
   *  EffectBus, so chrome mounted later still reads it. */
  #publish(): void {
    this.emitEffect('lanes:changed', { active: this.#active, lanes: this.#active ? this.#lanes : LANES })
  }

  /** Fit ACROSS the strip and center it in the viewport — zoomToFit derives
   *  axis from the lane lock itself, so a plain fit is the right call. An
   *  automatic fit, so it persists as one ('auto-persist'): nobody gestured. */
  #fit(): void {
    if (this.#fitTimer !== null) clearTimeout(this.#fitTimer)
    this.#fitTimer = setTimeout(() => {
      this.#fitTimer = null
      // Snapped, not eased: the window is sized from the scale the fit settles
      // on, and an animation would leave that unknown for 200ms.
      const fitted = window.ioc.get<ZoomLike>('@diamondcoreprocessor.com/ZoomDrone')?.zoomToFit?.(true, 'auto-persist')
      if (fitted !== false) this.#remeasure()
    }, FIT_MS)
  }

  // ── window geometry ─────────────────────────────────────────────────

  #screenScale(): number {
    const c = this.#host?.container?.scale?.x ?? 1
    const s = this.#host?.app?.stage?.scale?.x ?? 1
    return c * s
  }

  /** The area the strip is read through: the fit's own safe area. */
  #safe(): { along: number; across: number } | null {
    const screen = this.#host?.renderer?.screen
    if (!screen) return null
    const a = safeArea(screen, this.#host?.canvas?.getBoundingClientRect() ?? null, WINDOW_MARGIN_PX)
    const w = a.right - a.left
    const h = a.bottom - a.top
    if (!(w > 0) || !(h > 0)) return null
    return laneStripHorizontal() ? { along: w, across: h } : { along: h, across: w }
  }

  #shapeKey(lanes: number, flat: boolean, horizontal: boolean): string {
    const screen = this.#host?.renderer?.screen
    return `${horizontal ? 'x' : 'y'}${flat ? 'f' : 'p'}${lanes}:${Math.round(screen?.width ?? 0)}x${Math.round(screen?.height ?? 0)}`
  }

  /** Slots that fit: the whole columns × lanes the safe area holds at the
   *  tile size the lane fit gives — measured once a fit has run for this
   *  shape, seeded from first principles before that. Never more than the
   *  spiral held (every slot keeps an `index` the allocator knows), never
   *  fewer than one column. `fallback` is the spiral's size, used alone
   *  before the host is up. */
  #windowCapacity(lanes: number, flat: boolean, horizontal: boolean, fallback: number): number {
    const safe = this.#safe()
    if (!safe) return Math.max(1, fallback)
    const key = this.#shapeKey(lanes, flat, horizontal)
    const scale = this.#measured.has(key)
      ? this.#measured.get(key)!
      : railSeedScale(safe.across, this.#hexGeo, lanes, flat, horizontal)
    const { capacity } = railWindowSize(safe.along, scale, this.#hexGeo, lanes, flat, horizontal)
    return Math.max(1, fallback > 0 ? Math.min(capacity, fallback) : capacity)
  }

  /** The fit has settled: size the window from the scale it actually chose.
   *  A different answer re-projects (and refits, centring the new block).
   *
   *  ONCE PER SHAPE (jwize 2026-11-05: "the wrong mode is starting and then
   *  lanes glitches it back … it renders spasmatically in succession between
   *  the two modes"). The fit's scale is not a fixed point of the window: a
   *  window of twelve fits a hair differently from a window of fourteen, so
   *  re-measuring after every fit re-projected, re-rendered and re-fitted on
   *  every arrival, the strip flipping between two shapes four times in
   *  ~350 ms. A shape (screen, lanes, orientation, axis) is measured on its
   *  first fit and kept; a later fit on the same shape is the same reading and
   *  moves nothing. A resize or a new tile size is a new shape (#shapeKey,
   *  `render:geometry-changed`) and is measured afresh. */
  #remeasure(): void {
    if (!this.#active || this.#projectedFlat === null || this.#horizontal === null) return
    const key = this.#shapeKey(this.#lanes, this.#projectedFlat, this.#horizontal)
    if (this.#measured.has(key)) return
    const scale = this.#screenScale()
    if (!(scale > 0)) return
    this.#measured.set(key, scale)
    this.#apply()
  }

  /** Pixels one shift step travels on screen. */
  #stepPx(): number {
    if (this.#projectedFlat === null || this.#horizontal === null) return 0
    return railPitch(this.#hexGeo, this.#projectedFlat, this.#horizontal).longPitch
      * railStepColumns(this.#lanes, this.#projectedFlat, this.#horizontal) * this.#screenScale()
  }

  // ── RailWindowApi ───────────────────────────────────────────────────

  public windowOf(dense: readonly string[]): string[] | null {
    if (!this.#active || this.#capacity <= 0 || this.#projectedFlat === null || this.#horizontal === null) return null
    // A new page starts at the strip's start.
    const here = this.#locationKey()
    if (here !== this.#windowLocation) {
      this.#windowLocation = here
      this.#shift = 0
      this.#total = null
      // What a spin still owed belonged to the page it left.
      this.#owed = 0
      this.#wheel = RAIL_WHEEL_REST
    }
    this.#dense = dense
    if (dense.length !== this.#total) {
      this.#total = dense.length
      const clamped = clampRailShift(this.#shift, dense.length, this.#capacity, this.#lanes, this.#projectedFlat, this.#horizontal)
      // The layer shrank under the window (or the lane count must narrow):
      // settle after this pass, never inside it.
      if (clamped !== this.#shift) {
        this.#shift = clamped
        queueMicrotask(() => this.#windowMoved())
      } else if (this.#lanesFor() !== this.#lanes) {
        queueMicrotask(() => this.#apply())
      }
    }
    return railWindowOf(dense, this.#shift, this.#capacity, this.#lanes, this.#projectedFlat, this.#horizontal)
  }

  public mergeWindowOrder(reordered: readonly string[]): string[] | null {
    const dense = this.#dense
    if (!this.#active || !dense || this.#projectedFlat === null || this.#horizontal === null) return null
    const from = railShiftOffset(this.#shift, this.#lanes, this.#projectedFlat, this.#horizontal)
    const shown = dense.slice(from, from + this.#capacity)
    if (shown.length !== reordered.length) return null
    const set = new Set(shown)
    for (const label of reordered) if (!set.delete(label)) return null
    return [...dense.slice(0, from), ...reordered, ...dense.slice(from + shown.length)]
  }

  public shiftBy(steps: number): boolean {
    if (!this.#active || this.#total === null || this.#projectedFlat === null || this.#horizontal === null) return false
    const next = clampRailShift(this.#shift + Math.trunc(steps), this.#total, this.#capacity, this.#lanes, this.#projectedFlat, this.#horizontal)
    if (next === this.#shift) return false
    this.#shift = next
    this.#windowMoved()
    return true
  }

  public panAlong(deltaPx: number): number {
    const stepPx = this.#stepPx()
    if (!(stepPx > 0)) return 0
    const now = performance.now()
    if (now - this.#carryAt > PAN_CARRY_MS) this.#carry = 0
    this.#carryAt = now
    const folded = accumulateRailPan(this.#carry, deltaPx, stepPx)
    this.#carry = folded.carry
    if (folded.steps === 0) return deltaPx
    if (this.shiftBy(folded.steps)) return deltaPx
    this.#carry = 0
    return 0
  }

  /** A wheel event. The gesture is measured in distance (`foldRailWheel`), so a
   *  notch is one step whether it arrives as one event or ten; the steps it
   *  adds are owed, and paid ONE AT A TIME — the next waits until the last has
   *  landed, so the tiles hold still on a spot instead of racing the render.
   *  Turning the wheel the other way cancels what was still owed, rather than
   *  walking it back. */
  public wheelBy(delta: number, deltaMode: number = 0): void {
    if (!this.#active) { this.#traceWheel(delta, 0, 'inactive'); return }
    const px = railWheelPx(delta, deltaMode)
    const { wheel, steps } = foldRailWheel(this.#wheel, px, performance.now())
    this.#wheel = wheel
    if (steps === 0) { this.#traceWheel(px, 0); return }
    if (this.#owed !== 0 && Math.sign(steps) !== Math.sign(this.#owed)) this.#owed = 0
    this.#owed = Math.max(-WHEEL_OWED_MAX, Math.min(WHEEL_OWED_MAX, this.#owed + steps))
    this.#advance()
    this.#traceWheel(px, steps)
  }

  /** What a wheel event did to the window, as STATE for the bridge's
   *  effect-last (nothing listens): the travel it carried, the steps it paid,
   *  and where the window stands. A wheel that moved nothing says here whether
   *  it paid no step (a small event), had no room (`total` ≤ `capacity`), or
   *  was held by a landing that never completed. */
  #traceWheel(px: number, steps: number, note?: string): void {
    this.emitEffect('lanes:wheel', {
      px: Math.round(px), steps, owed: this.#owed, landing: this.#landing, shift: this.#shift,
      total: this.#total, capacity: this.#capacity, ...(note ? { note } : {}),
    })
  }

  /** Pay one owed step, if none is landing. An end of the strip owes nothing more. */
  #advance(): void {
    if (this.#landing || this.#owed === 0) return
    const direction = Math.sign(this.#owed)
    this.#owed -= direction
    if (!this.shiftBy(direction)) { this.#owed = 0; return }
    this.#landing = true
    this.#steppedAt = performance.now()
    this.#clearLand()
    this.#landTimer = setTimeout(() => this.#landed(), LAND_MAX_MS)
  }

  /** The renderer settled: the step has landed once it has also stood for the
   *  minimum, and only then does the next owed step begin. */
  #rendered(): void {
    if (!this.#landing) return
    const wait = LAND_MIN_MS - (performance.now() - this.#steppedAt)
    this.#clearLand()
    if (wait > 0) this.#landTimer = setTimeout(() => this.#landed(), wait)
    else this.#landed()
  }

  #landed(): void {
    this.#clearLand()
    this.#landing = false
    this.#advance()
  }

  #clearLand(): void {
    if (this.#landTimer !== null) clearTimeout(this.#landTimer)
    this.#landTimer = null
  }

  /** The slots stay; the tiles in them changed. */
  #windowMoved(): void {
    this.emitEffect('render:grid-changed', {
      active: true, lanes: this.#lanes, horizontal: this.#horizontal, shift: this.#shift,
    })
  }

  #toast(lanes: number): void {
    const i18n = window.ioc.get<{ t?: (k: string, p?: Record<string, number>) => string }>('@hypercomb.social/I18n')
    const t = i18n?.t ? i18n.t('arrange.lanes', { count: lanes }) : ''
    const message = t && t !== 'arrange.lanes'
      ? t
      : lanes === 1 ? 'One lane — reading' : `${lanes} lanes`
    this.emitEffect('toast:show', { type: 'tip', message })
  }
}

const _railProjection = new RailProjectionDrone()
window.ioc.register('@diamondcoreprocessor.com/RailProjectionDrone', _railProjection)
// Seed the replayed channel so chrome reads a value before the first apply.
try { EffectBus.emit('lanes:changed', { active: false, lanes: LANES }) } catch { /* no bus */ }
