// key-lists.worker.spec.js — the key list through the worker's own doors:
// GET/PUT /<sign('keys:lists')>/<anchor>, an index a listed key signs for its
// anchor (with `prev`), a key taken off its own list, and an upload a listed
// key makes as its anchor. Keys and chains come from key-list.vector.json.
// `node --test key-lists.worker.spec.js`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1.js'
import worker from './worker.js'

const VECTOR = JSON.parse(readFileSync(new URL('./key-list.vector.json', import.meta.url), 'utf8'))
const utf8 = new TextEncoder()
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text) => Uint8Array.from(String(text).match(/../g) ?? [], (pair) => parseInt(pair, 16))
const sha256Hex = async (data) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? utf8.encode(data) : data)))

const secret = {}
for (const [name, { seed }] of Object.entries(VECTOR.keys)) secret[name] = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(seed)))
const key = (name) => VECTOR.keys[name].pubkey
const ANCHOR = VECTOR.anchor
const chain = (name) => VECTOR.chains.find((c) => c.name === name).chain
const KEY_LISTS = VECTOR.poolAddress
const INDEXES = await sha256Hex('hive:indexes')
const HOST = 'https://content.hypercomb.com'
const head = 'a'.repeat(64)

async function signed(name, kind, tags, content, createdAt = Math.floor(Date.now() / 1000)) {
  const event = { pubkey: key(name), created_at: createdAt, kind, tags, content }
  event.id = await sha256Hex(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
  event.sig = hex(schnorr.sign(bytesOf(event.id), secret[name]))
  return event
}
const nip98 = async (name, url, method, anchor) =>
  'Nostr ' + btoa(JSON.stringify(await signed(name, 27235, [['u', url], ['method', method], ...(anchor ? [['anchor', anchor]] : [])], '')))
const indexBy = (name, roots, tags = [], createdAt) => signed(name, 30564, tags, JSON.stringify({ roots }), createdAt)

/** The R2 bucket, as the worker uses it: bytes, custom metadata, and an etag per version. */
function bucket() {
  const held = new Map()
  const meta = new Map()
  const etagOf = async (bytes) => `"${await sha256Hex(bytes)}"`
  return {
    held,
    meta,
    head: async (k) => held.has(k) ? { size: held.get(k).byteLength, customMetadata: meta.get(k), httpMetadata: {} } : null,
    get: async (k) => held.has(k) ? {
      size: held.get(k).byteLength, body: held.get(k), customMetadata: meta.get(k), httpEtag: await etagOf(held.get(k)),
      arrayBuffer: async () => held.get(k).slice().buffer, text: async () => new TextDecoder().decode(held.get(k)),
    } : null,
    put: async (k, body, options) => {
      if (options?.onlyIf?.get?.('If-None-Match') === '*' && held.has(k)) return null
      const ifMatch = options?.onlyIf?.get?.('If-Match')
      if (ifMatch && (!held.has(k) || await etagOf(held.get(k)) !== ifMatch)) return null
      held.set(k, new Uint8Array(await new Response(body).arrayBuffer()))
      if (options?.customMetadata) meta.set(k, options.customMetadata)
      else meta.delete(k)
      return { key: k }
    },
    delete: async (k) => { held.delete(k); meta.delete(k) },
    list: async ({ prefix = '' } = {}) => ({
      objects: [...held.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, size: held.get(k).byteLength })),
      truncated: false,
    }),
  }
}
const kv = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v) } } }
const hostEnv = (extra = {}) => ({ SITE_BINDINGS: '{}', HIVES: kv(), GRANTS: kv(), CONTENT: bucket(), ...extra })

const putChain = async (env, events, name = 'anchor') => {
  const url = `${HOST}/${KEY_LISTS}/${ANCHOR}`
  return worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(name, url, 'PUT') }, body: JSON.stringify(events) }), env)
}
const putIndex = async (env, event, name, anchor) => {
  const url = `${HOST}/${INDEXES}/${ANCHOR}`
  return worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(name, url, 'PUT', anchor) }, body: JSON.stringify(event) }), env)
}
const heldIndex = (env) => JSON.parse(new TextDecoder().decode(env.CONTENT.held.get(`${INDEXES}/${ANCHOR}`)))

test('a key list is written by a key it names, read by anyone, and refused to a stranger', async () => {
  const env = hostEnv()
  const first = await putChain(env, chain('the anchor alone'))
  assert.equal(first.status, 201, first.headers.get('x-reason'))
  const read = await worker.fetch(new Request(`${HOST}/${KEY_LISTS}/${ANCHOR}`), env)
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('cache-control'), 'no-store')
  assert.ok(read.headers.get('access-control-allow-origin'))
  assert.deepEqual(await read.json(), chain('the anchor alone'))
  assert.equal((await putChain(env, chain('the anchor adds a desktop'))).status, 200)
  assert.equal((await putChain(hostEnv(), chain('the anchor adds a desktop'), 'stranger')).status, 403)
  assert.equal((await worker.fetch(new Request(`${HOST}/${KEY_LISTS}/${key('desktop')}`), env)).status, 404)
})

