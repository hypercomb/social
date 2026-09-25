import test from 'node:test'
import assert from 'node:assert/strict'
import { schnorr } from '@noble/curves/secp256k1'
import worker from './worker.js'

const sha256Hex = async (text) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const sk = Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? 1 : 0)
const pubkey = hex(schnorr.getPublicKey(sk))
const head = 'a'.repeat(64)

async function signedIndex(roots, createdAt = 1_800_000_000, doors, landing) {
  const event = {
    pubkey,
    created_at: createdAt,
    kind: 30564,
    tags: [],
    content: JSON.stringify({ roots, ...(doors ? { doors } : {}), ...(landing ? { landing } : {}) }),
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

// ── the landing (sharing/landing-capture.ts) ────────────────────────────────
//
// The signed index names a branch's landing beside its head; the door
// reports it in site.json and paints it inside the visitor page's loading
// cover, so the site is on screen before the engine loads.
const landing = 'f'.repeat(64) + '/landing.webp'

test('site.json carries the signed landing of the branch', async () => {
  const event = await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_000, undefined,
    { revolucion: landing, pluginthematrix: 'not-an-address' })
  const { env } = await fixture(event)
  const withLanding = await (await worker.fetch(new Request('https://revolucion.pluginthematrix.com/site.json'), env)).json()
  assert.equal(withLanding.landing, landing)
  const withoutLanding = await (await worker.fetch(new Request('https://pluginthematrix.com/site.json'), env)).json()
  assert.equal('landing' in withoutLanding, false)
})

test('the visitor page paints a landing picture into its cover and share image', async () => {
  const event = await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_000, undefined, { revolucion: landing })
  const { env } = await fixture(event)
  const shell = '<!doctype html><html><head><title>x</title></head><body><app-root><div class="site-loading" role="status"></div></app-root></body></html>'
  env.ASSETS.fetch = async () => new Response(shell, { headers: { 'content-type': 'text/html', 'content-length': String(shell.length) } })
  const painted = await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)
  assert.equal(painted.status, 200)
  const html = await painted.text()
  assert.match(html, new RegExp(`class="site-loading" style="background-image:url\\(/${landing}\\)"`))
  assert.match(html, new RegExp(`<link rel="preload" as="image" href="/${landing}">`))
  assert.match(html, new RegExp(`<meta property="og:image" content="https://revolucion.pluginthematrix.com/${landing}">`))
  assert.equal(painted.headers.get('content-length'), null)
  // the apex branch carries no landing — its shell is untouched
  const plain = await (await worker.fetch(page('https://pluginthematrix.com/'), env)).text()
  assert.equal(plain, shell)
})

test('a page landing is framed inside the cover, sandboxed, never painted', async () => {
  const pageLanding = 'e'.repeat(64) + '/landing.html'
  const event = await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_000, undefined, { revolucion: pageLanding })
  const { env } = await fixture(event)
  const shell = '<!doctype html><html><head><title>x</title></head><body><app-root><div class="site-loading" role="status"></div></app-root></body></html>'
  env.ASSETS.fetch = async () => new Response(shell, { headers: { 'content-type': 'text/html' } })
  const html = await (await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)).text()
  assert.match(html, new RegExp(`<div class="site-loading" role="status"><iframe class="site-landing" src="/${pageLanding}" sandbox=""`))
  assert.doesNotMatch(html, /background-image|og:image/)
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

// ── secure delete: the host forgets only what its owner alone claims ───────

async function nip98(url, method, key = sk) {
  const event = { pubkey: hex(schnorr.getPublicKey(key)), created_at: Math.floor(Date.now() / 1000), kind: 27235, tags: [['u', url], ['method', method]], content: '' }
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  event.id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial))))
  event.sig = hex(schnorr.sign(event.id, key))
  return 'Nostr ' + btoa(JSON.stringify(event))
}

function heap(objects) {
  return {
    objects,
    head: async (k) => objects.has(k) ? { size: 1, httpMetadata: {}, customMetadata: objects.get(k) } : null,
    get: async (k) => objects.has(k) ? { body: 'x' } : null,
    put: async (k, _b, o) => { objects.set(k, o?.customMetadata ?? {}) },
    delete: async (k) => { objects.delete(k) },
  }
}

