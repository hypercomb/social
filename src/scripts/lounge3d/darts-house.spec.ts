import { describe, expect, it } from 'vitest'
import {
  CALLS, EARNING_CALLS, FANS_BASE, FANS_MAX, QUIRKS, SIDE_BET_FACTOR, SMOKE,
  SMOKE_CALLS, TALLY, TALLY_STEP, applyFans, crowdMultiplier, dartCall,
  drawSideBet, legCall, payOf, quirkCalls, smokeCall, tallyFans, tallyOf, turnCall,
} from './darts-house.js'
import { scoreDart, bedCentre, type DartHit } from './darts-rules.js'

/** A hit, named the way the scorer names it — so the calls are tested against
 *  the same labels the board actually produces, not against invented ones. */
const hit = (n: number, mult: 1 | 2 | 3): DartHit => {
  const c = bedCentre(n, mult)
  return scoreDart(c.x, c.y)
}
const wire: DartHit = { label: 'WIRE', points: 0, mult: 0 }

describe('the crowd is the multiplier', () => {
  it('climbs a rung every three fans and stops at four', () => {
    expect(crowdMultiplier(0)).toBe(1)
    expect(crowdMultiplier(2)).toBe(1)
    expect(crowdMultiplier(3)).toBe(2)
    expect(crowdMultiplier(5)).toBe(2)
    expect(crowdMultiplier(6)).toBe(3)
    expect(crowdMultiplier(8)).toBe(3)
    expect(crowdMultiplier(9)).toBe(4)
    expect(crowdMultiplier(FANS_MAX)).toBe(4)
  })

  it('never goes down as the room fills', () => {
    for (let f = 1; f <= FANS_MAX; f++)
      expect(crowdMultiplier(f)).toBeGreaterThanOrEqual(crowdMultiplier(f - 1))
  })

  it('starts you on the bottom rung — two regulars is not a crowd', () => {
    expect(crowdMultiplier(FANS_BASE)).toBe(1)
  })

  it('holds fans between an empty oche and a full house', () => {
    expect(applyFans(0, CALLS.bust)).toBe(0)
    expect(applyFans(FANS_MAX, CALLS.ton80)).toBe(FANS_MAX)
    expect(applyFans(4, CALLS.ton40)).toBe(7)
    expect(applyFans(4, CALLS.wire)).toBe(3)
  })

  it('takes more than one bust to lose a multiplier you earned', () => {
    // The headroom above the top rung is the whole reason FANS_MAX > 9.
    const afterOneBust = applyFans(FANS_MAX, CALLS.bust)
    expect(crowdMultiplier(afterOneBust)).toBe(4)
  })

  it('pays the call times the room', () => {
    expect(payOf(CALLS.ton80, 0)).toBe(40)
    expect(payOf(CALLS.ton80, 9)).toBe(160)
    expect(payOf(CALLS.treble, 12)).toBe(0)
  })
})

describe('the calls', () => {
  it('names a treble, the bull, and a dart off the board', () => {
    expect(dartCall(hit(20, 3))).toBe(CALLS.treble)
    expect(dartCall(hit(25, 2))).toBe(CALLS.dbull)
    expect(dartCall(wire)).toBe(CALLS.wire)
    expect(dartCall(hit(20, 1))).toBeNull()
    expect(dartCall(hit(16, 2))).toBeNull()
  })

  it('calls 180 a ton eighty, not three in a bed — the richest name wins', () => {
    const t20 = hit(20, 3)
    expect(turnCall([t20, t20, t20], false)).toBe(CALLS.ton80)
  })

  it('calls three of anything else in one bed', () => {
    const t19 = hit(19, 3)
    expect(turnCall([t19, t19, t19], false)).toBe(CALLS.bed)
    const s5 = hit(5, 1)
    expect(turnCall([s5, s5, s5], false)).toBe(CALLS.bed)
  })

  it('spots a shanghai, and refuses one at the bull', () => {
    expect(turnCall([hit(20, 1), hit(20, 2), hit(20, 3)], false)).toBe(CALLS.shanghai)
    expect(turnCall([hit(7, 3), hit(7, 1), hit(7, 2)], false)).toBe(CALLS.shanghai)
    // 25 / BULL / D·BULL is the same number three ways but there is no treble
    // bull, so it cannot be the shot — it is only ever three darts in the middle.
    const bull = hit(25, 1)
    const dbull = hit(25, 2)
    expect(turnCall([bull, dbull, bull], false)).not.toBe(CALLS.shanghai)
  })

  it('counts tons by the turn total', () => {
    expect(turnCall([hit(20, 3), hit(20, 1), hit(20, 1)], false)).toBe(CALLS.ton)
    expect(turnCall([hit(20, 3), hit(20, 3), hit(20, 1)], false)).toBe(CALLS.ton40)
    // 137 is a ton, not a ton forty — the boundary is the total, not the shape
    expect(turnCall([hit(19, 3), hit(20, 3), hit(20, 1)], false)).toBe(CALLS.ton)
    expect(turnCall([hit(19, 3), hit(19, 3), hit(20, 3)], false)).toBe(CALLS.ton40)
    // 99 is not a ton, however it feels
    expect(turnCall([hit(20, 3), hit(20, 1), hit(19, 1)], false)).toBeNull()
  })

  it('lets a bust outrank every score in the turn', () => {
    const t20 = hit(20, 3)
    expect(turnCall([t20, t20, t20], true)).toBe(CALLS.bust)
    expect(turnCall([], true)).toBe(CALLS.bust)
  })

  it('drifts away from a turn nobody would cross a room for', () => {
    expect(turnCall([hit(5, 1), hit(1, 1), hit(3, 1)], false)).toBe(CALLS.cold)
    // two darts in is not a verdict — the turn is not over
    expect(turnCall([hit(5, 1), hit(1, 1)], false)).toBeNull()
    // 26 is the traditional bad-but-not-shameful turn: 20, 5, 1
    expect(turnCall([hit(20, 1), hit(5, 1), hit(1, 1)], false)).toBeNull()
  })
})

