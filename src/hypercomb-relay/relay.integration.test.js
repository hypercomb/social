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
  const child = spawn(process.execPath, ['relay.js', '--port', String(relayPort), '--memory', '--content-dir', dir, '--writers', getPublicKey(secret)], { cwd: import.meta.dirname, stdio: 'ignore' })
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
