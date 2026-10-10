// The meeting point's door: the access code rides the dial as a subprotocol,
// only sha256(code) is kept, a recycle is NIP-98 signed by an operator key and
// in force at once — every socket on the old code is closed — and the router
// sends nothing but the meeting's own requests to the one object.
import test from 'node:test'
import assert from 'node:assert/strict'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import * as main from './worker.js'
import { offeredAccess, codeOpens, checkRecycle, operatorKeys, CODE_PATH } from './access.js'
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
  const object = new MeetingPoint(state, { OPERATOR_KEYS: operatorPub, PARTICIPANTS: 'all', ...env })
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
  assert.equal(JSON.parse(server.sent[0][1].slice(8)).participants, 'all')
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
  assert.equal(body.limitation.participant_uploads, 'all')
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
