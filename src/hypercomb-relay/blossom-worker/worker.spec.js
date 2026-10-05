import test from 'node:test'
import assert from 'node:assert/strict'
import { schnorr } from '@noble/curves/secp256k1'
import worker from './worker.js'

const sha256Hex = async (text) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const sk = Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? 1 : 0)
const pubkey = hex(schnorr.getPublicKey(sk))
const head = 'a'.repeat(64)
// Named routes are retired: every host answer is at a signature.
const PUBLICATIONS = await sha256Hex('host:publications')
const TRIALS = await sha256Hex('host:trials')
const INDEXES = await sha256Hex('hive:indexes')

async function signedIndex(roots, createdAt = 1_800_000_000, doors, offerings, extra = {}) {
  const explicitDoors = doors === null ? null : {
    ...Object.fromEntries(Object.keys(roots).map(lineage => [lineage,
      ['pluginthematrix.com', 'hypercomb.com', 'other.example']])),
    ...doors,
  }
  const event = {
    pubkey,
    created_at: createdAt,
    kind: 30564,
    tags: [],
    content: JSON.stringify({ roots, ...(explicitDoors ? { doors: explicitDoors } : {}),
      ...(offerings ? { offerings } : {}), ...extra }),
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

/** The page paths a request log shows — without the install pointer's own
 *  read of the bundled package pool, which every served page makes. */
const pages = (requests) => requests.filter((path) => !path.startsWith('/content/'))

async function fixture(event, bindings = ONE_ZONE) {
  event ??= await signedIndex({ pluginthematrix: head, revolucion: head })
  const assetRequests = []
  const held = new Map()
  let currentEvent = event
  return {
    assetRequests,
    env: {
      SITE_BINDINGS: JSON.stringify(bindings),
      HIVES: { get: async (key) => key === pubkey ? JSON.stringify(currentEvent) : null,
        put: async (key, raw) => { if (key === pubkey) currentEvent = JSON.parse(raw) } },
      CONTENT: contentBag(held),
      ASSETS: {
        fetch: async (request) => {
          assetRequests.push(new URL(request.url).pathname)
          return new Response('visitor engine', { headers: { 'content-type': 'text/html' } })
        },
      },
    },
  }
}

function contentBag(held = new Map()) {
  return {
    held,
    head: async key => held.has(key) ? { size: held.get(key).byteLength } : null,
    get: async key => held.has(key) ? {
      size: held.get(key).byteLength,
      body: held.get(key),
      arrayBuffer: async () => held.get(key).slice().buffer,
    } : null,
    put: async (key, body, options) => {
      if (options?.onlyIf?.get?.('If-None-Match') === '*' && held.has(key)) return null
      held.set(key, new Uint8Array(await new Response(body).arrayBuffer()))
      return { key }
    },
    // Each object's etag is a digest of its bytes, as R2's is: a record
    // rewritten by hand is a new etag, the same bytes are the same one.
    list: async ({ prefix }) => ({
      objects: await Promise.all([...held.keys()].filter(key => key.startsWith(prefix)).map(async key =>
        ({ key, etag: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', held.get(key)))) }))),
      truncated: false,
    }),
    delete: async key => { held.delete(key) },
  }
}

/** A door's meta, read the one way there is: the newest marker of the bag at
 *  sign(<host>) (worker.js locationMeta). No named route describes a site. */
async function doorMeta(url, env) {
  const { origin, hostname } = new URL(url)
  const bag = `${origin}/${await sha256Hex(hostname)}/`
  const listing = await worker.fetch(new Request(bag), env)
  if (listing.status !== 200) return { status: listing.status, record: null }
  const newest = (await listing.text()).trim().split('\n').at(-1)
  const marker = await worker.fetch(new Request(bag + newest), env)
  return { status: marker.status, marker, record: marker.status === 200 ? await marker.json() : null }
}

test('a door describes itself in its own bag, sign(<host>), and nowhere else', async () => {
  const { env } = await fixture()
  const { status, marker, record } = await doorMeta('https://revolucion.pluginthematrix.com/', env)
  assert.equal(status, 200)
  assert.equal(marker.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.deepEqual(record, {
    layer: head,
    pubkey,
    lineage: 'revolucion',
    title: 'Revolución',
    publishedAt: 1_800_000_000,
  })
  // The retired named route describes nothing: the path falls to the page.
  const named = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/site.json'), env)
  assert.equal(String(named.headers.get('content-type') ?? '').includes('application/json'), false)
})

test('a marker from before doors carried their meta gains a successor with the same head', async () => {
  const { env } = await fixture()
  const bag = await sha256Hex('revolucion.pluginthematrix.com')
  await env.CONTENT.put(`${bag}/00000000`, JSON.stringify({ layer: head }))
  const { record } = await doorMeta('https://revolucion.pluginthematrix.com/', env)
  assert.equal(record.layer, head)
  assert.equal(record.title, 'Revolución')
  // Nothing is rewritten: the old marker is exactly as it was.
  assert.deepEqual(JSON.parse(new TextDecoder().decode(env.CONTENT.held.get(`${bag}/00000000`))), { layer: head })
})

test('a signed index that changes nothing about a door appends nothing to its bag', async () => {
  const { env } = await fixture()
  await doorMeta('https://revolucion.pluginthematrix.com/', env)
  const bag = await sha256Hex('revolucion.pluginthematrix.com')
  const count = () => [...env.CONTENT.held.keys()].filter(key => key.startsWith(bag + '/')).length
  assert.equal(count(), 1)
  const later = await signedIndex({ pluginthematrix: head, revolucion: head, unrelated: 'b'.repeat(64) }, 1_800_000_100)
  const indexUrl = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
  const put = await worker.fetch(new Request(indexUrl, { method: 'PUT',
    headers: { authorization: await nip98(indexUrl, 'PUT') }, body: JSON.stringify(later) }), env)
  assert.equal(put.status, 200)
  assert.equal(count(), 1)
  // A change the door does carry — its arrival plan — is one new marker.
  const planned = await signedIndex({ pluginthematrix: head, revolucion: head, 'plan:revolucion': 'c'.repeat(64) }, 1_800_000_200)
  assert.equal((await worker.fetch(new Request(indexUrl, { method: 'PUT',
    headers: { authorization: await nip98(indexUrl, 'PUT') }, body: JSON.stringify(planned) }), env)).status, 200)
  assert.equal(count(), 2)
  const { record } = await doorMeta('https://revolucion.pluginthematrix.com/', env)
  assert.equal(record.plan, 'c'.repeat(64))
  assert.equal(record.publishedAt, 1_800_000_200)
})

// The landing picture is retired (0ec3c2d15): an index signed while it
// existed still names one, and the door must serve neither the field nor a
// painted cover.
test('a signed landing field is inert — the door omits it and the visitor page is untouched', async () => {
  const landing = 'f'.repeat(64) + '/landing.webp'
  const event = await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_000, undefined, undefined,
    { landing: { revolucion: landing } })
  const { env } = await fixture(event)
  const site = (await doorMeta('https://revolucion.pluginthematrix.com/', env)).record
  assert.equal('landing' in site, false)
  const shell = '<!doctype html><html><head><title>x</title></head><body><app-root><div class="site-loading" role="status"></div></app-root></body></html>'
  env.ASSETS.fetch = async () => new Response(shell, { headers: { 'content-type': 'text/html' } })
  const html = await (await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)).text()
  // The page carries its door's record and nothing else of the index.
  const door = /<script id="hc-door" type="application\/json">([^<]*)<\/script>/.exec(html)
  assert(door, 'the page carries its door')
  assert.equal('landing' in JSON.parse(door[1]), false)
  // The signed index rides verbatim (its landing field inert inside the publisher's own signed bytes).
  const signed = /<script id="hc-index" type="application\/json">[^<]*<\/script>/.exec(html)
  const card = html.match(/<meta (property="og:|name="twitter:)[^>]*>/g) ?? []
  const rest = card.reduce((page, tag) => page.replace(tag, ''), html.replace(door[0], '').replace(signed?.[0] ?? '', ''))
  assert.equal(rest, shell.replace('<title>x</title>', `<title>${site.title}</title>`))
})

test('a page names its site — the title and share card are in the served HTML, not set by script', async () => {
  const bindings = { ...ONE_ZONE, 'revolucion.pluginthematrix.com': { ...ONE_ZONE['revolucion.pluginthematrix.com'], title: 'Revolución & "Co" $&' } }
  const { env } = await fixture(undefined, bindings)
  const shell = '<!doctype html><html><head><title>Hypercomb</title></head><body></body></html>'
  env.ASSETS.fetch = async () => new Response(shell, { headers: { 'content-type': 'text/html' } })
  const html = await (await worker.fetch(page('https://revolucion.pluginthematrix.com/about'), env)).text()
  const name = 'Revolución &amp; &quot;Co&quot; $&amp;'
  assert.match(html, new RegExp(`<title>${name.replace(/\$/g, '\\$')}</title>`))
  assert(html.includes(`<meta property="og:title" content="${name}">`))
  assert(html.includes(`<meta name="twitter:title" content="${name}">`))
  assert(html.includes('<meta property="og:url" content="https://revolucion.pluginthematrix.com/about">'))
  assert(!html.includes('Published website'))
})

test('a page carries its door record, escaped so no value can close the script', async () => {
  const bindings = { ...ONE_ZONE, 'revolucion.pluginthematrix.com': { ...ONE_ZONE['revolucion.pluginthematrix.com'], title: 'a</script><b>' } }
  const { env } = await fixture(undefined, bindings)
  const shell = '<!doctype html><html><head><title>x</title></head><body></body></html>'
  env.ASSETS.fetch = async () => new Response(shell, { headers: { 'content-type': 'text/html' } })
  const html = await (await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)).text()
  const door = /<script id="hc-door" type="application\/json">([^<]*)<\/script>/.exec(html)
  assert(door, 'the record is not able to break out of its element')
  const record = JSON.parse(door[1])
  assert.equal(record.title, 'a</script><b>')
  assert.equal(record.layer, head)
  assert.equal(record.pubkey, pubkey)
})

test('a page carries the head of its package pool, and its bundled assets reuse the gate', async () => {
  const { env } = await fixture()
  const pool = await sha256Hex('host:packages')
  const pkg = 'e'.repeat(64)
  const shell = '<!doctype html><html><head><title>x</title></head><body></body></html>'
  env.ASSETS.fetch = async (request) => {
    const path = new URL(request.url).pathname
    if (path === `/content/${pool}/`) return new Response('00000000\n', { headers: { 'content-type': 'text/plain' } })
    if (path === `/content/${pool}/00000000`) return new Response(`${pkg}\nessentials`, { headers: { 'content-type': 'text/plain', 'last-modified': 'Fri, 25 Sep 2026 12:00:00 GMT' } })
    return new Response(shell, { headers: { 'content-type': 'text/html' } })
  }
  const html = await (await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)).text()
  const install = /<script id="hc-install" type="application\/json">([^<]*)<\/script>/.exec(html)
  assert(install, 'the page carries its install pointer')
  assert.deepEqual(JSON.parse(install[1]), { pool, marker: '00000000', text: `${pkg}\nessentials`, at: 'Fri, 25 Sep 2026 12:00:00 GMT' })
  // The assets the page then pulls reuse the page's gate: no index read.
  const reads = []
  const get = env.HIVES.get
  env.HIVES.get = async (key) => { reads.push(key); return get(key) }
  const heldGet = env.CONTENT.get
  env.CONTENT.get = async (key) => { if (key.startsWith(INDEXES)) reads.push(key); return heldGet(key) }
  // (a swapped reader is a different store, so this first read refreshes once…)
  await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${pool}/00000000`), env)
  reads.length = 0
  // …and every asset after it reuses that answer.
  await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${pool}/`), env)
  await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${pool}/00000000`), env)
  assert.deepEqual(reads, [])
})

test('the install index goes out as JSON, so the edge compresses it', async () => {
  const { env } = await fixture()
  const pool = await sha256Hex('install:index')
  const other = await sha256Hex('host:packages')
  // Bytes, not a string: the asset server sends this file with no type at all.
  env.ASSETS.fetch = async () => new Response(new TextEncoder().encode('{"package":"x"}'))
  const index = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${pool}/${'e'.repeat(64)}`), env)
  assert.equal(index.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(await index.text(), '{"package":"x"}')
  // Only the index's own pool is named JSON; another typeless asset is left alone.
  const elsewhere = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${other}/00000000`), env)
  assert.equal(elsewhere.headers.get('content-type'), null)
})

test('an index is held at the edge a few seconds, and a write drops the copy', async () => {
  const held = new Map()
  const edge = {
    match: async (request) => (held.has(request.url) ? new Response(held.get(request.url)) : undefined),
    put: async (request, response) => { held.set(request.url, await response.text()) },
    delete: async (request) => held.delete(request.url),
  }
  const before = globalThis.caches
  globalThis.caches = { default: edge }
  try {
    const { env } = await fixture()
    const url = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
    const first = await (await worker.fetch(new Request(url), env)).json()
    assert.equal(held.size, 1, 'the first read leaves a copy at the edge')
    // The pool is not asked again while the copy is fresh.
    const get = env.CONTENT.get
    env.CONTENT.get = async (key) => { assert(!key.startsWith(INDEXES), 'served from the edge'); return get(key) }
    assert.deepEqual(await (await worker.fetch(new Request(url), env)).json(), first)
    env.CONTENT.get = get
    // A write drops the copy, so the next read is the new index.
    const later = await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_070)
    const put = await worker.fetch(new Request(url, { method: 'PUT',
      headers: { authorization: await nip98(url, 'PUT') }, body: JSON.stringify(later) }), env)
    assert.equal(put.status, 200)
    assert.equal((await (await worker.fetch(new Request(url), env)).json()).created_at, 1_800_000_070)
  } finally {
    if (before === undefined) delete globalThis.caches
    else globalThis.caches = before
  }
})

test('a page carries its publisher\'s signed index, byte-identical once parsed', async () => {
  const { env } = await fixture()
  const shell = '<!doctype html><html><head><title>x</title></head><body></body></html>'
  env.ASSETS.fetch = async () => new Response(shell, { headers: { 'content-type': 'text/html' } })
  const html = await (await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)).text()
  const carried = /<script id="hc-index" type="application\/json">([^<]*)<\/script>/.exec(html)
  assert(carried, 'the page carries the signed index')
  const served = await (await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/${INDEXES}/${pubkey}`), env)).json()
  assert.deepEqual(JSON.parse(carried[1]), served)
})

test('a stale marker from before door records moves forward to the signed head', async () => {
  const later = 'c'.repeat(64)
  const { env } = await fixture(await signedIndex({ pluginthematrix: head, revolucion: later }))
  const bag = await sha256Hex('revolucion.pluginthematrix.com')
  // Seeded by an older worker, then passed by an index write that never advanced it.
  await env.CONTENT.put(`${bag}/00000000`, JSON.stringify({ layer: head }))
  const { status, record } = await doorMeta('https://revolucion.pluginthematrix.com/', env)
  assert.equal(status, 200)
  assert.equal(record.layer, later)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(env.CONTENT.held.get(`${bag}/00000000`))), { layer: head }, 'nothing rewritten')
})

test('a marker that carries meta stays the authority: a disagreement closes the door', async () => {
  const later = 'c'.repeat(64)
  const { env } = await fixture(await signedIndex({ pluginthematrix: head, revolucion: later }))
  const bag = await sha256Hex('revolucion.pluginthematrix.com')
  await env.CONTENT.put(`${bag}/00000000`, JSON.stringify({ layer: head, pubkey, lineage: 'revolucion', title: 'Revolución', publishedAt: 1 }))
  assert.equal((await doorMeta('https://revolucion.pluginthematrix.com/', env)).status, 404)
})

test('the door carries the arrival plan the publisher signed beside the root', async () => {
  const plan = 'c'.repeat(64)
  const { env } = await fixture(await signedIndex({ pluginthematrix: head, revolucion: head, 'plan:revolucion': plan, 'plan:other': 'd'.repeat(64) }))
  const descriptor = (await doorMeta('https://revolucion.pluginthematrix.com/', env)).record
  assert.equal(descriptor.plan, plan)
  // Not a signature — no plan; the whole package loads, as always.
  const { env: garbled } = await fixture(await signedIndex({ pluginthematrix: head, revolucion: head, 'plan:revolucion': 'not-a-sig' }))
  const plain = (await doorMeta('https://revolucion.pluginthematrix.com/', garbled)).record
  assert.equal('plan' in plain, false)
})

