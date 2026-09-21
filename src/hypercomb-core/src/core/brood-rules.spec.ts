import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BROOD_RULES, admitArrival, countVouches, readRules,
  type BroodRules, type BroodVouch,
} from './brood-rules.js'

const rules = (over: Partial<BroodRules> = {}): BroodRules => ({ ...DEFAULT_BROOD_RULES, ...over })
const vouch = (by: string, verdict: BroodVouch['verdict'] = 'accepted'): BroodVouch => ({ by, verdict, at: 1 })
const FOLLOWS = ['alice', 'bob', 'carol']

describe('the rules that decide what gets held', () => {
  it('keeps today\'s behaviour by default: your own and a followed community run', () => {
    expect(admitArrival('own', rules(), [], FOLLOWS)).toBe('run')
    expect(admitArrival('followed', rules(), [], FOLLOWS)).toBe('run')
  })

  it('holds a stranger by default, and can refuse instead — but never run', () => {
    expect(admitArrival('stranger', rules(), [], FOLLOWS)).toBe('hold')
    expect(admitArrival('stranger', rules({ stranger: 'refuse' }), [], FOLLOWS)).toBe('refuse')
    // There is no third option to pick: the type has no 'run' for a stranger.
    expect(['hold', 'refuse']).toContain(admitArrival('stranger', rules(), [], FOLLOWS))
  })

  it('holds your own code too when you want to test it first', () => {
    expect(admitArrival('own', rules({ own: 'hold' }), [], FOLLOWS)).toBe('hold')
  })

  it('enough followed communities standing behind it lifts a hold', () => {
    const held = rules({ followed: 'hold', vouchesNeeded: 2 })
    expect(admitArrival('followed', held, [vouch('alice')], FOLLOWS)).toBe('hold')
    expect(admitArrival('followed', held, [vouch('alice'), vouch('bob')], FOLLOWS)).toBe('run')
  })

  it('counts only keys the participant follows — a stranger vouching for themselves is nothing', () => {
    const held = rules({ followed: 'hold', vouchesNeeded: 2 })
    expect(admitArrival('followed', held, [vouch('mallory'), vouch('mallory2')], FOLLOWS)).toBe('hold')
    expect(countVouches([vouch('mallory'), vouch('alice')], FOLLOWS).accepted).toBe(1)
  })

  it('counts each key once, however many times it vouches', () => {
    const held = rules({ followed: 'hold', vouchesNeeded: 2 })
    expect(admitArrival('followed', held, [vouch('alice'), vouch('alice')], FOLLOWS)).toBe('hold')
  })

  it('ONE FOLLOWED COMMUNITY SAYING NO OUTRANKS THE OTHERS SAYING YES', () => {
    const held = rules({ followed: 'hold', vouchesNeeded: 2 })
    const said = [vouch('alice'), vouch('bob'), vouch('carol', 'refused')]
    expect(admitArrival('followed', held, said, FOLLOWS)).toBe('hold')
    // Even where the rule would have run it outright.
    expect(admitArrival('followed', rules(), said, FOLLOWS)).toBe('hold')
    expect(admitArrival('own', rules(), said, FOLLOWS)).toBe('hold')
  })

  it('a key that vouched then refused is counted as a refusal', () => {
    const counted = countVouches([vouch('alice'), { ...vouch('alice', 'refused'), at: 2 }], FOLLOWS)
    expect(counted).toEqual({ accepted: 0, refused: 1 })
  })

  it('vouches do not admit a stranger unless the participant said they may', () => {
    const said = [vouch('alice'), vouch('bob')]
    expect(admitArrival('stranger', rules(), said, FOLLOWS)).toBe('hold')
    expect(admitArrival('stranger', rules({ vouchesAdmitStrangers: true }), said, FOLLOWS)).toBe('run')
  })

  it('no follows means no vouch counts — absence of trust is not a free pass', () => {
    const held = rules({ followed: 'hold', vouchesNeeded: 1 })
    expect(admitArrival('followed', held, [vouch('alice')], [])).toBe('hold')
  })

  it('vouchesNeeded 0 turns delegation off entirely', () => {
    const held = rules({ followed: 'hold', vouchesNeeded: 0 })
    expect(admitArrival('followed', held, [vouch('alice'), vouch('bob'), vouch('carol')], FOLLOWS)).toBe('hold')
  })

  it('a damaged policy file falls back to the default, never to something looser', () => {
    expect(readRules({ stranger: 'run', followed: 'yes', vouchesNeeded: -4 })).toEqual(DEFAULT_BROOD_RULES)
    expect(readRules(null)).toEqual(DEFAULT_BROOD_RULES)
    expect(readRules({ vouchesAdmitStrangers: 'true' }).vouchesAdmitStrangers).toBe(false)
  })
})
