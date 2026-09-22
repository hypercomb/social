// THE GAME, BY ITSELF — the `game` view.
//
// The frame that turns "a cell that carries a game" into "the place the game
// IS". It owns no canvas and draws no chrome: a game overlay already mounts
// itself full-screen above the hive and tears itself fully down on close
// (arkanoid/overlay.ts and siblings). So this frame is the thin, honest
// piece that was missing — it decides WHEN the overlay is up, from the
// cell's own `visual:game:play` record.
//
// That is the whole difference from what came before. A game used to be
// reachable only by a gesture from inside the hive (header icon, launcher
// tile, `/arkanoid`), so a published game had no arrival: the deployed
// domain opened the layer's face, and no face could be the game. Now the
// tile carries the game, this frame opens it, and `view:default = game` on
// that tile makes walking in — from the grid or from the domain — playing.
//
// NEVER TRAPS. A cell with no record, a record naming a game this build does
// not carry, or a game whose roster light is out, all drop straight back to
// the hexagons rather than holding a covered, empty surface. And when the
// participant closes the game with the overlay's own ×, the surface follows
// them out: a view whose content has torn itself down must not stay up.

import { Drone, EffectBus } from '@hypercomb/core'
import { isFeatureHidden } from '../sharing/feature-hidden.js'
import type { BackGesture } from '../navigation/back-gesture.service.js'
import type { VisualBeeRegistry } from '../commands/visual-bee-registry.js'
import { ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn } from '../sharing/behavior-enablement.js'
import { onEnablementChanged } from './game-enablement.js'
import { GameQueenBee } from './game.queen.js'
import {
  GAME_PLAY_KIND, GAME_VIEW, gamePlayAt, isPlayable, playableGame,
  type GamePlayPayload, type PlayableGame,
} from './game-play.js'

/** The surface a view falls back to. */
const HEXAGONS = 'hexagons'

/** How often to notice that the overlay closed itself. The games broadcast
 *  `<gameId>:state`, but that is a per-game contract this frame deliberately
 *  does not depend on — a community game satisfying only `isActive()` must
 *  work too, so the fallback is a slow poll. Slow on purpose: it exists to
 *  release a surface, never to drive anything. */
const ACTIVE_POLL_MS = 400

/** How long an arrival waits for its game's bee to register before it
 *  falls back to the hexagons. */
