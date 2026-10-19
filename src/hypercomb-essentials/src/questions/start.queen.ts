// questions/start.queen.ts
//
// `start <game name>` — a game begins by being named.
//
// "please start hypercomb q and a": in the common tongue `start` is the word
// that lights, and what follows is the game's name. The census is whatever
// games this build offers to start in place (a game registers itself under
// its full name — never a shortened one); with no name, or a name nothing
// answers to, the word says which games it carries instead of guessing.
//
// Not `game`: that word makes a CELL an arcade game. This one starts a game
// played on the hive itself, here, now.

import { QueenBee, EffectBus, I18N_IOC_KEY, moleculeKey, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import type { StartOutcome } from './questions.service.js'

type Startable = { readonly name: string; readonly start: () => Promise<StartOutcome> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class StartQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'start'
  override description = 'Start a game here by its name — `start hypercomb q and a`'
  override descriptionKey = 'slash.start'
  override examples = [
    { input: '/start hypercomb q and a', result: 'Starts Hypercomb Q and A on this page: the game tile appears, you walk in, and questions settle into categories as they arrive' },
    { input: '/start', result: 'Says which games this hive can start' },
  ]
  // The name is the argument, whole — `q and a` is not three words to read.
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: '<game name>',
    example: 'start hypercomb q and a',
    reach: 'additive',
    scope: 'network',
  }

  readonly #games = new Map<string, Startable>()

  /** A game offers itself under its full name. */
  register(name: string, start: () => Promise<StartOutcome>): void {
    const clean = String(name ?? '').trim()
    if (clean) this.#games.set(moleculeKey(clean), { name: clean, start })
  }

  names(): string[] { return [...this.#games.values()].map(g => g.name) }

  override slashComplete(args: string): readonly string[] {
    const q = moleculeKey(args)
    return this.names().filter(n => moleculeKey(n).startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const name = String(args ?? '').trim()
    const games = this.names().join(', ')
    const game = this.#games.get(moleculeKey(name))
    if (!game) {
      this.#say(name
        ? this.#t('questions.start.none', `No game is called "${name}" — this hive carries: ${games}`, { name, games })
        : this.#t('questions.start.which', `Which game? This hive carries: ${games}`, { games }))
      return
    }
    const result = await game.start()
    const where = result.where || '/'
    this.#say(result.outcome === 'started'
      ? this.#t('questions.started', `${game.name} started at /${where} — ask with "question <your question>"; questions settle into categories as they arrive`, { game: game.name, where })
      : this.#t('questions.resumed', `${game.name} is on at /${where} — questions keep settling as they arrive`, { game: game.name, where }))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    return get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _start = new StartQueenBee()
window.ioc.register('@diamondcoreprocessor.com/StartQueenBee', _start)
