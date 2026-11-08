// Templates step 2 (documentation/mail-templates.md, "Steps 2 to 4"): a send names the template it was
// filled from in `X-Hypercomb-Template`, the template part rides among the attachments untouched, and a
// part with a content id goes inline so outside readers see a template's pictures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import worker from './mail-worker/worker.js'
import { openMessage, sha256Hex } from './mail-worker/seal.js'
import { FakeR2, quiet } from './mail-test-helpers.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const jaime = generateSecretKey()
const TEMPLATE = 'ab'.repeat(32)
const PART_TYPE = 'application/vnd.hypercomb.mail+json'
const PART = btoa(JSON.stringify({ 'mail:fill': 1, template: TEMPLATE, fill: { name: 'Leanne' } }))
const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 1, 2, 3))
const MESSAGE = { from: 'jaime@hypercomb.com', to: 'friend@example.org', subject: 'hello', text: 'hi', html: '<img src="cid:logo">' }

function setup(fail) {
  const calls = []
  const EMAIL = {
    calls,
    send: async message => {
      calls.push(structuredClone(message))
      const code = fail?.(calls.length)
      if (code) { const error = new Error('refused'); error.code = code; throw error }
      return { messageId: `<id-${calls.length}@hypercomb.com>` }
    },
  }
  const env = { MAIL: new FakeR2(), EMAIL, MAIL_KEYS: JSON.stringify({ 'jaime@hypercomb.com': getPublicKey(jaime) }) }
  return { EMAIL, env }
}

async function post(body) {
  const url = 'https://hypercomb.com/mail/send'
  const bytes = enc.encode(JSON.stringify(body))
  const tags = [['u', url], ['method', 'POST'], ['payload', await sha256Hex(bytes)], ['nonce', crypto.randomUUID()]]
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags }, jaime)
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Nostr ${btoa(JSON.stringify(event))}` }, body: bytes })
}

async function sentCopy(env, sig) {
  const url = `https://hypercomb.com/mail/sent/jaime%40hypercomb.com/${sig}`
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags: [['u', url], ['method', 'GET']] }, jaime)
  const res = await worker.fetch(new Request(url, { headers: { authorization: `Nostr ${btoa(JSON.stringify(event))}` } }), env)
  return JSON.parse(dec.decode((await openMessage(new Uint8Array(await res.arrayBuffer()), jaime)).bytes))
}

test('a template send carries X-Hypercomb-Template, and the part goes as an attachment and stays in Sent', async () => {
  const { EMAIL, env } = setup()
  const attachments = [{ filename: 'hypercomb-mail.json', type: PART_TYPE, content: PART }]
  const res = await worker.fetch(await post({ ...MESSAGE, template: TEMPLATE, attachments }), env)
  assert.equal(res.status, 200)
  assert.equal(EMAIL.calls.length, 1)
  assert.deepEqual(EMAIL.calls[0].headers, { 'X-Hypercomb-Template': TEMPLATE })
  assert.deepEqual(EMAIL.calls[0].attachments, [{ content: PART, filename: 'hypercomb-mail.json', type: PART_TYPE, disposition: 'attachment' }])

  const record = await sentCopy(env, (await res.json()).sig)
  assert.deepEqual(record.attachments, [{ filename: 'hypercomb-mail.json', type: PART_TYPE, content: PART }])
})

