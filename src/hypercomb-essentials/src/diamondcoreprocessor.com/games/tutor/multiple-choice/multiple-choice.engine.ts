// diamondcoreprocessor.com/games/tutor/multiple-choice/multiple-choice.engine.ts
//
// Pure state for the multiple-choice game. Recognition recall: pick the
// right answer from a set. The game wrapper builds the options (correct
// answer + distractors drawn from the deck pool); this engine just tracks
// the choice and the outcome.

import type { Grade } from '../deck.types.js'

export interface MCOption { text: string; correct: boolean }
export interface MCOutcome { grade: Grade; correct: boolean; elapsedMs: number }
export type MCPhase = 'choosing' | 'done'

export class MultipleChoiceEngine {
  readonly options: MCOption[]
  phase: MCPhase = 'choosing'
  chosen: number | null = null
  outcome: MCOutcome | null = null
  #elapsed = 0

  constructor(options: MCOption[]) { this.options = options }

  update(dt: number): void { if (this.phase !== 'done') this.#elapsed += dt }

  choose(i: number): void {
    if (this.phase !== 'choosing' || i < 0 || i >= this.options.length) return
    this.chosen = i
    this.phase = 'done'
    const correct = !!this.options[i].correct
    this.outcome = { grade: correct ? 'good' : 'again', correct, elapsedMs: Math.round(this.#elapsed * 1000) }
  }

  get correctIndex(): number { return this.options.findIndex(o => o.correct) }
}
