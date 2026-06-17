// diamondcoreprocessor.com/input/zoom/zoom.drone.ts
import { Drone, EffectBus, type KeyMapLayer } from '@hypercomb/core'
import { Application, Container, Point } from 'pixi.js'
import type { HostReadyPayload } from '../../presentation/tiles/pixi-host.worker.js'
import type { HexGeometry } from '../../presentation/grid/hex-geometry.js'
import { DEFAULT_HEX_GEOMETRY } from '../../presentation/grid/hex-geometry.js'
import type { InputGate } from '../input-gate.service.js'
import { readViewportAt, writeViewportAt } from '../../editor/viewport-store.js'

type Pt = { x: number; y: number }

// -------------------------------------------------
// ViewportPersistence — thin write coordinator
// -------------------------------------------------
// Inlined here so Angular's esbuild cannot tree-shake the IoC registration.
// Both ZoomDrone and PanningDrone report viewport state here. It is
// persisted by LOCATION SIGNATURE into the flat, non-history
// `__viewport__/<sig>` store (see editor/viewport-store.ts) — never into
// the content-addressed layer, so panning/zooming can't skew a layer's
// signature or pollute undo/redo.

// `fit: true` marks a zoom that came from zoomToFit (or auto-fit), so the
// next viewport-size change can recompute the fit transform instead of
// applying the stale (cx, cy) — those coords were derived from the old
// safe area and otherwise leave content off-center / "shrunk" after a
// resize, fullscreen toggle, or reload at a different viewport size.
// All manual zoom paths (mousewheel, pinch, control-bar, animated tick)
// save with fit unset, which clears the flag.
export type ZoomSnapshot = { scale: number; cx: number; cy: number; fit?: boolean }
export type PanSnapshot = { dx: number; dy: number }
export type MeshOffsetSnapshot = { x: number; y: number }
export type ViewportSnapshot = { zoom?: ZoomSnapshot; pan?: PanSnapshot; meshOffset?: MeshOffsetSnapshot }

/**
 * Source of a viewport setter call.
 * - `'user'`: result of an explicit user gesture (mousewheel, pinch,
 *   spacebar pan, touch pan, /fit shortcut). Schedules a debounced
 *   commit to the new tile-properties-backed viewport store so the
 *   state persists across navigation and reload.
 * - `'auto'` (default): automatic / programmatic write (refit-on-entry,
 *   auto-fit-first-add, init defaults, fullscreen recenter). Updates
 *   in-memory state only; does NOT trigger the persistent commit.
 *   Otherwise re-entering a layer would commit a fresh fit-snapshot
 *   on every visit and clobber the user's saved pan.
 */
export type ViewportSource = 'user' | 'auto'

export class ViewportPersistence extends EventTarget {