describe('how a leg is remembered', () => {
  it('is a nine-darter in nine darts or fewer', () => {
    expect(legCall({ darts: 9, turnStart: 141, finish: hit(20, 2) })).toBe(CALLS.nine)
  })

  it('is the big fish only from 170', () => {
    expect(legCall({ darts: 15, turnStart: 170, finish: hit(25, 2) })).toBe(CALLS.bigfish)
    expect(legCall({ darts: 15, turnStart: 167, finish: hit(25, 2) })).toBe(CALLS.leg)
  })

  it('is the madhouse when it ends on double one', () => {
    expect(legCall({ darts: 21, turnStart: 40, finish: hit(1, 2) })).toBe(CALLS.madhouse)
  })

  it('is otherwise simply the leg', () => {
    expect(legCall({ darts: 18, turnStart: 32, finish: hit(16, 2) })).toBe(CALLS.leg)
  })
})

describe('the side bets', () => {
  const ids = (hits: DartHit[], landings?: Array<{ x: number; y: number }>): string[] =>
    quirkCalls(hits, landings).map(q => q.id)

  it('pays for a turn made entirely of even beds, and for odd', () => {
    expect(ids([hit(20, 1), hit(4, 1), hit(6, 1)])).toContain('evens')
    expect(ids([hit(20, 1), hit(4, 1), hit(6, 1)])).not.toContain('odds')
    expect(ids([hit(19, 1), hit(3, 1), hit(7, 1)])).toContain('odds')
    expect(ids([hit(20, 1), hit(3, 1), hit(6, 1)])).not.toContain('evens')
  })

  it('pays for three primes, and does not count the bull as one', () => {
    expect(ids([hit(19, 1), hit(17, 1), hit(13, 1)])).toContain('primes')
    expect(ids([hit(19, 1), hit(17, 1), hit(25, 1)])).not.toContain('primes')
    expect(ids([hit(19, 1), hit(17, 1), hit(15, 1)])).not.toContain('primes')
  })

  it('pays for a staircase in any order, and for a Fibonacci run', () => {
    expect(ids([hit(6, 1), hit(4, 1), hit(5, 1)])).toContain('staircase')
    expect(ids([hit(6, 1), hit(4, 1), hit(7, 1)])).not.toContain('staircase')
    expect(ids([hit(13, 1), hit(5, 1), hit(8, 1)])).toContain('fib')
    expect(ids([hit(8, 1), hit(5, 1), hit(3, 1)])).toContain('fib')
    expect(ids([hit(8, 1), hit(5, 1), hit(2, 1)])).not.toContain('fib')
  })

  it('pays for three beds side by side ON THE BOARD, wrapping round the top', () => {
    // 20, 1, 18 sit next to each other; 18, 19, 20 do not.
    expect(ids([hit(20, 1), hit(1, 1), hit(18, 1)])).toContain('neighbours')
    expect(ids([hit(18, 1), hit(19, 1), hit(20, 1)])).not.toContain('neighbours')
    // the board has no first bed: 12, 5, 20 wraps past the top
    expect(ids([hit(12, 1), hit(5, 1), hit(20, 1)])).toContain('neighbours')
  })

  it('pays for the pub totals and the tidy ones', () => {
    // 20, 5, 1 — bed and breakfast, and 26 is not a square or a palindrome
    expect(ids([hit(20, 1), hit(5, 1), hit(1, 1)])).toEqual(['breakfast'])
    // 20, 20, 5 = 45, a bag o' nuts
    expect(ids([hit(20, 1), hit(20, 1), hit(5, 1)])).toContain('nuts')
    // 11, 7, 4 = 22 — quack quack
    expect(ids([hit(11, 1), hit(7, 1), hit(4, 1)])).toContain('quack')
    // 20, 20, 4 = 44, a palindrome
    expect(ids([hit(20, 1), hit(20, 1), hit(4, 1)])).toContain('palindrome')
    // T20, T20, 1 = 121 — eleven squared AND a palindrome
    const both = ids([hit(20, 3), hit(20, 3), hit(1, 1)])
    expect(both).toContain('square')
    expect(both).toContain('palindrome')
  })

  it('pays for keeping all three in the treble ring', () => {
    // three trebles that are NOT a run — a run is a straight, which is dearer
    expect(ids([hit(20, 3), hit(19, 3), hit(7, 3)])).toContain('ring')
    expect(ids([hit(20, 3), hit(19, 3), hit(7, 1)])).not.toContain('ring')
  })

  it('pays a Robin Hood for two darts in one hole — and only for one hole', () => {
    const c = bedCentre(20, 3)
    const near = [{ x: c.x, y: c.y }, { x: c.x + 0.002, y: c.y - 0.001 }]
    expect(ids([hit(20, 3), hit(20, 3)], near)).toContain('robin')
    const apart = [{ x: c.x, y: c.y }, { x: c.x + 0.05, y: c.y }]
    expect(ids([hit(20, 3), hit(20, 3)], apart)).not.toContain('robin')
    // no landings supplied: the sisal is not in evidence, so no claim
    expect(ids([hit(20, 3), hit(20, 3)])).toEqual([])
  })

  it('ignores darts off the board and unfinished turns', () => {
    expect(ids([hit(20, 1), hit(4, 1), wire])).not.toContain('evens')
    expect(ids([hit(20, 1), hit(4, 1)])).toEqual([])
  })

  it('draws a side bet from its own table, whatever the dice say', () => {
    const keys = Object.keys(QUIRKS)
    expect(keys).toContain(drawSideBet(() => 0))
    expect(keys).toContain(drawSideBet(() => 0.999999))
    // a source that misbehaves must not hand back an id nobody has
    expect(keys).toContain(drawSideBet(() => 1))
    const drawn = new Set(keys.map((_, i) => drawSideBet(() => i / keys.length)))
    expect(drawn.size).toBe(keys.length)
  })

  it('keeps the side bets small — they are a laugh, not a living', () => {
    for (const q of Object.values(QUIRKS)) {
      expect(q.embers).toBeGreaterThan(0)
      // A side bet at its absolute best — drawn, doubled, full house — still
      // pays less than the leg it did nothing to win.
      expect(q.embers * SIDE_BET_FACTOR * 4).toBeLessThanOrEqual(CALLS.leg.embers * 4)
      expect(q.shout).toBeTruthy()
    }
  })
})

