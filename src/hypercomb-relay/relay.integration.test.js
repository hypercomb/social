import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { HOST_PACKAGES_POOL } from './replicate.js'

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

async function waitForRelay(base) {
  for (let tries = 0; tries < 100; tries++) {
    try { if ((await fetch(base)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`relay did not start at ${base}`)
}

async function requestReplication(base, secret, request) {
  const body = Buffer.from(JSON.stringify(request))
  return await fetch(`${base}/replicate`, {
    method: 'POST',
    body,
    headers: {
      Authorization: auth(secret, `${base}/replicate`, 'POST', body),
      'Content-Type': 'application/json',
    },
  })
}

async function waitForReplication(base, secret, signature) {
  for (let tries = 0; tries < 100; tries++) {
    const url = `${base}/replicate/${signature}`
    const response = await fetch(url, { headers: { Authorization: auth(secret, url, 'GET') } })
    const status = response.ok ? await response.json() : null
    if (status?.state === 'complete' || status?.state === 'failed') return status
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`replication did not finish for ${signature}`)
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

test('a replicated package is discoverable and can be pulled and published by another host', { timeout: 30_000 }, async () => {
  const firstPort = await freePort()
  const secondPort = await freePort()
  const sourcePort = await freePort()
  const firstDir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-package-a-'))
  const secondDir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-package-b-'))
  const leaf = Buffer.from(JSON.stringify({ name: 'child', cells: [], bees: [], dependencies: [] }))
  const leafSig = sha(leaf)
  const root = Buffer.from(JSON.stringify({ name: 'root', cells: [{ sig: leafSig }], bees: [], dependencies: [] }))
  const rootSig = sha(root)
  const generic = Buffer.from('replicated, but not a published package')
  const genericSig = sha(generic)
  const atoms = new Map([[rootSig, root], [leafSig, leaf], [genericSig, generic]])
  let delayedRootOnly = true
  const source = createServer((req, res) => {
    const parts = (req.url || '').split('/').filter(Boolean)
    const mode = parts.length > 1 ? parts[0] : 'all'
    const signature = parts.at(-1) || ''
    const atom = mode === 'root-only' && signature !== rootSig ? null : atoms.get(signature)
    const answer = () => {
      if (atom) { res.writeHead(200, { 'Content-Length': atom.length }); res.end(atom) }
      else { res.writeHead(404); res.end() }
    }
    // Keep the generic job in flight long enough for the package request to
    // overlap deterministically; that second request must retain its own
    // fuller source rather than inherit this root-only source.
    if (mode === 'root-only' && signature === rootSig && delayedRootOnly) {
      delayedRootOnly = false
      setTimeout(answer, 150)
    } else answer()
  })
  await new Promise(resolve => source.listen(sourcePort, '127.0.0.1', resolve))

  const secret = generateSecretKey()
  const writer = getPublicKey(secret)
  const first = spawn(process.execPath, ['relay.js', '--port', String(firstPort), '--memory', '--content-dir', firstDir, '--writers', writer, '--allow-private-sources'], { cwd: import.meta.dirname, stdio: 'ignore' })
  const second = spawn(process.execPath, ['relay.js', '--port', String(secondPort), '--memory', '--content-dir', secondDir, '--writers', writer, '--allow-private-sources'], { cwd: import.meta.dirname, stdio: 'ignore' })
  const firstBase = `http://127.0.0.1:${firstPort}`
  const secondBase = `http://127.0.0.1:${secondPort}`
  try {
    await Promise.all([waitForRelay(firstBase), waitForRelay(secondBase)])

    const reservedBody = Buffer.from('host:packages')
    assert.equal(sha(reservedBody), HOST_PACKAGES_POOL)
    const reservedUrl = `${firstBase}/${HOST_PACKAGES_POOL}`
    const reservedPut = await fetch(reservedUrl, {
      method: 'PUT', body: reservedBody,
      headers: { Authorization: auth(secret, reservedUrl, 'PUT', reservedBody) },
    })
    assert.equal(reservedPut.status, 409)
    assert.match(await reservedPut.text(), /reserved for the host:packages pool/)

    const genericFirst = await requestReplication(firstBase, secret, {
      signature: rootSig,
      sources: [`http://127.0.0.1:${sourcePort}/root-only`],
    })
    assert.equal(genericFirst.status, 202)
    const fromSource = await requestReplication(firstBase, secret, {
      signature: rootSig,
      sources: [`http://127.0.0.1:${sourcePort}/all`],
      package: { label: 'source-main' },
    })
    assert.equal(fromSource.status, 202)
    const firstStatus = await waitForReplication(firstBase, secret, rootSig)
    assert.equal(firstStatus.state, 'complete')
    assert.deepEqual(firstStatus.holes, [])
    assert.equal(firstStatus.package?.published, true)
    assert.equal(firstStatus.package?.appended, true)

    const firstListing = await fetch(`${firstBase}/${HOST_PACKAGES_POOL}/`)
    assert.equal(firstListing.status, 200)
    assert.equal(await firstListing.text(), '00000000')
    assert.equal(await (await fetch(`${firstBase}/${HOST_PACKAGES_POOL}/00000000`)).text(), `${rootSig}\nsource-main`)
    assert.equal((await fetch(`${firstBase}/${leafSig}`, { method: 'HEAD' })).status, 200)

    // The first relay is now the source. Its ordinary signature endpoints
    // carry the verified closure; explicit package metadata publishes the
    // same root into the second host's independently-derived pool.
    const fromRelay = await requestReplication(secondBase, secret, {
      signature: rootSig,
      sources: [firstBase],
      package: { label: 'shared-from-first' },
    })
    assert.equal(fromRelay.status, 202)
    const secondStatus = await waitForReplication(secondBase, secret, rootSig)
    assert.equal(secondStatus.state, 'complete')
    assert.equal(secondStatus.package?.published, true)
    assert.equal(await (await fetch(`${secondBase}/${HOST_PACKAGES_POOL}/`)).text(), '00000000')
    assert.equal(await (await fetch(`${secondBase}/${HOST_PACKAGES_POOL}/00000000`)).text(), `${rootSig}\nshared-from-first`)
    assert.equal((await fetch(`${secondBase}/${leafSig}`, { method: 'HEAD' })).status, 200)

    // Repeating a package request is a delta no-op and cannot rename or
    // duplicate the member that this host already published.
    assert.equal((await requestReplication(secondBase, secret, {
      signature: rootSig, sources: [firstBase], package: { label: 'renamed' },
    })).status, 202)
    const repeated = await waitForReplication(secondBase, secret, rootSig)
    assert.equal(repeated.package?.published, true)
    assert.equal(repeated.package?.appended, false)
    assert.equal(await (await fetch(`${secondBase}/${HOST_PACKAGES_POOL}/`)).text(), '00000000')
    assert.equal(await (await fetch(`${secondBase}/${HOST_PACKAGES_POOL}/00000000`)).text(), `${rootSig}\nshared-from-first`)

    // The old signature-only contract still replicates bytes without making
    // them packages. Publication requires the explicit metadata above.
    assert.equal((await requestReplication(secondBase, secret, {
      signature: genericSig, sources: [`http://127.0.0.1:${sourcePort}`],
    })).status, 202)
    const genericStatus = await waitForReplication(secondBase, secret, genericSig)
    assert.equal(genericStatus.state, 'complete')
    assert.equal(genericStatus.package, undefined)
    assert.equal((await fetch(`${secondBase}/${genericSig}`, { method: 'HEAD' })).status, 200)
    assert.equal(await (await fetch(`${secondBase}/${HOST_PACKAGES_POOL}/`)).text(), '00000000')
  } finally {
    first.kill()
    second.kill()
    await new Promise(resolve => source.close(resolve))
    rmSync(firstDir, { recursive: true, force: true })
    rmSync(secondDir, { recursive: true, force: true })
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
