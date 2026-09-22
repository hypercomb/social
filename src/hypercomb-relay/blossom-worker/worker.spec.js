import test from 'node:test'
import assert from 'node:assert/strict'
import { schnorr } from '@noble/curves/secp256k1'
import worker from './worker.js'

const sha256Hex = async (text) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const sk = Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? 1 : 0)
const pubkey = hex(schnorr.getPublicKey(sk))
const head = 'a'.repeat(64)

async function signedIndex(roots, createdAt = 1_800_000_000, doors) {
  const event = {
    pubkey,
    created_at: createdAt,
    kind: 30564,
    tags: [],
    content: JSON.stringify(doors ? { roots, doors } : { roots }),
  }
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  event.id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial))))
  event.sig = hex(schnorr.sign(event.id, sk))
  return event
}

const ONE_ZONE = {
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
}

// Two wildcard zones, a nested-lineage binding, and two doors that resolve but
// are NOT deployed — the shapes `hosts` has to get right.
const TWO_ZONES = {
  ...ONE_ZONE,
  'meetup.pluginthematrix.com': {
    title: 'Meetup',
    lineage: 'revolucion/meetup',
    publishers: [{ pubkey, label: 'Jaime', primary: true }],
  },
  'hypercomb.com': {
    title: 'Hypercomb',
    lineage: 'hypercomb',
    routed: false,                       // apex route commented out
    publishers: [{ pubkey, label: 'Jaime', primary: true }],
  },
  'anchor.example': {                    // a zone anchor: no apex, no wildcard yet
    title: 'Anchor',
    lineage: 'anchor.example',
    routed: false,
    wildcard: false,
    publishers: [{ pubkey, label: 'Jaime', primary: true }],
  },
}

