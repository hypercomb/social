// Drafts (plan section 3): the owner's unfinished writing, sealed like a sent copy in its own pool
// `mail-draft:<address>`; listed, fetched and deleted on request.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import worker from './mail-worker/worker.js'
import { openMessage, openMeta, sha256Hex } from './mail-worker/seal.js'
import { FakeR2, latin1, quiet } from './mail-test-helpers.js'
import { poolMeaning } from './mail-address.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const jaime = generateSecretKey()
const phone = generateSecretKey()
const leanne = generateSecretKey()
const ME = 'jaime%40hypercomb.com'
const DRAFT = { to: ['friend@example.org', 'other@example.org'], subject: 'DRAFT-SUBJECT-MARKER', text: 'DRAFT-BODY-MARKER' }

function setup() {
  const MAIL = new FakeR2()
  const env = {
    MAIL,
    MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': [getPublicKey(jaime), getPublicKey(phone)], 'leanne@hypercomb.com': getPublicKey(leanne) }),
  }
  return { MAIL, env }
}

async function call(method, path, secret, { body, payload, contentType = 'application/json' } = {}) {
  const url = `https://hypercomb.com${path}`
  const bytes = body === undefined ? undefined : enc.encode(typeof body === 'string' ? body : JSON.stringify(body))
  const headers = {}
  if (bytes) headers['content-type'] = contentType
  if (secret) {
    const tags = [['u', url], ['method', method], ['nonce', crypto.randomUUID()]] // each write its own event (R1 #5)
    if (bytes) tags.push(['payload', payload ?? await sha256Hex(bytes)])
    const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags }, secret)
    headers.authorization = `Nostr ${btoa(JSON.stringify(event))}`
  }
  return new Request(url, { method, headers, body: bytes })
}

test('a draft is sealed to every owner key in its own pool, and answers its sig', async () => {
  const { MAIL, env } = setup()
  const res = await worker.fetch(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: DRAFT }), env)
  assert.equal(res.status, 200)
  const { sig } = await res.json()
  assert.equal(sig, await sha256Hex(enc.encode(JSON.stringify(DRAFT))))

  const pool = await sha256Hex(enc.encode(poolMeaning('jaime@hypercomb.com', 'drafts')))
  assert.equal(poolMeaning('jaime@hypercomb.com', 'drafts'), 'mail-draft:jaime@hypercomb.com')
  const entry = MAIL.map.get(`${pool}/${sig}`)
  assert.ok(entry)
  const stored = latin1(entry.bytes) + JSON.stringify(entry.customMetadata)
  for (const marker of ['DRAFT-SUBJECT-MARKER', 'DRAFT-BODY-MARKER', 'friend@example.org']) assert.ok(!stored.includes(marker), marker)

  for (const secret of [jaime, phone]) {
    const { items } = await (await worker.fetch(await call('GET', `/mail/drafts/${ME}`, secret), env)).json()
    assert.equal(items.length, 1)
    assert.equal(items[0].sig, sig)
    assert.equal(items[0].v, 2)
    assert.equal(items[0].marks, null)
    const meta = await openMeta(items[0], secret)
    assert.equal(meta.to, 'friend@example.org, other@example.org')
    assert.equal(meta.subject, DRAFT.subject)
    assert.equal(meta.size, enc.encode(JSON.stringify(DRAFT)).length)
    assert.equal(typeof meta.at, 'number')

    const one = await worker.fetch(await call('GET', `/mail/drafts/${ME}/${sig}`, secret), env)
    assert.equal(one.status, 200)
    assert.deepEqual(JSON.parse(dec.decode((await openMessage(new Uint8Array(await one.arrayBuffer()), secret)).bytes)), DRAFT)
  }
})

test('drafts are not the inbox or Sent, and saving the same draft twice is one draft', async () => {
  const { env } = setup()
  await worker.fetch(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: DRAFT }), env)
  await worker.fetch(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: DRAFT }), env)
  await worker.fetch(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: { ...DRAFT, text: 'edited' } }), env)
  const drafts = await (await worker.fetch(await call('GET', `/mail/drafts/${ME}`, jaime), env)).json()
  assert.equal(drafts.items.length, 2)
  for (const folder of ['box', 'sent']) {
    assert.deepEqual((await (await worker.fetch(await call('GET', `/mail/${folder}/${ME}`, jaime), env)).json()).items, [])
  }
})

test('a draft deletes on request, without marks', async () => {
  const { MAIL, env } = setup()
  const { sig } = await (await worker.fetch(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: DRAFT }), env)).json()
  assert.equal((await worker.fetch(await call('DELETE', `/mail/drafts/${ME}/${sig}`, leanne), env)).status, 401)
  assert.equal((await worker.fetch(await call('DELETE', `/mail/drafts/${ME}/${sig}`, phone), env)).status, 204)
  const pool = await sha256Hex(enc.encode(poolMeaning('jaime@hypercomb.com', 'drafts')))
  assert.ok(!MAIL.map.has(`${pool}/${sig}`))
  assert.ok(MAIL.map.has(`trash/${pool}/${sig}`), 'a deleted draft moves to trash (R1 #6)')
  assert.equal((await worker.fetch(await call('DELETE', `/mail/drafts/${ME}/${sig}`, jaime), env)).status, 404)
})

test('a draft needs the owner and its own body, JSON, at most 1 MiB', async () => {
  const { MAIL, env } = setup()
  const path = `/mail/drafts/${ME}`
  const status = async (...args) => (await worker.fetch(await call('PUT', path, ...args), env)).status
  assert.equal(await status(null, { body: DRAFT }), 401)
  assert.equal(await status(leanne, { body: DRAFT }), 401)
  assert.equal(await status(jaime, { body: DRAFT, payload: await sha256Hex(enc.encode('{}')) }), 401)
  assert.equal(await status(jaime, { body: DRAFT, contentType: 'text/plain' }), 415)
  assert.equal(await status(jaime, { body: '{nope' }), 400)
  assert.equal(await status(jaime, { body: '["a"]' }), 400)
  assert.equal(await status(jaime, { body: { ...DRAFT, text: 'x'.repeat(1024 * 1024) } }), 413)
  assert.equal(MAIL.map.size, 0)
  assert.equal((await worker.fetch(await call('POST', path, jaime, { body: DRAFT }), env)).status, 405)
  assert.equal((await worker.fetch(await call('PUT', `/mail/box/${ME}`, jaime, { body: DRAFT }), env)).status, 405)
})

test('a bucket that will not take the draft says so (503), plainly', async () => {
  const { MAIL, env } = setup()
  MAIL.failPut = true
  const res = await quiet(async () => worker.fetch(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: DRAFT }), env))
  assert.equal(res.status, 503)
  assert.equal(await res.text(), 'mailbox storage unavailable')
})
