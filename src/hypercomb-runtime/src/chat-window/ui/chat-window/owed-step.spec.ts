// owed-step.spec.ts — WHAT A LEG'S END LEAVES OWED (documentation/conversation-continuity.md).

import { describe, expect, it } from 'vitest'
import { OWED_BACKOFF_MS, WORK_QUIET_MS, agentOwnsCue, owedAfter, owedCue, pageChangeStillOwed, workBeaconOf, type OwedLike } from './owed-step'

const spent = { rounds: 6, tokens: 12_000, legs: 1 }
const record = (over: Partial<OwedLike> = {}): OwedLike => ({
  state: 'continue', why: 'handover', left: 'the other tiles', lastLeft: '', promises: 0, idleLegs: 0,
  failures: 0, spent, tried: [], next: 0, ...over,
})

describe('a leg that hands over', () => {
  it('owes the rest, and says it is continuing', () => {
    const after = owedAfter(undefined, { kind: 'left', left: 'the other tiles', budgetSpent: false, worked: true, spent }, 1_000)
    expect(after.patch).toMatchObject({ state: 'continue', why: 'handover', left: 'the other tiles', spent })
    expect(after.say).toContain('Continuing: the other tiles')
  })

  it('pauses on a spent budget, which only the participant resumes', () => {
    expect(owedAfter(undefined, { kind: 'left', left: 'x', budgetSpent: true, worked: true, spent }, 1).patch)
      .toMatchObject({ state: 'paused', why: 'budget' })
  })

  it('stops and says so when the same work comes back twice with nothing done', () => {
    const after = owedAfter(record(), { kind: 'left', left: '  The other   tiles ', budgetSpent: false, worked: false, spent }, 1)
    expect(after.patch).toMatchObject({ state: 'waiting', why: 'stalled' })
    expect(after.say).toContain('the same work came back twice')
  })

  it('carries on when the same words come back from a leg that did work', () => {
    expect(owedAfter(record(), { kind: 'left', left: 'the other tiles', budgetSpent: false, worked: true, spent }, 1).patch)
      .toMatchObject({ state: 'continue', why: 'handover' })
  })

  it('stops after two legs in a row that did nothing in the hive', () => {
    const first = owedAfter(undefined, { kind: 'left', left: 'a', budgetSpent: false, worked: false, spent }, 1)
    expect(first.patch).toMatchObject({ state: 'continue', idleLegs: 1 })
    const second = owedAfter(record({ left: 'a', idleLegs: 1 }), { kind: 'left', left: 'b', budgetSpent: false, worked: false, spent }, 2)
    expect(second.patch).toMatchObject({ state: 'waiting', why: 'stalled', idleLegs: 2 })
  })
})

describe('a leg that answers', () => {
  it('owes nothing when it simply answers', () => {
    expect(owedAfter(record(), { kind: 'answered', prose: 'The two tiles are /people/betz and /dolphin/associates/betz.', worked: true, spent }, 1).patch).toBeNull()
  })

  it('owes what it promised, and carries it on', () => {
    const after = owedAfter(undefined, { kind: 'answered', prose: "Found them.\n\nNext, I'll update the other tiles.", worked: true, spent }, 1)
    expect(after.patch).toMatchObject({ state: 'continue', why: 'promised', left: 'update the other tiles.', promises: 1 })
    expect(after.say).toContain('Continuing: update the other tiles.')
  })

  it('waits on the participant when it says it is waiting for them, and says no more', () => {
    const after = owedAfter(undefined, { kind: 'answered', prose: "I'll wait for your go-ahead before removing them.", worked: false, spent }, 1)
    expect(after.patch).toMatchObject({ state: 'waiting', why: 'question' })
    expect(after.say).toBeUndefined()
  })

  it('stops on the third promise in a row with nothing done between', () => {
    const after = owedAfter(record({ why: 'promised', promises: 2 }), { kind: 'answered', prose: "I'll check the notes.", worked: false, spent }, 1)
    expect(after.patch).toMatchObject({ state: 'waiting', why: 'stalled', promises: 3 })
    expect(after.say).toContain('3 times without doing it')
  })

  it('counts afresh after a leg that did work', () => {
    expect(owedAfter(record({ promises: 2 }), { kind: 'answered', prose: "I'll check the notes.", worked: true, spent }, 1).patch)
      .toMatchObject({ state: 'continue', promises: 1 })
  })
})

