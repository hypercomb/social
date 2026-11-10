import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import worker from './mail-worker/worker.js'
import { openMessage, openMeta, sha256Hex } from './mail-worker/seal.js'
import { FakeR2, latin1, quiet } from './mail-test-helpers.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const BODY = 'SECRET-SEND-BODY-MARKER'
const SUBJECT = 'SECRET-SEND-SUBJECT-MARKER'

const jaime = generateSecretKey()
const leanne = generateSecretKey()

// Stands in for the send_email binding. `fail` is an error code, or a function of the call number.
function fakeEmail({ fail } = {}) {
  const calls = []
  return {
    calls,
    send: async message => {
      calls.push(structuredClone(message))
      const code = typeof fail === 'function' ? fail(calls.length) : fail
      if (code) { const error = new Error('refused'); error.code = code; throw error }
      return { messageId: `<id-${calls.length}@hypercomb.com>` }
    },
  }
}

function setup(extra = {}) {
  const MAIL = new FakeR2()
  const EMAIL = fakeEmail(extra.emailOptions)
  const env = {
    MAIL, EMAIL,
    MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': getPublicKey(jaime), 'leanne@hypercomb.com': getPublicKey(leanne) }),
    ALLOWED_ORIGINS: 'https://hypercomb.io',
    ...extra.env,
  }
  return { MAIL, EMAIL, env }
}

const MESSAGE = { from: 'jaime@hypercomb.com', to: 'friend@example.org', subject: SUBJECT, text: BODY }

// A signed POST: the event names the URL, the method and the sha256 of the exact bytes sent, and carries
// a nonce — a write's event is spent once (R1 #5), so two identical sends in one second must still be two
// events, as the browser side makes them.
async function post(secret, body, options = {}) {
  const url = `https://hypercomb.com${options.path ?? '/mail/send'}`
  const bytes = enc.encode(typeof body === 'string' ? body : JSON.stringify(body))
  const headers = { 'content-type': options.contentType ?? 'application/json' }
  if (secret) {
    const tags = [['u', url], ['method', 'POST'], ['payload', options.payload ?? await sha256Hex(bytes)], ['nonce', crypto.randomUUID()]]
    const event = finalizeEvent({ kind: 27235, created_at: options.now ?? Math.floor(Date.now() / 1000), content: '', tags }, secret)
    headers.authorization = `Nostr ${btoa(JSON.stringify(event))}`
  }
  if (options.origin) headers.origin = options.origin
  return new Request(url, { method: 'POST', headers, body: bytes })
}

function get(path, secret) {
  const url = `https://hypercomb.com${path}`
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags: [['u', url], ['method', 'GET']] }, secret)
  return new Request(url, { headers: { authorization: `Nostr ${btoa(JSON.stringify(event))}` } })
}

const sealedOnly = MAIL => [...MAIL.map.entries()].filter(([key]) => !/^(c|n|d)\//.test(key))
  .map(([, e]) => latin1(e.bytes) + ' ' + Object.values(e.customMetadata).join(' ')).join(' ')

// ── a send ──────────────────────────────────────────────────────────────────

test('the owner sends: Cloudflare is called once with exactly the message, and a sealed copy lands in Sent', async () => {
  const { MAIL, EMAIL, env } = setup()
  const res = await worker.fetch(await post(jaime, MESSAGE), env)
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.equal(out.messageId, '<id-1@hypercomb.com>')
  assert.match(out.sig, /^[a-f0-9]{64}$/)

  assert.equal(EMAIL.calls.length, 1)
  assert.deepEqual(EMAIL.calls[0], { from: 'jaime@hypercomb.com', to: ['friend@example.org'], subject: SUBJECT, text: BODY })

  const stored = sealedOnly(MAIL)
  for (const marker of [BODY, SUBJECT, 'friend@example.org']) assert.ok(!stored.includes(marker), marker)

  const list = await (await worker.fetch(get('/mail/sent/jaime%40hypercomb.com', jaime), env)).json()
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0].sig, out.sig)
  const meta = await openMeta(list.items[0], jaime)
  assert.equal(meta.subject, SUBJECT)
  assert.equal(meta.to, 'friend@example.org')
  assert.equal(meta.id, out.messageId)

  const one = await worker.fetch(get(`/mail/sent/jaime%40hypercomb.com/${out.sig}`, jaime), env)
  const record = JSON.parse(dec.decode((await openMessage(new Uint8Array(await one.arrayBuffer()), jaime)).bytes))
  assert.equal(record.text, BODY)
  assert.equal(record.id, out.messageId)
})

