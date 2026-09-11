// assistant/breaks.spec.ts
//
// THE BREAK LOOP'S PURE HALF IS PINNED — what counts as a break, what makes two
// occurrences the same break, and how the queue folds into issues. The
// fingerprint is the part that must not drift: change it and every issue in
// every hive splits in two on the next fold.

import { describe, expect, it } from 'vitest'
import {
  describeBreak, fingerprintBreak, foldBreaks, normalizeMessage, patchIssue, stackKey,
  type BreakIssue, type BreakRecord,
} from './breaks.js'

const FP = 'f'.repeat(64)

const stackIn = (chunk: string, line: number): string =>
  `TypeError: tile is undefined\n    at paintTile (http://localhost:4250/${chunk}.js:${line}:17)\n    at Ticker.tick (http://localhost:4250/${chunk}.js:${line + 40}:3)`

const record = (over: Partial<BreakRecord> = {}): BreakRecord => ({
  kind: 'break@1', fingerprint: FP, type: 'error', message: 'tile is undefined', stack: '', source: '',
  origin: 'http://localhost:4250', route: '/', session: 's1', sessionAt: 1_000,
  count: 1, firstAt: 1_000, lastAt: 1_000, ...over,
})

const issueFrom = (over: Partial<BreakRecord> = {}): BreakIssue =>
  foldBreaks(new Map(), [record(over)], 0).issues.get(over.fingerprint ?? FP)!

