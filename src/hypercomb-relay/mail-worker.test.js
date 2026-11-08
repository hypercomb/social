import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import worker from './mail-worker/worker.js'
import { openMessage, openMeta, sha256Hex, sealMessageV1 } from './mail-worker/seal.js'
import { FakeR2 } from './mail-test-helpers.js'
import { poolMeaning } from './mail-address.js'

const enc = new TextEncoder()
const latin1 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s }
const BODY = 'SECRET-BODY-MARKER'
const SUBJECT = 'SECRET-SUBJECT-MARKER'
const RAW = enc.encode(`From: sender@example.org\r\nTo: jaime@hypercomb.com\r\nSubject: ${SUBJECT}\r\n\tcontinued\r\n\r\n${BODY}\r\n`)

// The bucket is the shared FakeR2 (mail-test-helpers.js), the same one the browser-side spec drives.

const ALL = ['read', 'mark', 'draft', 'delete', 'send']
const jaime = generateSecretKey()
const leanne = generateSecretKey()

function setup(extra = {}) {
  const MAIL = new FakeR2()
  const env = {
    MAIL,
    MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': getPublicKey(jaime), 'leanne@hypercomb.com': getPublicKey(leanne) }),
    ALLOWED_ORIGINS: 'https://hypercomb.io',
    ...extra,
  }
  return { MAIL, env }
}

function message({ to = 'jaime@hypercomb.com', from = 'sender@example.org', raw = RAW, copyFails = false } = {}) {
  const log = { forwarded: [], rejected: [] }
  return {
    log, from, to, rawSize: raw.length,
    raw: new Blob([raw]).stream(),
    forward: async address => { if (copyFails) throw new Error('destination not verified'); log.forwarded.push(address) },
    setReject: reason => { log.rejected.push(reason) },
  }
}

const quiet = async fn => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

function request(path, secret, { method = 'GET', origin, now } = {}) {
  const url = `https://hypercomb.com${path}`
  const headers = {}
  if (secret) {
    const event = finalizeEvent({ kind: 27235, created_at: now ?? Math.floor(Date.now() / 1000), content: '', tags: [['u', url], ['method', method]] }, secret)
    headers.authorization = `Nostr ${btoa(JSON.stringify(event))}`
  }
  if (origin) headers.origin = origin
  return new Request(url, { method, headers })
}

const everythingStored = MAIL => [...MAIL.map.values()].map(e => latin1(e.bytes) + ' ' + Object.values(e.customMetadata).join(' ')).join(' ')

// ── receiving ───────────────────────────────────────────────────────────────

test('a message is stored sealed: the bucket holds no plaintext, and the owner opens it', async () => {
  const { MAIL, env } = setup()
  const msg = message()
  await worker.email(msg, env)

  assert.deepEqual(msg.log, { forwarded: [], rejected: [] })
  assert.equal(MAIL.map.size, 1)
  const stored = everythingStored(MAIL)
  for (const marker of [BODY, SUBJECT, 'sender@example.org', 'jaime@hypercomb.com']) assert.ok(!stored.includes(marker), marker)

  const [key, entry] = [...MAIL.map.entries()][0]
  assert.equal(key.split('/')[1], await sha256Hex(RAW))
  assert.deepEqual((await openMessage(entry.bytes, jaime)).bytes, RAW)
  const meta = await openMeta(entry.customMetadata, jaime, key.split('/')[1]) // the list line is bound to its sig (R1 #11)
  assert.equal(meta.from, 'sender@example.org')
  assert.equal(meta.to, 'jaime@hypercomb.com')
  assert.equal(meta.subject, `${SUBJECT} continued`)
  assert.equal(meta.size, RAW.length)
})

test('a replay changes nothing: the first arrival time stands', async () => {
  const { MAIL, env } = setup()
  await worker.email(message(), env)
  const [key] = [...MAIL.map.keys()]
  const first = MAIL.map.get(key).customMetadata.at
  await new Promise(resolve => setTimeout(resolve, 15))
  await worker.email(message(), env)
  assert.equal(MAIL.map.size, 1)
  assert.equal(MAIL.map.get(key).customMetadata.at, first)
})

