import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMailInbox, mailPool, normalizeAddress } from './mail-inbox.js'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const MESSAGE = Buffer.from('From: a@example.org\r\nTo: jaime@hypercomb.com\r\nSubject: hello\r\n\r\nbody\r\n')

async function host(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mail-inbox-'))
  const handle = createMailInbox({ dir, log: () => {}, ...options })
  const server = createServer((req, res) => { if (!handle(req, res)) { res.writeHead(404); res.end('other') } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    dir, base,
    close: async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) },
  }
}

const post = (base, headers, body = MESSAGE) => fetch(`${base}/mail/inbound`, { method: 'POST', headers, body })
const good = { 'X-Mail-Secret': 's3cret', 'X-Mail-To': 'Jaime@Hypercomb.com', 'X-Mail-From': 'a@example.org' }
const members = (dir, address) => {
  const pool = join(dir, mailPool(address))
  return existsSync(pool) ? readdirSync(pool).filter(name => /^[a-f0-9]{64}$/.test(name)) : []
}

test('inbound is off until a secret is configured', async () => {
  const h = await host()
  try {
    const res = await post(h.base, good)
    assert.equal(res.status, 503)
    assert.equal(readdirSync(h.dir).length, 0)
  } finally { await h.close() }
})

test('a wrong or missing secret stores nothing', async () => {
  const h = await host({ secret: 's3cret' })
  try {
    assert.equal((await post(h.base, { ...good, 'X-Mail-Secret': 'nope' })).status, 401)
    assert.equal((await post(h.base, { 'X-Mail-To': good['X-Mail-To'] })).status, 401)
    assert.equal(readdirSync(h.dir).length, 0)
  } finally { await h.close() }
})

test('a message is stored by its signature and listed under its recipient', async () => {
  const h = await host({ secret: 's3cret' })
  try {
    const res = await post(h.base, good)
    const sig = sha256(MESSAGE)
    assert.equal(res.status, 201)
    assert.equal(await res.text(), `stored ${sig}`)
    assert.deepEqual(readFileSync(join(h.dir, sig)), MESSAGE)
    assert.deepEqual(members(h.dir, 'jaime@hypercomb.com'), [sig])
    const record = JSON.parse(readFileSync(join(h.dir, mailPool('jaime@hypercomb.com'), sig), 'utf8'))
    assert.equal(record.to, 'jaime@hypercomb.com')
    assert.equal(record.from, 'a@example.org')
    assert.equal(record.size, MESSAGE.length)
  } finally { await h.close() }
})

test('a replayed post changes nothing: same signature, first arrival time kept', async () => {
  const h = await host({ secret: 's3cret' })
  try {
    await post(h.base, good)
    const sig = sha256(MESSAGE)
    const first = readFileSync(join(h.dir, mailPool('jaime@hypercomb.com'), sig), 'utf8')
    await new Promise(resolve => setTimeout(resolve, 15))
    assert.equal((await post(h.base, good)).status, 201)
    assert.equal(readFileSync(join(h.dir, mailPool('jaime@hypercomb.com'), sig), 'utf8'), first)
    assert.equal(members(h.dir, 'jaime@hypercomb.com').length, 1)
  } finally { await h.close() }
})

test('one message to two recipients is one file and two pool members', async () => {
  const h = await host({ secret: 's3cret' })
  try {
    await post(h.base, good)
    await post(h.base, { ...good, 'X-Mail-To': 'leanne@hypercomb.com' })
    const sig = sha256(MESSAGE)
    assert.deepEqual(members(h.dir, 'jaime@hypercomb.com'), [sig])
    assert.deepEqual(members(h.dir, 'leanne@hypercomb.com'), [sig])
    assert.equal(readdirSync(h.dir).filter(name => name === sig).length, 1)
  } finally { await h.close() }
})

