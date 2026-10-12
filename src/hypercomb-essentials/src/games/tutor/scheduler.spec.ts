// games/tutor/scheduler.spec.ts
//
// Progress keeps only what scheduling needs — box, ease, due — and nothing
// that counts or dates what the learner did (we collect no statistics).

import { beforeEach, describe, expect, it } from 'vitest'
import { TutorScheduler } from './scheduler.js'
import type { StudyItem } from './deck.types.js'

const item = (id: string, sourceCell: string): StudyItem => ({
  id, prompt: `prompt ${id}`, answer: `answer ${id}`, tags: [], sourceSegments: [], sourceCell,
})
const ITEMS = [item('a', 'one'), item('b', 'two'), item('c', 'one')]
const KEY = 'hc:tutor:progress:deck'
const stored = (): Record<string, Record<string, number>> => JSON.parse(localStorage.getItem(KEY) ?? '{}')

describe('tutor progress', () => {
  beforeEach(() => localStorage.removeItem(KEY))

  it('stores box, ease and due — nothing else', () => {
    const scheduler = new TutorScheduler(ITEMS, 'deck')
    scheduler.record('a', 'good')
    scheduler.record('b', 'again')
    for (const state of Object.values(stored())) expect(Object.keys(state).sort()).toEqual(['box', 'due', 'ease'])
    expect(stored()['a'].box).toBe(1)
    expect(stored()['b'].box).toBe(0)
    expect(stored()['a'].due).toBeGreaterThan(Date.now())
  })

  it('drops the counts and dates an older record carried, and still schedules from it', () => {
    localStorage.setItem(KEY, JSON.stringify({
      a: { box: 3, ease: 2.5, due: Date.now() + 86_400_000, reps: 9, lapses: 2, last: 1 },
    }))
    const scheduler = new TutorScheduler(ITEMS, 'deck')
    expect(scheduler.stageOf(ITEMS[0])).toBe('review')
    // `a` is not due; `b` and `c` are new — so the next item is not `a`.
    expect(scheduler.next()?.id).not.toBe('a')
    scheduler.record('b', 'good')
    expect(Object.keys(stored()['a']).sort()).toEqual(['box', 'due', 'ease'])
  })

  it('serves the weakest due item first, and a tie keeps the deck order', () => {
    const scheduler = new TutorScheduler(ITEMS, 'deck')
    expect(scheduler.next()?.id).toBe('a')
  })
})