test('forget deletes only what the caller alone claims, and never an open head', async () => {
  const other = 'b'.repeat(64)
  const [mine, shared, unclaimed, theirs, open] = ['1', '2', '3', '4', '5'].map((c) => c.repeat(64))
  const objects = new Map([
    [mine, { owner: pubkey }],
    [shared, { owner: pubkey, shared: '1' }],
    [unclaimed, {}],
    [theirs, { owner: other }],
    [open, { owner: pubkey }],
  ])
  const { env } = await fixture(await signedIndex({ revolucion: open }))
  env.CONTENT = heap(objects)
  const url = 'https://content.pluginthematrix.com/forget'
  const res = await worker.fetch(new Request(url, {
    method: 'POST', headers: { authorization: await nip98(url, 'POST'), 'content-type': 'application/json' },
    body: JSON.stringify({ sigs: [mine, shared, unclaimed, theirs, open, 'f'.repeat(64)] }),
  }), env)
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.deepEqual(out.removed, [mine])
  assert.deepEqual(out.kept, { [shared]: 'shared', [unclaimed]: 'unclaimed', [theirs]: 'not-yours', [open]: 'still-open', ['f'.repeat(64)]: 'not-held' })
  assert.equal(objects.has(mine), false)
  assert.equal(objects.has(shared) && objects.has(unclaimed) && objects.has(theirs) && objects.has(open), true)

  const anonymous = await worker.fetch(new Request(url, { method: 'POST', body: JSON.stringify({ sigs: [shared] }) }), env)
  assert.equal(anonymous.status, 401)
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

// THE TRANSFER PACK (hypercomb-runtime transfer-pack.ts): `module commit`
// stamps `pack:try-<change>` beside the sandbox, and the door answers the
// transfer:packs member for the root it serves — for that root only.
const transferPacksPool = async () => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('transfer:packs'))))

test('a try- door answers its root\'s transfer pack from the publisher\'s pack key', async () => {
  const [root, pack] = ['b'.repeat(64), 'c'.repeat(64)]
  const env = await sandboxEnv({ 'install:try-fresh-rooms': root, 'pack:try-fresh-rooms': pack })
  const packs = await transferPacksPool()
  const pointer = await worker.fetch(new Request(`https://try-fresh-rooms.hypercomb.com/content/${packs}/${root}`), env)
  assert.equal(pointer.status, 200)
  assert.equal(await pointer.text(), pack)
  assert.equal(pointer.headers.get('cache-control'), 'no-store')
  // Another root is not this door's package, so it has no pack here.
  const other = await worker.fetch(new Request(`https://try-fresh-rooms.hypercomb.com/content/${packs}/${'d'.repeat(64)}`), env)
  assert.equal(other.status, 404)
})

test('a try- door with no pack key says so, and the visitor installs file by file', async () => {
  const root = 'b'.repeat(64)
  const env = await sandboxEnv({ 'install:try-fresh-rooms': root })
  const packs = await transferPacksPool()
  const pointer = await worker.fetch(new Request(`https://try-fresh-rooms.hypercomb.com/content/${packs}/${root}`), env)
  assert.equal(pointer.status, 404)
  assert.equal(await pointer.text(), 'no pack\n')
})

test('a try- door names the published change and the host AI review beside the sandbox', async () => {
  const [root, change, review] = ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]
  const env = await sandboxEnv({ 'install:try-fresh-rooms': root, 'change:try-fresh-rooms': change, 'review:try-fresh-rooms': review })
  const site = await (await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/site.json'), env)).json()
  assert.equal(site.change, change)
  assert.equal(site.review, review)
})

// PROMOTED: `try-<change>.<zone>` becomes `<change>.<zone>` (jwize 2026-09-24).
// `module promote <change>` stamps the trial's root as `install:<change>`, and
// the published site answers its package pool and pack from that key.
test('a promoted site runs the package its try- door ran', async () => {
  const [root, pack] = ['b'.repeat(64), 'c'.repeat(64)]
  const { env, assetRequests } = await fixture(await signedIndex({ 'fresh-rooms': head, 'install:fresh-rooms': root, 'pack:fresh-rooms': pack }))
  const pool = await hostPackagesPool()
  const member = await worker.fetch(new Request(`https://fresh-rooms.pluginthematrix.com/content/${pool}/00000000`), env)
  assert.equal(member.status, 200)
  assert.equal(await member.text(), `${root}\nfresh-rooms`)
  const packs = await transferPacksPool()
  assert.equal(await (await worker.fetch(new Request(`https://fresh-rooms.pluginthematrix.com/content/${packs}/${root}`), env)).text(), pack)
  assert.deepEqual(assetRequests, [])
})

