// Granted addresses (A-admin-contract, 2026-11-08): a host OPERATOR gives an address to a key from the hive over
// signed admin routes, the grants kept in the bucket beside the secret's entries — no secret edit, no redeploy.
// Everything that reads who-lives-here sees both; for one address a grant wins while it exists.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import worker from './mail-worker/worker.js'
import { openMessage, sha256Hex } from './mail-worker/seal.js'
import { FakeR2, streamOf, quiet } from './mail-test-helpers.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const ALL = ['read', 'mark', 'draft', 'delete', 'send']
const admin = generateSecretKey()
const jaime = generateSecretKey() // owns jaime@ through the secret
const ana = generateSecretKey() // nobody, until granted
const phone = generateSecretKey()
const stranger = generateSecretKey()
const hex = secret => getPublicKey(secret)
const at = address => encodeURIComponent(address)
const ME = 'jaime@hypercomb.com'
const ANA = 'ana@hypercomb.com'
const BEA = 'bea@hypercomb.com'

function setup(vars = {}) {
  const MAIL = new FakeR2()
  const env = {
    MAIL,
    MAIL_CONFIG: JSON.stringify({ keys: { [ME]: hex(jaime) }, names: { [ME]: 'Jaime' }, copyTo: { [ME]: 'me@example.org' } }),
    ADMIN_KEYS: hex(admin),
    ALLOWED_ORIGINS: 'https://hypercomb.io',
    ...vars,
  }
  for (const [name, value] of Object.entries(vars)) if (value === undefined) delete env[name]
  return { MAIL, env }
}

// A signed request as parts, with a fresh nonce (a write's event is spent once, R1 #5); make() builds the Request,
// and the same parts twice is the same signed request — a replay.
async function call(method, path, secret, { body, contentType = 'application/json', payload, origin } = {}) {
  const url = `https://hypercomb.com${path}`
  const bytes = body === undefined ? undefined : enc.encode(typeof body === 'string' ? body : JSON.stringify(body))
  const headers = {}
  if (bytes) headers['content-type'] = contentType
  if (origin) headers.origin = origin
  if (secret) {
    const tags = [['u', url], ['method', method], ['nonce', crypto.randomUUID()]]
    if (bytes) tags.push(['payload', payload ?? await sha256Hex(bytes)])
    const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags }, secret)
    headers.authorization = `Nostr ${btoa(JSON.stringify(event))}`
  }
  return { url, method, headers, bytes }
}
const make = ({ url, method, headers, bytes }) => new Request(url, { method, headers, body: bytes })
const hit = async (env, method, path, secret, options) => worker.fetch(make(await call(method, path, secret, options)), env)
const grant = (env, address, body, secret = admin) => hit(env, 'PUT', `/mail/grants/${at(address)}`, secret, { body })
const revoke = (env, address, secret = admin) => hit(env, 'DELETE', `/mail/grants/${at(address)}`, secret)
const me = async (env, secret) => (await hit(env, 'GET', '/mail/me', secret)).json()
const listed = async (env, secret = admin) => (await hit(env, 'GET', '/mail/grants', secret)).json()
const answer = async res => [res.status, await res.text()]

async function receive(env, to, subject = 'hello') {
  const raw = enc.encode(`From: a@example.org\r\nSubject: ${subject}\r\n\r\nbody of ${subject}\r\n`)
  const log = { rejected: [], forwarded: [] }
  await worker.email({
    from: 'a@example.org', to, rawSize: raw.length, raw: streamOf(raw),
    forward: async address => { log.forwarded.push(address) },
    setReject: reason => { log.rejected.push(reason) },
  }, env)
  return { sig: await sha256Hex(raw), raw, log }
}
const pool = address => sha256Hex(enc.encode(`mail:${address}`))
const sealedTo = entry => JSON.parse(entry.customMetadata.wraps).map(w => w.to)
const grantObjects = MAIL => [...MAIL.map.keys()].filter(k => k.startsWith('grants/'))

// ── who may ask ─────────────────────────────────────────────────────────────