const GAME_ARRIVAL_WAIT_MS = 10_000

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type ModeRegistryShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class GameViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Game renderer — opens the game the cell\'s own record names, full-viewport as the tile\'s presence; closing the game returns to the hexagons.'

  #game: PlayableGame | null = null
  #targetSegments: string[] | null = null
  /** The cell the running game belongs to — navigating to the same cell must
   *  not tear a live game down and start it over. */
  #mountedKey = ''
  #bound = false
  #active = false
  /** Re-entrancy generation — a reconcile bails after any await once a newer
   *  one has started, so the latest always wins. */
  #gen = 0
  #backOff: (() => void) | null = null
  #poll: ReturnType<typeof setInterval> | null = null
  #enablementOff: (() => void) | null = null
  /** The one in-flight (or settled) warm of the games chunk. */
  #gamesLoading: Promise<void> | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== GAME_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(GAME_VIEW)
        void this.#reconcile()
      })
      // Follow the lineage like every renderer — walking somewhere else while
      // the game is up closes it, or opens the game that lives there.
      get<EventTarget>('@hypercomb.social/Lineage')?.addEventListener?.('change', this.#lineageChange)
      // A record arriving (adoption, undo, a build writing it) while we stand
      // on the cell should be able to open it.
      this.onEffect('decorations:changed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      // The roster switched this game off while it was somebody's arrival
      // face — leave, rather than hold a surface whose content just left.
      this.#enablementOff = onEnablementChanged(this.#change)
      // Right-click comes back out of the game the same way Escape does.
      this.#backOff = get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: GAME_VIEW, back: () => this.#leave() }) ?? null
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    get<EventTarget>('@hypercomb.social/Lineage')?.removeEventListener?.('change', this.#lineageChange)
    window.removeEventListener('keydown', this.#key, true)
    this.#backOff?.()
    this.#backOff = null
    this.#enablementOff?.()
    this.#enablementOff = null
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #lineageChange = (): void => {
    this.#targetSegments = null
    void this.#reconcile()
  }

  /** Escape leaves the VIEW. The overlay handles its own Escape while it is
   *  mounted and stops the event there, so this fires for the case that
   *  would otherwise strand somebody: the surface is up and the game is not. */
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== GAME_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#leave()
  }

  #vm(): ViewModeShape | undefined {
    return get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  /** Out of the game, onto the hexagons where the tile stands. The arrival
   *  latch is already set for this cell, so leaving sticks — the layer's own
   *  default does not re-open it a tick later. */
  #leave(): void {
    this.#vm()?.setMode(HEXAGONS)
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode !== GAME_VIEW) {
      this.#targetSegments = null
      this.#teardown()
      return
    }
    await this.#mount(gen)
  }

  async #mount(gen: number): Promise<void> {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    this.#targetSegments = segments
    const key = segments.join('/')

    // Already playing this cell's game — leave the running game alone. Without
    // this, every reconcile trigger (decoration writes, mode churn, a
    // synchronize) would restart it mid-play.
    if (this.#game && this.#mountedKey === key) return

    const hidden = await isFeatureHidden(segments, GAME_PLAY_KIND).catch(() => false)
    const payload = hidden ? null : await gamePlayAt(segments)
    if (gen !== this.#gen || this.#vm()?.mode !== GAME_VIEW) return

    // THE GAMES ARE IN THE LAZY LANE AND THIS FRAME IS NOT — on purpose, and
    // it is why the frame has to fetch them itself. The post-render preload
    // waits for `render:cell-count`, which an arrival face never emits
    // because it SKIPS the hexagon paint. So a game opened as a tile's face
    // would sit waiting for a paint that its own takeover suppressed. Ask
    // for the chunk directly instead; `preloadEffects` is idempotent, so a
    // hive that already warmed it pays nothing.
    if (payload && !playableGame(payload.gameId)) {
      await this.#ensureGamesLoaded()
      await this.#awaitGame(payload.gameId, gen)
      if (gen !== this.#gen || this.#vm()?.mode !== GAME_VIEW) return
    }

    if (!isPlayable(payload)) {
      // No game here, no bee for it, or its light is out. Never hold a
      // surface with nothing on it.
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode(HEXAGONS)
      return
    }

    this.#teardown()
    this.#open(payload as GamePlayPayload)
    this.#mountedKey = key
  }

  /** Warm the post-render lane the game bees live in, once. Dynamic on
   *  purpose: a static import would pull every game into the startup chunk
   *  and undo the split this frame is deliberately on the other side of. */
  async #ensureGamesLoaded(): Promise<void> {
    this.#gamesLoading ??= import('../preload-effects.js')
      .then(m => m.preloadEffects())
      .catch(() => undefined)
    await this.#gamesLoading
  }

  /** A GAME IS ITS OWN BEE. In the dev shell the lane above imports it; in
   *  the web runtime the runtime loads it and this frame never compiles in a
   *  copy (atomic-modules-plan.md), so an arrival can land before the game
   *  registers. Wait for it through the IoC feed — bounded, and abandoned
   *  the moment the frame moves on. */
  #awaitGame(gameId: string, gen: number): Promise<void> {
    if (playableGame(gameId)) return Promise.resolve()
    const ioc = (window as { ioc?: { onRegister?: (cb: () => void) => () => void } }).ioc
    return new Promise(done => {
      let off: (() => void) | undefined
      const finish = (): void => { off?.(); clearTimeout(timer); done() }
      const timer = setTimeout(finish, GAME_ARRIVAL_WAIT_MS)
      off = ioc?.onRegister?.(() => { if (gen !== this.#gen || playableGame(gameId)) finish() })
      if (!off) finish()
    })
  }

  #open(payload: GamePlayPayload): void {
    const game = playableGame(payload.gameId)
    if (!game?.open) { this.#vm()?.setMode(HEXAGONS); return }
    this.#game = game
    game.open()
    // The overlay refused (a race with the roster light going out between
    // the gate above and here) — do not hold a covered surface over nothing.
    if (game.isActive?.() === false) { this.#teardown(); this.#vm()?.setMode(HEXAGONS); return }
    this.#setActive(true)
    // The way OUT of a game is the game's own × — it tears itself down and
    // tells nobody in particular. Watch for that and follow it out, so the
    // participant never lands on a covered, empty surface.
    this.#poll = setInterval(() => {
      if (this.#vm()?.mode !== GAME_VIEW) return
      if (this.#game?.isActive?.() === false) this.#leave()
    }, ACTIVE_POLL_MS)
  }

  #teardown(): void {
    if (this.#poll) { clearInterval(this.#poll); this.#poll = null }
    try { this.#game?.close?.() } catch { /* a game already gone is fine */ }
    this.#game = null
    this.#mountedKey = ''
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', GAME_VIEW)
    else modes?.exit('view:active', GAME_VIEW)
    EffectBus.emit('game:view-state', { active })
  }
}

const _gameView = new GameViewDrone()
window.ioc.register('@diamondcoreprocessor.com/GameViewDrone', _gameView)

// THE BEE WIRES. The queen, the cohort light and the registry record are
// the game feature's registrations, so they live in its one behaviour;
// game.queen.ts is a dependency and registers nothing (atomic-modules-plan.md).
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
