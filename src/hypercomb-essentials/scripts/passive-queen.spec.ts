// passive-queen.spec.ts — a queen sleeps only when loading her does nothing
// but make her ready to answer her word.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { declaresMachine, effectSleeper, passiveQueen, viewSleeper } from './passive-queen'

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

  it('stays awake when she registers anything else, declares no word, or pulses', () => {
    const two = queen() + "window.ioc.register('@diamondcoreprocessor.com/LayoutService', {})"
    expect(passiveQueen('a/layout.queen.ts', two, new Map())).toMatchObject({ passive: false })
    const named = queen() + 'window.ioc.register(LAYOUT_SERVICE_KEY, new LayoutService())'
    expect(passiveQueen('a/layout.queen.ts', named, new Map())).toMatchObject({ passive: false, why: 'registers a service by a named key' })
    const wordless = queen().replace("readonly command = 'layout'", '')
    expect(passiveQueen('a/layout.queen.ts', wordless, new Map())).toMatchObject({ passive: false, why: 'declares no word' })
    const pulsing = queen('').replace('protected execute', 'protected heartbeat(): void {}\n  protected execute')
    expect(passiveQueen('a/layout.queen.ts', pulsing, new Map())).toMatchObject({ passive: false, why: 'pulses' })
  })

  it('is judged by her declaration, never her file name', () => {
    expect(passiveQueen('a/layout.drone.ts', queen(), new Map())).toMatchObject({ passive: true })
  })

  it('stays awake when a machine may say her word — her module is the only place that says how', () => {
    const offered = queen().replace("readonly command = 'layout'", "readonly command = 'layout'\n  override machine = { forms: '<name>', example: '/layout grid', reach: 'editing' as const, scope: 'page' as const }")
    expect(passiveQueen('a/layout.queen.ts', offered, new Map())).toEqual({ passive: false, why: 'offers herself to a machine' })
    const typed = queen().replace("readonly command = 'layout'", "readonly command = 'layout'\n  public override machine: MachineGrammar = {\n    forms: '<name>',\n  }")
    expect(passiveQueen('a/layout.queen.ts', typed, new Map())).toMatchObject({ passive: false, why: 'offers herself to a machine' })
    expect(declaresMachine(queen('const machine = this.machine?.forms'))).toBe(false)
    expect(declaresMachine('// override machine = {} is how a queen offers herself')).toBe(false)
  })

  it('stays awake when she takes her arguments verbatim — the command line must know before it reads the line', () => {
    const raw = queen().replace("readonly command = 'layout'", "readonly command = 'layout'\n  override rawArgs = true")
    expect(passiveQueen('a/layout.queen.ts', raw, new Map())).toEqual({ passive: false, why: 'takes her arguments verbatim' })
    const off = queen().replace("readonly command = 'layout'", "readonly command = 'layout'\n  override rawArgs = false")
    expect(passiveQueen('a/layout.queen.ts', off, new Map())).toMatchObject({ passive: true })
  })

  it('no queen in the generated sleeping table declares a machine block', () => {
    // The table is generated from this rule; the guard is what notices a
    // table that was not regenerated after a queen gained a machine block.
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
    const table = readFileSync(join(src, 'sleeping-effects.ts'), 'utf8')
    const asleep = [...table.matchAll(/command: "([^"]+)"[^\n]*import\('\.\/([^']+)'\)/g)].map(match => ({ word: match[1]!, file: join(src, `${match[2]!}.ts`) }))
    expect(asleep.length).toBeGreaterThan(20)
    const offered = asleep.filter(row => declaresMachine(readFileSync(row.file, 'utf8'))).map(row => row.word)
    expect(offered).toEqual([])
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

const effectDrone = (extra = ''): string => `
export class ExpandDrone extends Drone {
  readonly wakesOn: readonly string[] = ['expand:layer']
  protected override heartbeat = async () => { this.onEffect('expand:layer', () => {}) ${extra} }
}
window.ioc.register('@diamondcoreprocessor.com/ExpandDrone', new ExpandDrone())
`

describe('effect sleeper', () => {
  it('sleeps until the effects it declares', () => {
    expect(effectSleeper('a/expand.drone.ts', effectDrone(), new Map())).toEqual({ sleeps: true, wakesOn: ['expand:layer'] })
  })

  it('stays awake when it subscribes to more than it declares, or to the DOM', () => {
    expect(effectSleeper('a/expand.drone.ts', effectDrone("this.onEffect('render:host-ready', () => {})"), new Map())).toMatchObject({ sleeps: false, why: 'subscribes to undeclared render:host-ready' })
    expect(effectSleeper('a/expand.drone.ts', effectDrone("window.addEventListener('keydown', () => {})"), new Map())).toMatchObject({ sleeps: false, why: 'listens to the DOM' })
    expect(effectSleeper('a/expand.drone.ts', effectDrone('this.onEffect(SOME_EFFECT, () => {})'), new Map())).toMatchObject({ sleeps: false })
  })

  it('stays awake when its effect is sent without replay', () => {
    const others = new Map([['b/x.ts', "EffectBus.emitTransient('expand:layer', {})"]])
    expect(effectSleeper('a/expand.drone.ts', effectDrone(), others)).toMatchObject({ sleeps: false })
  })
})
