// diamondcoreprocessor.com/games/tutor/flashcard/flashcard.game.ts
//
// The flashcard game as a pluggable TutorGame + its registry descriptor.
// Universal fallback: `suits()` is always true, so any item can be drilled
// as a flashcard when no more specific game fits. Recognition-mode recall
// (you judge yourself), so the shell favours it for mature items.

import type { GameContext, TutorGame, TutorGameDescriptor } from '../game-registry.js'
import type { Grade } from '../deck.types.js'
import { FlashcardEngine } from './flashcard.engine.js'
import { draw, gradeButtonRects, type Rect } from './flashcard.renderer.js'

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

class FlashcardGame implements TutorGame {
  readonly #ctx: GameContext
  readonly #engine = new FlashcardEngine()
  #w = 0
  #h = 0
  #reported = false

  constructor(ctx: GameContext) { this.#ctx = ctx }

  update(dt: number): void {
    this.#engine.update(dt)
    if (this.#engine.outcome && !this.#reported) {
      this.#reported = true
      const o = this.#engine.outcome
      if (o.correct) this.#ctx.particles.burst(this.#w / 2, this.#h / 2, { count: 22, color: ['#ffffff', '#ffd76a', '#7ee0ff'], speed: 150 })
      else this.#ctx.shaker.add(0.5)
      this.#ctx.done({ grade: o.grade, correct: o.correct, elapsedMs: o.elapsedMs })
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    this.#w = w; this.#h = h
    draw(ctx, w, h, time, this.#engine, this.#ctx.item)
  }

  key(e: KeyboardEvent): void {
    if (this.#engine.phase === 'front') {
      if (e.key === ' ' || e.key === 'Enter') this.#engine.reveal()
      return
    }
    if (this.#engine.phase === 'back') {
      const map: Record<string, Grade> = { '1': 'again', a: 'again', '2': 'good', g: 'good', '3': 'easy', e: 'easy' }
      const grade = map[e.key.toLowerCase()]
      if (grade) this.#engine.grade(grade)
    }
  }

  pointer(x: number, y: number, phase: 'down' | 'move' | 'up'): void {
    if (phase !== 'down') return
    if (this.#engine.phase === 'front') { this.#engine.reveal(); return }
    if (this.#engine.phase === 'back') {
      const rects = gradeButtonRects(this.#w, this.#h)
      for (const g of ['again', 'good', 'easy'] as Grade[]) {
        if (inside(rects[g], x, y)) { this.#engine.grade(g); return }
      }
    }
  }
}

export const FLASHCARD_DESCRIPTOR: TutorGameDescriptor = {
  id: 'flashcard',
  label: 'Flashcard',
  glyph: '🃏',
  recall: 'recognition',
  weight: 1,
  suits: () => true,
  create: (ctx) => new FlashcardGame(ctx),
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<{ register: (d: TutorGameDescriptor) => void }>(
  '@diamondcoreprocessor.com/TutorGameRegistry',
  (registry) => registry.register(FLASHCARD_DESCRIPTOR),
)
