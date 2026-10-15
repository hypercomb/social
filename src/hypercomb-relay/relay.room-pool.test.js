// A swarm room is a POOL on the host (documentation/swarm-pools.md): an
// address holding the room's secret, whose members are flat files — each a
// key's signed claim (kind 30567) tagged with the pool, named by its own hash.
// A writer puts its own member; anyone holding the address lists and reads;
// every other directory still reads as "not held".
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})

function auth(secret, url, method) {
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', method]], content: '' }, secret)
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
}

const member = (secret, pool, head = 'c'.repeat(64)) => Buffer.from(JSON.stringify(
  finalizeEvent({ kind: 30567, created_at: Math.floor(Date.now() / 1000), tags: [['pool', pool], ['head', head]], content: '' }, secret)))

async function waitForRelay(base) {
  for (let tries = 0; tries < 100; tries++) {
    try { if ((await fetch(base)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`relay did not start at ${base}`)
}

test('a room is a pool: a writer puts its signed member, the address lists and reads it, nothing else opens', { timeout: 30_000 }, async () => {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-room-'))
  const writer = generateSecretKey()
  const stranger = generateSecretKey()
  const bag = sha(Buffer.from('a history bag'))
  mkdirSync(join(dir, bag))
  writeFileSync(join(dir, bag, '00000001'), 'a marker')
  const child = spawn(process.execPath, ['relay.js', '--port', String(port), '--memory', '--content-dir', dir, '--writers', getPublicKey(writer)], { cwd: import.meta.dirname, stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  const put = async (secret, pool, body, name = sha(body)) => {
    const url = `${base}/${pool}/${name}`
    const res = await fetch(url, { method: 'PUT', body, headers: { Authorization: auth(secret, url, 'PUT') } })
    return { status: res.status, text: (await res.text()).trim() }
  }
  try {
    await waitForRelay(base)
    const pool = sha(Buffer.from('swarm:lecture\0a-secret\0hypercomb.com'))
    const mine = member(writer, pool)
    const name = sha(mine)

    assert.equal((await fetch(`${base}/${pool}/`)).status, 404, 'an address nobody wrote to is not a pool')
    assert.deepEqual(await put(writer, pool, mine), { status: 201, text: `member ${name}` })
    assert.equal((await put(writer, pool, mine)).status, 200, 'the same member again is already held')

    const listing = await fetch(`${base}/${pool}/`)
    assert.equal(listing.status, 200)
    assert.equal(await listing.text(), `${name}\n`)
    const read = await fetch(`${base}/${pool}/${name}`)
    assert.equal(read.status, 200)
    assert.equal(await read.text(), mine.toString('utf8'))

    assert.equal((await put(writer, pool, member(writer, sha(Buffer.from('elsewhere'))))).status, 400, 'tagged with another pool')
    assert.equal((await put(writer, pool, member(stranger, pool))).status, 403, 'signed by another key than the caller')
    assert.equal((await put(writer, pool, mine, 'e'.repeat(64))).status, 400, 'bytes that do not hash to their name')
    assert.equal((await put(stranger, pool, member(stranger, pool))).status, 403, 'a key this host does not take (participants-closed, as for atoms)')

    assert.equal((await put(writer, bag, member(writer, bag))).status, 403, 'never into an address holding anything but members')
    assert.equal((await fetch(`${base}/${bag}/`)).status, 404, 'a bag still reads as not held')
    assert.equal((await fetch(`${base}/${bag}/00000001`)).status, 404, 'and so does its marker')
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
