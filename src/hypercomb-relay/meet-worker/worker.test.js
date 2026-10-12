// The meeting point's door: the access code rides the dial as a subprotocol,
// only sha256(code) is kept, a recycle is NIP-98 signed by an operator key and
// in force at once — every socket on the old code is closed — and the router
// sends nothing but the meeting's own requests to the one object.
import test from 'node:test'
import assert from 'node:assert/strict'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import * as main from './worker.js'
import { offeredAccess, codeOpens, checkRecycle, isOpenHost, operatorKeys, CODE_PATH } from './access.js'
import { sha256Hex, eventId } from './meeting.js'
import { DEFAULT_LINK_TEMPLATE, meetingLink, nip98, newCode, publisherKeys, secretKeyBytes } from './scripts/recycle-code.mjs'
import { readFileSync } from 'node:fs'

const { default: worker, MeetingPoint } = main
const operator = schnorr.utils.randomPrivateKey()
const operatorPub = bytesToHex(schnorr.getPublicKey(operator))
const stranger = schnorr.utils.randomPrivateKey()
const CODE_URL = `https://pluginthematrix.com${CODE_PATH}`
const nowSec = () => Math.floor(Date.now() / 1000)

// ── Workers globals, faked just enough for node ─────────────────────────────

class FakeSocket {
  sent = []
  closedWith = null
  accepted = null
  #attachment
  send(text) { if (this.closedWith) throw new Error('closed'); this.sent.push(JSON.parse(text)) }
  close(code, reason) { if (this.closedWith) throw new Error('already closed'); this.closedWith = { code, reason } }
  accept() { this.accepted = 'standard' }
  serializeAttachment(value) { this.#attachment = structuredClone(value) }
  deserializeAttachment() { return this.#attachment }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket() } }
// node's Response refuses 101; workerd answers an upgrade with one.
const RealResponse = globalThis.Response
const upgrades = new WeakSet()
globalThis.Response = class extends RealResponse {
  constructor(body, init = {}) {
    super(init.status === 101 ? null : body, init.status === 101 ? { ...init, status: 200 } : init)
    if (init.status === 101) { upgrades.add(this); this.webSocket = init.webSocket }
  }
  get status() { return upgrades.has(this) ? 101 : super.status }
}

const intervals = new Set()
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
globalThis.setInterval = (fn, ms) => { const h = realSetInterval(fn, ms); h.unref?.(); intervals.add(h); return h }
globalThis.clearInterval = (h) => { intervals.delete(h); realClearInterval(h) }

function fakeState(stored = new Map(), sockets = new Set()) {
  let ready = Promise.resolve()
  return {
    stored, sockets,
    get ready() { return ready },
    storage: { get: async (k) => structuredClone(stored.get(k)), put: async (k, v) => { stored.set(k, structuredClone(v)) } },
    blockConcurrencyWhile(fn) { ready = fn(); return ready },
    acceptWebSocket(ws) { ws.accepted = 'hibernation'; sockets.add(ws) },
    getWebSockets() { return [...sockets].filter((ws) => !ws.closedWith) },
  }
}

async function meetingPoint(env = {}, state = fakeState()) {
  // PARTICIPANTS as both deployed configs carry it: '' — the meeting point names
  // no upload host (jwize 2026-10-11, "we can't give hosting away for free").
  const object = new MeetingPoint(state, { OPERATOR_KEYS: operatorPub, PARTICIPANTS: '', ...env })
  await state.ready
  return { object, state }
}

async function dial(object, protocols) {
  const headers = { upgrade: 'websocket' }
  if (protocols) headers['sec-websocket-protocol'] = protocols
  const res = await object.fetch(new Request('https://pluginthematrix.com/', { headers }))
  assert.equal(res.status, 101)
  // The server end is the other half of the pair the object made.
  return { res, server: [...(globalThis.__lastPairs ?? [])].pop() }
}

// Track the server half of each pair, the way the runtime would hand it to the object.
const RealPair = globalThis.WebSocketPair
globalThis.WebSocketPair = class extends RealPair {
  constructor() { super(); (globalThis.__lastPairs ??= []).push(this[1]) }
}

async function recycle(object, body, key = operator, at = nowSec(), url = CODE_URL) {
  const text = JSON.stringify(body)
  return object.fetch(new Request(url, { method: 'POST', headers: { authorization: nip98(url, text, key, at) }, body: text }))
}

// ── helpers ──────────────────────────────────────────────────────────────────

test('the main module exports only what the Workers runtime takes: the handler and the object class', () => {
  assert.deepEqual(Object.keys(main).sort(), ['MeetingPoint', 'default'])
})

test('the access token is the first hc-access.<code> subprotocol, echoed verbatim', () => {
  assert.equal(offeredAccess(null), null)
  assert.equal(offeredAccess('chat, superchat'), null)
  assert.deepEqual(offeredAccess('chat, hc-access.abcDEF_-123, hc-access.second'), { token: 'hc-access.abcDEF_-123', code: 'abcDEF_-123' })
})

test('a code opens the door only when it hashes to the hash in force', () => {
  const code = newCode()
  assert.match(code, /^[A-Za-z0-9_-]{32}$/)
  const hash = sha256Hex(code)
  assert.equal(codeOpens(code, hash), true)
  assert.equal(codeOpens(newCode(), hash), false)
  assert.equal(codeOpens(code, null), false, 'a closed door opens for nobody')
  assert.equal(codeOpens('short', sha256Hex('short')), false, 'a code is at least 16 token characters')
  assert.equal(codeOpens('has space in it!!!!', sha256Hex('has space in it!!!!')), false)
})

test('operator keys are 64-hex public keys; anything else is ignored', () => {
  assert.deepEqual([...operatorKeys({ OPERATOR_KEYS: ` ${operatorPub.toUpperCase()}, npub1nope ,${'b'.repeat(64)}` })], [operatorPub, 'b'.repeat(64)])
  assert.equal(operatorKeys({}).size, 0)
})

test('a recycle is NIP-98 signed by an operator, binds its body, is fresh, and moves only forward', () => {
  const operators = new Set([operatorPub])
  const body = JSON.stringify({ hash: sha256Hex('a-new-code-for-the-room') })
  const at = nowSec()
  const base = { url: CODE_URL, method: 'POST', body, operators, nowSec: at }
  const ok = checkRecycle({ ...base, authorization: nip98(CODE_URL, body, operator, at) })
  assert.deepEqual(ok, { ok: true, pubkey: operatorPub, hash: sha256Hex('a-new-code-for-the-room'), at })
  const close = JSON.stringify({ close: true })
  assert.equal(checkRecycle({ ...base, body: close, authorization: nip98(CODE_URL, close, operator, at) }).hash, null)

  const refused = (over, status, reason) => {
    const verdict = checkRecycle({ ...base, ...over })
    assert.equal(verdict.ok, false)
    assert.equal(verdict.status, status, verdict.reason)
    assert.match(verdict.reason, reason)
  }
  refused({ authorization: null }, 401, /missing/)
  refused({ authorization: nip98(CODE_URL, body, operator, at), operators: new Set() }, 503, /no operator keys/)
  refused({ authorization: nip98(CODE_URL, body, stranger, at) }, 403, /not an operator/)
  refused({ authorization: nip98(CODE_URL, body, operator, at - 120) }, 401, /freshness/)
  refused({ authorization: nip98('https://elsewhere.example/.well-known/hc-meet/code', body, operator, at) }, 401, /u tag/)
  refused({ authorization: nip98(CODE_URL, JSON.stringify({ hash: sha256Hex('another') }), operator, at) }, 401, /payload/)
  refused({ authorization: nip98(CODE_URL, body, operator, at), method: 'PUT' }, 401, /method/)
  refused({ authorization: nip98(CODE_URL, body, operator, at), inForceAt: at }, 409, /stale/)
  const notJson = 'hash please'
  refused({ body: notJson, authorization: nip98(CODE_URL, notJson, operator, at) }, 400, /JSON/)
  const badHash = JSON.stringify({ hash: 'not-a-hash' })
  refused({ body: badHash, authorization: nip98(CODE_URL, badHash, operator, at) }, 400, /64-hex/)
  // A forged signature: a valid event from the operator with its content changed.
  const evt = JSON.parse(Buffer.from(nip98(CODE_URL, body, operator, at).slice(6), 'base64').toString())
  evt.tags.push(['extra', '1'])
  refused({ authorization: 'Nostr ' + Buffer.from(JSON.stringify(evt)).toString('base64') }, 401, /signature/)
  // The wrong kind, signed properly.
  const kind1 = { ...evt, kind: 1, tags: evt.tags.slice(0, 3) }
  kind1.id = eventId(kind1)
  kind1.sig = bytesToHex(schnorr.sign(kind1.id, operator))
  refused({ authorization: 'Nostr ' + Buffer.from(JSON.stringify(kind1)).toString('base64') }, 401, /kind/)
})

test('an nsec and a hex key read the same', () => {
  // NIP-19 test vector.
  const nsec = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'
  assert.equal(bytesToHex(secretKeyBytes(nsec)), '67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa')
  assert.equal(bytesToHex(secretKeyBytes('67DEA2ED018072D675F5415ECFAED7D2597555E202D85B3D65EA4E58D2D92FFA')), '67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa')
  assert.throws(() => secretKeyBytes(nsec.slice(0, -1) + 'q'), /checksum/)
  assert.throws(() => secretKeyBytes('npub1abc'), /nsec/)
})

// ── the object ───────────────────────────────────────────────────────────────

test('a fresh meeting point is closed: every dial is accepted and closed 4401 with no data', async () => {
  const { object, state } = await meetingPoint()
  for (const protocols of [undefined, 'hc-access.' + newCode()]) {
    const { res, server } = await dial(object, protocols)
    assert.equal(server.accepted, 'standard', 'never one of the object\'s sockets')
    assert.deepEqual(server.closedWith, { code: 4401, reason: 'access: the meeting point is closed' })
    assert.deepEqual(server.sent, [], 'not one frame — not even the host card')
    assert.equal(res.headers.get('sec-websocket-protocol'), protocols ?? null)
  }
  assert.equal(state.sockets.size, 0)
  assert.equal(intervals.size, 0)
})

test('the right code is let in (card first); a wrong or missing code is refused', async () => {
  const { object, state } = await meetingPoint()
  const code = newCode()
  const set = await recycle(object, { hash: sha256Hex(code) })
  assert.equal(set.status, 200, await set.clone().text())
  assert.deepEqual(await set.json(), { ok: true, open: true, closed: 0 })
  assert.deepEqual([...state.stored.keys()], ['access'])
  assert.deepEqual(Object.keys(state.stored.get('access')).sort(), ['at', 'hash'])
  assert.ok(!JSON.stringify([...state.stored]).includes(code), 'the code itself is never kept')

  const { res, server } = await dial(object, `chat, hc-access.${code}`)
  assert.equal(res.headers.get('sec-websocket-protocol'), `hc-access.${code}`, 'the token is echoed, so a browser completes the handshake')
  assert.equal(server.accepted, 'hibernation')
  assert.equal(server.closedWith, null)
  assert.match(server.sent[0][1], /^hc:host /)
  assert.equal(JSON.parse(server.sent[0][1].slice(8)).participants, false, 'the coded point names no upload host either')
  assert.equal(intervals.size, 1, 'the sweep is armed while anyone is here')

  const wrong = await dial(object, 'hc-access.' + newCode())
  assert.deepEqual(wrong.server.closedWith, { code: 4401, reason: 'access: code refused' })
  const missing = await dial(object)
  assert.deepEqual(missing.server.closedWith, { code: 4401, reason: 'access: code required' })

  // Frames reach the meeting by the socket's attachment.
  object.webSocketMessage(server, JSON.stringify(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }]))
  assert.deepEqual(server.sent.at(-1), ['EOSE', 'hc-live'])
  object.webSocketClose(server, 1001, 'bye', true)
  assert.equal(intervals.size, 0, 'the sweep stops with the last socket')
})

test('a recycle is in force at once: every socket on the old code is closed 4401, the old code opens nothing', async () => {
  const { object } = await meetingPoint({ DIAG_WILL_GRACE_MS: '20' })
  const first = newCode()
  const at = nowSec()
  assert.equal((await recycle(object, { hash: sha256Hex(first) }, operator, at - 2)).status, 200)
  const a = (await dial(object, 'hc-access.' + first)).server
  const b = (await dial(object, 'hc-access.' + first)).server
  // a is in a room; its will must wait out the grace like any dropped socket.
  const zone = sha256Hex('zone')
  const secret = schnorr.utils.randomPrivateKey()
  const beacon = { pubkey: bytesToHex(schnorr.getPublicKey(secret)), created_at: at, kind: 30206, tags: [['x', zone], ['d', 'me'], ['expiration', String(at + 90)]], content: '{"alive":true}' }
  beacon.id = eventId(beacon)
  beacon.sig = bytesToHex(schnorr.sign(beacon.id, secret))
  object.webSocketMessage(a, JSON.stringify(['EVENT', beacon]))
  assert.deepEqual(a.sent.at(-1), ['OK', beacon.id, true, ''])

  const second = newCode()
  const res = await recycle(object, { hash: sha256Hex(second) }, operator, at)
  assert.deepEqual(await res.json(), { ok: true, open: true, closed: 2 })
  for (const s of [a, b]) assert.deepEqual(s.closedWith, { code: 4401, reason: 'access: code recycled' })
  assert.deepEqual((await dial(object, 'hc-access.' + first)).server.closedWith, { code: 4401, reason: 'access: code refused' })
  const c = (await dial(object, 'hc-access.' + second)).server
  assert.equal(c.closedWith, null)

  // Re-posting the code in force changes nothing and cuts nobody.
  const same = await recycle(object, { hash: sha256Hex(second) }, operator, at + 1)
  assert.deepEqual(await same.json(), { ok: true, unchanged: true, closed: 0 })
  assert.equal(c.closedWith, null)
  // An older signed recycle cannot bring a destroyed code back.
  assert.equal((await recycle(object, { hash: sha256Hex(first) }, operator, at - 1)).status, 409)
  // A stranger cannot recycle at all.
  assert.equal((await recycle(object, { hash: sha256Hex(newCode()) }, stranger, at + 2)).status, 403)

  // Destroyed without a successor: everyone out, nobody in.
  const shut = await recycle(object, { close: true }, operator, at + 3)
  assert.deepEqual(await shut.json(), { ok: true, open: false, closed: 1 })
  assert.deepEqual(c.closedWith, { code: 4401, reason: 'access: the meeting point is closed' })
  assert.deepEqual((await dial(object, 'hc-access.' + second)).server.closedWith, { code: 4401, reason: 'access: the meeting point is closed' })
  assert.equal(intervals.size, 0)
})

test('the code in force survives the object: a new incarnation reads the hash and closes sockets it has no memory of', async () => {
  const stored = new Map()
  const sockets = new Set()
  const code = newCode()
  const first = await meetingPoint({}, fakeState(stored, sockets))
  assert.equal((await recycle(first.object, { hash: sha256Hex(code) })).status, 200)
  const held = (await dial(first.object, 'hc-access.' + code)).server
  // The runtime evicts the object; the socket is still open on its side.
  const second = await meetingPoint({}, fakeState(stored, sockets))
  assert.deepEqual(held.closedWith, { code: 1012, reason: 'restart: the meeting point lost its memory — reconnect' })
  const again = (await dial(second.object, 'hc-access.' + code)).server
  assert.equal(again.closedWith, null, 'the code in force is read back from storage')
  second.object.webSocketClose(again, 1000, '', true)
  first.object.webSocketClose(held, 1012, '', true)
})

test('a frame from a socket the object does not know is answered with 1012, never processed', async () => {
  const { object } = await meetingPoint()
  const orphan = new FakeSocket()
  orphan.serializeAttachment({ id: 'from-an-earlier-incarnation' })
  object.webSocketMessage(orphan, JSON.stringify(['REQ', 'x', { '#x': [sha256Hex('x')] }]))
  assert.deepEqual(orphan.sent, [])
  assert.equal(orphan.closedWith.code, 1012)
})

test('NIP-11 says what the meeting point is, and nothing else is answered', async () => {
  const { object } = await meetingPoint()
  const info = await object.fetch(new Request('https://pluginthematrix.com/', { headers: { accept: 'application/nostr+json' } }))
  assert.equal(info.status, 200)
  const body = await info.json()
  assert.equal(body.limitation.addressed_reads, true)
  assert.equal(body.limitation.access_code, true)
  assert.equal(body.limitation.participant_uploads, false, 'no upload host is advertised')
  assert.ok(!JSON.stringify(body).includes(operatorPub), 'no operator key is published')
  assert.equal((await object.fetch(new Request('https://pluginthematrix.com/anything'))).status, 404)
  assert.equal((await object.fetch(new Request(CODE_URL))).status, 405)
})

test('the router sends only the meeting\'s requests to the one object — and refuses a dial in front of it whenever it can', async () => {
  const code = newCode()
  const asked = []
  const env = {
    LOCATION_HINT: 'wnam',
    MEETING: {
      idFromName: (name) => ({ name }),
      get: (id, options) => ({
        fetch: async (request) => {
          const path = new URL(request.url).pathname
          asked.push({ id, options, path, upgrade: String(request.headers.get('upgrade') || '').toLowerCase() === 'websocket' })
          if (path === '/.well-known/hc-meet/door') return new RealResponse(JSON.stringify({ hash: sha256Hex(code) }))
          return new RealResponse('object')
        },
      }),
    },
  }
  const upgrade = (path, protocols) => {
    const headers = { upgrade: 'websocket' }
    if (protocols) headers['sec-websocket-protocol'] = protocols
    return worker.fetch(new Request(`https://pluginthematrix.com${path}`, { headers }), env)
  }
  const refusedInFront = async (res, token) => {
    assert.equal(res.status, 101)
    const server = globalThis.__lastPairs.at(-1)
    assert.equal(server.closedWith?.code, 4401)
    assert.deepEqual(server.sent, [], 'not one frame')
    assert.equal(res.headers.get('sec-websocket-protocol'), token, 'the offered token is echoed')
  }
  assert.equal((await worker.fetch(new Request('https://pluginthematrix.com/some/page'), env)).status, 404)
  assert.equal((await worker.fetch(new Request('https://pluginthematrix.com/'), env)).status, 404)
  assert.equal((await worker.fetch(new Request('https://pluginthematrix.com/.well-known/hc-meet/door'), env)).status, 404, 'the hash is never asked from outside')
  // A recycle through the router forgets this isolate's copy of the hash.
  await worker.fetch(new Request(CODE_URL, { method: 'POST', body: '{}' }), env)

  // No code, or nothing shaped like one: the object never hears of it.
  await refusedInFront(await upgrade('/'), null)
  await refusedInFront(await upgrade('/io', 'chat'), null)
  await refusedInFront(await upgrade('/', 'hc-access.short'), 'hc-access.short')
  assert.equal(asked.filter((a) => a.upgrade || a.path.endsWith('/door')).length, 0)

  // A flood of wrong codes costs the object one question, not one dial each.
  for (let i = 0; i < 50; i++) {
    const token = `hc-access.${newCode()}`
    await refusedInFront(await upgrade('/', token), token)
  }
  assert.equal(asked.filter((a) => a.path.endsWith('/door')).length, 1, 'one door question for the whole flood')
  assert.equal(asked.filter((a) => a.upgrade).length, 0, 'no wrong code reached the object')

  // The code in force is forwarded — on any path, so /io works too.
  await upgrade('/', `hc-access.${code}`)
  await upgrade('/io', `chat, hc-access.${code}`)
  assert.equal(asked.filter((a) => a.upgrade).length, 2)
  await worker.fetch(new Request('https://pluginthematrix.com/', { headers: { accept: 'application/nostr+json' } }), env)
  assert.ok(asked.every((a) => a.id.name === 'meet' && a.options?.locationHint === 'wnam'), 'one object, created in the hinted region')
})

test('recycling never uses the install publisher key, and the meeting link it prints is one an older package refuses', () => {
  const publishers = publisherKeys()
  assert.ok(publishers.size >= 1, 'this checkout carries the publisher record')
  const toml = readFileSync(new URL('./wrangler.meet.toml', import.meta.url), 'utf8')
  const operators = operatorKeys({ OPERATOR_KEYS: /^OPERATOR_KEYS\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? '' })
  for (const key of operators) assert.ok(!publishers.has(key), 'OPERATOR_KEYS names the publisher key')
  const link = meetingLink(DEFAULT_LINK_TEMPLATE, 'wss://pluginthematrix.com', 'Abc_123-xyz')
  assert.match(link, /&relay=wss%3A%2F%2Fpluginthematrix\.com&code=Abc_123-xyz$/)
  // The parser of every package before the meeting point splits on '/' and
  // refuses a part that decodes to one: this link is no link to it.
  const fragment = link.slice(link.indexOf('#meet=') + '#meet='.length)
  assert.ok(fragment.split('/').some((part) => decodeURIComponent(part).includes('/')))
})

test('a door question that fails is no refusal: the dial goes to the object, which checks the code itself', async () => {
  // The real object behind the router, its code set by its operator.
  const { object } = await meetingPoint()
  const code = newCode()
  assert.equal((await recycle(object, { hash: sha256Hex(code) })).status, 200)
  let failures = 0                 // door questions still to fail
  let failWith = 'throw'           // how: a rejected fetch, or an answer that is no answer
  let doorAsked = 0
  let forwarded = 0
  const env = {
    MEETING: {
      idFromName: (name) => ({ name }),
      get: () => ({
        fetch: async (request) => {
          const path = new URL(request.url).pathname
          if (path === CODE_PATH) return new RealResponse('{}')  // a recycle answered: this isolate forgets its copy
          if (path === '/.well-known/hc-meet/door') {
            doorAsked++
            if (failures > 0) {
              failures--
              if (failWith === 'throw') throw new Error('Durable Object reset because its code was updated.')
              return new RealResponse('overloaded', { status: 503 })
            }
          }
          if (String(request.headers.get('upgrade') || '').toLowerCase() === 'websocket') forwarded++
          return object.fetch(request)
        },
      }),
    },
  }
  const dialRouter = async (token) => {
    const res = await worker.fetch(new Request('https://pluginthematrix.com/', { headers: { upgrade: 'websocket', 'sec-websocket-protocol': token } }), env)
    assert.equal(res.status, 101)
    return globalThis.__lastPairs.at(-1)
  }
  // A FRESH isolate (a phone woke on another colo; a deploy recycled the
  // isolates): no copy of the hash in force.
  await worker.fetch(new Request(CODE_URL, { method: 'POST', body: '{}' }), env)

  failures = 1
  const first = await dialRouter(`hc-access.${code}`)
  assert.equal(first.closedWith, null, 'the current code is let in — never 4401 for a code nobody refused')
  assert.equal(first.accepted, 'hibernation', 'one of the object\'s own sockets')
  assert.equal(forwarded, 1, 'forwarded, not answered in front')

  failWith = 'answer'
  failures = 1
  const second = await dialRouter(`hc-access.${code}`)
  assert.equal(second.closedWith, null, 'an answer that is no answer (503, not JSON) is a failed question too')
  assert.equal(forwarded, 2)

  // A wrong code forwarded while the door cannot be asked is still refused —
  // by the object, which checks every code it is handed.
  failWith = 'throw'
  failures = 1
  const wrong = await dialRouter(`hc-access.${newCode()}`)
  assert.deepEqual(wrong.closedWith, { code: 4401, reason: 'access: code refused' })
  assert.deepEqual(wrong.sent, [], 'not one frame')

  // Once the door answers, a wrong code is refused in front again: the
  // object hears nothing of a flood.
  const before = forwarded
  for (let i = 0; i < 10; i++) assert.equal((await dialRouter(`hc-access.${newCode()}`)).closedWith?.code, 4401)
  assert.equal(forwarded, before, 'no wrong code reached the object once the door answered')
  assert.ok(doorAsked >= 4)
  for (const s of [first, second]) object.webSocketClose(s, 1000, '', true)
})

// ── the open default and the coded meeting points (jwize 2026-10-11) ────────
//
// "yes, open default on hypercomb.com": the shipped default takes no code (D8)
// and lives in its own object; a coded host keeps its door, its code and its
// object exactly as before. A host is open only when MEET_OPEN_HOSTS names it.

const OPEN_ENV = { MEET_OPEN_HOSTS: 'hypercomb.com' }

async function dialAt(object, url, protocols) {
  const headers = { upgrade: 'websocket' }
  if (protocols) headers['sec-websocket-protocol'] = protocols
  const res = await object.fetch(new Request(url, { headers }))
  assert.equal(res.status, 101)
  return { res, server: globalThis.__lastPairs.at(-1) }
}

/** Forget this isolate's copy of a coded door an earlier test left behind. */
async function forgetDoor() {
  const env = { MEETING: { idFromName: (name) => ({ name }), get: () => ({ fetch: async () => new RealResponse('{}') }) } }
  await worker.fetch(new Request(CODE_URL, { method: 'POST', body: '{}' }), env)
}

test('a host is open only when MEET_OPEN_HOSTS names it exactly', () => {
  assert.equal(isOpenHost(OPEN_ENV, 'hypercomb.com'), true)
  assert.equal(isOpenHost(OPEN_ENV, 'HyperComb.COM'), true)
  assert.equal(isOpenHost({ MEET_OPEN_HOSTS: ' pluginthematrix.net , hypercomb.com ' }, 'hypercomb.com'), true)
  for (const host of ['pluginthematrix.com', 'www.hypercomb.com', 'hypercomb.com.', 'evilhypercomb.com', 'hypercomb.com.evil.test', '']) {
    assert.equal(isOpenHost(OPEN_ENV, host), false, host)
  }
  assert.equal(isOpenHost({}, 'hypercomb.com'), false, 'no list: every host is coded')
  assert.equal(isOpenHost({ MEET_OPEN_HOSTS: '' }, ''), false)
})

test('the open host admits a codeless dial and serves the card first; an offered code is echoed and ignored', async () => {
  const { object, state } = await meetingPoint(OPEN_ENV)
  // No code was ever set: a coded host here would be closed to everyone.
  const plain = await dialAt(object, 'https://hypercomb.com/')
  assert.equal(plain.res.headers.get('sec-websocket-protocol'), null)
  assert.equal(plain.server.accepted, 'hibernation', 'one of the object\'s own sockets')
  assert.equal(plain.server.closedWith, null)
  assert.match(plain.server.sent[0][1], /^hc:host /, 'the card is the first frame')
  const card = JSON.parse(plain.server.sent[0][1].slice('hc:host '.length))
  assert.equal(card.participants, false, 'the meeting point is never anyone\'s upload host: no default host')
  assert.equal(card.addressed, true, 'the address gate holds at the open default too')

  // A package that still carries a code from a meeting link offers it: echoed
  // so the browser completes the handshake, and nothing else.
  for (const token of [`hc-access.${newCode()}`, 'hc-access.short', 'hc-access.has-no-hash-anywhere']) {
    const coded = await dialAt(object, 'https://hypercomb.com/io', `chat, ${token}`)
    assert.equal(coded.res.headers.get('sec-websocket-protocol'), token)
    assert.equal(coded.server.closedWith, null, token)
    assert.equal(coded.server.accepted, 'hibernation')
  }

  // The address gate is the same gate: a scan is refused, an address is read.
  object.webSocketMessage(plain.server, JSON.stringify(['REQ', 'scan', { kinds: [30206], limit: 1 }]))
  assert.match(plain.server.sent.at(-1)[2], /^restricted: /)
  object.webSocketMessage(plain.server, JSON.stringify(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }]))
  assert.deepEqual(plain.server.sent.at(-1), ['EOSE', 'hc-live'])

