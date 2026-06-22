// diamondcoreprocessor.com/games/tutor/letter-reveal/letter-reveal.engine.ts
//
// Pure state machine for the letter-reveal recall game. You see the cue
// and a word with only its first letter shown — the rest are blanks. You
// type the word one letter at a time; each correct keystroke fills a
// blank, a wrong one bounces. Producing the answer letter-by-letter is
// strong PRODUCTION recall — it forces the word out of memory rather than
// merely recognising it, which is exactly the encoding the user wanted
// ("type the word so you remember it in your mind").
//
// No DOM/canvas/IoC — the renderer reads this; the game wrapper drives it.

import type { Grade } from '../deck.types.js'

export type LetterPhase = 'typing' | 'done'

export interface LetterOutcome {
  grade: Grade
  correct: boolean
  elapsedMs: number
}

/** How many leading letters are shown for free. */
const REVEAL_COUNT = 1

export class LetterRevealEngine {
  readonly target: string
  phase: LetterPhase = 'typing'
  /** Count of correctly produced characters (starts at the pre-revealed count). */
  pos: number
  outcome: LetterOutcome | null = null
  /** Set briefly when a wrong key is pressed — the renderer flashes it. */
  wrongFlash = 0

  #elapsed = 0
  #mistakes = 0
  #gaveUp = false

  constructor(answer: string) {
    this.target = answer.trim()
    this.pos = Math.min(REVEAL_COUNT, this.target.length)
    if (this.pos >= this.target.length) {
      // Degenerate (1-char answer) — already complete; grade easy.
      this.phase = 'done'
      this.outcome = { grade: 'easy', correct: true, elapsedMs: 0 }
    }
  }

  update(dt: number): void {
    if (this.phase !== 'done') this.#elapsed += dt
    if (this.wrongFlash > 0) this.wrongFlash = Math.max(0, this.wrongFlash - dt)
  }

  /** True if `ch` is the next expected character (case-insensitive). */
  #matchesNext(ch: string): boolean {
    return ch.toLowerCase() === this.target[this.pos]?.toLowerCase()
  }

  /**
   * Feed a single typed character. Returns `'right'`, `'wrong'`, or
   * `'win'` so the wrapper can fire juice. Auto-skips non-letter target
   * positions (spaces/hyphens) so multi-token answers still work.
   */
  type(ch: string): 'right' | 'wrong' | 'win' | 'ignored' {
    if (this.phase !== 'typing' || ch.length !== 1) return 'ignored'

    // Auto-fill any non-alphanumeric separators at the cursor.
    while (this.pos < this.target.length && !/[a-z0-9]/i.test(this.target[this.pos])) this.pos++

    if (this.#matchesNext(ch)) {
      this.pos++
      // Skip trailing separators so the win check lands cleanly.
      while (this.pos < this.target.length && !/[a-z0-9]/i.test(this.target[this.pos])) this.pos++
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

  /** Give up — reveal the whole word and grade `again` (see it again soon). */
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
