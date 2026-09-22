// /game — the game as a place.
//
// A cell carrying `visual:game:play` IS that game. Opening it mounts the
// game the record names, full-screen, straight from the tile — no launcher,
// no header icon, no slash command. Mark the cell's `view:default` with it
// and walking in IS playing, which is what makes a published game a site
// somebody can simply visit.
//
//     /game here arkanoid     — this cell is Arkanoid
//     /game remove            — it is an ordinary cell again
//
// ATTACHABLE, unlike the lounge: a game needs no built bundle to point at,
// only the id of a bee that is already loaded, so `name@game` can make a
// cell a game out of thin air. The census is the vocabulary — `/game here`
// with no id lists what this build actually carries, so the command can
// never invite a typo into a record.

import { QueenBee, EffectBus } from '@hypercomb/core'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from '../commands/decoration-manifest.js'
import { gameCensus } from './game-enablement.js'
import { GAME_PLAY_KIND, GAME_VIEW, gameDescriptor, type GamePlayPayload } from './game-play.js'

const HEXAGONS = 'hexagons'

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class GameQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'game'
  override description = 'The game — an arcade game this tile carries as its own presence'
  override options = ['here <gameId>', 'remove', 'on', 'off']
  override examples = [
    { input: '/game', result: 'Opens or closes the game on this tile' },
    { input: '/game here arkanoid', result: 'Makes this cell Arkanoid — walking in plays it' },
    { input: '/game remove', result: 'Takes the game off this cell' },
  ]

  /** The vocabulary is the census: only games this build actually carries. */
  override slashComplete(args: string): readonly string[] {
    const rest = args.trim().toLowerCase()
    const verbs = ['here', 'remove', 'on', 'off']
    const [verb = '', ...tail] = rest.split(/\s+/)
    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      const q = (tail[0] ?? '')
      return gameCensus().map(g => `here ${g.id}`).filter(o => o.startsWith(`here ${q}`.trimEnd()))
    }
    return verbs.filter(o => o.startsWith(verb))
  }

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb = ''] = trimmed.toLowerCase().split(/\s+/, 1)

    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#attach(trimmed.slice(verb.length).trim())
      return
    }
    if (verb === 'remove' || verb === 'detach') {
      await this.#remove()
      return
    }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (verb === 'off' || verb === 'close') { vm.setMode(HEXAGONS); return }
    vm.setMode(verb === 'on' || verb === 'open'
      ? GAME_VIEW
      : vm.mode === GAME_VIEW ? HEXAGONS : GAME_VIEW)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  /** `/game here <gameId>` — one live record per cell; re-marking replaces
   *  rather than piling, so pointing a cell at a different game is the same
   *  gesture as making it a game in the first place. */
  async #attach(rest: string): Promise<void> {
    const gameId = rest.split(/\s+/, 1)[0]?.trim().toLowerCase() ?? ''
    const known = gameDescriptor(gameId)
    if (!known) {
      // Name what IS here rather than only what is not: a record naming a
      // game this build has never loaded would open onto nothing.
      const census = gameCensus().map(g => g.id).join(', ')
      EffectBus.emit('activity:log', {
        message: gameId
          ? `No game called "${gameId}"${census ? ` — this hive carries ${census}` : ''}`
          : `A cell becomes a game by name${census ? ` — try ${census}` : ''}`,
        icon: 'sports_esports',
      })
      return
    }
    const segments = this.#segments()
    const payload: GamePlayPayload = { version: 1, gameId: known.id }
    await replaceDecoration({
      kind: GAME_PLAY_KIND,
      appliesTo: segments,
      segments,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', {
      message: `This cell is ${known.label} now`,
      icon: known.icon || 'sports_esports',
    })
  }

  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: GAME_PLAY_KIND, segments })
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'The game is off this cell', icon: 'sports_esports' })
  }
}