test('Sent and Inbox are separate pools, and Leanne cannot read Jaime\'s Sent', async () => {
  const { env } = setup()
  await worker.fetch(await post(jaime, MESSAGE), env)
  const inbox = await (await worker.fetch(get('/mail/box/jaime%40hypercomb.com', jaime), env)).json()
  assert.deepEqual(inbox.items, [])
  assert.equal((await worker.fetch(get('/mail/sent/jaime%40hypercomb.com', leanne), env)).status, 401)
})

test('cc, bcc and reply-to go to Cloudflare; the sealed copy keeps the bcc', async () => {
  const { EMAIL, env } = setup()
  const res = await worker.fetch(await post(jaime, {
    ...MESSAGE, to: ['a@example.org', 'B@Example.org'], cc: 'c@example.org', bcc: ['d@example.org'], replyTo: 'jaime@hypercomb.com', html: '<p>hi</p>',
  }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(EMAIL.calls[0].to, ['a@example.org', 'b@example.org'])
  assert.deepEqual(EMAIL.calls[0].cc, ['c@example.org'])
  assert.deepEqual(EMAIL.calls[0].bcc, ['d@example.org'])
  assert.equal(EMAIL.calls[0].replyTo, 'jaime@hypercomb.com')
  assert.equal(EMAIL.calls[0].html, '<p>hi</p>')
  const { sig } = await res.json()
  const one = await worker.fetch(get(`/mail/sent/jaime%40hypercomb.com/${sig}`, jaime), env)
  assert.deepEqual(JSON.parse(dec.decode((await openMessage(new Uint8Array(await one.arrayBuffer()), jaime)).bytes)).bcc, ['d@example.org'])
})

// ── who may send ────────────────────────────────────────────────────────────

test('only the key that owns the From address can send as it, and the body is bound to the signature', async () => {
  const { EMAIL, env } = setup()
  const status = async request => (await worker.fetch(request, env)).status

  assert.equal(await status(await post(null, MESSAGE)), 401)
  assert.equal(await status(await post(generateSecretKey(), MESSAGE)), 401)
  assert.equal(await status(await post(leanne, MESSAGE)), 401) // Leanne signing as Jaime
  assert.equal(await status(await post(jaime, { ...MESSAGE, from: 'ghost@hypercomb.com' })), 401)
  assert.equal(await status(await post(jaime, { ...MESSAGE, from: 'jaime@elsewhere.org' })), 401)
  assert.equal(await status(await post(jaime, MESSAGE, { now: Math.floor(Date.now() / 1000) - 600 })), 401)
  // Signed for one body, sent with another:
  const other = await sha256Hex(enc.encode(JSON.stringify({ ...MESSAGE, to: 'someone-else@example.org' })))
  assert.equal(await status(await post(jaime, MESSAGE, { payload: other })), 401)
  assert.equal(EMAIL.calls.length, 0)
})

test('Leanne sends as herself, and her count is her own', async () => {
  const { EMAIL, env } = setup({ env: { MAX_SEND_PER_DAY: '1' } })
  assert.equal((await worker.fetch(await post(jaime, MESSAGE), env)).status, 200)
  assert.equal((await worker.fetch(await post(leanne, { ...MESSAGE, from: 'leanne@hypercomb.com' }), env)).status, 200)
  assert.equal(EMAIL.calls.length, 2)
})

// ── what is refused before anything is sent ─────────────────────────────────

test('a malformed message is refused and Cloudflare is never called', async () => {
  const { EMAIL, env } = setup()
  const refused = async (body, status = 422) => assert.equal((await worker.fetch(await post(jaime, body), env)).status, status, JSON.stringify(body).slice(0, 80))
  await refused({ ...MESSAGE, to: 'not an address' })
  await refused({ ...MESSAGE, to: [] })
  await refused({ ...MESSAGE, to: undefined })
  await refused({ ...MESSAGE, to: Array.from({ length: 21 }, (_, i) => `p${i}@example.org`) })
  await refused({ ...MESSAGE, to: ['a@example.org', { email: 'x@example.org' }] })
  await refused({ ...MESSAGE, cc: 'bad' })
  await refused({ ...MESSAGE, subject: 'two\r\nlines' })
  await refused({ ...MESSAGE, subject: '   ' })
  await refused({ ...MESSAGE, subject: 'x'.repeat(999) })
  await refused({ ...MESSAGE, text: undefined })
  await refused({ ...MESSAGE, replyTo: 'bad' })
  await refused({ ...MESSAGE, inReplyTo: 'no-brackets' })
  await refused({ ...MESSAGE, references: '<ok@x> not-ok' })
  await refused('{not json', 400)
  await refused('[1,2]', 400)
  assert.equal((await worker.fetch(await post(jaime, MESSAGE, { contentType: 'text/plain' }), env)).status, 415)
  const huge = { ...MESSAGE, text: 'x'.repeat(16 * 1024 * 1024 + 10) } // the cap is 16 MiB since attachments ride in the body
  assert.equal((await worker.fetch(await post(jaime, huge), env)).status, 413)
  assert.equal(EMAIL.calls.length, 0)
})

test('only POST reaches /mail/send, and with no sending binding there is no sending', async () => {
  const { env } = setup()
  assert.equal((await worker.fetch(get('/mail/send', jaime), env)).status, 405)
  const none = setup()
  delete none.env.EMAIL
  assert.equal((await worker.fetch(await post(jaime, MESSAGE), none.env)).status, 503)
})

// ── the brake ───────────────────────────────────────────────────────────────

test('the daily cap stops a sender, and a bucket that cannot count sends nothing', async () => {
  const { EMAIL, env } = setup({ env: { MAX_SEND_PER_DAY: '2' } })
  assert.equal((await worker.fetch(await post(jaime, MESSAGE), env)).status, 200)
  assert.equal((await worker.fetch(await post(jaime, { ...MESSAGE, subject: 'second' }), env)).status, 200)
  const third = await worker.fetch(await post(jaime, { ...MESSAGE, subject: 'third' }), env)
  assert.equal(third.status, 429)
  assert.equal(EMAIL.calls.length, 2)

  const down = setup()
  down.MAIL.failPut = true
  const res = await quiet(async () => worker.fetch(await post(jaime, MESSAGE), down.env))
  assert.equal(res.status, 503)
  assert.equal(down.EMAIL.calls.length, 0)
})

// ── when Cloudflare says no ─────────────────────────────────────────────────

test('Cloudflare\'s refusals are passed on as a code only, and nothing is filed as sent', async () => {
  const cases = [['E_DAILY_LIMIT_EXCEEDED', 429], ['E_RATE_LIMIT_EXCEEDED', 429], ['E_RECIPIENT_NOT_ALLOWED', 422], ['E_SENDER_NOT_VERIFIED', 422], ['E_INTERNAL_SERVER_ERROR', 502]]
  for (const [code, status] of cases) {
    const { MAIL, env } = setup({ emailOptions: { fail: code } })
    const res = await quiet(async () => worker.fetch(await post(jaime, MESSAGE), env))
    assert.equal(res.status, status, code)
    assert.deepEqual(await res.json(), { error: code })
    assert.equal(sealedOnly(MAIL), '', 'no sent copy for a mail that did not go')
  }
})

test('threading headers ride along, and are dropped (not the mail) if Cloudflare will not carry them', async () => {
  const thread = { inReplyTo: '<a@example.org>', references: '<a@example.org> <b@example.org>' }
  const ok = setup()
  assert.equal((await worker.fetch(await post(jaime, { ...MESSAGE, ...thread }), ok.env)).status, 200)
  assert.deepEqual(ok.EMAIL.calls[0].headers, { 'In-Reply-To': '<a@example.org>', 'References': '<a@example.org> <b@example.org>' })

  const picky = setup({ emailOptions: { fail: n => (n === 1 ? 'E_HEADER_NOT_ALLOWED' : null) } })
  const res = await quiet(async () => worker.fetch(await post(jaime, { ...MESSAGE, ...thread }), picky.env))
  assert.equal(res.status, 200)
  assert.equal(picky.EMAIL.calls.length, 2)
  assert.ok('headers' in picky.EMAIL.calls[0])
  assert.ok(!('headers' in picky.EMAIL.calls[1]))

  const broken = setup({ emailOptions: { fail: n => (n === 1 ? 'E_HEADER_NOT_ALLOWED' : 'E_DELIVERY_FAILED') } })
  const failed = await quiet(async () => worker.fetch(await post(jaime, { ...MESSAGE, ...thread }), broken.env))
  assert.equal(failed.status, 502)
})

test('the mail went but its Sent copy could not be filed: still a success, with no sig', async () => {
  const { EMAIL, env, MAIL } = setup()
  MAIL.failPut = key => !/^(c|n)\//.test(key)
  const res = await quiet(async () => worker.fetch(await post(jaime, MESSAGE), env))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).sig, null)
  assert.equal(EMAIL.calls.length, 1)
})