test('the door carries the publisher\'s participant-only features, signed under their key', async () => {
  const quiet = 'e'.repeat(64)
  const { env } = await fixture(await signedIndex({ pluginthematrix: head, revolucion: head, 'pool:features:participant': quiet }))
  const descriptor = (await doorMeta('https://revolucion.pluginthematrix.com/', env)).record
  assert.equal(descriptor.quiet, quiet)
  const { env: none } = await fixture(await signedIndex({ pluginthematrix: head, revolucion: head }))
  const plain = (await doorMeta('https://revolucion.pluginthematrix.com/', none)).record
  assert.equal('quiet' in plain, false)
})

test('publications.json exposes the verified Core host registry', async () => {
  const { env } = await fixture()
  const response = await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)
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
  const response = await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)
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
  const descriptor = await doorMeta('https://dylan.pluginthematrix.com/', env)
  assert.equal(descriptor.status, 200)
  assert.equal(descriptor.record.lineage, 'dylan')
})

test('an unpublished name keeps its plate off the directory', async () => {
  const { env } = await fixture(await signedIndex({ pluginthematrix: head }))
  const response = await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)
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
    new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()

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
      const descriptor = await doorMeta(`https://${door.host}/`, env)
      assert.equal(descriptor.status, 200, `${door.host} was advertised and does not answer`)
      assert.equal(descriptor.record.lineage, site.lineage)
    }
  }
})

test('a nested lineage reports exactly its bound host', async () => {
  const event = await signedIndex({ pluginthematrix: head, 'revolucion/meetup': head })
  const { env } = await fixture(event, TWO_ZONES)
  const registry = await (await worker.fetch(
    new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()

  // The wildcard maps ONE label, never a path — `meetup.hypercomb.com` is not
  // a door and inventing one would advertise a 404.
  const meetup = registry.sites.find((s) => s.lineage === 'revolucion/meetup')
  assert.deepEqual(meetup.hosts.map((h) => h.host), ['meetup.pluginthematrix.com'])
})

test('a route that is not deployed is not a door', async () => {
  const event = await signedIndex({ pluginthematrix: head, hypercomb: head, 'anchor.example': head })
  const { env } = await fixture(event, TWO_ZONES)
  const registry = await (await worker.fetch(
    new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()

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
    new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()
  assert.ok(!registry.sites.some((s) => s.lineage === 'install:essentials'),
    registry.sites.map((s) => s.host).join(' '))
})

test('forged hive indexes never become website roots', async () => {
  const event = await signedIndex({ revolucion: head })
  event.content = JSON.stringify({ roots: { revolucion: 'b'.repeat(64) } })
  const { env } = await fixture(event)
  const response = await doorMeta('https://revolucion.pluginthematrix.com/', env)
  assert.equal(response.status, 404)
})

test('application paths receive the shared visitor engine', async () => {
  const { env, assetRequests } = await fixture()
  const journal = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/journal'), env)
  const revisions = await worker.fetch(new Request('https://pluginthematrix.com/revisions'), env)
  assert.equal(await journal.text(), 'visitor engine')
  assert.equal(await revisions.text(), 'visitor engine')
  assert.deepEqual(pages(assetRequests), ['/journal', '/revisions'])
  assert.match(journal.headers.get('content-security-policy'), /connect-src 'self'/)
  assert.equal(journal.headers.get('referrer-policy'), 'no-referrer')
})

test('bare domain is a Core creation, not a server-authored landing page', async () => {
  const { env, assetRequests } = await fixture()
  const descriptor = await doorMeta('https://pluginthematrix.com/', env)
  const entrance = await worker.fetch(new Request('https://pluginthematrix.com/'), env)
  assert.equal(descriptor.record.lineage, 'pluginthematrix')
  assert.equal(await entrance.text(), 'visitor engine')
  assert.deepEqual(pages(assetRequests), ['/'])
})

test('published Core hosts reject every mutation before relay routing', async () => {
  const { env, assetRequests } = await fixture()
  // A site under the zone — explicit or implicit — stays read-only. (The zone
  // root itself is the write face now; see the root-write tests below.)
  const upload = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/upload', { method: 'PUT' }), env)
  const hive = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/${INDEXES}/${pubkey}`, { method: 'PUT' }), env)
  const options = await worker.fetch(new Request('https://pluginthematrix.pluginthematrix.com/', { method: 'OPTIONS' }), env)
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
  const declared = (await doorMeta('https://revolucion.pluginthematrix.com/', env)).record
  const offOrigin = (await doorMeta('https://pluginthematrix.com/', env)).record
  assert.equal(declared.icon, `/${'c'.repeat(64)}/mark.svg`)
  // Refused, not passed through: the visitor keeps the Hypercomb mark rather
  // than fetching an icon from a third party on every page load.
  assert.equal('icon' in offOrigin, false)
})

test('a pool address on a site door answers the directory branch, never the SPA fallback', async () => {
  const pool = await sha256Hex('host:packages')
  const { env, assetRequests } = await fixture()
  // nothing under the prefix: an empty listing — 200, so a door that publishes
  // nothing prints no 404 in every follower's console — text, no-store,
  // cross-origin readable
  const empty = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/${pool}/`), env)
  assert.equal(empty.status, 200)
  assert.equal(await empty.text(), '')
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

test('the offerings pool projects only open, signed creations on this domain', async () => {
  const event = await signedIndex({
    pluginthematrix: head, revolucion: head, susan: head,
    'install:essentials': head,
  }, 1_800_000_000, { revolucion: ['pluginthematrix.com'], susan: ['other.example'] })
  const bindings = {
    ...ONE_ZONE,
    'pluginthematrix.com': { ...ONE_ZONE['pluginthematrix.com'], frontDoor: true },
    'other.example': { title: 'Other', lineage: 'other', frontDoor: true, publishers: [{ pubkey, primary: true }] },
  }
  const { env } = await fixture(event, bindings)
  const retained = env.CONTENT.held
  const pool = await sha256Hex('host:offerings')
  const listing = await worker.fetch(new Request(`https://pluginthematrix.com/${pool}/`), env)
  assert.equal(listing.status, 200)
  assert.equal(listing.headers.get('cache-control'), 'no-store')
  const names = (await listing.text()).trim().split('\n')
  assert.equal(names.length, 1)
  const member = await worker.fetch(new Request(`https://pluginthematrix.com/content/${pool}/${names[0]}`), env)
  const bytes = await member.text()
  assert.equal(member.status, 200)
  assert.equal(await sha256Hex(bytes), names[0])
  // The publisher's index moved into its pool member on first read; no location bag was minted.
  assert.deepEqual([...retained.keys()].filter((key) => !key.startsWith(`${INDEXES}/`)), [], 'pool discovery does not fetch or mint every location bag')
  assert(retained.has(`${INDEXES}/${pubkey}`), 'an index only KV held moves into its pool member when read')
  assert.equal((await doorMeta('https://revolucion.pluginthematrix.com/', env)).status, 200)
  assert(retained.has(`${await sha256Hex('revolucion.pluginthematrix.com')}/00000000`),
    'visiting a legacy signed route seeds its location bag once')
  const offer = JSON.parse(bytes)
  assert.deepEqual({ title: offer.title, route: offer.route, lineage: offer.lineage, pubkey: offer.pubkey, location: offer.location }, {
    title: ONE_ZONE['revolucion.pluginthematrix.com'].title, route: 'https://revolucion.pluginthematrix.com/', lineage: 'revolucion', pubkey,
    location: await sha256Hex('revolucion.pluginthematrix.com'),
  })
  assert.equal('head' in offer, false, 'the pool member names a location, not one revision')

  const atDoor = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/${pool}/`), env)
  assert.equal(await atDoor.text(), `${names[0]}\n`)
  const other = await worker.fetch(new Request(`https://other.example/${pool}/`), env)
  assert.equal(other.status, 200)
  const otherNames = (await other.text()).trim().split('\n')
  const otherOffers = await Promise.all(otherNames.map(async name =>
    (await worker.fetch(new Request(`https://other.example/${pool}/${name}`), env)).json()))
  assert(otherOffers.some(row => row.route === 'https://susan.other.example/'))
  assert(!otherOffers.some(row => row.lineage === 'revolucion'))

  const indexUrl = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
  const revise = await signedIndex({ pluginthematrix: head, revolucion: 'b'.repeat(64), susan: head },
    1_800_000_001, { revolucion: ['pluginthematrix.com'], susan: ['other.example'] })
  const published = await worker.fetch(new Request(indexUrl, { method: 'PUT',
    headers: { authorization: await nip98(indexUrl, 'PUT') }, body: JSON.stringify(revise) }), env)
  assert.equal(published.status, 200)
  const revised = await worker.fetch(new Request(`https://pluginthematrix.com/${pool}/`), env)
  assert.equal(await revised.text(), `${names[0]}\n`, 'a new head keeps the same hashed location member')
  const location = await sha256Hex('revolucion.pluginthematrix.com')
  const history = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${location}/`), env)
  assert.equal(await history.text(), '00000000\n00000001\n')
  const marker = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${location}/00000001`), env)
  assert.equal((await marker.json()).layer, 'b'.repeat(64))
  const older = await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${location}/00000000`), env)
  assert.equal((await older.json()).layer, head, 'a known older marker remains readable')

  const withdraw = await signedIndex({ pluginthematrix: head }, 1_800_000_002)
  assert.equal((await worker.fetch(new Request(indexUrl, { method: 'PUT',
    headers: { authorization: await nip98(indexUrl, 'PUT') }, body: JSON.stringify(withdraw) }), env)).status, 200)
  const withdrawn = await worker.fetch(new Request(`https://pluginthematrix.com/${pool}/`), env)
  assert.equal(withdrawn.status, 404)
  assert.equal((await worker.fetch(new Request(`https://revolucion.pluginthematrix.com/content/${location}/`), env)).status, 404,
    'withdrawing the signed door hides its location listing')
  // If an immutable member was deliberately retained in the ordinary pool,
  // its known name still resolves. The worker does not store a copy on read.
  retained.set(`${pool}/${names[0]}`, new TextEncoder().encode(bytes))
  const historical = await worker.fetch(new Request(`https://pluginthematrix.com/${pool}/${names[0]}`), env)
  assert.equal(historical.status, 200)
  assert.equal(await historical.text(), bytes)
})

test('a signed public creation projects one location and keeps its revisions there', async () => {
  const { env } = await fixture()
  const meaning = 'themes:text'
  const key = 'editorial'
  const host = 'pluginthematrix.com'
  const location = await sha256Hex(`${meaning}:${key}`)
  const putRevision = async label => {
    const layer = JSON.stringify({ name: 'text-theme', label, read: 'readable', code: 'monospace' })
    const layerSig = await sha256Hex(layer)
    const meta = JSON.stringify({ meta: 1, layer: layerSig, relation: meaning })
    const metaSig = await sha256Hex(meta)
    await env.CONTENT.put(layerSig, layer)
    await env.CONTENT.put(metaSig, meta)
    return metaSig
  }
  const indexUrl = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
  const publish = async (headSig, stamp, offerings) => worker.fetch(new Request(indexUrl, {
    method: 'PUT', headers: { authorization: await nip98(indexUrl, 'PUT') },
    body: JSON.stringify(await signedIndex({ pluginthematrix: head, revolucion: head }, stamp, undefined, offerings)),
  }), env)
  const first = await putRevision('Editorial')
  const declared = { [location]: { meaning, key, head: first, title: 'Editorial', host } }
  assert.equal((await publish(first, 1_800_000_001, declared)).status, 200)

  const pool = await sha256Hex('host:offerings')
  const listing = await worker.fetch(new Request(`https://${host}/${pool}/`), env)
  assert.equal(listing.status, 200)
  const memberNames = (await listing.text()).trim().split('\n')
  const members = await Promise.all(memberNames.map(async name => {
    const response = await worker.fetch(new Request(`https://${host}/content/${pool}/${name}`), env)
    const bytes = await response.text()
    assert.equal(await sha256Hex(bytes), name)
    return JSON.parse(bytes)
  }))
  assert.deepEqual(members.filter(row => row.kind === 'host:creation'), [
    { kind: 'host:creation', meaning, key, location, pubkey, title: 'Editorial', host },
  ])
  assert.equal((await worker.fetch(new Request(`https://${host}/${await sha256Hex(meaning)}/`), env)).status, 404,
    'sharing one theme does not enumerate the private typed pool')
  const bag = `https://${host}/content/${location}/`
  assert.equal(await (await worker.fetch(new Request(bag), env)).text(), '00000000\n')
  assert.deepEqual(await (await worker.fetch(new Request(`${bag}00000000`), env)).json(), { layer: first })

  const second = await putRevision('Editorial revised')
  declared[location].head = second
  assert.equal((await publish(second, 1_800_000_002, declared)).status, 200)
  assert.equal(await (await worker.fetch(new Request(bag), env)).text(), '00000000\n00000001\n')
  assert.deepEqual(await (await worker.fetch(new Request(`${bag}00000001`), env)).json(), { layer: second })
  assert.deepEqual(await (await worker.fetch(new Request(`${bag}00000000`), env)).json(), { layer: first })

  assert.equal((await publish(second, 1_800_000_003, {})).status, 200)
  const after = await worker.fetch(new Request(`https://${host}/${pool}/`), env)
  const remaining = await Promise.all((await after.text()).trim().split('\n').map(async name =>
    (await worker.fetch(new Request(`https://${host}/${pool}/${name}`), env)).json()))
  assert(!remaining.some(row => row.kind === 'host:creation'))
  assert.equal((await worker.fetch(new Request(bag), env)).status, 404)
  const retainedName = memberNames[members.findIndex(row => row.kind === 'host:creation')]
  assert.equal((await worker.fetch(new Request(`https://${host}/${pool}/${retainedName}`), env)).status, 200,
    'the signed-derived member remains readable by its hash after withdrawal')
  assert.equal((await worker.fetch(new Request(`https://${host}/${first}`), env)).status, 200,
    'known signed bytes remain servable after the public switch is off')
})

test('a public creation waits for staged bytes and rejects a false location', async () => {
  const { env } = await fixture()
  const meaning = 'themes:text'
  const key = 'quiet'
  const location = await sha256Hex(`${meaning}:${key}`)
  const layer = JSON.stringify({ name: 'text-theme', label: 'Quiet', read: 'readable', code: 'monospace' })
  const layerSig = await sha256Hex(layer)
  const meta = JSON.stringify({ meta: 1, layer: layerSig, relation: meaning })
  const metaSig = await sha256Hex(meta)
  const offer = { meaning, key, head: metaSig, title: 'Quiet', host: 'pluginthematrix.com' }
  const url = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
  const request = async (offerings, stamp) => worker.fetch(new Request(url, {
    method: 'PUT', headers: { authorization: await nip98(url, 'PUT') },
    body: JSON.stringify(await signedIndex({ pluginthematrix: head }, stamp, undefined, offerings)),
  }), env)
  assert.equal((await request({ ['a'.repeat(64)]: offer }, 1_800_000_001)).status, 400)
  assert.equal((await request({ [location]: offer }, 1_800_000_001)).status, 503)
  assert.equal((await worker.fetch(new Request(`https://pluginthematrix.com/content/${location}/`), env)).status, 404)
  await env.CONTENT.put(metaSig, meta)
  assert.equal((await request({ [location]: offer }, 1_800_000_001)).status, 503,
    'the meta envelope alone does not stage its typed layer')
  await env.CONTENT.put(layerSig, layer)
  assert.equal((await request({ [location]: offer }, 1_800_000_001)).status, 200,
    'retrying the same signed index repairs an interrupted location append')
  assert.equal(await (await worker.fetch(new Request(`https://pluginthematrix.com/content/${location}/`), env)).text(), '00000000\n')
})

test('an unknown creation meaning stays off the public projection', async () => {
  const { env } = await fixture()
  const meaning = 'beehaviors:code'
  const key = 'unresolved'
  const location = await sha256Hex(`${meaning}:${key}`)
  const layer = JSON.stringify({ name: 'beehavior', dependency: 'a'.repeat(64) })
  const layerSig = await sha256Hex(layer)
  const meta = JSON.stringify({ meta: 1, layer: layerSig, relation: meaning })
  const metaSig = await sha256Hex(meta)
  await env.CONTENT.put(layerSig, layer)
  await env.CONTENT.put(metaSig, meta)
  const url = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
  const event = await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_001, undefined,
    { [location]: { meaning, key, head: metaSig, title: 'Unresolved', host: 'pluginthematrix.com' } })
  assert.equal((await worker.fetch(new Request(url, { method: 'PUT',
    headers: { authorization: await nip98(url, 'PUT') }, body: JSON.stringify(event) }), env)).status, 200)
  const pool = await sha256Hex('host:offerings')
  const listing = await worker.fetch(new Request(`https://pluginthematrix.com/${pool}/`), env)
  const members = await Promise.all((await listing.text()).trim().split('\n').map(async name =>
    (await worker.fetch(new Request(`https://pluginthematrix.com/${pool}/${name}`), env)).json()))
  assert(!members.some(row => row.kind === 'host:creation'))
  assert(![...env.CONTENT.held.keys()].some(name => name.endsWith(`/${location}/00000000`)))
})

test('equal meaning and key on two hosts keep separate location histories', async () => {
  const firstIndex = await signedIndex({ pluginthematrix: head, revolucion: head })
  const secondIndex = await indexBy(assessorKey, {}, 1_800_000_100)
  const { env } = await fixture(firstIndex, {
    ...ONE_ZONE,
    'other.example': { title: 'Other', lineage: 'other', frontDoor: true,
      publishers: [{ pubkey: assessor, primary: true }] },
  })
  env.HIVES = kvMap(new Map([[pubkey, JSON.stringify(firstIndex)], [assessor, JSON.stringify(secondIndex)]]))
  const meaning = 'themes:text'
  const key = 'shared-name'
  const location = await sha256Hex(`${meaning}:${key}`)
  const putHead = async label => {
    const layer = JSON.stringify({ name: 'text-theme', label, read: 'readable', code: 'monospace' })
    const layerSig = await sha256Hex(layer)
    const meta = JSON.stringify({ meta: 1, layer: layerSig, relation: meaning })
    const metaSig = await sha256Hex(meta)
    await env.CONTENT.put(layerSig, layer)
    await env.CONTENT.put(metaSig, meta)
    return metaSig
  }
  const firstHead = await putHead('First host')
  const secondHead = await putHead('Second host')
  const firstUrl = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
  const secondUrl = `https://content.pluginthematrix.com/${INDEXES}/${assessor}`
  const firstOffer = { [location]: { meaning, key, head: firstHead, title: 'First host', host: 'pluginthematrix.com' } }
  const secondOffer = { [location]: { meaning, key, head: secondHead, title: 'Second host', host: 'other.example' } }
  assert.equal((await worker.fetch(new Request(firstUrl, { method: 'PUT',
    headers: { authorization: await nip98(firstUrl, 'PUT') },
    body: JSON.stringify(await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_001, undefined, firstOffer)) }), env)).status, 200)
  assert.equal((await worker.fetch(new Request(secondUrl, { method: 'PUT',
    headers: { authorization: await nip98(secondUrl, 'PUT', assessorKey) },
    body: JSON.stringify(await indexBy(assessorKey, {}, 1_800_000_101, undefined, secondOffer)) }), env)).status, 200)
  for (const [host, expected] of [['pluginthematrix.com', firstHead], ['other.example', secondHead]]) {
    const bag = `https://${host}/content/${location}/`
    assert.equal(await (await worker.fetch(new Request(bag), env)).text(), '00000000\n')
    assert.equal((await (await worker.fetch(new Request(`${bag}00000000`), env)).json()).layer, expected)
  }
})

