// Marks and forgetting (plan section 3, H4): the owner marks a message read, hidden, flagged or
// deletable; the marks ride inline in the list; a message is deleted only once hidden AND deletable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import worker from './mail-worker/worker.js'
import { sha256Hex } from './mail-worker/seal.js'
import { FakeR2, streamOf } from './mail-test-helpers.js'

const enc = new TextEncoder()
const jaime = generateSecretKey()
const leanne = generateSecretKey()
const ME = 'jaime%40hypercomb.com'

function setup() {
  const MAIL = new FakeR2()
  const env = {
    MAIL,
    MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': getPublicKey(jaime), 'leanne@hypercomb.com': getPublicKey(leanne) }),
    ALLOWED_ORIGINS: 'https://hypercomb.io',
  }
  return { MAIL, env }
}

// A signed request; a body is committed to with the payload tag unless `payload` says otherwise. A nonce
// keeps two identical writes in one second two events (a write's event is spent once, R1 #5).
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
  return new Request(url, { method, headers, body: bytes })
}

async function receive(env, subject, to = 'jaime@hypercomb.com') {
  const raw = enc.encode(`From: a@example.org\r\nSubject: ${subject}\r\n\r\nbody of ${subject}\r\n`)
  await worker.email({ from: 'a@example.org', to, rawSize: raw.length, raw: streamOf(raw), forward: async () => {}, setReject: () => {} }, env)
  return sha256Hex(raw)
}

const list = async (env, folder = 'box', query = '') => (await (await worker.fetch(await call('GET', `/mail/${folder}/${ME}${query}`, jaime), env)).json()).items

test('marks merge, are stamped, and come back inline in the list (null where there are none)', async () => {
  const { env } = setup()
  const a = await receive(env, 'a')
  const b = await receive(env, 'b')

  const first = await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body: { read: true } }), env)
  assert.equal(first.status, 200)
  const one = await first.json()
  assert.equal(one.read, true)
  assert.equal(typeof one.at, 'number')

  const second = await (await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body: { flagged: true, read: false } }), env)).json()
  assert.deepEqual({ ...second, at: 0 }, { read: false, flagged: true, at: 0 })

  const items = await list(env)
  assert.deepEqual({ ...items.find(i => i.sig === a).marks, at: 0 }, { read: false, flagged: true, at: 0 })
  assert.equal(items.find(i => i.sig === b).marks, null)
})

test('marks are booleans from the four names only; anything else is 422 and changes nothing', async () => {
  const { MAIL, env } = setup()
  const a = await receive(env, 'a')
  for (const body of [{ read: 'yes' }, { read: 1 }, { spam: true }, { hidden: null }]) {
    const res = await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body }), env)
    assert.equal(res.status, 422, JSON.stringify(body))
  }
  assert.equal((await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body: '[true]' }), env)).status, 400)
  assert.equal((await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body: '{bad' }), env)).status, 400)
  assert.equal((await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body: { read: true }, contentType: 'text/plain' }), env)).status, 415)
  assert.equal((await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body: { read: true, pad: 'x'.repeat(2000) } }), env)).status, 413)
  assert.equal([...MAIL.map.keys()].filter(k => k.startsWith('marks/')).length, 0)
})

test('marks need the owner, bind the body, and only mark a message that exists', async () => {
  const { env } = setup()
  const a = await receive(env, 'a')
  const path = `/mail/box/${ME}/${a}/marks`
  assert.equal((await worker.fetch(await call('PUT', path, null, { body: { read: true } }), env)).status, 401)
  assert.equal((await worker.fetch(await call('PUT', path, leanne, { body: { read: true } }), env)).status, 401)
  assert.equal((await worker.fetch(await call('PUT', path, jaime, { body: { read: true }, payload: await sha256Hex(enc.encode('{"hidden":true}')) }), env)).status, 401)
  assert.equal((await worker.fetch(await call('PUT', `/mail/box/${ME}/${'0'.repeat(64)}/marks`, jaime, { body: { read: true } }), env)).status, 404)
  assert.equal((await worker.fetch(await call('GET', path, jaime), env)).status, 405)
  assert.equal((await worker.fetch(await call('PUT', `/mail/drafts/${ME}/${a}/marks`, jaime, { body: { read: true } }), env)).status, 405)
})

test('a stranger\'s PUT says nothing about whether an address exists', async () => {
  const { env } = setup()
  const a = await receive(env, 'a')
  const stranger = generateSecretKey()
  // Wrong content type and an oversized body: a real address and a ghost both answer 401.
  for (const address of [ME, 'ghost%40hypercomb.com']) {
    for (const options of [{ body: { read: true }, contentType: 'text/plain' }, { body: { pad: 'x'.repeat(4000) } }]) {
      assert.equal((await worker.fetch(await call('PUT', `/mail/box/${address}/${a}/marks`, stranger, options), env)).status, 401)
      assert.equal((await worker.fetch(await call('PUT', `/mail/drafts/${address}`, stranger, options), env)).status, 401)
    }
  }
})

