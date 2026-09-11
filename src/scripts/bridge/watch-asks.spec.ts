// watch-asks.spec.ts — the wake line's `reply` hint survives a POSIX shell.
//
// The hint is the exact command a responder runs to answer a chat turn. It
// once interpolated the convoId bare, so any tile path with a space split
// into extra positionals and _chat-reply.cjs refused the reply. Every
// interpolated argument is now single-quoted; these tests split the command
// the way a shell does and require each argument back, byte for byte.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require_ = createRequire(import.meta.url)
const watch = require_('./watch-asks.cjs') as {
  shellQuote: (value: string) => string
  replyCommand: (convoId: string, askSig: string) => string
}

const ASK = 'a'.repeat(64)

const CONVOS = [
  'chat:tile:/dolphin',
  'chat:tile:/my notes',
  "chat:tile:/jaime's hive",
  'chat:tile:/$HOME `date` "quoted" \\ back',
  'chat:tile:/tab\there',
]

const expected = (convoId: string): string[] =>
  ['node', 'scripts/bridge/_chat-reply.cjs', convoId, '<reply text>', '--ask', ASK]

/** POSIX word splitting, for the subset the quoting uses: single quotes
 *  (nothing inside expands), a backslash escape outside them, and unquoted
 *  whitespace as the separator. */
const words = (line: string): string[] => {
  const out: string[] = []
  let word = ''
  let started = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) throw new Error('unterminated single quote')
      word += line.slice(i + 1, end)
      started = true
      i = end
    } else if (c === '\\') {
      word += line[++i] ?? ''
      started = true
    } else if (/\s/.test(c)) {
      if (started) { out.push(word); word = ''; started = false }
    } else {
      word += c
      started = true
    }
  }
  if (started) out.push(word)
  return out
}

describe('the reply hint quotes what it interpolates', () => {
  for (const convoId of CONVOS) {
    it(`${JSON.stringify(convoId)} reaches the script as ONE positional`, () => {
      expect(words(watch.replyCommand(convoId, ASK))).toEqual(expected(convoId))
    })
  }

  it('spells an embedded quote the POSIX way', () => {
    expect(watch.shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  // The same check through a real shell, where one is on PATH (Git Bash on
  // Windows, sh everywhere else). `set --` makes the words positionals and
  // printf writes them NUL-separated, so nothing is re-split on the way out.
  const shell = spawnSync('sh', ['-c', 'exit 0']).status === 0
  it.skipIf(!shell)('a real sh splits it the same way', () => {
    for (const convoId of CONVOS) {
      const run = spawnSync('sh', ['-c', `set -- ${watch.replyCommand(convoId, ASK)}; printf '%s\\0' "$@"`], { encoding: 'utf8' })
      expect(run.status).toBe(0)
      expect(run.stdout.split('\0').slice(0, -1)).toEqual(expected(convoId))
    }
  })
})
