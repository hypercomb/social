import { Injectable, signal, computed } from "@angular/core"
import { Point } from "pixi.js"
import { ScreenState } from "src/app/state/interactivity/screen-state"

declare const document: any

@Injectable({ providedIn: 'root' })
export class ScreenService {
  private readonly _isFullScreen = signal(false)
  public readonly isFullScreen = this._isFullScreen.asReadonly()

  private readonly _windowSize = signal<{ width: number; height: number }>({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  public readonly windowSize = this._windowSize.asReadonly()

  public readonly windowWidth = computed(() => this._windowSize().width)
  public readonly windowHeight = computed(() => this._windowSize().height)

  public readonly screenSize = signal<{ width: number; height: number }>({
    width: screen.width,
    height: screen.height,
  })

  public readonly width = computed(() => this.screenSize().width)
  public readonly height = computed(() => this.screenSize().height)

  public readonly offsetX = computed(() => (screen.width - window.outerWidth) / 2)
  public readonly offsetY = computed(() => (screen.height - window.outerHeight) / 2)

  constructor(private screenState: ScreenState) {
    // sync external state if you want to keep it around
    this._isFullScreen.set(this.screenState.isFullScreen)

    // keep windowSize in sync with resize events
    window.addEventListener('resize', () => {
      this._windowSize.set({ width: window.innerWidth, height: window.innerHeight })
    })
  }

  public getWindowCenter(): Point {
    const { width, height } = this._windowSize()
    return new Point(width / 2, height / 2)
  }

  public async goFullscreen() {
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


