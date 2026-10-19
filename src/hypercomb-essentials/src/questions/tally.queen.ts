// questions/tally.queen.ts
//
// `tally` — the host counts. On the page you stand on, every question gets a
// note ranking its answers by how many participants took each, and the
// page's own tile gets the scoreboard: who gave the most-taken answers.
// Notes, so the room reads the result where the questions are, and the
// host's copy stays with the room on its host.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { QUESTIONS_KEY } from './questions.js'
import type { Questions } from './questions.service.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class TallyQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tally'
  override description = 'Tally the answers on this page — the most-taken answer per question, and who gave the best ones'
  override descriptionKey = 'slash.tally'
  override examples = [
    { input: '/tally', result: 'Writes a tally note on each question here and a scoreboard on this page\'s tile' },
  ]
  override machine: MachineGrammar = {
    forms: '',
    example: 'tally',
    bare: true,
    reach: 'additive',
    scope: 'network',
  }

  protected async execute(): Promise<void> {
    const questions = get<Questions>(QUESTIONS_KEY)
    if (!questions) return
    const result = await questions.tally()
    if (!result) { this.#say(this.#t('questions.tally.none', 'no questions on this page to tally')); return }
    const params = { questions: result.questions, answers: result.answers, leader: result.leader, takes: result.takes }
    this.#say(result.takes > 0
      ? this.#t('questions.tally.done', `tallied ${result.questions} questions, ${result.answers} answers — ${result.leader} leads with ${result.takes} takes`, params)
      : this.#t('questions.tally.quiet', `tallied ${result.questions} questions — no answer has been taken yet`, params))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    return get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _tally = new TallyQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TallyQueenBee', _tally)
