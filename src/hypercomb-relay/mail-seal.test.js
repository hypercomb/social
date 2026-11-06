import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { sealMessage, openMessage, openMeta, sha256Hex } from './mail-worker/seal.js'
import { verifyNip98 } from './mail-worker/nip98.js'

const enc = new TextEncoder()
const latin1 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s }
const MESSAGE = enc.encode('From: a@example.org\r\nSubject: PLAINTEXT-SUBJECT\r\n\r\nPLAINTEXT-BODY\r\n')

test('a sealed message opens with the owner key and carries its own signature', async () => {
  const secret = generateSecretKey()
  const { sig, envelope } = await sealMessage(MESSAGE, getPublicKey(secret), { subject: 's' })
  assert.equal(sig, await sha256Hex(MESSAGE))
  const opened = await openMessage(envelope, secret)
  assert.equal(opened.sig, sig)
  assert.deepEqual(opened.bytes, MESSAGE)
})

test('the envelope holds no plaintext, and the same message seals differently each time', async () => {
  const pub = getPublicKey(generateSecretKey())
  const a = await sealMessage(MESSAGE, pub, { subject: 'PLAINTEXT-SUBJECT' })
  const b = await sealMessage(MESSAGE, pub, { subject: 'PLAINTEXT-SUBJECT' })
  for (const sealed of [a, b]) {
    assert.ok(!latin1(sealed.envelope).includes('PLAINTEXT-BODY'))
    assert.ok(!latin1(sealed.envelope).includes('PLAINTEXT-SUBJECT'))
    assert.ok(!sealed.metaToken.includes('PLAINTEXT-SUBJECT'))
  }
  assert.notDeepEqual(a.envelope, b.envelope)
  assert.equal(a.sig, b.sig)
})

test('another key cannot open it', async () => {
  const { envelope } = await sealMessage(MESSAGE, getPublicKey(generateSecretKey()), {})
  await assert.rejects(() => openMessage(envelope, generateSecretKey()))
})

test('tampering with the ciphertext, the header or the length is refused', async () => {
  const secret = generateSecretKey()
  const { envelope } = await sealMessage(MESSAGE, getPublicKey(secret), {})

  const body = envelope.slice(); body[body.length - 1] ^= 1
  await assert.rejects(() => openMessage(body, secret))

  const headerLength = new DataView(envelope.buffer).getUint32(0)
  const header = envelope.slice(); header[4 + headerLength - 3] ^= 1
  await assert.rejects(() => openMessage(header, secret))

  await assert.rejects(() => openMessage(envelope.slice(0, 3), secret), /malformed/)
  const longHeader = envelope.slice(); new DataView(longHeader.buffer).setUint32(0, longHeader.length)
  await assert.rejects(() => openMessage(longHeader, secret), /malformed/)
})

test('a message far beyond the 64 KB the Nostr cipher takes seals and opens', async () => {
  const secret = generateSecretKey()
  const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 251)
  const { envelope } = await sealMessage(big, getPublicKey(secret), {})
  assert.deepEqual((await openMessage(envelope, secret)).bytes, big)
})

test('the list metadata opens with the owner key, and fits R2\'s 2 KB custom metadata with room to spare', async () => {
  const secret = generateSecretKey()
  const worst = { from: 'é'.repeat(100), to: 'é'.repeat(100), subject: 'é'.repeat(120), size: 25 * 1024 * 1024, at: Date.now() }
  const { metaToken } = await sealMessage(MESSAGE, getPublicKey(secret), worst)
  assert.deepEqual(openMeta(metaToken, secret), worst)
  assert.ok(metaToken.length + 'meta'.length + 'at'.length + 13 < 1500, `token is ${metaToken.length} chars`)
  assert.throws(() => openMeta(metaToken, generateSecretKey()))
  assert.throws(() => openMeta('no-dot-here', secret), /malformed/)
})

// ── the signed request ──────────────────────────────────────────────────────

const URL_ = 'https://hypercomb.com/mail/box/jaime%40hypercomb.com'
function signed(secret, { url = URL_, method = 'GET', kind = 27235, created_at = Math.floor(Date.now() / 1000), tags } = {}) {
  const event = finalizeEvent({ kind, created_at, content: '', tags: tags ?? [['u', url], ['method', method]] }, secret)
  return new Request(url, { method, headers: { authorization: `Nostr ${btoa(JSON.stringify(event))}` } })
}

test('the owner\'s signed request is accepted', async () => {
  const secret = generateSecretKey()
  assert.deepEqual(await verifyNip98(signed(secret), { owner: getPublicKey(secret) }), { ok: true, pubkey: getPublicKey(secret) })
})

test('anything else is refused, and says why', async () => {
  const owner = generateSecretKey()
  const ownerPub = getPublicKey(owner)
  const ask = (request, options = {}) => verifyNip98(request, { owner: ownerPub, ...options })

  assert.match((await ask(new Request(URL_))).reason, /missing/)
  assert.match((await ask(new Request(URL_, { headers: { authorization: 'Nostr !!!' } }))).reason, /malformed/)
  assert.match((await ask(signed(generateSecretKey()))).reason, /not authorized/)
  assert.match((await ask(signed(owner, { kind: 1 }))).reason, /kind/)
  assert.match((await ask(signed(owner, { created_at: Math.floor(Date.now() / 1000) - 600 }))).reason, /freshness/)
  assert.match((await ask(signed(owner, { tags: [['u', URL_], ['method', 'POST']] }))).reason, /method/)
  assert.match((await ask(signed(owner, { tags: [['u', URL_ + '?x=1'], ['method', 'GET']] }))).reason, /url/)

  const forged = signed(owner)
  const event = JSON.parse(atob(forged.headers.get('authorization').slice(6)))
  event.content = 'changed after signing'
  const bad = new Request(URL_, { headers: { authorization: `Nostr ${btoa(JSON.stringify(event))}` } })
  assert.match((await ask(bad)).reason, /invalid signature/)
})
