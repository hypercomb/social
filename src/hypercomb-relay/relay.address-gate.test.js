// The address gate: the signatures are the only thing that can be queried.
// A scanner that knows no room — kinds only, authors only, `{}`, a word, a
// malformed filter — is CLOSED with nothing replayed and hears nothing live;
// a read that names a signature (or exact ids) works as it always did; the
// one drained word, 'broker:fetch', reaches only connections that beaconed
// the same zone; and a read costs the index, never the store.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { HOST_PACKAGES_POOL } from './replicate.js'

const sha = text => createHash('sha256').update(text).digest('hex')
/** A NIP-98 Authorization header, as a hive signs an HTTP write. */
function nip98(secret, url, method, body) {
  const tags = [['u', url], ['method', method]]
  if (body) tags.push(['payload', sha(body)])
  const evt = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, secret)
  return `Nostr ${Buffer.from(JSON.stringify(evt)).toString('base64')}`
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const nowSec = () => Math.floor(Date.now() / 1000)
const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})

async function relay(args = [], env = {}) {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-gate-'))
  const child = spawn(process.execPath, ['relay.js', '--port', String(port), '--content-dir', dir, ...args],
    { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DIAG_RATE_LIMIT: '600000', ...env } })
  const out = []
  child.stdout.on('data', chunk => out.push(...String(chunk).split('\n').filter(Boolean)))
  child.stderr.on('data', chunk => out.push(...String(chunk).split('\n').filter(Boolean)))
  let exited = null
  child.on('exit', code => { exited = code })
  const base = `http://127.0.0.1:${port}`
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (tries > 100) assert.fail(`relay did not start at ${base}`)
    await sleep(50)
  }
  return { port, base, out, alive: () => exited === null, close: () => { child.kill(); rmSync(dir, { recursive: true, force: true }) } }
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const inbox = []
  const waiters = []
  ws.on('message', raw => {
    const msg = JSON.parse(String(raw))
    inbox.push(msg)
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg) }
  })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  return {
    ws, inbox,
    send: msg => ws.send(JSON.stringify(msg)),
    events: subId => inbox.filter(m => m[0] === 'EVENT' && (subId === undefined || m[1] === subId)),
    wait: (pred, ms = 3000, from = 0) => new Promise(resolve => {
      const hit = inbox.slice(from).find(pred)
      if (hit) return resolve(hit)
      const w = { pred, resolve }
      waiters.push(w)
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null) } }, ms)
    }),
  }
}

const event = (secret, kind, x, content = '{}', extra = []) =>
  finalizeEvent({ kind, created_at: nowSec(), tags: [['x', x], ...extra], content }, secret)
const beacon = (secret, zone) =>
  event(secret, 30206, zone, JSON.stringify({ alive: true }), [['d', getPublicKey(secret)], ['expiration', String(nowSec() + 90)]])
const leave = (secret, zone) =>
  event(secret, 30206, zone, JSON.stringify({ left: true }), [['d', getPublicKey(secret)], ['expiration', String(nowSec() + 90)]])

async function publish(socket, evt) {
  socket.send(['EVENT', evt])
  const ok = await socket.wait(m => m[0] === 'OK' && m[1] === evt.id)
  assert.equal(ok?.[2], true, `EVENT refused: ${ok?.[3]}`)
}

/** Send an EVENT that must be refused; its OK-false reason. */
async function refused(socket, evt) {
  socket.send(['EVENT', evt])
  const ok = await socket.wait(m => m[0] === 'OK' && m[1] === evt.id)
  assert.equal(ok?.[2], false, `EVENT ${evt.id.slice(0, 8)} was accepted`)
  return ok[3]
}