test('a non-admin is a ghost on every grant route: a stranger, an owner, an unsigned call, and a host with no admin key', async () => {
  const { MAIL, env } = setup()
  const routes = [
    ['GET', '/mail/grants'],
    ['PUT', `/mail/grants/${at(ANA)}`, { body: { keys: [hex(ana)] } }],
    ['PUT', `/mail/grants/${at(ANA)}`, { body: { keys: [hex(ana)] }, contentType: 'text/plain' }], // 401 before 415: the body is not looked at
    ['PUT', `/mail/grants/${at(ANA)}`, { body: { pad: 'x'.repeat(5000) } }], // and before 413
    ['DELETE', `/mail/grants/${at(ANA)}`],
    ['DELETE', `/mail/grants/${at(ME)}`], // a real address answers exactly like a ghost
  ]
  for (const who of [stranger, jaime, null]) {
    for (const [method, path, options] of routes) {
      assert.deepEqual(await answer(await hit(env, method, path, who, options)), [401, 'not authorized'], `${method} ${path}`)
    }
  }
  // No admin key named anywhere: the would-be admin is a stranger too.
  const none = setup({ ADMIN_KEYS: undefined })
  for (const [method, path, options] of routes) {
    assert.deepEqual(await answer(await hit(none.env, method, path, admin, options)), [401, 'not authorized'], `${method} ${path} with no admins`)
  }
  assert.deepEqual(grantObjects(MAIL), [], 'nothing was written')
  // An admin hears the precise reason, as an owner does on a mailbox route.
  const stale = await call('GET', '/mail/grants', admin)
  const old = JSON.parse(atob(stale.headers.authorization.slice(6)))
  old.created_at -= 600
  const res = await worker.fetch(make({ ...stale, headers: { authorization: `Nostr ${btoa(JSON.stringify(finalizeEvent({ kind: 27235, created_at: old.created_at, content: '', tags: old.tags }, admin)))}` } }), env)
  assert.deepEqual(await answer(res), [401, 'auth token outside freshness window'])
  // The wrong method is said before anything else, as on every route; a bad address too.
  assert.deepEqual(await answer(await hit(env, 'POST', '/mail/grants', stranger)), [405, 'GET only'])
  assert.deepEqual(await answer(await hit(env, 'GET', `/mail/grants/${at(ANA)}`, stranger)), [405, 'PUT or DELETE only'])
  assert.deepEqual(await answer(await hit(env, 'DELETE', '/mail/grants/not-an-address', stranger)), [422, 'bad address'])
})

// ── granting ────────────────────────────────────────────────────────────────

