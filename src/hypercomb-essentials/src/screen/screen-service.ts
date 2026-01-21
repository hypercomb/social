import { Injectable, signal, computed } from "@angular/core"
import { Point } from "pixi.js"
import { ScreenState } from "./screen-state"
declare const document: any

export class ScreenService {

  private readonly _isFullScreen = signal(false)
  public readonly isFullScreen = this._isFullScreen.asReadonly()

  // initialized safely (no browser globals)
  private readonly _windowSize = signal<{ width: number; height: number }>({
    width: 0,
    height: 0,
  })

  public readonly windowSize = this._windowSize.asReadonly()
  public readonly windowWidth = computed(() => this._windowSize().width)
  public readonly windowHeight = computed(() => this._windowSize().height)

  private readonly _screenSize = signal<{ width: number; height: number }>({
    width: 0,
    height: 0,
  })

  public readonly screenSize = this._screenSize.asReadonly()
  public readonly width = computed(() => this._screenSize().width)
  public readonly height = computed(() => this._screenSize().height)

  public readonly offsetX = computed(() =>
    typeof screen !== 'undefined' && typeof window !== 'undefined'
      ? (screen.width - window.outerWidth) / 2
      : 0
  )

  public readonly offsetY = computed(() =>
    typeof screen !== 'undefined' && typeof window !== 'undefined'
      ? (screen.height - window.outerHeight) / 2
      : 0
  )

  constructor(private screenState: ScreenState) {
    this._isFullScreen.set(this.screenState.isFullScreen)

    // guard browser-only logic
    if (typeof window === 'undefined') return

    this._windowSize.set({
      width: window.innerWidth,
      height: window.innerHeight,
    })

    if (typeof screen !== 'undefined') {
      this._screenSize.set({
        width: screen.width,
        height: screen.height,
      })
    }

    window.addEventListener('resize', () => {
      this._windowSize.set({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    })
  }

  public getWindowCenter(): Point {
    const { width, height } = this._windowSize()
    return new Point(width / 2, height / 2)
  }

  public async goFullscreen() {
    if (typeof document === 'undefined') return

    if (!document.fullscreenElement) {
      this._isFullScreen.set(true)
      this.screenState.isFullScreen = true

      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      } else if (document.documentElement.webkitRequestFullscreen) {
        await document.documentElement.webkitRequestFullscreen()
      } else if (document.documentElement.msRequestFullscreen) {
        await document.documentElement.msRequestFullscreen()
      }
    } else {
      this._isFullScreen.set(false)
      this.screenState.isFullScreen = false

      if (document.exitFullscreen) {
        await document.exitFullscreen()
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen()
      } else if (document.msExitFullscreen) {
        await document.msExitFullscreen()
      }
    }
  }
}