  // NIP-11 says it is open; there is no code to recycle here, and nothing is kept.
  const info = await (await object.fetch(new Request('https://hypercomb.com/', { headers: { accept: 'application/nostr+json' } }))).json()
  assert.equal(info.limitation.access_code, false)
  assert.equal(info.limitation.addressed_reads, true)
  assert.equal(info.limitation.participant_uploads, false)
  const recycled = await recycle(object, { hash: sha256Hex(newCode()) }, operator, nowSec(), `https://hypercomb.com${CODE_PATH}`)
  assert.equal(recycled.status, 404)
  assert.equal(state.stored.size, 0, 'an open meeting point stores no code')
  for (const s of state.getWebSockets()) object.webSocketClose(s, 1000, '', true)
  assert.equal(intervals.size, 0)
})

test('a coded host keeps its door beside an open one: codeless and wrong codes close 4401, its NIP-11 says access_code', async () => {
  const { object } = await meetingPoint(OPEN_ENV)
  // Closed until its operator sets a code — whatever is open elsewhere.
  for (const host of ['pluginthematrix.com', 'www.hypercomb.com']) {
    const { server } = await dialAt(object, `https://${host}/`)
    assert.deepEqual(server.closedWith, { code: 4401, reason: 'access: the meeting point is closed' }, host)
    assert.deepEqual(server.sent, [], 'not one frame')
  }
  const code = newCode()
  assert.equal((await recycle(object, { hash: sha256Hex(code) })).status, 200)
  const none = await dialAt(object, 'https://pluginthematrix.com/')
  assert.deepEqual(none.server.closedWith, { code: 4401, reason: 'access: code required' })
  const wrong = await dialAt(object, 'https://pluginthematrix.com/', `hc-access.${newCode()}`)
  assert.deepEqual(wrong.server.closedWith, { code: 4401, reason: 'access: code refused' })
  assert.deepEqual(wrong.server.sent, [])
  const right = await dialAt(object, 'https://pluginthematrix.com/', `hc-access.${code}`)
  assert.equal(right.server.closedWith, null)
  const info = await (await object.fetch(new Request('https://pluginthematrix.com/', { headers: { accept: 'application/nostr+json' } }))).json()
  assert.equal(info.limitation.access_code, true)
  object.webSocketClose(right.server, 1000, '', true)
})