test('a site with no promoted package runs the engine\'s own, and an unpublished one opens nothing', async () => {
  const pool = await hostPackagesPool()
  const plain = await fixture(await signedIndex({ 'fresh-rooms': head }))
  await worker.fetch(new Request(`https://fresh-rooms.pluginthematrix.com/content/${pool}/00000000`), plain.env)
  assert.deepEqual(plain.assetRequests, [`/content/${pool}/00000000`])
  // A package alone is not a site: its hive must be published there.
  const bare = await fixture(await signedIndex({ 'install:fresh-rooms': 'b'.repeat(64) }))
  const response = await worker.fetch(new Request(`https://fresh-rooms.pluginthematrix.com/content/${pool}/00000000`), bare.env)
  assert.equal(response.status, 404)
})

// ── public assessments: anyone assesses a sandbox under their own key ─────
const assessorKey = Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? 2 : 0)
const assessor = hex(schnorr.getPublicKey(assessorKey))
async function indexBy(key, roots, createdAt = 1_800_000_100) {
  const event = { pubkey: hex(schnorr.getPublicKey(key)), created_at: createdAt, kind: 30564, tags: [], content: JSON.stringify({ roots }) }
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  event.id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial))))
  event.sig = hex(schnorr.sign(event.id, key))
  return event
}
const kvMap = (values = new Map()) => ({ values, get: async (k) => values.get(k) ?? null, put: async (k, v) => { values.set(k, String(v)) } })

test('writing an index that names assess:<root> lists its signer as an assessor of that root', async () => {
  const root = 'e'.repeat(64)
  const HIVES = kvMap()
  const env = { SITE_BINDINGS: '{}', HIVES }
  const url = `https://content.hypercomb.com/hive/${assessor}`
  const body = JSON.stringify(await indexBy(assessorKey, { [`assess:${root}`]: 'f'.repeat(64) }))
  const response = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(url, 'PUT', assessorKey) }, body }), env)
  assert.equal(response.status, 201)
  assert.deepEqual(JSON.parse(HIVES.values.get(`assessors:${root}`)), [assessor])
})

test('a try- door lists every signed assessment of its root, and the host AI verdict', async () => {
  const [root, reviewSig, goodRecord] = ['b'.repeat(64), 'd'.repeat(64), 'c'.repeat(64)]
  const HIVES = kvMap(new Map([
    [pubkey, JSON.stringify(await signedIndex({ 'install:try-fresh-rooms': root, 'review:try-fresh-rooms': reviewSig, 'jev:try-fresh-rooms': 'e'.repeat(64) }))],
    [assessor, JSON.stringify(await indexBy(assessorKey, { [`assess:${root}`]: goodRecord }))],
    [`assessors:${root}`, JSON.stringify([assessor, 'not-a-key'])],
  ]))
  const records = new Map([
    [goodRecord, { kind: 'module-assessment', root, verdict: 'refuse', note: 'a'.repeat(64) }],
    [reviewSig, { kind: 'module-review', verdict: 'accept' }],
    ['e'.repeat(64), { kind: 'jev-reading', verdict: 'follows' }],
  ])
  const env = {
    SITE_BINDINGS: JSON.stringify({ 'hypercomb.com': { title: 'Hypercomb', lineage: 'hypercomb', publishers: [{ pubkey, label: 'Jaime', primary: true }] } }),
    HIVES,
    CONTENT: { get: async (k) => records.has(k) ? { arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(records.get(k))).buffer } : null, head: async () => null, list: async () => ({ objects: [], truncated: false }) },
    SANDBOX_SHELL_ORIGIN: 'https://shell.example',
  }
  const site = await (await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/site.json'), env)).json()
  assert.equal(site.reviewVerdict, 'accept')
  assert.deepEqual([site.jev, site.jevVerdict], ['e'.repeat(64), 'follows'])
  assert.deepEqual(site.assessments.map((a) => [a.pubkey, a.record, a.verdict]), [[assessor, goodRecord, 'refuse']])
  // A record that assesses another root is not an assessment of this one.
  records.set(goodRecord, { kind: 'module-assessment', root: 'a'.repeat(64), verdict: 'accept' })
  const again = await (await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/site.json'), env)).json()
  assert.deepEqual(again.assessments, [])
})

// ── the community's translations: who translated, who is missing what ────
test('writing an index that names i18n:<locale> lists its signer as a translator, and i18n-missing:<locale> as missing', async () => {
  const HIVES = kvMap()
  const env = { SITE_BINDINGS: '{}', HIVES }
  const url = `https://content.hypercomb.com/hive/${assessor}`
  const body = JSON.stringify(await indexBy(assessorKey, { 'i18n:ja': 'f'.repeat(64), 'i18n-missing:de': 'a'.repeat(64) }))
  const response = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(url, 'PUT', assessorKey) }, body }), env)
  assert.equal(response.status, 201)
  assert.deepEqual(JSON.parse(HIVES.values.get('translators:ja')), [assessor])
  assert.deepEqual(JSON.parse(HIVES.values.get('missing:de')), [assessor])
  assert.deepEqual(JSON.parse(HIVES.values.get('i18n:locales')).sort(), ['de', 'ja'])
})

