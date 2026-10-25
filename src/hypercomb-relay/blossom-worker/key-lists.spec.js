// key-lists.spec.js — the host's three key-list questions, driven by the really
// signed chains in key-list.vector.json and a store that keeps etags the way R2
// does. `node --test key-lists.spec.js`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1.js'
import { KEY_LISTS_MAX_BYTES, keyChainKey, keyLists } from './key-lists.js'

const VECTOR = JSON.parse(readFileSync(new URL('./key-list.vector.json', import.meta.url), 'utf8'))
const utf8 = new TextEncoder()
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text) => Uint8Array.from(String(text).match(/../g) ?? [], (pair) => parseInt(pair, 16))
const sha256Hex = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))

/** NIP-01, as worker.js verifyEventSig checks it. */
async function verifyEventSig(evt) {
  if (!evt || typeof evt !== 'object' || !Array.isArray(evt.tags) || typeof evt.content !== 'string') return false
  const id = await sha256Hex(utf8.encode(JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content])))
  if (String(evt.id) !== id) return false
  try { return schnorr.verify(bytesOf(evt.sig), bytesOf(id), bytesOf(evt.pubkey)) } catch { return false }
}

/** A store that answers conditional puts as R2 does: an etag per version. */
function bucket() {
  const held = new Map()
  const etagOf = async (bytes) => `"${await sha256Hex(bytes)}"`
  return {
    held,
    get: async (key) => {
      if (!held.has(key)) return null
      const bytes = held.get(key)
      return { httpEtag: await etagOf(bytes), arrayBuffer: async () => bytes.slice().buffer }
    },
    put: async (key, body, options) => {
      if (options?.onlyIf?.get?.('If-None-Match') === '*' && held.has(key)) return null
      const ifMatch = options?.onlyIf?.get?.('If-Match')
      if (ifMatch && (!held.has(key) || await etagOf(held.get(key)) !== ifMatch)) return null
      held.set(key, new Uint8Array(await new Response(body).arrayBuffer()))
      return { key }
    },
  }
}

const ANCHOR = VECTOR.anchor
const key = (name) => VECTOR.keys[name].pubkey
const chain = (name) => VECTOR.chains.find((c) => c.name === name).chain
const ALONE = chain('the anchor alone')
const WITH_DESKTOP = chain('the anchor adds a desktop')
const ACCEPTED = chain('an invite spent on one key')
const ANCHOR_REMOVED = chain('the desktop takes the anchor off')
const TAMPERED = chain('a step whose content changed after signing')
const body = (events) => utf8.encode(JSON.stringify(events))
const NOW = 1_790_000_200

const setup = async (heldChain) => {
  const env = { CONTENT: bucket() }
  if (heldChain) env.CONTENT.held.set(await keyChainKey(ANCHOR), body(heldChain))
  return { env, lists: keyLists(verifyEventSig) }
}

test('the vector: its keys come from their seeds, and the pool address from its meaning', async () => {
  assert.equal(VECTOR.poolAddress, await sha256Hex(utf8.encode(VECTOR.meaning)))
  assert.equal(await keyChainKey(ANCHOR), `${VECTOR.poolAddress}/${ANCHOR}`)
  for (const { seed, pubkey } of Object.values(VECTOR.keys)) {
    const secret = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(seed)))
    assert.equal(hex(schnorr.getPublicKey(secret)), pubkey)
  }
})

test('the vector: a held chain lists exactly the keys core says, and a refused one lists nobody', async () => {
  for (const c of VECTOR.chains) {
    const { env, lists } = await setup(c.chain)
    const held = await lists.heldKeyList(env, ANCHOR)
    assert.deepEqual([...held.keys], c.expect.ok ? c.expect.keys : [], c.name)
    if (!c.expect.ok) assert.deepEqual({ reason: held.verdict.reason, at: held.verdict.at }, { reason: c.expect.reason, at: c.expect.at }, c.name)
  }
})