async function fixture(event, bindings = ONE_ZONE) {
  event ??= await signedIndex({ pluginthematrix: head, revolucion: head })
  const assetRequests = []
  return {
    assetRequests,
    env: {
      SITE_BINDINGS: JSON.stringify(bindings),
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

test('a creation reports every door it answers on, primary first', async () => {
  const event = await signedIndex({ pluginthematrix: head, revolucion: head, dylan: head })
  const { env } = await fixture(event, TWO_ZONES)
  const registry = await (await worker.fetch(
    new Request('https://pluginthematrix.com/publications.json'), env)).json()

  // An implicit name lives on every wildcard zone that carries it. The first
  // zone stays the primary, so `host` is what it has always been.
  const dylan = registry.sites.find((s) => s.lineage === 'dylan')
  assert.equal(dylan.host, 'dylan.pluginthematrix.com')
  assert.deepEqual(dylan.hosts, [
    { host: 'dylan.pluginthematrix.com', url: 'https://dylan.pluginthematrix.com/', primary: true, implicit: true },
    { host: 'dylan.hypercomb.com', url: 'https://dylan.hypercomb.com/', primary: false, implicit: true },
  ])

  // A hand-bound door leads, and the wildcard adds the other zone's.
  const revolucion = registry.sites.find((s) => s.lineage === 'revolucion')
  assert.deepEqual(revolucion.hosts.map((h) => h.host), [
    'revolucion.pluginthematrix.com',
    'revolucion.hypercomb.com',
  ])
  assert.deepEqual(revolucion.hosts.map((h) => h.implicit), [false, true])

  // At most one door per zone: the apex already IS the creation's address, so
  // `pluginthematrix.pluginthematrix.com` is noise and never appears.
  const apex = registry.sites.find((s) => s.lineage === 'pluginthematrix')
  assert.deepEqual(apex.hosts.map((h) => h.host), ['pluginthematrix.com', 'pluginthematrix.hypercomb.com'])

  // Every advertised door is one the router actually serves.
  for (const site of registry.sites) {
    for (const door of site.hosts) {
      const descriptor = await worker.fetch(new Request(`https://${door.host}/site.json`), env)
      assert.equal(descriptor.status, 200, `${door.host} was advertised and does not answer`)
      assert.equal((await descriptor.json()).lineage, site.lineage)
    }
  }
})

test('a nested lineage reports exactly its bound host', async () => {
  const event = await signedIndex({ pluginthematrix: head, 'revolucion/meetup': head })
  const { env } = await fixture(event, TWO_ZONES)
  const registry = await (await worker.fetch(
    new Request('https://pluginthematrix.com/publications.json'), env)).json()

  // The wildcard maps ONE label, never a path — `meetup.hypercomb.com` is not
  // a door and inventing one would advertise a 404.
  const meetup = registry.sites.find((s) => s.lineage === 'revolucion/meetup')
  assert.deepEqual(meetup.hosts.map((h) => h.host), ['meetup.pluginthematrix.com'])
})

test('a route that is not deployed is not a door', async () => {
  const event = await signedIndex({ pluginthematrix: head, hypercomb: head, 'anchor.example': head })
  const { env } = await fixture(event, TWO_ZONES)
  const registry = await (await worker.fetch(
    new Request('https://pluginthematrix.com/publications.json'), env)).json()

  // `hypercomb.com`'s apex route is commented out, so the apex is not advertised
  // even though the lineage is published and the host resolves. The zone's
  // WILDCARD is deployed, so the creation is still reachable through it.
  const hypercomb = registry.sites.find((s) => s.lineage === 'hypercomb')
  assert.deepEqual(hypercomb.hosts.map((h) => h.host), [
    'hypercomb.pluginthematrix.com',
    'hypercomb.hypercomb.com',
  ])

  // A zone anchor with neither route deployed contributes a ZONE, never a door:
  // no apex plate of its own, and no `<name>.anchor.example` on anybody else's.
  const anchored = registry.sites.find((s) => s.lineage === 'anchor.example')
  assert.deepEqual(anchored.hosts, [])
  const everyDoor = registry.sites.flatMap((s) => s.hosts.map((h) => h.host))
  assert.ok(!everyDoor.some((h) => h.endsWith('anchor.example')), everyDoor.join(' '))
})

test('a lineage that is not a hostname is never given a door', async () => {
  // `install:essentials` is a perfectly good creation and not a DNS label. It
  // used to earn a plate at `install:essentials.pluginthematrix.com`.
  const event = await signedIndex({ pluginthematrix: head, 'install:essentials': head })
  const { env } = await fixture(event, TWO_ZONES)
  const registry = await (await worker.fetch(
    new Request('https://pluginthematrix.com/publications.json'), env)).json()
  assert.ok(!registry.sites.some((s) => s.lineage === 'install:essentials'),
    registry.sites.map((s) => s.host).join(' '))
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

// ── the mark ────────────────────────────────────────────────────────────────
// Every door under a bound zone is Hypercomb, whether or not a creation has
// landed on it yet. The browser asks for these paths unprompted and paints
// its blank globe on a 404, so the shell's icons answer everywhere.

test('an unpublished name still wears the mark', async () => {
  const { env, assetRequests } = await fixture()
  const icon = await worker.fetch(new Request('https://ghost.pluginthematrix.com/favicon.svg'), env)
  const page = await worker.fetch(new Request('https://ghost.pluginthematrix.com/'), env)
  assert.equal(icon.status, 200)
  assert.equal(icon.headers.get('cache-control'), 'public, max-age=3600')
  assert.deepEqual(assetRequests, ['/favicon.svg'])
  // the name itself is still honestly unpublished
  assert.equal(page.status, 404)
  assert.match(await page.text(), /rel="icon" href="\/favicon\.svg"/)
})

test('the relay face and published sites answer the mark too', async () => {
  const { env, assetRequests } = await fixture()
  const relay = await worker.fetch(new Request('https://content.pluginthematrix.com/favicon.ico'), env)
  const site = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/apple-touch-icon.png'), env)
  assert.equal(relay.status, 200)
  assert.equal(site.status, 200)
  assert.deepEqual(assetRequests, ['/favicon.ico', '/apple-touch-icon.png'])
})

test('the mark list is closed — it is not a directory of shell assets', async () => {
  const { env, assetRequests } = await fixture()
  const smuggled = await worker.fetch(new Request('https://content.pluginthematrix.com/env.js'), env)
  assert.equal(smuggled.status, 404)
  assert.deepEqual(assetRequests, [])
})

test('a site may declare its own icon, and only a same-origin one', async () => {
  const own = { ...ONE_ZONE }
  own['revolucion.pluginthematrix.com'] = {
    ...ONE_ZONE['revolucion.pluginthematrix.com'],
    icon: `/${'c'.repeat(64)}/mark.svg`,
  }
  own['pluginthematrix.com'] = {
    ...ONE_ZONE['pluginthematrix.com'],
    icon: 'https://cdn.example.com/mark.png',
  }
  const { env } = await fixture(undefined, own)
  const declared = await (await worker.fetch(new Request('https://revolucion.pluginthematrix.com/site.json'), env)).json()
  const offOrigin = await (await worker.fetch(new Request('https://pluginthematrix.com/site.json'), env)).json()
  assert.equal(declared.icon, `/${'c'.repeat(64)}/mark.svg`)
  // Refused, not passed through: the visitor keeps the Hypercomb mark rather
  // than fetching an icon from a third party on every page load.
  assert.equal('icon' in offOrigin, false)
})

test('a pool address on a site door answers the directory branch, never the SPA fallback', async () => {
  const pool = await sha256Hex('host:packages')
  const { env, assetRequests } = await fixture()
  // nothing under the prefix: an honest 404, text, no-store, cross-origin readable
  const empty = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/${pool}/`), env)
  assert.equal(empty.status, 404)
  assert.match(empty.headers.get('content-type'), /text\/plain/)
  assert.equal(empty.headers.get('cache-control'), 'no-store')
  assert.equal(empty.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(assetRequests, [])

  // members under the prefix: their names, one per line, sorted, no-store
  env.CONTENT = {
    list: async ({ prefix }) => ({
      objects: [`${prefix}00000001`, `${prefix}00000000`, `${prefix}nested/deeper`].map(key => ({ key })),
      truncated: false,
    }),
  }
  const listing = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/${pool}/`), env)
  assert.equal(listing.status, 200)
  assert.equal(listing.headers.get('cache-control'), 'no-store')
  assert.equal(await listing.text(), '00000000\n00000001\n')
  assert.deepEqual(assetRequests, [])

  // A pool that is not public is never listed — even with members under it,
  // it answers exactly as an empty address does.
  const privatePool = 'd'.repeat(64)
  const hidden = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/${privatePool}/`), env)
  assert.equal(hidden.status, 404)
  assert.equal(await hidden.text(), 'no pool at this address' + String.fromCharCode(10))
})

test('a site door is readable cross-origin — its manifest carries the open CORS header', async () => {
  const { env } = await fixture()
  const res = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/content/manifest.json'), env)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

// ── open is a signed mark ────────────────────────────────────────────────────

const page = (url, extra = {}) =>
  new Request(url, { headers: { 'sec-fetch-dest': 'document', accept: 'text/html,*/*', ...extra } })

test('a door the signed index names serves the engine — no hold, no cookie', async () => {
  const { env, assetRequests } = await fixture()
  env.VISITOR_HOLD = '1' // retired: the var no longer closes anything
  const res = await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)
  assert.equal(res.headers.get('x-reason'), null)
  assert.equal(await res.text(), 'visitor engine')
  assert.deepEqual(assetRequests, ['/'])
})

test('a named door whose lineage is not in the signed index is hidden — page, files and descriptor', async () => {
  const { env, assetRequests } = await fixture(await signedIndex({ pluginthematrix: head }))
  const res = await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)
  assert.equal(res.status, 404)
  assert.match(await res.text(), /nothing published at revolucion.pluginthematrix.com/)
  const manifest = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/content/manifest.json'), env)
  assert.equal(manifest.status, 404)
  const descriptor = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/site.json'), env)
  assert.equal(descriptor.status, 404)
  assert.deepEqual(assetRequests, [])
})

test('an index whose signature fails opens nothing', async () => {
  const forged = await signedIndex({ pluginthematrix: head, revolucion: head })
  forged.sig = '0'.repeat(128)
  const { env, assetRequests } = await fixture(forged)
  const res = await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)
  assert.equal(res.status, 404)
  assert.deepEqual(assetRequests, [])
})

test('signed doors switch a branch per domain — on where listed, hidden elsewhere', async () => {
  const index = await signedIndex({ pluginthematrix: head, susan: head }, undefined, { susan: ['hypercomb.com'] })
  const { env, assetRequests } = await fixture(index, TWO_ZONES)
  const on = await worker.fetch(page('https://susan.hypercomb.com/'), env)
  assert.equal(await on.text(), 'visitor engine')
  const off = await worker.fetch(page('https://susan.pluginthematrix.com/'), env)
  assert.equal(off.status, 404)
  const descriptor = await worker.fetch(new Request('https://susan.pluginthematrix.com/site.json'), env)
  assert.equal(descriptor.status, 404)
  // no doors entry = open on every domain (every index written before doors)
  const legacy = await worker.fetch(page('https://pluginthematrix.com/'), env)
  assert.equal(await legacy.text(), 'visitor engine')
  assert.deepEqual(assetRequests, ['/', '/'])
  // the ledger lists susan only where it opens
  const ledger = await (await worker.fetch(new Request('https://pluginthematrix.com/publications.json'), env)).json()
  const susan = ledger.sites.find((site) => site.lineage === 'susan')
  assert.deepEqual(susan.hosts.map((door) => door.host), ['susan.hypercomb.com'])
})

test('a front-door apex is the shim host card; the ledger and the heap stay on the worker', async () => {
  const bindings = { ...ONE_ZONE, 'pluginthematrix.com': { ...ONE_ZONE['pluginthematrix.com'], lineage: 'pluginthematrix.com', frontDoor: true } }
  const { env, assetRequests } = await fixture(undefined, bindings)
  env.HOST_DOOR_ORIGIN = 'https://door.example/'
  const asked = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('host card', { headers: { 'content-type': 'text/html' } }) }
  try {
    const card = await worker.fetch(page('https://pluginthematrix.com/?x=1'), env)
    assert.equal(await card.text(), 'host card')
    assert.deepEqual(asked, ['https://door.example/?x=1'])
    const ledger = await worker.fetch(new Request('https://pluginthematrix.com/publications.json'), env)
    assert.ok(Array.isArray((await ledger.json()).sites))
    assert.deepEqual(asked, ['https://door.example/?x=1'])
    assert.deepEqual(assetRequests, [])
  } finally { globalThis.fetch = realFetch }
})

test('under /content/ a miss is an honest 404, never the SPA page — the pool walk stops at the gap', async () => {
  const pool = 'e'.repeat(64)
  const { env, assetRequests } = await fixture()
  const shipped = new Set([`/content/${pool}/`, `/content/${pool}/00000000`])
  env.ASSETS.fetch = async (request) => {
    const pathname = new URL(request.url).pathname
    assetRequests.push(pathname)
    if (!shipped.has(pathname)) return new Response('not found', { status: 404 })
    return new Response('00000000\n', { headers: { 'content-type': 'text/plain' } })
  }
  const listing = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${pool}/`), env)
  assert.equal(listing.status, 200)
  assert.equal(await listing.text(), '00000000\n')
  const marker = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${pool}/00000000`), env)
  assert.equal(marker.status, 200)
  const gap = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${pool}/00000001`), env)
  assert.equal(gap.status, 404)
  assert.match(gap.headers.get('content-type'), /text\/plain/)
  // the page itself still falls back to index.html
  const deep = await worker.fetch(page('https://revolucion.pluginthematrix.com/some/route'), env)
  assert.equal(deep.status, 404)
  assert.deepEqual(assetRequests.slice(-2), ['/some/route', '/index.html'])
})

