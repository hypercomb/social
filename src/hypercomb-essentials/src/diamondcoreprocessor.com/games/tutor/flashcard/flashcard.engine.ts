// diamondcoreprocessor.com/games/tutor/flashcard/flashcard.engine.ts
//
// Pure state machine for the flashcard recall game. No DOM, no canvas, no
// IoC — just the flip + self-grade logic the renderer reads and the game
// wrapper drives. The classic active-recall loop: see the cue, retrieve
// the answer in your head, flip, then honestly grade how it went. The
// grade feeds the scheduler's spacing directly.

import type { Grade } from '../deck.types.js'

export type FlashcardPhase = 'front' | 'back' | 'done'

export interface FlashcardOutcome {
  grade: Grade
  correct: boolean
  elapsedMs: number
}

const FLIP_SECONDS = 0.42

export class FlashcardEngine {
  phase: FlashcardPhase = 'front'
  /** Flip progress 0 (front) … 1 (back) — renderer scales the card on X. */
  flip = 0
  outcome: FlashcardOutcome | null = null

  #elapsed = 0
  #flipping = false

  /** Advance flip animation + elapsed timer. */
  update(dt: number): void {
    if (this.phase !== 'done') this.#elapsed += dt
    if (this.#flipping) {
      this.flip = Math.min(1, this.flip + dt / FLIP_SECONDS)
      if (this.flip >= 1) { this.#flipping = false; this.phase = 'back' }
    }
  }

  /** Front → back. The learner has attempted recall and wants to check. */
  reveal(): void {
    if (this.phase !== 'front') return
    this.#flipping = true
  }

  /** Self-grade on the back. Records the outcome and ends the round. */
  grade(g: Grade): void {
    if (this.phase !== 'back') return
    this.phase = 'done'
    this.outcome = { grade: g, correct: g !== 'again', elapsedMs: Math.round(this.#elapsed * 1000) }
  }

  /** Whether the card is currently showing its answer side. */
  get showingBack(): boolean { return this.flip > 0.5 }
}