test('a locale is listed from every verified index — at /i18n/<locale>.json and at the pool\'s own address', async () => {
  const [catalog, missingRecord, stale] = ['c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)]
  const HIVES = kvMap(new Map([
    [pubkey, JSON.stringify(await signedIndex({ 'i18n:ja': catalog }))],
    [assessor, JSON.stringify(await indexBy(assessorKey, { 'i18n-missing:ja': missingRecord, 'i18n:ja': stale }))],
    ['translators:ja', JSON.stringify([pubkey, assessor, 'not-a-key'])],
    ['missing:ja', JSON.stringify([assessor])],
    ['i18n:locales', JSON.stringify(['ja'])],
  ]))
  const records = new Map([
    [catalog, { kind: 'i18n-catalog', locale: 'ja', namespace: 'app', keys: { 'module.jevfollows': 'すべての規則に従う' }, at: 5 }],
    [missingRecord, { kind: 'i18n-missing', locale: 'ja', keys: ['module.jevread', 7, 'module.focuson'], at: 6 }],
    [stale, { kind: 'i18n-catalog', locale: 'de', keys: { x: 'y' } }],   // names ja in the index, but is a de catalog: not listed
  ])
  const env = {
    SITE_BINDINGS: JSON.stringify({ 'hypercomb.com': { title: 'Hypercomb', lineage: 'hypercomb', publishers: [{ pubkey, label: 'Jaime', primary: true }] } }),
    HIVES,
    CONTENT: { get: async (k) => records.has(k) ? { arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(records.get(k))).buffer } : null, head: async () => null, list: async () => ({ objects: [], truncated: false }) },
  }
  const listed = await (await worker.fetch(new Request('https://content.hypercomb.com/i18n/ja.json'), env)).json()
  assert.deepEqual(listed.meaning, 'i18n:ja')
  assert.deepEqual(listed.members, [catalog])
  assert.deepEqual(listed.translators.map((t) => [t.pubkey, t.label, t.catalog]), [[pubkey, 'Jaime', catalog]])
  assert.deepEqual(listed.missing.map((m) => [m.pubkey, m.record, m.keys]), [[assessor, missingRecord, ['module.jevread', 'module.focuson']]])
  // The pool's own derived address answers the same index — what a published-pool probe fetches.
  const atAddress = await (await worker.fetch(new Request(`https://content.hypercomb.com/${await sha256('i18n:ja')}`), env)).json()
  assert.deepEqual(atAddress.members, [catalog])
  // A locale nobody touched is an honest empty list, and a bad locale is not found.
  assert.deepEqual((await (await worker.fetch(new Request('https://content.hypercomb.com/i18n/fr.json'), env)).json()).members, [])
  assert.equal((await worker.fetch(new Request('https://content.hypercomb.com/i18n/Japanese.json'), env)).status, 404)
})

