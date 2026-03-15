// hypercomb-essentials/src/diamondcoreprocessor.com/input/zoom/zoom.drone.ts

import { Drone } from '@hypercomb/core'
import { Application, Container, Point } from 'pixi.js'
import type { HostReadyPayload } from '../../pixi/pixi-host.drone.js'

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

export type ZoomSnapshot = { scale: number; cx: number; cy: number }
export type PanSnapshot = { dx: number; dy: number }
export type ViewportSnapshot = { zoom?: ZoomSnapshot; pan?: PanSnapshot }

export class ViewportPersistence {

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

  setDir = (dir: FileSystemDirectoryHandle | null): void => {
    if (this.#dir === dir) return

    // flush any pending writes to the old directory before switching
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = null
      if (this.#dir) void this.#persist()
    }

    this.#dir = dir
    this.#pending = {}
    this.#lastRead = {}
    this.#reading = null
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

  #persist = async (): Promise<void> => {
    const dir = this.#dir
    if (!dir) return
    if (this.#writing) {
      // re-schedule if a write is already in progress
      this.#schedulePersist()
      return
    }

    this.#writing = true
    try {
      // read existing 0000
      const props = await readProperties(dir)

      // merge viewport key
      const viewport: ViewportSnapshot = {
        ...((props as any).viewport as ViewportSnapshot | undefined),
        ...this.#pending,
      }
      ;(props as any).viewport = viewport

      // write back
      const fileHandle = await dir.getFileHandle(PROPERTIES_FILE, { create: true })
      const writable = await fileHandle.createWritable()
      try {
        await writable.write(JSON.stringify(props, null, 2))
      } finally {
        await writable.close()
      }

      // sync last-read with what we just wrote
      this.#lastRead = viewport
    } catch {
      // OPFS write failed — silently drop, will retry on next gesture
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
  public override description = 'authoritative zoom controller'

  private app: Application | null = null
  private renderContainer: Container | null = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: Application['renderer'] | null = null

  private readonly minScale = 0.05
  private readonly maxScale = 12

  private activeSource: string | null = null
  private vp: ViewportPersistence | null = null

  protected override deps = { mouseWheel: '@diamondcoreprocessor.com/MousewheelZoomInput' }
  protected override listens = ['render:host-ready']

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.app = payload.app
      this.renderContainer = payload.container
      this.canvas = payload.canvas
      this.renderer = payload.renderer

      const mouseWheel = this.resolve<any>('mouseWheel')
      mouseWheel?.attach(this, this.canvas)

      // restore saved zoom from 0000 viewport state
      this.vp = window.ioc.get<ViewportPersistence>('@diamondcoreprocessor.com/ViewportPersistence') ?? null
      if (this.vp && this.renderContainer) {
        void this.vp.read().then((snap) => {
          if (snap.zoom && this.renderContainer) {
            this.renderContainer.scale.set(snap.zoom.scale)
            this.renderContainer.position.set(snap.zoom.cx, snap.zoom.cy)
          }
        })
      }
    })
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

    this.app = null
    this.renderContainer = null
    this.canvas = null
    this.renderer = null
    this.activeSource = null
  }

  // -------------------------------------------------
  // exclusivity
  // -------------------------------------------------

  public begin = (source: string): boolean => {
    if (this.activeSource && this.activeSource !== source) return false
    this.activeSource = source
    return true
  }

  public end = (source: string): void => {
    if (this.activeSource === source) this.activeSource = null
  }

  // -------------------------------------------------
  // zoom api (used by inputs)
  // -------------------------------------------------

  public zoomByFactor = (factor: number, pivotClient: Pt, source: string): void => {
    if (!this.begin(source)) return
    if (!this.renderContainer || !this.canvas) return

    const target = this.renderContainer

    const current = target.scale.x || 1
    const next = this.clamp(current * factor)

    this.adjustZoom(target, next, pivotClient)
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

const _viewportPersistence = new ViewportPersistence()
window.ioc.register('@diamondcoreprocessor.com/ViewportPersistence', _viewportPersistence)

const _zoom = new ZoomDrone()
window.ioc.register('@diamondcoreprocessor.com/ZoomDrone', _zoom)
