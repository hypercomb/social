// didyouknow/collect.queen.ts
//
// `collect` — keep the room's ideas. Every idea on the game's tile that you do
// not hold yet is taken onto your own tile: the swarm's take, the same
// signature (shared, never copied). They stay on your tile after the meeting,
// a list to go back to and learn from.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { DYK_KEY } from './didyouknow.js'
import type { DidYouKnow } from './didyouknow.service.js'
import { unavailableSentence } from './unavailable.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class CollectQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'collect'
  override description = 'Collect the room\'s Did You Know ideas onto your own tile — a list to go back to and learn from'
  override descriptionKey = 'slash.collect'
  override examples = [
    { input: '/collect', result: 'Takes every idea you do not hold yet onto your own game tile for this layer' },
  ]
  override machine: MachineGrammar = {
    forms: '',
    example: 'collect',
    bare: true,
    reach: 'additive',
    scope: 'network',
  }

  protected async execute(): Promise<void> {
    const game = get<DidYouKnow>(DYK_KEY)
    if (!game) return
    const result = await game.collect()
    if (result === 'off' || result === 'switched-off') { this.#say(unavailableSentence(result)); return }
    if (result === 'none') { this.#say(this.#t('didyouknow.collect.none', 'no Did You Know here to collect from — stand on the page where the room is playing')); return }
    if (result.taken === 0 && result.waiting === 0) { this.#say(this.#t('didyouknow.collect.nothing', 'nothing new to collect — you hold every idea shown')); return }
    const params = { taken: result.taken, waiting: result.waiting }
    this.#say(result.waiting > 0
      ? this.#t('didyouknow.collect.partial', `collected ${result.taken} ideas — ${result.waiting} are still arriving, say collect again in a moment`, params)
      : this.#t('didyouknow.collected', `collected ${result.taken} ideas onto this page's did-you-know tile`, params))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    return get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _collect = new CollectQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CollectQueenBee', _collect)