// ── the trials on a zone: every open try- door, from what the door serves ─
test('a zone lists every open trial from what its door serves, newest first', async () => {
  const [older, newer, changeOld, changeNew, review] = ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)]
  const HIVES = kvMap(new Map([
    [pubkey, JSON.stringify(await signedIndex({
      'install:try-old-rooms': older, 'change:try-old-rooms': changeOld,
      'install:try-new-rooms': newer, 'change:try-new-rooms': changeNew, 'review:try-new-rooms': review, 'jev:try-new-rooms': 'a'.repeat(63) + '1',
      'install:essentials': head, 'try-not-a-channel': head,
    }))],
    // A second approved publisher: its own trial is listed, and the trial the
    // first publisher also names is the first publisher's — as its door serves.
    [assessor, JSON.stringify(await indexBy(assessorKey, { 'install:try-new-rooms': 'a'.repeat(64), 'install:try-theirs': 'a'.repeat(64) }))],
  ]))
  const records = new Map([
    [changeOld, { kind: 'module-change', changes: [{ section: 'src/a.ts' }], off: ['games/pong'], at: 1000 }],
    [changeNew, { kind: 'module-change', changes: [{ section: 'src/b.ts' }, { section: 7 }], off: [], at: 2000, taken: [{ path: 'commands', root: older }, { path: 7, root: older }, { path: 'x', root: 'short' }] }],
    [review, { kind: 'module-review', verdict: 'refuse' }],
    ['a'.repeat(63) + '1', { kind: 'jev-reading', verdict: 'breaks' }],
  ])
  const zone = (extra = {}) => JSON.stringify({ 'hypercomb.com': { title: 'Hypercomb', lineage: 'hypercomb', publishers: [{ pubkey, label: 'Jaime', primary: true }, { pubkey: assessor, label: 'Other' }], ...extra } })
  const env = {
    SITE_BINDINGS: zone({ frontDoor: true }),
    HOST_DOOR_ORIGIN: 'https://door.example',
    HIVES,
    CONTENT: { get: async (k) => records.has(k) ? { arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(records.get(k))).buffer } : null, head: async () => null, list: async () => ({ objects: [], truncated: false }) },
    SANDBOX_SHELL_ORIGIN: 'https://shell.example',
  }
  // The front door answers the listing itself; it never goes to the host card.
  const listing = await (await worker.fetch(new Request('https://hypercomb.com/trials.json'), env)).json()
  assert.equal(listing.zone, 'hypercomb.com')
  assert.deepEqual(listing.trials.map((t) => [t.name, t.pubkey, t.package]), [
    ['try-new-rooms', pubkey, newer], ['try-old-rooms', pubkey, older], ['try-theirs', assessor, 'a'.repeat(64)],
  ])
  const [fresh, old, theirs] = listing.trials
  assert.equal(fresh.door, 'https://try-new-rooms.hypercomb.com')
  assert.deepEqual([fresh.at, fresh.sections, fresh.review, fresh.reviewVerdict], [2000, ['src/b.ts'], review, 'refuse'])
  assert.deepEqual([fresh.jev, fresh.jevVerdict, old.jevVerdict], ['a'.repeat(63) + '1', 'breaks', undefined])
  // What a trial took from other builds travels with the listing: adoption is public.
  assert.deepEqual([fresh.taken, old.taken, theirs.taken], [[{ path: 'commands', root: older }], [], []])
  assert.deepEqual([old.sections, old.off, old.reviewVerdict], [['src/a.ts'], ['games/pong'], undefined])
  assert.deepEqual([theirs.at, theirs.publisher, theirs.sections], [null, 'Other', []])
  // Any door on the zone answers the same listing.
  const fromDoor = await (await worker.fetch(new Request('https://try-old-rooms.hypercomb.com/trials.json'), env)).json()
  assert.deepEqual(fromDoor.trials.map((t) => t.name), ['try-new-rooms', 'try-old-rooms', 'try-theirs'])
  // A zone whose * route is not up lists nothing: none of its doors can be dialled.
  const offZone = await (await worker.fetch(new Request('https://hypercomb.com/trials.json'), { ...env, SITE_BINDINGS: zone({ wildcard: false }) })).json()
  assert.deepEqual(offZone.trials, [])
})