// ── Plan A: the allowlist as content (documentation/signed-site-bindings.md) ──
//
// An operator's signed index names a zone's binding artifact; the artifact's
// bytes must hash to that name; only then does it replace the var's entries for
// that zone. Everything short of that leaves SITE_BINDINGS in charge.

const { readFileSync } = await import('node:fs')
const VECTOR = JSON.parse(readFileSync(new URL('./site-bindings.vector.json', import.meta.url), 'utf8'))
const utf8 = (s) => new TextEncoder().encode(s)
const sha256 = async (s) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s))))

function contentStore(objects) {
  return {
    get: async (key) => {
      const text = objects[key]
      if (text === undefined) return null
      const bytes = utf8(text)
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    },
    list: async () => ({ objects: [], truncated: false }),
  }
}

async function operated({ roots, objects, bindings = {}, operators }) {
  const event = await signedIndex(roots)
  const hiveReads = []
  return {
    hiveReads,
    env: {
      SITE_BINDINGS: JSON.stringify(bindings),
      SITE_OPERATORS: JSON.stringify(operators ?? { [VECTOR.zone]: pubkey }),
      HIVES: { get: async (key) => { hiveReads.push(key); return key === pubkey ? JSON.stringify(event) : null } },
      CONTENT: contentStore(objects),
      ASSETS: { fetch: async () => new Response('visitor engine', { headers: { 'content-type': 'text/html' } }) },
    },
  }
}

