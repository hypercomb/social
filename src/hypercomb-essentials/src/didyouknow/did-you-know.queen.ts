// didyouknow/did-you-know.queen.ts
//
// `did-you-know` — the game's one word.
//
//   did-you-know <idea>      share something you think the others might not
//                            know; it reaches the room with no name on it
//                            until the host reveals who
//   did-you-know             flip the game on or off for this layer and
//                            everything beneath it
//   did-you-know on | off    switch it on or off for this layer and beneath
//   did-you-know everywhere  switch it on for the whole hive (the root layer)
//
// The game is a TOGGLE a layer declares (scope.ts): on everywhere, or on one
// branch. The ideas themselves belong to the layer they were shared on.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { DYK_KEY, IDEA_MAX, cleanIdea, parseToggle, routeOf } from './didyouknow.js'
import type { DidYouKnow, ToggleOutcome } from './didyouknow.service.js'
import { unavailableSentence } from './unavailable.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class DidYouKnowQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'did-you-know'
  override description = 'Share something the others might not know, with no name on it until the host reveals who. The game is a toggle: on this layer and beneath, or on everywhere'
  override descriptionKey = 'slash.did-you-know'
  override options = ['on', 'off', 'everywhere']
  override examples = [
    { input: '/did-you-know octopuses have three hearts', result: 'Your idea is shared with the room as a plain note on this layer\'s game tile; the desk opens so you can read the others' },
    { input: '/did-you-know on', result: 'Switches the game on for this layer and everything beneath it' },
    { input: '/did-you-know everywhere', result: 'Switches the game on for the whole hive' },
    { input: '/did-you-know off', result: 'Switches the game off for this layer; ideas already shared stay where they are' },
  ]
  // The idea is the argument, whole — its words are never read as other words.
  override rawArgs = true
  // `off` takes a mark off a layer (undoable), so the word reaches the editing tier.
  override machine: MachineGrammar = {
    forms: '<something the others might not know> | on | off | everywhere',
    example: 'did-you-know octopuses have three hearts',
    reach: 'editing',
    scope: 'network',
  }

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return q ? ['on', 'off', 'everywhere'].filter(o => o.startsWith(q)) : ['on', 'off', 'everywhere']
  }

  protected async execute(args: string): Promise<void> {
    const game = get<DidYouKnow>(DYK_KEY)
    if (!game) return
    const toggle = parseToggle(args)
    if (toggle) { this.#say(this.#toggled(await game.toggle(toggle))); return }

    const idea = cleanIdea(args)
    const outcome = await game.share(idea)
    if (outcome === 'shared') this.#say(this.#t('didyouknow.shared', 'shared — the room reads it with no name on it until the host reveals who'))
    else if (outcome === 'exists') this.#say(this.#t('didyouknow.share.exists', 'you already shared that'))
    else if (outcome === 'long') this.#say(this.#t('didyouknow.share.long', `too long — keep an idea under ${IDEA_MAX} characters (this one is ${idea.length})`, { max: IDEA_MAX, length: idea.length }))
    else if (outcome === 'failed') this.#say(this.#t('didyouknow.share.failed', 'could not share that here'))
    else if (outcome === 'off' || outcome === 'switched-off') this.#say(unavailableSentence(outcome))
  }

  #toggled(outcome: ToggleOutcome): string {
    switch (outcome.state) {
      case 'switched-off':
        return unavailableSentence('switched-off')
      case 'on':
        return outcome.at.length === 0
          ? this.#t('didyouknow.on.everywhere', 'Did You Know is on everywhere')
          : this.#t('didyouknow.on', `Did You Know is on for ${routeOf(outcome.at)} and everything beneath it`, { route: routeOf(outcome.at) })
      case 'covered':
        return outcome.at.length === 0
          ? this.#t('didyouknow.on.everywhere', 'Did You Know is on everywhere')
          : this.#t('didyouknow.on.covered', `Did You Know is already on from ${routeOf(outcome.at)} — it reaches here`, { route: routeOf(outcome.at) })
      case 'off':
        return this.#t('didyouknow.off', `Did You Know is off at ${routeOf(outcome.at)} — ideas already shared stay where they are`, { route: routeOf(outcome.at) })
      case 'inherited':
        return this.#t('didyouknow.off.inherited', `Did You Know is on from ${routeOf(outcome.at)}, not here — say "did-you-know off" there to switch it off`, { route: routeOf(outcome.at) })
      default:
        return this.#t('didyouknow.off.none', 'Did You Know was not switched on here')
    }
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
