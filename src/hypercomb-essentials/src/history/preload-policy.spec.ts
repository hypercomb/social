import { describe, expect, it } from 'vitest'
import {
  PRELOAD_CODE_DEPTH,
  faceDepthFor,
  facesOf,
  mergePreloadStamp,
  preloadPassCompleted,
  preloadStampSatisfies,
  readCodeDepth,
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

describe('code is more hops of the same walk — tile faces within reach', () => {
  it('reads the code radius a browser asked for, else the default', () => {
    expect([0, 1, 2].map(n => readCodeDepth(String(n)))).toEqual([0, 1, 2])
    for (const raw of [null, undefined, '', '3', '-1', '1.5', 'deep']) expect(readCodeDepth(raw)).toBe(PRELOAD_CODE_DEPTH)
  })

  it('spends the radius going up, and 0 turns code off', () => {
    expect(faceDepthFor(1)).toBe(1)
    expect(faceDepthFor(2, 1)).toBe(1)
    expect(faceDepthFor(1, 1)).toBe(0)
    expect(faceDepthFor(1, 2)).toBe(-1)
    expect(faceDepthFor(0)).toBe(-1)
  })

  it('a pass that warmed fewer faces never answers for a deeper face request', () => {
    const tilesOnly = mergePreloadStamp(undefined, 3, 7)
    expect(tilesOnly).toEqual({ depth: 3, epoch: 7 })
    expect(preloadStampSatisfies(tilesOnly, 3, 7)).toBe(true)
    expect(preloadStampSatisfies(tilesOnly, 3, 7, 1)).toBe(false)
    const withFaces = mergePreloadStamp(tilesOnly, 1, 7, 1)
    expect(withFaces).toEqual({ depth: 3, epoch: 7, faceDepth: 1 })
    expect(preloadStampSatisfies(withFaces, 3, 7, 1)).toBe(true)
    expect(preloadStampSatisfies(withFaces, 3, 7, 2)).toBe(false)
    expect(preloadStampSatisfies(mergePreloadStamp(withFaces, 3, 8), 3, 8, 1)).toBe(false)
  })

  it('finds the faces a tile wears that a view can warm — slots and records, one per view and payload', () => {
    const warm = async (): Promise<boolean> => true
    const owners = [
      { view: 'tutor', slot: 'tutor', decorationKind: 'visual:tutor:deck', prefetch: warm },
      { view: 'game', decorationKind: 'game', alsoKinds: ['game-play'], prefetch: warm },
      { view: 'website', decorationKind: 'website' },
    ]
    const records = [
      { kind: 'game', payload: { gameId: 'solomon' } },
      { kind: 'game-play', payload: { gameId: 'solomon' } },
      { kind: 'game', payload: { gameId: 'arkanoid' } },
      { kind: 'website', payload: {} },
    ]
    const faces = facesOf({ tutor: ['a'.repeat(64)] }, records, owners)
    expect(faces.map(face => face.key)).toEqual([
      'tutor',
      'game\u0000{"gameId":"solomon"}',
      'game\u0000{"gameId":"arkanoid"}',
    ])
    expect(facesOf({ tutor: [] }, [], owners)).toEqual([])
  })

  it('every tile of a pass warms before any face: a face waits one ring past the last tile', () => {
    const frontier = [
      { name: 'face', depth: 3, score: 99 },
      { name: 'grandchild', depth: 2, score: -4 },
    ]
    expect(takePreloadBreadthSlice(frontier, 12).map(node => node.name)).toEqual(['grandchild'])
    expect(takePreloadBreadthSlice(frontier, 12).map(node => node.name)).toEqual(['face'])
  })
})