test('a changed index read cannot advance or overwrite an existing location bag', async () => {
  const { env } = await fixture()
  const route = 'https://revolucion.pluginthematrix.com'
  const location = await sha256Hex('revolucion.pluginthematrix.com')
  assert.equal((await doorMeta(`${route}/`, env)).status, 200)
  const key = `${location}/00000000`
  const original = env.CONTENT.held.get(key).slice()
  // The index changes where it is held — its pool member — without passing
  // through a PUT (another isolate, another host).
  env.CONTENT.held.set(`${INDEXES}/${pubkey}`, new TextEncoder().encode(
    JSON.stringify(await signedIndex({ pluginthematrix: head, revolucion: 'b'.repeat(64) }, 1_800_000_001))))
  assert.equal((await doorMeta(`${route}/`, env)).status, 404)
  assert.equal((await worker.fetch(new Request(`${route}/content/${location}/`), env)).status, 404)
  assert.deepEqual([...env.CONTENT.held.keys()].filter(name => name.startsWith(`${location}/`)), [key])
  assert.deepEqual(env.CONTENT.held.get(key), original)
})

test('a stale signed index cannot roll a route location backward', async () => {
  const { env } = await fixture(await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_010))
  const route = 'https://revolucion.pluginthematrix.com'
  const location = await sha256Hex('revolucion.pluginthematrix.com')
  assert.equal((await doorMeta(`${route}/`, env)).status, 200)
  const url = `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`
  const stale = await signedIndex({ pluginthematrix: head, revolucion: 'b'.repeat(64) }, 1_800_000_009)
  const result = await worker.fetch(new Request(url, { method: 'PUT',
    headers: { authorization: await nip98(url, 'PUT') }, body: JSON.stringify(stale) }), env)
  assert.equal(result.status, 409)
  assert.equal((await doorMeta(`${route}/`, env)).status, 200)
  assert.deepEqual([...env.CONTENT.held.keys()].filter(name => name.startsWith(`${location}/`)), [`${location}/00000000`])
})

test('a known private bag cannot be enumerated through the route location endpoint', async () => {
  const { env } = await fixture()
  const privateAddress = await sha256Hex('private:notes')
  await env.CONTENT.put(`${privateAddress}/00000000`, JSON.stringify({ layer: head }))
  const route = 'https://revolucion.pluginthematrix.com'
  const listing = await worker.fetch(new Request(`${route}/${privateAddress}/`), env)
  assert.equal(listing.status, 404)
  const marker = await worker.fetch(new Request(`${route}/content/${privateAddress}/00000000`), env)
  assert.notEqual(await marker.text(), JSON.stringify({ layer: head }),
    'the generic asset route cannot read a private R2 bag member')
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
  assert.deepEqual(pages(assetRequests), ['/'])
})

test('a named door whose lineage is not in the signed index is hidden — page, files and descriptor', async () => {
  const { env, assetRequests } = await fixture(await signedIndex({ pluginthematrix: head }))
  const res = await worker.fetch(page('https://revolucion.pluginthematrix.com/'), env)
  assert.equal(res.status, 404)
  assert.match(await res.text(), /nothing published at revolucion.pluginthematrix.com/)
  const manifest = await worker.fetch(new Request('https://revolucion.pluginthematrix.com/content/manifest.json'), env)
  assert.equal(manifest.status, 404)
  const descriptor = await doorMeta('https://revolucion.pluginthematrix.com/', env)
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

test('an entry signed before doors opens as it did before doors — everywhere', async () => {
  const index = await signedIndex({ pluginthematrix: head, revolucion: head, 'games/arkanoid': head, dylan: head, susan: head,
    favorites: head, 'behaviors/guidance': head, 'revolucion/meetup': head, 'hypercomb/architecture/replication-by-signature': head },
    1_800_000_000, null)
  const { env } = await fixture(index, TWO_ZONES)
  for (const host of ['revolucion.pluginthematrix.com', 'dylan.pluginthematrix.com', 'susan.pluginthematrix.com',
    'pluginthematrix.com', 'favorites.pluginthematrix.com', 'meetup.pluginthematrix.com', 'dylan.hypercomb.com']) {
    const door = await doorMeta(`https://${host}/`, env)
    assert.equal(door.status, 200, host)
  }
  // The ledger lists them too, and nothing was written into the index.
  const ledger = await (await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()
  assert(ledger.sites.some((s) => s.lineage === 'dylan' && s.publishers[0].head === head))
  assert.equal(JSON.parse((await env.HIVES.get(pubkey))).content.includes('doors'), false)
})

test('an entry with doors is still obeyed exactly beside one without', async () => {
  const index = await signedIndex({ pluginthematrix: head, susan: head, dylan: head }, 1_800_000_000, { susan: ['hypercomb.com'] })
  const content = JSON.parse(index.content)
  delete content.doors.dylan
  delete content.doors.pluginthematrix
  const reSigned = await signedIndex(content.roots, 1_800_000_000, null, undefined, { doors: content.doors })
  const { env } = await fixture(reSigned, TWO_ZONES)
  assert.equal((await doorMeta('https://susan.hypercomb.com/', env)).status, 200)
  assert.equal((await doorMeta('https://susan.pluginthematrix.com/', env)).status, 404, 'off its doors')
  assert.equal((await doorMeta('https://dylan.pluginthematrix.com/', env)).status, 200, 'no doors entry: opens')
})

test('the drain routes answer the same bytes as the signature addresses', async () => {
  const { env } = await fixture()
  const same = async (named, address) => {
    const a = await (await worker.fetch(new Request(named), env)).text()
    const b = await (await worker.fetch(new Request(address), env)).text()
    assert.equal(a, b, named)
  }
  await same('https://pluginthematrix.com/publications.json', `https://pluginthematrix.com/${PUBLICATIONS}`)
  await same('https://pluginthematrix.com/trials.json', `https://pluginthematrix.com/${TRIALS}`)
  await same(`https://content.pluginthematrix.com/hive/${pubkey}`, `https://content.pluginthematrix.com/${INDEXES}/${pubkey}`)
  // An old install still publishes through /hive/<pubkey>, into the same pool member.
  const later = await signedIndex({ pluginthematrix: head, revolucion: head }, 1_800_000_050)
  const url = `https://content.pluginthematrix.com/hive/${pubkey}`
  const put = await worker.fetch(new Request(url, { method: 'PUT',
    headers: { authorization: await nip98(url, 'PUT') }, body: JSON.stringify(later) }), env)
  assert.equal(put.status, 200)
  const held = await (await worker.fetch(new Request(`https://content.pluginthematrix.com/${INDEXES}/${pubkey}`), env)).json()
  assert.equal(held.created_at, 1_800_000_050)
})

test('signed doors switch a branch per domain — on where listed, hidden elsewhere', async () => {
  const index = await signedIndex({ pluginthematrix: head, susan: head }, undefined, { susan: ['hypercomb.com'] })
  const { env, assetRequests } = await fixture(index, TWO_ZONES)
  const on = await worker.fetch(page('https://susan.hypercomb.com/'), env)
  assert.equal(await on.text(), 'visitor engine')
  const off = await worker.fetch(page('https://susan.pluginthematrix.com/'), env)
  assert.equal(off.status, 404)
  const descriptor = await doorMeta('https://susan.pluginthematrix.com/', env)
  assert.equal(descriptor.status, 404)
  // The fixture explicitly opens the apex while susan has one chosen domain.
  const legacy = await worker.fetch(page('https://pluginthematrix.com/'), env)
  assert.equal(await legacy.text(), 'visitor engine')
  assert.deepEqual(pages(assetRequests), ['/', '/'])
  // the ledger lists susan only where it opens
  const ledger = await (await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()
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
    const ledger = await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)
    assert.ok(Array.isArray((await ledger.json()).sites))
    assert.deepEqual(asked, ['https://door.example/?x=1'])
    assert.deepEqual(assetRequests, [])
  } finally { globalThis.fetch = realFetch }
})

test('a byte mirror serves the host door while retaining its signed read and write routes', async () => {
  const { env } = await fixture()
  env.HOST_DOOR_ORIGIN = 'https://door.example'
  env.HOST_DOOR_HOSTS = 'pluginthematrix.io'
  const bytes = new TextEncoder().encode('mirror bytes')
  const sig = await sha256Hex('mirror bytes')
  env.CONTENT.held.set(sig, bytes)
  const asked = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => { asked.push(String(url)); return new Response('pure host') }
  try {
    assert.equal(await (await worker.fetch(page('https://pluginthematrix.io/hosts'), env)).text(), 'pure host')
    assert.equal(await (await worker.fetch(new Request('https://pluginthematrix.io/pin'), env)).text(), 'pure host')
    assert.equal(await (await worker.fetch(new Request(`https://pluginthematrix.io/${sig}`), env)).text(), 'mirror bytes')
    const deniedWrite = await worker.fetch(new Request(`https://pluginthematrix.io/${sig}`, {
      method: 'PUT', body: 'different bytes',
    }), env)
    assert.equal(deniedWrite.status, 401)
    assert.deepEqual(asked, ['https://door.example/hosts', 'https://door.example/pin'])
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
  const bag = contentBag()
  return {
    ...bag,
    get: async (key) => {
      const marker = await bag.get(key)
      if (marker) return marker
      const text = objects[key]
      if (text === undefined) return null
      const bytes = utf8(text)
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    },
  }
}

async function operated({ roots, objects, bindings = {}, operators, extra }) {
  const event = await signedIndex(roots, undefined, undefined, undefined, extra)
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
  (await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).text()
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

test('the floor pool listing never reads an index, even on an operated zone', async () => {
  const { env, hiveReads } = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record } })
  const response = await worker.fetch(new Request('https://pluginthematrix.com/' + await sha256('host:packages') + '/'), env)
  assert.equal(response.status, 200)
  assert.deepEqual(hiveReads, [])
})

test('an undeclared pool is not listed, and repeated probes do not re-read the index', async () => {
  const { env, hiveReads } = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record } })
  const probe = () => worker.fetch(new Request('https://pluginthematrix.com/' + 'c'.repeat(64) + '/'), env)
  assert.equal((await probe()).status, 404)
  const reads = hiveReads.length
  assert.ok(reads <= 1)
  assert.equal((await probe()).status, 404)
  assert.equal(hiveReads.length, reads)
})

test("a pool is listed only while an operator's signed index declares it", async () => {
  const windows = await sha256('hypercomb:windows')
  const member = 'd'.repeat(64)
  const objects = { [VECTOR.recordSig]: VECTOR.record }
  const listingOf = async (env, sig) => {
    await env.CONTENT.put(windows + '/' + member, '{}')
    return worker.fetch(new Request('https://pluginthematrix.com/' + sig + '/'), env)
  }

  const declared = await operated({ roots: BOUND_ROOTS, objects, extra: { listed: ['hypercomb:windows', 'bare', 42] } })
  const listed = await listingOf(declared.env, windows)
  assert.equal(listed.status, 200)
  assert.equal(await listed.text(), member + '\n')
  // A bare word is never declarable: it would address a molecule pool.
  assert.equal((await listingOf(declared.env, await sha256('bare'))).status, 404)

  const silent = await operated({ roots: BOUND_ROOTS, objects })
  assert.equal((await listingOf(silent.env, windows)).status, 404)

  const stranger = await operated({ roots: BOUND_ROOTS, objects, extra: { listed: ['hypercomb:windows'] }, operators: { [VECTOR.zone]: 'b'.repeat(64) } })
  assert.equal((await listingOf(stranger.env, windows)).status, 404)
})

// ── the sandbox door (documentation/module-sandbox.md) ────────────────────
// `try-<change>.<zone>` is a full hive whose own origin names the package the
// approved publisher stamped as `install:try-<change>`; a door with no stamp
// is "nothing here"; everything that is not the package goes to the shell.
const sandboxEnv = async (roots, shellRequests = []) => ({
  SITE_BINDINGS: JSON.stringify({ 'hypercomb.com': { title: 'Hypercomb', lineage: 'hypercomb', publishers: [{ pubkey, label: 'Jaime', primary: true }] } }),
  HIVES: { get: async (key) => key === pubkey ? JSON.stringify(await signedIndex(roots)) : null },
  CONTENT: contentBag(),
  SANDBOX_SHELL_ORIGIN: 'https://shell.example',
  __shellRequests: shellRequests,
})
const hostPackagesPool = async () => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('host:packages'))))

/** What a sandbox door is, read the one way there is: the newest marker of
 *  its own bag, sign(<try-host>). */
async function sandboxDoor(env, host = 'try-fresh-rooms.hypercomb.com') {
  const bag = await sha256Hex(host)
  const listing = await worker.fetch(new Request(`https://${host}/${bag}/`), env)
  if (listing.status !== 200) return null
  const newest = (await listing.text()).trim().split('\n').at(-1)
  return (await worker.fetch(new Request(`https://${host}/${bag}/${newest}`), env)).json()
}

/** Who assessed the door's root: the members of sign('assess:<root>'). */
async function doorAssessments(env, root, host = 'try-fresh-rooms.hypercomb.com') {
  const pool = await sha256Hex(`assess:${root}`)
  const listing = await worker.fetch(new Request(`https://${host}/${pool}/`), env)
  const keys = (await listing.text()).split('\n').filter(Boolean)
  return Promise.all(keys.map(async (key) => (await worker.fetch(new Request(`https://${host}/${pool}/${key}`), env)).json()))
}