  constructor() {
    super()
    // Pagehide is the canonical "user is leaving" signal — flush any
    // pending write so a gesture-then-close doesn't lose the last frame.
    // Async OPFS writes inside pagehide may not always complete, but the
    // ~200ms debounce already keeps the at-risk window small.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.#flushNow)
      // visibilitychange covers tab-switch / mobile app-switch where
      // pagehide does not always fire. Same fire-and-forget semantics.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.#flushNow()
      })
    }
  }

  // In-memory mirror of the current location's viewport. Synchronous
  // getters (read by applyCenter on resize/boot) serve from here; the
  // sig-keyed `__viewport__` store is the source of truth across reloads.
  #lastRead: ViewportSnapshot = {}
  #reading: Promise<ViewportSnapshot> | null = null
  #suspended = false

  // ── Persist coordination ──────────────────────────────────────────
  //
  // Viewport is committed to `__viewport__/<sign(segments)>` (flat,
  // non-history) keyed by the CURRENT location. Only `source: 'user'`
  // setter calls schedule a commit — auto sources (refit-on-entry,
  // init defaults) update the in-memory mirror only, so re-entering a
  // layer can't clobber the user's saved gesture. ~200ms debounce; a
  // nav that changes location flushes the pending commit first so the
  // gesture isn't stranded in the timer.
  #currentSegments: readonly string[] | null = null
  #commitTimer: ReturnType<typeof setTimeout> | null = null
  #COMMIT_DEBOUNCE_MS = 200

  /** Suspend persistence — viewport changes are applied visually but not saved. */
  suspend = (): void => { this.#suspended = true }
  /** Resume persistence. */
  resume = (): void => { this.#suspended = false }

  // -- drone-facing api --

  // Setter contract: update the in-memory mirror synchronously (the
  // source for the getters below) and, for user gestures, schedule a
  // debounced commit to the sig-keyed store.

  setZoom = (scale: number, cx: number, cy: number, fit = false, source: ViewportSource = 'auto'): void => {
    if (this.#suspended) return
    // Strip `fit: false` from the stored snapshot to keep JSON minimal —
    // absence == not a fit. Only set the property when truly a fit.
    const zoom = fit ? { scale, cx, cy, fit: true } : { scale, cx, cy }
    this.#lastRead = { ...this.#lastRead, zoom }
    if (source === 'user') this.#scheduleStoreCommit()
  }

  setPan = (dx: number, dy: number, source: ViewportSource = 'auto'): void => {
    if (this.#suspended) return
    const pan = { dx, dy }
    this.#lastRead = { ...this.#lastRead, pan }
    if (source === 'user') this.#scheduleStoreCommit()
  }

  /** Persist the renderer's mesh offset (its position inside the layer
   *  container). Saved per-layer so the position stays fixed across
   *  navigation; never auto-changed by the renderer. Only updated when
   *  the user explicitly recenters via the navigation command. */
  setMeshOffset = (x: number, y: number, source: ViewportSource = 'auto'): void => {
    if (this.#suspended) return
    const meshOffset = { x, y }
    this.#lastRead = { ...this.#lastRead, meshOffset }
    if (source === 'user') this.#scheduleStoreCommit()
  }

  get lastPan(): PanSnapshot | undefined {
    return this.#lastRead.pan
  }

  get lastZoom(): ZoomSnapshot | undefined {
    return this.#lastRead.zoom
  }

  get lastMeshOffset(): MeshOffsetSnapshot | undefined {
    return this.#lastRead.meshOffset
  }

  read = (): Promise<ViewportSnapshot> => {
    // deduplicate concurrent reads (both drones call read() on host-ready)
    if (this.#reading) return this.#reading

    const segs = this.#currentSegments ?? this.#segmentsFromLineage()
    if (!segs) return Promise.resolve({})

    this.#reading = (async () => {
      try {
        const snap = await readViewportAt(segs)
        // Only adopt into the cache if we're still at this location — a
        // nav during the read must not let stale data overwrite the new
        // location's snapshot.
        if (this.#sameLocation(segs)) this.#lastRead = snap ?? {}
        return snap ?? {}
      } catch {
        return {} as ViewportSnapshot
      }
    })()

    void this.#reading.finally(() => {
      this.#reading = null
    })

    return this.#reading
  }

  /** Resolve the current location's lineage segments (root = []). Used
   *  as a fallback when show-cell hasn't called setCurrentLocation yet
   *  (very first read at boot). */
  #segmentsFromLineage = (): readonly string[] | null => {
    const lineage = (window as any).ioc?.get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const segs = lineage?.explorerSegments?.()
    return segs ? [...segs] : null
  }

  #sameLocation = (segs: readonly string[]): boolean => {
    const cur = this.#currentSegments
    return !!cur && cur.length === segs.length && cur.every((s, i) => s === segs[i])
  }

  // -- internals --

  /** Flush any pending store commit immediately. Used by pagehide /
   *  visibilitychange so the user's last gesture isn't stranded in the
   *  debounce timer when the tab closes or backgrounds. */
  #flushNow = (): void => {
    this.#flushStoreCommit()
  }

  /**
   * Set the location this VP instance is reporting to. Called by show-cell
   * on every layer change. Flushes any pending viewport commit for the OLD
   * location before switching, so a gesture-then-nav doesn't strand the
   * gesture in the debounce timer.
   */
  setCurrentLocation = (segments: readonly string[] | null): void => {
    const next = segments ? [...segments] : null
    const prev = this.#currentSegments
    // Identity-by-value compare; nav events that re-emit the same segments
    // shouldn't fire a spurious flush.
    if (prev && next && prev.length === next.length && prev.every((s, i) => s === next![i])) return
    if (prev) this.#flushStoreCommit()
    this.#currentSegments = next
    // Drop any in-flight read for the previous location and load the new
    // one into the in-memory cache so synchronous getters (lastPan /
    // lastZoom, read by applyCenter on resize/boot) reflect where we are.
    this.#reading = null
    // Location changed — tell ZoomDrone to cancel any in-flight zoom
    // animation so it can't tick stale mid-frame values onto the new
    // layer's container. (Formerly fired by setDir/setDirSilent.)
    this.dispatchEvent(new CustomEvent('dir-change'))
    if (next) void this.read()
  }

  #scheduleStoreCommit = (): void => {
    if (this.#commitTimer !== null) clearTimeout(this.#commitTimer)
    this.#commitTimer = setTimeout(() => {
      this.#commitTimer = null
      void this.#commitToStore()
    }, this.#COMMIT_DEBOUNCE_MS)
  }

  #flushStoreCommit = (): void => {
    if (this.#commitTimer !== null) {
      clearTimeout(this.#commitTimer)
      this.#commitTimer = null
      void this.#commitToStore()
    }
  }

  #commitToStore = async (): Promise<void> => {
    // Prefer the location show-cell told us about; fall back to the live
    // lineage so a gesture that fires before setCurrentLocation lands
    // still persists to the right place instead of being silently lost.
    const segs = this.#currentSegments ?? this.#segmentsFromLineage()
    if (!segs) return
    // Snapshot the current in-memory state and commit it. Subsequent
    // user-source setters will re-schedule another commit naturally.
    const snapshot: ViewportSnapshot = {
      zoom: this.lastZoom,
      pan: this.lastPan,
      meshOffset: this.lastMeshOffset,
    }
    try {
      await writeViewportAt(segs, snapshot)
    } catch (err) {
      console.warn('[viewport] commit failed:', err)
    }
  }
}