describe('the straight', () => {
  const ids = (hits: DartHit[]): string[] => quirkCalls(hits).map(q => q.id)

  it('pays for 20, 19, 18 in the treble ring', () => {
    const got = ids([hit(20, 3), hit(19, 3), hit(18, 3)])
    expect(got).toContain('straight')
    // it outranks the two bets it would otherwise also win
    expect(got).not.toContain('staircase')
    expect(got).not.toContain('ring')
  })

  it('pays more for the same three in the doubles', () => {
    expect(ids([hit(18, 2), hit(20, 2), hit(19, 2)])).toContain('straightd')
    expect(QUIRKS.straightd.embers).toBeGreaterThan(QUIRKS.straight.embers)
  })

  it('is not a straight across two different rings', () => {
    const got = ids([hit(20, 3), hit(19, 2), hit(18, 3)])
    expect(got).not.toContain('straight')
    expect(got).toContain('staircase')
  })
})

describe('the smoke rings', () => {
  it('pays by how near the middle of the ring the dart went', () => {
    expect(smokeCall(0)?.id).toBe('smokeeye')
    expect(smokeCall(SMOKE.r * 0.2)?.id).toBe('smokeeye')
    expect(smokeCall(SMOKE.r * 0.5)?.id).toBe('smoke')
    expect(smokeCall(SMOKE.r * 0.9)?.id).toBe('smokegraze')
  })

  it('pays nothing for a dart that missed the ring altogether', () => {
    expect(smokeCall(SMOKE.r * 1.01)).toBeNull()
    expect(smokeCall(0.4)).toBeNull()
  })

  it('pays more the nearer the eye, always', () => {
    const at = (d: number): number => smokeCall(d)?.embers ?? 0
    expect(at(0)).toBeGreaterThan(at(SMOKE.r * 0.5))
    expect(at(SMOKE.r * 0.5)).toBeGreaterThan(at(SMOKE.r * 0.95))
    expect(at(SMOKE.r * 0.95)).toBeGreaterThan(at(SMOKE.r * 1.5))
  })

  it('refuses a ring with no size — a ring that is not there cannot be threaded', () => {
    expect(smokeCall(0, 0)).toBeNull()
  })

  it('hangs about long enough to aim at, and not long enough to wait for', () => {
    expect(SMOKE.life).toBeGreaterThan(3)
    expect(SMOKE.life).toBeLessThan(SMOKE.gapMin)
    expect(SMOKE.gapMax).toBeGreaterThan(SMOKE.gapMin)
  })
})