test('a try- door names the stamped sandbox root as its one package', async () => {
  const root = 'b'.repeat(64)
  const env = await sandboxEnv({ 'install:try-fresh-rooms': root, 'install:essentials': head })
  const pool = await hostPackagesPool()
  const listing = await worker.fetch(new Request(`https://try-fresh-rooms.hypercomb.com/content/${pool}/`), env)
  assert.equal(listing.status, 200)
  assert.equal(await listing.text(), '00000000\n')
  const member = await worker.fetch(new Request(`https://try-fresh-rooms.hypercomb.com/content/${pool}/00000000`), env)
  assert.equal(await member.text(), `${root}\ntry-fresh-rooms`)
  const site = await sandboxDoor(env)
  assert.equal(site.sandbox, true)
  assert.equal(site.layer, root)
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
  const site = await sandboxDoor(env)
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
async function indexBy(key, roots, createdAt = 1_800_000_100, doors, offerings) {
  const event = { pubkey: hex(schnorr.getPublicKey(key)), created_at: createdAt, kind: 30564, tags: [],
    content: JSON.stringify({ roots, ...(doors ? { doors } : {}), ...(offerings ? { offerings } : {}) }) }
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  event.id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial))))
  event.sig = hex(schnorr.sign(event.id, key))
  return event
}
const kvMap = (values = new Map()) => ({ values, get: async (k) => values.get(k) ?? null, put: async (k, v) => { values.set(k, String(v)) } })

test('one route location follows its selected publisher even if another key is listed first', async () => {
  const otherIndex = await indexBy(assessorKey, { revolucion: 'b'.repeat(64) }, 1_800_000_001,
    { revolucion: ['pluginthematrix.com'] })
  const bindings = { ...ONE_ZONE,
    'revolucion.pluginthematrix.com': { ...ONE_ZONE['revolucion.pluginthematrix.com'],
      publishers: [{ pubkey: assessor, label: 'Other' }, { pubkey, label: 'Jaime', primary: true }] } }
  const { env } = await fixture(undefined, bindings)
  const originalGet = env.HIVES.get
  env.HIVES.get = async key => key === assessor ? JSON.stringify(otherIndex) : originalGet(key)
  const route = 'https://revolucion.pluginthematrix.com'
  const site = await doorMeta(`${route}/`, env)
  assert.equal(site.record.layer, head)
  assert.equal(site.record.pubkey, pubkey, 'the selected publisher, not the first listed')
  const location = await sha256Hex('revolucion.pluginthematrix.com')
  const marker = await worker.fetch(new Request(`${route}/content/${location}/00000000`), env)
  assert.equal((await marker.json()).layer, head)
})

test('writing an index that names assess:<root> lists its signer as an assessor of that root', async () => {
  const root = 'e'.repeat(64)
  const HIVES = kvMap()
  const CONTENT = contentBag()
  const env = { SITE_BINDINGS: '{}', HIVES, CONTENT }
  const url = `https://content.hypercomb.com/${INDEXES}/${assessor}`
  const body = JSON.stringify(await indexBy(assessorKey, { [`assess:${root}`]: 'f'.repeat(64) }))
  const response = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(url, 'PUT', assessorKey) }, body }), env)
  assert.equal(response.status, 201)
  // A member of the root's pool, named by the assessor's key — never a KV list.
  assert(CONTENT.held.has(`${await sha256Hex(`assess:${root}`)}/${assessor}`))
  assert.equal(HIVES.values.get(`assessors:${root}`), undefined)
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
  const CONTENT = contentBag()
  const bytesOf = (record) => new TextEncoder().encode(JSON.stringify(record))
  for (const [sig, record] of records) CONTENT.held.set(sig, bytesOf(record))
  const env = {
    SITE_BINDINGS: JSON.stringify({ 'hypercomb.com': { title: 'Hypercomb', lineage: 'hypercomb', publishers: [{ pubkey, label: 'Jaime', primary: true }] } }),
    HIVES,
    CONTENT,
    SANDBOX_SHELL_ORIGIN: 'https://shell.example',
  }
  // The door names the review and Jev's reading by signature; a reader reads
  // their verdicts from those records.
  const site = await sandboxDoor(env)
  assert.deepEqual([site.review, site.jev], [reviewSig, 'e'.repeat(64)])
  // The KV list from before assessors were a pool still drains in, read only.
  assert.deepEqual((await doorAssessments(env, root)).map((a) => [a.pubkey, a.record, a.verdict]), [[assessor, goodRecord, 'refuse']])
  // A record that assesses another root is not an assessment of this one.
  CONTENT.held.set(goodRecord, bytesOf({ kind: 'module-assessment', root: 'a'.repeat(64), verdict: 'accept' }))
  assert.deepEqual(await doorAssessments(env, root), [])
})

// ── the community's translations: who translated, who is missing what ────
test('writing an index that names agent:harness puts the record it points at into that pool, by signature', async () => {
  const HIVES = kvMap()
  const CONTENT = contentBag()
  const env = { SITE_BINDINGS: '{}', HIVES, CONTENT }
  const url = `https://content.hypercomb.com/${INDEXES}/${assessor}`
  const record = 'b'.repeat(64)
  const body = JSON.stringify(await indexBy(assessorKey, { 'agent:harness': record, 'agent:other': 'c'.repeat(64), 'i18n:ja': 'f'.repeat(64) }))
  const response = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(url, 'PUT', assessorKey) }, body }), env)
  assert.equal(response.status, 201)
  const member = async (meaning, name) => CONTENT.held.has(`${await sha256Hex(meaning)}/${name}`)
  assert.equal(await member('agent:harness', record), true)
  assert.equal(await member('agent:harness', assessor), false)
  assert.equal(await member('agent:other', 'c'.repeat(64)), false)
})

test('writing an index that names i18n:<locale> lists its signer as a translator, and i18n-missing:<locale> as missing', async () => {
  const HIVES = kvMap()
  const CONTENT = contentBag()
  const env = { SITE_BINDINGS: '{}', HIVES, CONTENT }
  const url = `https://content.hypercomb.com/${INDEXES}/${assessor}`
  const body = JSON.stringify(await indexBy(assessorKey, { 'i18n:ja': 'f'.repeat(64), 'i18n-missing:de': 'a'.repeat(64) }))
  const response = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(url, 'PUT', assessorKey) }, body }), env)
  assert.equal(response.status, 201)
  // Members of the locales' pools, named by the key — never KV lists.
  const member = async (meaning, name) => CONTENT.held.has(`${await sha256Hex(meaning)}/${name}`)
  assert.equal(await member('i18n:ja', assessor), true)
  assert.equal(await member('i18n-missing:de', assessor), true)
  assert.equal(await member('i18n:locales', 'ja'), true)
  assert.equal(await member('i18n:locales', 'de'), true)
  assert.equal(HIVES.values.size, 0)
  // The index itself is the member of sign('hive:indexes') named by the key.
  assert.equal(await member('hive:indexes', assessor), true)
})

test('a locale is listed from every verified index, at the pool\'s own address, with the older KV lists drained in', async () => {
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
  const listed = await (await worker.fetch(new Request(`https://content.hypercomb.com/${await sha256Hex('i18n:ja')}`), env)).json()
  assert.deepEqual(listed.meaning, 'i18n:ja')
  assert.deepEqual(listed.members, [catalog])
  assert.deepEqual(listed.translators.map((t) => [t.pubkey, t.label, t.catalog]), [[pubkey, 'Jaime', catalog]])
  assert.deepEqual(listed.missing.map((m) => [m.pubkey, m.record, m.keys]), [[assessor, missingRecord, ['module.jevread', 'module.focuson']]])
  // The pool's own derived address answers the same index — what a published-pool probe fetches.
  const atAddress = await (await worker.fetch(new Request(`https://content.hypercomb.com/${await sha256('i18n:ja')}`), env)).json()
  assert.deepEqual(atAddress.members, [catalog])
  // A locale this host never heard of has no answer at its address; the drain
  // route answers the same bytes as the address while installs still call it.
  assert.equal((await worker.fetch(new Request(`https://content.hypercomb.com/${await sha256Hex('i18n:fr')}`), env)).status, 404)
  const named = await (await worker.fetch(new Request('https://content.hypercomb.com/i18n/ja.json'), env)).json()
  assert.deepEqual(named, atAddress)
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
  const listing = await (await worker.fetch(new Request(`https://hypercomb.com/${TRIALS}`), env)).json()
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
  const fromDoor = await (await worker.fetch(new Request(`https://try-old-rooms.hypercomb.com/${TRIALS}`), env)).json()
  assert.deepEqual(fromDoor.trials.map((t) => t.name), ['try-new-rooms', 'try-old-rooms', 'try-theirs'])
  // A zone whose * route is not up lists nothing: none of its doors can be dialled.
  const offZone = await (await worker.fetch(new Request(`https://hypercomb.com/${TRIALS}`), { ...env, SITE_BINDINGS: zone({ wildcard: false }) })).json()
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
  const url = `https://content.hypercomb.com/${INDEXES}/${assessor}`
  const body = JSON.stringify(await indexBy(assessorKey, { 'try-fresh-rooms': head }))
  const putHive = async (origin) => {
    const env = { SITE_BINDINGS: '{}', HIVES: kvMap(), CONTENT: contentBag() }
    const headers = { authorization: await nip98(url, 'PUT', assessorKey), ...(origin ? { origin } : {}) }
    const response = await worker.fetch(new Request(url, { method: 'PUT', headers, body }), env)
    return { status: response.status, text: await response.text(), written: env.CONTENT.held.has(`${INDEXES}/${assessor}`) }
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
  const url = `https://content.hypercomb.com/${INDEXES}/${assessor}`
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

// ── the guest list is a pool of meaning ───────────────────────────────────
// Each key's grant is the member of sign('host:grants') named by the key; the
// old KV namespace is only read, and a row it alone holds moves into the pool.
const textHeap = (objects = new Map()) => ({
  objects,
  get: async (k) => objects.has(k) ? { text: async () => objects.get(k), arrayBuffer: async () => new TextEncoder().encode(objects.get(k)).buffer } : null,
  head: async (k) => objects.has(k) ? { size: objects.get(k).length, httpMetadata: {} } : null,
  put: async (k, body, o) => {
    if (o?.onlyIf && objects.has(k)) return null
    objects.set(k, typeof body === 'string' ? body : new TextDecoder().decode(body))
    return {}
  },
})

test('an upload records its grant in the host:grants pool, never in KV', async () => {
  const GRANTS_POOL = await sha256Hex('host:grants')
  const kv = kvMap()
  const content = textHeap()
  const env = { SITE_BINDINGS: '{}', CONTENT: content, GRANTS: kv }
  const bytes = 'a guest upload'
  const url = `https://content.hypercomb.com/${await sha256Hex(bytes)}`
  const res = await worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(url, 'PUT') }, body: bytes }), env)
  assert.equal(res.status, 201)
  const row = JSON.parse(content.objects.get(`${GRANTS_POOL}/${pubkey}`))
  assert.equal(row.usedBytes, bytes.length)
  assert.equal(kv.values.size, 0)
  // The member is not a public read: the flat path answers by signature only.
  const probe = await worker.fetch(new Request(`https://content.hypercomb.com/${GRANTS_POOL}/${pubkey}`), env)
  assert.notEqual(await probe.text(), content.objects.get(`${GRANTS_POOL}/${pubkey}`))
})

test('a grant only KV holds is read, and carried into the pool', async () => {
  const GRANTS_POOL = await sha256Hex('host:grants')
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const kv = kvMap(new Map([[pubkey, JSON.stringify({ quotaBytes: 500, usedBytes: 120, expiresAt })]]))
  const content = textHeap()
  const env = { SITE_BINDINGS: '{}', CONTENT: content, GRANTS: kv }
  const url = 'https://content.hypercomb.com/grant'
  const res = await worker.fetch(new Request(url, { headers: { authorization: await nip98(url, 'GET') } }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { state: 'active', quotaBytes: 500, usedBytes: 120, expiresAt })
  assert.deepEqual(JSON.parse(content.objects.get(`${GRANTS_POOL}/${pubkey}`)), { quotaBytes: 500, usedBytes: 120, expiresAt })
})

test('the AI meter keeps one row per key, in the host:ai-meters pool', async () => {
  const METERS = await sha256Hex('host:ai-meters')
  const content = textHeap()
  const kv = kvMap()
  const env = { SITE_BINDINGS: JSON.stringify(ONE_ZONE), ANTHROPIC_API_KEY: 'test', CONTENT: content, GRANTS: kv }
  const url = 'https://content.pluginthematrix.com/ai/ask'
  const ask = async () => worker.fetch(new Request(url, {
    method: 'POST', headers: { authorization: await nip98(url, 'POST'), 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'what is here?', stream: false }),
  }), env)
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'tiles' }] }), { headers: { 'content-type': 'application/json' } })
  try {
    assert.equal((await ask()).status, 200)
    const first = JSON.parse(content.objects.get(`${METERS}/${pubkey}`))
    assert.equal(first.day, new Date().toISOString().slice(0, 10).replace(/-/g, ''))
    assert.ok(first.used > 0)
    assert.equal((await ask()).status, 200)
    assert.equal(JSON.parse(content.objects.get(`${METERS}/${pubkey}`)).used, first.used * 2)
    assert.equal(kv.values.size, 0)
  } finally { globalThis.fetch = original }
})

// ── the landing pack ──────────────────────────────────────────────────────
// A door serves its head's first view as ONE transfer pack at
// /<sign('content:packs')>/<head>: small members a short walk below the head,
// built once and kept; pictures stay loose; only the door's own head is built.
test('a door packs its head\'s landing view, keeps it, and builds nothing else', async () => {
  const { decodeTransferPack, gunzipBytes } = await import('../../hypercomb-runtime/src/transfer-pack.ts')
  const host = 'landing.pluginthematrix.com'
  const enc = (text) => new TextEncoder().encode(text)
  const child = enc('{"name":"child","cells":[]}')
  const childSig = await sha256Hex('{"name":"child","cells":[]}')
  const picture = new Uint8Array(40_000).fill(7)
  const pictureSig = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', picture)))
  const headText = JSON.stringify({ name: 'home', cells: [childSig], image: pictureSig })
  const headSig = await sha256Hex(headText)
  const held = new Map([[headSig, enc(headText)], [childSig, child], [pictureSig, picture]])
  const bag = await sha256Hex(host)
  held.set(`${bag}/00000001`, enc(JSON.stringify({ layer: headSig })))
  const CONTENT = contentBag(held)
  const env = { SITE_BINDINGS: '{}', CONTENT }
  const PACKS = await sha256Hex('content:packs')
  const ask = (sig) => worker.fetch(new Request(`https://${host}/${PACKS}/${sig}`), env)

  const res = await ask(headSig)
  assert.equal(res.status, 200)
  const members = new Map(decodeTransferPack(await gunzipBytes(new Uint8Array(await res.arrayBuffer()))))
  assert.deepEqual([...members.keys()].sort(), [headSig, childSig].sort())
  assert.equal(new TextDecoder().decode(members.get(childSig)), '{"name":"child","cells":[]}')
  assert.ok(held.has(`${PACKS}/${headSig}`), 'the pack is kept')

  // Kept: served again with the heap gone.
  held.delete(childSig)
  assert.equal((await ask(headSig)).status, 200)
  // Only the door's own head is ever built.
  assert.equal((await ask(childSig)).status, 404)
  assert.ok(!held.has(`${PACKS}/${childSig}`))
})

// ── claiming a domain (documentation/domain-claim.md) ─────────────────────
// `domain claim <name>`: the worker makes the zone, the participant moves the
// nameservers, the first active reading wires the domain to the forwarder,
// and an active claim is a binding exactly as an operator would write it.
const CLAIMS = await sha256Hex('host:claims')
const DOMAIN = 'inspiredbyhumans.org'
const NAMESERVERS = ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']
const DAY = 86_400
const keyOf = (n) => Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? n : 0)
const pubOf = (key) => hex(schnorr.getPublicKey(key))
const enc = (text) => new TextEncoder().encode(text)
const ago = (secs) => Math.floor(Date.now() / 1000) - secs

/** The Cloudflare API, as much of it as a claim uses — zones, their DNS
 *  records, their worker routes — held in memory, and the public resolver
 *  (DoH) that says where a domain is delegated. Every API call is logged. */
