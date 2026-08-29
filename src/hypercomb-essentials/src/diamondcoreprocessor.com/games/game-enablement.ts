// diamondcoreprocessor.com/games/game-enablement.ts
//
// THE GAME↔ROSTER CONTRACT — how an arcade game takes its place in the
// Beehaviors roster, in one file.
//
// Every other behaviour reaches the roster by way of a DECORATION KIND: it
// is a mark a tile carries, so the roster has something to be about. A game
// carries nothing. It is a `genotype:'game'` bee that mounts a full-screen
// overlay ABOVE the hive and touches no layer, no hex, no Pixi — which is
// exactly why it fell out of the one switch for so long: the roster asked
// "what marks a tile" and a game had no answer.
//
// So a game's roster identity is minted here instead, from the one thing it
// already declares about itself: `game:<gameId>`. It is not a `visual:*`
// kind and must never become one — nothing writes it onto a tile, nothing
// reads it off one. It exists to be SWITCHED, and the switch is the whole
// of it. That is why games appear in the POOL lens only: the per-tile list
// answers "what does this layer carry", and a game is never an answer to
// that question.
//
// The census is not a roster either — the pool of games IS `window.ioc`
// filtered by genotype, exactly as the shell's launch group reads it
// (`hypercomb-shared/core/games-group.ts`). A community game module that
// registers at runtime appears in the Beehaviors list for free, with its own
// label, icon and description, and no edit here.
//
// ── The three surfaces a dormant game must vanish from ───────────────
//
//   • the header icon      — the drone emits `available:false`
//   • the launch group     — `gameDormant` on the bee, read by games-group
//   • `/<gameId>`          — the queen refuses, and SAYS SO
//
// The last one is deliberate and is the one exception to "off is silent".
// A dormant decoration simply isn't offered anywhere — there is no gesture
// to answer. A typed command IS a gesture: swallowing it reads as a broken
// game (see the post-it lesson in [[project_behavior_enablement_roster]] —
// a dark takeover looked like a regression for weeks). So the command
// answers, once, naming where the light lives.

import { EffectBus } from '@hypercomb/core'
import { isKindGloballyOff, isPublishedVisitorShell, ENABLEMENT_CHANGED } from '../sharing/behavior-enablement.js'

/** A game's kind is its id under this prefix. Two segments, no module
 *  segment: a game belongs to no tile and to no render pipeline, so the
 *  `visual:<module>:<noun>` shape would be a lie about what it is. */
export const GAME_KIND_PREFIX = 'game:'

/** The seed cohort games are lit under on a hive that already had them
 *  working before the roster learned the word. See `seedCohortOn`. */
export const GAME_COHORT = 'games'

/** `solomon` → `game:solomon`. Empty in, empty out — a bee with no launch
 *  descriptor is not a game the roster can switch. */
export function gameKind(gameId: string): string {
  const id = String(gameId ?? '').trim()
  return id ? GAME_KIND_PREFIX + id : ''
}

/** THE dormancy answer for a game. Global only — a game has no location, so
 *  none of the per-tile dormancy sources (wake, publisher-withheld, binding)
 *  can apply to it. One light, hive-wide, exactly as the pool row shows.
 *
 *  On a published visitor shell the roster is a cold install seeded DARK —
 *  the raw read answers "off" for every kind and `open()` refuses silently
 *  (the visitor-shell-dormancy trap). There is no roster to consult there:
 *  the publisher shipping the game IS the enablement. */
export function isGameDormant(gameId: string): boolean {
  const kind = gameKind(gameId)
  if (!kind) return false
  if (isPublishedVisitorShell()) return false
  return isKindGloballyOff(kind)
}

/** Subscribe to roster flips. A game must react the moment its light goes
 *  out — re-announce itself as unavailable so the header icon leaves, and
 *  CLOSE if it happens to be open. Switching a behaviour off while looking
 *  at it and having it stay on screen is the contradiction the one-switch
 *  rule exists to prevent. Returns the unsubscribe. */
export function onEnablementChanged(handler: () => void): () => void {
  return EffectBus.on(ENABLEMENT_CHANGED, handler)
}

/** What a game tells the roster about itself — the same self-description
 *  the launch group reads, plus the sentence the drone already carries. */
export interface GameDescriptor {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly icon: string
  readonly description: string
}

/** The launch surface a `genotype:'game'` bee exposes. Structural, not
 *  imported: a community game satisfies it without importing anything. */
type GameLike = {
  genotype?: unknown
  gameId?: unknown
  gameLabel?: unknown
  gameIcon?: unknown
  description?: unknown
}

type IocLike = { list(): readonly string[]; get(key: string): unknown }

const ioc = (): IocLike | undefined =>
  (window as unknown as { ioc?: IocLike }).ioc

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Every game the app knows, right now — `window.ioc` filtered by genotype.
 *  Deduped by id (a game registered under two keys is one game) and sorted
 *  by label so the roster reads the same on every boot. */
export function gameCensus(): GameDescriptor[] {
  const c = ioc()
  if (!c) return []
  const seen = new Set<string>()
  const out: GameDescriptor[] = []
  for (const key of c.list()) {
    let bee: GameLike | undefined
    try { bee = c.get(key) as GameLike | undefined } catch { continue }
    if (!bee || bee.genotype !== 'game') continue
    const id = str(bee.gameId)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      kind: gameKind(id),
      label: str(bee.gameLabel) || id,
      icon: str(bee.gameIcon) || 'sports_esports',
      description: str(bee.description),
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/** Just the kinds — what the census seed needs. */
export function gameKinds(): string[] {
  return gameCensus().map(g => g.kind)
}
