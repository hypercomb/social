import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { sealMessage, sealMessageV1, openMessage, openMeta, unwrapKey, fitMeta, sha256Hex, metadataBytes, R2_METADATA_LIMIT, META_JSON_BUDGET } from './mail-worker/seal.js'
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
    assert.ok(!JSON.stringify(sealed.customMetadata).includes('PLAINTEXT-SUBJECT'))
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

// v2: the meta needs the wraps to open, so it opens from the customMetadata (or a list item), not the token
// alone; and openMeta is a promise now (AES), so a wrong key rejects rather than throws.
test('the list metadata opens with the owner key, and the old worst case still fits whole', async () => {
  const secret = generateSecretKey()
  const worst = { from: 'é'.repeat(100), to: 'é'.repeat(100), subject: 'é'.repeat(120), size: 25 * 1024 * 1024, at: Date.now() }
  const { sig, customMetadata, metaToken } = await sealMessage(MESSAGE, getPublicKey(secret), worst)
  assert.equal(customMetadata.meta, metaToken)
  assert.deepEqual(await openMeta(customMetadata, secret, sig), worst) // bound to its sig (R1 #11)
  assert.ok(metadataBytes(customMetadata) < R2_METADATA_LIMIT, `${metadataBytes(customMetadata)} bytes`)
  await assert.rejects(() => openMeta(customMetadata, generateSecretKey(), sig))
  await assert.rejects(() => openMeta('no-dot-here', secret), /malformed/)
})

// ── the signed request ──────────────────────────────────────────────────────

const URL_ = 'https://hypercomb.com/mail/box/jaime%40hypercomb.com'
function signed(secret, { url = URL_, method = 'GET', kind = 27235, created_at = Math.floor(Date.now() / 1000), tags } = {}) {
  const event = finalizeEvent({ kind, created_at, content: '', tags: tags ?? [['u', url], ['method', method]] }, secret)
  return new Request(url, { method, headers: { authorization: `Nostr ${btoa(JSON.stringify(event))}` } })
}

