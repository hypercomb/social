// diamondcoreprocessor.com/pixi/background/background.drone.ts
import { Drone } from '@hypercomb/core'
import { Container, Graphics } from 'pixi.js'
import type { HostReadyPayload } from '../pixi-host.drone.js'
import type { BackgroundProvider } from './background.provider.js'

export class BackgroundDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'pluggable canvas background coordinator'

  #container: Container | null = null
  #graphics: Graphics | null = null
  #providers: BackgroundProvider[] = []
  #lastProviderName = ''

  protected override deps = {}
  protected override listens = ['render:host-ready']
  protected override emits: string[] = []

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#container = payload.container
      this.#initGraphics()
      this.#redraw()
    })
  }

  addProvider(provider: BackgroundProvider): void {
    this.#providers.push(provider)
    this.#providers.sort((a, b) => b.priority - a.priority)
    this.#redraw()
  }

  requestRedraw = (): void => {
    this.#redraw()
  }

  #initGraphics(): void {
    if (!this.#container || this.#graphics) return
    this.#graphics = new Graphics()
    this.#graphics.zIndex = -1000
    this.#container.addChild(this.#graphics)
    this.#container.sortableChildren = true
  }

  #redraw(): void {
    if (!this.#graphics) return
    this.#graphics.clear()

    const winner = this.#providers.find(p => p.active())
    if (!winner) {
      this.#lastProviderName = ''
      return
    }

    if (winner.name !== this.#lastProviderName) {
      this.#lastProviderName = winner.name
    }

    // large rectangle covering pan/zoom range (same pattern as legacy)
    winner.render(this.#graphics, 200000, 200000)
  }

  protected override dispose(): void {
    for (const p of this.#providers) p.dispose?.()
    if (this.#graphics) {
      this.#graphics.destroy()
      this.#graphics = null
    }
  }
}

import { MoveBackgroundProvider } from './move-background.provider.js'
import { EditorBackgroundProvider } from './editor-background.provider.js'

const _background = new BackgroundDrone()
_background.addProvider(new MoveBackgroundProvider(_background.requestRedraw))
_background.addProvider(new EditorBackgroundProvider(_background.requestRedraw))
window.ioc.register('@diamondcoreprocessor.com/BackgroundDrone', _background)
