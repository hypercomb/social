import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { payloadHash, verifyNip98 } from './http-auth.js'

const secret = generateSecretKey()
const pubkey = getPublicKey(secret)
const body = Buffer.from('{"signature":"test"}')

function request(method, url, tags) {
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, secret)
  return {
    method,
    url,
    headers: { host: 'backup.example', authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}` },
    socket: { encrypted: true },
  }
}

test('NIP-98 verification binds method, complete URL, and payload', () => {
  const req = request('POST', '/replicate', [
    ['u', 'https://backup.example/replicate'],
    ['method', 'POST'],
    ['payload', payloadHash(body)],
  ])
  assert.deepEqual(verifyNip98(req, new Set([pubkey]), { payload: body }), { ok: true, pubkey })
  assert.match(verifyNip98(req, new Set([pubkey]), { payload: Buffer.from('changed') }).reason, /payload/)
})

test('NIP-98 verification rejects a token replayed onto another authority', () => {
  const req = request('GET', '/receipts', [['u', 'https://other.example/receipts'], ['method', 'GET']])
  assert.match(verifyNip98(req, new Set([pubkey])).reason, /url/)
})
