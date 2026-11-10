import { describe, expect, it } from 'vitest'
import {
  LIFT_VIEW, agoLabel, axialToPixel, clearStaged, compositionWrites, coverFit, flipDeck,
  hexBox, hexCorners, hexUv, layerApply, markDeck, pictureCandidates, reconcileComposition, rollVariant, seatNames,
  shortKey, stageVariant, stagedIndex, variantsFor,
  type DeckCell, type DeckLayer, type DeckSource,
} from './lift-deck.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const L1 = '1'.repeat(64)
const L2 = '2'.repeat(64)
const L3 = '3'.repeat(64)

const cell = (name: string, imageSig?: string, layerSig?: string, q = 0, r = 0): DeckCell =>
  ({ name, q, r, ...(imageSig ? { imageSig } : {}), ...(layerSig ? { layerSig } : {}) })

const layer = (id: string, source: DeckSource, cells: DeckCell[], extra: Partial<DeckLayer> = {}): DeckLayer => ({
  id, source, label: id, cells: new Map(cells.map(c => [c.name, c])), ...extra,
})

describe('lift deck — the view token', () => {
  it('is lift', () => {
    expect(LIFT_VIEW).toBe('lift')
  })
})

describe('markDeck', () => {
  it('marks a tile every layer holds with the same picture as common', () => {
    const deck = [
      layer('current', 'current', [cell('x', A, L1)]),
      layer('history:h', 'history', [cell('x', A, L2)]),
    ]
    expect(markDeck(deck).marks.get('x')).toBe('common')
  })

  it('diffs by NAME, never by layer signature — a sig swap under the same picture is still common', () => {
    const deck = [
      layer('current', 'current', [cell('x', A, L1)]),
      layer('participant:p', 'participant', [cell('x', A, L3)]),
    ]
    expect(markDeck(deck).marks.get('x')).toBe('common')
  })

  it('marks a tile whose picture differs somewhere as changed', () => {
    const deck = [
      layer('current', 'current', [cell('x', A)]),
      layer('history:1', 'history', [cell('x', A)]),
      layer('history:2', 'history', [cell('x', B)]),
    ]
    expect(markDeck(deck).marks.get('x')).toBe('changed')
  })

  it('treats a picture against no picture as changed', () => {
    const deck = [layer('current', 'current', [cell('x', A)]), layer('h', 'history', [cell('x')])]
    expect(markDeck(deck).marks.get('x')).toBe('changed')
  })

  it('marks a tile missing from any layer as partial — including one only a deeper layer holds', () => {
    const deck = [
      layer('current', 'current', [cell('x', A), cell('y', B)]),
      layer('h', 'history', [cell('x', A), cell('z', C)]),
    ]
    const { marks } = markDeck(deck)
    expect(marks.get('x')).toBe('common')
    expect(marks.get('y')).toBe('partial')
    expect(marks.get('z')).toBe('partial')
  })

  it('lists, per layer, the front names that layer lacks (ghosts); the front has none', () => {
    const deck = [
      layer('current', 'current', [cell('x'), cell('y'), cell('w')]),
      layer('p', 'participant', [cell('x')]),
      layer('h', 'history', [cell('x'), cell('y'), cell('w'), cell('extra')]),
    ]
    expect(markDeck(deck).ghosts).toEqual([[], ['y', 'w'], []])
  })

  it('a single layer is all common, and an empty deck is empty', () => {
    expect(markDeck([layer('current', 'current', [cell('x', A)])]).marks.get('x')).toBe('common')
    const empty = markDeck([])
    expect(empty.marks.size).toBe(0)
    expect(empty.ghosts).toEqual([])
  })
})

describe('variantsFor + rollVariant', () => {
  const deck = [
    layer('current', 'current', [cell('x', A, L1)]),
    layer('participant:p', 'participant', [cell('x', B, L2)], { pubkey: 'p' }),
    layer('history:h1', 'history', [cell('x', A, L1)], { at: 10, layerSig: L3 }),
    layer('history:h2', 'history', [cell('x', C, L3)], { at: 5 }),
    layer('history:h3', 'history', [cell('y', C)]),
  ]

  it('orders variants front first and dedupes by picture + tile layer', () => {
    const variants = variantsFor('x', deck)
    expect(variants.map(v => v.layerId)).toEqual(['current', 'participant:p', 'history:h2'])
    expect(variants[1]).toMatchObject({ layerIndex: 1, source: 'participant', pubkey: 'p' })
    expect(variants[2]).toMatchObject({ layerIndex: 3, at: 5 })
  })

  it('is empty for a name no layer holds', () => {
    expect(variantsFor('nope', deck)).toEqual([])
  })

  it('rolls as a ring in both directions', () => {
    const three = [1, 2, 3]
    expect(rollVariant(0, 1, three)).toBe(1)
    expect(rollVariant(2, 1, three)).toBe(0)
    expect(rollVariant(0, -1, three)).toBe(2)
    expect(rollVariant(1, 5, three)).toBe(0)
  })

  it('starts from the front when the current position is out of range, and says -1 when empty', () => {
    expect(rollVariant(9, 1, [1, 2])).toBe(1)
    expect(rollVariant(-1, 0, [1, 2])).toBe(0)
    expect(rollVariant(0, 1, [])).toBe(-1)
  })
})

