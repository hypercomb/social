// Pins the fixes for the R1 security review (side-session-notes/…/R1-security-review.md), one block
// per finding, so none of them can quietly come undone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import worker from './mail-worker/worker.js'
import { openMessage, openMeta, sealMessage, sealMetaUnbound, unwrapKey, sha256Hex } from './mail-worker/seal.js'
import { FakeR2, streamOf, quiet } from './mail-test-helpers.js'
import { poolMeaning } from './mail-address.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const jaime = generateSecretKey()
const recovery = generateSecretKey()
const stranger = generateSecretKey()
const ME = 'jaime%40hypercomb.com'
const GHOST = 'ghost%40hypercomb.com'
const MESSAGE = { from: 'jaime@hypercomb.com', to: 'friend@example.org', subject: 'hello', text: 'body' }

function fakeEmail() {
  const calls = []
  return { calls, send: async message => { calls.push(structuredClone(message)); return { messageId: `<id-${calls.length}@hypercomb.com>` } } }
}

function setup(vars = {}) {
  const MAIL = new FakeR2()
  const EMAIL = fakeEmail()
  const env = {
    MAIL, EMAIL,
    MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': [getPublicKey(jaime), { key: getPublicKey(recovery), can: ['read'] }] }),
    ...vars,
  }
  return { MAIL, EMAIL, env }
}

// A signed request with a fresh nonce, or one built from a given authorization (to replay it exactly).
async function call(method, path, secret, { body, kind = 27235, created_at, nonce = true } = {}) {
  const url = `https://hypercomb.com${path}`
  const bytes = body === undefined ? undefined : enc.encode(typeof body === 'string' ? body : JSON.stringify(body))
  const headers = {}
  if (bytes) headers['content-type'] = 'application/json'
  if (secret) {
    const tags = [['u', url], ['method', method]]
    if (nonce) tags.push(['nonce', crypto.randomUUID()])
    if (bytes) tags.push(['payload', await sha256Hex(bytes)])
    const event = finalizeEvent({ kind, created_at: created_at ?? Math.floor(Date.now() / 1000), content: '', tags }, secret)
    headers.authorization = `Nostr ${btoa(JSON.stringify(event))}`
  }
  return { url, method, headers, bytes }
}
const make = ({ url, method, headers, bytes }) => new Request(url, { method, headers, body: bytes })

async function receive(env, subject) {
  const raw = enc.encode(`From: a@example.org\r\nSubject: ${subject}\r\n\r\nbody of ${subject}\r\n`)
  await worker.email({ from: 'a@example.org', to: 'jaime@hypercomb.com', rawSize: raw.length, raw: streamOf(raw), forward: async () => {}, setReject: () => {} }, env)
  return sha256Hex(raw)
}

// ── #4: a stranger cannot tell a real address from a ghost ──────────────────

