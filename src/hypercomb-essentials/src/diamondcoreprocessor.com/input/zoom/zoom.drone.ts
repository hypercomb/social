// hypercomb-essentials/src/diamondcoreprocessor.com/input/zoom/zoom.drone.ts

import { Drone } from '@hypercomb/core'
import { Point } from 'pixi.js'

type Pt = { x: number; y: number }

export class ZoomDrone extends Drone {
  public override description = 'authoritative zoom controller'

  private initialized = false

  private host: any = null
  private canvas: HTMLCanvasElement | null = null

  private readonly minScale = 0.05
  private readonly maxScale = 12

  private activeSource: string | null = null

  protected override sense = (): boolean => {
    const prev = this.initialized
    this.initialized = true
    return !prev
  }

  protected override heartbeat = async (): Promise<void> => {
    this.attach()
  }

  public stop = async (): Promise<void> => {
    this.detach()
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  private attach = (): void => {
    if (this.host) return

    const { get } = window.ioc

    this.host = get('PixiHost')
    if (!this.host?.app || !this.host?.container) return

    this.canvas = this.host.app.canvas

    const mouseWheel = get<any>('MousewheelZoomInput')
    mouseWheel?.attach(this, this.canvas)
  }

  private detach = (): void => {
    const { get } = window.ioc

    const mouseWheel = get<any>('MousewheelZoomInput')
    mouseWheel?.detach()

    this.host = null
    this.canvas = null
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
    if (!this.host || !this.canvas) return

    // zoom the world root (the thing your honeycomb is under)
    const target = this.host.container

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
    const app = this.host?.app
    if (!app || !this.canvas) return

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
      return
    }

    target.position.set(
      target.position.x + (pivotGlobal.x - postGlobal.x),
      target.position.y + (pivotGlobal.y - postGlobal.y)
    )
  }

  // -------------------------------------------------
  // input mapping
  // -------------------------------------------------
  //
  // returns pixi "global" coordinates in renderer.screen units (top-left origin)
  // this must match the coordinate space used by toLocal/toGlobal.
  //

  private clientToPixiGlobal = (p: Pt): Pt => {
    const renderer = this.host!.app.renderer
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

const { get, register, list } = window.ioc
window.ioc.register('ZoomDrone', new ZoomDrone())
