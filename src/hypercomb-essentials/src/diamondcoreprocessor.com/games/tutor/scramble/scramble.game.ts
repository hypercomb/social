// diamondcoreprocessor.com/games/tutor/scramble/scramble.game.ts
//
// Scramble as a pluggable TutorGame + descriptor. PRODUCTION recall via
// reconstruction from a jumble. Single-word answers only.

import type { GameContext, TutorGame, TutorGameDescriptor } from '../game-registry.js'
import type { StudyItem } from '../deck.types.js'
import { ScrambleEngine } from './scramble.engine.js'
import { draw } from './scramble.renderer.js'

/** Jumble the letters; retry a few times so the result differs from the word. */
function scramble(word: string): string {
  const letters = word.split('')
  if (letters.length < 2) return word
  let out = word
  for (let t = 0; t < 8 && out === word; t++) {
    const a = [...letters]
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]] }
    out = a.join('')
  }
  return out
}

class ScrambleGame implements TutorGame {
  readonly #ctx: GameContext
  readonly #engine: ScrambleEngine
  #w = 0
  #h = 0
  #reported = false

  constructor(ctx: GameContext) {
    const answer = ctx.item.answer.trim()
    this.#ctx = ctx
    this.#engine = new ScrambleEngine(answer, scramble(answer))
  }

  update(dt: number): void {
    this.#engine.update(dt)
    if (this.#engine.outcome && !this.#reported) {
      this.#reported = true
      const o = this.#engine.outcome
      if (o.correct) this.#ctx.particles.burst(this.#w / 2, this.#h * 0.66, { count: 24, speed: 170, color: ['#ffffff', '#ffd76a', '#7ee0ff'], life: 0.6 })
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
    if (e.key === 'Backspace') { this.#engine.backspace(); return }
    if (e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return
    const res = this.#engine.type(e.key)
    if (res === 'wrong') this.#ctx.shaker.add(0.32)
    else if (res === 'right') this.#ctx.particles.burst(this.#w / 2, this.#h * 0.66, { count: 5, speed: 70, color: '#7ee0ff', life: 0.35 })
  }
}

/** Single word, 3–12 letters. */
function suits(item: StudyItem): boolean {
  const a = (item.answer || '').trim()
  return /^[\p{L}]{3,12}$/u.test(a)
}

export const SCRAMBLE_DESCRIPTOR: TutorGameDescriptor = {
  id: 'scramble',
  label: 'Scramble',
  glyph: '🔀',
  recall: 'production',
  weight: 1.1,
  suits,
  create: (ctx) => new ScrambleGame(ctx),
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<{ register: (d: TutorGameDescriptor) => void }>(
  '@diamondcoreprocessor.com/TutorGameRegistry',
  (registry) => registry.register(SCRAMBLE_DESCRIPTOR),
)