test('R1 #4: every refusal before ownership is the same 401 "not authorized", for a real address and a ghost', async () => {
  const { env } = setup()
  const sig = await receive(env, 'a')
  const forged = async (method, path, body) => {
    const r = await call(method, path, stranger, { body })
    const event = JSON.parse(atob(r.headers.authorization.slice(6)))
    event.content = 'changed after signing'
    return { ...r, headers: { ...r.headers, authorization: `Nostr ${btoa(JSON.stringify(event))}` } }
  }
  const tokens = {
    none: (m, p, body) => call(m, p, null, { body }),
    malformed: async (m, p, body) => { const r = await call(m, p, null, { body }); return { ...r, headers: { ...r.headers, authorization: 'Nostr !!!' } } },
    badSignature: forged,
    wrongKind: (m, p, body) => call(m, p, stranger, { body, kind: 1 }),
    stale: (m, p, body) => call(m, p, stranger, { body, created_at: Math.floor(Date.now() / 1000) - 600 }),
    strangerKey: (m, p, body) => call(m, p, stranger, { body }),
  }
  const routes = address => [
    ['GET', `/mail/box/${address}`],
    ['PUT', `/mail/drafts/${address}`, { subject: 's' }],
    ['PUT', `/mail/box/${address}/${sig}/marks`, { read: true }],
    ['DELETE', `/mail/box/${address}/${sig}`],
  ]
  for (const [name, token] of Object.entries(tokens)) {
    for (const [i, [method, path, body]] of routes(ME).entries()) {
      const [, ghostPath, ghostBody] = routes(GHOST)[i]
      const real = await worker.fetch(make(await token(method, path, body)), env)
      const ghost = await worker.fetch(make(await token(method, ghostPath, ghostBody)), env)
      assert.deepEqual([real.status, await real.text()], [401, 'not authorized'], `${name} ${method} ${path}`)
      assert.deepEqual([ghost.status, await ghost.text()], [401, 'not authorized'], `${name} ${method} ghost`)
    }
    for (const from of ['jaime@hypercomb.com', 'ghost@hypercomb.com']) {
      const res = await worker.fetch(make(await token('POST', '/mail/send', { ...MESSAGE, from })), env)
      assert.deepEqual([res.status, await res.text()], [401, 'not authorized'], `${name} send as ${from}`)
    }
  }
  assert.equal(env.EMAIL.calls.length, 0)
})

test('R1 #4: an owner still hears the precise reason, so a stale clock is debuggable', async () => {
  const { env } = setup()
  const res = await worker.fetch(make(await call('GET', `/mail/box/${ME}`, jaime, { created_at: Math.floor(Date.now() / 1000) - 600 })), env)
  assert.deepEqual([res.status, await res.text()], [401, 'auth token outside freshness window'])
})

// ── #5: a signed write is spent once ────────────────────────────────────────

test('R1 #5: a replayed send answers 409 and Cloudflare is called once', async () => {
  const { EMAIL, env } = setup()
  const once = await call('POST', '/mail/send', jaime, { body: MESSAGE })
  assert.equal((await worker.fetch(make(once), env)).status, 200)
  const again = await worker.fetch(make(once), env)
  assert.equal(again.status, 409)
  assert.equal(await again.text(), 'this signed request was already used')
  assert.equal((await worker.fetch(make(once), env)).status, 409)
  assert.equal(EMAIL.calls.length, 1)
})

test('R1 #5: replayed marks, drafts and deletes answer 409; reads are not spent', async () => {
  const { MAIL, env } = setup()
  const sig = await receive(env, 'a')
  const marks = await call('PUT', `/mail/box/${ME}/${sig}/marks`, jaime, { body: { hidden: true, deletable: true } })
  assert.equal((await worker.fetch(make(marks), env)).status, 200)
  assert.equal((await worker.fetch(make(marks), env)).status, 409)

  const draft = await call('PUT', `/mail/drafts/${ME}`, jaime, { body: { subject: 'd' } })
  assert.equal((await worker.fetch(make(draft), env)).status, 200)
  assert.equal((await worker.fetch(make(draft), env)).status, 409)

  const pool = await sha256Hex(enc.encode(poolMeaning('jaime@hypercomb.com')))
  const del = await call('DELETE', `/mail/box/${ME}/${sig}`, jaime)
  assert.equal((await worker.fetch(make(del), env)).status, 204)
  MAIL.map.set(`${pool}/${sig}`, MAIL.map.get(`trash/${pool}/${sig}`)) // put it back, then replay the delete
  await worker.fetch(make(await call('PUT', `/mail/box/${ME}/${sig}/marks`, jaime, { body: { hidden: true, deletable: true } })), env)
  assert.equal((await worker.fetch(make(del), env)).status, 409)
  assert.ok(MAIL.map.has(`${pool}/${sig}`), 'the replayed delete did nothing')

  const read = await call('GET', `/mail/box/${ME}`, jaime)
  assert.equal((await worker.fetch(make(read), env)).status, 200)
  assert.equal((await worker.fetch(make(read), env)).status, 200)
})

