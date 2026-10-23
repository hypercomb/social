// questions/questions.drone.ts
//
// The bee that plays Hypercomb Q and A: it holds the Questions service
// (questions.service.ts — a dependency, which exports and never registers),
// registers it, claims the entry gesture for question tiles (a question
// OPENS its answers — the overlay says `tile:open`, this bee opens the desk),
// and offers the game to the `start` word under its name. Registration is
// the bee's act.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { claimEntry } from '../commands/decoration-kind-index.js'
import { GAME_NAME, QUESTION_KIND, QUESTIONS_KEY } from './questions.js'
import { Questions } from './questions.service.js'
import type { StartQueenBee } from './start.queen.js'

export class QuestionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Hypercomb Q and A — questions are tiles that settle into category layers as they arrive, answers are everyone\'s notes on them, taking an answer is its score, and the host tallies'

  protected override listens = ['tile:open', 'swarm:peers-changed', 'swarm:roster-changed', 'cell:added', 'render:cell-count', 'notes:changed', 'swarm:wand', 'swarm:visit-folded']
  protected override emits = ['notes:panel', 'note:capture', 'cell:added', 'tile:action', 'activity:log']

  readonly service = new Questions()

  constructor() {
    super()
    claimEntry(QUESTION_KIND)
    EffectBus.on<{ label?: string; kind?: string }>('tile:open', (p) => {
      if (p?.kind === QUESTION_KIND && p.label) this.service.open(p.label)
    })
    window.ioc.whenReady<StartQueenBee>('@diamondcoreprocessor.com/StartQueenBee', (start) => {
      start.register(GAME_NAME, () => this.service.start(), (result, game) => {
        const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
        const params = { game, where: result.where || '/' }
        return result.outcome === 'started'
          ? (i18n?.t('questions.started', params) ?? `${game} started at /${params.where} — ask with "question <your question>"; questions settle into categories as they arrive`)
          : (i18n?.t('questions.resumed', params) ?? `${game} is on at /${params.where} — questions keep settling as they arrive`)
      })
    })
  }
}

const _questions = new QuestionsDrone()
window.ioc.register('@diamondcoreprocessor.com/QuestionsDrone', _questions)
window.ioc.register(QUESTIONS_KEY, _questions.service)
