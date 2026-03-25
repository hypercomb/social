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
    if (!this.#dir) this.#syncWithStore()
    this.#pending.zoom = { scale, cx, cy }
    if (this.#dir) this.#schedulePersist()
  }

  setPan = (dx: number, dy: number): void => {
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

  protected override deps = {
    mouseWheel: '@diamondcoreprocessor.com/MousewheelZoomInput',
    pinchZoom: '@diamondcoreprocessor.com/PinchZoomInput',
    coordinator: '@diamondcoreprocessor.com/TouchGestureCoordinator',
    touchPan: '@diamondcoreprocessor.com/TouchPanInput',
  }
  protected override listens = ['render:host-ready']

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.app = payload.app
      this.renderContainer = payload.container
      this.canvas = payload.canvas
      this.renderer = payload.renderer

      const mouseWheel = this.resolve<any>('mouseWheel')
      mouseWheel?.attach(this, this.canvas)

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

  public zoomByFactor = (factor: number, pivotClient: Pt): void => {
    if (!this.renderContainer || !this.canvas) return

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
  public zoomToFit = (): void => {
    if (!this.renderContainer || !this.renderer) return

    const target = this.renderContainer
    const screen = this.renderer.screen

    // try to get mesh bounds from the container's children
    const bounds = target.getLocalBounds()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return

    const padding = 40 // px padding around content
    const availW = screen.width - padding * 2
    const availH = screen.height - padding * 2

    const scaleX = availW / bounds.width
    const scaleY = availH / bounds.height
    const fitScale = this.clamp(Math.min(scaleX, scaleY))

    // center the bounding box in the viewport
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2

    // animate to target (200ms ease-out)
    const startScale = target.scale.x
    const startPosX = target.position.x
    const startPosY = target.position.y

    // target position: the center of bounds at fitScale should land at screen center
    // stage is already centered at screen/2, so container offset = -center * scale
    const targetPosX = -centerX * fitScale
    const targetPosY = -centerY * fitScale

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
// bench
