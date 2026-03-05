// src/<domain>/pixi/zoom/zoom-state.ts

type Point = { x: number; y: number }

type ContainerLike = {
  position: { x: number; y: number }
  scale: { x: number; y: number }
}

type PixiHostLike = {
  // expected to be the viewport root that you zoom (stage child, world container, etc)
  container: ContainerLike | null
}

export type ZoomSnapshot = {
  scale: number
  x: number
  y: number
}

export class ZoomState {

  // ---------------------------------------------
  // config
  // ---------------------------------------------

  private minScale = 0.2
  private maxScale = 8
  private defaultScale = 1

  // ---------------------------------------------
  // state
  // ---------------------------------------------

  private current = this.defaultScale
  private scopeKey = 'global'
  private readonly snapshots = new Map<string, ZoomSnapshot>()

  // ---------------------------------------------
  // service access
  // ---------------------------------------------

  private getService = (key: string): any => {
    const ioc = (globalThis as any).ioc
    if (!ioc || typeof ioc.get !== 'function') {
      throw new Error(`[zoom-state] missing global ioc.get for key: ${key}`)
    }
    return ioc.get(key)
  }

  private get pixi(): PixiHostLike { return this.getService('@diamondcoreprocessor.com/PixiHostWorker') }

  // ---------------------------------------------
  // api
  // ---------------------------------------------

  public get currentScale(): number {
    return this.current
  }

  public setConstraints = (minScale: number, maxScale: number, defaultScale = this.defaultScale): void => {
    this.minScale = minScale
    this.maxScale = maxScale
    this.defaultScale = defaultScale
    this.clampAndSync()
  }

  public setScope = (scopeKey: string): void => {
    if (!scopeKey) scopeKey = 'global'
    if (this.scopeKey === scopeKey) return

    // persist outgoing
    this.persistSnapshot()

    // load incoming
    this.scopeKey = scopeKey
    const next = this.snapshots.get(this.scopeKey)
    if (next) {
      this.applySnapshot(next)
      return
    }

    // default for new scopes
    this.reset()
  }

  public reset = (pivot?: Point): void => {
    const container = this.pixi.container
    if (!container) {
      this.current = this.defaultScale
      return
    }

    const p = pivot ?? { x: 0, y: 0 }
    this.zoomToScale(this.defaultScale, p)
  }

  public zoomToScale = (scale: number, pivot: Point): void => {
    const container = this.pixi.container
    if (!container) return

    const oldScale = this.getUniformScale(container) || 1
    const nextScale = this.clamp(scale)

    // keep the same world point under the pivot after scaling
    const worldX = (pivot.x - container.position.x) / oldScale
    const worldY = (pivot.y - container.position.y) / oldScale

    container.scale.x = nextScale
    container.scale.y = nextScale

    container.position.x = pivot.x - worldX * nextScale
    container.position.y = pivot.y - worldY * nextScale

    this.current = nextScale
    this.persistSnapshot()
  }

  public snapshot = (): ZoomSnapshot => {
    const container = this.pixi.container
    if (!container) {
      return { scale: this.current, x: 0, y: 0 }
    }

    return {
      scale: this.getUniformScale(container) || this.current,
      x: container.position.x,
      y: container.position.y
    }
  }

  // ---------------------------------------------
  // internals
  // ---------------------------------------------

  private persistSnapshot = (): void => {
    this.snapshots.set(this.scopeKey, this.snapshot())
  }

  private applySnapshot = (snap: ZoomSnapshot): void => {
    const container = this.pixi.container
    if (!container) {
      this.current = this.clamp(snap.scale)
      return
    }

    const s = this.clamp(snap.scale)

    container.scale.x = s
    container.scale.y = s
    container.position.x = snap.x
    container.position.y = snap.y

    this.current = s
    this.persistSnapshot()
  }

  private clampAndSync = (): void => {
    const container = this.pixi.container
    if (!container) {
      this.current = this.clamp(this.current)
      return
    }

    const s = this.clamp(this.getUniformScale(container) || this.current)
    container.scale.x = s
    container.scale.y = s
    this.current = s
    this.persistSnapshot()
  }

  private clamp = (value: number): number => {
    if (!Number.isFinite(value)) return this.defaultScale
    if (value < this.minScale) return this.minScale
    if (value > this.maxScale) return this.maxScale
    return value
  }

  private getUniformScale = (container: ContainerLike): number => {
    const x = container.scale?.x ?? 1
    const y = container.scale?.y ?? 1
    return (x + y) / 2
  }
}