test('R1 #5: two identical writes in one second without a nonce are one event — the client must add one', async () => {
  const { env } = setup()
  const sig = await receive(env, 'a')
  const created_at = Math.floor(Date.now() / 1000)
  const first = await call('PUT', `/mail/box/${ME}/${sig}/marks`, jaime, { body: { read: true }, nonce: false, created_at })
  const second = await call('PUT', `/mail/box/${ME}/${sig}/marks`, jaime, { body: { read: true }, nonce: false, created_at })
  const idOf = r => JSON.parse(atob(r.headers.authorization.slice(6))).id
  assert.equal(idOf(first), idOf(second), 'same tags, same second: the same event id (the signatures differ, the id does not)')
  assert.equal((await worker.fetch(make(first), env)).status, 200)
  assert.equal((await worker.fetch(make(second), env)).status, 409)
})

test('R1 #5: spent records are swept once past the freshness window', async () => {
  const { MAIL, env } = setup()
  const oldMinute = String(Math.floor(Date.now() / 60000) - 10).padStart(10, '0')
  await MAIL.put(`n/${oldMinute}/${'a'.repeat(64)}`, '')
  await worker.fetch(make(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: { subject: 'd' } })), env)
  const spent = [...MAIL.map.keys()].filter(k => k.startsWith('n/'))
  assert.equal(spent.length, 1, 'the old record went, the new one stays')
  assert.ok(!spent[0].includes(oldMinute))
})

test('R1 #5: a bucket that cannot record the event does nothing (503)', async () => {
  const { EMAIL, MAIL, env } = setup()
  MAIL.failPut = key => key.startsWith('n/')
  const res = await quiet(async () => worker.fetch(make(await call('POST', '/mail/send', jaime, { body: MESSAGE })), env))
  assert.equal(res.status, 503)
  assert.equal(EMAIL.calls.length, 0)
})

// ── #6: roles, trash, and a delete cap ──────────────────────────────────────

test('R1 #6: a read-only key reads, and is refused (403) for marks, drafts, delete and send', async () => {
  const { EMAIL, env } = setup()
  const sig = await receive(env, 'a')
  assert.equal((await worker.fetch(make(await call('GET', `/mail/box/${ME}`, recovery)), env)).status, 200)
  const one = await worker.fetch(make(await call('GET', `/mail/box/${ME}/${sig}`, recovery)), env)
  assert.equal(one.status, 200)
  assert.ok((await openMessage(new Uint8Array(await one.arrayBuffer()), recovery)).bytes.length > 0, 'still sealed to the recovery key')
  const refused = [
    [await call('PUT', `/mail/box/${ME}/${sig}/marks`, recovery, { body: { hidden: true } }), 'this key may not mark'],
    [await call('PUT', `/mail/drafts/${ME}`, recovery, { body: { subject: 'd' } }), 'this key may not draft'],
    [await call('DELETE', `/mail/box/${ME}/${sig}`, recovery), 'this key may not delete'],
    [await call('POST', '/mail/send', recovery, { body: MESSAGE }), 'this key may not send'],
  ]
  for (const [request, reason] of refused) {
    const res = await worker.fetch(make(request), env)
    assert.deepEqual([res.status, await res.text()], [403, reason])
  }
  assert.equal(EMAIL.calls.length, 0)
  const me = await (await worker.fetch(make(await call('GET', '/mail/me', recovery)), env)).json()
  assert.deepEqual(me.can, { 'jaime@hypercomb.com': ['read'] })
  assert.deepEqual((await (await worker.fetch(make(await call('GET', '/mail/me', jaime)), env)).json()).can, { 'jaime@hypercomb.com': ['read', 'mark', 'draft', 'delete', 'send'] })
})

