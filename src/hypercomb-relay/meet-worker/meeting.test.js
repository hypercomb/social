// The meeting point's protocol, on a fake clock: what relay.js says on a
// socket, said the same way by the one Durable Object — the host card, the
// address gate, slots, expiry, the drain word, budgets, wills and the reaper.
import test from 'node:test'
import assert from 'node:assert/strict'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Meeting, sha256Hex, eventId, MAX_SUBS_PER_CLIENT, MAX_ADDRESSES_PER_REQ, MAX_ADDRESSES_PER_CONNECTION } from './meeting.js'

const sha = (text) => sha256Hex(text)

function fakeClock(start = Date.now()) {
  let t = start
  const timers = new Set()
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.add(h); return h },
    clearTimer: (h) => { timers.delete(h) },
    advance(ms) {
      const end = t + ms
      for (;;) {
        const due = [...timers].filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.delete(due)
        t = due.at
        due.fn()
      }
      t = end
    },
  }
}

function setup(options = {}) {
  const clock = fakeClock()
  const meeting = new Meeting({ now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, log: () => {}, ...options })
  const open = (ip = '198.51.100.1') => {
    const socket = { inbox: [], closed: null, send(text) { this.inbox.push(JSON.parse(text)) }, close(code, reason) { this.closed = { code, reason } } }
    const client = meeting.connect(socket, { ip })
    return {
      socket, client, inbox: socket.inbox,
      send: (msg) => meeting.message(client, JSON.stringify(msg)),
      events: (subId) => socket.inbox.filter((m) => m[0] === 'EVENT' && (subId === undefined || m[1] === subId)),
      last: () => socket.inbox[socket.inbox.length - 1],
      drop: () => meeting.disconnect(client),
    }
  }
  const nowSec = () => Math.floor(clock.now() / 1000)
  return { clock, meeting, open, nowSec }
}

const key = () => schnorr.utils.randomPrivateKey()
const pub = (secret) => bytesToHex(schnorr.getPublicKey(secret))

function sign(secret, kind, x, content = '{}', extra = [], createdAt) {
  const evt = { pubkey: pub(secret), created_at: createdAt, kind, tags: [['x', x], ...extra], content }
  evt.id = eventId(evt)
  evt.sig = bytesToHex(schnorr.sign(evt.id, secret))
  return evt
}

/** EVENT and its OK. */
function publish(s, evt) {
  s.send(['EVENT', evt])
  const ok = s.inbox.findLast((m) => m[0] === 'OK' && m[1] === evt.id)
  assert.ok(ok, 'every EVENT gets an OK')
  return ok
}

/** REQ and its answer: 'EOSE' or the CLOSED reason. */
function ask(s, subId, ...filters) {
  s.send(['REQ', subId, ...filters])
  const answer = s.inbox.findLast((m) => (m[0] === 'EOSE' || m[0] === 'CLOSED') && m[1] === subId)
  assert.ok(answer, `no answer to ${subId}`)
  return answer[0] === 'EOSE' ? 'EOSE' : answer[2]
}

const HELD_MS = 3_000
const room = (name) => ({ zone: sha(`lifecycle\0${name}\0secret`), page: sha(`/\0${name}\0secret`), broker: sha(`broker:fetch\0${name}\0secret`) })

test('the host card is the first frame: the clock and the byte host policy', () => {
  for (const participants of ['all', false]) {
    const { open, nowSec } = setup({ participants })
    const s = open()
    assert.equal(s.inbox.length, 1)
    assert.equal(s.inbox[0][0], 'NOTICE')
    assert.match(s.inbox[0][1], /^hc:host /)
    const card = JSON.parse(s.inbox[0][1].slice('hc:host '.length))
    assert.deepEqual(card, { v: 1, time: nowSec(), participants, addressed: true })
  }
})

