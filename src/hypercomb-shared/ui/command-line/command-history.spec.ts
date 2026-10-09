// ui/command-line/command-history.spec.ts — a word asks the line history to
// give back a secret it found on its line (`command-history:forget`): every
// remembered line that begins with the word's words and carries more is cut
// back to them, and the command line honours the ask.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cutBackToWords } from './command-history'

describe('cutBackToWords', () => {
  it('cuts a line that carried a code back to the words, slash or none, in its own spelling', () => {
    const history = ['/Bridge ADD susan hcb-abc', 'bridge add susan hcb-def ghi', 'notes add susan hcb-x', '/bridge add susan']
    expect(cutBackToWords(history, 'bridge add susan')).toEqual(['/Bridge ADD susan', 'bridge add susan', 'notes add susan hcb-x', '/bridge add susan'])
  })

  it('leaves every other line alone — the words exactly, or another name', () => {
    const history = ['bridge add susan', 'bridge add susanna hcb-x', 'bridge add', 'bridge withdraw susan', '']
    expect(cutBackToWords(history, 'bridge add susan')).toEqual(history)
  })

  it('collapses a repeat the cut makes next to its twin', () => {
    expect(cutBackToWords(['/bridge add susan hcb-x', '/bridge add susan', 'bridge'], 'bridge add susan'))
      .toEqual(['/bridge add susan', 'bridge'])
  })

  it('does nothing for empty words', () => {
    expect(cutBackToWords(['bridge add susan hcb-x'], '  ')).toEqual(['bridge add susan hcb-x'])
  })
})

describe('the command line honours the ask', () => {
  const src = readFileSync(join(process.cwd(), 'hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts'), 'utf8')

  it('listens for command-history:forget and cuts its history back', () => {
    expect(src).toContain("EffectBus.on<{ words?: string }>('command-history:forget'")
    expect(src).toContain('this.#forgetHistoryAfter(p.words)')
    expect(src).toContain('this.#historyForgetUnsub?.()')
    const body = src.slice(src.indexOf('#forgetHistoryAfter(words: string): void {'))
    expect(body.slice(0, body.indexOf('\n  }\n'))).toContain('cutBackToWords(this.#commandHistory, words)')
  })

  it('writes the history from one place, recording and forgetting alike', () => {
    expect(src.match(/localStorage\.setItem\(COMMAND_HISTORY_KEY/g)).toHaveLength(1)
  })
})
