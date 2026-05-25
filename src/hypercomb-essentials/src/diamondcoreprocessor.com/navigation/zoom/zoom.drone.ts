// diamondcoreprocessor.com/input/zoom/zoom.drone.ts
import { Drone, EffectBus, type KeyMapLayer } from '@hypercomb/core'
import { Application, Container, Point } from 'pixi.js'
import type { HostReadyPayload } from '../../presentation/tiles/pixi-host.worker.js'
import type { HexGeometry } from '../../presentation/grid/hex-geometry.js'
import { DEFAULT_HEX_GEOMETRY } from '../../presentation/grid/hex-geometry.js'
import type { InputGate } from '../input-gate.service.js'

type Pt = { x: number; y: number }

// -------------------------------------------------
// ViewportPersistence — thin write coordinator
// -------------------------------------------------
// Inlined here so Angular's esbuild cannot tree-shake the IoC registration.
// Both ZoomDrone and PanningDrone report state here; writes are debounced
// and merged into the existing 0000 JSON atomically.

const PROPERTIES_FILE = '0000'

const readProperties = async (
  dir: FileSystemDirectoryHandle
): Promise<Record<string, unknown>> => {
  try {
    const fh = await dir.getFileHandle(PROPERTIES_FILE)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return {}
  }
}

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

// Debounce window for coalescing rapid pan/zoom changes within a gesture.
//
// Zero so each gesture lands in the file within one microtask. The
// previous 100ms window was the race window for "pan-then-refresh"
// losses — gesture ends, refresh fires before debounce timer
// elapses, pagehide's fire-and-forget flush can't await OPFS writes
// to completion, last pan is gone.
//
// Coalescing still happens within a single microtask: multiple
// setPan/setZoom calls in the same tick all overwrite `#pending`
// before the scheduled persist runs, so we still write once per
// tick. With 60fps panning that's ~60 OPFS writes/sec, serialized
// through #opQueue — well within OPFS throughput and never blocks
// the render thread.
const DEBOUNCE_MS = 0

export class ViewportPersistence extends EventTarget {