describe('flipDeck', () => {
  it('clamps at the front and the back', () => {
    expect(flipDeck(0, -1, 4)).toBe(0)
    expect(flipDeck(0, 1, 4)).toBe(1)
    expect(flipDeck(3, 1, 4)).toBe(3)
    expect(flipDeck(1, 10, 4)).toBe(3)
    expect(flipDeck(2, 1, 0)).toBe(0)
  })
})

describe('composition', () => {
  const deck = [
    layer('current', 'current', [cell('x', A, L1), cell('y', A, L1)]),
    layer('participant:p', 'participant', [cell('x', B, L2), cell('y', B)], { pubkey: 'p' }),
    layer('history:h', 'history', [cell('x', C, L3)], { at: 7 }),
  ]

  it('stages a variant, and staging the current version clears it', () => {
    const [current, peer, past] = variantsFor('x', deck)
    let comp = stageVariant(new Map(), 'x', peer!)
    expect(comp.get('x')).toMatchObject({ layerId: 'participant:p', pubkey: 'p', imageSig: B, layerSig: L2 })
    comp = stageVariant(comp, 'x', past!)
    expect(comp.get('x')).toMatchObject({ layerId: 'history:h', source: 'history', at: 7 })
    comp = stageVariant(comp, 'x', current!)
    expect(comp.has('x')).toBe(false)
  })

  it('never mutates the composition it was given', () => {
    const before = new Map()
    stageVariant(before, 'x', variantsFor('x', deck)[1]!)
    expect(before.size).toBe(0)
  })

  it('clears one name or everything', () => {
    let comp = stageVariant(new Map(), 'x', variantsFor('x', deck)[1]!)
    comp = stageVariant(comp, 'y', variantsFor('y', deck)[1]!)
    expect(clearStaged(comp, 'x').has('x')).toBe(false)
    expect(clearStaged(comp, 'x').has('y')).toBe(true)
    expect(clearStaged(comp).size).toBe(0)
    expect(clearStaged(comp, 'absent')).toBe(comp)
  })

  it('reconciles against a rebuilt deck: a vanished layer or a moved version drops the staging', () => {
    let comp = stageVariant(new Map(), 'x', variantsFor('x', deck)[1]!)
    comp = stageVariant(comp, 'y', variantsFor('y', deck)[1]!)
    expect(reconcileComposition(comp, deck)).toBe(comp)

    const moved = [deck[0]!, layer('participant:p', 'participant', [cell('x', C, L2), cell('y', B)], { pubkey: 'p' })]
    expect([...reconcileComposition(comp, moved).keys()]).toEqual(['y'])

    expect(reconcileComposition(comp, [deck[0]!]).size).toBe(0)
  })

  it('finds the staged variant among the variants, front when none', () => {
    const variants = variantsFor('x', deck)
    const comp = stageVariant(new Map(), 'x', variants[2]!)
    expect(stagedIndex(comp.get('x'), variants)).toBe(2)
    expect(stagedIndex(undefined, variants)).toBe(0)
    expect(stagedIndex({ layerId: 'gone', source: 'history' }, variants)).toBe(0)
  })

  it('plans adopt for a participant variant and promote for a history one, skipping sig-less parts', () => {
    let comp = stageVariant(new Map(), 'y', variantsFor('y', deck)[1]!)   // no layerSig
    comp = stageVariant(comp, 'x', variantsFor('x', deck)[1]!)
    expect(compositionWrites(comp)).toEqual([{ kind: 'adopt', name: 'x', pubkey: 'p', layerSig: L2 }])
    comp = stageVariant(comp, 'x', variantsFor('x', deck)[2]!)
    expect(compositionWrites(comp)).toEqual([{ kind: 'promote', name: 'x', layerSig: L3 }])
  })
})

describe('layerApply', () => {
  it('spotlights a participant, promotes a history layer, and asks nothing of the current one', () => {
    expect(layerApply(layer('current', 'current', []))).toEqual({ kind: 'none' })
    expect(layerApply(layer('participant:p', 'participant', [], { pubkey: 'p' }))).toEqual({ kind: 'spotlight', pubkey: 'p' })
    expect(layerApply(layer('history:h', 'history', [], { layerSig: L1 }))).toEqual({ kind: 'promote', layerSig: L1 })
    expect(layerApply(layer('history:h', 'history', []))).toEqual({ kind: 'none' })
    expect(layerApply(undefined)).toEqual({ kind: 'none' })
  })
})

