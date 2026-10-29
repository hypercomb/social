// stall-pickup.spec.ts — a stalled chat is picked up from what it still owes,
// and a question, a budget, or a manager's ask is left where it is. A hold
// is unfinished work, so it is picked up. Open steps stay owed.

import { describe, expect, it } from 'vitest'
import {
  STALL_OPEN_BACKOFF_MS, STALL_OPEN_PICKUPS_MAX, STALL_PICKUP_BACKOFF_MS, openWorkLeft, stallPickup, unstickLeft, type StallChat, type StallOwed,
} from './stall-pickup'

const spent = { rounds: 6, tokens: 12_000, legs: 2 }
const budget = { rounds: 400, tokens: 6_000_000 }
const stalled = (over: Partial<StallOwed> = {}): StallOwed => ({
  state: 'waiting', why: 'stalled', left: 'update the other tiles', asker: undefined,
  spent, pickups: 0, next: 0, ...over,
})
const chat = (over: Partial<StallChat> = {}): StallChat => ({ asking: false, quiet: true, budget, ...over })

describe('a stalled conversation', () => {
  it('is picked up from what is still open, by a different step', () => {
    const patch = stallPickup(chat({ owed: stalled() }), 1_000)
    expect(patch).toMatchObject({
      state: 'continue', why: 'unstick', pickups: 1, next: 0, idleLegs: 0, promises: 0, spent,
    })
    expect(patch?.left).toBe(unstickLeft('update the other tiles', 1))
    expect(patch?.left).toContain('Still open: update the other tiles')
    expect(patch?.left).not.toBe('update the other tiles')
  })

  it('waits longer on the next pickup and says which approach stalled', () => {
    const patch = stallPickup(chat({ owed: stalled({ pickups: 1, left: 'the notes' }) }), 5_000)
    expect(patch).toMatchObject({ pickups: 2, next: 5_000 + STALL_PICKUP_BACKOFF_MS[1] })
    expect(patch?.left).toContain('Approach 1 stalled as well')
    expect(patch?.left).toContain('Still open: the notes')
  })

  it('pauses when the request budget is already spent', () => {
    const patch = stallPickup(chat({ owed: stalled({ spent: { rounds: 400, tokens: 10, legs: 9 } }) }), 1)
    expect(patch).toMatchObject({ state: 'paused', why: 'budget' })
  })

  it('picks up a hold, because the leg ended without recording the rest', () => {
    const patch = stallPickup(chat({ owed: stalled({ why: 'held', left: '' }) }), 1_000)
    expect(patch).toMatchObject({ state: 'continue', why: 'unstick', pickups: 1, next: 0 })
    expect(patch?.left).toContain('Still open:')
  })

  it('leaves a question, a give-up, an interruption, a pause, and a manager ask', () => {
    expect(stallPickup(chat({ owed: stalled({ why: 'question' }) }), 1)).toBeNull()
    expect(stallPickup(chat({ owed: stalled({ why: 'gave-up' }) }), 1)).toBeNull()
    expect(stallPickup(chat({ owed: stalled({ why: 'interrupted' }) }), 1)).toBeNull()
    expect(stallPickup(chat({ owed: stalled({ state: 'paused', why: 'budget' }) }), 1)).toBeNull()
    expect(stallPickup(chat({ owed: stalled({ asker: 'manager:harness' }) }), 1)).toBeNull()
    expect(stallPickup(chat({ asking: true, owed: stalled() }), 1)).toBeNull()
  })

  it('leaves a continue record for the window to send', () => {
    expect(stallPickup(chat({ owed: stalled({ state: 'continue', why: 'handover' }) }), 1)).toBeNull()
  })
})

describe('a quiet chat whose workflow still has open steps', () => {
  const open = { current: true, titles: ['a new viewable link', 'the hours section'], picked: 0 }

  it('picks up the open steps when nothing else is owed', () => {
    const patch = stallPickup(chat({ open }), 1)
    expect(patch).toMatchObject({ state: 'continue', why: 'unstick', pickups: 1, next: 0 })
    expect(patch?.left).toBe(openWorkLeft(open.titles))
  })

  it('waits while the reply is fresh or the flow is behind', () => {
    expect(stallPickup(chat({ quiet: false, open }), 1)).toBeNull()
    expect(stallPickup(chat({ open: { ...open, current: false } }), 1)).toBeNull()
    expect(stallPickup(chat({ open: { ...open, titles: [] } }), 1)).toBeNull()
  })

  it('keeps picking up the same open steps, and the later pass writes instead of reading', () => {
    const patch = stallPickup(chat({ open: { ...open, picked: STALL_OPEN_PICKUPS_MAX } }), 5_000)
    expect(patch).toMatchObject({
      state: 'continue', why: 'unstick', pickups: STALL_OPEN_PICKUPS_MAX + 1,
      next: 5_000 + STALL_OPEN_BACKOFF_MS[STALL_OPEN_BACKOFF_MS.length - 1],
    })
    expect(patch?.left).toContain('Open step for the agent: a new viewable link')
    expect(patch?.left).toContain('Write the change on this same tile')
    expect(patch?.left).toContain('Do not read the same signatures')
    expect(patch?.left).not.toContain('Do one concrete thing')
  })

  it('leaves open steps alone while a stall, a question, or a continue is already recorded', () => {
    expect(stallPickup(chat({ owed: stalled(), open }), 1)?.why).toBe('unstick')
    expect(stallPickup(chat({ owed: stalled({ why: 'question' }), open }), 1)).toBeNull()
    expect(stallPickup(chat({ owed: stalled({ state: 'continue', why: 'handover' }), open }), 1)).toBeNull()
  })
})
