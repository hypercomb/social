// The meeting point under a room's load: the host card, budgets that are a
// connection's and not a venue's, wills that wait for a reconnect, the
// counts-only minute line, and frame latency while the host stores an upload.
// Every relay here is a child on a free port with a throwaway content dir.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const nowSec = () => Math.floor(Date.now() / 1000)
const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})

/** A child relay; `out` collects its stdout lines. */
async function relay(args = [], env = {}) {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-meeting-'))
  const child = spawn(process.execPath, ['relay.js', '--port', String(port), '--content-dir', dir, ...args],
    { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } })
  const out = []
  let partial = ''
  child.stdout.on('data', chunk => {
    partial += String(chunk)
    const lines = partial.split('\n')
    partial = lines.pop()
    out.push(...lines)
  })
  const base = `http://127.0.0.1:${port}`
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (tries > 100) assert.fail(`relay did not start at ${base}`)
    await sleep(50)
  }
  return { port, base, out, close: () => { child.kill(); rmSync(dir, { recursive: true, force: true }) } }
}

/** A socket that keeps everything it hears, from the first frame. */
async function connect(port, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers })
  const inbox = []
  const waiters = []
  ws.on('message', raw => {
    const msg = JSON.parse(String(raw))
    msg.at = Date.now()
    inbox.push(msg)
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg) }
  })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  return {
    ws, inbox,
    send: msg => ws.send(JSON.stringify(msg)),
    wait: (pred, ms = 3000) => new Promise(resolve => {
      const hit = inbox.find(pred)
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

async function publish(socket, evt) {
  socket.send(['EVENT', evt])
  const ok = await socket.wait(m => m[0] === 'OK' && m[1] === evt.id)
  assert.equal(ok?.[2], true, `EVENT refused: ${ok?.[3]}`)
}

test('the host card is the first frame, and a limit:0 probe answers without a scan', { timeout: 20_000 }, async () => {
  const open = await relay(['--allow-participants'])
  const closed = await relay()
  try {
    for (const [r, participants] of [[open, 'all'], [closed, false]]) {
      const before = nowSec()
      const s = await connect(r.port)
      const first = await s.wait(() => true)
      assert.equal(first[0], 'NOTICE')
      assert.match(first[1], /^hc:host /)
      const card = JSON.parse(first[1].slice('hc:host '.length))
      assert.equal(card.v, 1)
      assert.equal(card.participants, participants)
      assert.ok(card.time >= before - 1 && card.time <= nowSec() + 1, `relay time ${card.time} is the relay's clock`)
      assert.equal(s.inbox.indexOf(first), 0)
      s.ws.close()
    }

    const zone = 'b'.repeat(64)
    const publisher = await connect(open.port)
    await publish(publisher, event(generateSecretKey(), 30200, zone, '{}', [['d', zone]]))
    const probe = await connect(open.port)
    probe.send(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }])
    assert.ok(await probe.wait(m => m[0] === 'EOSE' && m[1] === 'hc-live'))
    // limit:0 on an address that HOLDS an event still replays nothing …
    probe.send(['REQ', 'quiet', { '#x': [zone], limit: 0 }])
    assert.ok(await probe.wait(m => m[0] === 'EOSE' && m[1] === 'quiet'))
    assert.equal(probe.inbox.filter(m => m[0] === 'EVENT').length, 0)
    // … while the same REQ without it does, and a re-sent probe replaces itself.
    probe.send(['REQ', 'loud', { '#x': [zone] }])
    assert.ok(await probe.wait(m => m[0] === 'EOSE' && m[1] === 'loud'))
    assert.equal(probe.inbox.filter(m => m[0] === 'EVENT' && m[1] === 'loud').length, 1)
    for (let i = 0; i < 300; i++) probe.send(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }])
    probe.send(['REQ', 'last', { '#x': ['hc:live'], limit: 0 }])
    assert.ok(await probe.wait(m => m[1] === 'last'))
    assert.equal(probe.inbox.filter(m => m[0] === 'CLOSED').length, 0, 'the same probe re-sent is never a new subscription')
    for (const s of [publisher, probe]) s.ws.close()
  } finally {
    open.close()
    closed.close()
  }
})

