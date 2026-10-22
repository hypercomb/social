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
//   • owns the hex orientation at RENDER time (point-top strip in portrait,
//     flat-top in landscape) without touching the participant's standing
//     `hc:hex-orientation` preference, and hands it back on release;
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

type AxialLike = {
  project?: (matrix: SlotMatrix | null) => boolean
  readonly capacity?: number
  readonly projected?: boolean
}
type ZoomLike = { zoomToFit?: (snap?: boolean, source?: 'user' | 'auto' | 'auto-persist') => void }
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
    'lanes:toggle', 'lanes:set', 'lanes:step', 'lanes:off', 'lanes:on',
  ]
  protected override emits = [
    'lanes:changed', 'render:grid-changed', 'render:set-orientation', 'toast:show',
  ]

  #bound = false
  #active = false
  #lanes = 0
  #horizontal: boolean | null = null
  /** What the renderer is drawing, from the last `render:set-orientation`
   *  (or the standing preference before any). */
  #flat = false
  /** The participant's standing orientation, parked while the rail owns it. */
  #flatBefore: boolean | null = null
  /** Set around our own `render:set-orientation`, so the echo is not read as
   *  the participant rotating the hive under us. */
  #orientationEcho = false
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

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    this.#flat = this.#standingFlat()

    // The grid exists once the pixi host has initialised the AxialService —
    // `project()` is a no-op before that, so this is the first real apply.
    this.onEffect('render:host-ready', () => this.#apply())
    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, () => this.#apply())
    // THE STRIP STARTS AT THE TOP, WHEREVER YOU ARRIVE. A projection change
    // asks the renderer for a full pass (OPFS reads, images) that lands well
    // after any fixed delay, so the fit that goes with it waits for THAT
    // render — fitting stale bounds fits the old shape. And every ARRIVAL at
    // a new page fits too: a page's own remembered viewport was framed on a
    // desktop map, and the phone reads a strip from its start edge.
    this.onEffect<{ count?: number; settled?: boolean }>('render:cell-count', ({ count, settled }) => {
      if (typeof count === 'number' && Number.isFinite(count)) this.#count = count
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
      if (this.#orientationEcho) { this.#orientationEcho = false; this.#flat = next; return }
      this.#flat = next
      if (!this.#active) return
      // The participant rotated the hive while the rail owns the orientation.
      // Their choice is remembered for the release; the strip keeps the
      // orientation that packs it straight.
      this.#flatBefore = next
      if (next !== this.#horizontal) this.#orient(this.#horizontal === true)
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
    if (this.#active && this.#lanes === lanes && this.#horizontal === horizontal) {
      if (say) this.#toast(lanes)
      return
    }
    const axial = this.resolve<AxialLike>('axial')
    if (!axial?.project) return
    const capacity = Math.max(1, axial.capacity ?? 0)
    // Leaving the free map: park how this page was framed on it, before the
    // projection moves anything.
    const entering = !this.#active
    if (entering) this.#park('map')
    if (!axial.project(buildRailMatrix(lanes, horizontal, capacity))) return

    this.#active = true
    this.#lanes = lanes
    this.#horizontal = horizontal
    setLaneViewport(true)
    this.#orient(horizontal)
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
    this.#lanes = 0
    this.#horizontal = null
    setLaneViewport(false)
    const before = this.#flatBefore
    this.#flatBefore = null
    if (before !== null && before !== this.#flat) {
      this.#orientationEcho = true
      this.emitEffect('render:set-orientation', { flat: before })
    }
    this.emitEffect('render:grid-changed', { active: false, lanes: LANES, horizontal: null })
    this.#publish()
    this.#framePending = 'map'
  }

  /** Never more lanes than tiles: a page of one or two reads in that many.
   *  An unknown or empty count keeps the three. */
  #lanesFor(): number {
    const n = this.#count
    return n !== null && n > 0 && n < LANES ? n : LANES
  }

  /** A strip reading is along one long axis and one lane count; the map is
   *  the same whichever way the phone is held. */
  #parkKey(posture: Posture, location: string): string {
    const shape = posture === 'strip' ? `${laneStripHorizontal() ? 'x' : 'y'}${this.#lanesFor()}` : ''
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

  /** The strip is only straight one way: point-top rows for a vertical strip,
   *  flat-top columns for a horizontal one. Runtime only — the standing
   *  preference in localStorage is never written, so releasing the rail gives
   *  the participant's own choice back untouched. */
  #orient(flat: boolean): void {
    if (this.#flatBefore === null) this.#flatBefore = this.#flat
    if (this.#flat === flat) return
    this.#orientationEcho = true
    this.emitEffect('render:set-orientation', { flat })
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
      window.ioc.get<ZoomLike>('@diamondcoreprocessor.com/ZoomDrone')?.zoomToFit?.(false, 'auto-persist')
    }, FIT_MS)
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
