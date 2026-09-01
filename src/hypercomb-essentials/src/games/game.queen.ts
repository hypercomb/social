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
import type { VisualBeeRegistry } from '../commands/visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from '../commands/decoration-manifest.js'
import {
  ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn,
} from '../sharing/behavior-enablement.js'
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
  override readonly aliases = ['play']
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

/** THE GAME FACE MUST NOT ARRIVE DARK.
 *
 *  A kind nobody has ever seen is globally off until the participant lights
 *  it in the roster — right for a new behaviour, wrong here for the same
 *  reason it was wrong for the lounge: the tile now OPENS AS the game, so a
 *  dark behaviour means walking in lands on bare hexagons and the game looks
 *  broken. Note this is the FACE's light, not the game's: `game:<id>` stays
 *  the switch for the game itself, and a participant who turned Arkanoid off
 *  keeps it off — `isPlayable` asks that switch too.
 *
 *  Lit as a COHORT: once, on a hive that already has an on-list, and refused
 *  outright on a hive that opened dark (`'*'` in the ledger). */
const GAME_FACE_COHORT = 'game-face'

const lightGameFaceOnce = (): void => {
  // ONLY once the census seed has materialized the on-list. Calling before
  // that records the cohort without lighting anything, and the ledger never
  // forgets — the light would be lost for the life of the hive.
  if (!readGlobalOnKinds()) return
  seedCohortOn(GAME_FACE_COHORT, [GAME_PLAY_KIND])
}
lightGameFaceOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightGameFaceOnce)

const _game = new GameQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GameQueenBee', _game)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: GAME_VIEW,
    slashCommand: '/game',
    iconName: 'sports_esports',
    toggleIcon: 'sports_esports',
    behavior: 'render',
    decorationKind: GAME_PLAY_KIND,
    labelKey: 'view.game',
    descriptionKey: 'view.game.description',
    queenKey: '@diamondcoreprocessor.com/GameQueenBee',
    // The game travels: the record names the game by the id its bee
    // declares, and the bee itself rides the signed closure, so adopting
    // the tile carries the whole thing.
    adoptable: true,
    // A cell that IS a game can be marked as one out of thin air — the bee
    // is already loaded, so there is nothing to build first.
    attachable: true,
    // The tile's game icon plays it from where you stand; walking into the
    // tile is the fuller gesture, and the cell's `view:default` mark makes
    // that walk the way in.
    opensOnTileClick: true,
    // DELIBERATELY NOT `replacesTileRender`. The game is the cell's face
    // once you are AT it — but on the parent's grid the cell must stay a
    // hexagon you can see and press, because that hexagon is the door.
    //
    // NODE-LOCAL, not a branch scope: a game is one place, not an
    // application its children live inside.
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
