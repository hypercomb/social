// diamondcoreprocessor.com/games/tutor/hangman/hangman.engine.ts
//
// Pure state for hangman: guess letters to reveal the answer before the
// misses run out. Letter-level retrieval that rewards actually knowing the
// word (you spend guesses efficiently when you do). No DOM/canvas.

import type { Grade } from '../deck.types.js'

export type HangmanPhase = 'guessing' | 'done'
export interface HangmanOutcome { grade: Grade; correct: boolean; elapsedMs: number }

const MAX_MISSES = 6

export class HangmanEngine {
  readonly target: string
  readonly guessed = new Set<string>()
  misses = 0
  readonly maxMisses = MAX_MISSES
  phase: HangmanPhase = 'guessing'
  outcome: HangmanOutcome | null = null
  wrongFlash = 0

  #elapsed = 0

  constructor(target: string) { this.target = target.trim() }

  update(dt: number): void {
    if (this.phase !== 'done') this.#elapsed += dt
    if (this.wrongFlash > 0) this.wrongFlash = Math.max(0, this.wrongFlash - dt)
  }

  /** True if a guessable char has been guessed (lowercased). */
  isGuessed(ch: string): boolean { return this.guessed.has(ch.toLowerCase()) }

  guess(letter: string): 'hit' | 'miss' | 'win' | 'lose' | 'ignored' {
    const ch = (letter || '').toLowerCase()
    if (this.phase !== 'guessing' || ch.length !== 1 || !/[a-z0-9]/.test(ch)) return 'ignored'
    if (this.guessed.has(ch)) return 'ignored'
    this.guessed.add(ch)

    if (this.target.toLowerCase().includes(ch)) {
      if (this.#allRevealed()) {
        this.phase = 'done'
        const grade: Grade = this.misses === 0 ? 'easy' : this.misses <= 2 ? 'good' : 'good'
        this.outcome = { grade, correct: true, elapsedMs: Math.round(this.#elapsed * 1000) }
        return 'win'
      }
      return 'hit'
    }
    this.misses++
    this.wrongFlash = 0.3
    if (this.misses >= this.maxMisses) {
      this.phase = 'done'
      this.outcome = { grade: 'again', correct: false, elapsedMs: Math.round(this.#elapsed * 1000) }
      return 'lose'
    }
    return 'miss'
  }

  #allRevealed(): boolean {
    for (const c of this.target) {
      if (/[a-z0-9]/i.test(c) && !this.guessed.has(c.toLowerCase())) return false
    }
    return true
  }

  get won(): boolean { return this.phase === 'done' && !!this.outcome?.correct }
  get lost(): boolean { return this.phase === 'done' && !this.outcome?.correct }
}
