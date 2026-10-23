// didyouknow/didyouknow.drone.ts
//
// The bee that plays Did You Know: it holds the DidYouKnow service
// (didyouknow.service.ts — a dependency, which exports and never registers),
// registers it, offers the game to the `start` word under its name, and
// teaches the swarm notes desk the one rule the game needs — on the game's
// tile, show the words and not who brought them, until the reveal.
// Registration is the bee's act.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DYK_KEY, GAME_NAME, concealsAuthors } from './didyouknow.js'
import { DidYouKnow, type StartOutcome } from './didyouknow.service.js'

type StartShape = {
  register(name: string, start: () => Promise<StartOutcome>, say?: (outcome: StartOutcome, game: string) => string): void
}
type SwarmNotesShape = {
  concealAuthorsWhen(rule: (cell: string, texts: readonly string[]) => boolean): void
}

export class DidYouKnowDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Did You Know — a meeting exercise: share what you think the others do not know, with no names until the host reveals them, then collect the ideas worth keeping'

  protected override listens = ['swarm:peers-changed', 'render:cell-count', 'notes:changed']
  protected override emits = ['notes:panel', 'note:capture', 'cell:added']

  readonly service = new DidYouKnow()

  constructor() {
    super()
    window.ioc.whenReady<StartShape>('@diamondcoreprocessor.com/StartQueenBee', (start) => {
      start.register(GAME_NAME, () => this.service.start(), (result, game) => {
        const t = (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<I18nProvider>(I18N_IOC_KEY)
        const params = { game, where: result.where }
        return result.outcome === 'started'
          ? (t?.t('didyouknow.started', params) ?? `${game} started at /${result.where} — share with "did-you-know <something the others might not know>"; names stay hidden until you say "reveal"`)
          : (t?.t('didyouknow.resumed', params) ?? `${game} is on at /${result.where} — share with "did-you-know <idea>", collect with "collect", reveal with "reveal"`)
      })
    })
    window.ioc.whenReady<SwarmNotesShape>('@diamondcoreprocessor.com/SwarmNotes', (swarmNotes) => {
      swarmNotes.concealAuthorsWhen(concealsAuthors)
    })
  }
}

const _didYouKnow = new DidYouKnowDrone()
window.ioc.register('@diamondcoreprocessor.com/DidYouKnowDrone', _didYouKnow)
window.ioc.register(DYK_KEY, _didYouKnow.service)
