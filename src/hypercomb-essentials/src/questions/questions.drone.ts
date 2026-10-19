// questions/questions.drone.ts
//
// The bee that plays Hypercomb Q and A: it holds the Questions service
// (questions.service.ts — a dependency, which exports and never registers),
// registers it, claims the entry gesture for question tiles (a question
// OPENS its answers — the overlay says `tile:open`, this bee opens the desk),
// and offers the game to the `start` word under its name. Registration is
// the bee's act.

import { Drone, EffectBus } from '@hypercomb/core'
import { claimEntry } from '../commands/decoration-kind-index.js'
import { GAME_NAME, QUESTION_KIND, QUESTIONS_KEY } from './questions.js'
import { Questions } from './questions.service.js'
import type { StartQueenBee } from './start.queen.js'

export class QuestionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Hypercomb Q and A — questions are tiles that settle into category layers as they arrive, answers are everyone\'s notes on them, taking an answer is its score, and the host tallies'

  protected override listens = ['tile:open', 'swarm:peers-changed', 'swarm:roster-changed', 'cell:added']
  protected override emits = ['notes:panel', 'note:capture', 'cell:added', 'tile:action', 'activity:log']

  readonly service = new Questions()

  constructor() {
    super()
    claimEntry(QUESTION_KIND)
    EffectBus.on<{ label?: string; kind?: string }>('tile:open', (p) => {
      if (p?.kind === QUESTION_KIND && p.label) this.service.open(p.label)
    })
    window.ioc.whenReady<StartQueenBee>('@diamondcoreprocessor.com/StartQueenBee', (start) => {
      start.register(GAME_NAME, () => this.service.start())
    })
  }
}

const _questions = new QuestionsDrone()
window.ioc.register('@diamondcoreprocessor.com/QuestionsDrone', _questions)
window.ioc.register(QUESTIONS_KEY, _questions.service)
