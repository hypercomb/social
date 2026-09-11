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
  const pool = 'd'.repeat(64)
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
})

test('a site door is readable cross-origin — its manifest carries the open CORS header', async () => {
  const { env } = await fixture()
  const res = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/content/manifest.json'), env)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

// ── the hold ─────────────────────────────────────────────────────────────────

const page = (url, extra = {}) =>
  new Request(url, { headers: { 'sec-fetch-dest': 'document', accept: 'text/html,*/*', ...extra } })

test('a held door answers the page with a holding note, and nothing else', async () => {
  const { env, assetRequests } = await fixture()
  env.VISITOR_HOLD = '1'
  const held = await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)
  assert.equal(held.status, 200)
  assert.equal(held.headers.get('x-reason'), 'visitor hold')
  assert.equal(held.headers.get('cache-control'), 'no-store')
  const body = await held.text()
  assert.match(body, /not open yet/)
  assert.match(body, /noindex/)
  // the page names the key that opens it, and mirrors it into the cookie
  assert.match(body, /hc:visitor:open/)
  assert.match(body, /hc-visitor-open=1/)
  assert.deepEqual(assetRequests, [])

  // files are never held: the descriptor, the manifest, a chunk
  const manifest = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/content/manifest.json'), env)
  assert.equal(manifest.headers.get('x-reason'), null)
  assert.deepEqual(assetRequests, ['/content/manifest.json'])
  const descriptor = await worker.fetch(page('https://revolucion.pluginthematrix.com/site.json'), env)
  assert.equal(descriptor.status, 200)
  assert.equal(descriptor.headers.get('x-reason'), null)
})

test('an opened door serves the engine; ?visitor=off closes it again', async () => {
  const { env, assetRequests } = await fixture()
  env.VISITOR_HOLD = '1'
  const opened = await worker.fetch(page('https://revolucion.pluginthematrix.com/', { cookie: 'a=b; hc-visitor-open=1' }), env)
  assert.equal(opened.headers.get('x-reason'), null)
  assert.equal(await opened.text(), 'visitor engine')
  assert.deepEqual(assetRequests, ['/'])

  const closed = await worker.fetch(page('https://revolucion.pluginthematrix.com/?visitor=off', { cookie: 'hc-visitor-open=1' }), env)
  assert.equal(closed.headers.get('x-reason'), 'visitor hold')
  assert.match(closed.headers.get('set-cookie'), /hc-visitor-open=; Path=\/; Max-Age=0/)
  assert.match(await closed.text(), /removeItem/)
  assert.deepEqual(assetRequests, ['/'])
})

test('without the var, no door holds', async () => {
  const { env } = await fixture()
  const res = await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)
  assert.equal(res.headers.get('x-reason'), null)
  assert.equal(await res.text(), 'visitor engine')
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
