import { describe, expect, it } from 'vitest'
import {
  mergePreloadStamp,
  preloadPassCompleted,
  preloadStampSatisfies,
  remainingAncestorPreloadDepth,
  takePreloadBreadthSlice,
} from './preload-policy.js'

describe('preload depth completion', () => {
  it('does not let a shallow ancestor warm satisfy a deeper navigation warm', () => {
    const shallow = mergePreloadStamp(undefined, 1, 7)

    expect(preloadStampSatisfies(shallow, 1, 7)).toBe(true)
    expect(preloadStampSatisfies(shallow, 3, 7)).toBe(false)
  })

  it('keeps the deepest completion in one epoch and invalidates it in the next', () => {
    const deep = mergePreloadStamp({ depth: 3, epoch: 7 }, 1, 7)
    expect(deep).toEqual({ depth: 3, epoch: 7 })
    expect(preloadStampSatisfies(deep, 3, 8)).toBe(false)

    expect(mergePreloadStamp(deep, 1, 8)).toEqual({ depth: 1, epoch: 8 })
  })

  it('does not stamp a capped, incomplete, navigated, or invalidated pass', () => {
    const complete = {
      frontierRemaining: 0,
      incomplete: false,
      generationAtStart: 4,
      generationNow: 4,
      epochAtStart: 9,
      epochNow: 9,
    }
    expect(preloadPassCompleted(complete)).toBe(true)
    expect(preloadPassCompleted({ ...complete, frontierRemaining: 1 })).toBe(false)
    expect(preloadPassCompleted({ ...complete, incomplete: true })).toBe(false)
    expect(preloadPassCompleted({ ...complete, generationNow: 5 })).toBe(false)
    expect(preloadPassCompleted({ ...complete, epochNow: 10 })).toBe(false)
  })
})

describe('preload radius and queue order', () => {
  it('spends radius going up, then expands sideways with what remains', () => {
    expect([1, 2, 3].map(up => remainingAncestorPreloadDepth(3, up))).toEqual([3, 2, 1])
  })

  it('finishes every sibling depth before a hot deeper path', () => {
    const frontier = [
      { name: 'hot-grandchild', depth: 2, score: 1_000 },
      { name: 'cold-sibling', depth: 1, score: 0 },
      { name: 'hot-sibling', depth: 1, score: 10 },
      { name: 'root', depth: 0, score: 0 },
    ]

    expect(takePreloadBreadthSlice(frontier, 12).map(node => node.name)).toEqual(['root'])
    expect(takePreloadBreadthSlice(frontier, 1).map(node => node.name)).toEqual(['hot-sibling'])
    expect(takePreloadBreadthSlice(frontier, 12).map(node => node.name)).toEqual(['cold-sibling'])
    expect(takePreloadBreadthSlice(frontier, 12).map(node => node.name)).toEqual(['hot-grandchild'])
  })
})