test('a read that names no #x signature is CLOSED: nothing replayed, nothing heard live', () => {
  const { open, nowSec } = setup()
  const a = room('alpha')
  const secret = key()
  const p = open()
  const page = sign(secret, 30200, a.page, '{"visuals":[{"name":"private-tile"}]}', [['d', a.page]], nowSec())
  assert.equal(publish(p, page)[2], true)
  const scan = open()
  const scans = [
    ['kinds', { kinds: [30200, 30204, 30206], limit: 5000 }],
    ['empty', {}],
    ['authors', { authors: [pub(secret)] }],
    ['since', { since: 0 }],
    ['tag-d', { '#d': [a.page] }],
    ['empty-x', { '#x': [] }],
    ['word-x', { '#x': ['visuals'] }],
    ['short-x', { '#x': [a.page.slice(0, 12)] }],
    ['upper-x', { '#x': [a.page.toUpperCase()] }],
    // Exact ids are no address here (relay.js takes them; no client sends them).
    ['ids-only', { ids: [page.id] }],
    ['mixed', { '#x': [a.page] }, { kinds: [30206] }],
  ]
  for (const [subId, ...filters] of scans) assert.match(ask(scan, subId, ...filters), /^restricted: /, subId)
  assert.equal(scan.events().length, 0, 'a scanner is replayed nothing')
  publish(p, sign(secret, 30200, a.page, '{"n":2}', [['d', a.page]], nowSec() + 1))
  publish(p, sign(secret, 20400, 'broker:fetch', '', [['d', a.page]], nowSec()))
  publish(p, sign(secret, 21000, sha('anything'), '{}', [], nowSec()))
  assert.equal(scan.events().length, 0, 'a scanner hears nothing live')
})

test('a malformed filter is CLOSED invalid and the meeting carries on', () => {
  const { open, nowSec } = setup()
  const page = sha('a page')
  const p = open()
  publish(p, sign(key(), 30200, page, '{}', [['d', page]], nowSec()))
  const s = open()
  const malformed = [
    ['kinds-number', { '#x': [page], kinds: 5 }],
    ['kinds-strings', { '#x': [page], kinds: ['30200'] }],
    ['authors-string', { '#x': [page], authors: 'abc' }],
    ['x-string', { '#x': page }],
    ['x-numbers', { '#x': [1, 2] }],
    ['tag-object', { '#x': [page], '#d': { a: 1 } }],
    ['since-string', { '#x': [page], since: 'yesterday' }],
    ['limit-negative', { '#x': [page], limit: -1 }],
    ['too-many-filters', ...Array.from({ length: 11 }, () => ({ '#x': [page] }))],
    ['too-many-addresses', { '#x': Array.from({ length: 257 }, (_, i) => sha(String(i))) }],
  ]
  for (const [subId, ...filters] of malformed) assert.match(ask(s, subId, ...filters), /^(invalid|restricted): /, subId)
  s.send(['REQ', '', { '#x': [page] }])
  assert.match(s.last()[2], /^invalid: subscription id/)
  s.send(['REQ', 'x'.repeat(65), { '#x': [page] }])
  assert.match(s.last()[2], /^invalid: subscription id/)
  s.send('not json at all')
  s.send(['REQ', 'none'])
  assert.equal(s.last()[2], 'invalid: a REQ needs at least one filter object')
  assert.equal(ask(s, 'fine', { '#x': [page], kinds: [30200] }), 'EOSE')
  assert.equal(s.events('fine').length, 1)
})

