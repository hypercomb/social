import test from 'node:test'
import assert from 'node:assert/strict'
import { schnorr } from '@noble/curves/secp256k1'
import worker from './worker.js'

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const sk = Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? 1 : 0)
const pubkey = hex(schnorr.getPublicKey(sk))
const head = 'a'.repeat(64)

async function signedIndex(roots, createdAt = 1_800_000_000) {
  const event = {
    pubkey,
    created_at: createdAt,
    kind: 30564,
    tags: [],
    content: JSON.stringify({ roots }),
  }
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  event.id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial))))
  event.sig = hex(schnorr.sign(event.id, sk))
  return event
}

async function fixture(event) {
  event ??= await signedIndex({ pluginthematrix: head, revolucion: head })
  const assetRequests = []
  return {
    assetRequests,
    env: {
      SITE_BINDINGS: JSON.stringify({
        'pluginthematrix.com': {
          title: 'Plugin the Matrix',
          lineage: 'pluginthematrix',
          publishers: [{ pubkey, label: 'Jaime', primary: true }],
        },
        'revolucion.pluginthematrix.com': {
          title: 'Revolución',
          lineage: 'revolucion',
          publishers: [{ pubkey, label: 'Curator', primary: true }],
        },
      }),
      HIVES: { get: async (key) => key === pubkey ? JSON.stringify(event) : null },
      ASSETS: {
        fetch: async (request) => {
          assetRequests.push(new URL(request.url).pathname)
          return new Response('visitor engine', { headers: { 'content-type': 'text/html' } })
        },
      },
    },
  }
}

test('site.json resolves the allowlisted publisher signed head', async () => {
  const { env } = await fixture()
  const response = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/site.json'), env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), {
    title: 'Revolución',
    pubkey,
    head,
    lineage: 'revolucion',
    segments: ['revolucion'],
    hosts: ['revolucion.pluginthematrix.com'],
    publishedAt: 1_800_000_000,
  })
})

test('publications.json exposes the verified Core host registry', async () => {
  const { env } = await fixture()
  const response = await worker.fetch(new Request('https://pluginthematrix.com/publications.json'), env)
  const registry = await response.json()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(registry.sites.map(({ host, lineage }) => ({ host, lineage })), [
    { host: 'pluginthematrix.com', lineage: 'pluginthematrix' },
    { host: 'revolucion.pluginthematrix.com', lineage: 'revolucion' },
  ])
  assert.deepEqual(registry.sites[1].publishers[0], {
    pubkey,
    label: 'Curator',
    primary: true,
    head,
    publishedAt: 1_800_000_000,
  })
})

test('publications.json lists the names publishing brought to life', async () => {
  // The index carries more than the operator bound: two new top-level
  // creations (live at <label>.<zone> by the wildcard rule), one nested
  // lineage (needs its own custom domain — never implicit), and a root that
  // would collide with the write/relay face.
  const event = await signedIndex({
    pluginthematrix: head,
    revolucion: head,
    dylan: head,
    susan: head,
    'games/arkanoid': head,
    content: head,
  })
  const { env } = await fixture(event)
  const response = await worker.fetch(new Request('https://pluginthematrix.com/publications.json'), env)
  const registry = await response.json()
  assert.deepEqual(registry.sites.map(({ host, lineage }) => ({ host, lineage })), [
    { host: 'pluginthematrix.com', lineage: 'pluginthematrix' },
    { host: 'revolucion.pluginthematrix.com', lineage: 'revolucion' },
    { host: 'dylan.pluginthematrix.com', lineage: 'dylan' },
    { host: 'susan.pluginthematrix.com', lineage: 'susan' },
  ])
  // A derived plate carries the same verified publication as a bound one.
  const dylan = registry.sites.find((s) => s.lineage === 'dylan')
  assert.equal(dylan.url, 'https://dylan.pluginthematrix.com/')
  assert.deepEqual(dylan.publishers, [{
    pubkey, label: 'Jaime', primary: true, head, publishedAt: 1_800_000_000,
  }])
  // And the address it advertises is one the router actually serves.
  const descriptor = await worker.fetch(new Request('https://dylan.pluginthematrix.com/site.json'), env)
  assert.equal(descriptor.status, 200)
  assert.equal((await descriptor.json()).lineage, 'dylan')
})

test('an unpublished name keeps its plate off the directory', async () => {
  const { env } = await fixture(await signedIndex({ pluginthematrix: head }))
  const response = await worker.fetch(new Request('https://pluginthematrix.com/publications.json'), env)
  const registry = await response.json()
  // revolucion stays listed — it is BOUND, and the ledger reports it as
  // approved-but-unpublished (head null). Nothing else is invented.
  assert.deepEqual(registry.sites.map((s) => s.host), [
    'pluginthematrix.com',
    'revolucion.pluginthematrix.com',
  ])
  assert.equal(registry.sites[1].publishers[0].head, null)
})

test('forged hive indexes never become website roots', async () => {
  const event = await signedIndex({ revolucion: head })
  event.content = JSON.stringify({ roots: { revolucion: 'b'.repeat(64) } })
  const { env } = await fixture(event)
  const response = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/site.json'), env)
  assert.equal(response.status, 404)
})

test('application paths receive the shared visitor engine', async () => {
  const { env, assetRequests } = await fixture()
  const journal = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/journal'), env)
  const revisions = await worker.fetch(new Request('https://pluginthematrix.com/revisions'), env)
  assert.equal(await journal.text(), 'visitor engine')
  assert.equal(await revisions.text(), 'visitor engine')
  assert.deepEqual(assetRequests, ['/journal', '/revisions'])
  assert.match(journal.headers.get('content-security-policy'), /connect-src 'self'/)
  assert.equal(journal.headers.get('referrer-policy'), 'no-referrer')
})

test('bare domain is a Core creation, not a server-authored landing page', async () => {
  const { env, assetRequests } = await fixture()
  const descriptor = await worker.fetch(new Request('https://pluginthematrix.com/site.json'), env)
  const entrance = await worker.fetch(new Request('https://pluginthematrix.com/'), env)
  assert.equal((await descriptor.json()).lineage, 'pluginthematrix')
  assert.equal(await entrance.text(), 'visitor engine')
  assert.deepEqual(assetRequests, ['/'])
})

test('published Core hosts reject every mutation before relay routing', async () => {
  const { env, assetRequests } = await fixture()
  const upload = await worker.fetch(new Request('https://pluginthematrix.com/upload', { method: 'PUT' }), env)
  const hive = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/hive/${pubkey}`, { method: 'PUT' }), env)
  const options = await worker.fetch(new Request('https://pluginthematrix.com/', { method: 'OPTIONS' }), env)
  assert.equal(upload.status, 405)
  assert.equal(hive.status, 405)
  assert.equal(options.status, 405)
  assert.deepEqual(assetRequests, [])
})

test('ordinary content hosts retain their existing landing', async () => {
  const { env } = await fixture()
  const response = await worker.fetch(new Request('https://content.pluginthematrix.com/'), env)
  assert.match(await response.text(), /public content endpoint/)
})