test('the vector: a host takes or refuses each offered chain as core does', async () => {
  for (const a of VECTOR.accepts) {
    const { env, lists } = await setup(a.held)
    const answer = await lists.offerKeyChain(env, ANCHOR, ANCHOR, body(a.offered), a.now)
    // Every vector host already holds a chain, so a taken chain answers 200.
    const status = a.expect.ok ? (a.held.length ? 200 : 201) : a.expect.reason === 'fork' ? 409 : 400
    assert.equal(answer.status, status, `${a.name}: ${answer.reason}`)
    if (!a.expect.ok) assert.match(answer.reason, new RegExp(`list ${a.expect.at}: ${a.expect.reason}`), a.name)
  }
})

test('a first chain is held and served back byte for byte; the same chain again changes nothing', async () => {
  const { env, lists } = await setup()
  const first = await lists.offerKeyChain(env, ANCHOR, ANCHOR, body(ALONE), NOW)
  assert.equal(first.status, 201, first.reason)
  assert.deepEqual(await lists.heldKeyChainBytes(env, ANCHOR), body(ALONE))
  assert.equal((await lists.offerKeyChain(env, ANCHOR, ANCHOR, body(ALONE), NOW)).status, 200)
  assert.equal((await lists.offerKeyChain(env, ANCHOR, ANCHOR, body(WITH_DESKTOP), NOW)).status, 200)
  assert.deepEqual([...(await lists.heldKeyList(env, ANCHOR)).keys], [ANCHOR, key('desktop')])
  assert.equal(await lists.heldKeyChainBytes(env, key('desktop')), null)
})

test('the place that just spent an invite may carry the chain that names it', async () => {
  const { env, lists } = await setup(ACCEPTED.slice(0, 2))
  const answer = await lists.offerKeyChain(env, ANCHOR, key('desktop'), body(ACCEPTED), NOW)
  assert.equal(answer.status, 200, answer.reason)
})

test('a stranger, an oversized body, a non-array and an overlong chain are refused before anything is read', async () => {
  const { env, lists } = await setup()
  assert.equal((await lists.offerKeyChain(env, ANCHOR, key('stranger'), body(WITH_DESKTOP), NOW)).status, 403)
  assert.equal((await lists.offerKeyChain(env, ANCHOR, ANCHOR, new Uint8Array(KEY_LISTS_MAX_BYTES + 1), NOW)).status, 413)
  assert.equal((await lists.offerKeyChain(env, ANCHOR, ANCHOR, utf8.encode('{"not":"a chain"}'), NOW)).status, 400)
  assert.equal((await lists.offerKeyChain(env, ANCHOR, ANCHOR, body(Array(257).fill(ALONE[0])), NOW)).status, 400)
  assert.equal(env.CONTENT.held.size, 0)
})

test('two writers from the same held chain: the second is told to read again', async () => {
  const { env, lists } = await setup(ALONE)
  const realGet = env.CONTENT.get
  let raced = false
  env.CONTENT.get = async (k) => {
    const object = await realGet(k)
    if (!raced) { raced = true; env.CONTENT.held.set(k, body(WITH_DESKTOP)) } // the other writer lands
    return object
  }
  // This writer offers list 0 and an invite list: a good extension of what it read.
  const answer = await lists.offerKeyChain(env, ANCHOR, ANCHOR, body(ACCEPTED.slice(0, 2)), NOW)
  assert.equal(answer.status, 409, answer.reason)
  assert.match(answer.reason, /read it again/)
})