const publicationsText = async (env) =>
  (await worker.fetch(new Request('https://pluginthematrix.com/publications.json'), env)).text()
const sitesOf = async (env) => JSON.parse(await publicationsText(env)).sites

const BOUND_ROOTS = { pluginthematrix: head, revolucion: head, ['binding:' + VECTOR.zone]: VECTOR.recordSig }

test('the binding vector names the test operator and hashes to its own name', async () => {
  assert.equal(VECTOR.operatorPubkey, pubkey)
  assert.equal(await sha256(VECTOR.record), VECTOR.recordSig)
  for (const [meaning, address] of Object.entries(VECTOR.poolAddresses)) assert.equal(await sha256(meaning), address)
})

test("an operator's signed record answers publications.json byte for byte as the var did", async () => {
  const fromVar = await fixture(await signedIndex(BOUND_ROOTS), VECTOR.siteBindings)
  const fromPool = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record } })
  assert.equal(await publicationsText(fromPool.env), await publicationsText(fromVar.env))
})

test('the record is found in the community:hosts pool at the address core derives', async () => {
  const pooled = VECTOR.poolAddresses['community:hosts'] + '/' + VECTOR.recordSig
  const { env } = await operated({ roots: BOUND_ROOTS, objects: { [pooled]: VECTOR.record } })
  const sites = await sitesOf(env)
  assert.deepEqual(sites.map((s) => s.host + '|' + s.title), ['pluginthematrix.com|Plugin the Matrix', 'revolucion.pluginthematrix.com|Revolución'])
})

