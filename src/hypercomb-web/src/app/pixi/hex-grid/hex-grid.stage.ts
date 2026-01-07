// src/app/pixi/hex-grid/hex-grid.stage.ts

import { Application, Container } from 'pixi.js'

export class HexGridStage {

  public readonly app: Application
  public readonly world: Container

  private readonly host: HTMLElement
  private readonly ro: ResizeObserver

  private constructor(app: Application, host: HTMLElement) {
    this.app = app
    this.host = host

    this.world = new Container()
    this.app.stage.addChild(this.world)

    this.ro = new ResizeObserver(() => this.onHostResize())
    this.ro.observe(this.host)

    this.centerWorld()
  }

  public static create = async (host: HTMLElement): Promise<HexGridStage> => {
    const app = new Application()

    // v8: init is async, and app.canvas exists after init :contentReference[oaicite:2]{index=2}
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true
    })

    host.appendChild(app.canvas)

    return new HexGridStage(app, host)
  }

  public destroy = (): void => {
    this.ro.disconnect()
    this.app.destroy(true)
  }

  private onHostResize = (): void => {
    // ensure pixi recomputes against resizeTo, then re-center
    this.app.resize()
    this.centerWorld()
  }

  private centerWorld = (): void => {
    // keep origin centered so (0,0) is screen-center
    this.world.x = this.app.screen.width / 2
    this.world.y = this.app.screen.height / 2
  }
}
