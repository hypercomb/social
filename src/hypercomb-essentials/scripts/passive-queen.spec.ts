// passive-queen.spec.ts — a queen sleeps only when loading her does nothing
// but make her ready to answer her word.

import { describe, expect, it } from 'vitest'
import { passiveQueen, viewSleeper } from './passive-queen'

const queen = (body = ''): string => `
import { QueenBee } from '@hypercomb/core'
export class LayoutQueenBee extends QueenBee {
  readonly command = 'layout'
  protected execute(args: string): void { ${body} }
}
window.ioc.register('@diamondcoreprocessor.com/LayoutQueenBee', new LayoutQueenBee())
`

describe('passive queen', () => {
  it('sleeps when her module only registers herself', () => {
    expect(passiveQueen('a/layout.queen.ts', queen('EffectBus.emit("x", 1)'), new Map())).toEqual({ passive: true, key: '@diamondcoreprocessor.com/LayoutQueenBee' })
  })

  it('stays awake when loading her changes the hive', () => {
    const view = queen() + `window.ioc.whenReady('@x.com/VisualBeeRegistry', r => r.register({ view: 'layout' }))`
    expect(passiveQueen('a/layout.queen.ts', view, new Map())).toMatchObject({ passive: false })
    const listens = queen().replace("readonly command = 'layout'", "readonly command = 'layout'\n  protected override listens = ['keymap:invoke']")
    expect(passiveQueen('a/layout.queen.ts', listens, new Map())).toMatchObject({ passive: false, why: 'listens to effects' })
  })

  it('stays awake when another file asks for her by key', () => {
    const others = new Map([['b/menu.drone.ts', "get('@diamondcoreprocessor.com/LayoutQueenBee')"]])
    expect(passiveQueen('a/layout.queen.ts', queen(), others)).toMatchObject({ passive: false, why: 'key named by b/menu.drone.ts' })
  })

  it('stays awake when another module imports her', () => {
    const others = new Map([['b/menu.drone.ts', "import { LayoutQueenBee } from './layout.queen.js'"]])
    expect(passiveQueen('a/layout.queen.ts', queen(), others)).toMatchObject({ passive: false, why: 'imported by b/menu.drone.ts' })
  })

  it('a namespace barrel re-exporting her does not keep her awake — its build drops bees', () => {
    const others = new Map([['a/index.ts', "export * from './layout.queen'"]])
    expect(passiveQueen('a/layout.queen.ts', queen(), others)).toMatchObject({ passive: true })
  })

  it('stays awake when she registers anything else, or is not a queen module', () => {
    const two = queen() + "window.ioc.register('@diamondcoreprocessor.com/LayoutService', {})"
    expect(passiveQueen('a/layout.queen.ts', two, new Map())).toMatchObject({ passive: false })
    expect(passiveQueen('a/layout.drone.ts', queen(), new Map())).toMatchObject({ passive: false })
  })
})

const viewDrone = (renders = "readonly renders: readonly string[] = ['slides', 'lightbox']"): string => `
export class SlidesViewDrone extends Drone {
  ${renders}
}
window.ioc.register('@diamondcoreprocessor.com/SlidesViewDrone', new SlidesViewDrone())
`

describe('view sleeper', () => {
  it('sleeps on the views it declares it renders', () => {
    expect(viewSleeper('a/slides-view.drone.ts', viewDrone(), new Map())).toEqual({ sleeps: true, renders: ['slides', 'lightbox'] })
  })

  it('stays awake without a declaration, or when something else reaches for it', () => {
    expect(viewSleeper('a/slides-view.drone.ts', viewDrone(''), new Map())).toMatchObject({ sleeps: false })
    const named = new Map([['b/x.queen.ts', "get('@diamondcoreprocessor.com/SlidesViewDrone')"]])
    expect(viewSleeper('a/slides-view.drone.ts', viewDrone(), named)).toMatchObject({ sleeps: false, why: 'key named by b/x.queen.ts' })
  })
})
