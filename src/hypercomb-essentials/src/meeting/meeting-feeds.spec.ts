// meeting/meeting-feeds.spec.ts — four feeds, and a track event that arrives early.
import { describe, expect, it } from 'vitest'
import { acceptedLocalTracks, createSignalQueue, feedsFromWire, speakerId, subscriptionPlan } from './meeting-feeds.js'

describe('the speaker on the rectangular screen', () => {
  it('shows the leader when someone else leads and nobody is loud', () => {
    expect(speakerId([
      { id: 'me', you: true },
      { id: 'ann', leads: true },
      { id: 'bo' },
    ], '')).toBe('ann')
  })

  it('shows the person who is speaking, and never lets your own voice take it', () => {
    const seats = [
      { id: 'me', you: true, leads: true },
      { id: 'bo' },
    ]
    expect(speakerId(seats, 'bo')).toBe('bo')
    expect(speakerId(seats, 'me')).toBe('bo')
  })

  it('shows you only when you are the only person there', () => {
    expect(speakerId([{ id: 'me', you: true, leads: true }], '')).toBe('me')
    expect(speakerId([], '')).toBe('')
  })
})

describe('four feeds between two people', () => {
  const offered = [
    { mid: '0', trackName: 'a-audio' },
    { mid: '1', trackName: 'a-video' },
    { mid: '2', trackName: 'b-audio' },
    { mid: '3', trackName: 'b-video' },
  ]

  it('keeps a track the SFU refused out of what is advertised, and still wants it', () => {
    const accepted = acceptedLocalTracks(offered.slice(0, 2), [
      { mid: '0', trackName: 'a-audio' },
      { mid: '1', trackName: 'a-video', errorCode: 'not_found' },
    ])
    expect(accepted.map(t => t.trackName)).toEqual(['a-audio'])
    const plan = subscriptionPlan('session-a', ['a-audio', 'a-video', 'b-audio', 'b-video'], {
      session: 'session-a',
      byName: new Map([['a-audio', '0'], ['b-audio', '2'], ['b-video', '3']]),
    })
    expect(plan.want).toEqual(['a-video'])
    expect(plan.drop).toEqual([])
  })

  it('drops a camera that was turned off, so turning it on subscribes again', () => {
    const plan = subscriptionPlan('session-a', ['a-audio'], {
      session: 'session-a',
      byName: new Map([['a-audio', '0'], ['a-video', '1']]),
    })
    expect(plan.drop).toEqual(['a-video'])
    expect(plan.want).toEqual([])
    const again = subscriptionPlan('session-a', ['a-audio', 'a-video'], {
      session: 'session-a',
      byName: new Map([['a-audio', '0']]),
    })
    expect(again.want).toEqual(['a-video'])
  })

  it('reads a feed whose mid was empty at the track event once the answer is applied', () => {
    const owners = new Map([['0', 'ann'], ['1', 'ann'], ['2', 'bo'], ['3', 'bo']])
    const early = feedsFromWire([
      { mid: '0', trackId: 'a' },
      { mid: '1', trackId: 'b' },
      { mid: '2', trackId: 'c' },
      { mid: null, trackId: 'd' },
    ], owners)
    expect(early).toHaveLength(3)
    const applied = feedsFromWire([
      { mid: '0', trackId: 'a' },
      { mid: '1', trackId: 'b' },
      { mid: '2', trackId: 'c' },
      { mid: '3', trackId: 'd' },
    ], owners)
    expect(applied.map(f => f.trackId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('runs one signaling job at a time, and a failure does not stall the next', async () => {
    const signal = createSignalQueue()
    let inFlight = 0
    let most = 0
    const job = (fail = false) => signal(async () => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      if (fail) throw new Error('negotiating')
      return 'ok'
    })
    const results = await Promise.allSettled([job(true), job(false), job(false)])
    expect(most).toBe(1)
    expect(results[0]!.status).toBe('rejected')
    expect(results[1]!.status).toBe('fulfilled')
    expect(results[2]!.status).toBe('fulfilled')
  })
})
