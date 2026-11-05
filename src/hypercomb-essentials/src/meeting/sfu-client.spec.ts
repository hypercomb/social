// meeting/sfu-client.spec.ts — the browser's half of the meeting's video.
import { describe, expect, it } from 'vitest'
import { SfuClient, SfuError, sfuBase } from './sfu-client.js'

const MEETING = 'a'.repeat(64)

const fakeFetch = (answers: ((path: string, body: any) => { status?: number; body: unknown })[]) => {
  const calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = []
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body ?? '{}'))
    calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body })
    const next = answers.shift()
    const out = next ? next(url, body) : { body: {} }
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 })
  }
  return { calls, fetchImpl }
}

describe('where the video routes live', () => {
  it('is the meeting point the swarm meets at, over https', () => {
    expect(sfuBase('wss://hypercomb.com')).toBe('https://hypercomb.com/.well-known/hc-meet/sfu')
    expect(sfuBase('wss://pluginthematrix.com/')).toBe('https://pluginthematrix.com/.well-known/hc-meet/sfu')
    expect(sfuBase('ws://localhost:7796')).toBe('http://localhost:7796/.well-known/hc-meet/sfu')
    expect(sfuBase('https://hypercomb.com')).toBe('')
    expect(sfuBase('')).toBe('')
  })
})

describe('the SFU client', () => {
  it('opens, publishes and subscribes, naming the meeting and the access code', async () => {
    const f = fakeFetch([
      () => ({ body: { sessionId: 'session-abc-1234' } }),
      () => ({ body: { sessionDescription: { type: 'answer', sdp: 'ANSWER' }, tracks: [{ mid: '0', trackName: 'me-video' }] } }),
      () => ({ body: { sessionDescription: { type: 'offer', sdp: 'OFFER' }, tracks: [{ mid: '2', trackName: 'ann-video' }] } }),
      () => ({ body: {} }),
    ])
    const c = new SfuClient({ base: 'https://h/.well-known/hc-meet/sfu', meeting: MEETING, access: 'code-1', fetchImpl: f.fetchImpl })
    expect(await c.open()).toBe('session-abc-1234')
    expect(await c.publish('MY-OFFER', [{ mid: '0', trackName: 'me-video' }])).toEqual({ sdp: 'ANSWER', tracks: [{ mid: '0', trackName: 'me-video' }] })
    const sub = await c.subscribe('session-ann-0000', ['ann-video'])
    expect(sub).toEqual({ offer: 'OFFER', tracks: [{ mid: '2', trackName: 'ann-video' }] })
    await c.renegotiate('MY-ANSWER')

    expect(f.calls.map(x => `${x.method} ${x.url.replace('https://h/.well-known/hc-meet/sfu', '')}`)).toEqual([
      'POST /session',
      'POST /session/session-abc-1234/tracks',
      'POST /session/session-abc-1234/tracks',
      'PUT /session/session-abc-1234/renegotiate',
    ])
    expect(f.calls[0]!.headers['X-Hc-Meeting']).toBe(MEETING)
    expect(f.calls[0]!.headers['X-Hc-Access']).toBe('code-1')
    expect(f.calls[1]!.body).toEqual({ sessionDescription: { type: 'offer', sdp: 'MY-OFFER' }, tracks: [{ location: 'local', mid: '0', trackName: 'me-video' }] })
    expect(f.calls[2]!.body).toEqual({ tracks: [{ location: 'remote', sessionId: 'session-ann-0000', trackName: 'ann-video' }] })
    expect(f.calls[3]!.body).toEqual({ sessionDescription: { type: 'answer', sdp: 'MY-ANSWER' } })
  })

  it('sends one request at a time, even when asked at once', async () => {
    let inFlight = 0
    let most = 0
    const fetchImpl = async (): Promise<Response> => {
      inFlight++; most = Math.max(most, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return new Response(JSON.stringify({ tracks: [] }), { status: 200 })
    }
    const c = new SfuClient({ base: 'https://h', meeting: MEETING, fetchImpl })
    c.sessionId = 'session-abc-1234'
    await Promise.all([c.subscribe('session-a-000000', ['a-video']), c.subscribe('session-b-000000', ['b-video']), c.beat()])
    expect(most).toBe(1)
  })

  it('says why video is off, and a failure does not stall the next request', async () => {
    const f = fakeFetch([
      () => ({ status: 501, body: { error: 'video is not set up on this meeting point' } }),
      () => ({ body: { sessionId: 'session-ok-12345' } }),
    ])
    const c = new SfuClient({ base: 'https://h', meeting: MEETING, fetchImpl: f.fetchImpl })
    await expect(c.open()).rejects.toMatchObject({ status: 501, message: 'video is not set up on this meeting point' })
    await expect(c.open()).resolves.toBe('session-ok-12345')
    expect(new SfuError(429, 'x')).toBeInstanceOf(Error)
  })

  it('reads the spend with a GET naming the meeting, keeping only what it understands', async () => {
    const f = fakeFetch([() => ({ body: {
      month: '2026-11', gb: 12.5, capGb: 500,
      meeting: { gb: 1.25, sessions: { 'session-ann-0000': 0.75, 'session-bob-0000': 0.5, 'x': 9, 'session-bad-0000': 'lots' } },
    } })])
    const c = new SfuClient({ base: 'https://h/.well-known/hc-meet/sfu', meeting: MEETING, access: 'code-1', fetchImpl: f.fetchImpl })
    const spend = await c.spend()
    expect(spend).toEqual({
      month: '2026-11', gb: 12.5, capGb: 500,
      meeting: { gb: 1.25, sessions: { 'session-ann-0000': 0.75, 'session-bob-0000': 0.5, 'session-bad-0000': 0 } },
    })
    expect(f.calls[0]!.method).toBe('GET')
    expect(f.calls[0]!.url).toBe('https://h/.well-known/hc-meet/sfu/spend')
    expect(f.calls[0]!.headers['X-Hc-Meeting']).toBe(MEETING)
    expect(f.calls[0]!.headers['X-Hc-Access']).toBe('code-1')
  })

  it('says why the spend cannot be read', async () => {
    const f = fakeFetch([() => ({ status: 501, body: { error: 'video is not set up on this meeting point' } })])
    const c = new SfuClient({ base: 'https://h', meeting: MEETING, fetchImpl: f.fetchImpl })
    await expect(c.spend()).rejects.toMatchObject({ status: 501 })
  })

  it('closes tracks by mid, forced, and does nothing with none', async () => {
    const f = fakeFetch([() => ({ body: {} })])
    const c = new SfuClient({ base: 'https://h', meeting: MEETING, fetchImpl: f.fetchImpl })
    c.sessionId = 'session-abc-1234'
    await c.close([])
    await c.close(['3', '4'])
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.body).toEqual({ tracks: [{ mid: '3' }, { mid: '4' }], force: true })
  })
})