test('open and coded hosts go to different objects: the open dial never reaches a coded meeting, and needs no door question', async () => {
  const code = newCode()
  const asked = []
  const env = {
    ...OPEN_ENV,
    LOCATION_HINT: 'wnam',
    MEETING: {
      idFromName: (name) => ({ name }),
      get: (id, options) => ({
        fetch: async (request) => {
          const url = new URL(request.url)
          asked.push({ object: id.name, options, path: url.pathname, upgrade: String(request.headers.get('upgrade') || '').toLowerCase() === 'websocket' })
          if (url.pathname === '/.well-known/hc-meet/door') return new RealResponse(JSON.stringify({ hash: sha256Hex(code) }))
          return new RealResponse(`object ${id.name}`)
        },
      }),
    },
  }
  const upgrade = (url, protocols) => {
    const headers = { upgrade: 'websocket' }
    if (protocols) headers['sec-websocket-protocol'] = protocols
    return worker.fetch(new Request(url, { headers }), env)
  }
  await forgetDoor()

  // The open default: codeless, any path, a stale code — all to 'open', and the door is never asked.
  for (const [url, protocols] of [['https://hypercomb.com/'], ['https://hypercomb.com/io'], ['https://HYPERCOMB.com/', `hc-access.${newCode()}`]]) {
    assert.equal(await (await upgrade(url, protocols)).text(), 'object open', url)
  }
  assert.deepEqual(asked.map((a) => [a.object, a.upgrade]), [['open', true], ['open', true], ['open', true]])
  assert.ok(asked.every((a) => a.options?.locationHint === 'wnam'))

  // The coded point: refused in front without a code, and only the coded object is ever asked.
  const before = asked.length
  const refused = await upgrade('https://pluginthematrix.com/')
  assert.equal(refused.status, 101)
  assert.equal(globalThis.__lastPairs.at(-1).closedWith?.code, 4401)
  assert.equal(asked.length, before, 'a codeless dial at a coded host reaches no object at all')
  assert.equal(await (await upgrade('https://pluginthematrix.com/', `hc-access.${code}`)).text(), 'object meet')
  assert.deepEqual(asked.slice(before).map((a) => [a.object, a.path, a.upgrade]),
    [['meet', '/.well-known/hc-meet/door', false], ['meet', '/', true]])

  // NIP-11 goes to each host's own object; the recycle path is the coded host's alone.
  const nip11 = (host) => worker.fetch(new Request(`https://${host}/`, { headers: { accept: 'application/nostr+json' } }), env)
  assert.equal(await (await nip11('hypercomb.com')).text(), 'object open')
  assert.equal(await (await nip11('pluginthematrix.com')).text(), 'object meet')
  const mark = asked.length
  const openRecycle = await worker.fetch(new Request(`https://hypercomb.com${CODE_PATH}`, { method: 'POST', body: '{}' }), env)
  assert.equal(openRecycle.status, 404)
  assert.equal(asked.length, mark, 'a recycle at an open host reaches neither object')
  assert.equal((await worker.fetch(new Request('https://hypercomb.com/'), env)).status, 404, 'the open host\'s pages are not the meeting point\'s')

  // Without MEET_OPEN_HOSTS the same host is coded: refused in front.
  const n = asked.length
  const res = await worker.fetch(new Request('https://hypercomb.com/', { headers: { upgrade: 'websocket' } }), { ...env, MEET_OPEN_HOSTS: '' })
  assert.equal(res.status, 101)
  assert.deepEqual(globalThis.__lastPairs.at(-1).closedWith, { code: 4401, reason: 'access: code required' })
  assert.equal(asked.length, n)
})

