// The access code (jwize 2026-10-09: "Just allow an access code that can be
// recycled — we will set up servers for other people"). A relay started with
// --access-codes <file> admits a WebSocket only when its dial carries the
// subprotocol `hc-access.<code>` whose sha256 is a line of the file; the file
// holds the hash, never the code. Recycling is one command — the new code in,
// the old one out — and takes effect on the running relay within a second,
// closing whoever came in on the old code. A refusal is close 4401 with no
// frame. A relay without --access-codes echoes the subprotocol and ignores it,
// so a browser that offers a code to the home relay still connects.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const sha = text => createHash('sha256').update(text).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})

/** `node relay.js <args>` as an operator runs it; its stdout and stderr. */
const operator = (...args) => {
  const run = spawnSync(process.execPath, ['relay.js', ...args], { cwd: import.meta.dirname, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  return { out: run.stdout.trim(), err: run.stderr }
}

async function relay(args) {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-access-'))
  const child = spawn(process.execPath, ['relay.js', '--port', String(port), '--content-dir', dir, ...args], { cwd: import.meta.dirname, stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (tries > 100) assert.fail(`relay did not start at ${base}`)
    await sleep(50)
  }
  return { port, base, close: () => { child.kill(); rmSync(dir, { recursive: true, force: true }) } }
}

/** Dial; resolve once it is decided: { opened, protocol, frames, closeCode, socket }. */
function dial(port, protocols) {
  return new Promise(resolve => {
    const ws = protocols ? new WebSocket(`ws://127.0.0.1:${port}`, protocols) : new WebSocket(`ws://127.0.0.1:${port}`)
    const seen = { opened: false, protocol: '', frames: [], closeCode: null, socket: ws, closed: null }
    seen.closed = new Promise(done => ws.on('close', code => { seen.closeCode = code; done(code) }))
    ws.on('open', () => { seen.opened = true; seen.protocol = ws.protocol })
    ws.on('message', raw => {
      seen.frames.push(JSON.parse(String(raw)))
      if (seen.frames.length === 1) resolve(seen)
    })
    ws.on('error', () => {})
    seen.closed.then(() => resolve(seen))
  })
}

const isCard = frame => frame[0] === 'NOTICE' && String(frame[1]).startsWith('hc:host ')

test('--new-access-code prints a code once and keeps only its hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-access-file-'))
  try {
    const file = join(dir, 'access-codes')
    const { out: code } = operator('--new-access-code', file)
    assert.match(code, /^[A-Za-z0-9_-]{22}$/, 'a 128-bit base64url code, valid in a subprotocol and a URL fragment')
    const held = readFileSync(file, 'utf8')
    assert.equal(held.trim(), sha(code))
    assert.ok(!held.includes(code), 'the code itself is never written down')
    // Recycled: a second code replaces the first.
    const { out: next } = operator('--new-access-code', file)
    assert.notEqual(next, code)
    assert.equal(readFileSync(file, 'utf8').trim(), sha(next))
    operator('--destroy-access-codes', file)
    assert.equal(readFileSync(file, 'utf8').trim(), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a meeting point with an access code admits only its current code — no frame to anyone else', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-access-file-'))
  const file = join(dir, 'access-codes')
  const { out: code } = operator('--new-access-code', file)
  const r = await relay(['--access-codes', file])
  try {
    for (const protocols of [undefined, 'hc-access.wrong-code', ['other', 'hc-access.'], 'hc-access.' + code.toUpperCase()]) {
      const refused = await dial(r.port, protocols)
      await refused.closed
      assert.equal(refused.closeCode, 4401, `refused: ${protocols}`)
      assert.deepEqual(refused.frames, [], 'not a frame — not even the card — before the close')
    }
    const admitted = await dial(r.port, 'hc-access.' + code)
    assert.equal(admitted.opened, true)
    assert.equal(admitted.protocol, 'hc-access.' + code, 'the offered subprotocol is echoed, as a browser requires')
    assert.ok(isCard(admitted.frames[0]), 'the card is its first frame, as on any relay')
    const info = await (await fetch(r.base, { headers: { Accept: 'application/nostr+json' } })).json()
    assert.equal(info.limitation.access_code, true)
    admitted.socket.close()
  } finally {
    r.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recycling takes effect at once on the running relay: the old code is out, and so is whoever came in on it', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-access-file-'))
  const file = join(dir, 'access-codes')
  const { out: oldCode } = operator('--new-access-code', file)
  const r = await relay(['--access-codes', file])
  try {
    const inOnOld = await dial(r.port, 'hc-access.' + oldCode)
    assert.equal(inOnOld.opened, true)

    const { out: newCode } = operator('--new-access-code', file)
    const started = Date.now()
    assert.equal(await Promise.race([inOnOld.closed, sleep(5_000).then(() => 'still open')]), 4401, 'the old session is dropped')
    assert.ok(Date.now() - started < 3_000, 'within a second or two — no restart, no redeploy')
    assert.equal((await dial(r.port, 'hc-access.' + oldCode)).closeCode, 4401)

    const inOnNew = await dial(r.port, 'hc-access.' + newCode)
    assert.equal(inOnNew.opened, true)
    assert.ok(isCard(inOnNew.frames[0]))

    // Destroyed: nobody is in, nobody new gets in.
    operator('--destroy-access-codes', file)
    assert.equal(await Promise.race([inOnNew.closed, sleep(5_000).then(() => 'still open')]), 4401)
    assert.equal((await dial(r.port, 'hc-access.' + newCode)).closeCode, 4401)

    // A hand-written file of several hashes admits each of them.
    writeFileSync(file, `# two groups\n${sha('group-a')}\n${sha('group-b')}\n`)
    await sleep(1_500)
    for (const each of ['group-a', 'group-b']) {
      const s = await dial(r.port, 'hc-access.' + each)
      assert.equal(s.opened, true, each)
      s.socket.close()
    }
  } finally {
    r.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing access file admits nobody (fail closed)', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-access-file-'))
  const r = await relay(['--access-codes', join(dir, 'never-written')])
  try {
    const s = await dial(r.port, 'hc-access.anything')
    assert.equal(s.closeCode, 4401)
    assert.deepEqual(s.frames, [])
  } finally {
    r.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a relay without an access code ignores the subprotocol — and echoes it, so a browser still connects', { timeout: 20_000 }, async () => {
  const r = await relay([])
  try {
    const s = await dial(r.port, 'hc-access.some-code')
    assert.equal(s.opened, true)
    assert.equal(s.protocol, 'hc-access.some-code')
    assert.ok(isCard(s.frames[0]))
    s.socket.close()
  } finally {
    r.close()
  }
})