test('the owner\'s signed request is accepted', async () => {
  const secret = generateSecretKey()
  const answer = await verifyNip98(signed(secret), { owner: getPublicKey(secret) })
  assert.equal(answer.ok, true)
  assert.equal(answer.pubkey, getPublicKey(secret))
  assert.match(answer.id, /^[a-f0-9]{64}$/)
  assert.equal(typeof answer.at, 'number')
  assert.equal(answer.payloadTag, undefined)
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

// ── envelope v2: many owners, and v1 still opens ────────────────────────────

const header = envelope => JSON.parse(new TextDecoder().decode(envelope.subarray(4, 4 + new DataView(envelope.buffer, envelope.byteOffset).getUint32(0))))

test('v2: one message, three owners, each opens it with their own key and nobody else does', async () => {
  const owners = [generateSecretKey(), generateSecretKey(), generateSecretKey()]
  const meta = { subject: 'for three', at: 1 }
  const sealed = await sealMessage(MESSAGE, owners.map(getPublicKey), meta)
  const h = header(sealed.envelope)
  assert.equal(h.v, 2)
  assert.equal(h.sig, sealed.sig)
  assert.deepEqual(h.wraps, sealed.wraps)
  assert.deepEqual(JSON.parse(sealed.customMetadata.wraps), sealed.wraps)
  assert.equal(sealed.customMetadata.v, '2')
  assert.deepEqual(h.wraps.map(w => w.to), owners.map(getPublicKey))
  assert.equal(new Set(h.wraps.map(w => w.epk)).size, 3, 'a fresh ephemeral key per wrap')
  for (const secret of owners) {
    assert.deepEqual((await openMessage(sealed.envelope, secret)).bytes, MESSAGE)
    assert.deepEqual(await openMeta(sealed.customMetadata, secret, sealed.sig), meta)
    assert.deepEqual(await openMeta({ sig: sealed.sig, v: 2, meta: sealed.metaToken, wraps: sealed.wraps }, secret), meta)
  }
  await assert.rejects(() => openMessage(sealed.envelope, generateSecretKey()))
})

test('v2: a wrap whose `to` is wrong still opens by trying each', async () => {
  const secret = generateSecretKey()
  const sealed = await sealMessage(MESSAGE, getPublicKey(secret), {})
  const wraps = sealed.wraps.map(w => ({ ...w, to: '0'.repeat(64) }))
  assert.equal(unwrapKey(wraps, secret).length, 32)
  assert.throws(() => unwrapKey(wraps, generateSecretKey()), /no wrap/)
  assert.throws(() => unwrapKey([], secret), /malformed/)
})

test('v2: a duplicate key is one wrap; a bad key or a fourth key is refused', async () => {
  const pub = getPublicKey(generateSecretKey())
  assert.equal((await sealMessage(MESSAGE, [pub, pub.toUpperCase()], {})).wraps.length, 1)
  await assert.rejects(() => sealMessage(MESSAGE, ['nope'], {}), /bad recipient/)
  await assert.rejects(() => sealMessage(MESSAGE, [], {}), /bad recipient/)
  const four = Array.from({ length: 4 }, () => getPublicKey(generateSecretKey()))
  await assert.rejects(() => sealMessage(MESSAGE, four, {}), /at most 3/)
})

test('v2: swapping wraps, the header sig, or the meta between messages is refused', async () => {
  const secret = generateSecretKey()
  const a = await sealMessage(MESSAGE, getPublicKey(secret), { subject: 'a' })
  const b = await sealMessage(enc.encode('other'), getPublicKey(secret), { subject: 'b' })
  await assert.rejects(() => openMeta({ meta: a.metaToken, wraps: b.wraps }, secret)) // b's key cannot open a's meta
  const h = header(a.envelope)
  const forged = new TextEncoder().encode(JSON.stringify({ ...h, wraps: b.wraps }))
  const body = a.envelope.subarray(4 + new DataView(a.envelope.buffer).getUint32(0))
  const swapped = new Uint8Array(4 + forged.length + body.length)
  new DataView(swapped.buffer).setUint32(0, forged.length); swapped.set(forged, 4); swapped.set(body, 4 + forged.length)
  await assert.rejects(() => openMessage(swapped, secret))
})

test('v1 objects (already in the live bucket) still open, body and meta (H3)', async () => {
  const secret = generateSecretKey()
  const meta = { from: 'a@example.org', subject: 'old', size: MESSAGE.length, at: 5 }
  const old = await sealMessageV1(MESSAGE, getPublicKey(secret), meta)
  assert.equal(header(old.envelope).v, 1)
  assert.deepEqual((await openMessage(old.envelope, secret)).bytes, MESSAGE)
  assert.deepEqual(await openMeta(old.metaToken, secret), meta)
  assert.deepEqual(await openMeta(old.customMetadata, secret), meta) // no wraps → read as v1
  assert.deepEqual(await openMeta({ v: 1, meta: old.metaToken }, secret), meta)
  await assert.rejects(() => openMessage(old.envelope, generateSecretKey()))
})

test('an unknown envelope version is refused', async () => {
  const secret = generateSecretKey()
  const { envelope } = await sealMessage(MESSAGE, getPublicKey(secret), {})
  const h = new TextEncoder().encode(JSON.stringify({ ...header(envelope), v: 3 }))
  const forged = new Uint8Array(4 + h.length); new DataView(forged.buffer).setUint32(0, h.length); forged.set(h, 4)
  await assert.rejects(() => openMessage(forged, secret), /unknown envelope version/)
})

// The worst meta the Worker can produce: every field at the length it clips to, every character two bytes
// in UTF-8 (where a field allows it), three owners. It must land under R2's 2,048 bytes, keys and all.
test('three owners and the worst-case meta fit R2\'s 2 KB customMetadata', async () => {
  const id = n => `<${String(n).repeat(198).slice(0, 198)}>` // 200 chars, the longest Message-ID kept
  const worst = {
    from: 'é'.repeat(100), to: 'é'.repeat(100), subject: 'é'.repeat(120), size: 25 * 1024 * 1024, at: Date.now(),
    id: id(0), messageId: id(1), inReplyTo: id(2), references: [id(3), id(4), id(5)], date: 'é'.repeat(64),
    hasAttachments: true, preview: 'é'.repeat(120),
  }
  const owners = [generateSecretKey(), generateSecretKey(), generateSecretKey()]
  const { sig, customMetadata } = await sealMessage(MESSAGE, owners.map(getPublicKey), worst)
  const bytes = metadataBytes(customMetadata)
  assert.ok(bytes <= R2_METADATA_LIMIT, `${bytes} bytes`)
  const opened = await openMeta(customMetadata, owners[2], sig)
  // What must survive the fit: who, what, how big, when, and that there are attachments.
  for (const field of ['size', 'at', 'hasAttachments']) assert.equal(opened[field], worst[field], field)
  assert.ok(opened.from.length > 0 && opened.to.length > 0 && opened.subject.length > 0)
  assert.ok(new TextEncoder().encode(JSON.stringify(opened)).length <= META_JSON_BUDGET)
})

test('fitMeta gives up the preview first, then the oldest references, and never cuts an id', () => {
  const id = n => `<${String(n).repeat(150)}@x>`
  const meta = { subject: 's', messageId: id(1), references: [id(2), id(3), id(4)], preview: 'p'.repeat(120), size: 1, at: 1 }
  const fitted = fitMeta(meta, 500)
  assert.equal(fitted.preview, undefined)
  assert.equal(fitted.messageId, meta.messageId)
  assert.deepEqual(fitted.references, meta.references.slice(-fitted.references.length))
  assert.ok(fitted.references.length < 3)
  assert.deepEqual(fitMeta({ subject: 'small', size: 1, at: 1 }), { subject: 'small', size: 1, at: 1 })
})