test('through the router, the open default and a private meeting are two rooms of sockets: neither object hears the other', async () => {
  const open = await meetingPoint(OPEN_ENV)
  const coded = await meetingPoint(OPEN_ENV)
  const code = newCode()
  assert.equal((await recycle(coded.object, { hash: sha256Hex(code) })).status, 200)
  const objects = { open: open.object, meet: coded.object }
  const env = { ...OPEN_ENV, MEETING: { idFromName: (name) => ({ name }), get: (id) => ({ fetch: (request) => objects[id.name].fetch(request) }) } }
  await forgetDoor()
  const dialRouter = async (url, protocols) => {
    const headers = { upgrade: 'websocket' }
    if (protocols) headers['sec-websocket-protocol'] = protocols
    const res = await worker.fetch(new Request(url, { headers }), env)
    assert.equal(res.status, 101)
    return globalThis.__lastPairs.at(-1)
  }
  const guest = await dialRouter('https://hypercomb.com/')
  const member = await dialRouter('https://pluginthematrix.com/', `hc-access.${code}`)
  assert.equal(guest.closedWith, null)
  assert.equal(member.closedWith, null)
  assert.ok(open.state.sockets.has(guest) && !open.state.sockets.has(member), 'the open object holds only the open dial')
  assert.ok(coded.state.sockets.has(member) && !coded.state.sockets.has(guest), 'the coded object holds only its member')

  // One zone, both points: a beacon at the open default never reaches the private meeting.
  const zone = sha256Hex('lifecycle\0downtown\0rose')
  coded.object.webSocketMessage(member, JSON.stringify(['REQ', 'zone', { '#x': [zone] }]))
  const secret = schnorr.utils.randomPrivateKey()
  const at = nowSec()
  const beacon = { pubkey: bytesToHex(schnorr.getPublicKey(secret)), created_at: at, kind: 30206, tags: [['x', zone], ['d', 'me'], ['expiration', String(at + 90)]], content: '{"alive":true}' }
  beacon.id = eventId(beacon)
  beacon.sig = bytesToHex(schnorr.sign(beacon.id, secret))
  open.object.webSocketMessage(guest, JSON.stringify(['EVENT', beacon]))
  assert.deepEqual(guest.sent.at(-1), ['OK', beacon.id, true, ''])
  assert.equal(member.sent.filter((m) => m[0] === 'EVENT').length, 0, 'the private meeting hears nothing of the open room')

  // Destroying the private code cuts its member and nobody at the open default.
  const shut = await recycle(coded.object, { close: true }, operator, nowSec() + 1)
  assert.deepEqual(await shut.json(), { ok: true, open: false, closed: 1 })
  assert.equal(member.closedWith?.code, 4401)
  assert.equal(guest.closedWith, null)
  open.object.webSocketClose(guest, 1000, '', true)
  assert.equal(intervals.size, 0)
})

