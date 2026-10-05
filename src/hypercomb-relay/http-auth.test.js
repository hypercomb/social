import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { payloadHash, requestIp, verifyNip98 } from './http-auth.js'

const secret = generateSecretKey()
const pubkey = getPublicKey(secret)
const body = Buffer.from('{"signature":"test"}')

function request(method, url, tags, age = 0) {
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000) - age, tags, content: '' }, secret)
  return {
    method,
    url,
    headers: { host: 'backup.example', authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}` },
    socket: { encrypted: true },
  }
}

const put = (age = 0) => request('PUT', `/${'a'.repeat(64)}`, [['u', `https://backup.example/${'a'.repeat(64)}`], ['method', 'PUT']], age)

test('NIP-98 verification binds method, complete URL, and payload', () => {
  const req = request('POST', '/replicate', [
    ['u', 'https://backup.example/replicate'],
    ['method', 'POST'],
    ['payload', payloadHash(body)],
  ])
  assert.deepEqual(verifyNip98(req, new Set([pubkey]), { payload: body }), { ok: true, pubkey, role: 'writer' })
  assert.match(verifyNip98(req, new Set([pubkey]), { payload: Buffer.from('changed') }).reason, /payload/)
})

test('NIP-98 verification rejects a token replayed onto another authority', () => {
  const req = request('GET', '/receipts', [['u', 'https://other.example/receipts'], ['method', 'GET']])
  assert.match(verifyNip98(req, new Set([pubkey])).reason, /url/)
})

test('an allow callback admits a key the writer list does not name, as a participant', () => {
  // With no writers at all, the refusal is no longer "writes not enabled":
  // the callback is the whole answer.
  assert.deepEqual(verifyNip98(put(), new Set(), { allow: key => key === pubkey }), { ok: true, pubkey, role: 'participant' })
  // A listed writer is still a writer when it also passes the callback.
  assert.deepEqual(verifyNip98(put(), new Set([pubkey]), { allow: () => true }), { ok: true, pubkey, role: 'writer' })
  // Refused by the callback: denied, with the key, so the caller can say why.
  const refused = verifyNip98(put(), new Set(), { allow: () => false })
  assert.equal(refused.ok, false)
  assert.equal(refused.denied, true)
  assert.equal(refused.pubkey, pubkey)
  // Without a callback, an empty writer list still closes writes, and a
  // stranger is denied exactly as before.
  assert.match(verifyNip98(put(), new Set()).reason, /writes not enabled/)
  assert.equal(verifyNip98(put(), new Set(['f'.repeat(64)])).denied, true)
})

test('the freshness window is 60 s unless the route asks for more', () => {
  const writers = new Set([pubkey])
  assert.equal(verifyNip98(put(59), writers).ok, true)
  assert.match(verifyNip98(put(61), writers).reason, /freshness/)
  assert.equal(verifyNip98(put(300), writers, { skewSecs: 600 }).ok, true)
  assert.equal(verifyNip98(put(-300), writers, { skewSecs: 600 }).ok, true)
  assert.match(verifyNip98(put(601), writers, { skewSecs: 600 }).reason, /freshness/)
})

test('the client IP is CF-Connecting-IP only when the peer is loopback, and never the first X-Forwarded-For hop', () => {
  const at = (remoteAddress, headers = {}) => requestIp({ socket: { remoteAddress }, headers })
  // Through the tunnel: cloudflared on loopback, Cloudflare names the client.
  for (const loopback of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(at(loopback, { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1' }), '203.0.113.5')
  }
  // A spoofed X-Forwarded-For alone changes nothing.
  assert.equal(at('127.0.0.1', { 'x-forwarded-for': '198.51.100.1' }), '127.0.0.1')
  // A peer that reached the relay directly is its socket address, whatever it claims.
  assert.equal(at('192.0.2.44', { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1' }), '192.0.2.44')
  assert.equal(at(undefined), 'unknown')
})
