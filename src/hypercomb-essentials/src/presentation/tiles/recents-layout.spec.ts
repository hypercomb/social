// recents-layout.spec.ts — newest at the centre, hidden further out, every atom
// reachable by paging, and a click that knows an unlisted atom cannot be walked to.

import { describe, expect, it } from 'vitest'
import {
  RECENTS_WINDOW, clampPage, filterAtoms, layoutPage, litBeforeHidden, recentsClickPlan, ringSlots,
} from './recents-layout'

const atom = (label: string, hidden = false) => ({ label, hidden, path: ['page', label] })
const ringOf = (s: { q: number; r: number }): number => Math.max(Math.abs(s.q), Math.abs(s.r), Math.abs(s.q + s.r))

describe('ringSlots', () => {
  it('starts at the centre and fills each ring before the next', () => {
    const rings = ringSlots(19).map(ringOf)
    expect(rings).toEqual([0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
  })

  it('never repeats a hex, across a whole window', () => {
    const slots = ringSlots(RECENTS_WINDOW)
    expect(slots).toHaveLength(RECENTS_WINDOW)
    expect(new Set(slots.map(s => `${s.q},${s.r}`)).size).toBe(RECENTS_WINDOW)
    expect(Math.max(...slots.map(ringOf))).toBe(6)
  })

  it('answers nothing for nothing', () => {
    expect(ringSlots(0)).toEqual([])
  })
})

describe('layoutPage', () => {
  it('puts the newest at the centre and older atoms further out', () => {
    const laid = layoutPage([atom('newest'), atom('next'), atom('oldest')], 0)
    expect(laid[0]).toEqual({ atom: atom('newest'), slot: { q: 0, r: 0 } })
    expect(ringOf(laid[2]!.slot)).toBe(1)
  })

  it('puts a hidden atom after every lit atom, however new it is', () => {
    expect(litBeforeHidden([atom('hidden-new', true), atom('lit-old')]).map(a => a.label)).toEqual(['lit-old', 'hidden-new'])
  })

  it('reaches every atom by paging: none is ever dropped', () => {
    const atoms = Array.from({ length: RECENTS_WINDOW * 2 + 3 }, (_, i) => atom(String(i), i % 5 === 0))
    const seen: string[] = []
    for (let page = 0; page <= clampPage(99, atoms.length); page++) seen.push(...layoutPage(atoms, page).map(l => l.atom.label))
    expect(new Set(seen).size).toBe(atoms.length)
  })
})

describe('clampPage', () => {
  it('stops at the last page that holds anything', () => {
    expect(clampPage(5, RECENTS_WINDOW)).toBe(0)
    expect(clampPage(5, RECENTS_WINDOW + 1)).toBe(1)
    expect(clampPage(-1, 500)).toBe(0)
    expect(clampPage(3, 0)).toBe(0)
  })
})

describe('filterAtoms', () => {
  it('narrows by name or path, ignoring case; an empty query keeps all', () => {
    const atoms = [
      { label: 'Ann', path: ['people', 'Ann'] },
      { label: 'plan', path: ['work', 'plan'] },
    ]
    expect(filterAtoms(atoms, 'ann').map(a => a.label)).toEqual(['Ann'])
    expect(filterAtoms(atoms, 'WORK').map(a => a.label)).toEqual(['plan'])
    expect(filterAtoms(atoms, '  ')).toHaveLength(2)
  })
})

describe('recentsClickPlan', () => {
  it('walks to a placed atom', () => {
    expect(recentsClickPlan({ path: ['a', 'b'], placed: true }, false)).toEqual({ kind: 'walk', travel: ['a', 'b'] })
  })

  it('takes when asked, naming the page above as the source', () => {
    expect(recentsClickPlan({ path: ['a', 'b'], placed: true }, true)).toEqual({ kind: 'take', source: ['a'] })
  })

  it('always takes an atom no page lists: there is nowhere to walk', () => {
    expect(recentsClickPlan({ path: [], placed: false }, false)).toEqual({ kind: 'take', source: [] })
  })
})