function fakeCloudflare({ zones = [] } = {}) {
  const cf = { zones: new Map(), records: [], routes: [], calls: [], created: [], deleted: [], lookups: [], elsewhere: [],
    dns: [], delegated: new Set(), dnsDown: false, fail: null, next: 1 }
  const id = () => (cf.next++).toString(16).padStart(32, '0')
  for (const name of zones) cf.zones.set(id(), { name, status: 'active', name_servers: ['x.ns.cloudflare.com'] })
  const ok = (result) => Response.json({ success: true, errors: [], result })
  const no = (status, code) => Response.json({ success: false, errors: [{ code, message: 'secret upstream detail' }], result: null }, { status })
  cf.zoneOf = (name) => [...cf.zones].find(([, zone]) => zone.name === name)?.[0]
  cf.activate = (name) => { cf.zones.get(cf.zoneOf(name)).status = 'active' }
  cf.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = String(init.method || 'GET').toUpperCase()
    if (url.origin === 'https://cloudflare-dns.com') {
      const name = url.searchParams.get('name')
      assert.equal(url.searchParams.get('type'), 'NS')
      cf.dns.push(name)
      if (cf.dnsDown) return new Response('resolver down', { status: 502 })
      const servers = cf.delegated.has(name) ? NAMESERVERS : ['ns1.registrar.example']
      return Response.json({ Status: 0, Answer: servers.map((ns) => ({ name: `${name}.`, type: 2, data: `${ns}.` })) })
    }
    if (url.origin !== 'https://api.cloudflare.com') {
      cf.elsewhere.push(url.href)
      return new Response('host card', { headers: { 'content-type': 'text/html' } })
    }
    assert.ok(url.pathname.startsWith('/client/v4/'))
    const path = url.pathname.slice('/client/v4'.length)
    cf.calls.push(`${method} ${path}`)
    if (new Headers(init.headers).get('authorization') !== 'Bearer cf-token') return no(403, 10000)
    if (cf.fail && cf.fail(method, path)) return no(500, 9999)
    const body = init.body ? JSON.parse(init.body) : null
    const [, zid, kind, sub, rid] = path.split('/').filter(Boolean)
    if (!zid) {
      if (method === 'GET') {
        cf.lookups.push(Object.fromEntries(url.searchParams))
        return ok([...cf.zones].filter(([, z]) => z.name === url.searchParams.get('name')).map(([id, z]) => ({ id, ...z })))
      }
      if (cf.zoneOf(body.name)) return no(400, 1061)
      cf.created.push(body)
      const zone = { name: body.name, status: 'pending', name_servers: NAMESERVERS }
      const zoneId = id()
      cf.zones.set(zoneId, zone)
      return ok({ id: zoneId, ...zone })
    }
    if (!cf.zones.has(zid)) return no(404, 1001)
    if (!kind) {
      if (method === 'DELETE') { cf.zones.delete(zid); cf.deleted.push(zid); return ok({ id: zid }) }
      return ok({ id: zid, ...cf.zones.get(zid) })
    }
    if (kind === 'activation_check') return ok({ id: zid })
    if (kind === 'dns_records') {
      if (method === 'GET') return ok(cf.records.filter((r) => r.zone === zid && r.name === url.searchParams.get('name')))
      if (method === 'POST') { cf.records.push({ id: id(), zone: zid, ...body }); return ok(cf.records.at(-1)) }
      const record = cf.records.find((r) => r.id === sub)
      Object.assign(record, body)
      return ok(record)
    }
    if (kind === 'workers' && sub === 'routes') {
      if (method === 'GET') return ok(cf.routes.filter((r) => r.zone === zid).map(({ zone, ...r }) => r))
      if (method === 'POST') { cf.routes.push({ id: id(), zone: zid, ...body }); return ok(cf.routes.at(-1)) }
      Object.assign(cf.routes.find((r) => r.id === rid), body)
      return ok({ id: rid })
    }
    return no(404, 7000)
  }
  return cf
}

const claimEnv = (extra = {}) => ({
  SITE_BINDINGS: JSON.stringify(ONE_ZONE),
  CF_ACCOUNT_ID: 'acct', CLAIM_API_TOKEN: 'cf-token', CLAIM_SCRIPT: 'hypercomb-hosts',
  CONTENT: contentBag(),
  ...extra,
})
const CLAIM_URL = 'https://content.pluginthematrix.com/claim'
/** NIP-98 as the hive signs it: the method, the URL and — for a body — the
 *  body's sha256 in a `payload` tag. */
async function signedAuth(url, method, key = sk, body) {
  const tags = [['u', url], ['method', method], ...(typeof body === 'string' ? [['payload', await sha256Hex(body)]] : [])]
  const event = { pubkey: pubOf(key), created_at: Math.floor(Date.now() / 1000), kind: 27235, tags, content: '' }
  event.id = await sha256Hex(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
  event.sig = hex(schnorr.sign(event.id, key))
  return 'Nostr ' + btoa(JSON.stringify(event))
}
/** A claim. `signed` is the body the signature names (null: no payload tag). */
async function claim(env, domain, key = sk, { method = 'POST', body, signed, ctx } = {}) {
  const sent = body ?? JSON.stringify({ domain })
  return worker.fetch(new Request(CLAIM_URL, { method: 'POST',
    headers: { authorization: await signedAuth(CLAIM_URL, method, key, signed === undefined ? sent : signed), 'content-type': 'application/json' },
    body: sent }), env, ctx)
}
/** A claim's public reading — signed (NIP-98, GET) when a key is given. */
async function lookAt(env, domain, key) {
  const url = `https://content.pluginthematrix.com/claim/${domain}`
  return worker.fetch(new Request(url, key ? { headers: { authorization: await signedAuth(url, 'GET', key) } } : {}), env)
}
const statusOf = async (response) => (await response.json()).status
async function onCloudflare(cf, run) {
  const original = globalThis.fetch
  globalThis.fetch = cf.fetch
  try { return await run() } finally { globalThis.fetch = original }
}
/** Run as if `ms` had passed: every isolate-held view has gone stale. */
async function later(ms, run) {
  const real = Date.now
  Date.now = () => real() + ms
  try { return await run() } finally { Date.now = real }
}
const claimAt = async (domain) => `${CLAIMS}/${await sha256Hex(domain)}`
const claimRecordOf = async (env, domain) => {
  const bytes = env.CONTENT.held.get(await claimAt(domain))
  return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
}
/** A record as the operator (or an older run) left it in the pool. */
const keepClaim = async (env, record) => env.CONTENT.held.set(await claimAt(record.domain), enc(JSON.stringify({
  v: 1, zoneId: '0'.repeat(32), nameservers: NAMESERVERS, status: 'active', claimedAt: 1, activatedAt: 2, ...record })))
/** A record's fields set by hand — its clocks moved back, or an operator's edit. */
const rewind = async (env, domain, fields) => env.CONTENT.held.set(await claimAt(domain),
  enc(JSON.stringify({ ...await claimRecordOf(env, domain), ...fields })))
const holdIndex = (env, event) => env.CONTENT.held.set(`${INDEXES}/${event.pubkey}`, enc(JSON.stringify(event)))
const publicationsAt = async (env, host) => (await worker.fetch(new Request(`https://${host}/${PUBLICATIONS}`), env)).text()

test('a claim makes the zone, keeps the record in host:claims, and answers the two nameservers', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    const first = await claim(env, 'InspiredByHumans.org')
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), { domain: DOMAIN, status: 'pending', nameservers: NAMESERVERS })
    // The same key asking again is the claim as it stands: no second zone.
    const again = await claim(env, DOMAIN)
    assert.equal(again.status, 200)
    assert.deepEqual(await again.json(), { domain: DOMAIN, status: 'pending', nameservers: NAMESERVERS })
  })
  assert.deepEqual(cf.created, [{ name: DOMAIN, account: { id: 'acct' }, type: 'full', jump_start: true }])
  assert.deepEqual(cf.lookups, [{ name: DOMAIN, 'account.id': 'acct' }])
  const record = await claimRecordOf(env, DOMAIN)
  assert.deepEqual({ ...record, claimedAt: 0 }, { v: 1, domain: DOMAIN, pubkey, zoneId: cf.zoneOf(DOMAIN),
    nameservers: NAMESERVERS, status: 'pending', claimedAt: 0 })
  assert.ok(Math.abs(record.claimedAt - Date.now() / 1000) < 60)
})

test('a claim names a domain, strictly, before any call or write', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  const bad = ['org', 'https://inspiredbyhumans.org', 'inspiredbyhumans.org:443', 'inspiredbyhumans.org/x',
    'inspiredbyhumans.org.', '-x.org', 'x_y.org', 'x..org', ' x.org', 'x .org', '10.0.0.1',
    `${'a'.repeat(64)}.org`, `${'a.'.repeat(126)}org`, 'x.o', 'x.org\n', 42, null]
  await onCloudflare(cf, async () => {
    for (const domain of bad) assert.equal((await claim(env, domain)).status, 400, String(domain))
    assert.equal((await claim(env, DOMAIN, sk, { body: 'not json' })).status, 400)
    for (const path of ['org', 'x_y.org', '%2Fx.org', '%E0%A4%A']) assert.equal((await lookAt(env, path)).status, 400, path)
  })
  assert.deepEqual(cf.calls, [])
  assert.equal(env.CONTENT.held.size, 0)
})

test('a claim\'s signature covers its body: a header lifted from one claim never names another domain', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    // Signed for one body, sent with another.
    const lifted = await claim(env, 'attacker-choice.com', sk, { signed: JSON.stringify({ domain: DOMAIN }) })
    assert.equal(lifted.status, 401)
    assert.match(await lifted.text(), /payload/)
    // No payload tag at all: refused the same way.
    assert.equal((await claim(env, DOMAIN, sk, { signed: null })).status, 401)
  })
  assert.deepEqual(cf.calls, [])
  assert.equal(env.CONTENT.held.size, 0)
})

test('a domain served here is refused — equal to, under, or holding a bound zone or an operated one', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({
    SITE_BINDINGS: JSON.stringify({ ...ONE_ZONE, 'shop.held.org': { title: 'Shop', lineage: 'shop', publishers: [{ pubkey, primary: true }] } }),
    SITE_OPERATORS: JSON.stringify({ 'operated.org': pubkey }),
  })
  await onCloudflare(cf, async () => {
    for (const domain of ['pluginthematrix.com', 'blog.pluginthematrix.com', 'revolucion.pluginthematrix.com', 'held.org', 'operated.org', 'www.operated.org']) {
      const refused = await claim(env, domain)
      assert.equal(refused.status, 409, domain)
      assert.match(await refused.text(), /already served here/)
    }
  })
  assert.deepEqual(cf.calls, [])
})

test('a claim on a domain the operator came to serve by hand never activates, and asks Cloudflare nothing', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    // Afterwards the operator binds the domain by hand, and its owner moves the nameservers.
    const served = { ...env, SITE_BINDINGS: JSON.stringify({ ...ONE_ZONE,
      [DOMAIN]: { title: 'By hand', lineage: 'ibh', publishers: [{ pubkey, primary: true }] } }) }
    cf.activate(DOMAIN)
    const from = cf.calls.length
    const read = await lookAt(served, DOMAIN)
    assert.equal(read.status, 409)
    assert.match(await read.text(), /already served here/)
    assert.deepEqual(cf.calls.slice(from), [])
  })
  assert.equal((await claimRecordOf(env, DOMAIN)).status, 'pending')
  assert.deepEqual([cf.routes, cf.records], [[], []])
})

test('a zone whose routes another worker holds is never wired, and a claim never takes its route', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    // The operator ran `connect` on the claim's zone: its route goes to the main worker.
    cf.routes.push({ id: 'by-hand', zone: cf.zoneOf(DOMAIN), pattern: `*.${DOMAIN}/*`, script: 'pluginthematrix-core' })
    cf.activate(DOMAIN)
    const from = cf.calls.length
    const read = await lookAt(env, DOMAIN)
    assert.equal(read.status, 409)
    assert.match(await read.text(), /routes belong to another worker/)
    const z = cf.zoneOf(DOMAIN)
    assert.deepEqual(cf.calls.slice(from), [`GET /zones/${z}`, `GET /zones/${z}/workers/routes`])
  })
  assert.deepEqual(cf.routes.map(({ pattern, script }) => ({ pattern, script })), [{ pattern: `*.${DOMAIN}/*`, script: 'pluginthematrix-core' }])
  assert.deepEqual(cf.records, [])
  assert.equal((await claimRecordOf(env, DOMAIN)).status, 'pending')
})

test('a zone the account already holds is never adopted by a claim', async () => {
  const cf = fakeCloudflare({ zones: ['taken.org'] })
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    const refused = await claim(env, 'taken.org')
    assert.equal(refused.status, 409)
    assert.match(await refused.text(), /ask this host's operator/)
  })
  assert.deepEqual(cf.created, [])
  assert.equal(await claimRecordOf(env, 'taken.org'), null)
})

test('without the token or the account the host takes no claims, and an unsigned claim is refused', async () => {
  const cf = fakeCloudflare()
  await onCloudflare(cf, async () => {
    assert.equal((await claim(claimEnv({ CLAIM_API_TOKEN: undefined }), DOMAIN)).status, 503)
    assert.equal((await claim(claimEnv({ CF_ACCOUNT_ID: undefined }), DOMAIN)).status, 503)
    const env = claimEnv()
    const unsigned = await worker.fetch(new Request(CLAIM_URL, { method: 'POST', body: JSON.stringify({ domain: DOMAIN }) }), env)
    assert.equal(unsigned.status, 401)
    assert.equal((await claim(env, DOMAIN, sk, { method: 'PUT' })).status, 401)
    // A claim is taken on the write face, never on a published site.
    const onSite = 'https://revolucion.pluginthematrix.com/claim'
    assert.equal((await worker.fetch(new Request(onSite, { method: 'POST',
      headers: { authorization: await nip98(onSite, 'POST') }, body: JSON.stringify({ domain: DOMAIN }) }), env)).status, 405)
  })
  assert.deepEqual(cf.calls, [])
})

test('a Cloudflare refusal is a short 502 — never the token, never the upstream body', async () => {
  const cf = fakeCloudflare()
  cf.fail = (method, path) => method === 'POST' && path === '/zones'
  const env = claimEnv()
  const refused = await onCloudflare(cf, () => claim(env, DOMAIN))
  assert.equal(refused.status, 502)
  const said = await refused.text() + refused.headers.get('x-reason')
  assert.match(said, /create the zone \(500, code 9999\)/)
  assert.doesNotMatch(said, /cf-token|secret upstream detail/)
  assert.equal(await claimRecordOf(env, DOMAIN), null)
})

test('a zone whose record cannot be written is taken back, and the act outlives a dropped connection', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  const put = env.CONTENT.put
  env.CONTENT.put = async (key, ...rest) => {
    if (key.startsWith(`${CLAIMS}/`)) throw new Error('R2 put failed')
    return put(key, ...rest)
  }
  const kept = []
  const answer = await onCloudflare(cf, () => claim(env, DOMAIN, sk, { ctx: { waitUntil: (promise) => kept.push(promise) } }))
  assert.equal(answer.status, 502)
  assert.match(await answer.text(), /could not be recorded/)
  assert.equal(cf.created.length, 1)
  assert.equal(cf.deleted.length, 1)
  assert.equal(cf.zoneOf(DOMAIN), undefined)
  assert.equal(kept.length, 1)
})

test('an active claim is refused to every other key', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    cf.activate(DOMAIN)
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    const other = await claim(env, DOMAIN, keyOf(3))
    assert.equal(other.status, 409)
    assert.match(await other.text(), /claimed/)
    assert.deepEqual(await (await claim(env, DOMAIN)).json(), { domain: DOMAIN, status: 'active', nameservers: NAMESERVERS })
  })
  assert.equal((await claimRecordOf(env, DOMAIN)).pubkey, pubkey)
})

test('a second key on a pending claim contests it, and nobody is bound until the operator decides', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({ HOST_DOOR_ORIGIN: 'https://door.example' })
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    const contest = await claim(env, DOMAIN, keyOf(3))
    assert.equal(contest.status, 200)
    assert.deepEqual(await contest.json(), { domain: DOMAIN, status: 'contested', nameservers: NAMESERVERS })
    // Each side asking again reads the claim as it stands.
    assert.equal(await statusOf(await claim(env, DOMAIN)), 'contested')
    assert.equal(await statusOf(await claim(env, DOMAIN, keyOf(3))), 'contested')
    // The nameservers moving binds nobody and wires nothing.
    cf.activate(DOMAIN)
    const before = cf.calls.length
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'contested')
    assert.equal(cf.calls.length, before)
    const apex = await worker.fetch(new Request(`https://${DOMAIN}/`), env)
    assert.match(await apex.text(), /public content endpoint/)
    assert.deepEqual(cf.elsewhere, [])
  })
  const record = await claimRecordOf(env, DOMAIN)
  assert.equal(record.pubkey, pubkey)
  assert.deepEqual(record.contested, [pubOf(keyOf(3))])
})

test('a contest records a handful of keys, never a growing list', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    for (let n = 3; n < 43; n++) assert.equal(await statusOf(await claim(env, DOMAIN, keyOf(n))), 'contested')
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'contested')
  })
  assert.equal((await claimRecordOf(env, DOMAIN)).contested.length, 8)
  assert.ok(env.CONTENT.held.get(await claimAt(DOMAIN)).byteLength < 2_048)
})