// ── the browser ─────────────────────────────────────────────────────────────

test('CORS: a send from the listed origin is answered, and the preflight allows POST', async () => {
  const { env } = setup()
  const res = await worker.fetch(await post(jaime, MESSAGE, { origin: 'https://hypercomb.io' }), env)
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://hypercomb.io')

  const preflight = await worker.fetch(new Request('https://hypercomb.com/mail/send', { method: 'OPTIONS', headers: { origin: 'https://hypercomb.io' } }), env)
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/)

  const stranger = await worker.fetch(await post(jaime, MESSAGE, { origin: 'https://evil.example' }), env)
  assert.equal(stranger.headers.get('access-control-allow-origin'), null)
})

// ── attachments ─────────────────────────────────────────────────────────────

const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }
const PDF = b64(enc.encode('%PDF-1.4 a small file'))

test('attachments go to Cloudflare as base64 attachments, and the sealed Sent copy keeps them', async () => {
  const { EMAIL, env } = setup()
  const res = await worker.fetch(await post(jaime, {
    ...MESSAGE,
    attachments: [
      { filename: '../../etc/pass\\wd.pdf', type: 'Application/PDF', content: PDF.replace(/(.{8})/g, '$1\r\n') },
      { filename: `${'n'.repeat(200)}.tar.gz`, type: 'application/gzip', content: b64(new Uint8Array([1, 2, 3])) },
    ],
  }), env)
  assert.equal(res.status, 200)
  const [first, second] = EMAIL.calls[0].attachments
  assert.deepEqual(first, { content: PDF, filename: '_.._etc_pass_wd.pdf', type: 'application/pdf', disposition: 'attachment' })
  assert.equal(second.filename.length, 120)
  assert.ok(second.filename.endsWith('.gz'))
  assert.ok(!/[\\/]/.test(first.filename + second.filename))

  const { sig } = await res.json()
  const list = await (await worker.fetch(get('/mail/sent/jaime%40hypercomb.com', jaime), env)).json()
  const meta = await openMeta(list.items[0], jaime)
  assert.equal(meta.hasAttachments, true)
  assert.equal(meta.preview, BODY)
  const one = await worker.fetch(get(`/mail/sent/jaime%40hypercomb.com/${sig}`, jaime), env)
  const record = JSON.parse(dec.decode((await openMessage(new Uint8Array(await one.arrayBuffer()), jaime)).bytes))
  assert.deepEqual(record.attachments.map(a => [a.filename, a.type, a.content]), [[first.filename, 'application/pdf', PDF], [second.filename, 'application/gzip', 'AQID']])
})

