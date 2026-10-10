// The meeting point in the real Workers runtime: `wrangler dev --local` runs
// worker.js and its Durable Object in workerd on a scratch port, and real
// WebSockets dial it — the access code as a subprotocol, a recycle by the
// operator's script, the address gate, wills, expiry and a reconnect.
//
//   npm run test:dev        (needs wrangler from devDependencies; no network)
import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { eventId, sha256Hex } from './meeting.js'

const here = import.meta.dirname
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const nowSec = () => Math.floor(Date.now() / 1000)
const operator = schnorr.utils.randomPrivateKey()
const GRACE_MS = 1500

/** A free port in the scratch range 8780-8799. */
async function freePort(taken = new Set()) {
  for (let port = 8780; port <= 8799; port++) {
    if (taken.has(port)) continue
    const free = await new Promise((resolve) => {
      const server = createServer().once('error', () => resolve(false)).listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Error('no free port in 8780-8799')
}

let dev
const opened = new Set()
let base
let wsBase
let state

before(async () => {
  const port = await freePort()
  const inspector = await freePort(new Set([port]))
  state = mkdtempSync(join(tmpdir(), 'hypercomb-meet-'))
  dev = spawn(process.execPath, [
    join(here, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--config', 'wrangler.meet.toml',
    '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', state,
    '--show-interactive-dev-session=false',
    '--var', `OPERATOR_KEYS:${bytesToHex(schnorr.getPublicKey(operator))}`,
    '--var', `DIAG_WILL_GRACE_MS:${GRACE_MS}`,
    '--var', 'DIAG_SWEEP_MS:500',
  ], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } })
  const out = []
  dev.stdout.on('data', (chunk) => out.push(String(chunk)))
  dev.stderr.on('data', (chunk) => out.push(String(chunk)))
  base = `http://127.0.0.1:${port}`
  wsBase = `ws://127.0.0.1:${port}`
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base + '/', { headers: { accept: 'application/nostr+json' } })).ok) break } catch {}
    if (tries > 240) throw new Error(`wrangler dev did not start:\n${out.join('')}`)
    await sleep(250)
  }
})

after(() => {
  if (!dev) return
  // wrangler runs workerd as a child of its own: end the whole tree.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { stdio: 'ignore' })
  else dev.kill('SIGTERM')
  try { rmSync(state, { recursive: true, force: true }) } catch {}
})

// Every socket a test opened is closed after it, pass or fail, so the next
// test's counts are its own.
afterEach(async () => {
  for (const s of opened) try { s.ws.close() } catch {}
  opened.clear()
  await sleep(250)
})

/** Recycle with the operator's own script: the key on stdin, the code printed. */
function recycle(key = operator, extra = []) {
  const run = spawnSync(process.execPath, [join(here, 'scripts/recycle-code.mjs'), '--url', `${base}/.well-known/hc-meet/code`, ...extra],
    { cwd: here, input: bytesToHex(key) + '\n', encoding: 'utf8', timeout: 20_000 })
  const code = run.stdout.match(/^access code\s+([A-Za-z0-9_-]{32})$/m)?.[1] ?? null
  return { status: run.status, code, stdout: run.stdout, stderr: run.stderr }
}

/** Dial the meeting point with a code; resolves once open (or closed). */
function dial(code) {
  return new Promise((resolve) => {
    const ws = code === undefined ? new WebSocket(wsBase) : new WebSocket(wsBase, [`hc-access.${code}`])
    const inbox = []
    const waiters = []
    const s = {
      ws, inbox, closed: null, protocol: '',
      send: (msg) => ws.send(JSON.stringify(msg)),
      events: (subId) => inbox.filter((m) => m[0] === 'EVENT' && (subId === undefined || m[1] === subId)),
      wait: (pred, ms = 4000) => new Promise((done) => {
        const hit = inbox.find(pred)
        if (hit) return done(hit)
        const w = { pred, done }
        waiters.push(w)
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); done(null) } }, ms)
      }),
      // The close frame has arrived (CLOSING). A close the meeting point
      // starts reaches CLOSING at once; local workerd then holds the TCP
      // connection some seconds before the client's close event fires.
      untilClosing: (ms = 2000) => new Promise((done) => {
        const started = Date.now()
        const poll = setInterval(() => { if (ws.readyState >= 2 || Date.now() - started > ms) { clearInterval(poll); done(ws.readyState >= 2) } }, 10)
      }),
      untilClosed: (ms = 4000) => new Promise((done) => {
        if (s.closed) return done(s.closed)
        const started = Date.now()
        const poll = setInterval(() => { if (s.closed || Date.now() - started > ms) { clearInterval(poll); done(s.closed) } }, 20)
      }),
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data))
      inbox.push(msg)
      for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.done(msg) }
    }
    opened.add(s)
    ws.onopen = () => { s.protocol = ws.protocol; resolve(s) }
    ws.onclose = (e) => { s.closed = { code: e.code, reason: e.reason }; resolve(s) }
  })
}