describe('the cue under the conversation', () => {
  it('says nothing when nothing is owed', () => {
    expect(owedCue(undefined, 0)).toBeNull()
  })

  it('says it will carry on, and when, after a model fell off', () => {
    expect(owedCue(record({ why: 'failed', next: 90_000 }), 0)).toMatchObject({
      kind: 'continue', key: 'chat.owed.later', fallback: 'Carrying on in 2 min — the model fell off: the other tiles',
    })
    expect(owedCue(record(), 0)).toMatchObject({ kind: 'continue', fallback: 'Carrying on: the other tiles' })
  })

  it('says when it waits on you, stopped so it does not loop, gave up, or is paused', () => {
    expect(owedCue(record({ state: 'waiting', why: 'question', left: 'your yes' }), 0)?.fallback).toBe('Waiting on you: your yes')
    expect(owedCue(record({ state: 'waiting', why: 'stalled' }), 0)?.fallback).toContain('Picking it back up from there')
    expect(agentOwnsCue('Open step for the agent: Update website title instead of tile. Write it.', 180_000))
      .toBe('Open steps for the agent: Update website title instead of tile. The agent picks them up in 3 min.')
    expect(owedCue(record({ state: 'continue', why: 'unstick', left: 'Open step for the agent: Update website title instead of tile. Write it.', next: 180_000 }), 0)?.fallback)
      .toContain('Open steps for the agent: Update website title instead of tile')
    expect(owedCue(record({ state: 'continue', why: 'unstick' }), 0)?.fallback).toContain('belong to the agent')
    expect(owedCue(record({ state: 'waiting', why: 'gave-up', tried: [{ model: 'm9', at: 0, error: '401' }] }), 0)?.fallback).toContain('(last: m9)')
    expect(owedCue(record({ state: 'paused', why: 'budget' }), 0)).toMatchObject({ kind: 'paused', key: 'chat.owed.paused' })
  })
})

describe('a model that falls off', () => {
  it('owes the work, backs off and tries again', () => {
    const after = owedAfter(record({ left: '' }), { kind: 'failed', model: 'm1', error: '429 rate limited', request: 'update  the tiles', spent }, 1_000)
    expect(after.patch).toMatchObject({
      state: 'continue', why: 'failed', failures: 1, left: 'the request: update the tiles',
      next: 1_000 + OWED_BACKOFF_MS[0], tried: [{ model: 'm1', at: 1_000, error: '429 rate limited' }],
    })
    expect(after.say).toContain('Trying again in 30 s')
  })

  it('keeps the work that was owed rather than the request', () => {
    expect(owedAfter(record(), { kind: 'failed', model: 'm1', error: 'x', request: 'y', spent }, 1).patch).toMatchObject({ left: 'the other tiles' })
  })

  it('backs off longer each time, then waits on the participant and says which failed', () => {
    expect(owedAfter(record({ failures: 1 }), { kind: 'failed', model: 'm', error: 'e', request: 'r', spent }, 0).patch).toMatchObject({ next: OWED_BACKOFF_MS[1] })
    expect(owedAfter(record({ failures: 2 }), { kind: 'failed', model: 'm', error: 'e', request: 'r', spent }, 0).patch).toMatchObject({ next: OWED_BACKOFF_MS[2] })
    const gaveUp = owedAfter(record({ failures: 3 }), { kind: 'failed', model: 'm', error: '401', request: 'r', spent }, 0)
    expect(gaveUp.patch).toMatchObject({ state: 'waiting', why: 'gave-up', failures: 4 })
    expect(gaveUp.say).toContain('Say "continue" to try again')
  })
})

describe('a leg that parks', () => {
  it('records a question and a give-up instead of looking finished', () => {
    expect(owedAfter(undefined, { kind: 'park', why: 'question', left: 'Which footer?', spent }, 1).patch)
      .toMatchObject({ state: 'waiting', why: 'question', left: 'Which footer?' })
    expect(owedAfter(record(), { kind: 'park', why: 'gave-up', left: 'No model switched on can take the rest of this request.', spent }, 1).patch)
      .toMatchObject({ state: 'waiting', why: 'gave-up' })
  })
})