/** REQ and wait for its answer: 'EOSE' or the CLOSED reason. */
async function ask(socket, subId, ...filters) {
  const from = socket.inbox.length
  socket.send(['REQ', subId, ...filters])
  const answer = await socket.wait(m => (m[0] === 'EOSE' || m[0] === 'CLOSED') && m[1] === subId, 3000, from)
  assert.ok(answer, `no answer to ${subId}`)
  return answer[0] === 'EOSE' ? 'EOSE' : answer[2]
}

// A room: its lifecycle zone and a page, both derived from its secret.
const room = (name) => ({ zone: sha(`lifecycle\0${name}\0secret`), page: sha(`/\0${name}\0secret`), broker: sha(`broker:fetch\0${name}\0secret`) })

test('a read that names no signature is CLOSED: nothing replayed, nothing heard live', { timeout: 30_000 }, async () => {
  const r = await relay(['--allow-participants'])
  const sockets = []
  try {
    const a = room('alpha')
    const key = generateSecretKey()
    const pub = await connect(r.port)
    sockets.push(pub)
    await publish(pub, beacon(key, a.zone))
    await publish(pub, event(key, 30200, a.page, JSON.stringify({ visuals: [{ name: 'private-tile' }] }), [['d', a.page]]))
    const presence = event(key, 30204, sha('presence:x'), JSON.stringify({ pathSegments: ['secret'] }), [['d', 'p']])
    await publish(pub, presence)
    const storedId = presence.id

    const scan = await connect(r.port)
    sockets.push(scan)
    const scans = [
      ['kinds', { kinds: [30200, 30204, 30206], limit: 5000 }],
      ['empty', {}],
      ['authors', { authors: [getPublicKey(key)] }],
      ['since', { since: 0 }],
      ['tag-d', { '#d': [a.page] }],
      ['tag-t', { '#t': ['visuals'] }],
      ['empty-x', { '#x': [] }],
      ['word-x', { '#x': ['visuals'] }],
      ['short-x', { '#x': [a.page.slice(0, 12)] }],
      ['upper-x', { '#x': [a.page.toUpperCase()] }],
      ['bad-ids', { ids: ['abc'] }],
      ['empty-ids', { ids: [] }],
      // One unaddressed filter refuses the whole REQ, however addressed the rest is.
      ['mixed', { '#x': [a.page] }, { kinds: [30206] }],
    ]
    for (const [subId, ...filters] of scans) {
      const answer = await ask(scan, subId, ...filters)
      assert.match(answer, /^restricted: /, `${subId} must be refused, got ${answer}`)
    }
    assert.equal(scan.events().length, 0, 'a scanner is replayed nothing')

    // Live: everything published after the scans, by every kind the swarm
    // uses, reaches none of the refused subscriptions.
    await publish(pub, event(key, 30200, a.page, JSON.stringify({ visuals: [{ name: 'after' }] }), [['d', a.page]]))
    await publish(pub, event(key, 30206, a.zone, JSON.stringify({ alive: true }), [['d', getPublicKey(key)], ['expiration', String(nowSec() + 90)]]))
    await publish(pub, event(key, 20400, 'broker:fetch', '', [['d', a.page], ['t', 'visuals']]))
    await publish(pub, event(key, 21000, sha('anything'), '{}'))
    await sleep(300)
    assert.equal(scan.events().length, 0, 'a scanner hears nothing live')

    // Exact ids are an address: the one event named, and nothing else.
    assert.equal(await ask(scan, 'by-id', { ids: [storedId] }), 'EOSE')
    assert.equal(scan.events('by-id').length, 1)
    assert.equal(scan.events('by-id')[0][2].id, storedId)

    assert.ok(r.alive())
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('a malformed filter is CLOSED invalid — it never takes the relay down', { timeout: 20_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const page = sha('a page')
    const key = generateSecretKey()
    const pub = await connect(r.port)
    sockets.push(pub)
    await publish(pub, event(key, 30200, page, '{}', [['d', page]]))
    const s = await connect(r.port)
    sockets.push(s)
    // `kinds: 5` threw inside matchFilter and killed the process (review 2026-10-07).
    const malformed = [
      ['kinds-number', { '#x': [page], kinds: 5 }],
      ['kinds-strings', { '#x': [page], kinds: ['30200'] }],
      ['authors-string', { '#x': [page], authors: 'abc' }],
      ['ids-object', { ids: { 0: page } }],
      ['x-string', { '#x': page }],
      ['x-numbers', { '#x': [1, 2] }],
      ['tag-object', { '#x': [page], '#d': { a: 1 } }],
      ['since-string', { '#x': [page], since: 'yesterday' }],
      ['limit-negative', { '#x': [page], limit: -1 }],
      ['too-many-filters', ...Array.from({ length: 11 }, () => ({ '#x': [page] }))],
      ['too-many-addresses', { '#x': Array.from({ length: 257 }, (_, i) => sha(String(i))) }],
    ]
    for (const [subId, ...filters] of malformed) {
      const answer = await ask(s, subId, ...filters)
      assert.match(answer, /^(invalid|restricted): /, `${subId}: ${answer}`)
    }
    assert.equal(s.events().length, 0)
    await sleep(100)
    assert.ok(r.alive(), 'the relay is still running')
    // … and still answers an addressed read.
    assert.equal(await ask(s, 'fine', { '#x': [page], kinds: [30200] }), 'EOSE')
    assert.equal(s.events('fine').length, 1)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('an addressed read replays its address and hears it live, as before', { timeout: 20_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const a = room('alpha')
    const b = room('beta')
    const key = generateSecretKey()
    const pub = await connect(r.port)
    sockets.push(pub)
    await publish(pub, event(key, 30200, a.page, '{"n":1}', [['d', a.page]]))
    await publish(pub, event(key, 30200, b.page, '{"n":2}', [['d', b.page]]))
    await publish(pub, event(key, 30206, a.zone, '{"alive":true}', [['d', 'expired'], ['expiration', String(nowSec() - 5)]]))

    // The exact shape a build in use sends (nostr-mesh sendReq): #x, since, kinds.
    const s = await connect(r.port)
    sockets.push(s)
    assert.equal(await ask(s, 'page', { '#x': [a.page], since: nowSec() - 900, kinds: [30200, 30201, 30202, 30206] }), 'EOSE')
    assert.deepEqual(s.events('page').map(m => m[2].content), ['{"n":1}'], 'only its own address — never another room')
    // An expired beacon at the address is never replayed.
    assert.equal(await ask(s, 'zone', { '#x': [a.zone] }), 'EOSE')
    assert.equal(s.events('zone').length, 0)
    // Two addresses, two filters: each answered from its own address.
    assert.equal(await ask(s, 'both', { '#x': [a.page] }, { '#x': [b.page], kinds: [30200] }), 'EOSE')
    assert.equal(s.events('both').length, 2)

    // Live at its address; not at another one.
    await publish(pub, event(key, 30200, a.page, '{"n":3}', [['d', 'n3']]))
    assert.ok(await s.wait(m => m[0] === 'EVENT' && m[1] === 'page' && m[2].content === '{"n":3}'))
    await publish(pub, event(key, 30200, sha('elsewhere'), '{"n":4}', [['d', 'x']]))
    await sleep(200)
    assert.equal(s.events().filter(m => m[2].content === '{"n":4}').length, 0)

    // A subscription by exact id hears that id when it arrives.
    const later = event(key, 30200, sha('later'), '{"n":5}', [['d', 'later']])
    assert.equal(await ask(s, 'wait-id', { ids: [later.id] }), 'EOSE')
    await publish(pub, later)
    assert.ok(await s.wait(m => m[0] === 'EVENT' && m[1] === 'wait-id' && m[2].id === later.id))

    // A refused REQ ends the subscription it replaced: nothing more arrives on 'page'.
    assert.match(await ask(s, 'page', { kinds: [30200] }), /^restricted: /)
    const before = s.events('page').length
    await publish(pub, event(key, 30200, a.page, '{"n":6}', [['d', 'n6']]))
    await sleep(200)
    assert.equal(s.events('page').length, before)

  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test("the liveness probe answers EOSE and can never be heard on", { timeout: 20_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const prober = await connect(r.port)
    sockets.push(prober)
    assert.equal(await ask(prober, 'hc-live', { '#x': ['hc:live'], limit: 0 }), 'EOSE')
    const pub = await connect(r.port)
    sockets.push(pub)
    // Nothing can even be filed at the probe word: a write names a signature.
    assert.match(await refused(pub, event(generateSecretKey(), 21000, 'hc:live', '{"spam":true}')), /^restricted: /)
    await sleep(200)
    assert.equal(prober.events().length, 0, 'nothing published at the probe word reaches a prober')
    assert.equal(await ask(prober, 'hc-live-2', { '#x': ['hc:live'] }), 'EOSE')
    assert.equal(prober.events().length, 0)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test("the drained word 'broker:fetch' reaches only connections that beaconed the same zone", { timeout: 30_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const a = room('alpha')
    const b = room('beta')
    const keys = { holder: generateSecretKey(), asker: generateSecretKey(), other: generateSecretKey(), stranger: generateSecretKey() }

    // Older builds: a holder and an asker in room alpha, someone in room beta,
    // and a scanner that beacons nothing — all subscribed to the word.
    const holder = await open()
    const asker = await open()
    const other = await open()
    const scanner = await open()
    await publish(holder, beacon(keys.holder, a.zone))
    await publish(asker, beacon(keys.asker, a.zone))
    await publish(other, beacon(keys.other, b.zone))
    for (const s of [holder, asker, other, scanner]) assert.equal(await ask(s, 'broker', { '#x': ['broker:fetch'], kinds: [20400, 20402] }), 'EOSE')

    // An ask in room alpha reaches alpha's holder — and nobody else.
    const fetchAsk = event(keys.asker, 20400, 'broker:fetch', '', [['d', a.page], ['t', 'visuals']])
    await publish(asker, fetchAsk)
    assert.ok(await holder.wait(m => m[0] === 'EVENT' && m[2].id === fetchAsk.id), "alpha's holder hears alpha's ask")
    await sleep(200)
    assert.equal(other.events().length, 0, "beta never hears alpha's ask")
    assert.equal(scanner.events().length, 0, 'a scanner hears no ask')

    // A connection that beaconed nowhere is heard by nobody on the word.
    const loner = await open()
    const lonely = event(keys.stranger, 20400, 'broker:fetch', '', [['d', sha('wanted')], ['t', 'layer']])
    await publish(loner, lonely)
    await sleep(200)
    assert.equal(holder.events().filter(m => m[2].id === lonely.id).length, 0)

    // Nothing can be stored at the word — only the ask and its cancel, which
    // are ephemeral — and nothing is ever replayed there.
    assert.match(await refused(asker, event(keys.asker, 30401, 'broker:fetch', 'Ynl0ZXM=', [['d', 'stored-at-the-word']])), /^restricted: /)
    const late = await open()
    await publish(late, beacon(generateSecretKey(), a.zone))
    assert.equal(await ask(late, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')
    assert.equal(late.events('broker').length, 0)

    // Leaving the zone leaves its asks: after {left}, alpha's holder hears no more from the asker.
    await publish(asker, leave(keys.asker, a.zone))
    const afterLeave = event(keys.asker, 20400, 'broker:fetch', '', [['d', sha('after')], ['t', 'layer']])
    await publish(asker, afterLeave)
    await sleep(200)
    assert.equal(holder.events().filter(m => m[2].id === afterLeave.id).length, 0)

    // The room-scoped channel the new builds ask on is an ordinary signature:
    // heard by whoever names it, beacon or not — the address IS the room.
    const fresh = await open()
    assert.equal(await ask(fresh, 'room-broker', { '#x': [a.broker], kinds: [20400, 20402] }), 'EOSE')
    const roomAsk = event(keys.holder, 20400, a.broker, '', [['d', a.page], ['t', 'visuals']])
    await publish(holder, roomAsk)
    assert.ok(await fresh.wait(m => m[0] === 'EVENT' && m[1] === 'room-broker' && m[2].id === roomAsk.id))
    await sleep(100)
    assert.equal(scanner.events().filter(m => m[2].id === roomAsk.id).length, 0)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('a read costs the index at its address, never a walk over the store', () => {
  const source = readFileSync(join(import.meta.dirname, 'relay.js'), 'utf8')
  const body = name => {
    const start = source.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `${name} exists`)
    const end = source.indexOf('\n}\n', start)
    return source.slice(start, end)
  }
  // The REQ path reads only the candidates its addresses name.
  assert.match(body('queryEvents'), /candidatesOf\(f\)/)
  assert.doesNotMatch(body('queryEvents'), /events\.values\(\)|of events\b/)
  assert.match(body('candidatesOf'), /idsByX\.get/)
  // The HTTP index route reads its publisher's index.
  assert.match(body('newestEvent'), /idsByAuthorKind\.get/)
  assert.doesNotMatch(body('newestEvent'), /events\.values\(\)/)
  // Live fan-out has no catch-all.
  assert.doesNotMatch(source, /subsCatchAll/)
  // Only storeEvent/dropEvent write the store, so the index cannot drift.
  const writers = [...source.matchAll(/\bevents\.(set|delete)\(/g)].map(m => m.index)
  const allowed = [body('storeEvent'), body('dropEvent')].map(b => [source.indexOf(b), source.indexOf(b) + b.length])
  for (const at of writers) assert.ok(allowed.some(([from, to]) => at >= from && at < to), `events written outside storeEvent/dropEvent at ${at}`)
})

// ── review fixes (2026-10-09): one room per connection, asks before beacons,
// writes name a signature, address caps, one spelling per HTTP path ─────────

const beaconFor = (secret, zone, ttlSec = 90) =>
  event(secret, 30206, zone, JSON.stringify({ alive: true }), [['d', getPublicKey(secret)], ['expiration', String(nowSec() + ttlSec)]])
const wordAsk = (secret, d) => event(secret, 20400, 'broker:fetch', '', [['d', d], ['t', 'layer']])
const heard = (socket, evt) => socket.events().some(m => m[2].id === evt.id)

test("the drained word follows a connection's NEWEST room — a lost {left} never leaves it in two", { timeout: 30_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const a = room('alpha')
    const b = room('beta')
    const mover = generateSecretKey()
    const alphaPeer = generateSecretKey()
    const betaPeer = generateSecretKey()
    const m = await open()
    const inAlpha = await open()
    const inBeta = await open()
    await publish(inAlpha, beaconFor(alphaPeer, a.zone))
    await publish(inBeta, beaconFor(betaPeer, b.zone))
    for (const s of [inAlpha, inBeta]) assert.equal(await ask(s, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')

    // In alpha, then in beta — the {left} for alpha never arrived.
    await publish(m, beaconFor(mover, a.zone))
    await publish(m, beaconFor(mover, b.zone))
    const asked = wordAsk(mover, sha('wanted after moving'))
    await publish(m, asked)
    assert.ok(await inBeta.wait(msg => msg[0] === 'EVENT' && msg[2].id === asked.id), 'beta hears the ask')
    await sleep(200)
    assert.equal(heard(inAlpha, asked), false, 'alpha — the room it left — never does')
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test("an expired beacon is no room: the word reaches nobody once a connection's {alive} has lapsed", { timeout: 30_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const a = room('alpha')
    const holder = generateSecretKey()
    const lapsing = generateSecretKey()
    const h = await open()
    const l = await open()
    await publish(h, beaconFor(holder, a.zone))
    assert.equal(await ask(h, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')
    await publish(l, beaconFor(lapsing, a.zone, 2))
    const early = wordAsk(lapsing, sha('early'))
    await publish(l, early)
    assert.ok(await h.wait(msg => msg[0] === 'EVENT' && msg[2].id === early.id), 'heard while the beacon stands')
    await sleep(3_200)
    const late = wordAsk(lapsing, sha('late'))
    await publish(l, late)
    await sleep(3_400)  // past the hold, too
    assert.equal(heard(h, late), false, 'not once it has lapsed')
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('an ask flushed on a reconnect BEFORE the beacon is held, then heard when the connection beacons again', { timeout: 30_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const a = room('alpha')
    const b = room('beta')
    const old = generateSecretKey()
    const holder = generateSecretKey()
    const other = generateSecretKey()
    const h = await open()
    const o = await open()
    await publish(h, beaconFor(holder, a.zone))
    await publish(o, beaconFor(other, b.zone))
    for (const s of [h, o]) assert.equal(await ask(s, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')

    // An older build in alpha: its socket drops and a new one opens; it
    // flushes its queued ask before it beacons again (onopen order).
    const first = await open()
    await publish(first, beaconFor(old, a.zone))
    first.ws.terminate()
    await sleep(100)
    const second = await open()
    const flushed = wordAsk(old, sha('queued during the outage'))
    await publish(second, flushed)
    await sleep(200)
    assert.equal(heard(h, flushed), false, 'not before this connection beacons — the key is no room')
    await publish(second, beaconFor(old, a.zone))
    assert.ok(await h.wait(msg => msg[0] === 'EVENT' && msg[2].id === flushed.id), "alpha's holder hears it the moment it beacons")
    await sleep(200)
    assert.equal(heard(o, flushed), false, 'beta never does')
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test("replaying a member's signed event never places a stranger in the member's room", { timeout: 30_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const a = room('alpha')
    const victim = generateSecretKey()
    const v = await open()
    await publish(v, beaconFor(victim, a.zone))
    assert.equal(await ask(v, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')

    // Anything the victim signed that a stranger can see — here a public
    // event at an address anyone may read — replayed on the stranger's socket.
    const publicNote = event(victim, 30213, sha('a public page'), '{"n":1}', [['d', 'note']])
    await publish(v, publicNote)
    const stranger = await open()
    stranger.send(['EVENT', publicNote])
    assert.ok(await stranger.wait(m => m[0] === 'OK' && m[1] === publicNote.id))
    assert.equal(await ask(stranger, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')

    // The victim's room asks on the word: the stranger hears none of it.
    const roomAsk = wordAsk(victim, sha('a private picture'))
    await publish(v, roomAsk)
    await sleep(400)
    assert.equal(heard(stranger, roomAsk), false, "the stranger hears the room's ask")
    // …and the stranger's own ask on the word reaches nobody in the room.
    const probe = wordAsk(generateSecretKey(), sha('anyone holding this?'))
    await publish(stranger, probe)
    await sleep(3_400)
    assert.equal(heard(v, probe), false)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test("a first join's ask, signed a moment before its beacon, is held for the beacon and then heard", { timeout: 30_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const a = room('alpha')
    const holder = generateSecretKey()
    const joiner = generateSecretKey()
    const h = await open()
    await publish(h, beaconFor(holder, a.zone))
    assert.equal(await ask(h, 'broker', { '#x': ['broker:fetch'] }), 'EOSE')

    const j = await open()
    const early = wordAsk(joiner, sha('asked before the beacon'))
    await publish(j, early)
    await sleep(300)
    assert.equal(heard(h, early), false, 'not before the joiner is in a room')
    await publish(j, beaconFor(joiner, a.zone))
    assert.ok(await h.wait(msg => msg[0] === 'EVENT' && msg[2].id === early.id), 'heard the moment it beacons')

    // A connection that never beacons is heard by nobody, ever.
    const loner = await open()
    const lonely = wordAsk(generateSecretKey(), sha('nobody'))
    await publish(loner, lonely)
    await sleep(3_400)
    assert.equal(heard(h, lonely), false)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('a write names a signature: a word address is refused, the drained word only for its ask and cancel', { timeout: 20_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const s = await connect(r.port)
    sockets.push(s)
    const key = generateSecretKey()
    for (const x of ['visuals', 'hc:feedback-channel', 'A'.repeat(64), 'abc']) {
      assert.match(await refused(s, event(key, 30200, x, '{}', [['d', x]])), /^restricted: /, x)
    }
    // A second address that is a word refuses the event too.
    assert.match(await refused(s, event(key, 30200, sha('page'), '{}', [['x', 'visuals'], ['d', 'two']])), /^restricted: /)
    assert.match(await refused(s, event(key, 30401, 'broker:fetch', 'Ynl0ZXM=', [['d', 'x']])), /^restricted: /)
    await publish(s, event(key, 20400, 'broker:fetch', '', [['d', sha('w')], ['t', 'layer']]))
    await publish(s, event(key, 20402, 'broker:fetch', '', [['d', sha('w')], ['expiration', String(nowSec() + 30)]]))
    await publish(s, event(key, 30200, sha('page'), '{}', [['d', 'ok']]))
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('addresses are capped per REQ (16) and per connection (256 live)', { timeout: 30_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const s = await connect(r.port)
    sockets.push(s)
    let n = 0
    const xs = count => Array.from({ length: count }, () => sha(`addr-${n++}`))
    assert.match(await ask(s, 'seventeen', { '#x': xs(17) }), /^invalid: /)
    assert.equal(await ask(s, 'sixteen', { '#x': xs(16), limit: 0 }), 'EOSE')
    for (let i = 1; i < 16; i++) assert.equal(await ask(s, `fill-${i}`, { '#x': xs(16), limit: 0 }), 'EOSE')
    // 256 live: one more is refused, and the cap frees as subscriptions close.
    assert.match(await ask(s, 'over', { '#x': xs(1), limit: 0 }), /^error: too many addresses/)
    s.send(['CLOSE', 'fill-1'])
    assert.equal(await ask(s, 'over', { '#x': xs(1), limit: 0 }), 'EOSE')
    // Re-pointing a held subscription counts it once, not twice.
    s.send(['CLOSE', 'over'])
    assert.equal(await ask(s, 'sixteen', { '#x': xs(16), limit: 0 }), 'EOSE')
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test("the host card says the relay's reads are addressed", { timeout: 20_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const s = await connect(r.port)
    sockets.push(s)
    const card = await s.wait(m => m[0] === 'NOTICE' && String(m[1]).startsWith('hc:host '))
    assert.equal(JSON.parse(String(card[1]).slice('hc:host '.length)).addressed, true)
    const info = await (await fetch(r.base, { headers: { Accept: 'application/nostr+json' } })).json()
    assert.equal(info.limitation.addressed_reads, true)
    assert.equal(info.limitation.restricted_writes, true)
    assert.equal(info.limitation.max_addresses, 16)
    assert.equal(info.limitation.access_code, false)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

/** GET a path exactly as written — fetch() would normalise '.', '..' and '%2e'. */
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET' }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('HTTP: one spelling per path — no other spelling reaches a bag, a receipt, or the fact that a bag exists', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-spell-'))
  const bag = sha('websites')
  const head = Buffer.from('a head layer')
  const headSig = sha(head)
  mkdirSync(join(dir, bag))
  writeFileSync(join(dir, bag, '00000001'), headSig)
  writeFileSync(join(dir, headSig), head)
  const pk = 'c'.repeat(64)
  mkdirSync(join(dir, '.receipts'))
  writeFileSync(join(dir, '.receipts', `${pk}.json`), JSON.stringify({ sigs: [headSig] }))
  const port = await freePort()
  const child = spawn(process.execPath, ['relay.js', '--port', String(port), '--content-dir', dir], { cwd: import.meta.dirname, stdio: 'ignore' })
  try {
    for (let tries = 0; ; tries++) {
      try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break } catch {}
      if (tries > 100) assert.fail('relay did not start')
      await sleep(50)
    }
    const absent = await rawGet(port, '/no-such-thing/at/all')
    assert.equal(absent.status, 404)
    const spellings = [
      `/${bag}/00000001`,
      `/${bag.toUpperCase()}/00000001`,
      `/./${bag}/00000001`,
      `//${bag}/00000001`,
      `/x/../${bag}/00000001`,
      `/%2e/${bag}/00000001`,
      `/${bag}/./00000001`,
      `/${bag}%2f00000001`,
      `/content/${bag}/00000001`,
      `/.receipts/${pk}.json`,
      `/./.receipts/${pk}.json`,
      `//.receipts/${pk}.json`,
      `/%2ereceipts/${pk}.json`,
      `/${headSig.toUpperCase()}`,
      // Windows' own spellings: an 8.3 short name, a stream suffix, and the
      // trailing dot or space the OS drops (C: keeps short names on).
      `/RECEIP~1/${pk}.json`,
      `/content/RECEIP~1/${pk}.json`,
      `/${bag.slice(0, 6).toUpperCase()}~1/00000001`,
      `/${bag}::$INDEX_ALLOCATION/00000001`,
      `/${bag}:$I30:$INDEX_ALLOCATION/00000001`,
      `/${bag}./00000001`,
      `/${bag}%20/00000001`,
      `/${headSig}.`,
      `/${headSig}::$DATA`,
      `/__resources__./${headSig}`,
    ]
    for (const path of spellings) {
      const got = await rawGet(port, path)
      assert.deepEqual(got, absent, `${path} must answer as an absent path`)
    }
    // No existence oracle: under an unlisted bag that is there and one that
    // is not, a held atom's name answers the same.
    assert.deepEqual(await rawGet(port, `/${bag}/${headSig}`), await rawGet(port, `/${sha('no-such-word')}/${headSig}`))
    assert.deepEqual(await rawGet(port, `/${bag}/a/b`), await rawGet(port, `/${sha('no-such-word')}/a/b`))
    // The canonical reads still answer.
    assert.equal((await rawGet(port, `/${headSig}`)).body, 'a head layer')
    assert.equal((await rawGet(port, `/content/${headSig}`)).body, 'a head layer')
    assert.equal((await rawGet(port, `/__resources__/${headSig}`)).body, 'a head layer')
    assert.equal((await rawGet(port, `/${HOST_PACKAGES_POOL}/`)).status, 200)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an index PUT that names a mesh address (x) is refused — an index is never filed on the mesh', { timeout: 20_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const secret = generateSecretKey()
    const page = sha('a page')
    const url = `${r.base}/${sha('hive:indexes')}/${getPublicKey(secret)}`
    const put = async (tags) => {
      const evt = finalizeEvent({ kind: 30564, created_at: nowSec(), tags, content: JSON.stringify({ roots: {} }) }, secret)
      const body = Buffer.from(JSON.stringify(evt))
      return fetch(url, { method: 'PUT', body, headers: { Authorization: nip98(secret, url, 'PUT', body), 'Content-Type': 'application/json' } })
    }
    const withX = await put([['x', page]])
    assert.equal(withX.status, 400)
    assert.match(await withX.text(), /no x tag/)
    const s = await connect(r.port)
    sockets.push(s)
    assert.equal(await ask(s, 'page', { '#x': [page] }), 'EOSE')
    assert.equal(s.events('page').length, 0)
    assert.equal((await put([])).status, 200)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})