test('an admin grants an address; the record is stored twice over, and /mail/me for the granted keys lists it with can', async () => {
  const { MAIL, env } = setup()
  assert.deepEqual((await receive(env, ANA, 'before')).log.rejected, ['no such mailbox'])
  const before = Date.now()
  const res = await grant(env, ANA, { keys: [hex(ana).toUpperCase(), { key: hex(phone), can: ['mark', 'read'] }], name: 'Ana', copyTo: 'ana@example.org' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  const record = await res.json()
  assert.ok(record.at >= before && record.at <= Date.now())
  assert.deepEqual({ ...record, at: 0 }, {
    address: ANA, v: 1,
    keys: [{ key: hex(ana), can: ALL }, { key: hex(phone), can: ['read', 'mark'] }],
    name: 'Ana', copyTo: 'ana@example.org', by: hex(admin), at: 0,
  })
  assert.deepEqual(grantObjects(MAIL), [`grants/${ANA}`])
  const stored = MAIL.map.get(`grants/${ANA}`)
  const body = JSON.parse(dec.decode(stored.bytes))
  assert.deepEqual(body, JSON.parse(stored.customMetadata.grant), 'the body and the metadata carry the same record')
  assert.deepEqual({ ...body, at: 0 }, { v: 1, keys: record.keys, name: 'Ana', copyTo: 'ana@example.org', by: hex(admin), at: 0 })
  assert.ok(stored.customMetadata.grant.length < 2048, 'three keys, a name and a copy fit R2 metadata')

  assert.deepEqual(await me(env, ana), { addresses: [ANA], names: { [ANA]: 'Ana' }, can: { [ANA]: ALL }, admin: false })
  assert.deepEqual(await me(env, phone), { addresses: [ANA], names: { [ANA]: 'Ana' }, can: { [ANA]: ['read', 'mark'] }, admin: false })
  assert.deepEqual((await me(env, stranger)).addresses, [])
  assert.deepEqual((await me(env, admin)).addresses, [], 'granting is not owning')
})

test('a message to a granted address is sealed to the granted keys, copied where the grant says, and listed to them alone', async () => {
  const { MAIL, env } = setup()
  await grant(env, ANA, { keys: [hex(ana), hex(phone)], copyTo: 'ana@example.org' })
  const { sig, raw, log } = await receive(env, ANA)
  assert.deepEqual(log.rejected, [])
  assert.deepEqual(log.forwarded, ['ana@example.org'])
  const entry = MAIL.map.get(`${await pool(ANA)}/${sig}`)
  assert.deepEqual(sealedTo(entry), [hex(ana), hex(phone)])
  for (const secret of [ana, phone]) assert.deepEqual((await openMessage(entry.bytes, secret)).bytes, raw)
  const page = await hit(env, 'GET', `/mail/box/${at(ANA)}`, phone)
  assert.equal(page.status, 200)
  assert.deepEqual((await page.json()).items.map(i => i.sig), [sig])
  assert.equal((await hit(env, 'GET', `/mail/box/${at(ANA)}/${sig}`, ana)).status, 200)
  assert.equal((await hit(env, 'GET', `/mail/box/${at(ANA)}`, jaime)).status, 401)
  assert.equal((await hit(env, 'GET', `/mail/box/${at(ANA)}`, admin)).status, 401, 'the admin key reads nothing it was not granted')
  // and the granted key sends as the address (the Worker's part of it)
  const EMAIL = { calls: [], send: async m => { EMAIL.calls.push(m); return { messageId: '<1@hypercomb.com>' } } }
  env.EMAIL = EMAIL
  const sent = await hit(env, 'POST', '/mail/send', ana, { body: { from: ANA, to: ['x@example.org'], subject: 'hi', text: 'there' } })
  assert.equal(sent.status, 200)
  assert.equal(EMAIL.calls[0].from, ANA)
  assert.equal((await hit(env, 'POST', '/mail/send', jaime, { body: { from: ANA, to: ['x@example.org'], subject: 'hi', text: 'there' } })).status, 401, 'a stranger to the address still cannot')
})

test('a grant over a secret address wins while it exists; revoked, the secret stands again and nothing that arrived is touched', async () => {
  const { MAIL, env } = setup()
  const first = await receive(env, ME, 'one')
  assert.deepEqual(first.log.forwarded, ['me@example.org'])
  assert.equal((await grant(env, ME, { keys: [hex(phone)] })).status, 200)

  const second = await receive(env, ME, 'two')
  assert.deepEqual(second.log.rejected, [])
  assert.deepEqual(second.log.forwarded, [], 'the grant is the whole record: it names no copy, so none goes')
  const box = await pool(ME)
  assert.deepEqual(sealedTo(MAIL.map.get(`${box}/${second.sig}`)), [hex(phone)])
  assert.deepEqual(await me(env, jaime), { addresses: [], names: {}, can: {}, admin: false })
  assert.deepEqual((await me(env, phone)).addresses, [ME])
  assert.equal((await hit(env, 'GET', `/mail/box/${at(ME)}`, jaime)).status, 401)
  assert.equal((await hit(env, 'GET', `/mail/box/${at(ME)}`, phone)).status, 200)
  assert.equal((await listed(env)).grants[ME].source, 'grant')

  const gone = await revoke(env, ME)
  assert.deepEqual(await answer(gone), [204, ''])
  const third = await receive(env, ME, 'three')
  assert.deepEqual(third.log.forwarded, ['me@example.org'])
  assert.deepEqual(sealedTo(MAIL.map.get(`${box}/${third.sig}`)), [hex(jaime)])
  assert.deepEqual((await me(env, jaime)).addresses, [ME])
  assert.deepEqual((await me(env, phone)).addresses, [])
  assert.equal((await listed(env)).grants[ME].source, 'secret')
  // What arrived under the grant is still there, sealed to the keys of its time; the first message too.
  for (const sig of [first.sig, second.sig, third.sig]) assert.ok(MAIL.map.has(`${box}/${sig}`))
  assert.deepEqual(sealedTo(MAIL.map.get(`${box}/${second.sig}`)), [hex(phone)])
  assert.deepEqual((await openMessage(MAIL.map.get(`${box}/${second.sig}`).bytes, phone)).bytes, second.raw)
})

// ── the body, held to the contract ──────────────────────────────────────────

test('a PUT is held to the contract, one status per fault, and a refused grant writes nothing', async () => {
  const { MAIL, env } = setup()
  const path = `/mail/grants/${at(ANA)}`
  const good = { keys: [hex(ana)] }
  const expect = async (status, text, options, label = JSON.stringify(options)) =>
    assert.deepEqual(await answer(await hit(env, 'PUT', path, admin, options)), [status, text], label)
  await expect(415, 'send JSON', { body: good, contentType: 'text/plain' })
  await expect(413, 'message too large', { body: { ...good, pad: 'x'.repeat(4100) } })
  await expect(400, 'bad JSON', { body: '{bad' })
  await expect(400, 'bad JSON', { body: '[1]' })
  await expect(401, 'auth payload tag mismatch', { body: good, payload: await sha256Hex(enc.encode('{}')) })
  assert.deepEqual(await answer(await hit(env, 'PUT', '/mail/grants/not-an-address', admin, { body: good })), [422, 'bad address'])
  assert.deepEqual(await answer(await hit(env, 'PUT', `/mail/grants/${at('ana@other.org')}`, admin, { body: good })), [422, 'not this host\'s zone'])
  for (const keys of [undefined, null, [], 'abc', { key: hex(ana) }, [null], ['not-a-key'], [{ can: ['read'] }], [[hex(ana)]],
    [hex(ana), hex(phone), hex(jaime), hex(stranger)], [{ key: hex(ana), can: ['read', 'fly'] }]]) {
    await expect(422, 'bad keys', { body: { ...good, keys } })
  }
  await expect(422, 'bad name', { body: { ...good, name: 'x'.repeat(65) } })
  await expect(422, 'bad name', { body: { ...good, name: `"${'x'.repeat(65)}"` } }, '65 after the cleaning is still 65')
  await expect(422, 'bad name', { body: { ...good, name: 42 } })
  await expect(422, 'bad copy address', { body: { ...good, copyTo: 'not an address' } })
  await expect(422, 'bad copy address', { body: { ...good, copyTo: ['a@b.co'] } })
  assert.deepEqual(grantObjects(MAIL), [])
  // Nothing of the above counted toward the day, so the first good grant is the day's first.
  const res = await grant(env, ANA, {
    keys: [hex(ana), hex(ana).toUpperCase(), { key: hex(phone), can: 'read' }, { key: hex(jaime), can: [] }],
    name: '  "Ana" <x>\t', copyTo: ' Ana@Example.org ',
  })
  assert.equal(res.status, 200)
  const record = await res.json()
  assert.deepEqual(record.keys, [{ key: hex(ana), can: ALL }, { key: hex(phone), can: ['read'] }, { key: hex(jaime), can: [] }], 'deduped, lowercased, every form of can')
  assert.deepEqual([record.name, record.copyTo], ['Ana x', 'ana@example.org'])
  const sixtyFour = await grant(env, BEA, { keys: [hex(ana)], name: `"${'y'.repeat(64)}"` })
  assert.equal((await sixtyFour.json()).name, 'y'.repeat(64), '64 after cleaning is the most a From header takes')
  assert.deepEqual(JSON.parse(dec.decode(MAIL.map.get(`g/${new Date().toISOString().slice(0, 10)}`).bytes)), { n: 2 })
  // Another zone, once MAIL_ZONES names it; spelling and case are the host's problem, not the caller's.
  const zoned = setup({ MAIL_ZONES: 'other.org, Third.net' })
  assert.equal((await grant(zoned.env, 'ana@other.org', good)).status, 200)
  assert.equal((await grant(zoned.env, 'ana@third.net', good)).status, 200)
  assert.equal((await grant(zoned.env, 'ana@fourth.io', good)).status, 422)
})

test('a PUT replaces the grant (not a merge); the same signed PUT a second time is 409 and changes nothing', async () => {
  const { MAIL, env } = setup()
  assert.equal((await grant(env, ANA, { keys: [hex(ana), hex(phone)], name: 'Ana', copyTo: 'ana@example.org' })).status, 200)
  const second = await call('PUT', `/mail/grants/${at(ANA)}`, admin, { body: { keys: [hex(phone)] } })
  const res = await worker.fetch(make(second), env)
  assert.equal(res.status, 200)
  const record = await res.json()
  assert.deepEqual(record.keys, [{ key: hex(phone), can: ALL }])
  assert.ok(!('name' in record) && !('copyTo' in record), 'a replacement, not a merge')
  assert.deepEqual((await me(env, ana)).addresses, [], 'the key that was dropped no longer owns it')
  assert.deepEqual(await me(env, phone), { addresses: [ANA], names: {}, can: { [ANA]: ALL }, admin: false })
  assert.deepEqual((await receive(env, ANA)).log.forwarded, [], 'and no copy goes any more')
  assert.deepEqual(await answer(await worker.fetch(make(second), env)), [409, 'this signed request was already used'])
  assert.deepEqual(JSON.parse(MAIL.map.get(`grants/${ANA}`).customMetadata.grant).keys, [{ key: hex(phone), can: ALL }])
  assert.deepEqual(grantObjects(MAIL), [`grants/${ANA}`])
})

test('grants are capped per host per UTC day, counted under g/<day>; a bucket that cannot count refuses', async () => {
  const { MAIL, env } = setup({ MAX_GRANTS_PER_DAY: '2' })
  assert.equal((await grant(env, ANA, { keys: [hex(ana)] })).status, 200)
  assert.equal((await grant(env, BEA, { keys: [hex(phone)] })).status, 200)
  assert.deepEqual(await answer(await grant(env, 'cal@hypercomb.com', { keys: [hex(stranger)] })), [429, 'daily grant limit reached'])
  const day = new Date().toISOString().slice(0, 10)
  assert.deepEqual(JSON.parse(dec.decode(MAIL.map.get(`g/${day}`).bytes)), { n: 2 })
  assert.deepEqual(grantObjects(MAIL).sort(), [`grants/${ANA}`, `grants/${BEA}`])
  assert.equal((await revoke(env, ANA)).status, 204, 'a revoke is not a grant and is not counted')
  assert.deepEqual(JSON.parse(dec.decode(MAIL.map.get(`g/${day}`).bytes)), { n: 2 })
  const counting = setup()
  counting.MAIL.failPut = key => key.startsWith('g/')
  assert.deepEqual(await answer(await quiet(() => grant(counting.env, ANA, { keys: [hex(ana)] }))), [503, 'mailbox storage unavailable'])
  assert.deepEqual(grantObjects(counting.MAIL), [])
})

// ── the people, read once ───────────────────────────────────────────────────

test('the grants are read once per 10 s per isolate: a grant made here is seen at once, another isolate\'s once the cache ages', async () => {
  const { MAIL, env } = setup()
  await me(env, jaime)
  const before = MAIL.calls.list
  await me(env, jaime)
  await me(env, ana)
  await receive(env, ME)
  assert.equal(MAIL.calls.list, before, 'two reads and a receive, no more lists')
  // Another isolate writes a grant straight into the bucket: not seen until the cache ages …
  const foreign = JSON.stringify({ v: 1, keys: [{ key: hex(ana), can: ALL }], by: hex(admin), at: 1 })
  await MAIL.put(`grants/${ANA}`, foreign, { customMetadata: { grant: foreign } })
  assert.deepEqual((await me(env, ana)).addresses, [])
  const now = Date.now
  Date.now = () => now() + 11_000
  try {
    assert.deepEqual((await me(env, ana)).addresses, [ANA])
    assert.equal(MAIL.calls.list, before + 1, 'one list, when the cache had aged')
  } finally { Date.now = now }
  // … while a grant made in this isolate is seen at once, and so is its revoke.
  assert.equal((await grant(env, BEA, { keys: [hex(phone)] })).status, 200)
  assert.deepEqual((await me(env, phone)).addresses, [BEA])
  assert.deepEqual(Object.keys((await listed(env)).grants), [ANA, BEA, ME])
  assert.equal((await revoke(env, BEA)).status, 204)
  assert.deepEqual((await me(env, phone)).addresses, [])
  // Two buckets never share a reading.
  const other = setup()
  assert.deepEqual((await me(other.env, ana)).addresses, [])
})

test('a bucket that cannot list falls back to the secret alone, says so once without a key, and mail keeps flowing', async () => {
  const { MAIL, env } = setup()
  assert.equal((await grant(env, ANA, { keys: [hex(ana)] })).status, 200)
  const warnings = []
  const warn = console.warn
  console.warn = text => warnings.push(String(text))
  const list = MAIL.list.bind(MAIL)
  MAIL.list = async options => { if (options?.prefix === 'grants/') throw new Error('bucket unavailable'); return list(options) }
  const now = Date.now
  Date.now = () => now() + 11_000 // the cache has aged: the next reading goes to the bucket
  try {
    assert.deepEqual((await me(env, jaime)).addresses, [ME])
    assert.deepEqual((await me(env, ana)).addresses, [], 'the grant is not seen while the bucket cannot list')
    const { log } = await receive(env, ME, 'during')
    assert.deepEqual(log.rejected, [])
    assert.deepEqual(log.forwarded, ['me@example.org'])
    assert.equal((await hit(env, 'GET', `/mail/box/${at(ME)}`, jaime)).status, 200)
    assert.deepEqual(await answer(await hit(env, 'GET', '/mail/grants', admin)), [200, JSON.stringify({ zones: ['hypercomb.com'], grants: { [ME]: { keys: [{ key: hex(jaime), can: ALL }], name: 'Jaime', copyTo: 'me@example.org', source: 'secret' } } })])
    assert.equal(warnings.length, 1, 'said once')
    assert.match(warnings[0], /grants unavailable/)
    assert.ok(!warnings[0].includes(hex(ana)) && !warnings[0].includes(hex(jaime)) && !warnings[0].includes(hex(admin)), 'no key is logged')
    // The bucket back: the grant is seen again, and a later outage is said again.
    MAIL.list = list
    assert.deepEqual((await me(env, ana)).addresses, [ANA])
    MAIL.list = async options => { if (options?.prefix === 'grants/') throw new Error('bucket unavailable'); return list(options) }
    Date.now = () => now() + 22_000
    assert.deepEqual((await me(env, ana)).addresses, [])
    assert.equal(warnings.length, 2)
  } finally { Date.now = now; console.warn = warn; MAIL.list = list }
  // A bucket that will not take the grant says so (503), and nothing is written; a revoke it cannot look up too.
  const failing = setup()
  failing.MAIL.failPut = key => key.startsWith('grants/')
  assert.deepEqual(await answer(await quiet(() => grant(failing.env, ANA, { keys: [hex(ana)] }))), [503, 'mailbox storage unavailable'])
  assert.deepEqual(grantObjects(failing.MAIL), [])
  failing.MAIL.head = async () => { throw new Error('bucket unavailable') }
  assert.deepEqual(await answer(await quiet(() => revoke(failing.env, ANA))), [503, 'mailbox storage unavailable'])
})

// ── what the operator sees ──────────────────────────────────────────────────

test('GET /mail/grants shows the operator everything, sorted by address: the secret\'s entries marked and normalized, the grants with by and at', async () => {
  const { MAIL, env } = setup({
    MAIL_CONFIG: JSON.stringify({
      keys: {
        'Zed@hypercomb.com': [hex(jaime), { key: hex(phone), can: ['read'] }, hex(jaime)],
        [ME]: { key: hex(jaime), can: 'nope' },
        'ghost@hypercomb.com': 'REPLACE_WITH_HEX_PUBKEY',
        'not an address': hex(jaime),
      },
      names: { [ME]: 'Jaime "jwize"' },
      copyTo: { [ME]: 'me@example.org' },
    }),
    MAIL_ZONES: 'other.org,hypercomb.com',
  })
  // A grant whose metadata is missing (an operator wrote the object by hand) is read from its body.
  const bare = JSON.stringify({ v: 1, keys: [{ key: hex(ana), can: ['read', 'send'] }], name: 'Ana', by: hex(admin), at: 5 })
  await MAIL.put(`grants/${ANA}`, bare)
  await MAIL.put('grants/not an address', bare, { customMetadata: { grant: bare } }) // never an address: skipped
  await MAIL.put(`grants/${BEA}`, 'not json', { customMetadata: { grant: '{broken' } }) // never a record: skipped
  const res = await hit(env, 'GET', '/mail/grants', admin, { origin: 'https://hypercomb.io' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://hypercomb.io')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const shown = await res.json()
  assert.deepEqual(shown.zones, ['hypercomb.com', 'other.org'], 'the request\'s own zone first, each once')
  assert.deepEqual(Object.keys(shown.grants), [ANA, 'ghost@hypercomb.com', ME, 'zed@hypercomb.com'])
  assert.deepEqual(shown.grants[ANA], { keys: [{ key: hex(ana), can: ['read', 'send'] }], name: 'Ana', source: 'grant', by: hex(admin), at: 5 })
  assert.deepEqual(shown.grants['ghost@hypercomb.com'], { keys: [], source: 'secret' }, 'a secret entry with no valid key is shown as the broken thing it is')
  assert.deepEqual(shown.grants[ME], { keys: [{ key: hex(jaime), can: ['read'] }], name: 'Jaime jwize', copyTo: 'me@example.org', source: 'secret' })
  assert.deepEqual(shown.grants['zed@hypercomb.com'], { keys: [{ key: hex(jaime), can: ALL }, { key: hex(phone), can: ['read'] }], source: 'secret' })
  assert.ok(!JSON.stringify(shown).includes('not an address'))
  assert.deepEqual((await me(env, ana)).addresses, [ANA], 'the body-read grant counts everywhere')
})

test('DELETE: 404 with no grant, 409 for the secret\'s own entry, 204 for a grant — and only the grant object goes', async () => {
  const { MAIL, env } = setup()
  assert.deepEqual(await answer(await revoke(env, ANA)), [404, 'no grant'])
  assert.deepEqual(await answer(await revoke(env, ME)), [409, 'listed in the host\'s configuration, not a grant'])
  await grant(env, ANA, { keys: [hex(ana)] })
  const { sig } = await receive(env, ANA)
  assert.equal((await hit(env, 'PUT', `/mail/box/${at(ANA)}/${sig}/marks`, ana, { body: { read: true } })).status, 200)
  const kept = () => [...MAIL.map.keys()].filter(k => !/^(n|g)\//.test(k)).sort()
  const before = kept()
  assert.ok(before.includes(`grants/${ANA}`))
  assert.deepEqual(await answer(await revoke(env, ANA)), [204, ''])
  assert.deepEqual(kept(), before.filter(k => k !== `grants/${ANA}`), 'the mail and its marks stay; only the grant went')
  assert.deepEqual(await answer(await revoke(env, ANA)), [404, 'no grant'])
  assert.equal((await hit(env, 'GET', `/mail/box/${at(ANA)}`, ana)).status, 401, 'the key reads nothing now')
  // A replayed DELETE is 409, even once the address is granted again.
  const parts = await call('DELETE', `/mail/grants/${at(ANA)}`, admin)
  await grant(env, ANA, { keys: [hex(ana)] })
  assert.equal((await worker.fetch(make(parts), env)).status, 204)
  await grant(env, ANA, { keys: [hex(ana)] })
  assert.deepEqual(await answer(await worker.fetch(make(parts), env)), [409, 'this signed request was already used'])
  assert.ok(MAIL.map.has(`grants/${ANA}`), 'the replay changed nothing')
})

// ── /mail/me grows two fields ───────────────────────────────────────────────

test('/mail/me says whether the key may grant here and then on which zones; a stranger is told neither', async () => {
  const { env } = setup({ MAIL_ZONES: 'other.org' })
  assert.deepEqual(await me(env, admin), { addresses: [], names: {}, can: {}, admin: true, zones: ['hypercomb.com', 'other.org'] })
  assert.deepEqual(await me(env, jaime), { addresses: [ME], names: { [ME]: 'Jaime' }, can: { [ME]: ALL }, admin: false })
  assert.deepEqual(await me(env, stranger), { addresses: [], names: {}, can: {}, admin: false })
  // An admin named in the secret, who also owns an address.
  const viaSecret = setup({ ADMIN_KEYS: undefined, MAIL_CONFIG: JSON.stringify({ keys: { [ME]: hex(jaime) }, admins: [hex(jaime).toUpperCase(), 'junk', 7] }) })
  assert.deepEqual(await me(viaSecret.env, jaime), { addresses: [ME], names: {}, can: { [ME]: ALL }, admin: true, zones: ['hypercomb.com'] })
  assert.equal((await hit(viaSecret.env, 'GET', '/mail/grants', jaime)).status, 200)
  assert.equal((await hit(viaSecret.env, 'GET', '/mail/grants', admin)).status, 401)
  // Both lists together, with the spaces people type.
  const both = setup({ ADMIN_KEYS: ` ${hex(admin).toUpperCase()} , ${hex(stranger)},, `, MAIL_CONFIG: JSON.stringify({ keys: {}, admins: [hex(phone)] }) })
  for (const who of [admin, stranger, phone]) assert.equal((await me(both.env, who)).admin, true, 'admin')
  assert.equal((await me(both.env, ana)).admin, false)
  // Not a secret: the admin list from the plain var alone, with the secret unreadable.
  const broken = setup({ MAIL_CONFIG: '{not json', MAIL_KEYS: JSON.stringify({ [ME]: hex(jaime) }) })
  assert.deepEqual(await me(broken.env, admin), { addresses: [], names: {}, can: {}, admin: true, zones: ['hypercomb.com'] })
})