test('a send with no attachments carries none, and its Sent copy says so', async () => {
  const { EMAIL, env } = setup()
  const { sig } = await (await worker.fetch(await post(jaime, MESSAGE), env)).json()
  assert.ok(!('attachments' in EMAIL.calls[0]))
  const one = await worker.fetch(get(`/mail/sent/jaime%40hypercomb.com/${sig}`, jaime), env)
  assert.deepEqual(JSON.parse(dec.decode((await openMessage(new Uint8Array(await one.arrayBuffer()), jaime)).bytes)).attachments, [])
  const list = await (await worker.fetch(get('/mail/sent/jaime%40hypercomb.com', jaime), env)).json()
  assert.equal((await openMeta(list.items[0], jaime)).hasAttachments, false)
})

test('attachments over the caps, or malformed, are refused before anything is sent', async () => {
  const { EMAIL, env } = setup()
  const one = { filename: 'a.txt', type: 'text/plain', content: b64(enc.encode('hi')) }
  const refused = async (attachments, status = 422) =>
    assert.equal((await worker.fetch(await post(jaime, { ...MESSAGE, attachments }), env)).status, status, JSON.stringify(attachments).slice(0, 80))
  await refused('not a list')
  await refused(Array.from({ length: 11 }, () => one))
  await refused([{ ...one, type: 'text' }])
  await refused([{ ...one, type: 'text/plain; charset=utf-8' }])
  await refused([{ ...one, content: 'not base64!' }])
  await refused([{ ...one, content: 'abc' }])
  await refused([{ ...one, content: 42 }])
  await refused([null])
  const sixMiB = 'A'.repeat(8 * 1024 * 1024) // 6 MiB decoded each; 12 MiB together is over the 10 MiB cap
  await refused([{ ...one, content: sixMiB }, { ...one, content: sixMiB }], 413)
  assert.equal(EMAIL.calls.length, 0)

  assert.equal((await worker.fetch(await post(jaime, { ...MESSAGE, attachments: Array.from({ length: 10 }, () => one) }), env)).status, 200)
  assert.equal(EMAIL.calls[0].attachments.length, 10)
  assert.equal(EMAIL.calls[0].attachments[0].filename, 'a.txt')
})

