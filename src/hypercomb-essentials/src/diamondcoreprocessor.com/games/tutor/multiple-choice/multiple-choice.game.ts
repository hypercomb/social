// diamondcoreprocessor.com/games/tutor/multiple-choice/multiple-choice.game.ts
//
// Multiple choice as a pluggable TutorGame + descriptor. RECOGNITION recall
// — pick the answer from a set. Distractors are drawn from the deck pool
// (other items' answers), so it only suits an item when the deck has
// enough distinct answers. The shell favours it for mature items.

import type { GameContext, TutorGame, TutorGameDescriptor } from '../game-registry.js'
import type { StudyItem } from '../deck.types.js'
import { MultipleChoiceEngine, type MCOption } from './multiple-choice.engine.js'
import { draw, optionRects, type Rect } from './multiple-choice.renderer.js'

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

function shuffle<T>(a: readonly T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [r[i], r[j]] = [r[j], r[i]] }
  return r
}

/** Up to 3 distinct distractor answers drawn from the rest of the deck. */
function distractorsFor(item: StudyItem, pool: readonly StudyItem[]): string[] {
  const seen = new Set([item.answer.trim().toLowerCase()])
  const out: string[] = []
  for (const p of shuffle(pool)) {
    if (!p || p.id === item.id) continue
    const a = (p.answer || '').trim()
    const key = a.toLowerCase()
    if (!a || seen.has(key)) continue
    seen.add(key); out.push(a)
    if (out.length >= 3) break
  }
  return out
}

function buildOptions(item: StudyItem, pool: readonly StudyItem[]): MCOption[] {
  const opts = [item.answer, ...distractorsFor(item, pool)]
  return shuffle(opts).map(text => ({ text, correct: text === item.answer }))
}

class MultipleChoiceGame implements TutorGame {
  readonly #ctx: GameContext
  readonly #engine: MultipleChoiceEngine
  #w = 0
  #h = 0
  #reported = false

  constructor(ctx: GameContext) {
    this.#ctx = ctx
    this.#engine = new MultipleChoiceEngine(buildOptions(ctx.item, ctx.pool))
  }

  update(dt: number): void {
    this.#engine.update(dt)
    if (this.#engine.outcome && !this.#reported) {
      this.#reported = true
      const o = this.#engine.outcome
      if (o.correct) this.#ctx.particles.burst(this.#w / 2, this.#h * 0.42, { count: 20, color: ['#ffffff', '#7ee0ff', '#ffd76a'], speed: 150 })
      else this.#ctx.shaker.add(0.5)
      this.#ctx.done({ grade: o.grade, correct: o.correct, elapsedMs: o.elapsedMs })
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    this.#w = w; this.#h = h
    draw(ctx, w, h, time, this.#engine, this.#ctx.item)
  }

  key(e: KeyboardEvent): void {
    if (this.#engine.phase !== 'choosing') return
    const n = parseInt(e.key, 10)
    if (!isNaN(n) && n >= 1 && n <= this.#engine.options.length) this.#engine.choose(n - 1)
  }

  pointer(x: number, y: number, phase: 'down' | 'move' | 'up'): void {
    if (phase !== 'down' || this.#engine.phase !== 'choosing') return
    const rects = optionRects(this.#w, this.#h, this.#engine.options.length)
    for (let i = 0; i < rects.length; i++) if (inside(rects[i], x, y)) { this.#engine.choose(i); return }
  }
}

function suits(item: StudyItem, pool?: readonly StudyItem[]): boolean {
  const a = (item.answer || '').trim()
  if (a.length < 1 || a.length > 48) return false
  if (!pool || pool.length < 3) return false
  return distractorsFor(item, pool).length >= 1
}

export const MULTIPLE_CHOICE_DESCRIPTOR: TutorGameDescriptor = {
  id: 'multiple-choice',
  label: 'Multiple Choice',
  glyph: '🔘',
  recall: 'recognition',
  weight: 1,
  suits,
  create: (ctx) => new MultipleChoiceGame(ctx),
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<{ register: (d: TutorGameDescriptor) => void }>(
  '@diamondcoreprocessor.com/TutorGameRegistry',
  (registry) => registry.register(MULTIPLE_CHOICE_DESCRIPTOR),
)
