// didyouknow/reveal.queen.ts
//
// `reveal` — the host says who brought what. One note is written on the game's
// tile listing every idea with its name; the room's desks, finding it, show
// names again. A layer's game is revealed once: a reader can wave the note off
// for themselves (its ✕, for the session, or hiding the room), which puts the
// names back for them alone; only its author can take it away for everyone.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { DYK_KEY } from './didyouknow.js'
import type { DidYouKnow } from './didyouknow.service.js'
import { unavailableSentence } from './unavailable.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class RevealQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'reveal'
  override description = 'Reveal who brought each idea in Did You Know — one note on the tile lists every idea with its name'
  override descriptionKey = 'slash.reveal'
  override examples = [
    { input: '/reveal', result: 'Writes a note on the game\'s tile naming who brought each idea; everyone\'s desk shows the names' },
  ]
  override machine: MachineGrammar = {
    forms: '',
    example: 'reveal',
    bare: true,
    reach: 'additive',
    scope: 'network',
  }

  protected async execute(): Promise<void> {
    const game = get<DidYouKnow>(DYK_KEY)
    if (!game) return
    const result = await game.reveal()
    if (result === 'off' || result === 'switched-off') this.#say(unavailableSentence(result))
    else if (result === 'none') this.#say(this.#t('didyouknow.reveal.none', 'nothing to reveal here — no ideas have been shared on this page yet'))
    else if (result === 'already') this.#say(this.#t('didyouknow.reveal.already', 'already revealed — the names are in the note on the tile'))
    else this.#say(this.#t('didyouknow.revealed', `revealed ${result.ideas} ideas from ${result.people} people — the names are on the tile for everyone`, { ideas: result.ideas, people: result.people }))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    return get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _reveal = new RevealQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RevealQueenBee', _reveal)
