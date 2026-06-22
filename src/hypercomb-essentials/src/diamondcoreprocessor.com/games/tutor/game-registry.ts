// diamondcoreprocessor.com/games/tutor/game-registry.ts
//
// The pluggable contract for tutor study games. The whole point of the
// tutor behaviour is "many ways to reinforce the same material" — so a
// game is not hard-wired into the shell. Each game is a self-registering
// module that contributes a TutorGameDescriptor to this singleton
// registry; the shell asks the registry which games SUIT an item and
// picks one. Adding games 3–10 later is purely additive: a new
// `*.game.ts` that calls `register(...)`, imported once by the shell.
//
// Mirrors VisualBeeRegistry / LayerSlotRegistry: an EventTarget singleton
// on `window.ioc`. NEVER import the class symbol non-type-only from
// another bundle — that forks the singleton. Game modules register via
// `window.ioc.whenReady('@diamondcoreprocessor.com/TutorGameRegistry', …)`.

import type { Shaker, ParticleField } from '../juice.js'
import type { StudyItem, RoundResult } from './deck.types.js'

/**
 * Everything the shell hands a game for one round. The shell owns the
 * canvas, the DPR/shake transform, the RAF loop, and the shared juice
 * primitives — a game just reads the item, draws, takes input, and
 * reports a result.
 */
export interface GameContext {
  /** The single item this round drills. */
  readonly item: StudyItem
  /**
   * The other items in the deck — a draw pool for recognition games that
   * need distractors (multiple choice) or comparisons. Includes the current
   * item; games filter it out themselves.
   */
  readonly pool: readonly StudyItem[]
  /** Shared trauma screen-shake — add() on impacts; the shell folds offset() into the transform. */
  readonly shaker: Shaker
  /** Shared additive particle field — burst() for correct-answer sparks. */
  readonly particles: ParticleField
  /**
   * Report the round outcome. Call EXACTLY ONCE; the shell records it
   * with the scheduler and advances to the next round. `itemId` is filled
   * in by the shell, so games omit it.
   */
  done(result: Omit<RoundResult, 'itemId'>): void
}

/**
 * A live game instance running one item. Created by a descriptor's
 * `create(ctx)`. The shell drives it: `update` every frame, `draw` every
 * frame (logical CSS-pixel space — the shell has already applied the DPR
 * and shake transform), and forwards isolated input via `key`/`pointer`.
 */
export interface TutorGame {
  /** Advance simulation. `dt` seconds since last frame. */
  update(dt: number): void
  /** Render into the 2D context. `w`×`h` are logical CSS pixels; `time` is total elapsed seconds. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void
  /** Keyboard input. The shell forwards game keys already isolated from the app shell. */
  key?(e: KeyboardEvent): void
  /** Pointer input in logical coordinates. */
  pointer?(x: number, y: number, phase: 'down' | 'move' | 'up'): void
  /** Optional teardown when the round ends or the shell unmounts mid-round. */
  dispose?(): void
}

/**
 * The retrieval mode a game exercises. Used by the shell to bias game
 * selection by an item's learning stage: PRODUCTION (you must generate
 * the answer — type it) is the stronger, harder mode and is favoured for
 * new / lapsed items; RECOGNITION (you judge / reveal) is favoured for
 * mature items being maintained. `any` games are stage-neutral.
 */
export type RetrievalMode = 'production' | 'recognition' | 'any'

/** A registered study game. */
export interface TutorGameDescriptor {
  /** Unique id, e.g. `'letter-reveal'`, `'flashcard'`. */
  readonly id: string
  /** Human label for the game-switcher chip. */
  readonly label: string
  /** Material-symbol ligature or emoji for the chip. */
  readonly glyph: string
  /** Relative selection weight when this game suits an item (default 1). */
  readonly weight?: number
  /** Which retrieval mode this game exercises (drives stage biasing). */
  readonly recall: RetrievalMode
  /**
   * Can this game present the item? e.g. typed-recall declines multi-word
   * or very long answers; multiple-choice needs distractors in `pool`. The
   * universal fallback game returns true always.
   */
  suits(item: StudyItem, pool?: readonly StudyItem[]): boolean
  /** Build a live game instance for one round. */
  create(ctx: GameContext): TutorGame
}

/**
 * Singleton registry of study games. EventTarget so the shell can rebuild
 * the game-switcher chips when games register mid-session (hot reload).
 */
export class TutorGameRegistry extends EventTarget {
  readonly #games = new Map<string, TutorGameDescriptor>()

  /** Register a game. Idempotent for the same reference; a different object under the same id is dropped with a warning. */
  register(game: TutorGameDescriptor): void {
    if (!game?.id || typeof game.id !== 'string') {
      throw new Error('[TutorGameRegistry] game.id must be a non-empty string')
    }
    const existing = this.#games.get(game.id)
    if (existing && existing !== game) {
      console.warn(`[tutor-game-registry] duplicate game "${game.id}" — ignoring re-registration`)
      return
    }
    if (existing === game) return
    this.#games.set(game.id, game)
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** All registered games, in insertion order. */
  all(): TutorGameDescriptor[] {
    return [...this.#games.values()]
  }

  /** Look up a game by id. */
  get(id: string): TutorGameDescriptor | undefined {
    return this.#games.get(id)
  }

  /** Games that can present the given item (pool supplies distractors for recognition games). */
  suitableFor(item: StudyItem, pool?: readonly StudyItem[]): TutorGameDescriptor[] {
    return this.all().filter(g => {
      try { return g.suits(item, pool) } catch { return false }
    })
  }
}

// Singleton: one instance per app, registered with window.ioc so every
// game module (and the shell) shares it.
const _tutorGameRegistry = new TutorGameRegistry()
;(window as { ioc?: { register: (k: string, v: unknown) => void } }).ioc?.register(
  '@diamondcoreprocessor.com/TutorGameRegistry',
  _tutorGameRegistry,
)