test('bad recipients, foreign domains and empty bodies are refused', async () => {
  const h = await host({ secret: 's3cret', domains: ['hypercomb.com'] })
  try {
    assert.equal((await post(h.base, { ...good, 'X-Mail-To': 'not an address' })).status, 422)
    assert.equal((await post(h.base, { ...good, 'X-Mail-To': '../../x@hypercomb.com' })).status, 422)
    assert.equal((await post(h.base, { ...good, 'X-Mail-To': 'a@other.org' })).status, 422)
    assert.equal((await post(h.base, { 'X-Mail-Secret': 's3cret' })).status, 422)
    assert.equal((await post(h.base, good, Buffer.alloc(0))).status, 400)
    assert.equal(readdirSync(h.dir).length, 0)
  } finally { await h.close() }
})

test('a message over the cap is refused and nothing is kept', async () => {
  const h = await host({ secret: 's3cret', maxBytes: 16 })
  try {
    // The server may cut the connection after answering, so a reset counts as refused too.
    const res = await post(h.base, good, Buffer.alloc(200, 97)).catch(() => null)
    if (res) assert.equal(res.status, 413)
    assert.equal(readdirSync(h.dir).length, 0)
  } finally { await h.close() }
})

test('only POST reaches inbound, and other paths are not this handler\'s', async () => {
  const h = await host({ secret: 's3cret' })
  try {
    assert.equal((await fetch(`${h.base}/mail/inbound`)).status, 405)
    assert.equal(await (await fetch(`${h.base}/somewhere-else`)).text(), 'other')
    assert.equal((await fetch(`${h.base}/mail/nothing`)).status, 404)
  } finally { await h.close() }
})

test('reads stay off without authorize, and refuse a caller who is not authorized', async () => {
  const off = await host({ secret: 's3cret' })
  try {
    assert.equal((await fetch(`${off.base}/mail/box/jaime@hypercomb.com`)).status, 403)
  } finally { await off.close() }

  const closed = await host({ secret: 's3cret', authorize: () => ({ ok: false, reason: 'nope' }) })
  try {
    await post(closed.base, good)
    assert.equal((await fetch(`${closed.base}/mail/box/jaime@hypercomb.com`)).status, 401)
    assert.equal((await fetch(`${closed.base}/mail/message/${sha256(MESSAGE)}`)).status, 401)
  } finally { await closed.close() }
})

test('an authorized read lists one address newest first and returns the raw bytes', async () => {
  const h = await host({ secret: 's3cret', authorize: () => ({ ok: true }) })
  try {
    const older = Buffer.from('Subject: older\r\n\r\none\r\n')
    const newer = Buffer.from('Subject: newer\r\n\r\ntwo\r\n')
    const other = Buffer.from('Subject: other\r\n\r\nthree\r\n')
    await post(h.base, good, older)
    await new Promise(resolve => setTimeout(resolve, 15))
    await post(h.base, good, newer)
    await post(h.base, { ...good, 'X-Mail-To': 'leanne@hypercomb.com' }, other)

    const list = await (await fetch(`${h.base}/mail/box/${encodeURIComponent('jaime@hypercomb.com')}`)).json()
    assert.deepEqual(list.map(item => item.sig), [sha256(newer), sha256(older)])

    const res = await fetch(`${h.base}/mail/message/${sha256(newer)}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'message/rfc822')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), newer)

    assert.equal((await fetch(`${h.base}/mail/message/${sha256(Buffer.from('never stored'))}`)).status, 404)
    assert.equal((await fetch(`${h.base}/mail/box/%E0%A4%A`)).status, 422)
    assert.deepEqual(await (await fetch(`${h.base}/mail/box/nobody@hypercomb.com`)).json(), [])
  } finally { await h.close() }
})

test('normalizeAddress lowercases and refuses anything that is not one address', () => {
  assert.equal(normalizeAddress(' Jaime@Hypercomb.com '), 'jaime@hypercomb.com')
  assert.equal(normalizeAddress('first.last+tag@mail.hypercomb.com'), 'first.last+tag@mail.hypercomb.com')
  for (const bad of ['', 'x', 'a@', '@b.com', 'a b@c.com', 'a@b.com, c@d.com', '<a@b.com>', 'a@b.com\r\nBcc: x@y.com',
    '../x@hypercomb.com', '.a@c.com', 'a.@c.com', 'a..b@c.com', 'a@b', 'a@-b.com', 'a@b..com', `${'a'.repeat(65)}@c.com`]) {
    assert.equal(normalizeAddress(bad), null, JSON.stringify(bad))
  }
})