describe('seatNames', () => {
  it('takes the page order first, then the legacy index, then the next free seat', () => {
    const seats = seatNames(['a', 'b', 'c', 'd'], new Map([['b', 0]]), new Map([['c', 2]]))
    expect(Object.fromEntries(seats)).toEqual({ b: 0, c: 2, a: 1, d: 3 })
  })

  it('never seats two names on one slot', () => {
    const seats = seatNames(['a', 'b'], new Map([['a', 0], ['b', 0]]))
    expect(new Set(seats.values()).size).toBe(2)
    expect(seats.get('a')).toBe(0)
  })
})

describe('geometry', () => {
  it('maps axial to the same pixel centres show-cell draws, point-top and flat-top', () => {
    expect(axialToPixel(0, 0, 38)).toEqual({ x: 0, y: 0 })
    const p = axialToPixel(1, 0, 38)
    expect(p.x).toBeCloseTo(Math.sqrt(3) * 38)
    expect(p.y).toBe(0)
    const pr = axialToPixel(0, 1, 38)
    expect(pr.x).toBeCloseTo(Math.sqrt(3) * 38 / 2)
    expect(pr.y).toBeCloseTo(57)
    const f = axialToPixel(1, 0, 38, true)
    expect(f.x).toBeCloseTo(57)
    expect(f.y).toBeCloseTo(Math.sqrt(3) * 38 / 2)
  })

  it('neighbouring centres sit √3·spacing apart in both orientations', () => {
    for (const flat of [false, true]) {
      const a = axialToPixel(0, 0, 10, flat)
      for (const [q, r] of [[1, 0], [0, 1], [-1, 1]] as const) {
        const b = axialToPixel(q, r, 10, flat)
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.sqrt(3) * 10)
      }
    }
  })

  it('draws point-top with a corner up and flat-top with a corner right', () => {
    const point = hexCorners(10)
    expect(point[0]!.x).toBeCloseTo(0)
    expect(point[0]!.y).toBeCloseTo(10)
    const flat = hexCorners(10, true)
    expect(flat[0]!.x).toBeCloseTo(10)
    expect(flat[0]!.y).toBeCloseTo(0)
  })

  it('maps the hexagon into the unit square of its own bounding box (the hex capture box)', () => {
    for (const flat of [false, true]) {
      const corners = hexCorners(10, flat).map(c => hexUv(c.x, c.y, 10, flat))
      const us = corners.map(c => c.u)
      const vs = corners.map(c => c.v)
      expect(Math.min(...us)).toBeCloseTo(0)
      expect(Math.max(...us)).toBeCloseTo(1)
      expect(Math.min(...vs)).toBeCloseTo(0)
      expect(Math.max(...vs)).toBeCloseTo(1)
    }
    expect(hexBox(10)).toEqual({ width: Math.sqrt(3) * 10, height: 20 })
  })

  it('cover-fits: a capture at the box aspect spans the whole texture, a square one is cropped centred', () => {
    const box = hexBox(10)
    const exact = coverFit(box.width / box.height, 10)
    expect(exact.repeat.u).toBeCloseTo(1)
    expect(exact.repeat.v).toBeCloseTo(1)
    const square = coverFit(1, 10)   // wider than the point-top box → crop the sides
    expect(square.repeat.v).toBeCloseTo(1)
    expect(square.repeat.u).toBeCloseTo(Math.sqrt(3) / 2)
    expect(square.offset.u).toBeCloseTo((1 - Math.sqrt(3) / 2) / 2)
    const tall = coverFit(0.5, 10)
    expect(tall.repeat.u).toBeCloseTo(1)
    expect(tall.repeat.v).toBeLessThan(1)
    expect(coverFit(NaN, 10).repeat.u).toBeCloseTo(1)
  })
})

describe('pictureCandidates', () => {
  it('walks hex capture, other capture, large, legacy — so a tile missing small.image still shows large.image', () => {
    const props = { small: { image: A }, flat: { small: { image: B } }, large: { image: C }, imageSig: L1 }
    expect(pictureCandidates(props)).toEqual([A, B, C, L1])
    expect(pictureCandidates(props, true)).toEqual([B, A, C, L1])
    expect(pictureCandidates({ large: { image: C } })).toEqual([C])
    expect(pictureCandidates({ small: { image: 'not-a-sig' }, imageSig: C })).toEqual([C])
  })

  it('dedupes and survives nothing', () => {
    expect(pictureCandidates({ small: { image: A }, large: { image: A } })).toEqual([A])
    expect(pictureCandidates(undefined)).toEqual([])
    expect(pictureCandidates({})).toEqual([])
  })
})

describe('words', () => {
  it('says how long ago, coarsely', () => {
    const now = 10_000_000
    expect(agoLabel(now - 5_000, now)).toBe('just now')
    expect(agoLabel(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(agoLabel(now - 2 * 3_600_000, now)).toBe('2 h ago')
    expect(agoLabel(now - 3 * 86_400_000, now)).toBe('3 d ago')
    expect(agoLabel(now + 5_000, now)).toBe('just now')
  })

  it('shortens a long key and leaves a short one', () => {
    expect(shortKey('abcdef0123456789abcd')).toBe('abcdef…abcd')
    expect(shortKey('short')).toBe('short')
  })
})
