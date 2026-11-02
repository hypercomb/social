// sfu.test.js — the meeting point's SFU desk, with Cloudflare faked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GB_PER_MS_PER_VIDEO, SESSION_IDLE_MS, SFU_PREFIX, SfuDesk, checkSfuBody, sfuRoute } from './sfu.js'

const P = SFU_PREFIX.slice(0, -1)

const MEETING = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const OFFER = { type: 'offer', sdp: 'v=0 offer' }
const ANSWER = { type: 'answer', sdp: 'v=0 answer' }

/** A fake Cloudflare: records calls, answers sessions/new with a fresh id and
 *  tracks/new with a mid per track. */
function fakeCloudflare() {
  const calls = []
  let n = 0
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body })
    let data = {}
    if (url.endsWith('/sessions/new')) data = { sessionId: `session-${++n}-xxxxxxxx` }
    else if (url.endsWith('/tracks/new')) data = { tracks: body.tracks.map((t, i) => ({ mid: String(i + 1), trackName: t.trackName })), sessionDescription: ANSWER }
    else data = { ok: true }
    return new Response(JSON.stringify(data), { status: 200 })
  }
  return { calls, fetchImpl }
}

const request = (method, path, body, headers = {}) =>
  new Request(`https://pluginthematrix.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers })

function desk(opts = {}) {
  const cf = fakeCloudflare()
  let now = Date.UTC(2026, 10, 2, 12)
  const d = new SfuDesk({ appId: 'app', token: 'secret-token', monthlyGb: 500, fetchImpl: cf.fetchImpl, now: () => now, ...opts })
  return { d, cf, advance: (ms) => { now += ms }, at: () => now }
}

const open = async (d, meeting = MEETING, ip = '1.1.1.1') => {
  const res = await d.handle(request('POST', `${P}/session`), { ip, meeting })
  return (await res.json()).sessionId
}

test('routes: only the five, only with their methods', () => {
  assert.deepEqual(sfuRoute('POST', `${P}/session`), { op: 'session' })
  assert.deepEqual(sfuRoute('POST', `${P}/session/abcdefgh12/tracks`), { op: 'tracks', sessionId: 'abcdefgh12' })
  assert.deepEqual(sfuRoute('PUT', `${P}/session/abcdefgh12/renegotiate`), { op: 'renegotiate', sessionId: 'abcdefgh12' })
  assert.deepEqual(sfuRoute('PUT', `${P}/session/abcdefgh12/tracks/close`), { op: 'close', sessionId: 'abcdefgh12' })
  assert.deepEqual(sfuRoute('POST', `${P}/session/abcdefgh12/beat`), { op: 'beat', sessionId: 'abcdefgh12' })
  assert.equal(sfuRoute('GET', `${P}/session`), null)
  assert.equal(sfuRoute('POST', `${P}/session/../../apps/x/tracks`), null)
  assert.equal(sfuRoute('DELETE', `${P}/session/abcdefgh12`), null)
  assert.equal(sfuRoute('POST', `${P}/anything`), null)
})

test('bodies: shape-checked and narrowed, never passed through', () => {
  const local = checkSfuBody('tracks', { sessionDescription: OFFER, tracks: [{ location: 'local', mid: '0', trackName: 'me-video', extra: 'x' }], evil: 1 })
  assert.deepEqual(local, { ok: true, body: { tracks: [{ location: 'local', mid: '0', trackName: 'me-video' }], sessionDescription: OFFER } })
  assert.equal(checkSfuBody('tracks', { tracks: [{ location: 'local', mid: '0', trackName: 'x' }] }).ok, false, 'local tracks need an offer')
  assert.equal(checkSfuBody('tracks', { tracks: [{ location: 'elsewhere', trackName: 'x' }] }).ok, false)
  assert.equal(checkSfuBody('renegotiate', { sessionDescription: OFFER }).ok, false, 'renegotiate takes an answer')
  assert.equal(checkSfuBody('close', { tracks: [{ mid: '1' }], force: true }).ok, true)
  assert.equal(checkSfuBody('tracks', { tracks: [] }).ok, false)
})

test('without the app secrets, video is simply off', async () => {
  const d = new SfuDesk({ appId: '', token: '', monthlyGb: 500, fetchImpl: async () => { throw new Error('never') } })
  const res = await d.handle(request('POST', `${P}/session`), { meeting: MEETING })
  assert.equal(res.status, 501)
})

test('the token goes to Cloudflare, never back to the browser', async () => {
  const { d, cf } = desk()
  const id = await open(d)
  assert.match(id, /^session-1/)
  assert.equal(cf.calls[0].url, 'https://rtc.live.cloudflare.com/v1/apps/app/sessions/new')
  assert.equal(cf.calls[0].auth, 'Bearer secret-token')
})

test('a session must name its meeting; seven publishers fill it', async () => {
  const { d } = desk()
  assert.equal((await d.handle(request('POST', `${P}/session`), { meeting: 'nope' })).status, 400)
  for (let i = 0; i < 7; i++) assert.ok(await open(d, MEETING, `10.0.0.${i}`))
  assert.equal((await d.handle(request('POST', `${P}/session`), { ip: '10.0.0.99', meeting: MEETING })).status, 429)
  assert.ok(await open(d, OTHER, '10.0.0.99'), 'another meeting is not full')
})

test('a remote track may only come from the same meeting', async () => {
  const { d } = desk()
  const mine = await open(d, MEETING, '1.1.1.1')
  const theirs = await open(d, OTHER, '2.2.2.2')
  const res = await d.handle(request('POST', `${P}/session/${mine}/tracks`, { tracks: [{ location: 'remote', sessionId: theirs, trackName: 'x-video' }] }), {})
  assert.equal(res.status, 403)
})

test('the ledger charges what is watched, and stops at the ceiling', async () => {
  const { d, advance } = desk({ monthlyGb: 0.05 })
  const a = await open(d, MEETING, '1.1.1.1')
  const b = await open(d, MEETING, '2.2.2.2')
  const sub = await d.handle(request('POST', `${P}/session/${b}/tracks`, { tracks: [{ location: 'remote', sessionId: a, trackName: 'a-video' }, { location: 'remote', sessionId: a, trackName: 'a-audio' }] }), {})
  assert.equal(sub.status, 200)
  advance(60_000)
  await d.handle(request('POST', `${P}/session/${b}/beat`), {})
  await d.sweep()
  const minute = 60_000 * GB_PER_MS_PER_VIDEO
  assert.ok(Math.abs(d.usage.gb - minute) < 1e-9, `one video for a minute, got ${d.usage.gb}`)
  // keep watching until the ceiling is passed
  for (let i = 0; i < 6; i++) { advance(60_000); await d.handle(request('POST', `${P}/session/${b}/beat`), {}) }
  await d.sweep()
  assert.ok(d.usage.gb >= 0.05)
  assert.equal((await d.handle(request('POST', `${P}/session`), { ip: '3.3.3.3', meeting: MEETING })).status, 429)
})

test('a session that goes quiet has its subscriptions closed and stops costing', async () => {
  const { d, cf, advance } = desk()
  const a = await open(d, MEETING, '1.1.1.1')
  const b = await open(d, MEETING, '2.2.2.2')
  await d.handle(request('POST', `${P}/session/${b}/tracks`, { tracks: [{ location: 'remote', sessionId: a, trackName: 'a-video' }] }), {})
  advance(SESSION_IDLE_MS + 1)
  const closed = await d.sweep()
  assert.equal(closed, 1)
  const close = cf.calls.at(-1)
  assert.match(close.url, new RegExp(`/sessions/${b}/tracks/close$`))
  assert.deepEqual(close.body, { tracks: [{ mid: '1' }], force: true })
  const charged = d.usage.gb
  assert.ok(Math.abs(charged - SESSION_IDLE_MS * GB_PER_MS_PER_VIDEO) < 1e-9, 'charged only up to the last beat plus the grace')
  advance(10 * 60_000)
  await d.sweep()
  assert.equal(d.usage.gb, charged)
})

test('a new month starts the ledger again', async () => {
  const { d, advance } = desk({ usage: { month: '2026-11', gb: 499 } })
  assert.equal(d.usage.gb, 499)
  advance(40 * 24 * 3600_000)
  await d.sweep()
  assert.equal(d.usage.month, '2026-12')
  assert.equal(d.usage.gb, 0)
})
