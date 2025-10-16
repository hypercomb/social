// i-pixi-manager.ts
import { Application, Container, Point, Renderer, WebGLRenderer } from "pixi.js"
import { Signal } from "@angular/core"

export interface IPixiManager {
  whenReady(): Signal<Application | null>
  renderer: any
  app: Application | null
  canvas: Signal<HTMLCanvasElement | null>
  container: Container | null
  getRenderer(): WebGLRenderer
  getOffset(index: number): Point
  readonly ready: Signal<Application | null>
  initialize(host?: HTMLElement): Promise<Application | undefined>
}

import { InjectionToken } from "@angular/core"
export const PIXI_MANAGER = new InjectionToken<IPixiManager>("PIXI_MANAGER")
