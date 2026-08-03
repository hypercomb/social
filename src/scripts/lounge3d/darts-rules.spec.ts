import { describe, expect, it } from 'vitest'
import {
  DART_NUMS, bedCentre, checkout, pickShot, resolveThrow, scoreDart,
} from './darts-rules.js'

describe('scoring the board', () => {
  it('scores every bed on the board from its own centre', () => {
    for (const n of DART_NUMS) {
      const single = bedCentre(n, 1)
      expect(scoreDart(single.x, single.y)).toEqual({ label: String(n), points: n, mult: 1 })
      const treble = bedCentre(n, 3)
      expect(scoreDart(treble.x, treble.y)).toEqual({ label: 'T' + n, points: n * 3, mult: 3 })
      const double = bedCentre(n, 2)
      expect(scoreDart(double.x, double.y)).toEqual({ label: 'D' + n, points: n * 2, mult: 2 })
    }
  })

  it('puts 20 at the top and 3 at the bottom — the board is the right way up', () => {
    expect(scoreDart(0, 0.15).label).toBe('20')
    expect(scoreDart(0, -0.15).label).toBe('3')
    // 6 on the right arm, 11 on the left — the standard board, not a mirror.
    expect(scoreDart(0.15, 0).label).toBe('6')
    expect(scoreDart(-0.15, 0).label).toBe('11')
  })

  it('reads the bull as a single 25 and the inner bull as a double', () => {
    expect(scoreDart(0, 0)).toEqual({ label: 'D·BULL', points: 50, mult: 2 })
    const outer = scoreDart(0, 0.27 * 0.05)
    expect(outer).toEqual({ label: 'BULL', points: 25, mult: 1 })
  })

  it('scores nothing outside the doubles ring', () => {
    expect(scoreDart(0, 0.27).mult).toBe(0)
    expect(scoreDart(0, 0.27).points).toBe(0)
  })
})

describe('checkouts', () => {
  it('calls the classics the way a player would', () => {
    expect(checkout(170, 3)).toEqual(['T20', 'T20', 'BULL'])
    expect(checkout(96, 3)).toEqual(['T20', 'D18'])
    expect(checkout(40, 3)).toEqual(['D20'])
    expect(checkout(50, 3)).toEqual(['BULL'])
    expect(checkout(2, 3)).toEqual(['D1'])
  })

  it('knows the bogey numbers have no three-dart out', () => {
    for (const bogey of [169, 168, 166, 165, 163, 162, 159]) {
      expect(checkout(bogey, 3), String(bogey)).toBeNull()
    }
  })

  it('has no out above 170, and none at all on 1', () => {
    expect(checkout(171, 3)).toBeNull()
    expect(checkout(1, 3)).toBeNull()
  })

  it('never proposes a route that strands you on 1', () => {
    for (let score = 2; score <= 170; score++) {
      const route = checkout(score, 3)
      if (!route) continue
      let left = score
      for (const label of route) {
        const shot = pickShotPoints(label)
        left -= shot
        expect(left, `${score} via ${route.join(' ')}`).not.toBe(1)
        expect(left).toBeGreaterThanOrEqual(0)
      }
      expect(left, `${score} via ${route.join(' ')}`).toBe(0)
      expect(route[route.length - 1]).toMatch(/^(D\d+|BULL)$/)
    }
  })

  it('finds an out for every score a three-dart finish exists for', () => {
    // 2..158 minus the bogeys, plus the four big ones — the standard set.
    const bogeys = new Set([159, 162, 163, 165, 166, 168, 169])
    for (let score = 2; score <= 170; score++) {
      const expected = !bogeys.has(score)
      expect(checkout(score, 3) !== null, String(score)).toBe(expected)
    }
  })
})

describe('the house picks its shot', () => {
  it('goes for the finish when there is one', () => {
    expect(pickShot(40, 3)).toEqual({ n: 20, mult: 2 })
    expect(pickShot(170, 3)).toEqual({ n: 20, mult: 3 })
  })

  it('throws the treble twenty when there is no finish', () => {
    expect(pickShot(501, 3)).toEqual({ n: 20, mult: 3 })
  })

  it('never picks a shot that would bust or strand it', () => {
    for (let score = 2; score <= 501; score++) {
      for (const darts of [1, 2, 3]) {
        const shot = pickShot(score, darts)
        const left = score - shot.n * shot.mult
        expect(left >= 0, `${score}/${darts}`).toBe(true)
        if (left !== 0) expect(left, `${score}/${darts}`).not.toBe(1)
      }
    }
  })
})

describe('501, double out', () => {
  it('subtracts an ordinary score', () => {
    expect(resolveThrow(501, { label: 'T20', points: 60, mult: 3 }))
      .toEqual({ outcome: 'score', score: 441 })
  })

  it('busts when the dart goes past zero, and keeps the score', () => {
    const r = resolveThrow(20, { label: 'T20', points: 60, mult: 3 })
    expect(r.outcome).toBe('bust')
    expect(r.score).toBe(20)
    expect(r.reason).toBe('over')
  })

  it('busts when it leaves you on one', () => {
    const r = resolveThrow(21, { label: '20', points: 20, mult: 1 })
    expect(r.outcome).toBe('bust')
    expect(r.reason).toBe('left-one')
  })

  it('busts on zero without a double', () => {
    const r = resolveThrow(20, { label: '20', points: 20, mult: 1 })
    expect(r.outcome).toBe('bust')
    expect(r.reason).toBe('no-double')
  })

  it('takes the leg on a double, and on the inner bull', () => {
    expect(resolveThrow(40, { label: 'D20', points: 40, mult: 2 }))
      .toEqual({ outcome: 'leg', score: 0 })
    expect(resolveThrow(50, { label: 'D·BULL', points: 50, mult: 2 }))
      .toEqual({ outcome: 'leg', score: 0 })
  })

  it('does not take the leg on the outer bull — 25 is a single', () => {
    expect(resolveThrow(25, { label: 'BULL', points: 25, mult: 1 }).outcome).toBe('bust')
  })

  it('a wire dart scores nothing and busts nothing', () => {
    expect(resolveThrow(170, { label: 'WIRE', points: 0, mult: 0 }))
      .toEqual({ outcome: 'score', score: 170 })
  })
})

/** Points for a checkout label, for the route audit above. */
function pickShotPoints(label: string): number {
  if (label === 'BULL') return 50
  if (label === '25') return 25
  if (label.startsWith('T')) return Number(label.slice(1)) * 3
  if (label.startsWith('D')) return Number(label.slice(1)) * 2
  return Number(label)
}