describe('the tally — the alternate score', () => {
  it('scores the ring, not the number', () => {
    expect(tallyOf(hit(20, 3))).toBe(TALLY.treble)
    expect(tallyOf(hit(1, 3))).toBe(TALLY.treble)
    expect(tallyOf(hit(20, 2))).toBe(TALLY.double)
    expect(tallyOf(hit(20, 1))).toBe(TALLY.single)
    // the outer bull: bedCentre(25) is the INNER one, so aim between the rings
    expect(tallyOf(scoreDart(0, 0.014))).toBe(TALLY.bull)
    expect(tallyOf(hit(25, 2))).toBe(TALLY.dbull)
    expect(tallyOf(wire)).toBe(TALLY.wire)
  })

  it('rewards a thin ring over a fat score — the whole point of it', () => {
    // 60 points and 9 tally against 20 points and 9 tally: the tally does not
    // care that one of them is three times the score.
    expect(tallyOf(hit(20, 3))).toBe(tallyOf(hit(1, 3)) * 1)
    // and the inner bull, worth 50 to the leg, is the biggest thing on it
    expect(tallyOf(hit(25, 2))).toBeGreaterThan(tallyOf(hit(20, 3)))
  })

  it('brings a regular over every step of it', () => {
    expect(tallyFans(0)).toBe(0)
    expect(tallyFans(TALLY_STEP - 1)).toBe(0)
    expect(tallyFans(TALLY_STEP)).toBe(1)
    expect(tallyFans(TALLY_STEP * 3 + 4)).toBe(3)
    expect(tallyFans(-20)).toBe(0)
  })

  it('never runs backwards, however badly the darts go', () => {
    for (let n = 0; n < 400; n += 7) expect(tallyFans(n + 1)).toBeGreaterThanOrEqual(tallyFans(n))
  })
})

describe('the table the store page reads', () => {
  it('lists every paying call, cheapest first', () => {
    expect(EARNING_CALLS.length).toBeGreaterThan(4)
    for (let i = 1; i < EARNING_CALLS.length; i++)
      expect(EARNING_CALLS[i].embers).toBeGreaterThanOrEqual(EARNING_CALLS[i - 1].embers)
  })

  it('quotes nothing the board does not hand out', () => {
    for (const c of EARNING_CALLS) {
      expect(c.embers).toBeGreaterThan(0)
      expect(c.label).toBeTruthy()
      expect(c.note).toBeTruthy()
      expect(({ ...CALLS, ...SMOKE_CALLS })[c.id]).toBe(c)
    }
  })

  it('keeps the free calls off the table', () => {
    const ids = EARNING_CALLS.map(c => c.id)
    for (const id of ['treble', 'dbull', 'wire', 'bust', 'cold', 'housed', 'houseleg', 'housematch'])
      expect(ids).not.toContain(id)
  })

  it('keeps every call keyed by its own id — the ledger claims by it', () => {
    for (const [key, call] of Object.entries(CALLS)) expect(call.id).toBe(key)
  })

  it('never lets a call move the score — the rules pay in points, the house pays in embers', () => {
    for (const call of Object.values(CALLS)) {
      expect(Object.keys(call)).not.toContain('points')
      expect(call.roar).toBeGreaterThanOrEqual(0)
      expect(call.roar).toBeLessThanOrEqual(3)
    }
  })
})