test('an addressed read replays its address and hears it live; limit:0 replays nothing', () => {
  const { open, nowSec } = setup()
  const a = room('alpha')
  const b = room('beta')
  const secret = key()
  const p = open()
  publish(p, sign(secret, 30200, a.page, '{"n":1}', [['d', a.page]], nowSec()))
  publish(p, sign(secret, 30200, b.page, '{"n":2}', [['d', b.page]], nowSec()))
  const s = open()
  // The exact shape a build in use sends (nostr-mesh sendReq): #x, since, kinds.
  assert.equal(ask(s, 'page', { '#x': [a.page], since: nowSec() - 900, kinds: [30200, 30206] }), 'EOSE')
  assert.deepEqual(s.events('page').map((m) => m[2].content), ['{"n":1}'])
  assert.equal(ask(s, 'both', { '#x': [a.page] }, { '#x': [b.page], kinds: [30200] }), 'EOSE')
  assert.equal(s.events('both').length, 2)
  assert.equal(ask(s, 'dup', { '#x': [a.page] }, { '#x': [a.page] }), 'EOSE')
  assert.equal(s.events('dup').length, 1, 'two filters naming one address replay it once')
  assert.equal(ask(s, 'quiet', { '#x': [a.page], limit: 0 }), 'EOSE')
  assert.equal(s.events('quiet').length, 0)

  publish(p, sign(secret, 30200, a.page, '{"n":3}', [['d', 'n3']], nowSec()))
  assert.ok(s.events('page').some((m) => m[2].content === '{"n":3}'), 'heard live at its address')
  assert.ok(s.events('quiet').some((m) => m[2].content === '{"n":3}'), 'a limit:0 listen hears live')
  publish(p, sign(secret, 30200, sha('elsewhere'), '{"n":4}', [['d', 'x']], nowSec()))
  assert.equal(s.events().filter((m) => m[2].content === '{"n":4}').length, 0, 'never another address')
  assert.equal(p.events().length, 0, 'never echoed to its publisher')

  s.send(['CLOSE', 'page'])
  publish(p, sign(secret, 30200, a.page, '{"n":5}', [['d', 'n5']], nowSec()))
  assert.equal(s.events('page').filter((m) => m[2].content === '{"n":5}').length, 0, 'a CLOSE unroutes')
  assert.match(ask(s, 'quiet', { kinds: [30200] }), /^restricted: /)
  publish(p, sign(secret, 30200, a.page, '{"n":6}', [['d', 'n6']], nowSec()))
  assert.equal(s.events('quiet').filter((m) => m[2].content === '{"n":6}').length, 0, 'a refused REQ ends the subscription it replaced')
})

test('the liveness probe answers EOSE, holds no subscription slot, and can never be heard on', () => {
  const { open, nowSec } = setup({ buckets: { connBurst: 10_000 } })
  const prober = open()
  for (let i = 0; i < 300; i++) assert.equal(ask(prober, 'hc-live', { '#x': ['hc:live'], limit: 0 }), 'EOSE')
  for (let i = 0; i < MAX_SUBS_PER_CLIENT + 50; i++) assert.equal(ask(prober, `probe-${i}`, { '#x': ['hc:live'], limit: 0 }), 'EOSE')
  publish(open(), sign(key(), 21000, 'hc:live', '{"spam":true}', [], nowSec()))
  assert.equal(prober.events().length, 0)
})

test('slots: the newest wins, a tie goes to the lowest id, a stale write is not fanned out', () => {
  const { open, nowSec, meeting } = setup()
  const x = sha('slot')
  const secret = key()
  const p = open()
  const watcher = open()
  ask(watcher, 'w', { '#x': [x] })
  const t = nowSec()
  publish(p, sign(secret, 30200, x, '{"v":"old"}', [['d', 'same']], t - 10))
  const newer = sign(secret, 30200, x, '{"v":"new"}', [['d', 'same']], t)
  publish(p, newer)
  const stale = sign(secret, 30200, x, '{"v":"stale"}', [['d', 'same']], t - 5)
  assert.equal(publish(p, stale)[2], true, 'a stale write is accepted — the publisher did nothing wrong')
  assert.equal(watcher.events('w').filter((m) => m[2].content === '{"v":"stale"}').length, 0)
  // Equal created_at: the lowest id holds the slot.
  const twins = [sign(secret, 30200, x, '{"v":"a"}', [['d', 'tie']], t), sign(secret, 30200, x, '{"v":"b"}', [['d', 'tie']], t)]
  for (const e of twins) publish(p, e)
  const late = open()
  ask(late, 'r', { '#x': [x] })
  const contents = late.events('r').map((m) => m[2].content).sort()
  const lowest = twins.slice().sort((a, b) => a.id < b.id ? -1 : 1)[0].content
  assert.deepEqual(contents, ['{"v":"new"}', lowest].sort())
  assert.equal(meeting.storedEvents, 2, 'one event per slot')
  // A duplicate is acknowledged as one.
  assert.match(publish(p, newer)[3], /^duplicate:/)
})