test('R1 #6: a `can` that is not a list is read-only; unknown acts are ignored; a plain string is everything', async () => {
  const { env } = setup({
    MAIL_KEYS: JSON.stringify({
      'a@hypercomb.com': { key: getPublicKey(jaime), can: 'send' },
      'b@hypercomb.com': { key: getPublicKey(jaime), can: ['send', 'fly'] },
      'c@hypercomb.com': getPublicKey(jaime),
    }),
  })
  const me = await (await worker.fetch(make(await call('GET', '/mail/me', jaime)), env)).json()
  assert.deepEqual(me.can, { 'a@hypercomb.com': ['read'], 'b@hypercomb.com': ['send'], 'c@hypercomb.com': ['read', 'mark', 'draft', 'delete', 'send'] })
})

test('R1 #6: a delete moves the envelope and its marks to trash, where the owner can still open it', async () => {
  const { MAIL, env } = setup()
  const sig = await receive(env, 'kept')
  const pool = await sha256Hex(enc.encode(poolMeaning('jaime@hypercomb.com')))
  const original = MAIL.map.get(`${pool}/${sig}`)
  await worker.fetch(make(await call('PUT', `/mail/box/${ME}/${sig}/marks`, jaime, { body: { hidden: true, deletable: true, flagged: true } })), env)
  assert.equal((await worker.fetch(make(await call('DELETE', `/mail/box/${ME}/${sig}`, jaime)), env)).status, 204)

  assert.ok(!MAIL.map.has(`${pool}/${sig}`))
  assert.ok(!MAIL.map.has(`marks/${pool}/${sig}`))
  const trashed = MAIL.map.get(`trash/${pool}/${sig}`)
  assert.deepEqual(trashed.bytes, original.bytes)
  assert.deepEqual(trashed.customMetadata, original.customMetadata)
  assert.equal((await openMeta({ ...trashed.customMetadata, sig }, jaime)).subject, 'kept')
  const marks = JSON.parse(dec.decode(MAIL.map.get(`trash/marks/${pool}/${sig}`).bytes))
  assert.equal(marks.flagged, true)
  assert.equal(typeof marks.deletedAt, 'number')
  assert.equal(marks.by, getPublicKey(jaime))
})

test('R1 #6: the trash copy failing leaves the message where it was', async () => {
  const { MAIL, env } = setup()
  const sig = await receive(env, 'a')
  await worker.fetch(make(await call('PUT', `/mail/box/${ME}/${sig}/marks`, jaime, { body: { hidden: true, deletable: true } })), env)
  MAIL.failPut = key => key.startsWith('trash/')
  const res = await quiet(async () => worker.fetch(make(await call('DELETE', `/mail/box/${ME}/${sig}`, jaime)), env))
  assert.equal(res.status, 503)
  const pool = await sha256Hex(enc.encode(poolMeaning('jaime@hypercomb.com')))
  assert.ok(MAIL.map.has(`${pool}/${sig}`))
})

test('R1 #6: deletes are capped per address per day', async () => {
  const { env } = setup({ MAX_DELETE_PER_DAY: '1' })
  const drafts = []
  for (const subject of ['one', 'two']) drafts.push((await (await worker.fetch(make(await call('PUT', `/mail/drafts/${ME}`, jaime, { body: { subject } })), env)).json()).sig)
  assert.equal((await worker.fetch(make(await call('DELETE', `/mail/drafts/${ME}/${drafts[0]}`, jaime)), env)).status, 204)
  const second = await worker.fetch(make(await call('DELETE', `/mail/drafts/${ME}/${drafts[1]}`, jaime)), env)
  assert.deepEqual([second.status, await second.text()], [429, 'daily delete limit reached'])
})

// ── #7: invisible characters in filenames ───────────────────────────────────

test('R1 #7: bidi and C1 controls leave attachment filenames', async () => {
  const { EMAIL, env } = setup()
  const attachments = [{ filename: 'invoice‮fdp.exe', type: 'application/octet-stream', content: 'AAAA' }, { filename: 'a\u0085b⁦c‏.txt', type: 'text/plain', content: '' }]
  assert.equal((await worker.fetch(make(await call('POST', '/mail/send', jaime, { body: { ...MESSAGE, attachments } })), env)).status, 200)
  assert.deepEqual(EMAIL.calls[0].attachments.map(a => a.filename), ['invoicefdp.exe', 'abc.txt'])
})

