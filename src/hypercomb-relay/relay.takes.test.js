// THE QUESTION BEFORE THE UPLOAD: `GET /<sig>?takes`, signed as the upload
// would be, is answered in a 200 — yes, or the refusal the upload would get.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

async function waitForRelay(base) {
  for (let tries = 0; tries < 100; tries++) {
    try { if ((await fetch(base)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`relay did not start at ${base}`)
}

test('a relay says whether it would take a key\'s upload, in a 200, and takes nothing', async () => {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-relay-takes-'))
  const writer = generateSecretKey()
  const stranger = generateSecretKey()
  const child = spawn(process.execPath, ['relay.js', '--port', String(port), '--content-dir', dir, '--writers', getPublicKey(writer), '--allow-participants'], { cwd: import.meta.dirname, stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  try {
    await waitForRelay(base)
    const bytes = Buffer.from('an atom nobody has sent yet')
    const sig = sha(bytes)
    const ask = `${base}/${sig}?takes&held`
    const said = async (secret) => {
      const res = await fetch(ask, secret ? { headers: { Authorization: auth(secret, ask, 'GET') } } : {})
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /json/)
      assert.equal(res.headers.get('cache-control'), 'no-store')
      return res.json()
    }

    // A writer is taken.
    assert.deepEqual(await said(writer), { takes: true })

    // A key that never spoke here is told what its upload would be told —
    // the same code, the same words — without sending one.
    const refused = await said(stranger)
    assert.equal(refused.takes, false)
    assert.equal(refused.status, 401)
    assert.match(refused.reason, /^not-live\b/)
    const upload = await fetch(`${base}/${sig}`, { method: 'PUT', body: bytes, headers: { Authorization: auth(stranger, `${base}/${sig}`, 'PUT') } })
    assert.equal(upload.status, refused.status)
    assert.equal(await upload.text(), refused.reason)

    // No token at all is a refusal too, never a read of the atom.
    assert.equal((await said(null)).takes, false)

    // A reserved address is refused for everyone, as the upload is.
    const pool = sha(Buffer.from('host:packages', 'utf8'))
    const reservedAsk = `${base}/${pool}?takes`
    const reserved = await (await fetch(reservedAsk, { headers: { Authorization: auth(writer, reservedAsk, 'GET') } })).json()
    assert.equal(reserved.takes, false)
    assert.equal(reserved.status, 409)

    // The question wrote nothing, and the atom is still not held.
    assert.equal(existsSync(join(dir, sig)), false)
    assert.equal((await fetch(`${base}/${sig}?held`)).status, 204)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
