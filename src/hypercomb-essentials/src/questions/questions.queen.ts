// questions/questions.queen.ts
//
// `questions` — the room looks at this layer's questions.
//
//   questions          walk into this layer's Q and A (the host's followers
//                      come along — follow the leader while teaching)
//   questions back     back out to the layer it belongs to
//   questions leave    leave the game: stop following its host
//
// The door's Questions, Back and Leave buttons are this word.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { QUESTIONS_KEY } from './questions.js'
import type { Questions } from './questions.service.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class QuestionsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'questions'
  override description = "This layer's questions — `questions` walks the room into them, `questions back` returns, `questions leave` leaves the game"
  override descriptionKey = 'slash.questions'
  override options = ['back', 'leave']
  override examples = [
    { input: '/questions', result: "Walks into this layer's Q and A; whoever follows you comes along" },
    { input: '/questions back', result: 'Back out to the layer the questions belong to' },
    { input: '/questions leave', result: 'Leave the game — stop following its host' },
  ]
  override machine: MachineGrammar = {
    forms: '| back | leave',
    example: 'questions',
    bare: true,
    reach: 'additive',
    scope: 'local',
  }

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['back', 'leave'].filter(o => o.startsWith(typed) && o !== typed)
  }

  protected async execute(args: string): Promise<void> {
    const questions = get<Questions>(QUESTIONS_KEY)
    if (!questions) return
    const verb = args.trim().toLowerCase()
    if (verb === 'back') {
      if (!questions.back()) this.#say(this.#t('questions.word.not-inside', "you are not inside a layer's questions"))
      return
    }
    if (verb === 'leave') {
      const game = questions.game()?.name ?? ''
      await questions.leaveGame()
      this.#say(game ? this.#t('questions.left', `you left ${game}`, { game }) : this.#t('questions.word.no-game', 'you are in no game — `start <hive> q and a` begins or joins one'))
      return
    }
    const outcome = await questions.openQuestions()
    if (outcome === 'no-game') this.#say(this.#t('questions.word.no-game', 'you are in no game — `start <hive> q and a` begins or joins one'))
    else if (outcome === 'inside') this.#say(this.#t('questions.word.inside', "you are already looking at this layer's questions — `questions back` returns"))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    return get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _questions = new QuestionsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/QuestionsQueenBee', _questions)
