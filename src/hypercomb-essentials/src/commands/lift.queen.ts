// /lift — the LIFT VIEW. The page's tiles lifted off the grid into 3D, with
// the page's other layers — each participant's version, then the page's own
// history — stacked behind it like a slide deck. The wheel flips the deck over
// empty space and rolls one tile's versions over a tile; Apply carries the
// choice through the hive's existing doors (lift-view.drone.ts).
//
// The queen only toggles the mode. She never asks IoC for the view's bee by
// key — that would wake the sleeper on every load (scripts/passive-queen.ts).

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { LIFT_VIEW } from '../presentation/tiles/lift-deck.js'

type ViewModeShape = { mode: string; setMode(next: string): void }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class LiftQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lift'
  override descriptionKey = 'slash.lift'
  override description = 'Lift the page into 3D — its layers stacked behind it like a slide deck'
  override options = ['on', 'off']
  override examples = [
    { input: '/lift', result: 'Opens or closes the lift view' },
  ]

  protected async execute(args: string): Promise<void> {
    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) return
    const [verb = ''] = args.trim().toLowerCase().split(/\s+/, 1)
    const next = verb === 'off' || verb === 'close' ? 'hexagons'
      : verb === 'on' || verb === 'open' ? LIFT_VIEW
        : vm.mode === LIFT_VIEW ? 'hexagons' : LIFT_VIEW
    vm.setMode(next)
    EffectBus.emit('activity:log', {
      message: next === LIFT_VIEW ? 'Lifted the page into 3D' : 'Back to the hexagons',
      icon: 'layers',
    })
  }
}

const _lift = new LiftQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LiftQueenBee', _lift)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: LIFT_VIEW,
    slashCommand: '/lift',
    iconName: 'layers',
    toggleIcon: 'layers',
    behavior: 'render',
    decorationKind: 'visual:lift:deck',
    labelKey: 'view.lift',
    descriptionKey: 'view.lift.description',
    queenKey: '@diamondcoreprocessor.com/LiftQueenBee',
    // The deck IS the page's own layers — nothing to author first.
    attachable: true,
    // Layer-local: the lift reads the page you stand on, no further.
    scope: 'node',
    pheromones: ['platform:desktop', 'platform:mobile'],
  }),
)
