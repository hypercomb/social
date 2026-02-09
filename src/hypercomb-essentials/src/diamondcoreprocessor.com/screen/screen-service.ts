// @essentials/default/screen-service

import { get } from "@hypercomb/core"
import { ScreenState } from "./screen-state.js"

export type ScreenSnapshot = {
  isFullScreen: boolean
  windowWidth: number
  windowHeight: number
  screenWidth: number
  screenHeight: number
  offsetX: number
  offsetY: number
}

export class ScreenService {
  private listeners = new Set<(s: ScreenSnapshot) => void>()

  private state: ScreenSnapshot = {
    isFullScreen: false,
    windowWidth: 0,
    windowHeight: 0,
    screenWidth: 0,
    screenHeight: 0,
    offsetX: 0,
    offsetY: 0,
  }

  constructor() {
    this.sync()
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.sync())
    }
  }

  private sync() {
    if (typeof window === 'undefined') return
    const screenstate = get<ScreenState>('signature:screenstate')!
    this.state = {
      isFullScreen: screenstate.isFullScreen,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      screenWidth: screen?.width ?? 0,
      screenHeight: screen?.height ?? 0,
      offsetX: screen ? (screen.width - window.outerWidth) / 2 : 0,
      offsetY: screen ? (screen.height - window.outerHeight) / 2 : 0,
    }

    this.emit()
  }

  public getSnapshot(): ScreenSnapshot {
    return this.state
  }

  public subscribe(fn: (s: ScreenSnapshot) => void): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state)
  }
}
