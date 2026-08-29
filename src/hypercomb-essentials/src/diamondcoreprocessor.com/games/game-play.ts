// diamondcoreprocessor.com/games/game-play.ts
//
// THE GAME AT ITS TILE — one record, one meaning: "this cell IS this game."
//
// A game has always been a `genotype:'game'` bee that mounts a full-screen
// overlay from a header icon, a launcher tile or a slash command. Every one
// of those doors is a GESTURE somebody makes while already inside the hive.
// None of them is a PLACE, which is why a published game had nowhere to
// arrive: walking into the tile (or opening the deployed domain, which is the
// same walk from outside) landed on whatever face the layer declared, and no
// face could ever be the game itself.
//
// This is the missing half — the lounge's lesson applied to the arcade
// (`revolucionstyle.com/lounge/lounge-room.ts`). The cell carries a record
// naming a game, the `game` view frame opens it, and marking the cell's
// `view:default` with that view makes walking in BE playing.
//
//     { version: 1, gameId: 'arkanoid' }
//
// DOMAIN-GENERIC ON PURPOSE. Nothing here names a particular game: the
// record names its own `gameId` and the census resolves it, so a second game
// is a second record on a second tile — including a community game module
// that registered itself at runtime and that this file has never heard of.
//
// WHY A SIGNATURE-FREE PAYLOAD, when everything else here composes by sig:
// the game is CODE, and code already travels as a signed bee in the closure.
// `gameId` is that bee's own declared identity (`game-enablement.ts` mints
// `game:<gameId>` from it for the roster), so the record points at the bee
// the same way the roster's switch does. A content sig would name a build,
// not the game — and would break on the game's next line of code.

import { listDecorations } from '../commands/decoration-manifest.js'
import { gameCensus, isGameDormant, type GameDescriptor } from './game-enablement.js'

/** The ViewMode token a game-carrying cell opens as. */
export const GAME_VIEW = 'game'

/** The decoration kind that makes a cell a game. `visual:` because it IS a
 *  render surface a tile carries — the opposite of `game:<id>`, which is the
 *  roster's switch and is never written onto a tile
 *  (see the header of `game-enablement.ts`). */
export const GAME_PLAY_KIND = 'visual:game:play'

/** Payload of a `visual:game:play` record. */
export interface GamePlayPayload {
  readonly version: 1
  /** The bee's own `gameId` — `arkanoid`, `roper`, `solomon`, … */
  readonly gameId: string
  /** Tooltip / toggle label for this particular cell. Absent = the game's
   *  own label from the census. */
  readonly label?: string
  /** This cell's own glyph on the toggle strip. Absent = the game's icon. */
  readonly icon?: string
}

/** The launch surface a `genotype:'game'` bee exposes. Structural, never
 *  imported: a community game satisfies it without importing anything, which
 *  is the whole reason the census can find one. */
export interface PlayableGame {
  readonly gameId?: unknown
  readonly gameDormant?: unknown
  open?: () => void
  close?: () => void
  isActive?: () => boolean
}

/** Whether a payload actually names a game. A record with no `gameId` is not
 *  a game — a frame that honoured it would cover the screen with nothing and
 *  trap the participant behind it. */
export function isGamePlayRecord(payload: unknown): payload is GamePlayPayload {
  const id = (payload as { gameId?: unknown } | null)?.gameId
  return typeof id === 'string' && id.trim().length > 0
}

/** The game record on this cell, or null when the cell is not a game. */
export async function gamePlayAt(segments: readonly string[]): Promise<GamePlayPayload | null> {
  try {
    const records = await listDecorations<GamePlayPayload>({
      kind: GAME_PLAY_KIND,
      segments: [...segments],
    })
    for (const found of records) {
      const payload = found.record?.payload
      if (isGamePlayRecord(payload)) return payload
    }
  } catch { /* cold read — the caller treats a miss as "not a game" */ }
  return null
}

/** The census entry for a game id, or undefined when no such bee is loaded.
 *  A record naming a game this build does not carry is not an error: the
 *  frame simply falls through to the hexagons, exactly as it does for a
 *  record naming a game whose light is out. */
export function gameDescriptor(gameId: string): GameDescriptor | undefined {
  const id = String(gameId ?? '').trim()
  return id ? gameCensus().find(g => g.id === id) : undefined
}

/** The live bee for a game id — the thing with `open()` on it. Resolved from
 *  IoC by the bee's OWN declared `gameId`, never by an IoC key convention:
 *  the key belongs to whoever registered it, the id belongs to the game. */
export function playableGame(gameId: string): PlayableGame | undefined {
  const id = String(gameId ?? '').trim()
  if (!id) return undefined
  const ioc = (window as unknown as {
    ioc?: { list(): readonly string[]; get(key: string): unknown }
  }).ioc
  if (!ioc) return undefined
  for (const key of ioc.list()) {
    let bee: (PlayableGame & { genotype?: unknown }) | undefined
    try { bee = ioc.get(key) as (PlayableGame & { genotype?: unknown }) | undefined } catch { continue }
    if (!bee || bee.genotype !== 'game') continue
    if (String(bee.gameId ?? '').trim() === id) return bee
  }
  return undefined
}

/** Can this record actually be played right now? Both halves must hold: a
 *  bee that carries the game, and a roster light that is on. Dormancy is
 *  asked of the SAME switch every other surface asks — a game switched off
 *  must not come back as somebody's arrival face. */
export function isPlayable(payload: GamePlayPayload | null): boolean {
  if (!payload || !isGamePlayRecord(payload)) return false
  return !!playableGame(payload.gameId) && !isGameDormant(payload.gameId)
}
