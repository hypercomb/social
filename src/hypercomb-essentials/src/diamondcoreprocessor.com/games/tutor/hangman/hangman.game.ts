// diamondcoreprocessor.com/games/tutor/hangman/hangman.game.ts
//
// Hangman as a pluggable TutorGame + descriptor. Letter-guessing recall —
// stage-neutral (`recall:'any'`), a change of pace between the heavier
// production/recognition games. Physical keys A–Z or the on-screen keyboard.

import type { GameContext, TutorGame, TutorGameDescriptor } from '../game-registry.js'
import type { StudyItem } from '../deck.types.js'
import { HangmanEngine } from './hangman.engine.js'
import { draw, keyRects, type Rect } from './hangman.renderer.js'

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

class HangmanGame implements TutorGame {
  readonly #ctx: GameContext
  readonly #engine: HangmanEngine
  #w = 0
  #h = 0
  #reported = false

  constructor(ctx: GameContext) {
    this.#ctx = ctx
    this.#engine = new HangmanEngine(ctx.item.answer)
  }

  #applyResult(res: 'hit' | 'miss' | 'win' | 'lose' | 'ignored'): void {
    if (res === 'miss') this.#ctx.shaker.add(0.3)
    else if (res === 'lose') this.#ctx.shaker.add(0.7)
    else if (res === 'win') this.#ctx.particles.burst(this.#w / 2, this.#h * 0.4, { count: 26, speed: 170, color: ['#ffffff', '#7ee0ff', '#ffd76a'], life: 0.6 })
  }

  update(dt: number): void {
    this.#engine.update(dt)
    if (this.#engine.outcome && !this.#reported) {
      this.#reported = true
      const o = this.#engine.outcome
      this.#ctx.done({ grade: o.grade, correct: o.correct, elapsedMs: o.elapsedMs })
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    this.#w = w; this.#h = h
    draw(ctx, w, h, time, this.#engine, this.#ctx.item)
  }

  key(e: KeyboardEvent): void {
    if (this.#engine.phase !== 'guessing') return
    if (e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return
    this.#applyResult(this.#engine.guess(e.key))
  }

  pointer(x: number, y: number, phase: 'down' | 'move' | 'up'): void {
    if (phase !== 'down' || this.#engine.phase !== 'guessing') return
    for (const { letter, rect } of keyRects(this.#w, this.#h)) {
      if (inside(rect, x, y)) { this.#applyResult(this.#engine.guess(letter)); return }
    }
  }
}

/** 3–16 chars, letters with optional spaces/hyphens/apostrophes. */
function suits(item: StudyItem): boolean {
  const a = (item.answer || '').trim()
  return /^[\p{L}][\p{L} '-]{2,15}$/u.test(a)
}

export const HANGMAN_DESCRIPTOR: TutorGameDescriptor = {
  id: 'hangman',
  label: 'Hangman',
  glyph: '🔡',
  recall: 'any',
  weight: 0.9,
  suits,
  create: (ctx) => new HangmanGame(ctx),
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<{ register: (d: TutorGameDescriptor) => void }>(
  '@diamondcoreprocessor.com/TutorGameRegistry',
  (registry) => registry.register(HANGMAN_DESCRIPTOR),
)