test("a listed key publishes its anchor's index: tagged for it, naming the index it replaces", async () => {
  const env = hostEnv()
  await putChain(env, chain('the anchor adds a desktop'))
  const tags = [['anchor', ANCHOR]]
  const now = Math.floor(Date.now() / 1000)
  const first = await indexBy('desktop', { site: head }, tags, now - 30)
  assert.equal((await putIndex(env, first, 'desktop', ANCHOR)).status, 201)
  assert.equal(heldIndex(env).id, first.id)

  const unnamed = await indexBy('desktop', { site: head, more: head }, tags, now - 20)
  assert.equal((await putIndex(env, unnamed, 'desktop', ANCHOR)).status, 400)
  const stale = await indexBy('desktop', { site: head, more: head }, [...tags, ['prev', 'b'.repeat(64)]], now - 20)
  assert.equal((await putIndex(env, stale, 'desktop', ANCHOR)).status, 409)
  const next = await indexBy('desktop', { site: head, more: head }, [...tags, ['prev', first.id]], now - 20)
  assert.equal((await putIndex(env, next, 'desktop', ANCHOR)).status, 200)
  assert.equal(heldIndex(env).id, next.id)

  // The anchor itself still writes as it always did; `prev`, when it gives one, is held to.
  const byAnchor = await indexBy('anchor', { site: head }, [['prev', first.id]], now - 10)
  assert.equal((await putIndex(env, byAnchor, 'anchor')).status, 409)
  const current = await indexBy('anchor', { site: head }, [['prev', next.id]], now - 10)
  assert.equal((await putIndex(env, current, 'anchor')).status, 200)
})

test('an index a listed key signs without naming its anchor is refused', async () => {
  const env = hostEnv()
  await putChain(env, chain('the anchor adds a desktop'))
  const untagged = await indexBy('desktop', { site: head })
  assert.equal((await putIndex(env, untagged, 'desktop', ANCHOR)).status, 403)
  assert.equal(env.CONTENT.held.has(`${INDEXES}/${ANCHOR}`), false)
})

test('a stranger claiming to act for the anchor is refused at the door', async () => {
  const env = hostEnv()
  await putChain(env, chain('the anchor adds a desktop'))
  const forged = await indexBy('stranger', { site: head }, [['anchor', ANCHOR]])
  assert.equal((await putIndex(env, forged, 'stranger', ANCHOR)).status, 401)
})

test('a key taken off its own list writes nothing more, and the key that removed it writes on', async () => {
  const env = hostEnv()
  await putChain(env, chain('the desktop takes the anchor off'))
  const byAnchor = await indexBy('anchor', { site: head })
  const refused = await putIndex(env, byAnchor, 'anchor')
  assert.equal(refused.status, 401)
  assert.match(refused.headers.get('x-reason') ?? '', /taken off/)
  const byDesktop = await indexBy('desktop', { site: head }, [['anchor', ANCHOR]])
  assert.equal((await putIndex(env, byDesktop, 'desktop', ANCHOR)).status, 201)
})

/** A door's own description, from its bag sign(<host>) — as worker.spec.js reads it. */
async function doorMeta(url, env) {
  const { origin, hostname } = new URL(url)
  const bag = `${origin}/${await sha256Hex(hostname)}/`
  const listing = await worker.fetch(new Request(bag), env)
  if (listing.status !== 200) return { status: listing.status, record: null }
  const newest = (await listing.text()).trim().split('\n').at(-1)
  const marker = await worker.fetch(new Request(bag + newest), env)
  return { status: marker.status, record: marker.status === 200 ? await marker.json() : null }
}

test("a door opens on an index its publisher's listed key signed, and not on a stranger's", async () => {
  const publishers = [{ pubkey: ANCHOR, label: 'Jaime', primary: true }]
  const bindings = {
    'pluginthematrix.com': { title: 'Plugin the Matrix', lineage: 'pluginthematrix', publishers },
    'revolucion.pluginthematrix.com': { title: 'Revolución', lineage: 'revolucion', publishers },
  }
  const content = JSON.stringify({ roots: { pluginthematrix: head, revolucion: head },
    doors: { pluginthematrix: ['pluginthematrix.com'], revolucion: ['pluginthematrix.com'] } })
  const door = async (signer) => {
    const env = hostEnv({
      SITE_BINDINGS: JSON.stringify(bindings),
      ASSETS: { fetch: async () => new Response('visitor engine', { headers: { 'content-type': 'text/html' } }) },
    })
    // Held as a host holds them: the chain, and the index it already took.
    env.CONTENT.held.set(`${KEY_LISTS}/${ANCHOR}`, utf8.encode(JSON.stringify(chain('the anchor adds a desktop'))))
    env.CONTENT.held.set(`${INDEXES}/${ANCHOR}`, utf8.encode(JSON.stringify(await signed(signer, 30564, [['anchor', ANCHOR]], content))))
    return doorMeta('https://revolucion.pluginthematrix.com/', env)
  }
  const listed = await door('desktop')
  assert.equal(listed.status, 200)
  assert.equal(listed.record.layer, head)
  assert.equal((await door('stranger')).status, 404)
})

test('a listed key uploads as its anchor: the anchor is kept, the bytes are the anchor\'s', async () => {
  const env = hostEnv({ HOST_FRIENDS: ANCHOR })
  await putChain(env, chain('the anchor adds a desktop'))
  const bytes = 'a tile the desktop made'
  const sig = await sha256Hex(bytes)
  const url = `${HOST}/${sig}`
  const asSelf = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98('desktop', url, 'PUT') }, body: bytes }), env)
  assert.equal(asSelf.status, 403) // the desktop alone is nobody this host keeps
  const asAnchor = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98('desktop', url, 'PUT', ANCHOR) }, body: bytes }), env)
  assert.equal(asAnchor.status, 201, asAnchor.headers.get('x-reason'))
  assert.equal(env.CONTENT.meta.get(sig)?.owner, ANCHOR)
})