test('a contest lapses too: its keys are free again, and a domain nobody delegated can be taken', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    await claim(env, DOMAIN, keyOf(3))
    // While it is fresh — counted from the contest, not the claim — both sides wait on it.
    await rewind(env, DOMAIN, { claimedAt: ago(20 * DAY), contestedAt: ago(DAY) })
    assert.equal((await claim(env, 'other.org')).status, 409)
    assert.equal((await claim(env, 'other.org', keyOf(3))).status, 409)
    await rewind(env, DOMAIN, { contestedAt: ago(8 * DAY) })
    assert.equal((await claim(env, 'other.org')).status, 200)
    assert.equal((await claim(env, 'another.org', keyOf(3))).status, 200)
    // Nobody moved the nameservers: a third key takes the domain and its zone.
    assert.equal(await statusOf(await claim(env, DOMAIN, keyOf(4))), 'pending')
  })
  const record = await claimRecordOf(env, DOMAIN)
  assert.deepEqual([record.pubkey, record.contested, record.zoneId], [pubOf(keyOf(4)), undefined, cf.zoneOf(DOMAIN)])
})

test('a contested domain whose nameservers moved stays the operator\'s to decide, however old', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    await claim(env, DOMAIN, keyOf(3))
    await rewind(env, DOMAIN, { claimedAt: ago(400 * DAY), contestedAt: ago(400 * DAY) })
    cf.activate(DOMAIN)
    const third = await claim(env, DOMAIN, keyOf(4))
    assert.equal(third.status, 409)
    assert.match(await third.text(), /contested/)
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'contested')
    // A lapsed contest bars neither side from claiming elsewhere.
    assert.equal((await claim(env, 'other.org', keyOf(3))).status, 200)
  })
  assert.deepEqual(cf.routes, [])
  assert.deepEqual((await claimRecordOf(env, DOMAIN)).contested, [pubOf(keyOf(3))])
})

test('a pending claim lapses after seven days, and the next key takes it with its zone', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    await rewind(env, DOMAIN, { claimedAt: ago(8 * DAY) })
    const taken = await claim(env, DOMAIN, keyOf(3))
    assert.equal(taken.status, 200)
    assert.deepEqual(await taken.json(), { domain: DOMAIN, status: 'pending', nameservers: NAMESERVERS })
  })
  const record = await claimRecordOf(env, DOMAIN)
  assert.equal(record.pubkey, pubOf(keyOf(3)))
  assert.equal(record.zoneId, cf.zoneOf(DOMAIN))
  assert.equal(record.contested, undefined)
  assert.equal(cf.created.length, 1)
  // The public DNS was asked first, and showed the domain delegated elsewhere.
  assert.deepEqual(cf.dns, [DOMAIN])
})

test('a lapsed claim whose holder already moved the nameservers is never taken', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    await rewind(env, DOMAIN, { claimedAt: ago(7 * DAY + 60) })
    // The registrar change landed; Cloudflare has not looked, so the zone still reads pending.
    cf.delegated.add(DOMAIN)
    const taken = await claim(env, DOMAIN, keyOf(3))
    assert.equal(taken.status, 409)
    assert.match(await taken.text(), /already points at this host/)
    // A resolver that does not answer hands nothing over either.
    cf.delegated.delete(DOMAIN)
    cf.dnsDown = true
    assert.equal((await claim(env, DOMAIN, keyOf(3))).status, 502)
  })
  const record = await claimRecordOf(env, DOMAIN)
  assert.deepEqual([record.pubkey, record.status], [pubkey, 'pending'])
})

test('a lapsed claim whose nameservers moved stays its holder\'s', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    await rewind(env, DOMAIN, { claimedAt: 1 })
    cf.activate(DOMAIN)
    assert.equal((await claim(env, DOMAIN, keyOf(3))).status, 409)
  })
  const record = await claimRecordOf(env, DOMAIN)
  assert.deepEqual([record.pubkey, record.status], [pubkey, 'active'])
  assert.equal(cf.routes.length, 2)
})

test('one pending claim per key, and a cap on the claims waiting', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({ CLAIM_PENDING_MAX: '2' })
  await onCloudflare(cf, async () => {
    assert.equal((await claim(env, 'first.org')).status, 200)
    const second = await claim(env, 'second.org')
    assert.equal(second.status, 409)
    assert.match(await second.text(), /already has a claim pending/)
    assert.equal((await claim(env, 'other.org', keyOf(3))).status, 200)
    const capped = await claim(env, 'third.org', keyOf(4))
    assert.equal(capped.status, 429)
    // A settled claim frees its key, and its place under the cap.
    cf.activate('first.org')
    assert.equal(await statusOf(await lookAt(env, 'first.org')), 'active')
    assert.equal((await claim(env, 'second.org')).status, 200)
  })
  assert.deepEqual(cf.created.map((zone) => zone.name), ['first.org', 'other.org', 'second.org'])
})

test('every claim still waiting counts against the cap — a contest frees no room', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({ CLAIM_PENDING_MAX: '1' })
  await onCloudflare(cf, async () => {
    assert.equal((await claim(env, 'spam0.com', keyOf(10))).status, 200)
    assert.equal(await statusOf(await claim(env, 'spam0.com', keyOf(11))), 'contested')
    assert.equal((await claim(env, 'spam1.com', keyOf(12))).status, 429)
    assert.equal((await claim(env, 'spam1.com', keyOf(13))).status, 429)
  })
  assert.deepEqual(cf.created.map((zone) => zone.name), ['spam0.com'])
})

test('a lapsed claim that never went live makes room under the cap, its zone deleted with it', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({ CLAIM_PENDING_MAX: '1' })
  await onCloudflare(cf, async () => {
    await claim(env, 'abandoned.org', keyOf(10))
    const zone = cf.zoneOf('abandoned.org')
    await rewind(env, 'abandoned.org', { claimedAt: ago(8 * DAY) })
    assert.equal((await claim(env, DOMAIN, keyOf(11))).status, 200)
    assert.deepEqual(cf.deleted, [zone])
    assert.deepEqual(cf.dns, ['abandoned.org'])
  })
  assert.equal(await claimRecordOf(env, 'abandoned.org'), null)
  assert.equal((await claimRecordOf(env, DOMAIN)).status, 'pending')
  assert.deepEqual(cf.created.map((zone) => zone.name), ['abandoned.org', DOMAIN])
})

test('a lapsed claim whose domain points here, or whose zone went live, is never pruned', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({ CLAIM_PENDING_MAX: '2' })
  await onCloudflare(cf, async () => {
    await claim(env, 'slow.org', keyOf(10))
    await claim(env, 'live.org', keyOf(11))
    await rewind(env, 'slow.org', { claimedAt: ago(8 * DAY) })
    await rewind(env, 'live.org', { claimedAt: ago(9 * DAY) })
    cf.delegated.add('slow.org')
    cf.activate('live.org')
    assert.equal((await claim(env, DOMAIN, keyOf(12))).status, 429)
    // Each was looked at once: another claim inside five minutes asks Cloudflare nothing.
    const calls = cf.calls.length
    assert.equal((await claim(env, 'other.org', keyOf(13))).status, 429)
    assert.equal(cf.calls.length, calls)
  })
  assert.deepEqual(cf.deleted, [])
  assert.equal((await claimRecordOf(env, 'slow.org')).pubkey, pubOf(keyOf(10)))
  assert.equal((await claimRecordOf(env, 'live.org')).pubkey, pubOf(keyOf(11)))
})

test('reading a claim never says who claimed it', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    const read = await lookAt(env, DOMAIN)
    assert.equal(read.status, 200)
    assert.equal(read.headers.get('cache-control'), 'no-store')
    const body = await read.text()
    assert.deepEqual(Object.keys(JSON.parse(body)), ['domain', 'status', 'nameservers'])
    assert.ok(!body.includes(pubkey) && !body.includes(cf.zoneOf(DOMAIN)))
    assert.equal((await lookAt(env, 'nobody.org')).status, 404)
  })
})

test('a reader who signs is told whether the claim is theirs — and still never whose it is', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    assert.deepEqual(await (await lookAt(env, DOMAIN, sk)).json(), { domain: DOMAIN, status: 'pending', nameservers: NAMESERVERS, mine: true })
    const theirs = await (await lookAt(env, DOMAIN, keyOf(3))).text()
    assert.deepEqual(JSON.parse(theirs), { domain: DOMAIN, status: 'pending', nameservers: NAMESERVERS, mine: false })
    assert.ok(!theirs.includes(pubkey))
    // A signature for another method, or none that verifies, is refused — never read as anonymous.
    const url = `https://content.pluginthematrix.com/claim/${DOMAIN}`
    assert.equal((await worker.fetch(new Request(url, { headers: { authorization: await signedAuth(url, 'POST') } }), env)).status, 401)
    assert.equal((await worker.fetch(new Request(url, { headers: { authorization: 'Nostr bm9wZQ==' } }), env)).status, 401)
  })
})

test('a public reading asks Cloudflare once per look, however many read it', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    const z = cf.zoneOf(DOMAIN)
    const from = cf.calls.length
    for (let i = 0; i < 20; i++) assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'pending')
    assert.deepEqual(cf.calls.slice(from), [`GET /zones/${z}`, `PUT /zones/${z}/activation_check`])
    // Five minutes on, one more look — and no second activation check inside the hour.
    await rewind(env, DOMAIN, { lookedAt: ago(301) })
    for (let i = 0; i < 20; i++) await lookAt(env, DOMAIN)
    assert.deepEqual(cf.calls.slice(from + 2), [`GET /zones/${z}`])
    // Active: twenty readings inside the hour ask nothing at all.
    cf.activate(DOMAIN)
    await rewind(env, DOMAIN, { lookedAt: ago(301) })
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    const wired = cf.calls.length
    for (let i = 0; i < 20; i++) assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    assert.equal(cf.calls.length, wired)

    // A failing API is asked once per look too; between looks the record answers.
    await claim(env, 'failing.org', keyOf(5))
    const failing = cf.zoneOf('failing.org')
    cf.fail = (method, path) => path === `/zones/${failing}`
    const before = cf.calls.length
    assert.equal((await lookAt(env, 'failing.org')).status, 502)
    for (let i = 0; i < 19; i++) assert.equal(await statusOf(await lookAt(env, 'failing.org')), 'pending')
    assert.deepEqual(cf.calls.slice(before), [`GET /zones/${failing}`])
  })
})

test('the first active reading wires the domain; a later look puts back what went missing, and never takes a route', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  const shape = () => cf.routes.map(({ pattern, script }) => ({ pattern, script }))
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN)
    const z = cf.zoneOf(DOMAIN)
    // jump_start kept the apex's own record (unproxied) and its mail.
    cf.records.push({ id: 'apex-a', zone: z, type: 'A', name: DOMAIN, content: '192.0.2.10', proxied: false },
      { id: 'apex-mx', zone: z, type: 'MX', name: DOMAIN, content: `mail.${DOMAIN}` })
    // Pending: Cloudflare is asked to check at most once an hour, whatever the looks.
    const checks = () => cf.calls.filter((call) => call.endsWith('/activation_check')).length
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'pending')
    await rewind(env, DOMAIN, { lookedAt: ago(301) })
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'pending')
    assert.equal(checks(), 1)
    await rewind(env, DOMAIN, { lookedAt: ago(301), checkedAt: ago(7200) })
    await lookAt(env, DOMAIN)
    assert.equal(checks(), 2)
    assert.equal(cf.routes.length, 0)

    cf.activate(DOMAIN)
    await rewind(env, DOMAIN, { lookedAt: ago(301) })
    const from = cf.calls.length
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    assert.deepEqual(cf.calls.slice(from), [
      `GET /zones/${z}`,
      `GET /zones/${z}/workers/routes`,
      `GET /zones/${z}/dns_records`, `PATCH /zones/${z}/dns_records/apex-a`,
      `GET /zones/${z}/dns_records`, `POST /zones/${z}/dns_records`,
      `POST /zones/${z}/workers/routes`, `POST /zones/${z}/workers/routes`,
    ])
    assert.equal(cf.records.find((r) => r.id === 'apex-a').proxied, true)
    assert.deepEqual(cf.records.filter((r) => r.type === 'AAAA').map(({ name, content, proxied }) => ({ name, content, proxied })),
      [{ name: `*.${DOMAIN}`, content: '100::', proxied: true }])
    assert.deepEqual(shape(), [{ pattern: `${DOMAIN}/*`, script: 'hypercomb-hosts' }, { pattern: `*.${DOMAIN}/*`, script: 'hypercomb-hosts' }])
    assert.equal(typeof (await claimRecordOf(env, DOMAIN)).activatedAt, 'number')

    // Inside the hour a reading asks nothing.
    const quiet = cf.calls.length
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    assert.equal(cf.calls.length, quiet)

    // An hour on, everything lost comes back: a route, the `*` record, the apex's proxy.
    cf.routes.splice(1, 1)
    cf.records.splice(cf.records.findIndex((r) => r.name === `*.${DOMAIN}`), 1)
    cf.records.find((r) => r.id === 'apex-a').proxied = false
    await rewind(env, DOMAIN, { lookedAt: ago(3601) })
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    assert.deepEqual(shape(), [{ pattern: `${DOMAIN}/*`, script: 'hypercomb-hosts' }, { pattern: `*.${DOMAIN}/*`, script: 'hypercomb-hosts' }])
    assert.equal(cf.records.find((r) => r.id === 'apex-a').proxied, true)
    assert.deepEqual(cf.records.filter((r) => r.type === 'AAAA').map(({ name, proxied }) => [name, proxied]), [[`*.${DOMAIN}`, true]])
    assert.equal(cf.records.length, 3)

    // A route another script holds is never taken: the look stops there.
    cf.routes[0].script = 'someone-else'
    cf.routes.splice(1, 1)
    await rewind(env, DOMAIN, { lookedAt: ago(3601) })
    const held = cf.calls.length
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    assert.deepEqual(cf.calls.slice(held), [`GET /zones/${z}/workers/routes`])
    assert.deepEqual(shape(), [{ pattern: `${DOMAIN}/*`, script: 'someone-else' }])
  })
})

test('a claimed apex is its claimant\'s front door, and every name under it is a site only the claimant publishes', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({ HOST_DOOR_ORIGIN: 'https://door.example' })
  const claimant = assessor
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN, assessorKey)
    cf.activate(DOMAIN)
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    // Both keys sign `blog` open on the domain; only the claimant's is its publisher.
    holdIndex(env, await indexBy(assessorKey, { blog: head }, 1_800_000_100, { blog: [DOMAIN] }))
    holdIndex(env, await signedIndex({ blog: 'b'.repeat(64) }, 1_800_000_200, { blog: [DOMAIN] }))

    await worker.fetch(page(`https://${DOMAIN}/`), env)
    const missing = 'c'.repeat(64)
    await worker.fetch(new Request(`https://${DOMAIN}/${missing}`), env)
    // The apex is the shim host card — its page, and its own bytes the heap lacks.
    assert.deepEqual(cf.elsewhere, ['https://door.example/', `https://door.example/${missing}`])

    const { record } = await doorMeta(`https://blog.${DOMAIN}/`, env)
    assert.deepEqual({ layer: record.layer, pubkey: record.pubkey, lineage: record.lineage }, { layer: head, pubkey: claimant, lineage: 'blog' })

    // The domain's own directory lists it ...
    const sites = JSON.parse(await publicationsAt(env, DOMAIN)).sites
    const blog = sites.find((site) => site.host === `blog.${DOMAIN}`)
    assert.deepEqual(blog.publishers.map((p) => [p.pubkey, p.head]), [[claimant, head]])
    // ... and, once root paths are on, at its root path on the claimed apex first.
    const rooted = JSON.parse(await publicationsAt({ ...env, ROOT_PATHS: '1' }, DOMAIN)).sites.find((site) => site.lineage === 'blog')
    assert.deepEqual(rooted.hosts.map((door) => door.url), [`https://${DOMAIN}/blog`, `https://blog.${DOMAIN}/`])
    // ... and the operator's never does: a claim is not the operator's to advertise.
    const operators = await publicationsAt(env, 'pluginthematrix.com')
    assert.ok(JSON.parse(operators).sites.length)
    assert.ok(!operators.includes(DOMAIN) && !operators.includes(claimant))
    // content.<domain> is the write face, never a site.
    assert.match(await (await worker.fetch(new Request(`https://content.${DOMAIN}/`), env)).text(), /public content endpoint/)
  })
})