// -------------------------------------------------
// ZoomDrone
// -------------------------------------------------

export class ZoomDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  public override description =
    'Handles pinch, wheel, and keyboard zoom — owns the viewport scale.'
  public override effects = ['render'] as const

  private app: Application | null = null
  private renderContainer: Container | null = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: Application['renderer'] | null = null

  private readonly minScale = 0.2
  private readonly maxScale = 12

  private vp: ViewportPersistence | null = null

  // ── smooth zoom animation state ──
  #animFrameId: number | null = null
  #animStartTime = 0
  #animStartScale = 1
  #animTargetScale = 1
  #animPivotClient: Pt = { x: 0, y: 0 }
  // snapshot of the local point under the pivot at animation start
  #animPivotLocal: Pt = { x: 0, y: 0 }
  readonly #animDuration = 150 // ms — short for crisp feel

  protected override deps = {
    mouseWheel: '@diamondcoreprocessor.com/MousewheelZoomInput',
    pinchZoom: '@diamondcoreprocessor.com/PinchZoomInput',
    coordinator: '@diamondcoreprocessor.com/TouchGestureCoordinator',
    touchPan: '@diamondcoreprocessor.com/TouchPanInput',
  }
  protected override listens = ['render:host-ready', 'editor:mode', 'keymap:invoke', 'render:geometry-changed', 'render:cell-count']

  #effectsRegistered = false
  #hexGeo: HexGeometry = DEFAULT_HEX_GEOMETRY
  // Live count of tiles in the current layer (from render:cell-count).
  // zoomToFit reads it to give a LONE tile extra breathing room — a
  // single tile otherwise fits edge-to-edge and looks far too big.
  #cellCount = 0

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.#registerKeybindings()

    this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      // User-invoked fit via keyboard shortcut — write through as 'user'
      // so the new-path commit fires and the fit persists.
      if (cmd === 'navigation.fitToScreen' || cmd === 'navigation.recenter') this.zoomToFit(false, 'user')
    })

    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      this.#hexGeo = geo
    })

    // Track the current layer's tile count so zoomToFit can tell a lone
    // tile (which needs extra padding so it doesn't blow up to fill the
    // viewport) from any larger view (one tile wide ≈ 64px in local
    // mesh units, so a bounds-size test would be fragile — the count is
    // exact). Last-value replay means a fit right after load still reads
    // the real count.
    this.onEffect<{ count: number }>('render:cell-count', ({ count }) => {
      this.#cellCount = count
    })

    // lock the input gate while the editor is open so wheel/pinch zoom
    // doesn't fire underneath the editor overlay
    const gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate')
    this.onEffect<{ active: boolean }>('editor:mode', ({ active }) => {
      if (active) gate?.lock()
      else gate?.unlock()
    })

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.app = payload.app
      this.renderContainer = payload.container
      this.canvas = payload.canvas
      this.renderer = payload.renderer

      // Web shell loads bees asynchronously from OPFS, so the input
      // delegates (MousewheelZoomInput, PinchZoomInput, TouchGestureCoordinator,
      // TouchPanInput) can register AFTER render:host-ready fires. A
      // synchronous resolve() then returns undefined and `?.attach` silently
      // no-ops, leaving wheel/pinch zoom permanently dead. whenReady fires
      // the callback immediately if the key is already in IoC, otherwise
      // queues it for the moment registration lands.
      window.ioc.whenReady<any>('@diamondcoreprocessor.com/MousewheelZoomInput', (mouseWheel) => {
        if (!this.canvas) return
        mouseWheel.attach(
          {
            zoomByFactor: this.zoomByFactor,
            zoomToScale: this.zoomToScale,
            animateToScale: this.animateToScale,
            currentScale: this.currentScale,
          },
          this.canvas,
        )
      })

      window.ioc.whenReady<any>('@diamondcoreprocessor.com/PinchZoomInput', (pinchZoom) => {
        pinchZoom.attach(this, this.minScale)
      })

      // Coordinator owns all touch pointer events and delegates to
      // pinch-zoom + touch-pan as math delegates. Wait on coordinator;
      // pinch and touchPan may or may not be there — fall back to
      // no-op delegates to preserve the original behavior.
      window.ioc.whenReady<any>('@diamondcoreprocessor.com/TouchGestureCoordinator', (coordinator) => {
        if (!this.canvas) return
        const touchPan = window.ioc.get<any>('@diamondcoreprocessor.com/TouchPanInput')
        const pinchZoom = window.ioc.get<any>('@diamondcoreprocessor.com/PinchZoomInput')
        coordinator.attach(
          this.canvas,
          touchPan ?? { panUpdate: () => {} },
          pinchZoom ?? { pinchUpdate: () => ({ distance: 0 }) },
        )
      })

      // resolve ViewportPersistence and subscribe to navigation restores
      this.vp = window.ioc.get<ViewportPersistence>('@diamondcoreprocessor.com/ViewportPersistence') ?? null
      if (this.vp) {
        void this.vp.read().then(snap => this.#applyZoomSnapshot(snap))
        this.vp.addEventListener('restore', ((e: CustomEvent<ViewportSnapshot>) => {
          this.#applyZoomSnapshot(e.detail)
        }) as EventListener)
        // Cancel any in-flight zoom animation when the layer changes —
        // continuing to tick would write mid-frame values to the new
        // layer's saved zoom and visually fight its restored state.
        this.vp.addEventListener('dir-change', this.#cancelAnim as EventListener)
      }
    })
  }

  #registerKeybindings(): void {
    const layer: KeyMapLayer = {
      id: 'zoom',
      priority: 5,
      bindings: [
        {
          cmd: 'navigation.fitToScreen',
          sequence: [[{ key: '0', primary: true }]],
          description: 'Fit content to screen',
          descriptionKey: 'keymap.fit',
          category: 'Navigation',
          pierce: true,
        },
        {
          cmd: 'navigation.recenter',
          sequence: [[{ key: 'r' }]],
          description: 'Center content on screen',
          descriptionKey: 'keymap.recenter',
          category: 'Navigation',
        },
      ],
    }

    EffectBus.emit('keymap:add-layer', { layer })
  }

  #applyZoomSnapshot = (snap: ViewportSnapshot): void => {
    if (!this.renderContainer) return
    if (snap.zoom) {
      this.renderContainer.scale.set(snap.zoom.scale)
      this.renderContainer.position.set(snap.zoom.cx, snap.zoom.cy)
    } else {
      this.renderContainer.scale.set(1)
      this.renderContainer.position.set(0, 0)
    }
  }

  public stop = async (): Promise<void> => {
    this.detach()
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  private detach = (): void => {
    // Cancel any in-flight animation before nulling renderContainer — a
    // leaked rAF would otherwise call target.scale.set on a detached
    // Pixi container after the host is torn down.
    this.#cancelAnim()

    const mouseWheel = this.resolve<any>('mouseWheel')
    mouseWheel?.detach()

    const pinchZoom = this.resolve<any>('pinchZoom')
    pinchZoom?.detach()

    const coordinator = this.resolve<any>('coordinator')
    coordinator?.detach()

    this.app = null
    this.renderContainer = null
    this.canvas = null
    this.renderer = null
  }

  // -------------------------------------------------
  // zoom api (used by inputs)
  // -------------------------------------------------

  public currentScale = (): number => {
    return this.renderContainer?.scale.x ?? 1
  }

  public zoomToScale = (scale: number, pivotClient: Pt): void => {
    if (!this.renderContainer || !this.canvas) return
    EffectBus.emitTransient('viewport:manual', {})
    // Wheel snap path — must cancel any in-flight animation before
    // snapping. Without this, a Ctrl-zoom or zoomToFit in progress
    // continues ticking after the snap and overwrites the user's wheel
    // input on the next frame ("zoom doesn't respond"). The smooth
    // zoom path (zoomByFactor) already cancels — this is the missing
    // sibling.
    this.#cancelAnim()
    const clamped = this.clamp(scale)
    this.adjustZoom(this.renderContainer, clamped, pivotClient, 'user')
  }

  public zoomByFactor = (factor: number, pivotClient: Pt): void => {
    if (!this.renderContainer || !this.canvas) return

    EffectBus.emitTransient('viewport:manual', {})

    this.#cancelAnim()

    const target = this.renderContainer

    const current = target.scale.x || 1
    const raw = current * factor

    // if pinch-zoom pushes below minScale, trigger zoom-to-fit
    if (raw < this.minScale) {
      this.zoomToFit(false, 'user')
      return
    }

    const next = this.clamp(raw)
    this.adjustZoom(target, next, pivotClient, 'user')
  }

  /**
   * Zoom-to-fit: calculates the bounding box of all hex cells via the
   * mesh adapter and animates the viewport to center and fit all content.
   */
  public zoomToFit = (snap = false, source: ViewportSource = 'auto'): void => {
    if (!this.renderContainer || !this.renderer || !this.app) return

    this.#cancelAnim()

    const target = this.renderContainer

    // get bounds from the hex-mesh content layer only — the renderContainer
    // also holds overlay, selection, and move-preview layers whose bounds
    // can inflate the union and cause fit-to-window to zoom out too far
    const contentLayer = this.#findContentLayer(target)
    const bounds = (contentLayer ?? target).getLocalBounds()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return

    // measure UI chrome to define the safe area. A view that is ONE lone
    // tile fits edge-to-edge and blows that tile up to fill the viewport —
    // it looks far too big — so give it 75px of breathing room. Any larger
    // view (a wider row, multiple rows, a block) already has a bounding box
    // big enough that the normal tight margin looks right. Keyed off the
    // rendered tile count, not bounds size: a single tile is only ~64px in
    // the mesh's local units, so a geometry threshold is fragile — the
    // count is exact.
    const padding = this.#cellCount === 1 ? 75 : 5 // px margin from UI chrome edges
    const headerEl = document.querySelector('.header-bar') as HTMLElement | null
    // The controls bar FLOATS over the canvas — it must never constrain the fit
    // area. Reserving its width/height here made it "affect the container
    // size": a side rail shifted/shrank fits into the strip beside it, and a
    // bottom pill pulled the fit up. Content now fits the full viewport (below
    // the header) regardless of where the bar is docked; the bar overlays it.
    const safeTop = headerEl ? headerEl.getBoundingClientRect().bottom + padding : padding
    const safeBottom = window.innerHeight - padding
    const safeLeft = padding
    const safeRight = window.innerWidth - padding
    const availW = safeRight - safeLeft
    const availH = safeBottom - safeTop

    const stageScale = this.app.stage.scale.x || 1

    // reset stage to screen center and clear pan so that the fit position
    // is not relative to a stale pan offset — this keeps content centered
    // after viewport resizes (desktop ↔ mobile, orientation, fullscreen)
    const screenCx = window.innerWidth * 0.5
    const screenCy = window.innerHeight * 0.5
    this.app.stage.position.set(screenCx, screenCy)
    this.vp?.setPan(0, 0, source)

    // content screen size = bounds * containerScale * stageScale
    // so containerScale = availPx / (bounds * stageScale)
    const scaleX = availW / (bounds.width * stageScale)
    const scaleY = availH / (bounds.height * stageScale)
    const fitScale = this.clamp(Math.min(scaleX, scaleY))

    // content center in local coords
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2

    // safe area center in screen coords
    const safeMidX = (safeLeft + safeRight) / 2
    const safeMidY = (safeTop + safeBottom) / 2

    // container position so that content center at fitScale lands at safe-area center
    // screen = stagePos + (containerPos + localPoint * containerScale) * stageScale
    // solve for containerPos:
    //   containerPos = (safeMid - stagePos) / stageScale - center * fitScale
    const targetPosX = (safeMidX - screenCx) / stageScale - centerX * fitScale
    const targetPosY = (safeMidY - screenCy) / stageScale - centerY * fitScale

    if (snap) {
      target.scale.set(fitScale)
      target.position.set(targetPosX, targetPosY)
      // Save with fit=true so a later resize / fullscreen / reload at a
      // different viewport size knows to refit instead of restoring the
      // stale (cx, cy) — the saved coords were derived from this
      // moment's safeMidX/Y and would otherwise leave content shrunk
      // and off-center in the new viewport.
      this.#saveZoom(target, true, source)
      return
    }

    // animate to target (200ms ease-out). Tracked via #animFrameId so
    // the dir-change handler can cancel mid-flight without leaking
    // ticks into the next layer's saved zoom.
    const startScale = target.scale.x
    const startPosX = target.position.x
    const startPosY = target.position.y

    const duration = 200
    const startTime = performance.now()

    const animate = (now: number): void => {
      if (this.#animFrameId === null) return  // cancelled by dir-change
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / duration)
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)

      const s = startScale + (fitScale - startScale) * ease
      const px = startPosX + (targetPosX - startPosX) * ease
      const py = startPosY + (targetPosY - startPosY) * ease

      target.scale.set(s)
      target.position.set(px, py)

      // Save every tick with fit=true. VP debounces so this still
      // coalesces to one OPFS write per gesture, but if the user
      // navigates / closes the tab mid-animation, the partial fit
      // state is captured rather than dropped.
      this.#saveZoom(target, true, source)

      if (t < 1) {
        this.#animFrameId = requestAnimationFrame(animate)
      } else {
        this.#animFrameId = null
      }
    }

    this.#animFrameId = requestAnimationFrame(animate)
  }

  // -------------------------------------------------
  // smooth animated zoom (mousewheel snap levels)
  // -------------------------------------------------

  public animateToScale = (scale: number, pivotClient: Pt): void => {
    if (!this.renderContainer || !this.canvas || !this.renderer) return

    EffectBus.emitTransient('viewport:manual', {})

    const target = this.renderContainer
    const clamped = this.clamp(scale)

    this.#cancelAnim()

    // snapshot starting state
    this.#animStartScale = target.scale.x
    this.#animTargetScale = clamped
    this.#animPivotClient = pivotClient

    // compute the local point under the pivot at the current scale
    const pivotGlobal = this.clientToPixiGlobal(pivotClient)
    this.#animPivotLocal = target.toLocal(new Point(pivotGlobal.x, pivotGlobal.y))

    this.#animStartTime = performance.now()
    this.#animFrameId = requestAnimationFrame(this.#animTick)
  }

  #animTick = (now: number): void => {
    if (!this.renderContainer || !this.renderer) {
      this.#animFrameId = null
      return
    }

    const target = this.renderContainer
    const elapsed = now - this.#animStartTime
    const t = Math.min(1, elapsed / this.#animDuration)
    // ease-in cubic — accelerates into target for a crisp finish
    const ease = t * t * t

    const newScale = this.#animStartScale + (this.#animTargetScale - this.#animStartScale) * ease

    // apply scale then correct position so pivot pixel stays fixed
    target.scale.set(newScale)

    const pivotGlobal = this.clientToPixiGlobal(this.#animPivotClient)
    const postGlobal = target.toGlobal(this.#animPivotLocal)

    const parent = target.parent
    if (parent?.toLocal) {
      const pivP = parent.toLocal(new Point(pivotGlobal.x, pivotGlobal.y))
      const postP = parent.toLocal(postGlobal)
      target.position.set(
        target.position.x + (pivP.x - postP.x),
        target.position.y + (pivP.y - postP.y),
      )
    } else {
      target.position.set(
        target.position.x + (pivotGlobal.x - postGlobal.x),
        target.position.y + (pivotGlobal.y - postGlobal.y),
      )
    }

    this.#clampContentPosition()

    // Save on every tick — VP debounces, so this coalesces into one
    // OPFS write per gesture. If the animation is interrupted by
    // navigation, page close, or another gesture, the partial scale
    // still persists. The previous "save only on completion" pattern
    // dropped state when animations didn't reach t=1.
    // animateToScale is called by mousewheel input — user-source.
    this.#saveZoom(target, false, 'user')

    if (t < 1) {
      this.#animFrameId = requestAnimationFrame(this.#animTick)
    } else {
      this.#animFrameId = null
    }
  }

  // -------------------------------------------------
  // pixel-perfect zoom (no creep)
  // -------------------------------------------------
  //
  // invariant:
  // - the exact pixel under the cursor before zoom remains under the cursor after zoom
  //
  // this is the same math you used in legacy:
  // - compute local point under pivot
  // - apply scale
  // - compute new global for that same local point
  // - translate to cancel the difference
  //

  private adjustZoom = (target: any, newScale: number, pivotClient: Pt, source: ViewportSource = 'auto'): void => {
    if (!this.renderer || !this.canvas) return

    const pivotGlobal = this.clientToPixiGlobal(pivotClient)

    // local point under cursor before scaling
    const preLocal = target.toLocal(new Point(pivotGlobal.x, pivotGlobal.y))

    // apply uniform zoom
    target.scale.set(newScale)

    // global point where that same local point ended up after scaling
    const postGlobal = target.toGlobal(preLocal)

    // translate in parent space so postGlobal matches pivotGlobal exactly
    const parent = target.parent
    if (parent?.toLocal) {
      const pivotParent = parent.toLocal(new Point(pivotGlobal.x, pivotGlobal.y))
      const postParent = parent.toLocal(postGlobal)

      target.position.set(
        target.position.x + (pivotParent.x - postParent.x),
        target.position.y + (pivotParent.y - postParent.y)
      )
      this.#clampContentPosition()
      this.#saveZoom(target, false, source)
      return
    }

    target.position.set(
      target.position.x + (pivotGlobal.x - postGlobal.x),
      target.position.y + (pivotGlobal.y - postGlobal.y)
    )

    this.#clampContentPosition()
    this.#saveZoom(target, false, source)
  }

  // Single cancellation primitive for every animation path. Both
  // smooth-zoom (#animTick) and fit (zoomToFit's animate) own
  // #animFrameId in turn. Routing all cancels through this helper keeps
  // the four call sites (three entry-points + dir-change listener)
  // structurally identical so a future path can't forget to clear the
  // slot. We deliberately do NOT save here: the prior animation's last
  // tick already persisted the visible state, and saving again with
  // fit=false would silently clobber a fit=true flag set by zoomToFit.
  #cancelAnim = (): void => {
    if (this.#animFrameId !== null) {
      cancelAnimationFrame(this.#animFrameId)
      this.#animFrameId = null
    }
  }

  #saveZoom = (target: any, fit = false, source: ViewportSource = 'auto'): void => {
    this.vp?.setZoom(target.scale.x, target.position.x, target.position.y, fit, source)
  }

  // After any zoom-induced position/scale change, ensure at least one tile
  // remains fully on screen. Pivot zoom keeps the cursor pixel stable, which
  // can drift the content off the viewport when zooming against a pivot
  // outside the grid — this nudges the container back just enough to keep
  // one tile in view, sacrificing the pivot invariant at the edge.
  #clampContentPosition = (): void => {
    if (!this.renderContainer || !this.renderer || !this.app) return
    const layer = this.#findContentLayer(this.renderContainer)
    const target: any = layer ?? this.renderContainer
    if (!target.getBounds) return
    const b = target.getBounds()
    if (!b || b.width <= 0 || b.height <= 0) return

    const scale = this.renderContainer.scale.x || 1
    const ss = this.app.stage.scale.x || 1
    const tile = 2 * this.#hexGeo.circumRadiusPx * scale * ss
    const W = this.renderer.screen.width
    const H = this.renderer.screen.height

    let shiftX = 0
    if (b.x > W - tile) shiftX = (W - tile) - b.x
    else if (b.x + b.width < tile) shiftX = tile - (b.x + b.width)

    let shiftY = 0
    if (b.y > H - tile) shiftY = (H - tile) - b.y
    else if (b.y + b.height < tile) shiftY = tile - (b.y + b.height)

    if (shiftX === 0 && shiftY === 0) return

    // Shift in renderContainer's local space (before stage scale).
    this.renderContainer.position.x += shiftX / ss
    this.renderContainer.position.y += shiftY / ss
  }

  // -------------------------------------------------
  // input mapping
  // -------------------------------------------------
  //
  // returns pixi "global" coordinates in renderer.screen units (top-left origin)
  // this must match the coordinate space used by toLocal/toGlobal.
  //

  private clientToPixiGlobal = (p: Pt): Pt => {
    const renderer = this.renderer!
    const canvas = this.canvas!

    // best: pixi v8 event mapping (handles autoDensity + resolution correctly)
    const events = (renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, p.x, p.y)
      return { x: out.x, y: out.y }
    }

    // fallback: map css → renderer.screen (NOT canvas backing pixels)
    const rect = canvas.getBoundingClientRect()
    const screen = renderer.screen

    const x = (p.x - rect.left) * (screen.width / rect.width)
    const y = (p.y - rect.top) * (screen.height / rect.height)

    return { x, y }
  }

  /**
   * Find the hex-mesh content layer among the renderContainer's children.
   * The show-cell layer is the one whose subtree contains a child with a
   * `.geometry` property (a Pixi Mesh). Returns null if not found, in which
   * case the caller falls back to the full container bounds.
   */
  #findContentLayer = (container: Container): Container | null => {
    for (const child of container.children) {
      if (!child || !(child as any).children) continue
      for (const grandchild of (child as Container).children) {
        if ((grandchild as any).geometry) return child as Container
      }
    }
    return null
  }

  private clamp = (v: number): number =>
    Math.max(this.minScale, Math.min(this.maxScale, v))
}

// -------------------------------------------------
// IoC registration (side-effects — must survive tree-shaking)
// -------------------------------------------------

const _viewportPersistence = new ViewportPersistence()
window.ioc.register('@diamondcoreprocessor.com/ViewportPersistence', _viewportPersistence)

const _zoom = new ZoomDrone()
window.ioc.register('@diamondcoreprocessor.com/ZoomDrone', _zoom)

// Co-locate touch input registrations here — plain classes get tree-shaken
// when imported from separate modules, because esbuild considers
// `new PlainClass()` pure/droppable. Importing them from ZoomDrone's module
// (which extends Drone and is therefore preserved) ensures side-effects survive.
import { PinchZoomInput } from './pinch-zoom.input.js'
import { TouchGestureCoordinator } from '../touch/touch-gesture.coordinator.js'
window.ioc.register('@diamondcoreprocessor.com/PinchZoomInput', new PinchZoomInput())
window.ioc.register('@diamondcoreprocessor.com/TouchGestureCoordinator', new TouchGestureCoordinator())
