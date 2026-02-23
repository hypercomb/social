// src/<domain>/pixi/panning.drone.ts
import { Drone } from '@hypercomb/core'
const { get } = window.ioc

type Point = { x: number; y: number }

export class PanningDrone extends Drone {

  public override description = 'authoritative panning controller'
  private initialized = false

  private host: any = null
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

    const mousePan = get<any>('MousePanInput')
    mousePan?.attach(this, this.host.app.canvas)
  }

  private detach = (): void => {
    const mousePan = get<any>('MousePanInput')
    mousePan?.detach()

    this.host = null
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
    if (this.activeSource === source) {
      this.activeSource = null
    }
  }

  // -------------------------------------------------
  // pan api (used by inputs)
  // -------------------------------------------------

  public panBy = (delta: Point, source: string): void => {
    if (!this.begin(source)) return
    if (!this.host) return

    const stage = this.host.app.stage
    stage.position.x += delta.x
    stage.position.y += delta.y
  }
}

window.ioc.register('PanningDrone',new PanningDrone())