test('a nameless attachment is called "attachment"', async () => {
  const { EMAIL, env } = setup()
  await worker.fetch(await post(jaime, { ...MESSAGE, attachments: [{ filename: '  ...  ', type: 'text/plain', content: '' }] }), env)
  assert.equal(EMAIL.calls[0].attachments[0].filename, 'attachment')
})

// ── names and many owners ───────────────────────────────────────────────────

test('a name in MAIL_CONFIG sends as { email, name }; any owner key may send', async () => {
  const phone = generateSecretKey()
  const { EMAIL, env } = setup({
    env: {
      MAIL_CONFIG: JSON.stringify({ keys: { 'jaime@hypercomb.com': [getPublicKey(jaime), getPublicKey(phone)] }, names: { 'jaime@hypercomb.com': 'Jaime\r\nBcc: x' } }),
    },
  })
  assert.equal((await worker.fetch(await post(phone, MESSAGE), env)).status, 200)
  assert.deepEqual(EMAIL.calls[0].from, { email: 'jaime@hypercomb.com', name: 'Jaime  Bcc: x' })
  assert.equal((await worker.fetch(await post(leanne, MESSAGE), env)).status, 401)
  const list = await (await worker.fetch(get('/mail/sent/jaime%40hypercomb.com', jaime), env)).json()
  assert.equal(JSON.parse(list.items[0].wraps ? JSON.stringify(list.items[0].wraps) : '[]').length, 2, 'the Sent copy is sealed to both owners')
})

test('the Sent meta keeps the thread: messageId, inReplyTo and the last three references', async () => {
  const { env } = setup()
  const references = '<a@x> <b@x> <c@x> <d@x>'
  await worker.fetch(await post(jaime, { ...MESSAGE, inReplyTo: '<d@x>', references }), env)
  const list = await (await worker.fetch(get('/mail/sent/jaime%40hypercomb.com', jaime), env)).json()
  const meta = await openMeta(list.items[0], jaime)
  assert.equal(meta.messageId, '<id-1@hypercomb.com>')
  assert.equal(meta.id, '<id-1@hypercomb.com>')
  assert.equal(meta.inReplyTo, '<d@x>')
  assert.deepEqual(meta.references, ['<b@x>', '<c@x>', '<d@x>'])
})