  constructor() {
    super()
    // Pagehide is the canonical "user is leaving" signal — flush any
    // pending write so a gesture-then-close doesn't lose the last frame.
    // Async OPFS writes inside pagehide may not always complete, but the
    // 100ms debounce already keeps the at-risk window small.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.#flushNow)
      // visibilitychange covers tab-switch / mobile app-switch where
      // pagehide does not always fire. Same fire-and-forget semantics.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.#flushNow()
      })
    }
  }

  #dir: FileSystemDirectoryHandle | null = null
  #debounceTimer: ReturnType<typeof setTimeout> | null = null
  #pending: ViewportSnapshot = {}
  #lastRead: ViewportSnapshot = {}
  #storeListening = false
  #reading: Promise<ViewportSnapshot> | null = null
  #suspended = false

  // Single op queue: every read and write goes through this so a read of
  // dir-A's 0000 cannot start before an in-flight write to dir-A's 0000
  // has landed. Without this, navigating out (which fire-and-forgets the
  // flush) and back races the pending write — the back-nav read reaches
  // OPFS first and sees the pre-flush snapshot, undoing the user's last
  // change. Symptom: press R, navigate up, navigate back — viewport
  // resets to the pre-R position; refresh then hovering shows the correct
  // (post-R) state.
  #opQueue: Promise<unknown> = Promise.resolve()

  #serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const p = this.#opQueue.then(op, op)
    this.#opQueue = p.catch(() => undefined)
    return p
  }

  /** Suspend persistence — viewport changes are applied visually but not saved to OPFS. */
  suspend = (): void => { this.#suspended = true }
  /** Resume persistence. */
  resume = (): void => { this.#suspended = false }

  // -- directory tracking --

  #syncWithStore = (): void => {
    const store = (window as any).ioc?.get('@hypercomb.social/Store') as
      { current: FileSystemDirectoryHandle; addEventListener: EventTarget['addEventListener'] } | undefined
    if (!store) return

    this.setDir(store.current)

    if (!this.#storeListening) {
      this.#storeListening = true
      store.addEventListener('change', () => this.setDir(store.current))
    }
  }

  // Self-heal: when a setter fires before show-cell has called setDirSilent
  // (the very first pan/zoom after boot, before the initial render lands),
  // #dir is null and the gesture is lost. Resolve dir from lineage now so
  // the persist of the in-flight gesture lands once dir is known.
  // Idempotent — no-op when dir is already set or no resolver is available.
  #resolvingDir: Promise<void> | null = null
  #ensureDirFromLineage = (): void => {
    if (this.#dir) return
    if (this.#resolvingDir) return
    const lineage = (window as any).ioc?.get('@hypercomb.social/Lineage') as
      { explorerDir?: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    if (!lineage?.explorerDir) return
    this.#resolvingDir = (async () => {
      try {
        const dir = await lineage.explorerDir!()
        if (dir && !this.#dir) {
          console.log('[vp] #ensureDirFromLineage: resolved', { dir: dir.name })
          this.#dir = dir
          // Drain anything that was queued while dir was null.
          if (this.#pending.zoom || this.#pending.pan || this.#pending.meshOffset) {
            this.#schedulePersist()
          }
        }
      } catch { /* leave dir null; next gesture will retry */ }
      finally { this.#resolvingDir = null }
    })()
  }

  /** Switch directory without reading or dispatching restore — caller already applied the viewport. */
  setDirSilent = (dir: FileSystemDirectoryHandle | null): void => {
    if (this.#dir === dir) return

    console.log('[vp] setDirSilent', { from: this.#dir?.name ?? null, to: dir?.name ?? null })

    // Queue the flush so a subsequent read of this dir (e.g. nav back)
    // sees the post-flush bytes — both go through the same op queue.
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = null
    }
    const flushDir = this.#dir
    const flushPending = this.#pending
    const hasPending = flushPending.zoom || flushPending.pan || flushPending.meshOffset
    if (flushDir && hasPending) {
      void this.#serialize(() => this.#persistTo(flushDir, flushPending))
    } else if (!flushDir && hasPending && dir) {
      // Orphaned pending: a gesture (pan/zoom/meshOffset) landed
      // while #dir was still null — typically the first user input
      // racing show-cell's first render. The gesture was implicitly
      // for the current location; persist it to the new dir we just
      // learned about, otherwise the gesture is silently dropped on
      // every wipe of #pending below.
      console.log('[vp] setDirSilent: draining orphaned pending to new dir', { dir: dir.name, pending: flushPending })
      void this.#serialize(() => this.#persistTo(dir, flushPending))
    }

    this.#dir = dir
    this.#pending = {}
    this.#lastRead = {}
    this.#reading = null

    // Notify drones the directory has changed. ZoomDrone uses this to
    // cancel any in-flight zoom animation — without this the animation
    // would keep ticking against the new layer's container, overwriting
    // its restored zoom with mid-frame values from the outgoing layer's
    // fit / animateToScale.
    this.dispatchEvent(new CustomEvent('dir-change'))
  }

  setDir = (dir: FileSystemDirectoryHandle | null): void => {
    if (this.#dir === dir) return

    // Queue the flush of the old dir's pending writes BEFORE the new dir
    // read. read() also goes through the op queue, so the read on a
    // subsequent navigation back is guaranteed to see this flush's bytes
    // — no race between fire-and-forget write and immediate read on
    // nav-back.
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = null
    }
    const flushDir = this.#dir
    const flushPending = this.#pending
    const hasPending = flushPending.zoom || flushPending.pan || flushPending.meshOffset
    if (flushDir && hasPending) {
      void this.#serialize(() => this.#persistTo(flushDir, flushPending))
    } else if (!flushDir && hasPending && dir) {
      // Same orphan-drain as setDirSilent: a gesture queued before
      // any dir was known belongs to the location we just learned.
      void this.#serialize(() => this.#persistTo(dir, flushPending))
    }

    this.#dir = dir
    this.#pending = {}
    this.#lastRead = {}
    this.#reading = null

    // Same dir-change notice as setDirSilent — drones cancel in-flight
    // animations before the new layer's snapshot lands.
    this.dispatchEvent(new CustomEvent('dir-change'))

    // Read the new directory's viewport and notify subscribers — queued
    // after the flush above (and any other in-flight writes).
    if (dir) {
      void this.read().then(snap => {
        if (this.#dir === dir) {
          this.dispatchEvent(new CustomEvent('restore', { detail: snap }))
        }
      })
    }
  }

  // -- drone-facing api --

  // Setter contract: every update writes to BOTH the in-memory cache
  // (#lastRead) and the pending-to-disk buffer (#pending) in the same
  // tick. The cache is the source for synchronous getters; the file
  // is the source of truth on disk (debounced to coalesce gesture
  // bursts). Cache and file are kept in lock-step — never diverge.

  setZoom = (scale: number, cx: number, cy: number, fit = false): void => {
    if (this.#suspended) return
    if (!this.#dir) this.#syncWithStore()
    if (!this.#dir) this.#ensureDirFromLineage()
    // Strip `fit: false` from the stored snapshot to keep JSON minimal —
    // absence == not a fit. Only set the property when truly a fit.
    const zoom = fit ? { scale, cx, cy, fit: true } : { scale, cx, cy }
    this.#pending.zoom = zoom
    this.#lastRead = { ...this.#lastRead, zoom }
    if (this.#dir) this.#schedulePersist()
  }

  setPan = (dx: number, dy: number): void => {
    if (this.#suspended) { console.log('[vp] setPan: suspended, bail'); return }
    if (!this.#dir) this.#syncWithStore()
    if (!this.#dir) this.#ensureDirFromLineage()
    const pan = { dx, dy }
    this.#pending.pan = pan
    this.#lastRead = { ...this.#lastRead, pan }
    if (this.#dir) {
      console.log('[vp] setPan → schedule', { dx, dy, dir: this.#dir.name })
      this.#schedulePersist()
    } else {
      console.log('[vp] setPan: NO #dir, will drain after async lineage resolve', { dx, dy })
    }
  }

  /** Persist the renderer's mesh offset (its position inside the layer
   *  container). Saved per-layer so the position stays fixed across
   *  navigation; never auto-changed by the renderer. Only updated when
   *  the user explicitly recenters via the navigation command. */
  setMeshOffset = (x: number, y: number): void => {
    if (this.#suspended) return
    if (!this.#dir) this.#syncWithStore()
    if (!this.#dir) this.#ensureDirFromLineage()
    const meshOffset = { x, y }
    this.#pending.meshOffset = meshOffset
    this.#lastRead = { ...this.#lastRead, meshOffset }
    if (this.#dir) this.#schedulePersist()
  }

  get lastPan(): PanSnapshot | undefined {
    return this.#pending.pan ?? this.#lastRead.pan
  }

  get lastZoom(): ZoomSnapshot | undefined {
    return this.#pending.zoom ?? this.#lastRead.zoom
  }

  get lastMeshOffset(): MeshOffsetSnapshot | undefined {
    return this.#pending.meshOffset ?? this.#lastRead.meshOffset
  }

  read = (): Promise<ViewportSnapshot> => {
    if (!this.#dir) this.#syncWithStore()
    if (!this.#dir) return Promise.resolve({})

    // deduplicate concurrent reads (both drones call read() on host-ready)
    if (this.#reading) return this.#reading

    const dir = this.#dir
    // Queue the read so any pending writes (including a fire-and-forget
    // flush from a recent setDir) land before we read.
    this.#reading = this.#serialize(async () => {
      try {
        const props = await readProperties(dir)
        const vp = (props as any).viewport as ViewportSnapshot | undefined
        if (this.#dir === dir) this.#lastRead = vp ?? {}
        return vp ?? {} as ViewportSnapshot
      } catch {
        if (this.#dir === dir) this.#lastRead = {}
        return {} as ViewportSnapshot
      }
    })

    void this.#reading.finally(() => {
      this.#reading = null
    })

    return this.#reading
  }

  // -- internals --

  #schedulePersist = (): void => {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null
      void this.#persist()
    }, DEBOUNCE_MS)
  }

  /** Cancel the debounce timer and queue an immediate flush. Used by
   *  pagehide/visibilitychange handlers so the user's last gesture
   *  isn't stranded in #pending when the tab closes or backgrounds. */
  #flushNow = (): void => {
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = null
    }
    void this.#persist()
  }

  #persistTo = async (
    dir: FileSystemDirectoryHandle,
    pending: ViewportSnapshot,
  ): Promise<void> => {
    try {
      const props = await readProperties(dir)
      const viewport: ViewportSnapshot = {
        ...((props as any).viewport as ViewportSnapshot | undefined),
        ...pending,
      }
      ;(props as any).viewport = viewport

      const fileHandle = await dir.getFileHandle(PROPERTIES_FILE, { create: true })
      const writable = await fileHandle.createWritable()
      try {
        await writable.write(JSON.stringify(props, null, 2))
      } finally {
        await writable.close()
      }
      console.log('[vp] #persistTo: wrote', { dir: dir.name, viewport })

      // DON'T overwrite #lastRead from the file here — setters update
      // the cache synchronously on every gesture, so the in-memory
      // value is always as fresh or fresher than what we just wrote.
      // The file is the source of truth across reloads; the cache is
      // the source for in-session reads, and setters keep them in
      // lock-step. Letting #persistTo blow over #lastRead with a
      // stale-by-one-tick merge would race a setter that fired between
      // pending-snapshot and write-completion.

      // Cache invalidation broadcast — any consumer that mirrors 0000 in
      // memory can drop their copy and re-read on next access. The OPFS
      // write is the source of truth; this event is the "it changed" signal.
      EffectBus.emit('viewport:persisted', { dir, snapshot: viewport })
    } catch {
      // OPFS write failed — silently drop, will retry on next gesture
    }
  }

  #persist = async (): Promise<void> => {
    const dir = this.#dir
    if (!dir) { console.log('[vp] #persist: NO dir, bail'); return }

    // Snapshot pending and clear it BEFORE awaiting so a fast follow-up
    // gesture doesn't write the same data twice. If the persist throws,
    // the next setX call simply re-populates pending.
    const pending = { ...this.#pending }
    // Bail when nothing is pending. Must include meshOffset — otherwise
    // setMeshOffset writes never reach 0000 (mesh-offset would not
    // round-trip through OPFS, and "position should never be forgotten"
    // would be violated on every reload).
    if (!pending.zoom && !pending.pan && !pending.meshOffset) { console.log('[vp] #persist: empty pending'); return }
    this.#pending = {}

    console.log('[vp] #persist → write', { dir: dir.name, pending })
    await this.#serialize(() => this.#persistTo(dir, pending))
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
  protected override listens = ['render:host-ready', 'editor:mode', 'keymap:invoke', 'render:geometry-changed']

  #effectsRegistered = false
  #hexGeo: HexGeometry = DEFAULT_HEX_GEOMETRY

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.#registerKeybindings()

    this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd === 'navigation.fitToScreen' || cmd === 'navigation.recenter') this.zoomToFit()
    })

    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      this.#hexGeo = geo
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
    this.adjustZoom(this.renderContainer, clamped, pivotClient)
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
      this.zoomToFit()
      return
    }

    const next = this.clamp(raw)
    this.adjustZoom(target, next, pivotClient)
  }

  /**
   * Zoom-to-fit: calculates the bounding box of all hex cells via the
   * mesh adapter and animates the viewport to center and fit all content.
   */
  public zoomToFit = (snap = false): void => {
    if (!this.renderContainer || !this.renderer || !this.app) return

    this.#cancelAnim()

    const target = this.renderContainer

    // get bounds from the hex-mesh content layer only — the renderContainer
    // also holds overlay, selection, and move-preview layers whose bounds
    // can inflate the union and cause fit-to-window to zoom out too far
    const contentLayer = this.#findContentLayer(target)
    const bounds = (contentLayer ?? target).getLocalBounds()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return

    // measure UI chrome to define the safe area
    const padding = 5 // px margin from UI chrome edges
    const headerEl = document.querySelector('.header-bar') as HTMLElement | null
    const pillEl = document.querySelector('.controls-pill') as HTMLElement | null
    const safeTop = headerEl ? headerEl.getBoundingClientRect().bottom + padding : padding
    const safeBottom = pillEl ? pillEl.getBoundingClientRect().top - padding : window.innerHeight - padding

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
    this.vp?.setPan(0, 0)

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
      this.#saveZoom(target, true)
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
      this.#saveZoom(target, true)

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
    this.#saveZoom(target)

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

  private adjustZoom = (target: any, newScale: number, pivotClient: Pt): void => {
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
      this.#saveZoom(target)
      return
    }

    target.position.set(
      target.position.x + (pivotGlobal.x - postGlobal.x),
      target.position.y + (pivotGlobal.y - postGlobal.y)
    )

    this.#clampContentPosition()
    this.#saveZoom(target)
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

  #saveZoom = (target: any, fit = false): void => {
    this.vp?.setZoom(target.scale.x, target.position.x, target.position.y, fit)
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
