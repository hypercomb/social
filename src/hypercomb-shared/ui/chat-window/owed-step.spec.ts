// owed-step.spec.ts — WHAT A LEG'S END LEAVES OWED (documentation/conversation-continuity.md).

import { describe, expect, it } from 'vitest'
import { OWED_BACKOFF_MS, owedAfter, owedCue, type OwedLike } from './owed-step'

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
    expect(owedCue(record({ state: 'waiting', why: 'stalled' }), 0)?.fallback).toContain('Say "continue" to carry it on')
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