test('ephemeral kinds are fanned out by address and never kept; a write at a word is refused', () => {
  const { open, nowSec, meeting } = setup()
  const x = sha('ephemeral')
  const p = open()
  const live = open()
  ask(live, 'l', { '#x': [x] })
  publish(p, sign(key(), 20400, x, '', [['d', 'ask']], nowSec()))
  assert.equal(live.events('l').length, 1, 'heard live')
  assert.match(publish(p, sign(key(), 30401, 'not-a-signature', 'Ynl0ZXM=', [['d', 'w']], nowSec()))[3], /^restricted: /)
  assert.match(publish(p, sign(key(), 30401, 'broker:fetch', 'Ynl0ZXM=', [['d', 'w']], nowSec()))[3], /^restricted: /, 'the drained word takes only the ask and its cancel')
  assert.equal(publish(p, sign(key(), 20402, 'broker:fetch', '', [['d', 'w']], nowSec()))[2], true)
  assert.equal(meeting.storedEvents, 0, 'nothing kept')
  const late = open()
  ask(late, 'l', { '#x': [x] })
  assert.equal(late.events('l').length, 0, 'an ephemeral event is never replayed')
})

test('NIP-40: an expired event is never replayed, and the sweep lets it go', () => {
  const { open, nowSec, meeting, clock } = setup()
  const x = sha('beacons')
  const p = open()
  publish(p, sign(key(), 30206, x, '{"alive":true}', [['d', 'gone'], ['expiration', String(nowSec() - 5)]], nowSec() - 10))
  publish(p, sign(key(), 30206, x, '{"alive":true}', [['d', 'soon'], ['expiration', String(nowSec() + 30)]], nowSec()))
  const s = open()
  ask(s, 'a', { '#x': [x] })
  assert.equal(s.events('a').length, 1, 'only the unexpired beacon')
  clock.advance(31_000)
  ask(s, 'b', { '#x': [x] })
  assert.equal(s.events('b').length, 0, 'expired since — not replayed even before the sweep')
  p.send(['REQ', 'keepalive', { '#x': ['hc:live'], limit: 0 }])
  s.send(['REQ', 'keepalive', { '#x': ['hc:live'], limit: 0 }])
  meeting.sweep()
  assert.equal(meeting.storedEvents, 0, 'the sweep dropped both')
})

test("the drained word 'broker:fetch' reaches only connections that beaconed the same zone", () => {
  const { open, nowSec } = setup()
  const a = room('alpha')
  const b = room('beta')
  const keys = { holder: key(), asker: key(), other: key() }
  const beacon = (secret, zone) => sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + 90)]], nowSec())
  const holder = open(); const asker = open(); const other = open(); const scanner = open()
  publish(holder, beacon(keys.holder, a.zone))
  publish(asker, beacon(keys.asker, a.zone))
  publish(other, beacon(keys.other, b.zone))
  for (const s of [holder, asker, other, scanner]) assert.equal(ask(s, 'broker', { '#x': ['broker:fetch'], kinds: [20400, 20402] }), 'EOSE')
  const fetchAsk = sign(keys.asker, 20400, 'broker:fetch', '', [['d', a.page], ['t', 'visuals']], nowSec())
  publish(asker, fetchAsk)
  assert.equal(holder.events('broker').length, 1, "alpha's holder hears alpha's ask")
  assert.equal(other.events().length, 0, "beta never hears alpha's ask")
  assert.equal(scanner.events().length, 0, 'a scanner hears no ask')
  // Leaving the zone leaves its asks.
  publish(asker, sign(keys.asker, 30206, a.zone, '{"left":true}', [['d', pub(keys.asker)], ['expiration', String(nowSec() + 90)]], nowSec() + 1))
  publish(asker, sign(keys.asker, 20400, 'broker:fetch', '', [['d', sha('after')]], nowSec()))
  assert.equal(holder.events('broker').length, 1, 'nothing after {left}')
  // The room-scoped channel the new builds use is an ordinary address.
  const fresh = open()
  assert.equal(ask(fresh, 'room-broker', { '#x': [a.broker] }), 'EOSE')
  publish(holder, sign(keys.holder, 20400, a.broker, '', [['d', a.page]], nowSec()))
  assert.equal(fresh.events('room-broker').length, 1)
})