async function ask(s, subId, ...filters) {
  s.send(['REQ', subId, ...filters])
  const answer = await s.wait((m) => (m[0] === 'EOSE' || m[0] === 'CLOSED') && m[1] === subId)
  assert.ok(answer, `no answer to ${subId}`)
  return answer[0] === 'EOSE' ? 'EOSE' : answer[2]
}

const key = () => schnorr.utils.randomPrivateKey()
const pub = (secret) => bytesToHex(schnorr.getPublicKey(secret))
function sign(secret, kind, x, content = '{}', extra = [], createdAt = nowSec()) {
  const evt = { pubkey: pub(secret), created_at: createdAt, kind, tags: [['x', x], ...extra], content }
  evt.id = eventId(evt)
  evt.sig = bytesToHex(schnorr.sign(evt.id, secret))
  return evt
}
async function publish(s, evt) {
  s.send(['EVENT', evt])
  const ok = await s.wait((m) => m[0] === 'OK' && m[1] === evt.id)
  assert.equal(ok?.[2], true, `EVENT refused: ${ok?.[3]}`)
}
const beacon = (secret, zone, ttl = 90) => sign(secret, 30206, zone, '{"alive":true}', [['d', pub(secret)], ['expiration', String(nowSec() + ttl)]])

let code

test('a fresh meeting point is closed: every dial is refused 4401 with no data', async () => {
  // A dial with no code is refused by the front before the object hears of it
  // (so the front cannot say the door is shut — only that a code is needed);
  // a code is checked against the hash in force, and there is none.
  for (const [offered, reason] of [[undefined, 'access: code required'], ['A'.repeat(32), 'access: the meeting point is closed']]) {
    const s = await dial(offered)
    const closed = await s.untilClosed()
    assert.deepEqual(closed, { code: 4401, reason })
    assert.deepEqual(s.inbox, [], 'not one frame')
  }
})

test('the operator recycles the first code; only that code gets in, card first', async () => {
  const run = recycle()
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.code, run.stdout)
  assert.match(run.stdout, /^meeting point\s+ws:\/\/127\.0\.0\.1:\d+$/m)
  assert.match(run.stdout, /^meeting link\s+.*code=/m)
  code = run.code

  const s = await dial(code)
  assert.equal(s.closed, null)
  assert.equal(s.protocol, `hc-access.${code}`, 'the subprotocol is echoed, so a browser completes the handshake')
  const first = await s.wait(() => true)
  assert.equal(first[0], 'NOTICE')
  const card = JSON.parse(first[1].slice('hc:host '.length))
  assert.equal(card.participants, 'all')
  assert.ok(Math.abs(card.time - nowSec()) <= 2, 'the card carries the meeting point\'s clock')

  const wrong = await dial('B'.repeat(32))
  assert.deepEqual(await wrong.untilClosed(), { code: 4401, reason: 'access: code refused' })
  const none = await dial()
  assert.deepEqual(await none.untilClosed(), { code: 4401, reason: 'access: code required' })

  // A stranger's key is refused, and nothing changes.
  const stranger = recycle(key())
  assert.equal(stranger.status, 1)
  assert.match(stranger.stderr, /403 not an operator/)
  s.ws.close()
})

test('reads name a signature: scans are CLOSED, an addressed read replays and hears live', async () => {
  const p = await dial(code)
  const scan = await dial(code)
  const page = sha256Hex('/\0alpha\0secret')
  const secret = key()
  await publish(p, sign(secret, 30200, page, '{"n":1}', [['d', page]]))
  for (const [subId, ...filters] of [['empty', {}], ['kinds', { kinds: [30200] }], ['ids', { ids: [sha256Hex('x')] }], ['word', { '#x': ['visuals'] }]]) {
    assert.match(await ask(scan, subId, ...filters), /^restricted: /, subId)
  }
  assert.equal(await ask(scan, 'hc-live', { '#x': ['hc:live'], limit: 0 }), 'EOSE')
  assert.equal(await ask(scan, 'page', { '#x': [page], kinds: [30200] }), 'EOSE')
  assert.deepEqual(scan.events('page').map((m) => m[2].content), ['{"n":1}'])
  // Live, and an ephemeral kind is heard and never replayed.
  assert.equal(await ask(scan, 'live', { '#x': [page], limit: 0 }), 'EOSE')
  await publish(p, sign(secret, 20400, page, '', [['d', 'ask']]))
  assert.ok(await scan.wait((m) => m[0] === 'EVENT' && m[1] === 'live' && m[2].kind === 20400))
  assert.equal(scan.events('page').filter((m) => m[2].kind === 20400).length, 0, 'a kinds filter narrows live delivery too')
  const late = await dial(code)
  assert.equal(await ask(late, 'page', { '#x': [page] }), 'EOSE')
  assert.deepEqual(late.events('page').map((m) => m[2].kind), [30200])
  for (const s of [p, scan, late]) s.ws.close()
})

