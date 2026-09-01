// spoken-habits.spec.ts — the line learns the words you actually use.
//
// Readings are built by the REAL reader (readUtterance) against a small
// lexicon, so these tests exercise the same span roles the running command
// line produces — a habit learned here is a habit learned there.

import { beforeEach, describe, expect, it } from 'vitest'
import { readUtterance } from './utterance-reading.js'
import { SpokenHabits } from './spoken-habits.js'

const LEXICON = [
  { name: 'providers', description: 'Manage AI providers' },
  { name: 'fit', description: 'Fit the view' },
  { name: 'spotlight', description: 'Light a tile up' },
]

const read = (text: string) => readUtterance(text, LEXICON)

/** A fresh store over a clean localStorage — construction loads from it. */
const fresh = (): SpokenHabits => {
  localStorage.clear()
  return new SpokenHabits()
}

describe('SpokenHabits', () => {
  beforeEach(() => {
    localStorage.clear()
    // A pool fake installed by one test must never be inherited by the next —
    // the device-local cases have to run with no Store at all.
    delete (window as unknown as { ioc?: unknown }).ioc
  })

  it('learns the lead-in that carried an action', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.phrasings('open ').map(p => p.phrasing)).toEqual(['open providers'])
  })

  it('offers the phrasing while it is being typed, not just after the space', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.phrasings('open p').map(p => p.phrasing)).toEqual(['open providers'])
  })

  it('says which behaviour a phrasing reaches', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.phrasings('open ')[0].command).toBe('providers')
  })

  it('stays silent on a bare word — that is the census, not habit', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.phrasings('open')).toEqual([])
    expect(habits.phrasings('prov')).toEqual([])
  })

  it('never learns a connective as a lead-in', () => {
    const habits = fresh()
    // 'and' is residue directly before 'fit' — true of the sentence, useless
    // as a habit, and it must not become one.
    habits.learn(read('spotlight the snacks and fit'))
    expect(habits.phrasings('and ')).toEqual([])
  })

  it('still counts the run of an action that had no lead-in', () => {
    const habits = fresh()
    habits.learn(read('spotlight the snacks and fit'))
    expect(habits.useCount('spotlight')).toBe(1)
    expect(habits.useCount('fit')).toBe(1)
  })

  it('ranks the phrasing you use more often first', () => {
    const habits = fresh()
    habits.learn(read('show providers'))
    habits.learn(read('show fit'))
    habits.learn(read('show fit'))
    expect(habits.phrasings('show ').map(p => p.phrasing)).toEqual(['show fit', 'show providers'])
  })

  it('counts repeats of one phrasing rather than duplicating it', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    habits.learn(read('open providers'))
    const found = habits.phrasings('open ')
    expect(found).toHaveLength(1)
    expect(found[0].count).toBe(2)
  })

  it('an unrun behaviour has no weight', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.useCount('providers')).toBe(1)
    expect(habits.useCount('spotlight')).toBe(0)
  })

  it('survives a reload — a habit is remembered', () => {
    const first = fresh()
    first.learn(read('open providers'))
    const second = new SpokenHabits()
    expect(second.phrasings('open ').map(p => p.phrasing)).toEqual(['open providers'])
  })

  it('offers a discovered word while the line is still one word', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.leadInCompletions('op').map(w => w.leadIn)).toEqual(['open'])
    expect(habits.leadInCompletions('op')[0].command).toBe('providers')
  })

  it('offers a word typed out in full — the space is still to come', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.leadInCompletions('open').map(w => w.leadIn)).toEqual(['open'])
  })

  it('offers one row per word, weighted by every ending it carries', () => {
    const habits = fresh()
    habits.learn(read('show providers'))
    habits.learn(read('show fit'))
    habits.learn(read('show fit'))
    const rows = habits.leadInCompletions('sh')
    expect(rows.map(w => w.leadIn)).toEqual(['show'])
    expect(rows[0].count).toBe(3)
    // The row names the ending it reaches most, not the first one learned.
    expect(rows[0].command).toBe('fit')
  })

  it('ranks discovered words by how often they were said', () => {
    const habits = fresh()
    habits.learn(read('show providers'))
    habits.learn(read('spotlight the snacks'))   // no action after — teaches nothing
    habits.learn(read('so providers'))
    habits.learn(read('so providers'))
    expect(habits.leadInCompletions('s').map(w => w.leadIn)).toEqual(['so', 'show'])
  })

  it('says nothing about a word once the line is a sentence', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    // Past the first space the phrasings answer; a word row there would
    // offer the lead-in the participant has already finished typing.
    expect(habits.leadInCompletions('open ')).toEqual([])
  })

  it('says nothing on a blank line — that is the catalogue, not habit', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    expect(habits.leadInCompletions('')).toEqual([])
  })

  it('drops a discovered word when its lead-in is forgotten', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    habits.forget('open')
    expect(habits.leadInCompletions('op')).toEqual([])
  })

  it('lists its lead-ins, best first', () => {
    const habits = fresh()
    habits.learn(read('show providers'))
    habits.learn(read('bring up fit'))
    habits.learn(read('bring up fit'))
    expect(habits.leadIns()).toEqual(['bring up', 'show'])
  })

  it('forgets one lead-in and leaves the rest', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    habits.learn(read('show fit'))
    expect(habits.forget('open')).toBe(1)
    expect(habits.phrasings('open ')).toEqual([])
    expect(habits.phrasings('show ').map(p => p.phrasing)).toEqual(['show fit'])
  })

  it('forgetting everything drops the use weights too', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    habits.forget()
    expect(habits.phrasings('open ')).toEqual([])
    expect(habits.useCount('providers')).toBe(0)
  })

  it('a reading that ran nothing teaches nothing', () => {
    const habits = fresh()
    habits.learn(read('zzz nothing matches at all'))
    expect(habits.leadIns()).toEqual([])
  })

  it('treats spacing as insignificant — one lead-in, not two', () => {
    const habits = fresh()
    habits.learn(read('open providers'))
    habits.learn(read('open    providers'))
    expect(habits.phrasings('open ')).toHaveLength(1)
  })

  // ── pruning one row ──────────────────────────────────────
  // A lead-in can carry several endings, so emptying the lead-in is too blunt
  // to be the only cure for one bad guess. Shift+Delete lands here.

  it('prunes a single phrasing and leaves its siblings', () => {
    const habits = fresh()
    habits.learn(read('show providers'))
    habits.learn(read('show fit'))
    expect(habits.forgetPhrasing('show fit')).toBe(true)
    expect(habits.phrasings('show ').map(p => p.phrasing)).toEqual(['show providers'])
  })

  it('reports when there was nothing to prune', () => {
    const habits = fresh()
    habits.learn(read('show fit'))
    expect(habits.forgetPhrasing('show providers')).toBe(false)
    expect(habits.phrasings('show ')).toHaveLength(1)
  })

  // ── travelling with the participant ──────────────────────
  // The pool is the truth and localStorage is a boot cache. Merging is by max
  // on both sides, so two machines converge instead of erasing each other.

  /** A Store that keeps one pool doc in memory, registered where the store
   *  looks for it. Mirrors getPool/getPoolDoc/putPoolDoc only. */
  const withPool = (initial?: unknown) => {
    let doc: ArrayBuffer | null = initial === undefined
      ? null
      : new TextEncoder().encode(JSON.stringify(initial)).buffer
    const pool = {} as FileSystemDirectoryHandle
    const w = window as unknown as { ioc?: { get?: (k: string) => unknown } }
    w.ioc = {
      get: (k: string) => k === '@hypercomb.social/Store' ? {
        getPool: async () => pool,
        getPoolDoc: async () => doc,
        putPoolDoc: async (_p: unknown, bytes: ArrayBuffer) => { doc = bytes; return 'sig' },
      } : undefined,
    }
    return { read: () => doc && JSON.parse(new TextDecoder().decode(doc)) }
  }

  it('folds the pooled habits of another machine in', async () => {
    withPool({ habits: [{ leadIn: 'bring up', command: 'fit', count: 3, at: 100 }], uses: {} })
    const habits = fresh()
    habits.learn(read('open providers'))
    await habits.hydrate()
    expect(habits.phrasings('bring up ').map(p => p.phrasing)).toEqual(['bring up fit'])
    expect(habits.phrasings('open ').map(p => p.phrasing)).toEqual(['open providers'])
  })

  it('takes the higher count when both machines know the phrasing', async () => {
    withPool({ habits: [{ leadIn: 'open', command: 'providers', count: 9, at: 100 }], uses: {} })
    const habits = fresh()
    habits.learn(read('open providers'))          // local count 1
    await habits.hydrate()
    expect(habits.phrasings('open ')[0].count).toBe(9)
  })

  it('hydrating twice changes nothing — the merge is idempotent', async () => {
    withPool({ habits: [{ leadIn: 'open', command: 'providers', count: 2, at: 100 }], uses: {} })
    const habits = fresh()
    await habits.hydrate()
    await habits.hydrate()
    const found = habits.phrasings('open ')
    expect(found).toHaveLength(1)
    expect(found[0].count).toBe(2)
  })

  it('pushes what this machine learned back to the pool', async () => {
    const pool = withPool({ habits: [], uses: {} })
    const habits = fresh()
    await habits.hydrate()
    habits.learn(read('open providers'))
    await habits.flush()
    const written = pool.read() as { habits: { leadIn: string; command: string }[] }
    expect(written.habits).toContainEqual(expect.objectContaining({ leadIn: 'open', command: 'providers' }))
  })

  it('an unreadable pool costs the travel, never the habits', async () => {
    const w = window as unknown as { ioc?: { get?: (k: string) => unknown } }
    w.ioc = { get: () => ({ getPool: async () => { throw new Error('no root') } }) }
    const habits = fresh()
    habits.learn(read('open providers'))
    await habits.hydrate()
    expect(habits.phrasings('open ').map(p => p.phrasing)).toEqual(['open providers'])
  })
})