describe('the work beacon', () => {
  const base = {
    now: 10_000,
    waiting: false,
    unattended: false,
    activity: '',
    quietMs: 0,
    elapsed: '4s',
    owed: null,
    rounds: 2,
    ktokens: 18,
    budgetRounds: 400,
    budgetK: 6000,
  }

  it('names a live turn, and a quiet round that is still open', () => {
    expect(workBeaconOf({ ...base, waiting: true, activity: 'Round 2 — claude is working' })?.fallback)
      .toBe('Round 2 — claude is working · 4s · 2 of 400 rounds, 18k of 6000k tokens')
    const quiet = workBeaconOf({ ...base, waiting: true, quietMs: WORK_QUIET_MS, elapsed: '20s' })
    expect(quiet?.state).toBe('quiet')
    expect(quiet?.fallback).toContain('Quiet for 12s')
    expect(quiet?.fallback).toContain('still open')
    expect(quiet?.fallback).toContain('18k of 6000k tokens')
  })

  it('says when nobody is listening', () => {
    expect(workBeaconOf({ ...base, waiting: true, unattended: true })?.state).toBe('unattended')
  })

  it('stays up between legs, and names a model that fell off, a budget, and a wait on you', () => {
    expect(workBeaconOf({
      ...base,
      owed: { kind: 'continue', why: 'failed', left: 'the page', next: 40_000, text: 'later' },
    })?.fallback).toBe('The model fell off. Trying again in 30s. · 2 of 400 rounds, 18k of 6000k tokens')
    expect(workBeaconOf({
      ...base,
      owed: { kind: 'continue', why: 'handover', left: 'write the page', next: 0, text: 'now' },
    })?.fallback).toContain('Carrying on: write the page')
    expect(workBeaconOf({
      ...base,
      rounds: 400,
      ktokens: 6000,
      owed: { kind: 'paused', why: 'budget', left: '', next: 0, text: 'paused' },
    })?.fallback).toContain('Paused on the request budget')
    expect(workBeaconOf({
      ...base,
      owed: { kind: 'waiting', why: 'question', left: 'your yes', next: 0, text: 'Waiting on you: your yes' },
    })).toMatchObject({ state: 'you' })
    expect(workBeaconOf({
      ...base,
      owed: { kind: 'waiting', why: 'gave-up', left: 'no model', next: 0, text: 'No model could carry this on.' },
    })?.state).toBe('gave-up')
    expect(workBeaconOf(base)).toBeNull()
  })

  it('keeps a press, a running command, a question, and open steps on the bar', () => {
    expect(workBeaconOf({
      ...base, waiting: true, activity: 'Thinking…',
      pending: { kind: 'exec-you', text: 'Needs a grant in Execution: read /press-kit' },
    })?.fallback).toBe('Needs a grant in Execution: read /press-kit')
    expect(workBeaconOf({
      ...base,
      pending: { kind: 'exec-run', text: 'Running in Execution: write page /press-kit' },
    })?.fallback).toBe('Running in Execution: write page /press-kit')
    expect(workBeaconOf({
      ...base, waiting: true,
      pending: { kind: 'question', text: 'Waiting on your answer: Which footer?' },
    })?.state).toBe('you')
    expect(workBeaconOf({
      ...base,
      pending: { kind: 'steps', text: '2 steps still open: a new viewable link' },
    })?.fallback).toBe('2 steps still open: a new viewable link')
    expect(workBeaconOf({
      ...base, waiting: true,
      pending: { kind: 'steps', text: '2 steps still open' },
    })?.state).toBe('live')
  })
})

describe('a page change that was only read', () => {
  const ask = 'Compare the checked revisions and write the next build on this same tile.'

  it('still owes the write', () => {
    expect(pageChangeStillOwed(ask, 'Here are the signatures.', true, false, false))
      .toContain('Write the next build')
  })

  it('is finished once the page is written, skipped, or waiting on the participant', () => {
    expect(pageChangeStillOwed(ask, 'Done.', true, true, false)).toBeNull()
    expect(pageChangeStillOwed(ask, 'Done.', true, false, true)).toBeNull()
    expect(pageChangeStillOwed(ask, 'I will wait for your go-ahead.', true, false, false)).toBeNull()
    expect(pageChangeStillOwed('What does the page say?', 'Tidy Bench.', true, false, false)).toBeNull()
    expect(pageChangeStillOwed(ask, 'Here are the signatures.', false, false, false)).toBeNull()
  })
})