test('budgets are per connection under a venue ceiling, and a CLOSE is never refused', { timeout: 60_000 }, async () => {
  const r = await relay()
  const sockets = []
  try {
    const venue = { 'cf-connecting-ip': '203.0.113.5' }
    const refusedOn = s => s.inbox.filter(m => (m[0] === 'CLOSED' && /^rate-limited:/.test(m[2])) || (m[0] === 'OK' && m[2] === false && /^rate-limited:/.test(m[3]))).length
    const flood = async (s, n, tag) => {
      for (let i = 0; i < n; i++) s.send(['REQ', 'p', { '#x': ['hc:live'], limit: 0 }])
      s.send(['REQ', tag, { '#x': ['hc:live'], limit: 0 }])
      return await s.wait(m => m[1] === tag, 20_000)
    }

    // A room behind one venue address: 25 participants at 150 frames each.
    const room = []
    for (let i = 0; i < 25; i++) room.push(await connect(r.port, venue))
    sockets.push(...room)
    // One socket that will not stop, also at the venue, listening somewhere first.
    const hot = await connect(r.port, venue)
    sockets.push(hot)
    const watched = 'c'.repeat(64)
    hot.send(['REQ', 'watch', { '#x': [watched] }])
    assert.ok(await hot.wait(m => m[0] === 'EOSE' && m[1] === 'watch'))

    await Promise.all(room.map((s, i) => flood(s, 150, `done-${i}`)))
    await flood(hot, 2000, 'hot-done')
    // Its CLOSE while the bucket is empty still unroutes the subscription.
    hot.send(['CLOSE', 'watch'])
    const writer = await connect(r.port)
    sockets.push(writer)
    await publish(writer, event(generateSecretKey(), 30200, watched, '{}', [['d', watched]]))
    await sleep(300)

    assert.deepEqual(room.map(refusedOn), room.map(() => 0), 'nobody at the venue is refused for the room being busy')
    assert.ok(refusedOn(hot) > 1000, `the flooding socket is refused (${refusedOn(hot)})`)
    assert.equal(hot.inbox.filter(m => m[0] === 'EVENT' && m[1] === 'watch').length, 0, 'a CLOSE under refusal still closed')

    // The venue ceiling: 40 connections from one address at 380 frames each
    // (inside each connection's own budget) cross 12000; another address does
    // not notice, and a spoofed X-Forwarded-For is not an address of its own.
    const swarm = []
    for (let i = 0; i < 40; i++) swarm.push(await connect(r.port, { 'cf-connecting-ip': '198.51.100.77' }))
    const spoof = await connect(r.port, { 'cf-connecting-ip': '198.51.100.77', 'x-forwarded-for': '192.0.2.200' })
    const elsewhere = await connect(r.port, { 'cf-connecting-ip': '192.0.2.9' })
    sockets.push(...swarm, spoof, elsewhere)
    await Promise.all(swarm.map((s, i) => flood(s, 380, `ceiling-${i}`)))
    await flood(spoof, 390, 'spoof-done')
    await flood(elsewhere, 390, 'elsewhere-done')
    const ceiling = swarm.reduce((sum, s) => sum + refusedOn(s), 0)
    assert.ok(ceiling > 1000, `one address past 12000 is refused (${ceiling})`)
    assert.ok(refusedOn(spoof) > 300, `the venue address is spent whatever X-Forwarded-For says (${refusedOn(spoof)})`)
    assert.equal(refusedOn(elsewhere), 0)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('a will waits out its grace, and a beacon from the key cancels it', { timeout: 60_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const zone = 'a'.repeat(64)
    const watcher = await open()
    const heard = new Map()  // pubkey → arrival ms of a {left}
    const signed = []
    watcher.ws.on('message', raw => {
      const msg = JSON.parse(String(raw))
      if (msg[0] === 'EVENT' && JSON.parse(msg[2].content).left === true) {
        if (msg[2].sig !== '') signed.push(msg[2].pubkey)
        heard.set(msg[2].pubkey, Date.now())
      }
    })
    watcher.send(['REQ', 'zone', { '#x': [zone] }])
    assert.ok(await watcher.wait(m => m[0] === 'EOSE'))

    const key = () => generateSecretKey()
    const [crashed, refreshed, returned, stayer, heir] = [key(), key(), key(), key(), key()]
    const pk = secret => getPublicKey(secret)

    // crashed: one socket, gone for good.
    const lone = await open(); await publish(lone, beacon(crashed, zone))
    // refreshed: the new tab beacons before the old socket dies.
    const oldTab = await open(); await publish(oldTab, beacon(refreshed, zone))
    const newTab = await open(); await publish(newTab, beacon(refreshed, zone))
    // returned: the old socket dies; the key beacons again on a new one 5 s later (a reopened
    // socket's first word is its beacon).
    const before = await open(); await publish(before, beacon(returned, zone))
    // stayer: refreshed, and later the new tab dies too.
    const stayOld = await open(); await publish(stayOld, beacon(stayer, zone))
    const stayNew = await open(); await publish(stayNew, beacon(stayer, zone))
    // heir: two joined tabs — both beacon the slot; A dies, and the will is B's.
    const a = await open(); await publish(a, beacon(heir, zone))
    const b = await open(); await publish(b, beacon(heir, zone))

    const t0 = Date.now()
    for (const s of [lone, oldTab, before, stayOld, a]) s.ws.terminate()
    await sleep(1000)
    const stayNewGone = Date.now(); stayNew.ws.terminate()
    await sleep(2000)
    const bGone = Date.now(); b.ws.terminate()
    await sleep(Math.max(0, t0 + 5000 - Date.now()))
    const after = await open()
    await publish(after, beacon(returned, zone))
    await sleep(Math.max(0, bGone + 16_500 - Date.now()))

    const delay = (secret, from) => heard.has(pk(secret)) ? heard.get(pk(secret)) - from : null
    const near15 = (ms, what) => assert.ok(ms !== null && ms >= 14_000 && ms <= 16_000, `${what}: will after ${ms} ms, not 15 s ± 1 s`)
    near15(delay(crashed, t0), 'a lone socket that dies')
    assert.equal(heard.has(pk(refreshed)), false, 'a refreshed tab is never tombstoned by its old socket')
    assert.equal(heard.has(pk(returned)), false, 'a beacon from the key within the grace cancels the will')
    near15(delay(stayer, stayNewGone), "the new tab's own will")
    near15(delay(heir, bGone), 'a will inherited by the other connection that beaconed the slot')
    assert.deepEqual(signed, [], 'every will is relay-made')
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

// A tab that shares the participant's key but never joined (it never beaconed
// the zone) is not the participant: it may hold a socket for other features,
// and what it says there must neither inherit the joined tab's will nor
// cancel it. Otherwise the joined tab closes and the room never hears it left.
test('a same-key tab that never beaconed inherits no will and its word cancels none', { timeout: 40_000 }, async () => {
  const r = await relay()
  const sockets = []
  const open = async () => { const s = await connect(r.port); sockets.push(s); return s }
  try {
    const zone = 'a'.repeat(64)
    const watcher = await open()
    let left = null
    watcher.ws.on('message', raw => {
      const msg = JSON.parse(String(raw))
      if (msg[0] === 'EVENT' && msg[2].kind === 30206 && JSON.parse(msg[2].content).left === true) left ??= { at: Date.now(), pubkey: msg[2].pubkey }
    })
    watcher.send(['REQ', 'zone', { '#x': [zone] }])
    assert.ok(await watcher.wait(m => m[0] === 'EOSE'))

    const secret = generateSecretKey()
    const joined = await open(); await publish(joined, beacon(secret, zone))
    // The unjoined tab: same key, a non-beacon word (a client-presence record), never a beacon.
    const unjoined = await open(); await publish(unjoined, event(secret, 30207, 'c'.repeat(64), '{}', [['d', 'c:1']]))

    const t0 = Date.now()
    joined.ws.terminate()
    await sleep(5000)
    await publish(unjoined, event(secret, 30207, 'c'.repeat(64), '{"n":2}', [['d', 'c:2']]))
    await sleep(Math.max(0, t0 + 16_500 - Date.now()))

    assert.ok(left, "the joined tab's will fires although a same-key socket stayed open and spoke")
    assert.equal(left.pubkey, getPublicKey(secret))
    const ms = left.at - t0
    assert.ok(ms >= 14_000 && ms <= 16_000, `will after ${ms} ms, not 15 s ± 1 s`)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

test('the minute line counts and never names anyone', { timeout: 30_000 }, async () => {
  const r = await relay(['--allow-participants'], { DIAG_CENSUS_MS: '400', DIAG_RATE_LIMIT: '60' })
  const sockets = []
  try {
    const secret = generateSecretKey()
    const zone = createHash('sha256').update('lifecycle\0room\0secret').digest('hex')
    const s = await connect(r.port, { 'cf-connecting-ip': '203.0.113.5' })
    sockets.push(s)
    await publish(s, beacon(secret, zone))
    const bytes = randomBytes(1000)
    const url = `${r.base}/${sha(bytes)}`
    const token = finalizeEvent({ kind: 27235, created_at: nowSec(), tags: [['u', url], ['method', 'PUT']], content: '' }, secret)
    const put = await fetch(url, { method: 'PUT', body: bytes, headers: { Authorization: `Nostr ${Buffer.from(JSON.stringify(token)).toString('base64')}`, 'CF-Connecting-IP': '203.0.113.5' } })
    assert.equal(put.status, 201)
    // DIAG_RATE_LIMIT 60/min: a burst of 40 per connection, so most of 100 are refused.
    for (let i = 0; i < 100; i++) s.send(['REQ', 'p', { '#x': ['hc:live'], limit: 0 }])
    await sleep(1500)

    const lines = r.out.filter(line => line.startsWith('[minute]'))
    assert.ok(lines.length > 0, 'a minute line is printed while there is something to say')
    assert.ok(lines.some(line => /participant puts 1 \(1000 bytes\)/.test(line)), lines.join('\n'))
    assert.ok(lines.some(line => /refused event \d+ req ([1-9]\d*)/.test(line)), lines.join('\n'))
    assert.ok(lines.some(line => line.includes(`zones ${zone.slice(0, 6)}:1`)), lines.join('\n'))
    const names = [getPublicKey(secret).slice(0, 8), '203.0.113.5', '127.0.0.1', '::1']
    for (const line of lines) {
      for (const name of names) assert.ok(!line.includes(name), `the minute line names ${name}: ${line}`)
      assert.ok(!/[0-9a-f]{8,}/.test(line), `no key or signature in: ${line}`)
      assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(line), `no address in: ${line}`)
    }
    assert.equal(r.out.filter(line => line.startsWith('[write]')).length, 0, "a participant's write is a count, never a line")
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})

// The uploader is its own process, as a participant's browser is: what is
// measured is the relay's loop, not this process writing 6 MB.
const UPLOADER = `
import { createHash, randomBytes } from 'node:crypto'
import { finalizeEvent } from 'nostr-tools/pure'
const secret = Uint8Array.from(Buffer.from(process.env.UPLOAD_SECRET, 'hex'))
for (let n = 0; n < 3; n++) {
  const bytes = randomBytes(6 * 1024 * 1024)
  const url = process.env.UPLOAD_BASE + '/' + createHash('sha256').update(bytes).digest('hex')
  const token = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'PUT']], content: '' }, secret)
  const start = Date.now()
  const put = await fetch(url, { method: 'PUT', body: bytes, headers: { Authorization: 'Nostr ' + Buffer.from(JSON.stringify(token)).toString('base64') } })
  console.log(JSON.stringify({ start, end: Date.now(), status: put.status }))
  await new Promise(resolve => setTimeout(resolve, 700))
}
`

test("a 6 MB upload adds under 20 ms to the meeting's frame latency", { timeout: 90_000 }, async (t) => {
  const r = await relay(['--allow-participants'])
  const sockets = []
  try {
    const secret = generateSecretKey()
    const live = await connect(r.port)
    sockets.push(live)
    await publish(live, event(secret, 30200, 'f'.repeat(64), '{}', [['d', 'f'.repeat(64)]]))

    // 20 participants each sending a frame every 250 ms (above the 150/min a
    // navigating client was measured at), every frame fanned out to the other
    // 19, signed up front so the test's own signing is not what gets measured.
    const PER_SOCKET = 24
    // The room meets at a signature, as every room does (the address gate).
    const roomSig = sha(Buffer.from('meeting-room'))
    const room = []
    for (let i = 0; i < 20; i++) {
      const s = await connect(r.port)
      s.send(['REQ', 'room', { '#x': [roomSig], limit: 0 }])
      assert.ok(await s.wait(m => m[0] === 'EOSE'))
      s.key = generateSecretKey()
      room.push(s)
    }
    sockets.push(...room)

    const measure = async () => {
      for (const [i, s] of room.entries()) s.frames = Array.from({ length: PER_SOCKET }, (_, n) => event(s.key, 21000, roomSig, JSON.stringify({ n, i, at: Date.now() })))
      const samples = []  // { sentAt, ms }
      const began = Date.now()
      const run = room.map(async (s, i) => {
        await sleep(i * 12)  // spread over the 250 ms, as a real room is
        for (const frame of s.frames) {
          const sentAt = Date.now()
          s.send(['EVENT', frame])
          s.wait(m => m[0] === 'OK' && m[1] === frame.id, 5000).then(ok => { if (ok) samples.push({ sentAt, ms: ok.at - sentAt }) })
          await sleep(250)
        }
      })
      await sleep(2000)
      const uploads = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', UPLOADER], {
          cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'inherit'],
          env: { ...process.env, UPLOAD_BASE: r.base, UPLOAD_SECRET: Buffer.from(secret).toString('hex') },
        })
        let out = ''
        child.stdout.on('data', chunk => { out += chunk })
        child.on('error', reject)
        child.on('exit', () => resolve(out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))))
      })
      await Promise.all(run)
      await sleep(300)
      assert.deepEqual(uploads.map(u => u.status), [201, 201, 201])
      // Each upload against the second just before it, so a machine that is
      // busy with something else is busy on both sides of the comparison.
      const within = (s, from, to) => s.sentAt >= from && s.sentAt <= to
      const p95 = list => { const sorted = list.map(s => s.ms).sort((x, y) => x - y); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] }
      const quiet = samples.filter(s => s.sentAt > began + 500 && uploads.some(u => within(s, u.start - 1000, u.start - 100)))
      const busy = samples.filter(s => uploads.some(u => within(s, u.start, u.end + 50)))
      assert.ok(quiet.length >= 100 && busy.length >= 10, `enough samples (quiet ${quiet.length}, busy ${busy.length})`)
      return { quiet: p95(quiet), busy: p95(busy), frames: busy.length }
    }

    // A stalled loop stalls every time; a machine busy with something else
    // does not. So: the first clean measurement of three decides.
    const tries = []
    for (let n = 0; n < 3; n++) {
      const m = await measure()
      tries.push(m)
      t.diagnostic(`frame latency p95: ${m.quiet} ms quiet, ${m.busy} ms during 6 MB uploads (${m.frames} frames)`)
      if (m.busy - m.quiet < 20) return
    }
    // A baseline this slow is a machine too loaded to measure 20 ms on.
    if (tries.every(m => m.quiet > 150)) { t.skip('this machine is too busy to measure'); return }
    assert.fail(`an upload adds 20 ms or more to frame latency: ${tries.map(m => `${m.quiet} → ${m.busy} ms`).join(', ')}`)
  } finally {
    for (const s of sockets) try { s.ws.terminate() } catch {}
    r.close()
  }
})