test('NIP-40: a beacon is replayed until it expires, never after', async () => {
  const p = await dial(code)
  const zone = sha256Hex('lifecycle\0expiry\0secret')
  await publish(p, beacon(key(), zone, 2))
  const a = await dial(code)
  assert.equal(await ask(a, 'z', { '#x': [zone] }), 'EOSE')
  assert.equal(a.events('z').length, 1)
  await sleep(3200)
  const b = await dial(code)
  assert.equal(await ask(b, 'z', { '#x': [zone] }), 'EOSE')
  assert.equal(b.events('z').length, 0)
  for (const s of [p, a, b]) s.ws.close()
})

test('a will fires after its grace; a reconnect inside the grace cancels it', async () => {
  const zone = sha256Hex('lifecycle\0wills\0secret')
  const watcher = await dial(code)
  assert.equal(await ask(watcher, 'zone', { '#x': [zone] }), 'EOSE')
  const lefts = () => watcher.events('zone').filter((m) => JSON.parse(m[2].content).left === true)
  const [gone, back] = [key(), key()]
  const lone = await dial(code)
  await publish(lone, beacon(gone, zone))
  const reloading = await dial(code)
  await publish(reloading, beacon(back, zone))

  const t0 = Date.now()
  lone.ws.close()
  reloading.ws.close()
  await sleep(300)
  const returned = await dial(code)   // the reload: a new socket whose first word is its beacon
  await publish(returned, beacon(back, zone))
  const left = await watcher.wait((m) => m[0] === 'EVENT' && JSON.parse(m[2].content).left === true, GRACE_MS + 3000)
  const ms = Date.now() - t0
  assert.ok(left, 'the lone socket\'s will fired')
  assert.equal(left[2].pubkey, pub(gone))
  assert.equal(left[2].sig, '')
  assert.ok(ms >= GRACE_MS - 100 && ms <= GRACE_MS + 2500, `will after ${ms} ms, grace ${GRACE_MS}`)
  await sleep(GRACE_MS)
  assert.deepEqual(lefts().map((m) => m[2].pubkey), [pub(gone)], 'the returner was never tombstoned')
  for (const s of [watcher, returned]) s.ws.close()
})

test('a recycle is in force at once: sockets on the old code are cut, the old code opens nothing', async () => {
  const zone = sha256Hex('lifecycle\0recycle\0secret')
  const secret = key()
  const inRoom = await dial(code)
  await publish(inRoom, beacon(secret, zone))
  const idle = await dial(code)
  const old = code

  const run = recycle()
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^closed\s+2 socket\(s\) on the old code$/m)
  code = run.code
  assert.notEqual(code, old)
  for (const s of [inRoom, idle]) assert.ok(await s.untilClosing(), 'the close frame arrives at once')

  // The room carries on under the new code. The cut participant was never
  // told to leave: their will waits out its grace and fires like any other.
  const fresh = await dial(code)
  assert.equal(fresh.closed, null)
  assert.equal(await ask(fresh, 'zone', { '#x': [zone] }), 'EOSE')
  const left = await fresh.wait((m) => m[0] === 'EVENT' && m[2].pubkey === pub(secret) && JSON.parse(m[2].content).left === true, GRACE_MS + 3000)
  assert.ok(left, 'a socket cut by a recycle gets its will like any other')

  const stale = await dial(old)
  assert.deepEqual(await stale.untilClosed(), { code: 4401, reason: 'access: code refused' })
  // Local workerd finishes the TCP teardown of a socket the object closed only
  // at its next socket event, so the close EVENT (not the frame) waits for one.
  fresh.ws.close()
  for (const s of [inRoom, idle]) assert.deepEqual(await s.untilClosed(15_000), { code: 4401, reason: 'access: code recycled' })

  // Destroyed without a successor: everyone out, nobody in.
  const keep = await dial(code)
  const shut = recycle(operator, ['--close'])
  assert.equal(shut.status, 0, shut.stderr)
  assert.match(shut.stdout, /^access code\s+destroyed/m)
  assert.ok(await keep.untilClosing())
  const after = await dial(code)
  assert.deepEqual(await after.untilClosed(), { code: 4401, reason: 'access: the meeting point is closed' })
  assert.deepEqual(await keep.untilClosed(15_000), { code: 4401, reason: 'access: the meeting point is closed' })
})
