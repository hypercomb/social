// didyouknow/did-you-know.queen.ts
//
// `did-you-know <idea>` — share something you think the others might not know.
// The idea becomes a note on the game's tile, shared with the room without
// your name on it: the notes desk shows the words, and who brought them stays
// hidden until the host reveals.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { DYK_KEY, IDEA_MAX, cleanIdea } from './didyouknow.js'
import type { DidYouKnow } from './didyouknow.service.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class DidYouKnowQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'did-you-know'
  override description = 'Share something the others might not know — with no name on it until the host reveals who'
  override descriptionKey = 'slash.did-you-know'
  override examples = [
    { input: '/did-you-know octopuses have three hearts', result: 'Your idea is shared with the room as a plain note on the game\'s tile; the desk opens so you can read the others' },
  ]
  // The idea is the argument, whole — its words are never read as other words.
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: '<something the others might not know>',
    example: 'did-you-know octopuses have three hearts',
    reach: 'additive',
    scope: 'network',
  }

  protected async execute(args: string): Promise<void> {
    const idea = cleanIdea(args)
    if (!idea) { this.#say(this.#t('didyouknow.share.usage', 'Did you know: say what the others might not know — "did-you-know octopuses have three hearts"')); return }
    const game = get<DidYouKnow>(DYK_KEY)
    if (!game) return
    const outcome = await game.share(idea)
    if (outcome === 'shared') this.#say(this.#t('didyouknow.shared', 'shared — the room reads it with no name on it until the host reveals who'))
    else if (outcome === 'exists') this.#say(this.#t('didyouknow.share.exists', 'you already shared that'))
    else if (outcome === 'long') this.#say(this.#t('didyouknow.share.long', `too long — keep an idea under ${IDEA_MAX} characters (this one is ${idea.length})`, { max: IDEA_MAX, length: idea.length }))
    else if (outcome === 'failed') this.#say(this.#t('didyouknow.share.failed', 'could not share that here'))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    return get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _didYouKnow = new DidYouKnowQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DidYouKnowQueenBee', _didYouKnow)
