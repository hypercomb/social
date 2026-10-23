// questions/questions.drone.ts
//
// The bee that plays Hypercomb Q and A: it holds the Questions service
// (questions.service.ts — a dependency, which exports and never registers),
// registers it, claims the entry gesture for question tiles (a question
// OPENS its answers — the overlay says `tile:open`, this bee opens the desk),
// claims the PRESENCE of the game's `<hive> q and a` child (never a hexagon:
// it is drawn as the door), mounts the door in the chrome, and offers the
// game to the `start` word by the words its name ends with. Registration is
// the bee's act.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { claimEntry, claimPresence } from '../commands/decoration-kind-index.js'
import { GAME_NAME, GAME_SUFFIX, QUESTION_KIND, QUESTIONS_KEY } from './questions.js'
import { Questions } from './questions.service.js'
import { QUESTIONS_DOOR_SURFACE, QuestionsDoorElement } from './questions-door.js'
import type { StartQueenBee } from './start.queen.js'

export class QuestionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Hypercomb Q and A — named for the hive shared as the swarm; the host leads the room through the hive, every layer has its questions, answers are everyone\'s notes on them, taking an answer is its score, and the host tallies'

  protected override listens = ['tile:open', 'swarm:peers-changed', 'swarm:roster-changed', 'cell:added', 'render:cell-count', 'notes:changed', 'swarm:wand', 'swarm:visit-folded']
  protected override emits = ['notes:panel', 'note:capture', 'cell:added', 'tile:action', 'activity:log']

  readonly service = new Questions()

  constructor() {
    super()
    claimEntry(QUESTION_KIND)
    claimPresence((name, segments) => this.service.claims(name, segments))
    EffectBus.on<{ label?: string; kind?: string }>('tile:open', (p) => {
      if (p?.kind === QUESTION_KIND && p.label) this.service.open(p.label)
    })
    window.ioc.whenReady<StartQueenBee>('@diamondcoreprocessor.com/StartQueenBee', (start) => {
      start.registerSuffix(GAME_SUFFIX, GAME_NAME, (hive) => this.service.startGame(hive), (result, game) => {
        const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
        const host = this.service.door().hostLabel
        const params = { game, where: result.where || '/', host }
        if (result.outcome === 'joined') return i18n?.t('questions.joined', params) ?? `you joined ${game} — you follow ${host} through the hive`
        return result.outcome === 'started'
          ? (i18n?.t('questions.started', params) ?? `${game} started at /${params.where} — walk the room through the hive; "questions" opens this layer's questions`)
          : (i18n?.t('questions.resumed', params) ?? `${game} is on at /${params.where} — you lead it again`)
      }, () => this.service.offered().map(g => g.name))
    })
  }
}

const _questions = new QuestionsDrone()
window.ioc.register('@diamondcoreprocessor.com/QuestionsDrone', _questions)
window.ioc.register(QUESTIONS_KEY, _questions.service)

// THE DOOR, contributed the doctrine way: a framework-free custom element
// added to the shell's surfaces over IoC — never a tag in either app.html.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(QUESTIONS_DOOR_SURFACE)) customElements.define(QUESTIONS_DOOR_SURFACE, QuestionsDoorElement)
  try {
    registry.add({ name: QUESTIONS_DOOR_SURFACE, owner: QUESTIONS_KEY, element: QUESTIONS_DOOR_SURFACE, order: 705 })
  } catch { /* duplicate add (hot reload) — the mounted surface is already live */ }
})