test("the drained word follows a connection's own NEWEST beacon — a lost {left} never leaves it in two rooms", () => {
  const { open, nowSec, clock } = setup()
  const a = room('alpha')
  const b = room('beta')
  const keys = { mover: key(), inAlpha: key(), inBeta: key() }
  const beacon = (secret, zone, ttl = 90) => sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + ttl)]], nowSec())
  const mover = open(); const alpha = open(); const beta = open()
  publish(alpha, beacon(keys.inAlpha, a.zone))
  publish(beta, beacon(keys.inBeta, b.zone))
  for (const s of [alpha, beta]) assert.equal(ask(s, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')
  publish(mover, beacon(keys.mover, a.zone))
  clock.advance(1_000)
  publish(mover, beacon(keys.mover, b.zone))  // moved to beta; alpha's {left} was lost
  const asked = sign(keys.mover, 20400, 'broker:fetch', '', [['d', sha('wanted')]], nowSec())
  publish(mover, asked)
  assert.equal(beta.events('broker').length, 1, 'beta hears the ask')
  assert.equal(alpha.events('broker').length, 0, 'alpha does not')
  // An expired beacon is no room at all.
  const lapsing = open()
  publish(lapsing, beacon(key(), b.zone, 2))
  clock.advance(3_000)
  publish(lapsing, sign(key(), 20400, 'broker:fetch', '', [['d', sha('late')]], nowSec()))
  clock.advance(HELD_MS + 1)
  assert.equal(beta.events('broker').length, 1, 'nothing from a lapsed beacon')
})