// ── door safety: the door's page wears its own policy, and a door writes nothing
const doorShell = async (url, env) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('<!doctype html>shell', { headers: { 'content-type': 'text/html', 'set-cookie': 'shell=1', 'content-encoding': 'gzip' } })
  try { return await worker.fetch(new Request(url), env) } finally { globalThis.fetch = original }
}
const connectSrc = (response) => response.headers.get('content-security-policy').split(';')
  .map((directive) => directive.trim().split(/\s+/)).find(([name]) => name === 'connect-src').slice(1)
const REFUSED = 'a sandbox door writes nothing — do this from your own hive\n'

test('a door wears its own policy: never framed, no bare http or ws, no cookie', async () => {
  const env = await sandboxEnv({ 'install:try-fresh-rooms': 'b'.repeat(64) })
  const response = await doorShell('https://try-fresh-rooms.hypercomb.com/', env)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '<!doctype html>shell')
  const csp = response.headers.get('content-security-policy')
  for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'none'"]) assert.ok(csp.includes(directive), directive)
  // Scripts are left alone: the shell injects an import map and loads blob: bees.
  assert.doesNotMatch(csp, /default-src|script-src/)
  // Exactly these — no ws:, no bare http:, no origin on this machine.
  assert.deepEqual(connectSrc(response), ["'self'", 'https:', 'wss:', 'blob:', 'data:'])
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('permissions-policy'), /camera=\(\), microphone=\(\)/)
  // No data: worker (an opaque origin); the shell's own and blob: workers only.
  assert.ok(csp.includes("worker-src 'self' blob:"))
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('content-encoding'), null)
  // An unconfigured shell still answers under the door's policy.
  const unconfigured = await worker.fetch(new Request('https://try-fresh-rooms.hypercomb.com/'), { ...env, SANDBOX_SHELL_ORIGIN: '' })
  assert.equal(unconfigured.status, 503)
  assert.match(unconfigured.headers.get('content-security-policy'), /frame-ancestors 'none'/)
})

test('a door on a loopback zone reaches exactly its own two http faces', async () => {
  const env = await sandboxEnv({ 'install:try-fresh-rooms': 'b'.repeat(64) })
  env.SITE_BINDINGS = JSON.stringify({ localhost: { title: 'local', lineage: 'localhost', publishers: [{ pubkey, label: 'Jaime', primary: true }] } })
  const response = await doorShell('http://try-fresh-rooms.localhost:4291/', env)
  assert.equal(response.status, 200)
  assert.deepEqual(connectSrc(response), ["'self'", 'https:', 'wss:', 'blob:', 'data:', 'http://localhost:4291', 'http://content.localhost:4291'])
})

test('a door writes nothing at our hosts — refused before any route, while home and Node still write', async () => {
  // The signed index: a real NIP-98 PUT that succeeds from anywhere but a door.
  const url = `https://content.hypercomb.com/hive/${assessor}`
  const body = JSON.stringify(await indexBy(assessorKey, { 'try-fresh-rooms': head }))
  const putHive = async (origin) => {
    const env = { SITE_BINDINGS: '{}', HIVES: kvMap() }
    const headers = { authorization: await nip98(url, 'PUT', assessorKey), ...(origin ? { origin } : {}) }
    const response = await worker.fetch(new Request(url, { method: 'PUT', headers, body }), env)
    return { status: response.status, text: await response.text(), written: env.HIVES.values.has(assessor) }
  }
  // A door on any zone, the loopback harness's included — and an OPAQUE
  // origin, which is what a sandboxed frame or data: worker a door opens sends.
  for (const door of ['https://try-x.hypercomb.com', 'https://try-x.pluginthematrix.com', 'http://try-x.localhost:4291', 'null']) {
    assert.deepEqual(await putHive(door), { status: 403, text: REFUSED, written: false }, door)
  }
  for (const home of ['https://hypercomb.com', undefined]) {
    const { status, written } = await putHive(home)
    assert.deepEqual({ status, written }, { status: 201, written: true }, String(home))
  }

  // The flat heap's PUT /<sig>: the same gate, the same answer.
  const bytes = 'bytes a door would plant'
  const sig = await sha256Hex(bytes)
  const sigUrl = `https://content.hypercomb.com/${sig}`
  const putSig = async (origin) => {
    const objects = new Map()
    const env = { SITE_BINDINGS: '{}', CONTENT: heap(objects), GRANTS: kvMap() }
    const headers = { authorization: await nip98(sigUrl, 'PUT'), ...(origin ? { origin } : {}) }
    const response = await worker.fetch(new Request(sigUrl, { method: 'PUT', headers, body: bytes }), env)
    return { status: response.status, held: objects.has(sig) }
  }
  assert.deepEqual(await putSig('https://try-x.hypercomb.com'), { status: 403, held: false })
  assert.deepEqual(await putSig('https://hypercomb.com'), { status: 201, held: true })
  assert.deepEqual(await putSig(undefined), { status: 201, held: true })
})

