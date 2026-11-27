// pools/pools.queen.ts
//
// `pools`: POOLS MODE, BY WORD. The stage between private and the swarm, where
// every tile is on or off and what is on is offered (lights-contract.ts):
//
//   pools            start pools mode (the header's lock does the same)
//   pools publish    leave what the lit tiles carry in your pools at your domain
//   pools off        go back to private; what is on stays on
//
// The word only ASKS. Each form is one transient command on the EffectBus: the
// header owns the mode and the pools mode drone owns the publish, so there is
// one way in, one way out and one publish however it was asked for.
//
// Publishing speaks for the participant to everyone who follows their host, so
// it is theirs to say (T5): this queen declares no machine grammar, and no
// model can call it. Aliases are the participant's to give.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { LIGHTS_ENTER, LIGHTS_LEAVE, LIGHTS_MODE, LIGHTS_PUBLISH, type LightsMode } from './lights-contract.js'
import { poolsSay } from './pools-bar.js'

const WORDS = ['off', 'publish'] as const

/** Whether pools mode is up, read from the mode's last value. */
const poolsModeUp = (): boolean => {
  let up = false
  EffectBus.on<LightsMode>(LIGHTS_MODE, mode => { up = mode?.active === true })()
  return up
}

export class PoolsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'pools'
  override description = 'Turn tiles on for your pools of meaning, and publish what is on'
  override descriptionKey = 'slash.pools'
  override options = [...WORDS]
  override examples = [
    { input: '/pools', result: 'Starts pools mode: tap a tile to turn it on, and what is on is yours to offer' },
    { input: '/pools publish', result: 'Leaves what the lit tiles carry in your pools at your own domain' },
    { input: '/pools off', result: 'Goes back to private. What is on stays on' },
  ]

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return WORDS.filter(word => word.startsWith(typed) && word !== typed)
  }

  protected execute(args: string): void {
    const word = args.trim().toLowerCase()
    if (word === 'off') { EffectBus.emitTransient(LIGHTS_LEAVE, {}); return }
    if (word === 'publish') { EffectBus.emitTransient(LIGHTS_PUBLISH, {}); return }
    if (word) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: poolsSay('pools.word.usage', '/pools starts pools mode, /pools publish leaves what is on in your pools, /pools off goes back to private.'),
      })
      return
    }
    EffectBus.emitTransient(LIGHTS_ENTER, {})
    // The header answers at once, and inside a swarm it does not answer at all.
    if (!poolsModeUp()) {
      EffectBus.emit('toast:show', {
        type: 'info',
        message: poolsSay('pools.word.refused', 'Pools mode did not start here. Inside a swarm, leave it first.'),
      })
    }
  }
}

const _pools = new PoolsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PoolsQueenBee', _pools)
