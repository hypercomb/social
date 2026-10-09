import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { HOST_PACKAGES_POOL } from './replicate.js'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})

function auth(secret, url, method, body, age = 0) {
  const tags = [['u', url], ['method', method]]
  if (body) tags.push(['payload', sha(body)])
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000) - age, tags, content: '' }, secret)
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
    // Served from a stat and a stream, never a whole-file read on the loop:
    // HEAD carries the length with no body, GET streams the exact bytes.
    const head = await fetch(`${base}/${signature}`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(atom.length))
    const got = await fetch(`${base}/${signature}`)
    assert.equal(Buffer.from(await got.arrayBuffer()).toString(), atom.toString())
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

    // Only public pools are listed. A history bag or molecule pool the store
    // holds answers exactly like a pool it does not hold.
    const privateBag = createHash('sha256').update('some/private/path').digest('hex')
    mkdirSync(join(firstDir, privateBag), { recursive: true })
    writeFileSync(join(firstDir, privateBag, '00000000'), rootSig)
    const hidden = await fetch(`${firstBase}/${privateBag}/`)
    assert.equal(hidden.status, 404)
    assert.equal(await hidden.text(), await (await fetch(`${firstBase}/${'f'.repeat(64)}/`)).text())
    // and a guessed member name reads exactly like one under a missing dir
    const marker = await fetch(`${firstBase}/${privateBag}/00000000`)
    const missing = await fetch(`${firstBase}/${'f'.repeat(64)}/00000000`)
    assert.equal(marker.status, missing.status)
    assert.notEqual(await marker.text(), rootSig)

    // Secure delete: a loose atom goes, and so does its receipt; what the
    // published package needs stays, whatever the caller names.
    const loose = Buffer.from('forget me')
    const looseSig = createHash('sha256').update(loose).digest('hex')
    writeFileSync(join(firstDir, looseSig), loose)
    const forgetUrl = `${firstBase}/forget`
    const forgetBody = JSON.stringify({ sigs: [looseSig, rootSig] })
    const forget = await fetch(forgetUrl, { method: 'POST', body: forgetBody, headers: { Authorization: auth(secret, forgetUrl, 'POST', forgetBody), 'Content-Type': 'application/json' } })
    assert.equal(forget.status, 200)
    const forgot = await forget.json()
    assert.deepEqual(forgot.removed, [looseSig])
    assert.equal(forgot.kept[rootSig], 'package')
    assert.equal((await fetch(`${firstBase}/${looseSig}`, { method: 'HEAD' })).status, 404)
    assert.equal((await fetch(`${firstBase}/${rootSig}`, { method: 'HEAD' })).status, 200)
    const unsigned = await fetch(forgetUrl, { method: 'POST', body: forgetBody })
    assert.equal(unsigned.status, 401)
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

// The last-will (grace, cancellation, inheritance) is exercised in
// relay.meeting.test.js, beside the other meeting-transport behaviour.