test('a door runs no worker from the heap — its package cannot start one outside the door policy', async () => {
  const bytes = 'self.onmessage = () => new WebSocket("ws://localhost:2401")'
  const sig = await sha256Hex(bytes)
  const objects = new Map([[sig, {}]])
  const env = { SITE_BINDINGS: '{}', CONTENT: heap(objects) }
  const ask = (host, dest) => worker.fetch(new Request(`https://${host}/${sig}`, { headers: { 'sec-fetch-dest': dest } }), env)
  for (const dest of ['serviceworker', 'worker', 'sharedworker']) {
    assert.equal((await ask('try-x.hypercomb.com', dest)).status, 403, dest)
  }
  // The same bytes still load as a module at a door, and as a worker anywhere else.
  assert.notEqual((await ask('try-x.hypercomb.com', 'script')).status, 403)
  assert.notEqual((await ask('content.hypercomb.com', 'worker')).status, 403)
})

test('a door is told only the reads it may make, and its reads still answer', async () => {
  const env = { SITE_BINDINGS: '{}', HIVES: kvMap(new Map([[assessor, JSON.stringify(await indexBy(assessorKey, { 'try-fresh-rooms': head }))]])) }
  const url = `https://content.hypercomb.com/hive/${assessor}`
  const preflight = (origin) => worker.fetch(new Request(url, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'PUT' } }), env)
  const fromDoor = await preflight('https://try-x.hypercomb.com')
  assert.equal(fromDoor.status, 204)
  assert.equal(fromDoor.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS')
  assert.match((await preflight('https://hypercomb.com')).headers.get('access-control-allow-methods'), /PUT/)
  const read = await worker.fetch(new Request(url, { headers: { origin: 'https://try-x.hypercomb.com' } }), env)
  assert.equal(read.status, 200)
  assert.equal((await read.json()).pubkey, assessor)
})

// ── the host AI answers the people this host admitted ─────────────────────
// WHOSE WORD COUNTS: with AI_WRITERS empty, a key minted a moment ago is not
// admitted just by signing — the zone's bound publishers are.
test('the host AI answers its bound publishers, and a stranger\'s key is refused', async () => {
  const grants = new Map()
  const env = {
    SITE_BINDINGS: JSON.stringify(ONE_ZONE),
    ANTHROPIC_API_KEY: 'test',
    CONTENT: { get: async () => null, head: async () => null },
    GRANTS: { get: async (key) => grants.get(key) ?? null, put: async (key, value) => { grants.set(key, value) } },
  }
  const url = 'https://content.pluginthematrix.com/ai/ask'
  const ask = async (key) => worker.fetch(new Request(url, {
    method: 'POST', headers: { authorization: await nip98(url, 'POST', key), 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'what is here?', stream: false }),
  }), env)
  const upstream = []
  const original = globalThis.fetch
  globalThis.fetch = async (target) => { upstream.push(String(target)); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'tiles' }] }), { headers: { 'content-type': 'application/json' } }) }
  try {
    const stranger = await ask(assessorKey)
    assert.equal(stranger.status, 429)
    assert.match(await stranger.text(), /own publishers only/)
    assert.deepEqual(upstream, [])
    const own = await ask(sk)
    assert.notEqual(own.status, 429)
    assert.deepEqual(upstream, ['https://api.anthropic.com/v1/messages'])
  } finally { globalThis.fetch = original }
})