test('the operator moves a claim to a new key by editing its pubkey; a deleted record fails closed', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv()
  const lost = keyOf(7)
  await onCloudflare(cf, async () => {
    await claim(env, DOMAIN, lost)
    cf.activate(DOMAIN)
    assert.equal(await statusOf(await lookAt(env, DOMAIN)), 'active')
    // The participant lost that key. The operator edits the record — never deletes it.
    await rewind(env, DOMAIN, { pubkey: assessor })
    assert.equal(await statusOf(await claim(env, DOMAIN, assessorKey)), 'active')
    assert.equal((await claim(env, DOMAIN, lost)).status, 409)
    holdIndex(env, await indexBy(assessorKey, { blog: head }, 1_800_000_100, { blog: [DOMAIN] }))
    const { record } = await later(120_000, () => doorMeta(`https://blog.${DOMAIN}/`, env))
    assert.equal(record.pubkey, assessor)

    // Deleted instead, the record leaves its zone behind: the domain is refused, never handed out.
    env.CONTENT.held.delete(await claimAt(DOMAIN))
    const again = await claim(env, DOMAIN, keyOf(8))
    assert.equal(again.status, 409)
    assert.match(await again.text(), /ask this host's operator/)
  })
  assert.equal(cf.created.length, 1)
})

test('the var and the operators always win over a claim', async () => {
  const cf = fakeCloudflare()
  const env = claimEnv({
    HOST_DOOR_ORIGIN: 'https://door.example',
    SITE_BINDINGS: JSON.stringify({ ...ONE_ZONE, [DOMAIN]: { title: 'Bound by hand', lineage: 'ibh', publishers: [{ pubkey, label: 'Jaime', primary: true }] } }),
  })
  // Records an older rule, or a hand, left behind: the var binds both names.
  await keepClaim(env, { domain: DOMAIN, pubkey: assessor })
  await keepClaim(env, { domain: 'shop.pluginthematrix.com', pubkey: assessor })
  holdIndex(env, await indexBy(assessorKey, { blog: 'b'.repeat(64) }, 1_800_000_100, { blog: [DOMAIN] }))
  holdIndex(env, await signedIndex({ blog: head }, 1_800_000_200, { blog: [DOMAIN] }))
  await onCloudflare(cf, async () => {
    const bound = (await sitesOf(env)).find((site) => site.host === DOMAIN)
    assert.deepEqual([bound.title, bound.publishers.map((p) => p.pubkey)], ['Bound by hand', [pubkey]])
    assert.equal((await doorMeta(`https://blog.${DOMAIN}/`, env)).record.pubkey, pubkey)
    // A claim inside a bound zone is no front door there: the zone's rule answers.
    const shop = await worker.fetch(page('https://shop.pluginthematrix.com/'), env)
    assert.equal(shop.status, 404)
    assert.match(await shop.text(), /nothing published at shop/)
    assert.deepEqual(cf.elsewhere, [])
  })
})

test('a routed request never fails for want of the claims, and a refresh fetches only the records that changed', async () => {
  const env = claimEnv()
  for (const domain of ['a-claim.org', 'b-claim.org', 'c-claim.org']) await keepClaim(env, { domain, pubkey: assessor })
  const write = () => worker.fetch(new Request('https://revolucion.pluginthematrix.com/x', { method: 'PUT' }), env)
  // The bucket's listing fails: the site still answers as a site.
  const list = env.CONTENT.list
  env.CONTENT.list = async () => { throw new Error('R2 list failed') }
  assert.equal((await write()).status, 405)
  env.CONTENT.list = list
  const reads = []
  const get = env.CONTENT.get
  env.CONTENT.get = async (key) => { if (key.startsWith(`${CLAIMS}/`)) reads.push(key); return get(key) }
  await later(61_000, write)
  assert.equal(reads.length, 3)
  // A minute on, nothing changed: one listing, no record fetched again.
  await later(122_000, write)
  assert.equal(reads.length, 3)
  await rewind(env, 'b-claim.org', { activatedAt: 3 })
  await later(183_000, write)
  assert.deepEqual(reads.slice(3), [await claimAt('b-claim.org')])
})

test('a claimant may publish on the claimed domain, but the host AI stays the operator\'s to give', async () => {
  const env = claimEnv({ ANTHROPIC_API_KEY: 'test' })
  await keepClaim(env, { domain: DOMAIN, pubkey: assessor })
  const url = 'https://content.pluginthematrix.com/ai/ask'
  const upstream = []
  const original = globalThis.fetch
  globalThis.fetch = async (target) => { upstream.push(String(target)); return Response.json({ content: [] }) }
  try {
    const asked = await worker.fetch(new Request(url, { method: 'POST',
      headers: { authorization: await nip98(url, 'POST', assessorKey), 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'what is here?', stream: false }) }), env)
    assert.equal(asked.status, 429)
    assert.deepEqual(upstream, [])
  } finally { globalThis.fetch = original }
})

test('the claims pool is never listed, even when declared, and its members are never served', async () => {
  const windows = await sha256('hypercomb:windows')
  const { env } = await operated({ roots: BOUND_ROOTS, objects: { [VECTOR.recordSig]: VECTOR.record },
    extra: { listed: ['host:claims', 'hypercomb:windows'] } })
  env.CF_ACCOUNT_ID = 'acct'
  await keepClaim(env, { domain: DOMAIN, pubkey: assessor })
  await env.CONTENT.put(`${windows}/${'d'.repeat(64)}`, '{}')
  const at = (path) => worker.fetch(new Request(`https://content.pluginthematrix.com${path}`), env)
  // The declaration is honored for an ordinary pool, and refused for this one.
  assert.equal((await at(`/${windows}/`)).status, 200)
  const listing = await at(`/${CLAIMS}/`)
  assert.equal(listing.status, 404)
  assert.match(await listing.text(), /no pool at this address/)
  const member = await sha256Hex(DOMAIN)
  for (const path of [`/${CLAIMS}/${member}`, `/content/${CLAIMS}/${member}`, `/@resource/${CLAIMS}/${member}`, `/content/${CLAIMS}/`]) {
    const read = await at(path)
    assert.notEqual(read.status, 200, path)
    assert.ok(!(await read.text()).includes(assessor), path)
  }
})

test('the forwarder hands every request on unchanged, and its config declares no routes', async () => {
  const { default: forwarder } = await import('./hosts-forwarder.js')
  const seen = []
  const request = new Request(`https://blog.${DOMAIN}/x?y=1`, { method: 'POST', body: 'z' })
  const answer = await forwarder.fetch(request, { HOST: { fetch: async (r) => { seen.push(r); return new Response('main worker') } } })
  assert.equal(seen[0], request)
  assert.equal(await answer.text(), 'main worker')
  // Declaring one route there would delete every claimed domain on its next deploy.
  const config = (name) => readFileSync(new URL(name, import.meta.url), 'utf8').split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
  const hosts = config('./wrangler.hosts.toml')
  assert.doesNotMatch(hosts, /^\s*routes?\s*=/m)
  assert.doesNotMatch(hosts, /\[\[routes\]\]/)
  const main = /^name\s*=\s*"([^"]+)"/m.exec(config('./wrangler.pluginthematrix.toml'))[1]
  assert.match(hosts, new RegExp(`\\[\\[services\\]\\]\\s*binding\\s*=\\s*"HOST"\\s*service\\s*=\\s*"${main}"`))
  assert.match(config('./wrangler.pluginthematrix.toml'), /^CLAIM_SCRIPT\s*=\s*"hypercomb-hosts"/m)
  assert.match(hosts, /^name\s*=\s*"hypercomb-hosts"/m)
})

// ── a claimant hosts its domain here ───────────────────────────────────────
// The shared hives a claimed domain serves live in this bucket, replicated up
// from the claimant's own hive: an active claim stands its key on the claim
// allowance, and a stranger stays on the guest list.
test('an active claim lifts its key past the guest allowance; a stranger stays on it', async () => {
  const env = claimEnv({ DEFAULT_QUOTA_BYTES: '8', CLAIM_QUOTA_BYTES: '4096' })
  await keepClaim(env, { domain: DOMAIN, pubkey })
  const upload = async (bytes, key) => {
    const url = `https://content.${DOMAIN}/${await sha256Hex(bytes)}`
    return worker.fetch(new Request(url, { method: 'PUT', headers: { authorization: await nip98(url, 'PUT', key) }, body: bytes }), env)
  }
  assert.equal((await upload('a hive the claimant shares', sk)).status, 201)
  const stranger = await upload('a stranger past the guest list', assessorKey)
  assert.equal(stranger.status, 403)
  assert.match(await stranger.text(), /quota used up/)
  // Contested, the claim binds nobody — and lifts nobody.
  await keepClaim(env, { domain: DOMAIN, pubkey, contested: [pubkey, pubOf(assessorKey)] })
  const contested = await later(61_000, () => upload('after the contest', sk))
  assert.equal(contested.status, 403)
  assert.match(await contested.text(), /quota used up/)
})

// ── NIP-05: who a key is, at its host (documentation/sealed-audiences.md, Names)
// `/.well-known/nostr.json` from the keys the host already serves — each
// binding's publishers under their label, the primary as `_`. Always 200 JSON
// with CORS `*`, never the page, the host card, a redirect or a 404.
const NOSTR_JSON = '/.well-known/nostr.json'
const nostrJsonAt = (env, host, { query = '', method = 'GET', headers } = {}) =>
  worker.fetch(new Request(`https://${host}${NOSTR_JSON}${query}`, { method, headers }), env)
async function namesAt(env, host, options) {
  const res = await nostrJsonAt(env, host, options)
  assert.equal(res.status, 200, host)
  assert.equal(res.headers.get('content-type'), 'application/json', host)
  assert.equal(res.headers.get('access-control-allow-origin'), '*', host)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60', host)
  const doc = await res.json()
  assert.deepEqual(Object.keys(doc), ['names'], host)
  return doc.names
}

test('a bound apex answers its publishers by name, the primary as _ — the JSON, never the page', async () => {
  const { env, assetRequests } = await fixture()
  // Even asked as a browser navigation would ask it.
  assert.deepEqual(await namesAt(env, 'pluginthematrix.com', { headers: { 'sec-fetch-dest': 'document', accept: 'text/html,*/*' } }),
    { _: pubkey, jaime: pubkey })
  // Another binding answers its own publishers' names.
  assert.deepEqual(await namesAt(env, 'revolucion.pluginthematrix.com'), { _: pubkey, curator: pubkey })
  // An implicit name under a zone answers the zone's.
  assert.deepEqual(await namesAt(env, 'blog.pluginthematrix.com'), { _: pubkey, jaime: pubkey })
  assert.deepEqual(assetRequests, [])
})

test('a front-door apex answers its names from the worker, never through the host card', async () => {
  const bindings = { ...ONE_ZONE, 'pluginthematrix.com': { ...ONE_ZONE['pluginthematrix.com'], lineage: 'pluginthematrix.com', frontDoor: true } }
  const { env, assetRequests } = await fixture(undefined, bindings)
  env.HOST_DOOR_ORIGIN = 'https://door.example/'
  env.HOST_DOOR_HOSTS = 'pluginthematrix.io'
  const asked = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('host card', { headers: { 'content-type': 'text/html' } }) }
  try {
    assert.deepEqual(await namesAt(env, 'pluginthematrix.com'), { _: pubkey, jaime: pubkey })
    // A byte mirror binds nobody: it vouches for nobody, and still asks no card.
    assert.deepEqual(await namesAt(env, 'pluginthematrix.io'), {})
    assert.deepEqual(asked, [])
    assert.deepEqual(assetRequests, [])
  } finally { globalThis.fetch = realFetch }
})

test('a claimed domain answers only its claimant, as _; a contested claim vouches for nobody', async () => {
  const env = claimEnv()
  await keepClaim(env, { domain: DOMAIN, pubkey: assessor })
  // A claim carries no label, so the claimant is the domain and nothing more.
  assert.deepEqual(await namesAt(env, DOMAIN), { _: assessor })
  assert.deepEqual(await namesAt(env, `blog.${DOMAIN}`), { _: assessor })
  await keepClaim(env, { domain: DOMAIN, pubkey: assessor, contested: [assessor, pubkey] })
  await later(61_000, async () => {
    assert.deepEqual(await namesAt(env, DOMAIN), {})
    assert.deepEqual(await namesAt(env, `blog.${DOMAIN}`), {})
  })
})

test('the relay face and an unbound host vouch for nobody', async () => {
  const { env } = await fixture()
  assert.deepEqual(await namesAt(env, 'content.pluginthematrix.com'), {})
  assert.deepEqual(await namesAt(env, 'unbound.example'), {})
  // A name the wildcard cannot bring to life is no site either.
  assert.deepEqual(await namesAt(env, 'a.b.pluginthematrix.com'), {})
})

test('a label two keys share on one host names neither; one key may hold several labels', async () => {
  const { env } = await fixture(undefined, {
    'shared.example': {
      title: 'Shared', lineage: 'shared',
      publishers: [
        { pubkey, label: 'Jaime', primary: true },
        { pubkey: assessor, label: 'jaime' },
        { pubkey, label: 'jwize' },
        { pubkey: assessor, label: 'Assessor' },
        { pubkey: assessor, label: 'not a name' },
      ],
    },
  })
  assert.deepEqual(await namesAt(env, 'shared.example'), { _: pubkey, jwize: pubkey, assessor })
})

test('a lookalike spelling is never a name: not as a label, not as ?name=', async () => {
  const { env } = await fixture(undefined, {
    'kate.example': {
      title: 'Kate', lineage: 'kate',
      publishers: [{ pubkey, label: 'Kate', primary: true }, { pubkey: assessor, label: 'Kelvin' }],
    },
  })
  // U+212A KELVIN SIGN lowercases to ASCII `k`; the label written with it names nobody.
  assert.deepEqual(await namesAt(env, 'kate.example'), { _: pubkey, kate: pubkey })
  assert.deepEqual(await namesAt(env, 'kate.example', { query: '?name=Kate' }), { Kate: pubkey })
  assert.deepEqual(await namesAt(env, 'kate.example', { query: `?name=${encodeURIComponent('Kate')}` }), {})
  assert.deepEqual(await namesAt(env, 'kate.example', { query: `?name=${encodeURIComponent('﻿kate')}` }), {})
})

test('?name= answers one entry keyed exactly as asked, and an unknown name is an empty 200', async () => {
  const { env } = await fixture()
  assert.deepEqual(await namesAt(env, 'pluginthematrix.com', { query: '?name=jaime' }), { jaime: pubkey })
  assert.deepEqual(await namesAt(env, 'pluginthematrix.com', { query: '?name=Jaime' }), { Jaime: pubkey })
  assert.deepEqual(await namesAt(env, 'pluginthematrix.com', { query: '?name=_' }), { _: pubkey })
  assert.deepEqual(await namesAt(env, 'pluginthematrix.com', { query: '?name=curator' }), {})
  assert.deepEqual(await namesAt(env, 'pluginthematrix.com', { query: '?name=nobody' }), {})
  assert.deepEqual(await namesAt(env, 'pluginthematrix.com', { query: '?name=' }), { _: pubkey, jaime: pubkey })
})

