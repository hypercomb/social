// questions/question.queen.ts
//
// `question <text>` — ask here. The question becomes a tile named with its
// words and marked as a question, through the same create commit the
// `create` word runs. In a swarm a tile made here is shared, so the room
// sees it the moment it exists; clicking it opens its answers.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { QUESTIONS_KEY } from './questions.js'
import type { Questions } from './questions.service.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class QuestionQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'question'
  override description = 'Ask a question here — it becomes a tile the room can answer; `question <your question>`'
  override descriptionKey = 'slash.question'
  override examples = [
    { input: '/question what is a pool of meaning?', result: 'A tile named with the question appears here, marked as a question; clicking it opens the answers' },
  ]
  // The question is the argument, whole — its words are never read as other words.
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: '<the question>',
    example: 'question what is a pool of meaning?',
    reach: 'additive',
    scope: 'network',
  }

  protected async execute(args: string): Promise<void> {
    const text = String(args ?? '').replace(/\s+/g, ' ').trim()
    if (!text) { this.#say(this.#t('questions.ask.usage', 'Question: say the question — "question what is a pool of meaning?"')); return }
    const questions = get<Questions>(QUESTIONS_KEY)
    if (!questions) return
    const outcome = await questions.ask(text)
    if (outcome === 'asked') this.#say(this.#t('questions.asked', `asked "${text}" — the room can answer it now`, { question: text }))
    else if (outcome === 'exists') this.#say(this.#t('questions.ask.exists', `"${text}" is already asked here`, { question: text }))
    else if (outcome === 'failed') this.#say(this.#t('questions.ask.failed', `"${text}" could not be made a tile here`, { question: text }))
    else if (outcome === 'reserved') this.#say(this.#t('questions.ask.reserved', `"${text}" names a word the hive keeps for itself — ask it another way`, { question: text }))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    return get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _question = new QuestionQueenBee()
window.ioc.register('@diamondcoreprocessor.com/QuestionQueenBee', _question)
