// meeting/meeting-seats.spec.ts — the swarm's meeting, its leader, its seats,
// and when a follower moves.

import { describe, expect, it } from 'vitest'
import { followStep, followedBy, isFollowed, leaderOf, meetingAddress, meetingPreimage, originatorOf, pathKey, seatOrder } from './meeting-seats.js'

describe('the swarm meeting address', () => {
  it('is the same for the same swarm, however it is spelled', async () => {
    const a = meetingPreimage('Garden', 'Rose', 'wss://HyperComb.com/')
    const b = meetingPreimage('garden', 'rose', 'hypercomb.com')
    expect(a).toBe(b)
    expect(await meetingAddress(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(await meetingAddress(a)).toBe(await meetingAddress(b))
  })

  it('differs for another secret or another host', () => {
    const base = meetingPreimage('garden', 'rose', 'hypercomb.com')
    expect(meetingPreimage('garden', 'tulip', 'hypercomb.com')).not.toBe(base)
    expect(meetingPreimage('garden', 'rose', 'jwize.com')).not.toBe(base)
  })

  it('is nothing without a swarm', async () => {
    expect(meetingPreimage('garden', 'rose', '')).toBe('')
    expect(meetingPreimage('', 'rose', 'hypercomb.com')).toBe('')
    expect(meetingPreimage('garden', '', 'hypercomb.com')).toBe('')
    expect(await meetingAddress('')).toBe('')
  })
})

describe('the leader and the seats', () => {
  const ann = { id: 'ann', since: 100 }
  const bob = { id: 'bob', since: 200 }
  const cat = { id: 'cat', since: 150 }

  it('the leader is whoever has been in longest, ties by id', () => {
    expect(leaderOf([bob, ann, cat])?.id).toBe('ann')
    expect(leaderOf([{ id: 'zed', since: 5 }, { id: 'amy', since: 5 }])?.id).toBe('amy')
    expect(leaderOf([])).toBeUndefined()
  })

  it('seats the leader in the middle, then by arrival', () => {
    expect(seatOrder([bob, cat, ann]).map(m => m.id)).toEqual(['ann', 'cat', 'bob'])
  })
})

describe('handing the lead over, and following someone else', () => {
  const ann = { id: 'ann', since: 100 }
  const bob = { id: 'bob', since: 200 }
  const cat = { id: 'cat', since: 300 }

  it('the originator hands the lead over, and takes it back', () => {
    const handed = [{ ...ann, lead: 'cat' }, bob, cat]
    expect(originatorOf(handed)?.id).toBe('ann')
    expect(leaderOf(handed)?.id).toBe('cat')
    expect(seatOrder(handed).map(m => m.id)).toEqual(['cat', 'ann', 'bob'])
    expect(leaderOf([{ ...ann, lead: '' }, bob, cat])?.id).toBe('ann')
  })

  it('only the originator can hand the lead over, and only to someone here', () => {
    expect(leaderOf([ann, { ...bob, lead: 'bob' }, cat])?.id).toBe('ann')
    expect(leaderOf([{ ...ann, lead: 'gone' }, bob])?.id).toBe('ann')
  })

  it('anyone may follow someone else; nobody chosen follows the leader', () => {
    const all = [ann, bob, cat]
    expect(followedBy('cat', all, 'bob')?.id).toBe('bob')
    expect(followedBy('cat', all, '')?.id).toBe('ann')
    expect(followedBy('cat', all, 'gone')?.id).toBe('ann')
    expect(followedBy('ann', all, '')).toBeUndefined()
  })

  it('a person is followed by whoever chose them, or by default when they lead', () => {
    expect(isFollowed('ann', [ann, bob, cat])).toBe(true)
    expect(isFollowed('bob', [ann, bob, cat])).toBe(false)
    expect(isFollowed('bob', [ann, bob, { ...cat, follows: 'bob' }])).toBe(true)
    expect(isFollowed('ann', [ann, { ...bob, follows: 'cat' }, { ...cat, follows: 'bob' }])).toBe(false)
  })
})

describe('following the leader', () => {
  const leader = { id: 'ann', since: 1, path: ['presentation', 'simple'] }

  it('walks to the leader on first hearing them', () => {
    expect(followStep({ selfId: 'bob', leader, lastLeaderPath: null, here: [] })).toEqual(['presentation', 'simple'])
  })

  it('stays when the leader has not moved, even after looking around', () => {
    expect(followStep({ selfId: 'bob', leader, lastLeaderPath: 'presentation/simple', here: ['elsewhere'] })).toBeNull()
  })

  it('walks again when the leader moves', () => {
    const moved = { ...leader, path: ['presentation', 'organized'] }
    expect(followStep({ selfId: 'bob', leader: moved, lastLeaderPath: 'presentation/simple', here: ['presentation', 'simple'] }))
      .toEqual(['presentation', 'organized'])
  })

  it('does not walk where it already stands, nor ever for the leader', () => {
    expect(followStep({ selfId: 'bob', leader, lastLeaderPath: null, here: ['presentation', 'simple'] })).toBeNull()
    expect(followStep({ selfId: 'ann', leader, lastLeaderPath: null, here: [] })).toBeNull()
  })

  it('walks to the root when the leader is at the root', () => {
    expect(followStep({ selfId: 'bob', leader: { ...leader, path: [] }, lastLeaderPath: 'presentation', here: ['presentation'] })).toEqual([])
    expect(pathKey([' a ', '', 'b'])).toBe('a/b')
  })
})