// ── #11: the list line is tied to its own message ───────────────────────────

test('R1 #11: a list line copied onto another object no longer opens; a pre-binding v2 line still does', async () => {
  const secret = generateSecretKey()
  const a = await sealMessage(enc.encode('message a'), getPublicKey(secret), { subject: 'Invoice paid' })
  const b = await sealMessage(enc.encode('message b'), getPublicKey(secret), { subject: 'b' })
  assert.equal((await openMeta({ ...a.customMetadata, sig: a.sig }, secret)).subject, 'Invoice paid')
  // A's wraps and meta moved onto B's sig: refused.
  await assert.rejects(() => openMeta({ ...a.customMetadata, sig: b.sig }, secret), /does not open/)
  // Opened without its sig, a bound line does not fall through to the old label either.
  await assert.rejects(() => openMeta(a.customMetadata, secret), /does not open/)
  // An object sealed before the binding (additionalData "meta") still opens (H3).
  const old = await sealMetaUnbound(unwrapKey(a.wraps, secret), { subject: 'before' })
  assert.equal((await openMeta({ sig: a.sig, meta: old, wraps: a.wraps }, secret)).subject, 'before')
})

// ── #12: no body is read before a signature ─────────────────────────────────

// (A stranger's VALID signature does get its body read: who owns `from` is in the body. That costs the
// attacker a fresh signed event per request, and each is spent once.)
test('R1 #12: an unsigned or badly signed big POST is refused without its body being read', async () => {
  const { env } = setup()
  for (const authorization of [undefined, 'Nostr !!!']) {
    let pulled = false
    // highWaterMark 0: the stream is pulled only when someone reads it.
    const body = new ReadableStream({ pull() { pulled = true; throw new Error('the body must not be read') } }, { highWaterMark: 0 })
    const headers = { 'content-type': 'application/json', 'content-length': String(9 * 1024 * 1024) }
    if (authorization) headers.authorization = authorization
    const res = await worker.fetch(new Request('https://hypercomb.com/mail/send', { method: 'POST', headers, body, duplex: 'half' }), env)
    assert.deepEqual([res.status, await res.text()], [401, 'not authorized'])
    assert.equal(pulled, false)
  }
})

// ── #14: the lower caps ─────────────────────────────────────────────────────

test('R1 #14: the store cap is 10 MiB by default, attachments 6 MiB, the send body 10 MiB', async () => {
  const { MAIL, EMAIL, env } = setup()
  const rejected = []
  await worker.email({ from: 'a@example.org', to: 'jaime@hypercomb.com', rawSize: 10 * 1024 * 1024 + 1, raw: streamOf(new Uint8Array(1)), forward: async () => {}, setReject: r => rejected.push(r) }, env)
  assert.deepEqual(rejected, ['message too large'])
  assert.equal(MAIL.map.size, 0)

  const sevenMiB = 'A'.repeat(Math.ceil(7 * 1024 * 1024 / 3) * 4) // 7 MiB decoded, ~9.3 MiB of base64: under the body cap
  const tooMuch = await worker.fetch(make(await call('POST', '/mail/send', jaime, { body: { ...MESSAGE, attachments: [{ filename: 'a', type: 'text/plain', content: sevenMiB }] } })), env)
  assert.deepEqual([tooMuch.status, await tooMuch.text()], [413, 'attachments too large'])
  const big = await worker.fetch(make(await call('POST', '/mail/send', jaime, { body: { ...MESSAGE, text: 'x'.repeat(10 * 1024 * 1024) } })), env)
  assert.equal(big.status, 413)
  assert.equal(EMAIL.calls.length, 0)
})
