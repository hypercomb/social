// diamondcoreprocessor.com/sharing/observe.drone.ts
//
// The OBSERVE verb — surfaces the swarm-as-observation substrate.
//
// `/observe` toggles a read-only right-docked panel listing the attributed data
// points at the current location: who is here and what they are sharing, ranked
// by live interest. This drone owns NO data of its own — it reads the ephemeral
// read-model (swarm-observation.ts) on demand and RE-EMITS whenever the swarm
// breathes (peers join/leave, interest shifts), so the panel stays live without
// polling. It is OBSERVATION ONLY — no swarm-specific adopt/sync button (that
// model is retired). Acting on what you observe is the SAME features icon you
// use solo: identical in both scenarios, one surface, no "swarm mode".
//
// Shell parity: the panel is a shared Angular component (it must not import
// essentials), so all data crosses the boundary as `observe:render` payloads and
// all intents come back as effects (observe:set-filter, observe:adopt,
// observe:close).

import { Drone } from '@hypercomb/core'
import {
  observeDataPoints,
  readObservationFilter,
  writeObservationFilter,
  type ObservationFilter,
  type ObservationGroup,
} from './swarm-observation.js'

interface ObserveRenderPayload {
  open: boolean
  groups: ObservationGroup[]
  filter: ObservationFilter
}

interface SetFilterPayload {
  showNames?: boolean
  groupBy?: ObservationFilter['groupBy']
}

export class ObserveDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Read-only observation of the swarm at the current location: lists attributed data points (who is here, what they share) ranked by live interest, with an observer-local filter. Selecting adopt routes through the existing adopt verb. Live — re-emits as the swarm breathes.'

  protected override listens: string[] = [
    'observe:toggle', 'observe:close', 'observe:set-filter',
    'swarm:presence-changed', 'swarm:peers-changed',
  ]
  protected override emits: string[] = ['observe:render']

  #open = false

  constructor() {
    super()

    this.onEffect('observe:toggle', () => {
      this.#open = !this.#open
      this.#publish()
    })

    this.onEffect('observe:close', () => {
      if (!this.#open) return
      this.#open = false
      this.#publish()
    })

    this.onEffect<SetFilterPayload>('observe:set-filter', (patch) => {
      const current = readObservationFilter()
      const next: ObservationFilter = {
        showNames: typeof patch?.showNames === 'boolean' ? patch.showNames : current.showNames,
        groupBy: patch?.groupBy === 'participant' || patch?.groupBy === 'domain' || patch?.groupBy === 'flat'
          ? patch.groupBy
          : current.groupBy,
      }
      writeObservationFilter(next)
      if (this.#open) this.#publish()
    })

    // The swarm breathing — peers join/leave, interest shifts. While the panel
    // is open, re-derive and push so points appear and vanish live. Cheap: the
    // read-model is a pure roll-up of caches already in memory.
    const refresh = (): void => { if (this.#open) this.#publish() }
    this.onEffect('swarm:presence-changed', refresh)
    this.onEffect('swarm:peers-changed', refresh)
  }

  #publish(): void {
    const filter = readObservationFilter()
    this.emitEffect<ObserveRenderPayload>('observe:render', {
      open: this.#open,
      groups: this.#open ? observeDataPoints(filter) : [],
      filter,
    })
  }
}

const _observe = new ObserveDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ObserveDrone',
  _observe,
)
