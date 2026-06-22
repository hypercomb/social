// diamondcoreprocessor.com/games/tutor/scramble/scramble.engine.ts
//
// Pure state for the scramble game. The answer's letters are shown jumbled
// (the `scrambled` string is computed by the game wrapper so this engine
// stays deterministic/pure); the learner retypes the word in order. Like
// letter-reveal it's PRODUCTION recall, but reconstructing from a jumble
// exercises a different retrieval path. Single word only (gated by suits).

import type { Grade } from '../deck.types.js'

export type ScramblePhase = 'typing' | 'done'
export interface ScrambleOutcome { grade: Grade; correct: boolean; elapsedMs: number }

export class ScrambleEngine {
  readonly target: string
  readonly scrambled: string
  phase: ScramblePhase = 'typing'
  pos = 0
  outcome: ScrambleOutcome | null = null
  wrongFlash = 0

  #elapsed = 0
  #mistakes = 0
  #gaveUp = false

  constructor(target: string, scrambled: string) {
    this.target = target.trim()
    this.scrambled = scrambled
  }

  update(dt: number): void {
    if (this.phase !== 'done') this.#elapsed += dt
    if (this.wrongFlash > 0) this.wrongFlash = Math.max(0, this.wrongFlash - dt)
  }

  type(ch: string): 'right' | 'wrong' | 'win' | 'ignored' {
    if (this.phase !== 'typing' || ch.length !== 1) return 'ignored'
    if (ch.toLowerCase() === this.target[this.pos]?.toLowerCase()) {
      this.pos++
      if (this.pos >= this.target.length) {
        this.phase = 'done'
        const grade: Grade = this.#mistakes === 0 ? 'easy' : this.#mistakes <= 3 ? 'good' : 'again'
        this.outcome = { grade, correct: true, elapsedMs: Math.round(this.#elapsed * 1000) }
        return 'win'
      }
      return 'right'
    }
    this.#mistakes++
    this.wrongFlash = 0.3
    return 'wrong'
  }

  /** Delete the last produced letter. */
  backspace(): void { if (this.phase === 'typing' && this.pos > 0) this.pos-- }

  /** Give up — reveal the word and grade `again`. */
  reveal(): void {
    if (this.phase !== 'typing') return
    this.#gaveUp = true
    this.pos = this.target.length
    this.phase = 'done'
    this.outcome = { grade: 'again', correct: false, elapsedMs: Math.round(this.#elapsed * 1000) }
  }

  get mistakes(): number { return this.#mistakes }
  get gaveUp(): boolean { return this.#gaveUp }
}