test('HEAD answers the same headers with no body', async () => {
  const { env } = await fixture()
  const res = await nostrJsonAt(env, 'pluginthematrix.com', { method: 'HEAD' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(res.body, null)
  assert.equal(await res.text(), '')
})

// ── the zone root (jwize 2026-10-03: publish to the root domain) ────────────
// Every write the hive makes lands at the zone root; content.<zone> keeps
// accepting for installs that have not updated; a site under a zone never
// writes. A published place is reached at its own address, else its root
// path, else (top-level, legacy) its label.

const FRONT_DOOR_ZONE = {
  ...ONE_ZONE,
  'pluginthematrix.com': { ...ONE_ZONE['pluginthematrix.com'], lineage: 'pluginthematrix.com', frontDoor: true },
}

async function putIndexAt(env, host, event, key = sk) {
  const url = `https://${host}/${INDEXES}/${event.pubkey}`
  return worker.fetch(new Request(url, { method: 'PUT',
    headers: { authorization: await nip98(url, 'PUT', key) }, body: JSON.stringify(event) }), env)
}

/** A signed index by `key` with any content fields. */
async function indexWith(key, content, createdAt = 1_800_000_100) {
  const event = { pubkey: pubOf(key), created_at: createdAt, kind: 30564, tags: [], content: JSON.stringify(content) }
  event.id = await sha256Hex(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
  event.sig = hex(schnorr.sign(event.id, key))
  return event
}

/** The visitor page as the build ships it: a document base and a head. */
const VISITOR_HTML = '<!doctype html><html><head><base href="/" /><title>v</title></head><body>visitor</body></html>'
function visitorAssets(env, asked) {
  env.ASSETS = {
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      asked.push(pathname)
      if (pathname === '/main.js') return new Response('export {}', { headers: { 'content-type': 'text/javascript' } })
      if (pathname === '/' || pathname === '/index.html') return new Response(VISITOR_HTML, { headers: { 'content-type': 'text/html' } })
      return new Response('missing', { status: 404 })
    },
  }
}
const carriedDoor = (html) => JSON.parse(html.match(/<script id="hc-door" type="application\/json">(.*?)<\/script>/)[1])
const pageAt = async (url, env) => (await worker.fetch(page(url), env)).text()

test('the zone root takes every write: a bound apex, a front-door apex, a claimed apex and an operated one', async () => {
  // A bound apex that is not a front door.
  const plain = await fixture()
  assert.equal((await putIndexAt(plain.env, 'pluginthematrix.com', await signedIndex({ revolucion: head }, 1_800_000_001))).status, 200)
  // A front-door apex: the index, the /hive/<pubkey> drain, forget and grant all reach the worker.
  const door = await fixture(undefined, FRONT_DOOR_ZONE)
  door.env.HOST_DOOR_ORIGIN = 'https://door.example'
  const asked = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('host card') }
  try {
    assert.equal((await putIndexAt(door.env, 'pluginthematrix.com', await signedIndex({ revolucion: head }, 1_800_000_002))).status, 200)
    const drainUrl = `https://pluginthematrix.com/hive/${pubkey}`
    const drained = await worker.fetch(new Request(drainUrl, { method: 'PUT',
      headers: { authorization: await nip98(drainUrl, 'PUT') }, body: JSON.stringify(await signedIndex({ revolucion: head }, 1_800_000_003)) }), door.env)
    assert.equal(drained.status, 200)
    assert.equal((await worker.fetch(new Request('https://pluginthematrix.com/forget', { method: 'POST' }), door.env)).status, 401)
    assert.notEqual(await (await worker.fetch(new Request('https://pluginthematrix.com/grant'), door.env)).text(), 'host card')
    assert.equal((await worker.fetch(new Request('https://pluginthematrix.com/', { method: 'OPTIONS' }), door.env)).status, 204)
    assert.deepEqual(asked, [], 'no write ever went to the host card')
  } finally { globalThis.fetch = realFetch }
  // A claimed apex: its claimant writes there.
  const env = claimEnv()
  await keepClaim(env, { domain: DOMAIN, pubkey: assessor })
  const claimed = await putIndexAt(env, DOMAIN, await indexBy(assessorKey, { blog: head }, 1_800_000_100, { blog: [DOMAIN] }), assessorKey)
  assert.equal(claimed.status, 201)
  // An operator-record apex is a zone root even before its record verifies.
  const operatedEnv = { ...plain.env, SITE_OPERATORS: JSON.stringify({ 'operated.example': pubkey }) }
  assert.equal((await putIndexAt(operatedEnv, 'operated.example', await signedIndex({ revolucion: head }, 1_800_000_004))).status, 200)
})

test('a site under the zone never writes, and content.<zone> still does', async () => {
  const { env } = await fixture()
  for (const host of ['revolucion.pluginthematrix.com', 'pluginthematrix.pluginthematrix.com', 'try-rooms.pluginthematrix.com']) {
    const refused = await putIndexAt(env, host, await signedIndex({ revolucion: head }, 1_800_000_001))
    assert.equal(refused.status, 405, host)
    assert.equal((await worker.fetch(new Request(`https://${host}/forget`, { method: 'POST' }), env)).status, 405, host)
  }
  // The legacy write face keeps accepting, forever, for installs not yet updated.
  assert.equal((await putIndexAt(env, 'content.pluginthematrix.com', await signedIndex({ revolucion: head }, 1_800_000_005))).status, 200)
})

test('a root path serves its published place, nested too, exactly as its own door would', async () => {
  const rituals = 'b'.repeat(64)
  const event = await signedIndex({ pluginthematrix: head, 'honey-garden': head, 'honey-garden/rituals': rituals, elsewhere: head },
    1_800_000_000, { elsewhere: ['other.example'] })
  const { env } = await fixture(event, FRONT_DOOR_ZONE)
  env.HOST_DOOR_ORIGIN = 'https://door.example'
  visitorAssets(env, [])
  const card = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => { card.push(String(url)); return new Response('host card', { headers: { 'content-type': 'text/html' } }) }
  try {
    // Until ROOT_PATHS is switched on, a path is the card's, as it always was,
    // and the ledger keeps the label door.
    assert.equal(await pageAt('https://pluginthematrix.com/honey-garden/rituals', env), 'host card')
    const before = (await (await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()).sites
    assert.equal(before.find((site) => site.lineage === 'honey-garden').url, 'https://honey-garden.pluginthematrix.com/')
    card.length = 0
    env.ROOT_PATHS = '1'
    const nested = await worker.fetch(page('https://pluginthematrix.com/honey-garden/rituals'), env)
    assert.equal(nested.status, 200)
    const html = await nested.text()
    assert.match(html, /<base href="\/honey-garden\/rituals\/" \/>/)
    const door = carriedDoor(html)
    assert.deepEqual([door.lineage, door.layer, door.pubkey], ['honey-garden/rituals', rituals, pubkey])
    assert.ok(env.CONTENT.held.has(`${await sha256Hex('pluginthematrix.com/honey-garden/rituals')}/00000000`),
      'the place keeps its revisions at sign(<zone>/<lineage>)')
    // The engine's files are asked under the prefix and served without it.
    const script = await worker.fetch(new Request('https://pluginthematrix.com/honey-garden/rituals/main.js'), env)
    assert.equal(await script.text(), 'export {}')
    // A route inside the place is the place's page; the parent is its own place.
    assert.equal(carriedDoor(await pageAt('https://pluginthematrix.com/honey-garden/rituals/deeper', env)).lineage, 'honey-garden/rituals')
    assert.equal(carriedDoor(await pageAt('https://pluginthematrix.com/honey-garden', env)).lineage, 'honey-garden')
    assert.deepEqual(card, [], 'a place never reaches the host card')
    // A lineage whose doors leave this zone out, `/`, and anything else: the card.
    for (const path of ['/elsewhere', '/', '/nothing-here', '/main.js']) {
      assert.equal(await pageAt(`https://pluginthematrix.com${path}`, env), 'host card', path)
    }
    assert.deepEqual(card, ['https://door.example/elsewhere', 'https://door.example/', 'https://door.example/nothing-here', 'https://door.example/main.js'])
    // The ledger lists each place at its root path.
    const sites = (await (await worker.fetch(new Request(`https://pluginthematrix.com/${PUBLICATIONS}`), env)).json()).sites
    const place = sites.find((site) => site.lineage === 'honey-garden/rituals')
    assert.equal(place.url, 'https://pluginthematrix.com/honey-garden/rituals')
    assert.equal(place.host, 'pluginthematrix.com')
    assert.deepEqual(place.publishers.map((p) => p.head), [rituals])
    // A top-level place leads with its root path; its label door still answers beside it.
    const top = sites.find((site) => site.lineage === 'honey-garden')
    assert.deepEqual(top.hosts.map((d) => d.url), ['https://pluginthematrix.com/honey-garden', 'https://honey-garden.pluginthematrix.com/'])
    assert.equal(carriedDoor(await pageAt('https://honey-garden.pluginthematrix.com/', env)).lineage, 'honey-garden')
    assert.ok(!sites.some((site) => site.url === 'https://pluginthematrix.com/elsewhere'))
  } finally { globalThis.fetch = realFetch }
})

test('a root path never shadows the front door\'s own files, and a site apex keeps its routes', async () => {
  const event = await signedIndex({ pluginthematrix: head, pin: head, core: head, rooms: head })
  const { env } = await fixture(event, FRONT_DOOR_ZONE)
  env.HOST_DOOR_ORIGIN = 'https://door.example'
  env.ROOT_PATHS = '1'
  visitorAssets(env, [])
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('host card')
  try {
    for (const path of ['/pin', '/core/x.js']) assert.equal(await pageAt(`https://pluginthematrix.com${path}`, env), 'host card', path)
    assert.match(await pageAt('https://pluginthematrix.com/rooms', env), /hc-door/)
  } finally { globalThis.fetch = realFetch }
  // A bound apex that is a site, not a front door, answers its own routes as before.
  const plain = await fixture(event)
  assert.equal(await pageAt('https://pluginthematrix.com/rooms', plain.env), 'visitor engine')
})

test('an own address names its lineage; the operator binding wins; two publishers naming one host bind nobody', async () => {
  const bindings = {
    ...ONE_ZONE,
    'pluginthematrix.com': { ...ONE_ZONE['pluginthematrix.com'], publishers: [{ pubkey, label: 'Jaime', primary: true }, { pubkey: assessor, label: 'Other' }] },
  }
  const rituals = 'b'.repeat(64)
  const event = await signedIndex({ revolucion: head, rituals: 'c'.repeat(64), 'honey-garden/rituals': rituals, quiet: head }, 1_800_000_000, {}, undefined, {
    addresses: {
      'rituals.pluginthematrix.com': 'honey-garden/rituals',
      'revolucion.pluginthematrix.com': 'rituals',
      'content.pluginthematrix.com': 'rituals',
      'shared.pluginthematrix.com': 'quiet',
    },
  })
  const { env } = await fixture(event, bindings)
  holdIndex(env, await indexWith(assessorKey, { roots: { mine: head }, doors: { mine: ['pluginthematrix.com'] } }))
  // The address outranks the label rule: rituals.<zone> is honey-garden/rituals, not `rituals`.
  const addressed = await doorMeta('https://rituals.pluginthematrix.com/', env)
  assert.deepEqual([addressed.record.lineage, addressed.record.layer], ['honey-garden/rituals', rituals])
  // An operator binding for exactly the host wins.
  assert.equal((await doorMeta('https://revolucion.pluginthematrix.com/', env)).record.lineage, 'revolucion')
  // content.<zone> keeps its meaning.
  assert.match(await (await worker.fetch(new Request('https://content.pluginthematrix.com/'), env)).text(), /public content endpoint/)
  // One publisher's address binds; the ledger lists the place there.
  assert.equal((await doorMeta('https://shared.pluginthematrix.com/', env)).record.lineage, 'quiet')
  const sites = JSON.parse(await publicationsAt(env, 'pluginthematrix.com')).sites
  const place = sites.find((site) => site.lineage === 'honey-garden/rituals')
  assert.equal(place.url, 'https://rituals.pluginthematrix.com/')
  assert.equal(place.hosts[0].host, 'rituals.pluginthematrix.com')

  // A second publisher of the zone names the same host: contested — the label rule answers again.
  const contested = await fixture(event, bindings)
  holdIndex(contested.env, await indexWith(assessorKey, { roots: { mine: head }, doors: { mine: ['pluginthematrix.com'] },
    addresses: { 'shared.pluginthematrix.com': 'mine' } }))
  const shared = await worker.fetch(page('https://shared.pluginthematrix.com/'), contested.env)
  assert.equal(shared.status, 404, 'contested binds nobody, and nothing named `shared` is published')
  assert.equal((await doorMeta('https://rituals.pluginthematrix.com/', contested.env)).record.lineage, 'honey-garden/rituals')
})

test('a signed index carries its addresses only in the bounded shape', async () => {
  const { env } = await fixture()
  const addressed = (addresses, at) => signedIndex({ revolucion: head }, at, undefined, undefined, { addresses })
  assert.equal((await putIndexAt(env, 'pluginthematrix.com', await addressed({ 'Shop.pluginthematrix.com': 'revolucion' }, 1_800_000_001))).status, 400)
  assert.equal((await putIndexAt(env, 'pluginthematrix.com', await addressed({ 'shop.pluginthematrix.com': '' }, 1_800_000_002))).status, 400)
  assert.equal((await putIndexAt(env, 'pluginthematrix.com', await addressed(['shop'], 1_800_000_003))).status, 400)
  const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`n${i}.pluginthematrix.com`, 'revolucion']))
  assert.equal((await putIndexAt(env, 'pluginthematrix.com', await addressed(many, 1_800_000_004))).status, 400)
  assert.equal((await putIndexAt(env, 'pluginthematrix.com', await addressed({ 'shop.pluginthematrix.com': 'revolucion' }, 1_800_000_005))).status, 200)
  // Writing the index advanced the address's own bag, as for any door.
  const bag = await sha256Hex('shop.pluginthematrix.com')
  assert.ok(env.CONTENT.held.has(`${bag}/00000000`))
  assert.equal((await doorMeta('https://shop.pluginthematrix.com/', env)).record.lineage, 'revolucion')
})

test('a front door opens on the creation its publisher signs at the apex, and the card moves to host.<zone>', async () => {
  const welcome = 'b'.repeat(64)
  const event = await signedIndex({ 'pointblanksolutions-ca': welcome, camelflage: head }, 1_800_000_000, {}, undefined, {
    addresses: { 'pluginthematrix.com': 'pointblanksolutions-ca' },
  })
  const { env } = await fixture(event, FRONT_DOOR_ZONE)
  env.HOST_DOOR_ORIGIN = 'https://door.example'
  visitorAssets(env, [])
  const card = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => { card.push(String(url)); return new Response('host card', { headers: { 'content-type': 'text/html' } }) }
  try {
    // The apex is the creation's door: the visitor engine, carrying its door,
    // with every engine file its own.
    const door = carriedDoor(await pageAt('https://pluginthematrix.com/', env))
    assert.deepEqual([door.lineage, door.layer, door.pubkey], ['pointblanksolutions-ca', welcome, pubkey])
    assert.equal(carriedDoor(await pageAt('https://pluginthematrix.com/work/anything', env)).lineage, 'pointblanksolutions-ca')
    assert.equal(await (await worker.fetch(new Request('https://pluginthematrix.com/main.js'), env)).text(), 'export {}')
    assert.equal((await doorMeta('https://pluginthematrix.com/', env)).record.lineage, 'pointblanksolutions-ca')
    assert.deepEqual(card, [], 'an opened apex never reaches the card')
    // The card answers at host.<zone>, files and all …
    assert.equal(await pageAt('https://host.pluginthematrix.com/', env), 'host card')
    assert.equal(await pageAt('https://host.pluginthematrix.com/main.js', env), 'host card')
    // … the apex hands it the card's own routes …
    for (const path of ['/hosts', '/@hypercomb']) {
      const moved = await worker.fetch(page(`https://pluginthematrix.com${path}`), env)
      assert.equal(moved.status, 302, path)
      assert.equal(moved.headers.get('location'), `https://host.pluginthematrix.com${path}`)
    }
    // … and a project keeps its own label door beside it.
    assert.equal(carriedDoor(await pageAt('https://camelflage.pluginthematrix.com/', env)).lineage, 'camelflage')
    // The host door writes nothing; the apex still takes every write.
    const next = await signedIndex({ 'pointblanksolutions-ca': welcome, camelflage: head }, 1_800_000_001, {}, undefined, {
      addresses: { 'pluginthematrix.com': 'pointblanksolutions-ca' },
    })
    assert.equal((await putIndexAt(env, 'host.pluginthematrix.com', next)).status, 405)
    assert.equal((await putIndexAt(env, 'pluginthematrix.com', next)).status, 200)
    // The ledger lists the creation at the apex.
    const sites = JSON.parse(await publicationsAt(env, 'pluginthematrix.com')).sites
    assert.equal(sites.find((site) => site.lineage === 'pointblanksolutions-ca').url, 'https://pluginthematrix.com/')
    // host.<zone> is never a site or an own address, whatever an index names.
    assert.ok(!sites.some((site) => site.hosts.some((d) => d.host === 'host.pluginthematrix.com')))
  } finally { globalThis.fetch = realFetch }
})

test('a front door with no apex address keeps the card at the apex, and at host.<zone> too', async () => {
  const event = await signedIndex({ host: head, camelflage: head }, 1_800_000_000, {}, undefined, {
    addresses: { 'host.pluginthematrix.com': 'camelflage' },
  })
  const { env } = await fixture(event, FRONT_DOOR_ZONE)
  env.HOST_DOOR_ORIGIN = 'https://door.example'
  visitorAssets(env, [])
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('host card', { headers: { 'content-type': 'text/html' } })
  try {
    assert.equal(await pageAt('https://pluginthematrix.com/', env), 'host card')
    assert.equal(await pageAt('https://host.pluginthematrix.com/', env), 'host card', 'a lineage named host and an address there both lose to the card')
    assert.equal((await worker.fetch(page('https://pluginthematrix.com/hosts'), env)).status, 200, 'the card keeps its own routes at the apex')
  } finally { globalThis.fetch = realFetch }
  // On a zone that is not a front door, host.<zone> is an ordinary name.
  const plain = await fixture(event)
  visitorAssets(plain.env, [])
  assert.equal(carriedDoor(await pageAt('https://host.pluginthematrix.com/', plain.env)).lineage, 'camelflage')
})