test('delete is refused (409) until the message is hidden AND deletable, then removes it and its marks', async () => {
  const { MAIL, env } = setup()
  const a = await receive(env, 'a')
  const del = async () => worker.fetch(await call('DELETE', `/mail/box/${ME}/${a}`, jaime), env)
  const mark = async body => worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body }), env)

  const bare = await del()
  assert.equal(bare.status, 409)
  assert.match(await bare.text(), /hide it/)
  await mark({ hidden: true })
  assert.equal((await del()).status, 409)
  await mark({ hidden: false, deletable: true })
  assert.equal((await del()).status, 409)
  await mark({ hidden: true })
  const gone = await del()
  assert.equal(gone.status, 204)
  assert.equal(await gone.text(), '')
  const left = [...MAIL.map.keys()].filter(k => !k.startsWith('n/') && !k.startsWith('d/')).sort()
  assert.deepEqual(left.map(k => k.split('/').slice(0, 2).join('/').replace(/[a-f0-9]{64}/, 'POOL')), ['trash/POOL', 'trash/marks'], 'moved to trash, not destroyed')
  assert.deepEqual(await list(env), [])
  assert.equal((await del()).status, 404)
})

test('delete needs the owner, and works the same in Sent', async () => {
  const { MAIL, env } = setup()
  const a = await receive(env, 'a')
  assert.equal((await worker.fetch(await call('DELETE', `/mail/box/${ME}/${a}`, leanne), env)).status, 401)
  assert.equal((await worker.fetch(await call('DELETE', `/mail/box/${ME}/${a}`, null), env)).status, 401)
  assert.equal((await worker.fetch(await call('DELETE', `/mail/box/${ME}`, jaime), env)).status, 405)

  const pool = [...MAIL.map.keys()][0].split('/')[0]
  const sentPool = await sha256Hex(enc.encode('mail-sent:jaime@hypercomb.com'))
  const entry = MAIL.map.get(`${pool}/${a}`)
  MAIL.map.set(`${sentPool}/${a}`, entry)
  assert.equal((await worker.fetch(await call('DELETE', `/mail/sent/${ME}/${a}`, jaime), env)).status, 409)
  await worker.fetch(await call('PUT', `/mail/sent/${ME}/${a}/marks`, jaime, { body: { hidden: true, deletable: true } }), env)
  assert.equal((await worker.fetch(await call('DELETE', `/mail/sent/${ME}/${a}`, jaime), env)).status, 204)
  assert.ok(MAIL.map.has(`${pool}/${a}`), 'the inbox copy is its own and stays')
})

test('a long list gets its marks in a bounded number of bucket calls, across pages', async () => {
  const { MAIL, env } = setup()
  const sigs = []
  for (let i = 0; i < 12; i++) sigs.push(await receive(env, `m${i}`))
  for (const sig of sigs.filter((_, i) => i % 3 === 0)) {
    await worker.fetch(await call('PUT', `/mail/box/${ME}/${sig}/marks`, jaime, { body: { read: true } }), env)
  }
  await receive(env, 'x', 'leanne@hypercomb.com') // another pool's marks never leak in

  const seen = new Map()
  let cursor = null
  do {
    const before = MAIL.calls.list
    const page = await (await worker.fetch(await call('GET', `/mail/box/${ME}?limit=5${cursor ? `&cursor=${cursor}` : ''}`, jaime), env)).json()
    assert.ok(MAIL.calls.list - before <= 2, 'one list for the page, one for its marks')
    for (const item of page.items) seen.set(item.sig, item.marks)
    cursor = page.cursor
  } while (cursor)
  assert.equal(seen.size, 12)
  for (const [i, sig] of sigs.entries()) assert.equal(seen.get(sig)?.read ?? null, i % 3 === 0 ? true : null, `m${i}`)
})

test('CORS lets the reader PUT and DELETE', async () => {
  const { env } = setup()
  const preflight = await worker.fetch(new Request(`https://hypercomb.com/mail/box/${ME}`, { method: 'OPTIONS', headers: { origin: 'https://hypercomb.io' } }), env)
  assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/)
  assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/)
  const a = await receive(env, 'a')
  const res = await worker.fetch(await call('PUT', `/mail/box/${ME}/${a}/marks`, jaime, { body: { read: true }, origin: 'https://hypercomb.io' }), env)
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://hypercomb.io')
  assert.equal(res.headers.get('cache-control'), 'no-store')
})