test('the deployed configs: hypercomb.com — and only it — is open, in a script of its own; the coded script names no open host', () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
  const value = (toml, name) => new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(toml)?.[1]
  const open = read('./wrangler.meet-open.toml')
  const coded = read('./wrangler.meet.toml')
  assert.equal(value(open, 'MEET_OPEN_HOSTS'), 'hypercomb.com')
  assert.equal(isOpenHost({ MEET_OPEN_HOSTS: value(open, 'MEET_OPEN_HOSTS') }, 'pluginthematrix.com'), false, 'the coded meeting point stays coded')
  assert.equal(value(coded, 'MEET_OPEN_HOSTS'), undefined, 'the coded script holds no open object')
  assert.equal(isOpenHost({ MEET_OPEN_HOSTS: value(coded, 'MEET_OPEN_HOSTS') }, 'hypercomb.com'), false)
  // Two scripts — objects of one script may share an isolate — of one worker.
  assert.equal(value(open, 'name'), 'hypercomb-meet-open')
  assert.equal(value(coded, 'name'), 'hypercomb-meet')
  for (const toml of [open, coded]) {
    assert.equal(value(toml, 'main'), 'worker.js')
    assert.equal(value(toml, 'PARTICIPANTS'), '', 'no default host: the card says participants false (jwize 2026-10-11)')
    assert.match(toml, /^workers_dev\s*=\s*false/m, 'no address of its own: only the service binding reaches it')
    assert.doesNotMatch(toml, /^routes?\s*=/m)
  }
})

