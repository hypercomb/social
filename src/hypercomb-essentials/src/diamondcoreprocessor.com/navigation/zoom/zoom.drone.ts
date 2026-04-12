// diamondcoreprocessor.com/input/zoom/zoom.drone.ts
import { Drone } from '@hypercomb/core'
import { Application, Container, Point } from 'pixi.js'
import type { HostReadyPayload } from '../../presentation/tiles/pixi-host.worker.js'

type Pt = { x: number; y: number }

// ── InputGate — shared input exclusivity ─────────────
// Inlined here so Angular's esbuild cannot tree-shake the IoC registration.
// One source at a time. Context menu auto-suppressed while claimed.

export class InputGate {
  #owner: string | null = null
  #locked = false

  get active(): boolean { return this.#locked || this.#owner !== null }
  get locked(): boolean { return this.#locked }

  lock = (): void => { this.#locked = true }
  unlock = (): void => { this.#locked = false }

  claim = (source: string): boolean => {
    if (this.#locked) return false
    if (this.#owner && this.#owner !== source) return false
    this.#owner = source
    return true
  }

  release = (source: string): void => {
    if (this.#owner === source) this.#owner = null
  }

  constructor() {
    document.addEventListener('contextmenu', (e) => {
      if (this.#owner || e.ctrlKey || e.metaKey) e.preventDefault()
    }, true)
  }
}

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

export type ZoomSnapshot = { scale: number; cx: number; cy: number }
export type PanSnapshot = { dx: number; dy: number }
export type ViewportSnapshot = { zoom?: ZoomSnapshot; pan?: PanSnapshot }

export class ViewportPersistence extends EventTarget {

  constructor() { super() }

  #dir: FileSystemDirectoryHandle | null = null
  #debounceTimer: ReturnType<typeof setTimeout> | null = null
  #pending: ViewportSnapshot = {}
  #lastRead: ViewportSnapshot = {}
  #writing = false
  #storeListening = false
  #reading: Promise<ViewportSnapshot> | null = null
  #suspended = false

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

  /** Switch directory without reading or dispatching restore — caller already applied the viewport. */
  setDirSilent = (dir: FileSystemDirectoryHandle | null): void => {
    if (this.#dir === dir) return

    // flush pending writes to old dir
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = null
    }
    const flushDir = this.#dir
    const flushPending = this.#pending
    if (flushDir && (flushPending.zoom || flushPending.pan)) {
      void this.#persistTo(flushDir, flushPending)
    }

    this.#dir = dir
    this.#pending = {}
    this.#lastRead = {}
    this.#reading = null
  }

  setDir = (dir: FileSystemDirectoryHandle | null): void => {
    if (this.#dir === dir) return

    // flush any pending writes to the old directory before switching
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = null
    }
    const flushDir = this.#dir
    const flushPending = this.#pending
    if (flushDir && (flushPending.zoom || flushPending.pan)) {
      void this.#persistTo(flushDir, flushPending)
    }

    this.#dir = dir
    this.#pending = {}
    this.#lastRead = {}
    this.#reading = null

    // read the new directory's viewport and notify subscribers
    if (dir) {
      void this.read().then(snap => {
        this.dispatchEvent(new CustomEvent('restore', { detail: snap }))
      })
    }
  }

  // -- drone-facing api --

  setZoom = (scale: number, cx: number, cy: number): void => {
    if (this.#suspended) return
    if (!this.#dir) this.#syncWithStore()
    this.#pending.zoom = { scale, cx, cy }
    if (this.#dir) this.#schedulePersist()
  }

  setPan = (dx: number, dy: number): void => {
    if (this.#suspended) return
    if (!this.#dir) this.#syncWithStore()
    this.#pending.pan = { dx, dy }
    if (this.#dir) this.#schedulePersist()
  }

  get lastPan(): PanSnapshot | undefined {
    return this.#pending.pan ?? this.#lastRead.pan
  }

  get lastZoom(): ZoomSnapshot | undefined {
    return this.#pending.zoom ?? this.#lastRead.zoom
  }

  read = (): Promise<ViewportSnapshot> => {
    if (!this.#dir) this.#syncWithStore()
    if (!this.#dir) return Promise.resolve({})

    // deduplicate concurrent reads (both drones call read() on host-ready)
    if (this.#reading) return this.#reading

    const dir = this.#dir
    this.#reading = readProperties(dir).then(props => {
      const vp = (props as any).viewport as ViewportSnapshot | undefined
      this.#lastRead = vp ?? {}
      return this.#lastRead
    }).catch(() => {
      this.#lastRead = {}
      return {} as ViewportSnapshot
    }).finally(() => {
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
    }, 1000)
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

      // sync last-read only if dir is still current
      if (this.#dir === dir) this.#lastRead = viewport
    } catch {
      // OPFS write failed — silently drop, will retry on next gesture
    }
  }

  #persist = async (): Promise<void> => {
    const dir = this.#dir
    if (!dir) return
    if (this.#writing) {
      this.#schedulePersist()
      return
    }

    // snapshot pending before any await — setDir() may clear it mid-flight
    const pending = { ...this.#pending }
    if (!pending.zoom && !pending.pan) return

    this.#writing = true
    try {
      await this.#persistTo(dir, pending)
    } finally {
      this.#writing = false
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

  private readonly minScale = 0.05
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
  protected override listens = ['render:host-ready', 'editor:mode', 'keymap:invoke']

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd === 'navigation.fitToScreen') this.zoomToFit()
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

      const mouseWheel = this.resolve<any>('mouseWheel')
      mouseWheel?.attach(
        {
          zoomByFactor: this.zoomByFactor,
          zoomToScale: this.zoomToScale,
          animateToScale: this.animateToScale,
          currentScale: this.currentScale,
        },
        this.canvas,
      )

      // attach pinch-zoom as a math delegate
      const pinchZoom = this.resolve<any>('pinchZoom')
      pinchZoom?.attach(this, this.minScale)

      // attach touch gesture coordinator — owns all touch pointer events
      // and delegates to pinch-zoom and touch-pan math delegates
      const touchPan = this.resolve<any>('touchPan')
      const coordinator = this.resolve<any>('coordinator')
      if (coordinator && this.canvas) {
        coordinator.attach(
          this.canvas,
          touchPan ?? { panUpdate: () => {} },
          pinchZoom ?? { pinchUpdate: () => ({ distance: 0 }) },
        )
      }

      // resolve ViewportPersistence and subscribe to navigation restores
      this.vp = window.ioc.get<ViewportPersistence>('@diamondcoreprocessor.com/ViewportPersistence') ?? null
      if (this.vp) {
        void this.vp.read().then(snap => this.#applyZoomSnapshot(snap))
        this.vp.addEventListener('restore', ((e: CustomEvent<ViewportSnapshot>) => {
          this.#applyZoomSnapshot(e.detail)
        }) as EventListener)
      }
    })
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
    const clamped = this.clamp(scale)
    this.adjustZoom(this.renderContainer, clamped, pivotClient)
  }

  public zoomByFactor = (factor: number, pivotClient: Pt): void => {
    if (!this.renderContainer || !this.canvas) return

    // cancel any in-flight smooth zoom animation
    if (this.#animFrameId !== null) {
      cancelAnimationFrame(this.#animFrameId)
      this.#animFrameId = null
    }

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

    // cancel any in-flight smooth zoom animation
    if (this.#animFrameId !== null) {
      cancelAnimationFrame(this.#animFrameId)
      this.#animFrameId = null
    }

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
      this.#saveZoom(target)
      return
    }

    // animate to target (200ms ease-out)
    const startScale = target.scale.x
    const startPosX = target.position.x
    const startPosY = target.position.y

    const duration = 200
    const startTime = performance.now()

    const animate = (now: number): void => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / duration)
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)

      const s = startScale + (fitScale - startScale) * ease
      const px = startPosX + (targetPosX - startPosX) * ease
      const py = startPosY + (targetPosY - startPosY) * ease

      target.scale.set(s)
      target.position.set(px, py)

      if (t < 1) {
        requestAnimationFrame(animate)
      } else {
        this.#saveZoom(target)
      }
    }

    requestAnimationFrame(animate)
  }

  // -------------------------------------------------
  // smooth animated zoom (mousewheel snap levels)
  // -------------------------------------------------

  public animateToScale = (scale: number, pivotClient: Pt): void => {
    if (!this.renderContainer || !this.canvas || !this.renderer) return

    const target = this.renderContainer
    const clamped = this.clamp(scale)

    // cancel any in-flight zoom-to-fit animation
    if (this.#animFrameId !== null) {
      cancelAnimationFrame(this.#animFrameId)
    }

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

    if (t < 1) {
      this.#animFrameId = requestAnimationFrame(this.#animTick)
    } else {
      this.#animFrameId = null
      this.#saveZoom(target)
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
      this.#saveZoom(target)
      return
    }

    target.position.set(
      target.position.x + (pivotGlobal.x - postGlobal.x),
      target.position.y + (pivotGlobal.y - postGlobal.y)
    )

    this.#saveZoom(target)
  }

  #saveZoom = (target: any): void => {
    this.vp?.setZoom(target.scale.x, target.position.x, target.position.y)
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

const _inputGate = new InputGate()
window.ioc.register('@diamondcoreprocessor.com/InputGate', _inputGate)

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
