// The meeting point in the real Workers runtime: `wrangler dev --local` runs
// worker.js and its Durable Objects in workerd on a scratch port, and real
// WebSockets dial it — the access code as a subprotocol, a recycle by the
// operator's script, the address gate, wills, expiry and a reconnect — and the
// OPEN host beside the coded one: the same server dialled as `localhost` is
// open (MEET_OPEN_HOSTS), as `127.0.0.1` coded, each in its own object.
//
//   npm run test:dev        (needs wrangler from devDependencies; no network)
//   MEET_DEV_PORTS=8890-8895 npm run test:dev    another scratch port range
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

const [PORT_MIN, PORT_MAX] = (/^(\d+)-(\d+)$/.exec(process.env.MEET_DEV_PORTS ?? '')?.slice(1).map(Number)) ?? [8780, 8799]

/** A free port in the scratch range (8780-8799 unless MEET_DEV_PORTS says). */
async function freePort(taken = new Set()) {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (taken.has(port)) continue
    const free = await new Promise((resolve) => {
      const server = createServer().once('error', () => resolve(false)).listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Error(`no free port in ${PORT_MIN}-${PORT_MAX}`)
}

let dev
const opened = new Set()
let base
let wsBase
let openBase
let wsOpen
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
    // The same server, named two ways: `localhost` is the open host here.
    '--var', 'MEET_OPEN_HOSTS:localhost',
  ], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } })
  const out = []
  dev.stdout.on('data', (chunk) => out.push(String(chunk)))
  dev.stderr.on('data', (chunk) => out.push(String(chunk)))
  base = `http://127.0.0.1:${port}`
  wsBase = `ws://127.0.0.1:${port}`
  openBase = `http://localhost:${port}`
  wsOpen = `ws://localhost:${port}`
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
function dial(code, at = wsBase) {
  return new Promise((resolve) => {
    const ws = code === undefined ? new WebSocket(at) : new WebSocket(at, [`hc-access.${code}`])
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

test('the open host admits a codeless dial, card first, while the coded host beside it stays shut', async () => {
  const s = await dial(undefined, wsOpen)
  assert.equal(s.closed, null, `refused: ${JSON.stringify(s.closed)}`)
  const first = await s.wait(() => true)
  assert.equal(first?.[0], 'NOTICE')
  const card = JSON.parse(first[1].slice('hc:host '.length))
  assert.equal(card.participants, 'all')
  assert.equal(card.addressed, true)
  assert.ok(Math.abs(card.time - nowSec()) <= 2)
  assert.equal(await ask(s, 'scan', { kinds: [30206], limit: 1 }).then((r) => /^restricted: /.test(r)), true, 'no scans at the open default either')

  // A stale code from an old meeting link: echoed, ignored, admitted.
  const stale = await dial('C'.repeat(32), wsOpen)
  assert.equal(stale.closed, null)
  assert.equal(stale.protocol, `hc-access.${'C'.repeat(32)}`)

  const info = async (at) => (await fetch(at + '/', { headers: { accept: 'application/nostr+json' } })).json()
  assert.equal((await info(openBase)).limitation.access_code, false)
  assert.equal((await info(base)).limitation.access_code, true)
  const recycleOpen = await fetch(`${openBase}/.well-known/hc-meet/code`, { method: 'POST', body: '{}' })
  assert.equal(recycleOpen.status, 404, 'an open host has no code to recycle')

  // The coded host on the same server is still closed: no code has been set.
  const shut = await dial('A'.repeat(32))
  assert.deepEqual(await shut.untilClosed(), { code: 4401, reason: 'access: the meeting point is closed' })
  for (const x of [s, stale]) x.ws.close()
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

test('MS6 on real sockets: a quiet socket of the key is asked; silent, the room hears the leave after the grace; answering, it keeps the will', async () => {
  const zone = sha256Hex('lifecycle\0heirs\0secret')
  const watcher = await dial(code)
  assert.equal(await ask(watcher, 'zone', { '#x': [zone] }), 'EOSE')
  const isTomb = (who) => (m) => m[0] === 'EVENT' && m[2].pubkey === pub(who) && m[2].sig === '' && JSON.parse(m[2].content).left === true
  // A joined tab listens on its room's lifecycle channel and beacons.
  const joined = async (who) => {
    const s = await dial(code)
    assert.equal(await ask(s, 'mine', { '#x': [zone], kinds: [30206] }), 'EOSE')
    await publish(s, beacon(who, zone))
    return s
  }

  // A phone: S1 goes silent (lock 1, no FIN — it stays open here and says
  // nothing); S2, the wake, beacons and closes (lock 2).
  const phone = key()
  const s1 = await joined(phone)
  await sleep(1100)
  const s2 = await joined(phone)
  const t0 = Date.now()
  s2.ws.close()
  assert.ok(await s1.wait(isTomb(phone)), 'the silent socket is asked, on its own subscription')
  const left = await watcher.wait(isTomb(phone), GRACE_MS + 3000)
  const ms = Date.now() - t0
  assert.ok(left, 'the room hears the leave while the zombie is still open')
  assert.ok(ms >= GRACE_MS - 100 && ms <= GRACE_MS + 2500, `leave after ${ms} ms, grace ${GRACE_MS}`)

  // A desk: hidden tab H, then visible tab V; V closes. H hears the question
  // and beacons again (the swarm does so a second past the tombstone; this
  // object's grace is only GRACE_MS, so the answer comes sooner): nobody is told.
  const desk = key()
  const h = await joined(desk)
  await sleep(1100)
  const v = await joined(desk)
  v.ws.close()
  assert.ok(await h.wait(isTomb(desk)), 'the hidden tab is asked')
  await sleep(300)
  await publish(h, beacon(desk, zone))
  await sleep(GRACE_MS + 1000)
  assert.equal(watcher.inbox.filter(isTomb(desk)).length, 0, 'it answered: nobody is told the participant left')
  for (const s of [watcher, s1, h]) s.ws.close()
})

test('the open default and the coded point are separate objects: one zone on both is two rooms', async () => {
  const zone = sha256Hex('lifecycle\0both\0secret')
  const member = await dial(code)
  const watcher = await dial(undefined, wsOpen)
  assert.equal(await ask(member, 'zone', { '#x': [zone] }), 'EOSE')
  assert.equal(await ask(watcher, 'zone', { '#x': [zone] }), 'EOSE')
  const guest = await dial(undefined, wsOpen)
  const secret = key()
  await publish(guest, beacon(secret, zone))
  assert.ok(await watcher.wait((m) => m[0] === 'EVENT' && m[1] === 'zone' && m[2].pubkey === pub(secret)), 'the open room hears its guest')
  await sleep(300)
  assert.equal(member.events('zone').length, 0, 'the private meeting hears nothing of the open room')
  const late = await dial(code)
  assert.equal(await ask(late, 'zone', { '#x': [zone] }), 'EOSE')
  assert.equal(late.events('zone').length, 0, 'nor does the coded object replay it')
  for (const s of [member, watcher, guest, late]) s.ws.close()
})

test('a recycle is in force at once: sockets on the old code are cut, the old code opens nothing', async () => {
  const zone = sha256Hex('lifecycle\0recycle\0secret')
  const secret = key()
  // Someone at the open default, the whole time: no recycle is theirs.
  const bystander = await dial(undefined, wsOpen)
  assert.equal(bystander.closed, null)
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

  // Two recycles and a destroyed code later, the open default never noticed.
  assert.equal(bystander.closed, null)
  assert.equal(bystander.ws.readyState, 1)
  assert.equal(await ask(bystander, 'hc-live', { '#x': ['hc:live'], limit: 0 }), 'EOSE')
  const newcomer = await dial(undefined, wsOpen)
  assert.equal(newcomer.closed, null, 'and still takes everyone')
  for (const s of [bystander, newcomer]) s.ws.close()
})
