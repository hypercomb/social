// pixi/background/editor-background.provider.ts
import { EffectBus } from '@hypercomb/core'
import type { Graphics } from 'pixi.js'
import type { BackgroundProvider } from './background.provider.js'

const FILL = 0x08589e
const FILL_ALPHA = 0.7

export class EditorBackgroundProvider implements BackgroundProvider {
  readonly name = 'editor'
  readonly priority = 90

  #active = false
  #unsub: (() => void) | null = null

  constructor(requestRedraw: () => void) {
    // The blue wash belonged to the old modal editor, which hid the hive. The
    // editor that fits into the view (a payload carrying `surface`) leaves the
    // hive's own ground alone — that is what "seamless" has to mean.
    this.#unsub = EffectBus.on<{ active: boolean; surface?: string }>('editor:mode', ({ active, surface }) => {
      const covering = active && surface === undefined
      if (covering !== this.#active) {
        this.#active = covering
        requestRedraw()
      }
    })
  }

  active(): boolean {
    return this.#active
  }

  render(g: Graphics, width: number, height: number): void {
    g.rect(-width / 2, -height / 2, width, height)
    g.fill({ color: FILL, alpha: FILL_ALPHA })
  }

  dispose(): void {
    this.#unsub?.()
    this.#unsub = null
  }
}