test('forged bytes, an unnamed record, or a stranger as operator leave the var in charge', async () => {
  // The var binds only the apex, so revolucion can appear only as an IMPLICIT
  // plate — titled by its label — unless a record was believed.
  const apexOnly = { [VECTOR.zone]: VECTOR.siteBindings[VECTOR.zone] }
  const titleOfRevolucion = async (env) => (await sitesOf(env)).find((s) => s.lineage === 'revolucion')?.title

  const forged = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record.replace('Curator', 'Mallory') }, bindings: apexOnly })
  assert.equal(await titleOfRevolucion(forged.env), 'revolucion')

  const unnamed = await operated({ roots: { pluginthematrix: head, revolucion: head }, objects: { [VECTOR.recordSig]: VECTOR.record }, bindings: apexOnly })
  assert.equal(await titleOfRevolucion(unnamed.env), 'revolucion')

  const stranger = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record }, bindings: apexOnly, operators: { [VECTOR.zone]: 'b'.repeat(64) } })
  assert.equal(await titleOfRevolucion(stranger.env), 'revolucion')

  const believed = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record }, bindings: apexOnly })
  assert.equal(await titleOfRevolucion(believed.env), 'Revolución')
})

test('a record speaks for its own zone only, and a publisher it drops is gone on the next read', async () => {
  const record = JSON.parse(VECTOR.record)
  record.payload.sites.push({ ...record.payload.sites[0], host: 'hypercomb.com', lineage: 'hypercomb', title: 'Hypercomb' })
  record.payload.sites[1] = { ...record.payload.sites[1], publishers: [] }
  const text = JSON.stringify(record)
  const sig = await sha256(text)
  const { env } = await operated({ roots: { pluginthematrix: head, revolucion: head, ['binding:' + VECTOR.zone]: sig }, objects: { [sig]: text } })
  const sites = await sitesOf(env)
  assert.equal(sites.some((s) => s.host === 'hypercomb.com'), false)
  assert.deepEqual(sites.find((s) => s.lineage === 'revolucion').publishers, [])
})