test("replaying a member's signed event never places a stranger in the member's room", () => {
  const { open, nowSec, clock } = setup()
  const a = room('alpha')
  const victim = key()
  const v = open()
  publish(v, sign(victim, 30206, a.zone, '{"alive":true}', [['d', pub(victim)], ['expiration', String(nowSec() + 90)]], nowSec()))
  assert.equal(ask(v, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')
  const note = sign(victim, 30213, sha('a public page'), '{"n":1}', [['d', 'note']], nowSec())
  publish(v, note)
  const stranger = open()
  publish(stranger, note)  // replayed: 'duplicate', but the key has now spoken on this socket
  assert.equal(ask(stranger, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')
  publish(v, sign(victim, 20400, 'broker:fetch', '', [['d', sha('a private picture')]], nowSec()))
  assert.equal(stranger.events('broker').length, 0, "the stranger hears none of the room's asks")
  publish(stranger, sign(key(), 20400, 'broker:fetch', '', [['d', sha('anyone?')]], nowSec()))
  clock.advance(HELD_MS + 1)
  assert.equal(v.events('broker').length, 0, "and the room hears none of the stranger's")
})

test('an ask on the word before the beacon is held for it — 16 at most, for 3 s', () => {
  const { open, nowSec, clock } = setup()
  const a = room('alpha')
  const holder = key()
  const h = open()
  publish(h, sign(holder, 30206, a.zone, '{"alive":true}', [['d', pub(holder)], ['expiration', String(nowSec() + 90)]], nowSec()))
  assert.equal(ask(h, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')
  // An older build reopening: it flushes its queue before it beacons again.
  const joiner = key()
  const j = open()
  for (let i = 0; i < 20; i++) publish(j, sign(joiner, 20400, 'broker:fetch', '', [['d', sha('queued ' + i)]], nowSec()))
  assert.equal(h.events('broker').length, 0, 'not before the joiner is in a room')
  publish(j, sign(joiner, 30206, a.zone, '{"alive":true}', [['d', pub(joiner)], ['expiration', String(nowSec() + 90)]], nowSec()))
  assert.equal(h.events('broker').length, 16, 'the newest 16 are heard the moment it beacons')
  // Held past 3 s is dropped.
  const slow = open()
  const late = key()
  publish(slow, sign(late, 20400, 'broker:fetch', '', [['d', sha('too early')]], nowSec()))
  clock.advance(HELD_MS + 1)
  publish(slow, sign(late, 30206, a.zone, '{"alive":true}', [['d', pub(late)], ['expiration', String(nowSec() + 90)]], nowSec()))
  assert.equal(h.events('broker').length, 16, 'an ask held past 3 s is never routed')
})

test('addresses are capped per REQ (16) and per connection (256 live)', () => {
  const { open } = setup()
  const s = open()
  const xs = (n, tag) => Array.from({ length: n }, (_, i) => sha(`${tag}${i}`))
  assert.equal(MAX_ADDRESSES_PER_REQ, 16)
  assert.equal(MAX_ADDRESSES_PER_CONNECTION, 256)
  assert.match(ask(s, 'wide', { '#x': xs(17, 'w') }), /^invalid: at most 16 addresses/)
  assert.match(ask(s, 'split', { '#x': xs(9, 'a') }, { '#x': xs(8, 'b') }), /^invalid: at most 16 addresses/)
  for (let i = 0; i < 16; i++) assert.equal(ask(s, `s${i}`, { '#x': xs(16, `c${i}-`), limit: 0 }), 'EOSE')
  assert.match(ask(s, 'one-more', { '#x': [sha('more')] }), /^error: too many live addresses/)
  assert.equal(ask(s, 's0', { '#x': xs(16, 'replacing'), limit: 0 }), 'EOSE', 'replacing a subscription frees its addresses')
  s.send(['CLOSE', 's1'])
  assert.equal(ask(s, 'room', { '#x': [sha('room')], limit: 0 }), 'EOSE', 'a CLOSE frees them too')
})

test('budgets are per connection under a venue ceiling, and a CLOSE is never refused', () => {
  const { open, clock } = setup({ buckets: { connBurst: 40, connPerSec: 1, ipBurst: 100, ipPerSec: 10 } })
  const refused = (s) => s.inbox.filter((m) => (m[0] === 'CLOSED' && /^rate-limited:/.test(m[2])) || (m[0] === 'OK' && m[2] === false && /^rate-limited:/.test(m[3]))).length
  const flood = (s, n) => { for (let i = 0; i < n; i++) s.send(['REQ', 'p', { '#x': ['hc:live'], limit: 0 }]) }
  const hot = open('203.0.113.5')
  const watched = sha('watched')
  ask(hot, 'watch', { '#x': [watched] })
  flood(hot, 60)
  assert.equal(refused(hot), 21, 'past its own burst, a connection is refused')
  hot.send(['CLOSE', 'watch'])
  const writer = open('192.0.2.9')
  publish(writer, sign(key(), 30200, watched, '{}', [['d', 'w']], Math.floor(clock.now() / 1000)))
  assert.equal(hot.events('watch').length, 0, 'a CLOSE under refusal still closed')
  const neighbour = open('203.0.113.5')
  flood(neighbour, 39)
  assert.equal(refused(neighbour), 0, 'a neighbour at the venue has its own budget')
  const third = open('203.0.113.5')
  flood(third, 39)
  assert.ok(refused(third) > 0, 'until the venue ceiling is spent')
  const elsewhere = open('192.0.2.10')
  flood(elsewhere, 39)
  assert.equal(refused(elsewhere), 0, 'another address does not notice')
  clock.advance(5_000)
  const before = refused(hot)
  flood(hot, 5)
  assert.equal(refused(hot), before, 'the budget refills with time')
})

test('a connection holds at most 200 subscriptions', () => {
  const { open } = setup()
  const s = open()
  for (let i = 0; i < MAX_SUBS_PER_CLIENT; i++) assert.equal(ask(s, `s${i}`, { '#x': [sha(String(i))], limit: 0 }), 'EOSE')
  assert.match(ask(s, 'one-more', { '#x': [sha('more')] }), /^error: too many subscriptions/)
  assert.equal(ask(s, 's0', { '#x': [sha('replaced')], limit: 0 }), 'EOSE', 'replacing an id is no new subscription')
})

test('a will waits out its grace; a beacon cancels it; a refreshed tab is never tombstoned; an heir inherits', () => {
  const { open, clock, nowSec, meeting } = setup()
  const zone = sha('zone')
  const watcher = open()
  ask(watcher, 'zone', { '#x': [zone] })
  const lefts = () => watcher.events('zone').filter((m) => JSON.parse(m[2].content).left === true)
  const beacon = (secret) => sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + 90)]], nowSec())
  const [crashed, refreshed, returned, heir] = [key(), key(), key(), key()]

  const lone = open(); publish(lone, beacon(crashed))
  const oldTab = open(); publish(oldTab, beacon(refreshed))
  const newTab = open(); publish(newTab, beacon(refreshed))
  const before = open(); publish(before, beacon(returned))
  const a = open(); publish(a, beacon(heir))
  const b = open(); publish(b, beacon(heir))

  for (const s of [lone, oldTab, before, a]) s.drop()
  assert.equal(meeting.pendingWills, 2, 'the lone socket and the returner wait; the refreshed and heir slots do not')
  clock.advance(5_000)
  const after = open(); publish(after, beacon(returned))
  clock.advance(9_999)
  assert.equal(lefts().length, 0, 'nothing before the grace')
  clock.advance(1)
  assert.deepEqual(lefts().map((m) => m[2].pubkey), [pub(crashed)], 'the lone socket, at exactly 15 s')
  const tomb = lefts()[0][2]
  assert.equal(tomb.sig, '', 'made by the meeting point')
  assert.equal(tomb.created_at, nowSec(), 'stamped when it fired — newer than any beacon')
  assert.equal(tomb.id, eventId(tomb))

  b.drop()
  clock.advance(15_000)
  assert.ok(lefts().some((m) => m[2].pubkey === pub(heir)), 'the heir inherited the will and it fired when the heir went')
  assert.ok(!lefts().some((m) => m[2].pubkey === pub(refreshed)), 'a refreshed tab is never tombstoned by its old socket')
  assert.ok(!lefts().some((m) => m[2].pubkey === pub(returned)), 'a beacon within the grace cancelled the will')

  // Late joiners read the tombstone from the slot.
  const late = open()
  ask(late, 'z', { '#x': [zone] })
  assert.ok(late.events('z').some((m) => m[2].pubkey === pub(crashed) && JSON.parse(m[2].content).left === true))
})

test('a same-key tab that never beaconed inherits no will and its word cancels none', () => {
  const { open, clock, nowSec } = setup()
  const zone = sha('zone')
  const watcher = open()
  ask(watcher, 'zone', { '#x': [zone] })
  const secret = key()
  const joined = open(); publish(joined, sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + 90)]], nowSec()))
  const unjoined = open(); publish(unjoined, sign(secret, 30207, sha('c'), '{}', [['d', 'c:1']], nowSec()))
  joined.drop()
  clock.advance(5_000)
  publish(unjoined, sign(secret, 30207, sha('c'), '{"n":2}', [['d', 'c:2']], nowSec()))
  clock.advance(10_000)
  assert.equal(watcher.events('zone').filter((m) => JSON.parse(m[2].content).left === true).length, 1)
})

