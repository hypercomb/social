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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const sha = text => createHash('sha256').update(text).digest('hex')
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
    await publish(pub, event(generateSecretKey(), 21000, 'hc:live', '{"spam":true}'))
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

    // Nothing is ever replayed at the word, even an event someone stored there.
    await publish(asker, event(keys.asker, 30401, 'broker:fetch', 'Ynl0ZXM=', [['d', 'stored-at-the-word']]))
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