test('the pool listing never reads an index for bindings, even on an operated zone', async () => {
  const { env, hiveReads } = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record } })
  const response = await worker.fetch(new Request('https://pluginthematrix.com/' + 'c'.repeat(64) + '/'), env)
  assert.equal(response.status, 404)
  assert.deepEqual(hiveReads, [])
})

// ── the sandbox door (documentation/module-sandbox.md) ────────────────────
// `try-<change>.<zone>` is a full hive whose own origin names the package the
// approved publisher stamped as `install:try-<change>`; a door with no stamp
// is "nothing here"; everything that is not the package goes to the shell.
const sandboxEnv = async (roots, shellRequests = []) => ({
  SITE_BINDINGS: JSON.stringify({ 'hypercomb.com': { title: 'Hypercomb', lineage: 'hypercomb', publishers: [{ pubkey, label: 'Jaime', primary: true }] } }),
  HIVES: { get: async (key) => key === pubkey ? JSON.stringify(await signedIndex(roots)) : null },
  CONTENT: { get: async () => null, head: async () => null, list: async () => ({ objects: [], truncated: false }) },
  SANDBOX_SHELL_ORIGIN: 'https://shell.example',
  __shellRequests: shellRequests,
})
const hostPackagesPool = async () => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('host:packages'))))

test('a try- door names the stamped sandbox root as its one package', async () => {
  const root = 'b'.repeat(64)
  const env = await sandboxEnv({ 'install:try-fresh-rooms': root, 'install:essentials': head })
  const pool = await hostPackagesPool()
  const listing = await worker.fetch(new Request(`https://try-fresh-rooms.hypercomb.com/content/${pool}/`), env)
  assert.equal(listing.status, 200)
  assert.equal(await listing.text(), '00000000\n')
  const member = await worker.fetch(new Request(`https://try-fresh-rooms.hypercomb.com/content/${pool}/00000000`), env)
  assert.equal(await member.text(), `${root}\ntry-fresh-rooms`)
  const site = await (await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/site.json'), env)).json()
  assert.equal(site.sandbox, true)
  assert.equal(site.package, root)
  assert.equal(site.pubkey, pubkey)
  assert.equal(site.channel, 'install:try-fresh-rooms')
})

test('a try- door with no stamp is nothing here, and the live channel never opens one', async () => {
  const env = await sandboxEnv({ 'install:essentials': head, 'try-fresh-rooms': head })
  const response = await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/'), env)
  assert.equal(response.status, 404)
})

test('a try- door hands every other path to the participant shell', async () => {
  const env = await sandboxEnv({ 'install:try-fresh-rooms': 'b'.repeat(64) })
  const seen = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response('<!doctype html>shell', { headers: { 'content-type': 'text/html' } }) }
  try {
    const response = await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/main.js?v=1'), env)
    assert.equal(response.status, 200)
    assert.deepEqual(seen, ['https://shell.example/main.js?v=1'])
  } finally { globalThis.fetch = original }
})

test('a try- door names the published change and the host AI review beside the sandbox', async () => {
  const [root, change, review] = ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]
  const env = await sandboxEnv({ 'install:try-fresh-rooms': root, 'change:try-fresh-rooms': change, 'review:try-fresh-rooms': review })
  const site = await (await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/site.json'), env)).json()
  assert.equal(site.change, change)
  assert.equal(site.review, review)
})