test('a socket that says nothing for two minutes is reaped, and its will waits like any other', () => {
  const { open, clock, nowSec, meeting } = setup()
  const zone = sha('zone')
  const secret = key()
  const quiet = open()
  publish(quiet, sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + 90)]], nowSec()))
  const chatty = open()
  for (let i = 0; i < 12; i++) {
    clock.advance(10_000)
    chatty.send(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }])
    meeting.sweep()
  }
  assert.deepEqual(quiet.socket.closed, { code: 1001, reason: 'idle: nothing heard from this socket' })
  assert.equal(chatty.socket.closed, null, 'a socket that probes stays')
  assert.equal(meeting.size, 1)
  assert.equal(meeting.pendingWills, 1)
})

test('closeAll closes every socket with its code, and each will waits out its grace', () => {
  const { open, nowSec, meeting } = setup()
  const zone = sha('zone')
  const secret = key()
  const s = open()
  publish(s, sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + 90)]], nowSec()))
  const t = open()
  assert.equal(meeting.closeAll(4401, 'access: code recycled'), 2)
  for (const x of [s, t]) assert.deepEqual(x.socket.closed, { code: 4401, reason: 'access: code recycled' })
  assert.equal(meeting.size, 0)
  assert.equal(meeting.pendingWills, 1)
})

