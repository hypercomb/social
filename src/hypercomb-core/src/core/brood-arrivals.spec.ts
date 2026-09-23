// The producer: what actually puts arrivals in the brood.
import { beforeEach, describe, expect, it } from 'vitest'
import { broodRecord, forgetInBrood, holdArrivals, mayRunBee, recordVouch } from './brood.js'
import { BROOD_TRUST_IOC_KEY, setBroodRules, DEFAULT_BROOD_RULES } from './brood-rules.js'

const sig = (c: string): string => c.repeat(64)

const follows = (keys: readonly string[]): void => {
  ;(globalThis as { ioc?: unknown }).ioc = {
    get: (key: string) => key === BROOD_TRUST_IOC_KEY ? { follows: () => keys } : undefined,
  }
}

beforeEach(async () => { await setBroodRules(DEFAULT_BROOD_RULES); follows([]) })

describe('holdArrivals', () => {
  it('holds nothing under the default rules — an ordinary update is untouched', async () => {
    const bees = [sig('1'), sig('2')]
    expect(await holdArrivals(bees, 'followed', { zone: 'friends.example' })).toEqual([])
    expect(await broodRecord(bees[0]!)).toBeNull()
    expect(await mayRunBee(bees[0]!)).toBe(true)
  })

  it('holds your own code when you want to test it first, and names where it came from', async () => {
    const own = sig('3')
    await setBroodRules({ own: 'hold' })
    expect(await holdArrivals([own], 'own', { zone: 'mine.example', packageSig: sig('f'), how: 'package install' })).toEqual([own])
    expect(await mayRunBee(own)).toBe(false)
    const record = await broodRecord(own)
    expect(record?.source).toMatchObject({ kind: 'own', zone: 'mine.example', how: 'package install' })
    await forgetInBrood(own)
  })

  it('lets a stranger\'s held code run once a publisher you follow brings the same bytes — never over your ruling', async () => {
    const taken = sig('6')
    const refused = sig('7')
    // A trial taken by hand: held as a stranger's.
    expect(await holdArrivals([taken, refused], 'stranger', { how: 'picked revision of games' })).toEqual([taken, refused])
    const { refuseInBrood } = await import('./brood.js')
    await refuseInBrood(refused)
    // The followed publisher promotes it: the same bytes arrive as theirs.
    expect(await holdArrivals([taken, refused], 'followed', { zone: 'friends.example' })).toEqual([refused])
    expect(await mayRunBee(taken)).toBe(true)
    expect((await broodRecord(taken))?.source).toMatchObject({ kind: 'followed', zone: 'friends.example', how: 'picked revision of games' })
    // A stranger bringing it again never moves it back down.
    await holdArrivals([taken], 'stranger')
    expect((await broodRecord(taken))?.source.kind).toBe('followed')
    await forgetInBrood(taken)
    await forgetInBrood(refused)
  })

  it('does not re-hold what a hand already accepted', async () => {
    const accepted = sig('4')
    await setBroodRules({ followed: 'hold' })
    await holdArrivals([accepted], 'followed')
    const { acceptIntoHive } = await import('./brood.js')
    await acceptIntoHive(accepted, ['not-safe', 'audit-is-not-approval'])
    // It arrives again on the next install; the ruling stands and it runs.
    expect(await holdArrivals([accepted], 'followed')).toEqual([])
    expect(await mayRunBee(accepted)).toBe(true)
    await forgetInBrood(accepted)
  })

  it('does not count code that enough followed communities already carry', async () => {
    const vouched = sig('5')
    follows(['alice', 'bob'])
    await setBroodRules({ followed: 'hold', vouchesNeeded: 2 })
    await holdArrivals([vouched], 'followed')
    expect(await mayRunBee(vouched)).toBe(false)
    await recordVouch(vouched, { by: 'alice', verdict: 'accepted', at: 1 })
    await recordVouch(vouched, { by: 'bob', verdict: 'accepted', at: 1 })
    // Re-running the producer reports it as no longer held back.
    expect(await holdArrivals([vouched], 'followed')).toEqual([])
    expect(await mayRunBee(vouched)).toBe(true)
    await forgetInBrood(vouched)
  })

  it('ignores anything that is not a signature, and never throws', async () => {
    await expect(holdArrivals(['nope', ''], 'stranger')).resolves.toEqual([])
  })
})