test('the template header joins the threading headers', async () => {
  const { EMAIL, env } = setup()
  const res = await worker.fetch(await post({ ...MESSAGE, template: TEMPLATE, inReplyTo: '<a@b>', references: '<a@b>' }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(EMAIL.calls[0].headers, { 'In-Reply-To': '<a@b>', References: '<a@b>', 'X-Hypercomb-Template': TEMPLATE })
})

test('a send without a template carries no header (absent is fine)', async () => {
  const { EMAIL, env } = setup()
  assert.equal((await worker.fetch(await post(MESSAGE), env)).status, 200)
  assert.ok(!('headers' in EMAIL.calls[0]))
})

test('a template that is not 64 lowercase hex is 422 bad template, and nothing is sent', async () => {
  const { EMAIL, env } = setup()
  for (const template of ['AB'.repeat(32), 'ab'.repeat(31), 'ab'.repeat(33), 'zz'.repeat(32), '', 42, null, ['ab'.repeat(32)], TEMPLATE + '\r\nBcc: x@y']) {
    const res = await worker.fetch(await post({ ...MESSAGE, template }), env)
    assert.equal(res.status, 422, JSON.stringify(template))
    assert.equal(await res.text(), 'bad template')
  }
  assert.equal(EMAIL.calls.length, 0)
})

test('a binding that refuses the header sends again without it, and the part still goes', async () => {
  const { EMAIL, env } = setup(n => (n === 1 ? 'E_HEADER_NOT_ALLOWED' : null))
  const attachments = [{ filename: 'hypercomb-mail.json', type: PART_TYPE, content: PART }]
  const res = await quiet(async () => worker.fetch(await post({ ...MESSAGE, template: TEMPLATE, attachments }), env))
  assert.equal(res.status, 200)
  assert.equal(EMAIL.calls.length, 2)
  assert.ok(!('headers' in EMAIL.calls[1]))
  assert.equal(EMAIL.calls[1].attachments[0].type, PART_TYPE)
})

test('a part with a content id goes inline with it; one without stays an attachment; Sent keeps the id', async () => {
  const { EMAIL, env } = setup()
  const attachments = [
    { filename: 'logo.png', type: 'image/png', content: PNG, contentId: 'logo' },
    { filename: 'invoice.pdf', type: 'application/pdf', content: PNG },
  ]
  const res = await worker.fetch(await post({ ...MESSAGE, attachments }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(EMAIL.calls[0].attachments, [
    { content: PNG, filename: 'logo.png', type: 'image/png', disposition: 'inline', contentId: 'logo' },
    { content: PNG, filename: 'invoice.pdf', type: 'application/pdf', disposition: 'attachment' },
  ])
  const record = await sentCopy(env, (await res.json()).sig)
  assert.equal(record.attachments[0].contentId, 'logo')
  assert.ok(!('contentId' in record.attachments[1]))
})

test('a content id outside [A-Za-z0-9._-]{1,64}, or repeated, is 422 bad content id', async () => {
  const { EMAIL, env } = setup()
  const part = contentId => ({ filename: 'p.png', type: 'image/png', content: PNG, contentId })
  for (const attachments of [
    [part('')], [part('x'.repeat(65))], [part('<logo>')], [part('lo go')], [part('logo\r\nX-Evil: 1')], [part('lógo')], [part(7)], [part(null)],
    [part('logo'), part('logo')],
  ]) {
    const res = await worker.fetch(await post({ ...MESSAGE, attachments }), env)
    assert.equal(res.status, 422, JSON.stringify(attachments.map(a => a.contentId)))
    assert.equal(await res.text(), 'bad content id')
  }
  assert.equal(EMAIL.calls.length, 0)
  assert.equal((await worker.fetch(await post({ ...MESSAGE, attachments: [part('a.B-9_'.padEnd(64, 'x'))] }), env)).status, 200)
})

test('inline parts count against the same caps as any attachment', async () => {
  const { EMAIL, env } = setup()
  const one = { filename: 'p.png', type: 'image/png', content: PNG }
  const eleven = Array.from({ length: 11 }, (_, i) => ({ ...one, contentId: `c${i}` }))
  assert.equal((await worker.fetch(await post({ ...MESSAGE, attachments: eleven }), env)).status, 422)
  const big = btoa('x'.repeat(3 * 1024 * 1024))
  const res = await worker.fetch(await post({ ...MESSAGE, attachments: [{ ...one, content: big, contentId: 'a' }, { ...one, content: big, contentId: 'b' }, { ...one, content: 'AAAA', contentId: 'c' }] }), env)
  assert.equal(res.status, 413)
  assert.equal(EMAIL.calls.length, 0)
})
