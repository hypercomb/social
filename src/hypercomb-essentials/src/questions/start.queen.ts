// questions/start.queen.ts
//
// `start <game name>` — a game begins by being named.
//
// "please start hypercomb q and a": in the common tongue `start` is the word
// that lights, and what follows is the game's name. A game registers either
// a whole name, or the WORDS ITS NAME ENDS WITH and is handed the rest: Q and
// A is named for the hive being shared as the swarm, so `start hypercomb q
// and a` and `start lecture q and a` are both its name, and `hypercomb` /
// `lecture` is what it is given. A game is never registered under a shortened
// name. With no name, or a name nothing answers to, the word says which
// games it carries instead of guessing.
//
// The same sentence JOINS: said where someone else already leads the game,
// it follows them (the game decides — see questions.service.ts).
//
// Not `game`: that word makes a CELL an arcade game. This one starts a game
// played on the hive itself, here, now.

import { QueenBee, EffectBus, I18N_IOC_KEY, moleculeKey, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import type { StartOutcome } from './questions.service.js'

/** `say` is the sentence a game tells the participant once it has begun (it
 *  knows its own next word); a game that gives none gets a plain one. */
type Say = (outcome: StartOutcome, game: string) => string
type Startable = { readonly name: string; readonly start: (rest: string) => Promise<StartOutcome>; readonly say?: Say }
/** A game known by the words its name ends with: `<rest> <suffix>`. */
type Suffixed = Startable & { readonly suffix: string; readonly offered: () => readonly string[] }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

/** Whole names fold the way molecules do (moleculeKey: spaces become
 *  hyphens, so `hypercomb q and a` is `hypercomb-q-and-a`). */
const fold = (name: string): string => moleculeKey(String(name ?? '').replace(/[-_\s]+/g, ' ').trim())
/** A name as WORDS, for the words a name ends with: lower case, single
 *  spaces, hyphens and underscores read as spaces. */
const words = (name: string): string => String(name ?? '').toLowerCase().replace(/[-_\s]+/g, ' ').trim()

export class StartQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'start'
  override description = 'Start a game here by its name — `start hypercomb q and a`; said where someone already leads it, you join them'
  override descriptionKey = 'slash.start'
  override examples = [
    { input: '/start hypercomb q and a', result: 'Starts Hypercomb Q and A for the hive you share as the swarm — you lead, and every layer you walk has its questions. Said where someone else leads it, you join and follow them through the hive instead' },
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
  readonly #suffixed: Suffixed[] = []

  /** A game offers itself under its full name. */
  register(name: string, start: (rest: string) => Promise<StartOutcome>, say?: Say): void {
    const clean = String(name ?? '').trim()
    if (clean) this.#games.set(fold(clean), { name: clean, start, say })
  }

  /** A game offers itself by the words its name ends with; it is handed the
   *  words before them. `offered` names the games of this kind there are to
   *  start or join right now, for the completions. */
  registerSuffix(suffix: string, example: string, start: (rest: string) => Promise<StartOutcome>, say?: Say, offered: () => readonly string[] = () => []): void {
    const clean = words(suffix)
    if (!clean) return
    const i = this.#suffixed.findIndex(g => g.suffix === clean)
    const entry: Suffixed = { name: String(example ?? '').trim() || `<name> ${suffix}`, suffix: clean, start, say, offered }
    if (i >= 0) this.#suffixed[i] = entry
    else this.#suffixed.push(entry)
  }

  names(): string[] {
    return [...[...this.#games.values()].map(g => g.name), ...this.#suffixed.map(g => g.name)]
  }

  override slashComplete(args: string): readonly string[] {
    const q = fold(args)
    const offered = this.#suffixed.flatMap(g => [...g.offered()])
    return [...new Set([...offered, ...this.names()])].filter(n => fold(n).startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const name = String(args ?? '').trim()
    const games = this.names().join(', ')
    const found = this.#find(name)
    if (!found) {
      this.#say(name
        ? this.#t('questions.start.none', `No game is called "${name}" — this hive carries: ${games}`, { name, games })
        : this.#t('questions.start.which', `Which game? This hive carries: ${games}`, { games }))
      return
    }
    const { game, rest, called } = found
    const result = await game.start(rest)
    const where = result.where || '/'
    this.#say(game.say?.(result, called) ?? (result.outcome === 'started'
      ? `${called} started at /${where}`
      : `${called} is on at /${where}`))
  }

  #find(name: string): { game: Startable; rest: string; called: string } | null {
    const key = fold(name)
    if (!key) return null
    const whole = this.#games.get(key)
    if (whole) return { game: whole, rest: '', called: whole.name }
    const said = words(name)
    for (const g of this.#suffixed) {
      if (!said.endsWith(' ' + g.suffix)) continue
      const rest = said.slice(0, said.length - g.suffix.length).trim()
      if (rest) return { game: g, rest, called: `${rest} ${g.suffix}` }
    }
    return null
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