test("a pool past the floor is listed only while the operator's signed index declares it", { timeout: 30_000 }, async () => {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-listing-'))
  const windows = sha(Buffer.from('hypercomb:windows', 'utf8'))
  const member = 'e'.repeat(64)
  mkdirSync(join(dir, windows))
  writeFileSync(join(dir, windows, member), '{}')
  const operator = generateSecretKey()
  const stranger = generateSecretKey()
  const child = spawn(process.execPath, ['relay.js', '--port', String(port), '--memory', '--content-dir', dir, '--writers', getPublicKey(operator)], { cwd: import.meta.dirname, stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  const declare = async (secret, listed, viaDrain = false) => {
    const url = `${base}/${sha(Buffer.from('hive:indexes', 'utf8'))}/${getPublicKey(secret)}`
    const drainUrl = `${base}/hive/${getPublicKey(secret)}`
    const evt = finalizeEvent({ kind: 30564, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ roots: {}, listed }) }, secret)
    const body = Buffer.from(JSON.stringify(evt))
    const target = viaDrain ? drainUrl : url
    const put = await fetch(target, { method: 'PUT', body, headers: { Authorization: auth(secret, target, 'PUT', body), 'Content-Type': 'application/json' } })
    assert.equal(put.status, 200)
  }
  try {
    await waitForRelay(base)
    assert.equal((await fetch(`${base}/${windows}/`)).status, 404)
    assert.equal((await fetch(`${base}/${windows}/${member}`)).status, 404)
    // Anyone may sign their own index; only the operator's word lists a pool.
    // An install already in use publishes through the drain route, /hive/<pubkey>.
    await declare(stranger, ['hypercomb:windows'], true)
    const strangerKey = getPublicKey(stranger)
    const viaDrain = await (await fetch(`${base}/hive/${strangerKey}`)).text()
    const viaAddress = await (await fetch(`${base}/${sha(Buffer.from('hive:indexes', 'utf8'))}/${strangerKey}`)).text()
    assert.equal(viaDrain, viaAddress)
    assert.equal((await fetch(`${base}/${windows}/`)).status, 404)
    await declare(operator, ['hypercomb:windows'])
    const listing = await fetch(`${base}/${windows}/`)
    assert.equal(listing.status, 200)
    assert.equal((await listing.text()).trim(), member)
    assert.equal((await fetch(`${base}/${windows}/${member}`)).status, 200)
    // The floor never needs a declaration.
    assert.equal((await fetch(`${base}/${HOST_PACKAGES_POOL}/`)).status, 200)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── NIP-05: who each writer is, at this host (documentation/sealed-audiences.md, Names)
// The relay answers /.well-known/nostr.json from its writers alone, and only
// at the hostnames its operator declared (--domain). `_` is the writer the
// operator declared (--primary), never whichever key a list happens to start
// with. A writer's name is the one its own signed profile atom carries, named
// by its own index as roots['nostr:profile'].
const NOSTR_JSON = '/.well-known/nostr.json'
const HIVE_INDEXES = sha(Buffer.from('hive:indexes', 'utf8'))
const DOMAIN = 'jwize.test'

/** A profile atom as the hive mints it: the complete signed event, as JSON bytes. */
function profileAtom(secret, profile, kind = 0) {
  const event = finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(profile) }, secret)
  const bytes = Buffer.from(JSON.stringify(event), 'utf8')
  return { bytes, sig: sha(bytes) }
}

async function putIndex(base, secret, content, createdAt = Math.floor(Date.now() / 1000)) {
  const url = `${base}/${HIVE_INDEXES}/${getPublicKey(secret)}`
  const evt = finalizeEvent({ kind: 30564, created_at: createdAt, tags: [],
    content: typeof content === 'string' ? content : JSON.stringify(content) }, secret)
  const body = Buffer.from(JSON.stringify(evt))
  const put = await fetch(url, { method: 'PUT', body, headers: { Authorization: auth(secret, url, 'PUT', body), 'Content-Type': 'application/json' } })
  assert.equal(put.status, 200)
  assert.equal((await put.json()).created_at, createdAt)
}

/** A request as a client reaching the relay under `host` makes it. fetch
 *  cannot set Host, so this goes through node:http. */
function askAt(base, path, { host = DOMAIN, method = 'GET', headers = {} } = {}) {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, method, headers: { ...headers, host } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function namesAt(base, query = '', options = {}) {
  const res = await askAt(base, `${NOSTR_JSON}${query}`, options)
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/json')
  assert.equal(res.headers['access-control-allow-origin'], '*')
  assert.equal(res.headers['cache-control'], 'no-store')
  const doc = JSON.parse(res.body)
  assert.deepEqual(Object.keys(doc), ['names'])
  return doc.names
}

function startRelay(port, dir, args, env = {}) {
  return spawn(process.execPath, ['relay.js', '--port', String(port), '--memory', '--content-dir', dir, ...args],
    { cwd: import.meta.dirname, stdio: 'ignore', env: { ...process.env, ...env } })
}

test('the relay names its writers from their own signed profiles, and vouches for nobody else', { timeout: 20_000 }, async () => {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-nip05-'))
  const keys = Object.fromEntries(['first', 'leanne', 'copycat', 'wrongKind', 'tampered', 'unparsed', 'unrooted', 'twinA', 'twinB', 'stranger']
    .map(name => [name, generateSecretKey()]))
  const pub = name => getPublicKey(keys[name])
  // The declared primary is LAST in the list: the order ranks nobody.
  const writers = [...Object.keys(keys).filter(name => name !== 'stranger' && name !== 'first'), 'first'].map(pub)
  const hold = atom => writeFileSync(join(dir, atom.sig), atom.bytes)
  const child = startRelay(port, dir, ['--writers', writers.join(','), '--domain', DOMAIN, '--primary', pub('first')])
  const base = `http://127.0.0.1:${port}`
  try {
    await waitForRelay(base)
    // No index held anywhere: the declared primary is the host's own key, and only that.
    assert.deepEqual(await namesAt(base), { _: pub('first') })

    // A writer's index names a profile atom the relay does not hold yet: no
    // name — and the miss is not remembered, so the atom counts once it lands.
    const leanne = profileAtom(keys.leanne, { name: 'Leanne', about: 'cafe society' })
    await putIndex(base, keys.leanne, { roots: { 'nostr:profile': leanne.sig } })
    assert.deepEqual(await namesAt(base), { _: pub('first') })
    hold(leanne)
    assert.deepEqual(await namesAt(base), { _: pub('first'), leanne: pub('leanne') })

    // Every profile that fails a check names nobody, and the answer is still 200:
    // an atom another key signed (the one just read, remembered by its sig) …
    await putIndex(base, keys.copycat, { roots: { 'nostr:profile': leanne.sig } })
    // … a signed event that is not a profile …
    const notProfile = profileAtom(keys.wrongKind, { name: 'wrongkind' }, 1)
    hold(notProfile)
    await putIndex(base, keys.wrongKind, { roots: { 'nostr:profile': notProfile.sig } })
    // … bytes that do not hash to the signature the index names …
    const named = profileAtom(keys.tampered, { name: 'tampered' })
    writeFileSync(join(dir, named.sig), profileAtom(keys.tampered, { name: 'swapped' }).bytes)
    await putIndex(base, keys.tampered, { roots: { 'nostr:profile': named.sig } })
    // … and indexes that do not parse, or name no atom.
    await putIndex(base, keys.unparsed, 'not json')
    await putIndex(base, keys.unrooted, { roots: { 'nostr:profile': 42 } })
    // A name two writers carry goes to neither.
    for (const twin of ['twinA', 'twinB']) {
      const atom = profileAtom(keys[twin], { name: 'Twin' })
      hold(atom)
      await putIndex(base, keys[twin], { roots: { 'nostr:profile': atom.sig } })
    }
    // Any key may sign its own index here; a stranger is not the host's to vouch for.
    const stranger = profileAtom(keys.stranger, { name: 'stranger' })
    hold(stranger)
    await putIndex(base, keys.stranger, { roots: { 'nostr:profile': stranger.sig } })
    assert.deepEqual(await namesAt(base), { _: pub('first'), leanne: pub('leanne') })

    // The primary answers as `_` and under its own name.
    const first = profileAtom(keys.first, { name: 'jwize' })
    hold(first)
    const firstAt = Math.floor(Date.now() / 1000)
    await putIndex(base, keys.first, { roots: { 'nostr:profile': first.sig } }, firstAt)
    const all = { _: pub('first'), jwize: pub('first'), leanne: pub('leanne') }
    assert.deepEqual(await namesAt(base), all)

    // ?name= answers one entry keyed exactly as asked; an unknown name is an empty 200.
    assert.deepEqual(await namesAt(base, '?name=Leanne'), { Leanne: pub('leanne') })
    assert.deepEqual(await namesAt(base, '?name=_'), { _: pub('first') })
    for (const unknown of ['nobody', 'stranger', 'twin', 'tampered', 'swapped', 'wrongkind']) {
      assert.deepEqual(await namesAt(base, `?name=${unknown}`), {}, unknown)
    }
    // A lookalike spelling (U+212A KELVIN SIGN lowercases to `k`) is not the name.
    assert.deepEqual(await namesAt(base, `?name=${encodeURIComponent('JwiKe')}`), {})
    assert.deepEqual(await namesAt(base, '?name='), all)
    // A client asking with the NIP-11 Accept header still gets the names.
    assert.deepEqual(await namesAt(base, '', { headers: { Accept: 'application/nostr+json' } }), all)
    // HEAD: the same answer, no body.
    const head = await askAt(base, NOSTR_JSON, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers['content-type'], 'application/json')
    assert.equal(head.body, '')

    // The names follow a writer's index as it moves — read once per move, never stale.
    const renamed = profileAtom(keys.first, { name: 'wize' })
    hold(renamed)
    await putIndex(base, keys.first, { roots: { 'nostr:profile': renamed.sig } }, firstAt + 1)
    assert.deepEqual(await namesAt(base), { _: pub('first'), wize: pub('first'), leanne: pub('leanne') })
    await putIndex(base, keys.leanne, { roots: {} }, firstAt + 1)
    assert.deepEqual(await namesAt(base), { _: pub('first'), wize: pub('first') })
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('names answer per request host: only a declared domain vouches, never a name merely pointed here', { timeout: 20_000 }, async () => {
  const [declaredPort, undeclaredPort] = [await freePort(), await freePort()]
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-nip05-'))
  const writer = getPublicKey(generateSecretKey())
  const declared = startRelay(declaredPort, dir, ['--writers', writer, '--domain', `${DOMAIN},second.test`, '--primary', writer])
  // The same writer and primary with no domain declared.
  const undeclared = startRelay(undeclaredPort, dir, ['--writers', writer, '--primary', writer])
  const [base, bare] = [`http://127.0.0.1:${declaredPort}`, `http://127.0.0.1:${undeclaredPort}`]
  try {
    await Promise.all([waitForRelay(base), waitForRelay(bare)])
    // Each declared name, however a Host header spells it.
    for (const host of [DOMAIN, 'second.test', `${DOMAIN}:8443`, 'JWize.Test', `${DOMAIN}.`]) {
      assert.deepEqual(await namesAt(base, '', { host }), { _: writer }, host)
    }
    // The relay face of the same domain, a name somebody pointed here, the bare address.
    for (const host of [`content.${DOMAIN}`, 'evil.example', `x${DOMAIN}`, `127.0.0.1:${declaredPort}`, 'localhost', '[::1]:7777', 'not a host']) {
      assert.deepEqual(await namesAt(base, '', { host }), {}, host)
      assert.deepEqual(await namesAt(base, '?name=_', { host }), {}, host)
    }
    // No domain declared: the relay vouches for nobody, anywhere.
    for (const host of [DOMAIN, `127.0.0.1:${undeclaredPort}`, 'evil.example']) {
      assert.deepEqual(await namesAt(bare, '', { host }), {}, host)
    }
  } finally {
    declared.kill()
    undeclared.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('_ is only the declared primary: never the first writer, never a key that is not a writer', { timeout: 20_000 }, async () => {
  const ports = [await freePort(), await freePort(), await freePort(), await freePort()]
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-nip05-'))
  const [a, b, outsider] = [generateSecretKey(), generateSecretKey(), generateSecretKey()]
  const [A, B] = [getPublicKey(a), getPublicKey(b)]
  const relays = [
    // Nobody declared, in either order: nobody is `_`.
    startRelay(ports[0], dir, ['--writers', `${A},${B}`, '--domain', DOMAIN]),
    startRelay(ports[1], dir, ['--writers', `${B},${A}`, '--domain', DOMAIN]),
    // Declared through the environment, as an npub: that key, wherever it sits in the list.
    startRelay(ports[2], dir, [], { WRITERS: `${A},${B}`, DOMAINS: DOMAIN, PRIMARY: nip19.npubEncode(B) }),
    // Declared, but not a writer: not this relay's to vouch for.
    startRelay(ports[3], dir, ['--writers', `${A},${B}`, '--domain', DOMAIN, '--primary', getPublicKey(outsider)]),
  ]
  const bases = ports.map(port => `http://127.0.0.1:${port}`)
  try {
    await Promise.all(bases.map(waitForRelay))
    assert.deepEqual(await namesAt(bases[0]), {})
    assert.deepEqual(await namesAt(bases[1]), {})
    assert.deepEqual(await namesAt(bases[2]), { _: B })
    assert.deepEqual(await namesAt(bases[3]), {})
    // Unranked writers still answer under their own profile names.
    const atom = profileAtom(a, { name: 'alpha' })
    writeFileSync(join(dir, atom.sig), atom.bytes)
    for (const base of bases) await putIndex(base, a, { roots: { 'nostr:profile': atom.sig } })
    assert.deepEqual(await namesAt(bases[0]), { alpha: A })
    assert.deepEqual(await namesAt(bases[1]), { alpha: A })
    assert.deepEqual(await namesAt(bases[2]), { _: B, alpha: A })
    assert.deepEqual(await namesAt(bases[3]), { alpha: A })
  } finally {
    for (const relay of relays) relay.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('with a shell, the names are still the JSON — never index.html, never a file placed by hand', { timeout: 20_000 }, async () => {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-nip05-'))
  const shell = mkdtempSync(join(tmpdir(), 'hypercomb-relay-nip05-shell-'))
  writeFileSync(join(shell, 'index.html'), '<!doctype html><title>host shell</title>')
  writeFileSync(join(shell, 'pin'), 'pin')
  const planted = JSON.stringify({ names: { _: 'f'.repeat(64), planted: 'f'.repeat(64) } })
  for (const root of [dir, shell]) {
    mkdirSync(join(root, '.well-known'))
    writeFileSync(join(root, '.well-known', 'nostr.json'), planted)
  }
  const writer = getPublicKey(generateSecretKey())
  const child = startRelay(port, dir, ['--shell-dir', shell, '--writers', writer, '--domain', DOMAIN, '--primary', writer])
  const base = `http://127.0.0.1:${port}`
  try {
    await waitForRelay(base)
    assert.match((await askAt(base, '/')).body, /host shell/)
    assert.deepEqual(await namesAt(base), { _: writer })
    assert.deepEqual(await namesAt(base, '', { headers: { Accept: 'text/html,*/*' } }), { _: writer })
    assert.deepEqual(await namesAt(base, '?name=planted'), {})
    // A host this relay does not vouch at gets the empty JSON — still never the file or the shell.
    assert.deepEqual(await namesAt(base, '', { host: 'evil.example', headers: { Accept: 'text/html,*/*' } }), {})
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
    rmSync(shell, { recursive: true, force: true })
  }
})

// ── the swarm's host: participants (--allow-participants) ────────────────────
// The relay a swarm meets at hosts its participants' atoms: a key live on the
// WebSocket may PUT /<sig>, within caps that count only new bytes, never over
// a pool's address, and the 201 body is the receipt.

/** A key that has spoken on the relay's WebSocket: one verified EVENT, or a
 *  lifecycle {alive} beacon in `zone`. The socket is returned open. */
async function goLive(port, secret, zone = null) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const now = Math.floor(Date.now() / 1000)
  const evt = zone
    ? finalizeEvent({ kind: 30206, created_at: now, tags: [['x', zone], ['d', getPublicKey(secret)], ['expiration', String(now + 90)]], content: JSON.stringify({ alive: true }) }, secret)
    : finalizeEvent({ kind: 30200, created_at: now, tags: [['x', 'f'.repeat(64)], ['d', 'f'.repeat(64)]], content: '{}' }, secret)
  const ok = await new Promise(resolve => {
    ws.on('message', raw => { const msg = JSON.parse(String(raw)); if (msg[0] === 'OK' && msg[1] === evt.id) resolve(msg) })
    ws.send(JSON.stringify(['EVENT', evt]))
  })
  assert.equal(ok[2], true, ok[3])
  return ws
}

/** PUT bytes at their own address (or `at`), signed by `secret` unless null. */
async function putAtom(base, secret, bytes, { at = sha(bytes), age = 0, headers = {} } = {}) {
  const url = `${base}/${at}`
  const res = await fetch(url, { method: 'PUT', body: bytes, headers: { ...(secret ? { Authorization: auth(secret, url, 'PUT', null, age) } : {}), ...headers } })
  return { status: res.status, body: await res.text(), headers: res.headers, sig: sha(bytes) }
}

const nip11 = async base => (await fetch(base, { headers: { Accept: 'application/nostr+json' } })).json()

async function relayWith(args, env = {}) {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-participants-'))
  const child = startRelay(port, dir, args, env)
  const base = `http://127.0.0.1:${port}`
  await waitForRelay(base)
  return { port, dir, base, close: () => { child.kill(); rmSync(dir, { recursive: true, force: true }) } }
}

test('a swarm meeting here is hosted: a live participant stores atoms, anyone else is told why not', { timeout: 30_000 }, async () => {
  const writer = generateSecretKey()
  const r = await relayWith(['--allow-participants', '--writers', getPublicKey(writer)])
  const sockets = []
  try {
    assert.equal((await nip11(r.base)).limitation.participant_uploads, 'all')
    const guest = generateSecretKey()
    const atom = Buffer.from('a tile picture, shared in the meeting')

    // Before the key has said a word on the WebSocket: not live, and told so.
    const early = await putAtom(r.base, guest, atom)
    assert.equal(early.status, 401)
    assert.match(early.body, /^not-live/)
    // Unsigned is still unsigned.
    assert.equal((await putAtom(r.base, null, atom)).status, 401)

    // One verified EVENT later, the same PUT is stored, and the 201 body is the receipt.
    sockets.push(await goLive(r.port, guest))
    const stored = await putAtom(r.base, guest, atom)
    assert.equal(stored.status, 201)
    assert.equal(stored.body, `stored ${stored.sig}`)
    assert.equal(stored.headers.get('access-control-allow-origin'), '*')
    const read = await fetch(`${r.base}/${stored.sig}`)
    assert.equal(read.status, 200)
    assert.match(read.headers.get('cache-control'), /immutable/)
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), atom)
    // No staging residue beside it.
    assert.deepEqual(readdirSync(r.dir).filter(name => name.startsWith('.part')), [])

    // A device whose clock is minutes off still uploads; past ±10 min it does not.
    assert.equal((await putAtom(r.base, guest, Buffer.from('clock five minutes slow'), { age: 300 })).status, 201)
    assert.match((await putAtom(r.base, guest, Buffer.from('clock eleven minutes slow'), { age: 660 })).body, /freshness/)

    // Bytes that are not the address are refused, as for a writer.
    assert.equal((await putAtom(r.base, guest, Buffer.from('not these bytes'), { at: sha(Buffer.from('other')) })).status, 422)

    // A pool's address is never an atom, for anyone — answered before auth.
    for (const meaning of ['hive:indexes', 'host:packages', 'community:hosts', 'host:offerings', 'community:offers']) {
      const preimage = Buffer.from(meaning, 'utf8')
      for (const who of [guest, null]) {
        const refused = await putAtom(r.base, who, preimage)
        assert.equal(refused.status, 409, `${meaning} must be reserved`)
      }
    }
    // A directory at the address (a bag, a pool) is never replaced — and only
    // an admitted key learns that it is there.
    const bag = Buffer.from('some/private/path', 'utf8')
    mkdirSync(join(r.dir, sha(bag)))
    assert.equal((await putAtom(r.base, guest, bag)).status, 409)
    assert.equal((await putAtom(r.base, generateSecretKey(), bag)).status, 401)
    // … and an admitted key that does NOT hold the address's preimage learns
    // nothing: wrong bytes at a held directory answer exactly as at an empty one.
    const wrong = Buffer.from('not the preimage')
    const atBag = await putAtom(r.base, guest, wrong, { at: sha(bag) })
    const atNothing = await putAtom(r.base, guest, wrong, { at: sha(Buffer.from('no directory here')) })
    assert.equal(atBag.status, 422)
    assert.equal(atNothing.status, 422)

    // A miss is never cached, so the atom can arrive a moment later.
    const miss = await fetch(`${r.base}/${'0'.repeat(64)}`)
    assert.equal(miss.status, 404)
    assert.equal(miss.headers.get('cache-control'), 'no-store')

    // The real cap: one participant atom is at most 8 MB — refused before a byte is stored.
    const big = await putAtom(r.base, guest, Buffer.alloc(9 * 1000 * 1000, 7))
    assert.equal(big.status, 413)
    assert.equal((await fetch(`${r.base}/${big.sig}`, { method: 'HEAD' })).status, 404)

    // Writers are unchanged: uncapped, and receipted to their own key. A
    // participant leaves no receipt — the host keeps no record of who stored what.
    const writerAtom = Buffer.alloc(9 * 1000 * 1000, 3)
    const written = await putAtom(r.base, writer, writerAtom)
    assert.equal(written.status, 201)
    assert.equal(written.body, `stored ${written.sig}`)
    const receiptsUrl = `${r.base}/receipts`
    const receipts = await (await fetch(receiptsUrl, { headers: { Authorization: auth(writer, receiptsUrl, 'GET') } })).json()
    assert.deepEqual(receipts.signatures, [written.sig])
    assert.deepEqual(readdirSync(join(r.dir, '.receipts')), [`${getPublicKey(writer)}.json`])
  } finally {
    for (const ws of sockets) ws.terminate()
    r.close()
  }
})

test('participant caps count only new bytes — per key, per venue address, in all — and say when to retry', { timeout: 30_000 }, async () => {
  const writer = generateSecretKey()
  const caps = { key: 3000, ip: 5000, total: 9000 }
  const r = await relayWith(['--allow-participants', '--writers', getPublicKey(writer)], { DIAG_PARTICIPANT_CAPS: JSON.stringify(caps) })
  const sockets = []
  const live = async () => { const secret = generateSecretKey(); sockets.push(await goLive(r.port, secret)); return secret }
  const venue = (ip, spoof) => ({ 'CF-Connecting-IP': ip, 'X-Forwarded-For': spoof })
  const retryAfter = res => {
    assert.ok(Number(res.headers.get('retry-after')) > 0, 'Retry-After is said')
    assert.match(res.headers.get('access-control-expose-headers') ?? '', /Retry-After/)
  }
  try {
    // Per key: 2000 new bytes, the same atom again for free, 1000 more fits, then nothing.
    const a = await live()
    assert.equal((await putAtom(r.base, a, Buffer.alloc(2000, 1))).status, 201)
    assert.equal((await putAtom(r.base, a, Buffer.alloc(2000, 1))).status, 201, 're-storing a held atom costs nothing')
    assert.equal((await putAtom(r.base, a, Buffer.alloc(1000, 2))).status, 201)
    const keyFull = await putAtom(r.base, a, Buffer.alloc(10, 3))
    assert.equal(keyFull.status, 429)
    assert.match(keyFull.body, /key/)
    retryAfter(keyFull)
    // … but a held atom is still answered, whatever the quota says.
    assert.equal((await putAtom(r.base, a, Buffer.alloc(2000, 1))).status, 201)

    // Per venue: CF-Connecting-IP from the tunnel is the address; a spoofed
    // X-Forwarded-For does not buy a second budget.
    const [b, c, d] = [await live(), await live(), await live()]
    assert.equal((await putAtom(r.base, b, Buffer.alloc(2000, 4), { headers: venue('198.51.100.7', '192.0.2.1') })).status, 201)
    assert.equal((await putAtom(r.base, c, Buffer.alloc(2000, 5), { headers: venue('198.51.100.7', '192.0.2.2') })).status, 201)
    const venueFull = await putAtom(r.base, d, Buffer.alloc(2000, 6), { headers: venue('198.51.100.7', '192.0.2.3') })
    assert.equal(venueFull.status, 429)
    assert.match(venueFull.body, /network/)
    retryAfter(venueFull)
    // The same key from another address is within both of its budgets.
    assert.equal((await putAtom(r.base, d, Buffer.alloc(2000, 6), { headers: venue('203.0.113.9', '192.0.2.3') })).status, 201)

    // In all: 3000 + 2000 + 2000 + 2000 = 9000 — the host is full for participants …
    const full = await putAtom(r.base, await live(), Buffer.alloc(1, 8))
    assert.equal(full.status, 507)
    assert.equal(full.body, 'host full')
    retryAfter(full)
    // … and never for its writers.
    assert.equal((await putAtom(r.base, writer, Buffer.alloc(4000, 9))).status, 201)
  } finally {
    for (const ws of sockets) ws.terminate()
    r.close()
  }
})

test('participants are closed by default, by room when listed, and refused on a nearly full disk', { timeout: 30_000 }, async () => {
  const writer = generateSecretKey()
  const room = sha(Buffer.from('lifecycle\0room\0secret'))
  const other = sha(Buffer.from('lifecycle\0other\0secret'))
  const [closed, byRoom, nearlyFull] = await Promise.all([
    relayWith(['--writers', getPublicKey(writer)]),
    relayWith([`--allow-participants=${room}`]),
    relayWith([], { ALLOW_PARTICIPANTS: 'all', DIAG_PARTICIPANT_CAPS: JSON.stringify({ floor: 1e18 }) }),
  ])
  const sockets = []
  const atom = Buffer.from('a shared tile')
  try {
    // No flag: the policy says so, and a live key is told the host is closed.
    assert.equal((await nip11(closed.base)).limitation.participant_uploads, false)
    const guest = generateSecretKey()
    sockets.push(await goLive(closed.port, guest))
    const refused = await putAtom(closed.base, guest, atom)
    assert.equal(refused.status, 403)
    assert.equal(refused.body, 'participants-closed')
    assert.equal((await putAtom(closed.base, writer, atom)).status, 201)

    // By room: a key that only spoke is not live here yet (its PUT beat its
    // beacon — 401, retried soon); a key that beaconed only in a room this
    // host does not take is refused for good (403, paused); a key that
    // beaconed in the listed room is in.
    assert.equal((await nip11(byRoom.base)).limitation.participant_uploads, 'zones')
    const [elsewhere, spoke, member] = [generateSecretKey(), generateSecretKey(), generateSecretKey()]
    sockets.push(await goLive(byRoom.port, elsewhere, other), await goLive(byRoom.port, spoke), await goLive(byRoom.port, member, room))
    const early = await putAtom(byRoom.base, spoke, atom)
    assert.equal(early.status, 401)
    assert.match(early.body, /^not-live/)
    const notHere = await putAtom(byRoom.base, elsewhere, atom)
    assert.equal(notHere.status, 403)
    assert.match(notHere.body, /^participants-closed/)
    assert.equal((await putAtom(byRoom.base, member, atom)).status, 201)

    // Under the free-disk floor, nothing more from participants (ALLOW_PARTICIPANTS=all from the environment).
    assert.equal((await nip11(nearlyFull.base)).limitation.participant_uploads, 'all')
    const late = generateSecretKey()
    sockets.push(await goLive(nearlyFull.port, late))
    let full
    for (let tries = 0; tries < 40; tries++) {
      full = await putAtom(nearlyFull.base, late, atom)
      if (full.status === 507) break
      await new Promise(resolve => setTimeout(resolve, 50))  // the first free-space reading is in flight
    }
    assert.equal(full.status, 507)
    assert.equal(full.body, 'host full')
  } finally {
    for (const ws of sockets) ws.terminate()
    for (const r of [closed, byRoom, nearlyFull]) r.close()
  }
})
