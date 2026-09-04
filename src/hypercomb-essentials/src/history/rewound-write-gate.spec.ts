// history/rewound-write-gate.spec.ts
//
// A REFUSED WRITE MUST REACH ITS CALLER. While the history cursor is rewound
// the committer refuses every commit — correctly, since the assembled state is
// a past view rather than a new intent. The defect was that it refused
// SILENTLY: `importTree` logged to the console and returned void, so a caller
// that resolved that void as success reported the write as committed while
// nothing was written, and the work vanished on the next refresh.
//
// `/undo` is what puts a hive into that state and it is machine-callable, so a
// plan of `/undo` then `/create x` had the create resolve clean and the receipt
// say it ran.
//
// The committer is a live drone with a cascade behind it, so this is a
// mechanical guard on the source — the same shape as create-links-head.spec.ts,
// and honest about being one.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'hypercomb-essentials', 'src')
const committer = readFileSync(join(ROOT, 'history', 'layer-committer.drone.ts'), 'utf8')
const queen = readFileSync(join(ROOT, 'history', 'undo.queen.ts'), 'utf8')

/** The `rewound` branch inside importTree, comments stripped. */
const rewoundBranch = (): string => {
  const at = committer.indexOf('cursor?.state?.rewound')
  expect(at).toBeGreaterThan(-1)
  const branch = committer.slice(at, at + 1600)
  return branch
    .split(/\r?\n/)
    .filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n')
}

describe('the rewound write gate', () => {
  it('throws rather than returning, so a caller cannot read it as success', () => {
    const branch = rewoundBranch()
    expect(branch).toContain('throw new RewoundCommitError')
  })

  it('names the refusal, so a receipt can tell "would not" from "broke"', () => {
    expect(committer).toContain('export class RewoundCommitError extends Error')
  })

  it('tells the participant in their own log, not only the console', () => {
    expect(rewoundBranch()).toContain("activity:log")
  })

  it('no longer relies on console.warn as the whole report', () => {
    // The old code's entire notification was a console.warn followed by return.
    const branch = rewoundBranch()
    const warnThenReturn = /console\.warn\([^)]*\)\s*\n\s*return\b/.test(branch)
    expect(warnThenReturn).toBe(false)
  })
})

describe('/undo says it changed what the hive will accept', () => {
  it('reports the write gate, because stepping back is a capability change', () => {
    // Neither `reach` nor `scope` can express "this stops the hive taking
    // writes", so the verb owes the speaker a sentence.
    expect(queen).toContain('cursor.state?.rewound')
    expect(queen).toMatch(/will not take writes/)
  })
})
