// src/<domain>/pixi/zoom.drone.ts
import { Drone } from '@hypercomb/core'

type Point = { x: number; y: number }

const { get } = window.ioc

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

    this.host = get('PixiHost')
    if (!this.host?.app) return

    this.canvas = this.host.app.canvas

    const mouseWheel = get<any>('MousewheelZoomInput')
    mouseWheel?.attach(this, this.canvas)
  }

  private detach = (): void => {
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

  public zoomByFactor = (factor: number, pivotClient: Point, source: string): void => {
    if (!this.begin(source)) return
    if (!this.host || !this.canvas) return

    const target = this.host.app.stage
    const current = target.scale.x || 1
    const next = this.clamp(current * factor)

    this.zoomTo(next, pivotClient)
  }

  // -------------------------------------------------
  // zoom math (keeps cursor pivot anchored)
  // -------------------------------------------------

  private zoomTo = (scale: number, pivotClient: Point): void => {
    if (!this.host || !this.canvas) return

    const target = this.host.app.stage
    const screen = this.clientToRendererScreen(pivotClient)

    // world point currently under cursor (before zoom)
    const worldX = (screen.x - target.position.x) / target.scale.x
    const worldY = (screen.y - target.position.y) / target.scale.y

    // apply uniform zoom
    target.scale.set(scale)

    // shift so the same world point remains under cursor
    target.position.set(
      screen.x - worldX * scale,
      screen.y - worldY * scale
    )
  }

  private clientToRendererScreen = (p: Point): Point => {
    const rect = this.canvas!.getBoundingClientRect()
    const screen = this.host.app.renderer.screen

    return {
      x: (p.x - rect.left) * (screen.width / rect.width),
      y: (p.y - rect.top) * (screen.height / rect.height)
    }
  }

  private clamp = (v: number): number =>
    Math.max(this.minScale, Math.min(this.maxScale, v))
}

window.ioc.register('ZoomDrone',new ZoomDrone())