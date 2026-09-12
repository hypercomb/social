import { describe, expect, it } from 'vitest'
import { STORY_WHEN_DEPTH, storyHolds, storyRefs, type StoryFacts, type StoryWhen } from './story-when.js'
import type { SigilRequirement } from './labyrinth.js'

function facts(overrides: Partial<StoryFacts> = {}): StoryFacts {
  return {
    has: () => false,
    knows: () => false,
    done: () => false,
    ...overrides,
  }
}

describe('storyHolds — the six forms', () => {
  it('undefined always holds', () => {
    expect(storyHolds(undefined, facts())).toBe(true)
  })

  it('has reads exactly journey.has', () => {
    const requirement: SigilRequirement = { kind: 'hexagon' }
    expect(storyHolds({ has: requirement }, facts({ has: r => r.kind === 'hexagon' }))).toBe(true)
    expect(storyHolds({ has: requirement }, facts({ has: () => false }))).toBe(false)
  })

  it('knows reads a knowledge id', () => {
    expect(storyHolds({ knows: 'map-x' }, facts({ knows: id => id === 'map-x' }))).toBe(true)
    expect(storyHolds({ knows: 'map-x' }, facts({ knows: () => false }))).toBe(false)
  })

  it('done reads a fact ref', () => {
    expect(storyHolds({ done: 'island/cache:a' }, facts({ done: ref => ref === 'island/cache:a' }))).toBe(true)
    expect(storyHolds({ done: 'island/cache:a' }, facts({ done: () => false }))).toBe(false)
  })

  it('all is every child, true for an empty list', () => {
    expect(storyHolds({ all: [{ knows: 'a' }, { knows: 'b' }] }, facts({ knows: id => id === 'a' || id === 'b' }))).toBe(true)
    expect(storyHolds({ all: [{ knows: 'a' }, { knows: 'b' }] }, facts({ knows: id => id === 'a' }))).toBe(false)
    expect(storyHolds({ all: [] }, facts())).toBe(true)
  })

  it('any is some child, false for an empty list', () => {
    expect(storyHolds({ any: [{ knows: 'a' }, { knows: 'b' }] }, facts({ knows: id => id === 'b' }))).toBe(true)
    expect(storyHolds({ any: [{ knows: 'a' }, { knows: 'b' }] }, facts({ knows: () => false }))).toBe(false)
    expect(storyHolds({ any: [] }, facts())).toBe(false)
  })

  it('not inverts its child', () => {
    expect(storyHolds({ not: { knows: 'a' } }, facts({ knows: () => false }))).toBe(true)
    expect(storyHolds({ not: { knows: 'a' } }, facts({ knows: () => true }))).toBe(false)
  })

  it('nests every form together', () => {
    const when: StoryWhen = { all: [{ any: [{ knows: 'a' }, { done: 'x' }] }, { not: { has: { kind: 'star' } } }] }
    expect(storyHolds(when, facts({ knows: id => id === 'a', has: () => false }))).toBe(true)
    expect(storyHolds(when, facts({ knows: () => false, done: () => false, has: () => false }))).toBe(false)
    expect(storyHolds(when, facts({ knows: id => id === 'a', has: () => true }))).toBe(false)
  })
})

describe('storyHolds — never throws', () => {
  it('a malformed node is false', () => {
    expect(storyHolds({} as StoryWhen, facts())).toBe(false)
    expect(storyHolds('nonsense' as unknown as StoryWhen, facts())).toBe(false)
    expect(storyHolds(null as unknown as StoryWhen, facts())).toBe(false)
    expect(storyHolds({ all: 'nope' } as unknown as StoryWhen, facts())).toBe(false)
  })

  it('an unknown key is false', () => {
    expect(storyHolds({ mystery: true } as unknown as StoryWhen, facts())).toBe(false)
  })

  it('a facts implementation that throws still returns false, never escapes', () => {
    const angry = facts({ knows: () => { throw new Error('boom') } })
    expect(storyHolds({ knows: 'a' }, angry)).toBe(false)
  })

  it(`depth beyond ${STORY_WHEN_DEPTH} is false; within it still holds`, () => {
    expect(STORY_WHEN_DEPTH).toBe(8)
    // 8 `all` wrappers put the leaf at depth 8 (the outermost wrapper is depth 0) — still fine.
    let ok: StoryWhen = { knows: 'deep' }
    for (let i = 0; i < STORY_WHEN_DEPTH; i++) ok = { all: [ok] }
    expect(storyHolds(ok, facts({ knows: () => true }))).toBe(true)

    // One wrapper more puts the leaf at depth 9 — past the limit.
    let tooDeep: StoryWhen = { knows: 'deep' }
    for (let i = 0; i < STORY_WHEN_DEPTH + 1; i++) tooDeep = { all: [tooDeep] }
    expect(storyHolds(tooDeep, facts({ knows: () => true }))).toBe(false)
  })
})

describe('storyRefs', () => {
  it('collects every knows and done ref, in any position', () => {
    const when: StoryWhen = {
      all: [
        { knows: 'a' },
        { any: [{ done: 'x' }, { not: { knows: 'b' } }] },
        { not: { done: 'y' } },
      ],
    }
    expect(storyRefs(when)).toEqual({ knows: ['a', 'b'], done: ['x', 'y'] })
  })

  it('is empty for undefined or a leafless node', () => {
    expect(storyRefs(undefined)).toEqual({ knows: [], done: [] })
    expect(storyRefs({ has: { kind: 'star' } })).toEqual({ knows: [], done: [] })
  })
})