test('a request acts as its anchor only when the held list names its signer', async () => {
  const { env, lists } = await setup(WITH_DESKTOP)
  const tagged = (pubkey) => ({ pubkey, tags: [['anchor', ANCHOR]] })
  assert.deepEqual(await lists.actingKey(env, tagged(key('desktop'))), { ok: true, pubkey: ANCHOR, signer: key('desktop') })
  assert.equal((await lists.actingKey(env, tagged(key('stranger')))).ok, false)
  assert.equal((await lists.actingKey(env, { pubkey: key('desktop'), tags: [['anchor', 'not-a-key']] })).ok, false)
  assert.deepEqual(await lists.actingKey(env, { pubkey: key('phone'), tags: [] }), { ok: true, pubkey: key('phone'), signer: key('phone') })
  assert.deepEqual(await lists.actingKey(env, { pubkey: ANCHOR, tags: [] }), { ok: true, pubkey: ANCHOR, signer: ANCHOR })
})

test('a key taken off its own list acts as nobody, and its successor still acts for it', async () => {
  const { env, lists } = await setup(ANCHOR_REMOVED)
  assert.deepEqual(await lists.actingKey(env, { pubkey: ANCHOR, tags: [] }), { ok: false, reason: 'this key was taken off its own key list' })
  assert.equal((await lists.actingKey(env, { pubkey: key('desktop'), tags: [['anchor', ANCHOR]] })).ok, true)
})

test('a chain that landed after this isolate read "none" is found before a listed key is refused', async () => {
  const { env, lists } = await setup()
  assert.equal(await lists.heldKeyList(env, ANCHOR), null)
  env.CONTENT.held.set(await keyChainKey(ANCHOR), body(WITH_DESKTOP)) // another isolate's write
  assert.equal(await lists.heldKeyList(env, ANCHOR), null) // this isolate's copy
  assert.equal((await lists.actingKey(env, { pubkey: key('desktop'), tags: [['anchor', ANCHOR]] })).ok, true)
})

test('a store that cannot be read refuses a tagged request and lets an untagged one answer for itself', async () => {
  const { env, lists } = await setup()
  env.CONTENT.get = async () => { throw new Error('bucket down') }
  assert.equal((await lists.actingKey(env, { pubkey: key('desktop'), tags: [['anchor', ANCHOR]] })).ok, false)
  assert.equal((await lists.actingKey(env, { pubkey: ANCHOR, tags: [] })).ok, true)
})

test("an index stands as the anchor's when the anchor or a listed key, tagged for it, signed it", async () => {
  const { env, lists } = await setup(WITH_DESKTOP)
  assert.equal(await lists.indexSignerRefusal(env, ANCHOR, { pubkey: ANCHOR, tags: [] }), null)
  assert.equal(await lists.indexSignerRefusal(env, ANCHOR, { pubkey: key('desktop'), tags: [['anchor', ANCHOR]] }), null)
  assert.match(await lists.indexSignerRefusal(env, ANCHOR, { pubkey: key('desktop'), tags: [] }), /does not match/)
  assert.match(await lists.indexSignerRefusal(env, ANCHOR, { pubkey: key('stranger'), tags: [['anchor', ANCHOR]] }, true), /not on this anchor/)
  const fresh = await setup()
  assert.equal(await fresh.lists.indexSignerRefusal(fresh.env, ANCHOR, { pubkey: ANCHOR, tags: [] }), null)
})

test("an index the removed anchor signed no longer stands", async () => {
  const { env, lists } = await setup(ANCHOR_REMOVED)
  assert.match(await lists.indexSignerRefusal(env, ANCHOR, { pubkey: ANCHOR, tags: [] }), /taken off/)
  assert.equal(await lists.indexSignerRefusal(env, ANCHOR, { pubkey: key('desktop'), tags: [['anchor', ANCHOR]] }), null)
})

test('a held chain that no longer verifies lists nobody, the anchor included', async () => {
  const { env, lists } = await setup(TAMPERED)
  assert.equal((await lists.heldKeyList(env, ANCHOR)).keys.size, 0)
  assert.equal((await lists.actingKey(env, { pubkey: ANCHOR, tags: [] })).ok, false)
  assert.match(await lists.indexSignerRefusal(env, ANCHOR, { pubkey: ANCHOR, tags: [] }), /taken off/)
})