test('the store is bounded: past its bytes an event is refused, never the meeting', () => {
  const { open, nowSec, meeting } = setup({ storeMaxBytes: 4000 })
  const p = open()
  const x = sha('big')
  const secret = key()
  let refused = null
  for (let i = 0; i < 40 && !refused; i++) {
    const ok = publish(p, sign(secret, 30200, x, 'y'.repeat(300), [['d', `d${i}`]], nowSec()))
    if (ok[2] === false) refused = ok[3]
  }
  assert.equal(refused, 'error: the meeting point is full — try again shortly')
  assert.ok(meeting.storedBytes <= 4000)
  // Replacing a held slot with an event of the same size still fits.
  const ok = publish(p, sign(secret, 30200, x, 'z'.repeat(300), [['d', 'd0']], nowSec() + 1))
  assert.equal(ok[2], true)
})

test('an oversized frame is refused with its reason, and a bad signature never lands', () => {
  const { open, nowSec } = setup({ maxMessageBytes: 2048 })
  const p = open()
  const big = sign(key(), 30200, sha('x'), 'q'.repeat(4000), [['d', 'x']], nowSec())
  p.send(['EVENT', big])
  assert.deepEqual(p.last(), ['OK', big.id, false, 'invalid: message exceeds 2048 bytes'])
  p.send(['REQ', 'r', { '#x': [sha('x')], pad: 'p'.repeat(4000) }])
  assert.deepEqual(p.last(), ['NOTICE', 'error: message exceeds 2048 bytes'])
  const forged = { ...sign(key(), 30200, sha('x'), '{}', [['d', 'x']], nowSec()), content: '{"forged":true}' }
  assert.deepEqual(publish(p, forged).slice(2), [false, 'invalid: bad signature'])
  const future = sign(key(), 30200, sha('x'), '{}', [['d', 'x']], nowSec() + 3600)
  assert.match(publish(p, future)[3], /^invalid: created_at is too far in the future/)
})

test('the minute line counts and never names anyone', () => {
  const { open, nowSec, meeting } = setup()
  const zone = sha('zone')
  const secret = key()
  const s = open('203.0.113.77')
  publish(s, sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + 90)]], nowSec()))
  ask(s, 'scan', {})
  const line = meeting.census()
  assert.match(line, /^\[minute\] open 1 /)
  assert.match(line, /unaddressed 1/)
  assert.match(line, new RegExp(`zones ${zone.slice(0, 6)}:1`))
  assert.ok(!line.includes(pub(secret)) && !line.includes(zone) && !line.includes('203.0.113.77'))
  s.drop()
  meeting.census()
  assert.equal(meeting.census(), null, 'nothing to say, nothing said')
})