test('the card says what PARTICIPANTS says: empty or unset is false, only a host that keeps participants\' bytes says all or zones', async () => {
  for (const [participants, said] of [[undefined, false], ['', false], ['  ', false], ['yes', false], ['ALL', 'all'], ['zones', 'zones']]) {
    const { object, state } = await meetingPoint({ ...OPEN_ENV, PARTICIPANTS: participants })
    const { server } = await dialAt(object, 'https://hypercomb.com/')
    assert.equal(JSON.parse(server.sent[0][1].slice('hc:host '.length)).participants, said, String(participants))
    for (const s of state.getWebSockets()) object.webSocketClose(s, 1000, '', true)
  }
  assert.equal(intervals.size, 0)
})

test('a dial past the socket ceiling is closed BUSY (1013) before a frame: one address holds 32 at most', async () => {
  const { object, state } = await meetingPoint(OPEN_ENV)
  const dialFrom = async (ip, protocols) => {
    const headers = { upgrade: 'websocket', 'cf-connecting-ip': ip }
    if (protocols) headers['sec-websocket-protocol'] = protocols
    const res = await object.fetch(new Request('https://hypercomb.com/', { headers }))
    assert.equal(res.status, 101)
    return { res, server: globalThis.__lastPairs.at(-1) }
  }
  const held = []
  for (let i = 0; i < 32; i++) {
    const { server } = await dialFrom('203.0.113.77')
    assert.equal(server.closedWith, null, `socket ${i + 1}`)
    held.push(server)
  }
  const token = `hc-access.${newCode()}`
  const busy = await dialFrom('203.0.113.77', token)
  assert.deepEqual(busy.server.closedWith, { code: 1013, reason: 'busy: at most 32 connections from one address' })
  assert.deepEqual(busy.server.sent, [], 'not one frame')
  assert.equal(busy.server.accepted, 'standard', "never one of the object's sockets")
  assert.equal(busy.res.headers.get('sec-websocket-protocol'), token, 'the offered token is still echoed')
  assert.equal((await dialFrom('198.51.100.77')).server.closedWith, null, 'another address is let in')
  object.webSocketClose(held[0], 1000, '', true)
  assert.equal((await dialFrom('203.0.113.77')).server.closedWith, null, 'a socket that left frees its place')
  for (const s of state.getWebSockets()) object.webSocketClose(s, 1000, '', true)
  assert.equal(intervals.size, 0)
})
