import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})

function auth(secret, url, method, body) {
  const tags = [['u', url], ['method', method]]
  if (body) tags.push(['payload', sha(body)])
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, secret)
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
}

test('authenticated replication is private, asynchronous, and receipted', { timeout: 20_000 }, async () => {
  const relayPort = await freePort()
  const sourcePort = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-test-'))
  const atom = Buffer.from('pulled atom')
  const signature = sha(atom)
  const source = createServer((req, res) => {
    if (req.url === `/${signature}`) { res.writeHead(200, { 'Content-Length': atom.length }); res.end(atom) }
    else { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => source.listen(sourcePort, '127.0.0.1', resolve))
  const secret = generateSecretKey()
  // A loopback source is a DEV configuration, and the relay now says so out
  // loud: without --allow-private-sources this request is refused before a
  // socket opens. See the SSRF test below for the refusal itself.
  const child = spawn(process.execPath, ['relay.js', '--port', String(relayPort), '--memory', '--content-dir', dir, '--writers', getPublicKey(secret), '--allow-private-sources'], { cwd: import.meta.dirname, stdio: 'ignore' })
  const base = `http://127.0.0.1:${relayPort}`
  try {
    for (let tries = 0; tries < 50; tries++) {
      try { if ((await fetch(base)).ok) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal((await fetch(`${base}/receipts`)).status, 401)
    assert.equal((await fetch(`${base}/.receipts/${getPublicKey(secret)}.json`)).status, 404)
    const body = Buffer.from(JSON.stringify({ signature, sources: [`http://127.0.0.1:${sourcePort}`] }))
    const accepted = await fetch(`${base}/replicate`, { method: 'POST', body, headers: { Authorization: auth(secret, `${base}/replicate`, 'POST', body), 'Content-Type': 'application/json' } })
    assert.equal(accepted.status, 202)
    let status
    for (let tries = 0; tries < 50; tries++) {
      const url = `${base}/replicate/${signature}`
      const response = await fetch(url, { headers: { Authorization: auth(secret, url, 'GET') } })
      status = response.ok ? await response.json() : null
      if (status?.state === 'complete') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(status?.state, 'complete')
    assert.deepEqual(status.holes, [])
    assert.equal((await fetch(`${base}/${signature}`, { method: 'HEAD' })).status, 200)
    const receiptsUrl = `${base}/receipts`
    const receipts = await fetch(receiptsUrl, { headers: { Authorization: auth(secret, receiptsUrl, 'GET') } })
    assert.equal(receipts.status, 200)
    assert.deepEqual((await receipts.json()).signatures, [signature])
  } finally {
    child.kill()
    await new Promise(resolve => source.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

// The replication handler is the one place a caller chooses where the HOST's
// socket goes. NIP-98 proves who is asking; it says nothing about where they
// pointed it, so an authorized writer aiming the relay at the operator's own
// network is the threat this covers.
test('replication destinations are screened, and a redirect is never followed', { timeout: 20_000 }, async () => {
  const relayPort = await freePort()
  const sourcePort = await freePort()
  const internalPort = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-ssrf-'))
  const secret = generateSecretKey()

  // Stands in for anything on the operator's network: cloud metadata, an admin
  // port, a database. It counts its callers, and the count must stay zero.
  let internalHits = 0
  const internal = createServer((req, res) => { internalHits++; res.writeHead(200); res.end('operator secret') })
  await new Promise(resolve => internal.listen(internalPort, '127.0.0.1', resolve))

  // A source that answers every atom with a redirect into that private space.
  const redirected = sha(Buffer.from('never arrives'))
  const source = createServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${internalPort}${req.url}` })
    res.end()
  })
  await new Promise(resolve => source.listen(sourcePort, '127.0.0.1', resolve))

  const guarded = spawn(process.execPath, ['relay.js', '--port', String(relayPort), '--memory', '--content-dir', dir, '--writers', getPublicKey(secret)], { cwd: import.meta.dirname, stdio: 'ignore' })
  const base = `http://127.0.0.1:${relayPort}`
  const post = async (sources) => {
    const body = Buffer.from(JSON.stringify({ signature: redirected, sources }))
    return await fetch(`${base}/replicate`, { method: 'POST', body, headers: { Authorization: auth(secret, `${base}/replicate`, 'POST', body), 'Content-Type': 'application/json' } })
  }
  try {
    for (let tries = 0; tries < 50; tries++) {
      try { if ((await fetch(base)).ok) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // 1. a loopback LITERAL — refused before a job exists
    const loopback = await post([`http://127.0.0.1:${sourcePort}`])
    assert.equal(loopback.status, 400)
    assert.match(await loopback.text(), /loopback/)

    // 2. a HOSTNAME that resolves into private space — the string looks public,
    //    the address is not, and the address is what is screened
    const byName = await post([`http://localhost:${sourcePort}`])
    assert.equal(byName.status, 400)
    assert.match(await byName.text(), /resolves to/)

    // 3. the link-local metadata address, spelled every way it can be spelled
    for (const source of ['http://169.254.169.254/', 'http://[::ffff:169.254.169.254]/', 'http://10.0.0.5/', 'http://[fd00::1]/']) {
      const response = await post([source])
      assert.equal(response.status, 400, `${source} must be refused`)
    }
    assert.equal(internalHits, 0)
  } finally {
    guarded.kill()
  }

  // 4. Even where private sources ARE allowed (a dev relay), a 3xx is a
  //    destination nobody named: the atom becomes a hole, and the redirect
  //    target is never called.
  const devPort = await freePort()
  const dev = spawn(process.execPath, ['relay.js', '--port', String(devPort), '--memory', '--content-dir', dir, '--writers', getPublicKey(secret), '--allow-private-sources'], { cwd: import.meta.dirname, stdio: 'ignore' })
  const devBase = `http://127.0.0.1:${devPort}`
  try {
    for (let tries = 0; tries < 50; tries++) {
      try { if ((await fetch(devBase)).ok) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const body = Buffer.from(JSON.stringify({ signature: redirected, sources: [`http://127.0.0.1:${sourcePort}`] }))
    const accepted = await fetch(`${devBase}/replicate`, { method: 'POST', body, headers: { Authorization: auth(secret, `${devBase}/replicate`, 'POST', body), 'Content-Type': 'application/json' } })
    assert.equal(accepted.status, 202)
    let status
    for (let tries = 0; tries < 50; tries++) {
      const url = `${devBase}/replicate/${redirected}`
      const response = await fetch(url, { headers: { Authorization: auth(secret, url, 'GET') } })
      status = response.ok ? await response.json() : null
      if (status?.state === 'complete') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(status?.state, 'complete')
    assert.deepEqual(status.holes, [redirected])
    assert.equal(internalHits, 0, 'the redirect target must never be fetched')
  } finally {
    dev.kill()
    await new Promise(resolve => source.close(resolve))
    await new Promise(resolve => internal.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