test('each recipient gets a copy sealed to their own key, in their own pool', async () => {
  const { MAIL, env } = setup()
  await worker.email(message(), env)
  await worker.email(message({ to: 'leanne@hypercomb.com' }), env)
  assert.equal(MAIL.map.size, 2)
  const [forJaime, forLeanne] = [...MAIL.map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, e]) => ({ key, e }))
  assert.notEqual(forJaime.key.split('/')[0], forLeanne.key.split('/')[0])
  for (const { key, e } of [forJaime, forLeanne]) {
    const mine = { ...e.customMetadata, sig: key.split('/')[1] }
    const secrets = [jaime, leanne]
    const opens = []
    for (const secret of secrets) { try { await openMeta(mine, secret); opens.push(true) } catch { opens.push(false) } }
    assert.equal(opens.filter(Boolean).length, 1, 'exactly one of the two keys opens each')
  }
})

test('an address with no key is not a mailbox: bounced, nothing stored', async () => {
  const { MAIL, env } = setup()
  const msg = message({ to: 'nobody@hypercomb.com' })
  await worker.email(msg, env)
  assert.equal(MAIL.map.size, 0)
  assert.deepEqual(msg.log.rejected, ['no such mailbox'])
})

test('a placeholder key is no key at all', async () => {
  const { MAIL, env } = setup({ MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': 'REPLACE_WITH_HEX_PUBKEY' }) })
  const msg = message()
  await worker.email(msg, env)
  assert.equal(MAIL.map.size, 0)
  assert.equal(msg.log.rejected.length, 1)
})

test('a message over the cap is not read into memory: copied if there is a copy address, else bounced', async () => {
  const { MAIL, env } = setup({ MAX_STORE_BYTES: '16' })
  const bounced = message()
  await worker.email(bounced, env)
  assert.equal(MAIL.map.size, 0)
  assert.deepEqual(bounced.log.rejected, ['message too large'])

  const copied = message()
  await worker.email(copied, { ...env, COPY_TO: JSON.stringify({ 'jaime@hypercomb.com': 'me@example.org' }) })
  assert.deepEqual(copied.log, { forwarded: ['me@example.org'], rejected: [] })
})

test('the bucket failing: the copy catches it, or the sender is told', async () => {
  const COPY = JSON.stringify({ 'jaime@hypercomb.com': 'me@example.org' })
  const withCopy = setup({ COPY_TO: COPY })
  withCopy.MAIL.failPut = true
  const caught = message()
  await quiet(() => worker.email(caught, withCopy.env))
  assert.deepEqual(caught.log, { forwarded: ['me@example.org'], rejected: [] })

  const without = setup()
  without.MAIL.failPut = true
  const told = message()
  await quiet(() => worker.email(told, without.env))
  assert.deepEqual(told.log.rejected, ['mailbox temporarily unavailable'])

  const both = setup({ COPY_TO: COPY })
  both.MAIL.failPut = true
  const neither = message({ copyFails: true })
  await quiet(() => worker.email(neither, both.env))
  assert.equal(neither.log.rejected.length, 1)
})

test('a stored message is also copied when a copy address is listed, never to another recipient\'s address', async () => {
  const COPY = JSON.stringify({ 'jaime@hypercomb.com': 'me@example.org' })
  const { MAIL, env } = setup({ COPY_TO: COPY })
  const mine = message()
  await worker.email(mine, env)
  assert.deepEqual(mine.log, { forwarded: ['me@example.org'], rejected: [] })
  assert.equal(MAIL.map.size, 1)

  const hers = message({ to: 'leanne@hypercomb.com' })
  await worker.email(hers, env)
  assert.deepEqual(hers.log, { forwarded: [], rejected: [] })
})

test('a broken COPY_TO or MAIL_KEYS is no copy and no keys, not a crash', async () => {
  const { MAIL, env } = setup({ COPY_TO: '{not json', MAIL_KEYS: '[1,2]' })
  const msg = message()
  await worker.email(msg, env)
  assert.equal(MAIL.map.size, 0)
  assert.deepEqual(msg.log.rejected, ['no such mailbox'])
})

// ── reading ─────────────────────────────────────────────────────────────────

test('the list needs the owner\'s signed request; anyone else, and an unknown mailbox, get the same 401', async () => {
  const { env } = setup()
  await worker.email(message(), env)
  const path = '/mail/box/jaime%40hypercomb.com'
  assert.equal((await worker.fetch(request(path), env)).status, 401)
  assert.equal((await worker.fetch(request(path, generateSecretKey()), env)).status, 401)
  assert.equal((await worker.fetch(request(path, leanne), env)).status, 401)
  assert.equal((await worker.fetch(request('/mail/box/ghost%40hypercomb.com', jaime), env)).status, 401)
  assert.equal((await worker.fetch(request(path, jaime, { now: Math.floor(Date.now() / 1000) - 600 }), env)).status, 401)
  assert.equal((await worker.fetch(request(path, jaime), env)).status, 200)
})

test('the owner lists sealed metadata and fetches a sealed message, and opens both', async () => {
  const { env } = setup()
  await worker.email(message(), env)
  await worker.email(message({ raw: enc.encode(`Subject: second\r\n\r\nother body\r\n`) }), env)
  await worker.email(message({ to: 'leanne@hypercomb.com' }), env)

  const res = await worker.fetch(request('/mail/box/jaime%40hypercomb.com', jaime), env)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const { items, cursor } = await res.json()
  assert.equal(cursor, null)
  assert.equal(items.length, 2)
  const metas = await Promise.all(items.map(i => openMeta(i, jaime)))
  assert.deepEqual(metas.map(m => m.subject).sort(), [`${SUBJECT} continued`, 'second'].sort())

  const first = items[metas.findIndex(m => m.subject.startsWith('SECRET'))]
  const one = await worker.fetch(request(`/mail/box/jaime%40hypercomb.com/${first.sig}`, jaime), env)
  assert.equal(one.status, 200)
  assert.equal(one.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual((await openMessage(new Uint8Array(await one.arrayBuffer()), jaime)).bytes, RAW)

  assert.equal((await worker.fetch(request(`/mail/box/jaime%40hypercomb.com/${'0'.repeat(64)}`, jaime), env)).status, 404)
})

test('one mailbox\'s signature never opens another\'s message, even by sig', async () => {
  const { MAIL, env } = setup()
  await worker.email(message({ to: 'leanne@hypercomb.com' }), env)
  const sig = await sha256Hex(RAW)
  assert.equal((await worker.fetch(request(`/mail/box/jaime%40hypercomb.com/${sig}`, jaime), env)).status, 404)
  assert.equal((await worker.fetch(request(`/mail/box/leanne%40hypercomb.com/${sig}`, jaime), env)).status, 401)
  assert.equal(MAIL.map.size, 1)
})

test('the list pages with a cursor', async () => {
  const { env } = setup()
  for (let i = 0; i < 5; i++) await worker.email(message({ raw: enc.encode(`Subject: m${i}\r\n\r\nb${i}\r\n`) }), env)
  const seen = new Set()
  let cursor = null
  let pages = 0
  do {
    const path = `/mail/box/jaime%40hypercomb.com?limit=2${cursor ? `&cursor=${cursor}` : ''}`
    const page = await (await worker.fetch(request(path, jaime), env)).json()
    page.items.forEach(i => seen.add(i.sig))
    cursor = page.cursor
    pages++
  } while (cursor)
  assert.equal(seen.size, 5)
  assert.equal(pages, 3)
})

test('bad paths, bad addresses and other methods', async () => {
  const { env } = setup()
  assert.equal((await worker.fetch(request('/mail/elsewhere', jaime), env)).status, 404)
  assert.equal((await worker.fetch(request('/mail/box/not-an-address', jaime), env)).status, 422)
  assert.equal((await worker.fetch(request('/mail/box/%E0%A4%A', jaime), env)).status, 422)
  assert.equal((await worker.fetch(request('/mail/box/jaime%40hypercomb.com', jaime, { method: 'POST' }), env)).status, 405)
})

test('CORS: only a listed origin is answered, and the preflight says so', async () => {
  const { env } = setup()
  const path = '/mail/box/jaime%40hypercomb.com'
  const allowed = await worker.fetch(request(path, jaime, { origin: 'https://hypercomb.io' }), env)
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://hypercomb.io')
  assert.equal(allowed.headers.get('vary'), 'Origin')

  const stranger = await worker.fetch(request(path, jaime, { origin: 'https://evil.example' }), env)
  assert.equal(stranger.headers.get('access-control-allow-origin'), null)

  const preflight = await worker.fetch(request(path, null, { method: 'OPTIONS', origin: 'https://hypercomb.io' }), env)
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/)
  assert.equal((await worker.fetch(request(path, null, { method: 'OPTIONS', origin: 'https://evil.example' }), env)).status, 403)

  const none = setup({ ALLOWED_ORIGINS: '' })
  assert.equal((await worker.fetch(request(path, jaime, { origin: 'https://hypercomb.io' }), none.env)).headers.get('access-control-allow-origin'), null)
})

// ── which addresses are mine ────────────────────────────────────────────────

test('/mail/me tells a key its own addresses, and a stranger nothing', async () => {
  const both = setup({ MAIL_KEYS: JSON.stringify({
    'jaime@hypercomb.com': getPublicKey(jaime),
    'also-jaime@hypercomb.com': getPublicKey(jaime),
    'leanne@hypercomb.com': getPublicKey(leanne),
    'ghost@hypercomb.com': 'REPLACE_WITH_HEX_PUBKEY',
  }) })
  const ask = async secret => (await worker.fetch(request('/mail/me', secret), both.env))

  const mine = await ask(jaime)
  assert.equal(mine.status, 200)
  assert.deepEqual(await mine.json(), { addresses: ['also-jaime@hypercomb.com', 'jaime@hypercomb.com'], names: {}, can: { 'also-jaime@hypercomb.com': ALL, 'jaime@hypercomb.com': ALL } })
  assert.deepEqual(await (await ask(leanne)).json(), { addresses: ['leanne@hypercomb.com'], names: {}, can: { 'leanne@hypercomb.com': ALL } })
  assert.deepEqual(await (await ask(generateSecretKey())).json(), { addresses: [], names: {}, can: {} })
})

test('/mail/me needs a signed, fresh request and answers only GET', async () => {
  const { env } = setup()
  assert.equal((await worker.fetch(request('/mail/me'), env)).status, 401)
  assert.equal((await worker.fetch(request('/mail/me', jaime, { now: Math.floor(Date.now() / 1000) - 600 }), env)).status, 401)
  assert.equal((await worker.fetch(request('/mail/me', jaime, { method: 'POST' }), env)).status, 405)
  const cors = await worker.fetch(request('/mail/me', jaime, { origin: 'https://hypercomb.io' }), env)
  assert.equal(cors.headers.get('access-control-allow-origin'), 'https://hypercomb.io')
})

test('anyKey is only for /mail/me: no mailbox route accepts a stranger because of it', async () => {
  const { env } = setup()
  const stranger = generateSecretKey()
  for (const path of ['/mail/box/jaime%40hypercomb.com', '/mail/sent/jaime%40hypercomb.com']) {
    assert.equal((await worker.fetch(request(path, stranger), env)).status, 401, path)
  }
})

// ── the one secret ──────────────────────────────────────────────────────────

test('MAIL_CONFIG (one secret) carries the keys and the copies, and wins over the plain vars', async () => {
  const MAIL = new FakeR2()
  const env = {
    MAIL,
    MAIL_CONFIG: JSON.stringify({ keys: { 'jaime@hypercomb.com': getPublicKey(jaime) }, copyTo: { 'jaime@hypercomb.com': 'me@example.org' } }),
    MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': getPublicKey(leanne) }),
    COPY_TO: '{}',
  }
  const msg = message()
  await worker.email(msg, env)
  assert.equal(MAIL.map.size, 1)
  assert.deepEqual(msg.log.forwarded, ['me@example.org'])
  const [, entry] = [...MAIL.map.entries()][0]
  assert.deepEqual((await openMessage(entry.bytes, jaime)).bytes, RAW) // sealed to the secret's key, not the var's
  assert.deepEqual(await (await worker.fetch(request('/mail/me', jaime), env)).json(), { addresses: ['jaime@hypercomb.com'], names: {}, can: { 'jaime@hypercomb.com': ALL } })
  assert.deepEqual(await (await worker.fetch(request('/mail/me', leanne), env)).json(), { addresses: [], names: {}, can: {} })
})

test('a secret that is not JSON leaves the plain vars in charge', async () => {
  const env = { MAIL: new FakeR2(), MAIL_CONFIG: '{not json', MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': getPublicKey(jaime) }) }
  assert.deepEqual(await (await worker.fetch(request('/mail/me', jaime), env)).json(), { addresses: ['jaime@hypercomb.com'], names: {}, can: { 'jaime@hypercomb.com': ALL } })
})

// ── many keys per address (v2) ──────────────────────────────────────────────

const phone = generateSecretKey()
const recovery = generateSecretKey()

test('an address may list several keys: mail is sealed to each, and each reads it and asks /mail/me', async () => {
  const { MAIL, env } = setup({ MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': [getPublicKey(jaime), getPublicKey(phone).toUpperCase(), 'not-a-key', getPublicKey(recovery)] }) })
  await worker.email(message(), env)
  const [, entry] = [...MAIL.map.entries()][0]
  assert.equal(JSON.parse(entry.customMetadata.wraps).length, 3, 'the invalid entry is skipped')
  for (const secret of [jaime, phone, recovery]) {
    assert.deepEqual((await openMessage(entry.bytes, secret)).bytes, RAW)
    assert.equal((await worker.fetch(request('/mail/box/jaime%40hypercomb.com', secret), env)).status, 200)
    assert.deepEqual((await (await worker.fetch(request('/mail/me', secret), env)).json()).addresses, ['jaime@hypercomb.com'])
  }
  assert.equal((await worker.fetch(request('/mail/box/jaime%40hypercomb.com', leanne), env)).status, 401)
})

test('more than three keys: the first three own the address, and the operator is told once', async () => {
  const keys = [jaime, phone, recovery, leanne].map(getPublicKey)
  const { MAIL, env } = setup({ MAIL_KEYS: JSON.stringify({ 'many@hypercomb.com': keys }) })
  const warnings = []
  const warn = console.warn
  console.warn = text => warnings.push(String(text))
  try {
    await worker.email(message({ to: 'many@hypercomb.com' }), env)
    await worker.email(message({ to: 'many@hypercomb.com', raw: enc.encode('Subject: two\r\n\r\nb\r\n') }), env)
  } finally { console.warn = warn }
  assert.equal(warnings.length, 1)
  assert.ok(!warnings[0].includes(keys[0]), 'no key is logged')
  const [, entry] = [...MAIL.map.entries()][0]
  assert.deepEqual(JSON.parse(entry.customMetadata.wraps).map(w => w.to), keys.slice(0, 3))
  assert.equal((await worker.fetch(request('/mail/box/many%40hypercomb.com', leanne), env)).status, 401)
})

test('/mail/me answers names for the signer\'s own addresses only, cleaned for a From header', async () => {
  const { env } = setup({
    MAIL_CONFIG: JSON.stringify({
      keys: { 'jaime@hypercomb.com': getPublicKey(jaime), 'leanne@hypercomb.com': getPublicKey(leanne) },
      names: { 'jaime@hypercomb.com': 'Jaime "jwize" <x>', 'leanne@hypercomb.com': 'Leanne' },
    }),
  })
  assert.deepEqual(await (await worker.fetch(request('/mail/me', jaime), env)).json(), { addresses: ['jaime@hypercomb.com'], names: { 'jaime@hypercomb.com': 'Jaime jwize x' }, can: { 'jaime@hypercomb.com': ALL } })
  assert.deepEqual(await (await worker.fetch(request('/mail/me', leanne), env)).json(), { addresses: ['leanne@hypercomb.com'], names: { 'leanne@hypercomb.com': 'Leanne' }, can: { 'leanne@hypercomb.com': ALL } })
})

// ── the sealed meta of a received message ───────────────────────────────────

const THREADED = enc.encode([
  'From: Ana <ana@example.org>', 'To: jaime@hypercomb.com', 'Subject: =?utf-8?q?caf=C3=A9?=', 'Date: Fri, 6 Nov 2026 10:00:00 +0000',
  'Message-ID: <m1@example.org>', 'In-Reply-To: <p0@example.org> <p1@example.org>',
  'References: <r1@x.org> <r2@x.org>', '\t<r3@x.org> <r4@x.org> not-an-id',
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="outer"', '',
  'preamble', '--outer', 'Content-Type: multipart/alternative; boundary=inner', '',
  '--inner', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
  'Hola, caf=C3=A9 con   leche =', 'tomorrow?', '', '--inner', 'Content-Type: text/html', '', '<p>ignored</p>', '--inner--',
  '--outer', 'Content-Type: application/pdf; name="menu.pdf"', 'Content-Disposition: attachment; filename="menu.pdf"', 'Content-Transfer-Encoding: base64', '',
  'JVBERi0=', '--outer--', '',
].join('\r\n'))

test('received meta carries the threading ids, the date, attachments and a decoded preview', async () => {
  const { MAIL, env } = setup()
  await worker.email(message({ raw: THREADED }), env)
  const [key, entry] = [...MAIL.map.entries()][0]
  const meta = await openMeta(entry.customMetadata, jaime, key.split('/')[1])
  assert.equal(meta.subject, '=?utf-8?q?caf=C3=A9?=')
  assert.equal(meta.messageId, '<m1@example.org>')
  assert.equal(meta.inReplyTo, '<p0@example.org>')
  assert.deepEqual(meta.references, ['<r2@x.org>', '<r3@x.org>', '<r4@x.org>'])
  assert.equal(meta.date, 'Fri, 6 Nov 2026 10:00:00 +0000')
  assert.equal(meta.hasAttachments, true)
  assert.equal(meta.preview, 'Hola, café con leche tomorrow?')
  assert.equal(meta.size, THREADED.length)
  assert.equal(entry.customMetadata.v, '2')
})

test('a base64 text part previews decoded, cut to 120 characters; a plain message previews its body', async () => {
  const long = 'ünïcode '.repeat(40)
  const b64 = btoa(String.fromCharCode(...enc.encode(long))).replace(/.{76}/g, '$&\r\n')
  const raw = enc.encode(`Subject: b\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}\r\n`)
  const { MAIL, env } = setup()
  await worker.email(message({ raw }), env)
  await worker.email(message({ raw: RAW }), env)
  const metas = await Promise.all([...MAIL.map.entries()].map(([k, e]) => openMeta(e.customMetadata, jaime, k.split('/')[1])))
  const b = metas.find(m => m.subject === 'b')
  assert.equal(b.preview, long.trim().slice(0, 120))
  assert.equal(b.hasAttachments, false)
  const plain = metas.find(m => m.subject !== 'b')
  assert.equal(plain.preview, BODY)
  assert.equal(plain.messageId, undefined)
})

test('the scan stops at 64 KB: a text part beyond it gives no preview', async () => {
  const filler = 'X-Filler: ' + 'a'.repeat(70 * 1024)
  const raw = enc.encode(`Subject: far\r\n${filler}\r\nContent-Type: text/plain\r\n\r\nlate body\r\n`)
  const { MAIL, env } = setup()
  await worker.email(message({ raw }), env)
  const [[key, entry]] = [...MAIL.map.entries()]
  const meta = await openMeta(entry.customMetadata, jaime, key.split('/')[1])
  assert.equal(meta.subject, 'far')
  assert.equal(meta.preview, undefined)
  assert.equal(meta.size, raw.length)
})

test('a malformed MIME message still files', async () => {
  const raw = enc.encode('Subject: broken\r\nContent-Type: multipart/mixed\r\n\r\n--nothing\r\n')
  const { MAIL, env } = setup()
  const msg = message({ raw })
  await worker.email(msg, env)
  assert.equal(MAIL.map.size, 1)
  assert.deepEqual(msg.log.rejected, [])
})

// ── v1 objects in the live bucket ───────────────────────────────────────────

test('a v1 object already in the bucket lists as v 1 (no wraps), fetches, and opens', async () => {
  const { MAIL, env } = setup()
  const pool = await sha256Hex(enc.encode(poolMeaning('jaime@hypercomb.com')))
  const old = await sealMessageV1(RAW, getPublicKey(jaime), { subject: 'old', size: RAW.length, at: 7 })
  await MAIL.put(`${pool}/${old.sig}`, old.envelope, { customMetadata: old.customMetadata })
  await worker.email(message({ raw: enc.encode('Subject: new\r\n\r\nn\r\n') }), env)

  const { items } = await (await worker.fetch(request('/mail/box/jaime%40hypercomb.com', jaime), env)).json()
  const v1 = items.find(i => i.sig === old.sig)
  const v2 = items.find(i => i.sig !== old.sig)
  assert.equal(v1.v, 1)
  assert.ok(!('wraps' in v1))
  assert.equal(v1.marks, null)
  assert.equal(v2.v, 2)
  assert.ok(Array.isArray(v2.wraps))
  assert.equal((await openMeta(v1, jaime)).subject, 'old')
  assert.equal((await openMeta(v2, jaime)).subject, 'new')
  const one = await worker.fetch(request(`/mail/box/jaime%40hypercomb.com/${old.sig}`, jaime), env)
  assert.deepEqual((await openMessage(new Uint8Array(await one.arrayBuffer()), jaime)).bytes, RAW)
})
