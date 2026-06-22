// diamondcoreprocessor.com/games/tutor/letter-reveal/letter-reveal.game.ts
//
// Letter-reveal as a pluggable TutorGame + its registry descriptor.
// PRODUCTION-mode recall (you generate the answer), so the shell favours
// it for new and lapsed items. `suits()` declines anything that isn't a
// short word-or-two — typed-letter recall only reads well for compact
// answers.

import type { GameContext, TutorGame, TutorGameDescriptor } from '../game-registry.js'
import type { StudyItem } from '../deck.types.js'
import { LetterRevealEngine } from './letter-reveal.engine.js'
import { draw } from './letter-reveal.renderer.js'

class LetterRevealGame implements TutorGame {
  readonly #ctx: GameContext
  readonly #engine: LetterRevealEngine
  #w = 0
  #h = 0
  #reported = false

  constructor(ctx: GameContext) {
    this.#ctx = ctx
    this.#engine = new LetterRevealEngine(ctx.item.answer)
  }

  update(dt: number): void {
    this.#engine.update(dt)
    if (this.#engine.outcome && !this.#reported) {
      this.#reported = true
      const o = this.#engine.outcome
      if (o.correct) {
        this.#ctx.particles.burst(this.#w / 2, this.#h * 0.56, {
          count: 26, speed: 170, color: ['#ffffff', '#ffd76a', '#7ee0ff'], life: 0.6,
        })
      }
      this.#ctx.done({ grade: o.grade, correct: o.correct, elapsedMs: o.elapsedMs })
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    this.#w = w; this.#h = h
    draw(ctx, w, h, time, this.#engine, this.#ctx.item)
  }

  key(e: KeyboardEvent): void {
    if (this.#engine.phase !== 'typing') return
    if (e.key === 'Enter') { this.#engine.reveal(); return }
    if (e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return
    const res = this.#engine.type(e.key)
    if (res === 'wrong') this.#ctx.shaker.add(0.32)
    else if (res === 'right') this.#ctx.particles.burst(this.#w / 2, this.#h * 0.56, { count: 5, speed: 70, color: '#7ee0ff', life: 0.35 })
  }
}

/** Compact-answer gate: 3–18 chars, at most two words, letters/digits only. */
function suits(item: StudyItem): boolean {
  const a = item.answer.trim()
  if (a.length < 3 || a.length > 18) return false
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(a)) return false
  return a.split(/\s+/).length <= 2
}

export const LETTER_REVEAL_DESCRIPTOR: TutorGameDescriptor = {
  id: 'letter-reveal',
  label: 'Letter Reveal',
  glyph: '⌨️',
  recall: 'production',
  weight: 1.4,
  suits,
  create: (ctx) => new LetterRevealGame(ctx),
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<{ register: (d: TutorGameDescriptor) => void }>(
  '@diamondcoreprocessor.com/TutorGameRegistry',
  (registry) => registry.register(LETTER_REVEAL_DESCRIPTOR),
)