describe('what counts as a break', () => {
  it('reads an uncaught error from its event', () => {
    const error = new TypeError('tile is undefined')
    expect(describeBreak('error', { error, message: 'Uncaught TypeError', filename: 'http://localhost:4250/main.js' }))
      .toMatchObject({ type: 'error', message: 'tile is undefined', source: 'http://localhost:4250/main.js' })
  })

  it('keeps a script or stylesheet that failed to load, and leaves images alone', () => {
    expect(describeBreak('error', { target: { tagName: 'SCRIPT', src: 'http://localhost:4250/x.js' } }))
      .toMatchObject({ type: 'resource', source: 'http://localhost:4250/x.js' })
    expect(describeBreak('error', { target: { tagName: 'IMG', src: 'http://example.com/a.png' } })).toBeNull()
  })

  it('drops the layout warning, cancellations and opaque cross-origin errors', () => {
    expect(describeBreak('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })).toBeNull()
    expect(describeBreak('error', { message: 'Script error.' })).toBeNull()
    expect(describeBreak('rejection', new DOMException('stopped', 'AbortError'))).toBeNull()
  })

  it('takes a console.error only when it carries an Error', () => {
    expect(describeBreak('reported', ['[store] slow write', 42])).toBeNull()
    expect(describeBreak('reported', ['ERROR', new Error('boom')]))
      .toMatchObject({ type: 'reported', message: 'ERROR: boom' })
  })

  it('takes a console.warn as a warning, and only when it carries an Error', () => {
    expect(describeBreak('warned', ['[store] pool not ready yet'])).toBeNull()
    expect(describeBreak('warned', ['[store] could not write', new Error('quota')]))
      .toMatchObject({ type: 'warning', message: '[store] could not write: quota' })
    expect(describeBreak('warned', ['stopped', new DOMException('stopped', 'AbortError')])).toBeNull()
  })

  it('keeps a warning and a break of the same failure as two issues', async () => {
    const stack = stackIn('chunk-5X2ZQK3M', 120)
    const warned = await fingerprintBreak({ type: 'warning', message: 'tile is undefined', stack, source: '' })
    const broke = await fingerprintBreak({ type: 'reported', message: 'tile is undefined', stack, source: '' })
    expect(warned).not.toBe(broke)
  })

  it('still describes a rejection that carries no reason', () => {
    expect(describeBreak('rejection', undefined)).toMatchObject({ type: 'rejection', message: 'rejected without a reason' })
  })

  it('strips invisible and bidi characters from what it keeps', () => {
    expect(describeBreak('reported', [new Error('bo\u202Eom\u200B')])?.message).toBe('boom')
  })
})

describe('one break, one fingerprint', () => {
  it('survives a rebuild — positions and chunk hashes do not split a break', async () => {
    const before = await fingerprintBreak({ type: 'error', message: 'tile is undefined', stack: stackIn('chunk-5X2ZQK3M', 120), source: '' })
    const after = await fingerprintBreak({ type: 'error', message: 'tile is undefined', stack: stackIn('chunk-Q9W8E7R6', 131), source: '' })
    expect(after).toBe(before)
    expect(before).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps two code paths apart', async () => {
    const stack = stackIn('chunk-5X2ZQK3M', 120)
    const a = await fingerprintBreak({ type: 'error', message: 'tile is undefined', stack, source: '' })
    const b = await fingerprintBreak({ type: 'error', message: 'tile is undefined', stack: stack.replace('paintTile', 'placeTile'), source: '' })
    expect(b).not.toBe(a)
  })

  it('folds signatures, URLs and numbers out of the message', () => {
    expect(normalizeMessage(`no layer ${'a'.repeat(64)} at 12 from https://x.io/a?b=1`))
      .toBe('no layer <sig> at <n> from <url>')
  })

  it('reads the top frames only, without positions or hosts', () => {
    expect(stackKey(stackIn('chunk-5X2ZQK3M', 120))).toBe('at paintTile (/chunk.js | at Ticker.tick (/chunk.js')
  })
})

describe('folding the queue into issues', () => {
  it('makes one new issue per fingerprint, below everything already listed', () => {
    const listed = issueFrom({ fingerprint: 'e'.repeat(64) })
    const fold = foldBreaks(
      new Map([[listed.fingerprint, listed]]),
      [record(), record({ session: 's2', firstAt: 2_000, lastAt: 2_000 })],
      5_000,
    )
    expect(fold.created).toEqual([FP])
    expect(fold.issues.get(FP)).toMatchObject({ status: 'new', rank: listed.rank + 1, count: 2, sessions: 2 })
  })

  it('reopens a fixed issue only when it breaks in a page loaded after the fix', () => {
    const fixed = patchIssue(issueFrom(), { status: 'fixed', offered: true }, 5_000)

    const stale = foldBreaks(new Map([[FP, fixed]]), [record({ session: 'old', sessionAt: 4_000, firstAt: 6_000, lastAt: 6_000 })], 7_000)
    expect(stale.issues.get(FP)).toMatchObject({ status: 'fixed', count: 2 })
    expect(stale.reopened).toEqual([])

    const fresh = foldBreaks(new Map([[FP, fixed]]), [record({ session: 'new', sessionAt: 8_000, firstAt: 9_000, lastAt: 9_000 })], 10_000)
    const reopened = fresh.issues.get(FP)!
    expect(fresh.reopened).toEqual([FP])
    expect(reopened.status).toBe('open')
    expect(reopened.offeredAt).toBeUndefined()
    expect(reopened.notes.at(-1)?.text).toMatch(/^broke again after it was fixed/)
  })

  it('falsifies a retirement exactly the way it falsifies a fix', () => {
    // Retiring says "the code that threw is gone". If it throws again from a
    // page loaded after the claim, the claim was wrong and the issue comes
    // back on its own — with no tick installed at all.
    const retired = patchIssue(issueFrom(), { status: 'retired', offered: true }, 5_000)
    expect(retired.fixedAt).toBe(5_000)

    const stale = foldBreaks(new Map([[FP, retired]]), [record({ session: 'old', sessionAt: 4_000, firstAt: 6_000, lastAt: 6_000 })], 7_000)
    expect(stale.issues.get(FP)).toMatchObject({ status: 'retired', count: 2 })
    expect(stale.reopened).toEqual([])

    const fresh = foldBreaks(new Map([[FP, retired]]), [record({ session: 'new', sessionAt: 8_000, firstAt: 9_000, lastAt: 9_000 })], 10_000)
    const back = fresh.issues.get(FP)!
    expect(fresh.reopened).toEqual([FP])
    expect(back.status).toBe('open')
    expect(back.offeredAt).toBeUndefined()
    expect(back.notes.at(-1)?.text).toMatch(/^broke again after it was retired/)
  })

  it('leaves a dismissed issue dismissed, and keeps counting it', () => {
    const dismissed = patchIssue(issueFrom(), { status: 'dismissed' }, 1)
    const fold = foldBreaks(new Map([[FP, dismissed]]), [record({ session: 's9', sessionAt: 9_000 })], 10_000)
    expect(fold.issues.get(FP)).toMatchObject({ status: 'dismissed', count: 2 })
  })
})

describe('patching an issue', () => {
  it('stamps the time itself, appends notes, and ignores what is not its to say', () => {
    const issue = issueFrom()
    const next = patchIssue(issue, { status: 'fixed', note: 'guarded the missing tile', fingerprint: 'nope', count: 99, rank: 'x' }, 42)
    expect(next).toMatchObject({ status: 'fixed', fixedAt: 42, fingerprint: FP, count: 1, rank: issue.rank })
    expect(next.notes).toEqual([{ at: 42, text: 'guarded the missing tile' }])
    expect(patchIssue(issue, { status: 'gone' }, 1).status).toBe('new')
  })

  it('takes an offered mark back', () => {
    const offered = patchIssue(issueFrom(), { offered: true }, 5)
    expect(offered.offeredAt).toBe(5)
    expect(patchIssue(offered, { offered: false }, 6).offeredAt).toBeUndefined()
  })
})

describe("Angular's echo of a window error event", () => {
  it('is never a second break — the window listener already judged the event', () => {
    const muted = { message: 'Script error.', filename: '', lineno: 0, colno: 0 }
    expect(describeBreak('reported', ['ERROR', new Error('Script error.', { cause: muted })])).toBeNull()
    const thrownNull = { message: 'Uncaught null', filename: 'http://localhost:4250/main.js', lineno: 3, colno: 9 }
    expect(describeBreak('reported', ['ERROR', new Error('Uncaught null', { cause: thrownNull })])).toBeNull()
    expect(describeBreak('reported', ['ERROR', new Error('Script error.')])).toBeNull()
  })

  it('does not swallow real code that wraps a plain event', () => {
    expect(describeBreak('reported', ['[relay]', new Error('relay failed', { cause: { type: 'error' } })]))
      .toMatchObject({ type: 'reported', message: '[relay]: relay failed' })
  })
})

describe('the clock a stale tab cannot forge', () => {
  const NOW = 9_000
  const fold = (prior: BreakIssue | undefined, over: Partial<BreakRecord>) =>
    foldBreaks(prior ? new Map([[FP, prior]]) : new Map(), [record(over)], NOW).issues.get(FP)!

  it('keeps one entry per distinct page load, and none a tab could invent', () => {
    // A tab carries its own start time forever, so 500 breaks from one load is
    // one entry — it can raise count and lastAt, never add a newer load.
    let issue = fold(undefined, { sessionAt: 1_000 })
    expect(issue.loads).toEqual([1_000])
    for (let n = 0; n < 5; n++) issue = fold(issue, { session: 's', sessionAt: 1_000, lastAt: 8_000 })
    expect(issue.loads).toEqual([1_000])
    expect(issue.count).toBeGreaterThan(1)

    expect(fold(issue, { session: 'b', sessionAt: 5_000 }).loads).toEqual([1_000, 5_000])
  })

  it('clamps a client clock running ahead, so nothing looks freshly loaded forever', () => {
    expect(fold(undefined, { sessionAt: 10 ** 15 }).loads).toEqual([NOW])
  })
})
