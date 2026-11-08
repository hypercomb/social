// mail/mail.service.spec.ts — the client against the REAL mail Worker.
//
// The service's `fetch` here is the Worker's own `fetch` handler, backed by an
// in-memory bucket, so a signed request, a sealed envelope and a send travel the
// whole way a real one does: client signs (NIP-98) → Worker checks → bucket →
// client decrypts. If the two halves ever disagree about a URL, a header, a tag or
// a byte, this is where it shows.

import { describe, expect, it, vi } from 'vitest'
import * as nip44 from 'nostr-tools/nip44'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
// @ts-ignore — the Worker is plain JavaScript with no declaration file
import worker from '../../../hypercomb-relay/mail-worker/worker.js'
// @ts-ignore
import { FakeR2, streamOf } from '../../../hypercomb-relay/mail-test-helpers.js'
// @ts-ignore
import { sealMessageV1 } from '../../../hypercomb-relay/mail-worker/seal.js'
import { ALREADY_DONE, ALREADY_SENT, MAIL_ACTS, MAIL_LIMITS, MAIL_READ_CAPS, MailError, MailService, sentAttachmentBytes, unreadCount, type MailListItem, type MailSigner } from './mail.service.js'
import { MAIL_TEMPLATE_PART_TYPE, readMailPart } from './template.js'

const enc = new TextEncoder()
const jaime = generateSecretKey()
const leanne = generateSecretKey()
const ME = 'jaime@hypercomb.com'
/** The one host these specs stand up. The service names no host of its own; a spec hands it this one. */
const HOST = 'https://hypercomb.com'

const MIME = [
  'From: Ana <ana@example.org>', 'To: jaime@hypercomb.com', 'Subject: =?UTF-8?Q?Caf=C3=A9_plans?=', 'Message-ID: <m1@example.org>',
  'Content-Type: multipart/mixed; boundary=X', '',
  '--X', 'Content-Type: text/plain; charset=utf-8', '', 'see the attachment', '',
  '--X', 'Content-Type: application/pdf; name="plan.pdf"', 'Content-Disposition: attachment; filename="plan.pdf"',
  'Content-Transfer-Encoding: base64', '', btoa('a'.repeat(50)), '',
  '--X--', '',
].join('\r\n')

/** The hive's signer, with a real key behind it: it signs and opens, and never hands the key out. */
function signerFor(secret: Uint8Array | null, over: Partial<MailSigner> = {}): MailSigner & { calls: string[] } {
  const calls: string[] = []
  const pub = secret ? getPublicKey(secret) : null
  return {
    calls,
    signEvent: async event => { calls.push('sign'); if (!secret) throw new Error('no key'); return finalizeEvent(event as never, secret) },
    nip44Decrypt: async (peer, payload) => { calls.push('decrypt'); try { return secret ? nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) : null } catch { return null } },
    getPublicKeyHex: async () => { calls.push('getPublicKeyHex'); return pub },
    knownPublicKeyHex: async () => { calls.push('knownPublicKeyHex'); return pub },
    ...over,
  }
}

function host(extra: Record<string, unknown> = {}) {
  const sent: unknown[] = []
  const MAIL = new FakeR2()
  const env = {
    MAIL,
    EMAIL: { send: async (message: unknown) => { sent.push(message); return { messageId: `<out-${sent.length}@hypercomb.com>` } } },
    MAIL_KEYS: JSON.stringify({ [ME]: getPublicKey(jaime), 'leanne@hypercomb.com': getPublicKey(leanne) }),
    MAIL_NAMES: JSON.stringify({ [ME]: 'Jaime' }),
    ...extra,
  }
  const fetch = async (url: string, init: RequestInit) => worker.fetch(new Request(url, init), env) as Promise<Response>
  const arrive = async (raw: string, to = ME): Promise<void> => {
    const bytes = enc.encode(raw)
    await worker.email({ from: 'ana@example.org', to, rawSize: bytes.length, raw: streamOf(bytes), forward: async () => {}, setReject: () => {} }, env)
  }
  return { MAIL, env, sent, fetch, arrive }
}

const service = (h: ReturnType<typeof host>, signer: MailSigner | undefined, extension = false) =>
  new MailService({ fetch: h.fetch, signer: () => signer, extension: () => extension }, HOST)

describe('who am I', () => {
  it('asks the host which addresses this key owns', async () => {
    const h = host()
    expect(await service(h, signerFor(jaime)).addresses()).toEqual([ME])
    expect(await service(h, signerFor(leanne)).addresses()).toEqual(['leanne@hypercomb.com'])
    expect(await service(h, signerFor(generateSecretKey())).addresses()).toEqual([])
  })

  it('shows this device\'s public key without minting one', async () => {
    const h = host()
    const signer = signerFor(jaime)
    expect(await service(h, signer).publicKey()).toBe(getPublicKey(jaime))
    expect(signer.calls).toEqual(['knownPublicKeyHex'])
    expect(await service(h, signerFor(null)).publicKey()).toBeNull()
    expect(await service(h, undefined).publicKey()).toBeNull()
  })
})

describe('reading', () => {
  it('lists what arrived, opened here, newest first', async () => {
    const h = host()
    await h.arrive(MIME)
    await new Promise(resolve => setTimeout(resolve, 15))
    await h.arrive('From: bo@example.org\r\nSubject: second\r\n\r\nhello\r\n')
    const page = await service(h, signerFor(jaime)).list(ME, 'box')
    expect(page.cursor).toBeNull()
    expect(page.items.map(i => i.meta?.subject)).toEqual(['second', 'Café plans'].map(s => s === 'Café plans' ? '=?UTF-8?Q?Caf=C3=A9_plans?=' : s))
    expect(page.items[0]!.meta?.from).toBe('ana@example.org')
    expect(page.items[0]!.meta?.to).toBe(ME)
  })

  it('opens a message and reads it: decoded subject, text, attachments', async () => {
    const h = host()
    await h.arrive(MIME)
    const [item] = (await service(h, signerFor(jaime)).list(ME, 'box')).items
    const mail = await service(h, signerFor(jaime)).read(ME, item!.sig)
    expect(mail.subject).toBe('Café plans')
    expect(mail.from).toBe('Ana <ana@example.org>')
    expect(mail.text).toBe('see the attachment')
    expect(mail.attachments).toEqual([{ filename: 'plan.pdf', type: 'application/pdf', size: 50 }])
  })

  it('hands over the raw bytes of a received message, which are exactly what was sealed', async () => {
    const h = host()
    await h.arrive(MIME)
    const s = service(h, signerFor(jaime))
    const [item] = (await s.list(ME, 'box')).items
    const raw = await s.readRaw(ME, item!.sig)
    expect(raw).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(raw)).toBe(MIME)
    await expect(service(h, signerFor(leanne)).readRaw(ME, item!.sig)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('cannot read another address\'s mail, by list or by signature', async () => {
    const h = host()
    await h.arrive(MIME, 'leanne@hypercomb.com')
    const hers = (await service(h, signerFor(leanne)).list('leanne@hypercomb.com', 'box')).items[0]!
    await expect(service(h, signerFor(jaime)).list('leanne@hypercomb.com', 'box')).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(service(h, signerFor(jaime)).read('leanne@hypercomb.com', hers.sig)).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(service(h, signerFor(jaime)).read(ME, hers.sig)).rejects.toMatchObject({ code: 'not-found' })
  })

  it('refuses a signature that is not one without making a request', async () => {
    const h = host()
    const fetch = vi.fn(h.fetch)
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    await expect(s.read(ME, '../../etc/passwd')).rejects.toMatchObject({ code: 'not-found' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says so when a message does not open with this key', async () => {
    const h = host()
    await h.arrive(MIME)
    const [item] = (await service(h, signerFor(jaime)).list(ME, 'box')).items
    // The same host believes this key owns the address, but the bytes were sealed to another one.
    const wrongDevice = signerFor(jaime, { nip44Decrypt: async () => null })
    await expect(service(h, wrongDevice).read(ME, item!.sig)).rejects.toMatchObject({ code: 'bad-message' })
  })

  it('lists a message it cannot open as unreadable, not as a failure of the whole box', async () => {
    const h = host()
    await h.arrive(MIME)
    const wrongDevice = signerFor(jaime, { nip44Decrypt: async () => null })
    const page = await service(h, wrongDevice).list(ME, 'box')
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.meta).toBeNull()
  })
})

describe('sending', () => {
  it('sends through the host and files a copy in Sent that opens', async () => {
    const h = host()
    const out = await service(h, signerFor(jaime)).send({ from: ME, to: ['friend@example.org'], subject: 'Hello', text: 'A line.' })
    expect(out.messageId).toBe('<out-1@hypercomb.com>')
    expect(out.sig).toMatch(/^[a-f0-9]{64}$/)
    // The host has a name for the address, so the mail goes out as `Jaime <jaime@hypercomb.com>`.
    expect(h.sent).toEqual([{ from: { email: ME, name: 'Jaime' }, to: ['friend@example.org'], subject: 'Hello', text: 'A line.' }])

    const s = service(h, signerFor(jaime))
    const [item] = (await s.list(ME, 'sent')).items
    expect(item!.meta).toMatchObject({ to: 'friend@example.org', subject: 'Hello' })
    const record = await s.readSent(ME, item!.sig)
    expect(record.text).toBe('A line.')
    expect(record.id).toBe('<out-1@hypercomb.com>')
    expect((await s.list(ME, 'box')).items).toEqual([])
  })

  it('carries a reply\'s thread, cc, and drops what is empty', async () => {
    const h = host()
    await service(h, signerFor(jaime)).send({ from: ME, to: ['a@example.org'], cc: ['b@example.org'], bcc: [], subject: 'Re: x', text: 'ok', inReplyTo: '<m1@example.org>', references: '<m0@example.org> <m1@example.org>' })
    expect(h.sent[0]).toMatchObject({ cc: ['b@example.org'], headers: { 'In-Reply-To': '<m1@example.org>', 'References': '<m0@example.org> <m1@example.org>' } })
    expect(h.sent[0]).not.toHaveProperty('bcc')
  })

  it('cannot send as an address the key does not own', async () => {
    const h = host()
    await expect(service(h, signerFor(leanne)).send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(h.sent).toEqual([])
  })

  it('passes on a refusal and a limit as what they are', async () => {
    const limited = host({ MAX_SEND_PER_DAY: '1' })
    const s = service(limited, signerFor(jaime))
    await s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })
    await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's2', text: 't' })).rejects.toMatchObject({ code: 'limit' })

    const h = host()
    await expect(service(h, signerFor(jaime)).send({ from: ME, to: ['not an address'], subject: 's', text: 't' })).rejects.toMatchObject({ code: 'refused' })
  })

  it('tells a listener that something was sent', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    const heard = vi.fn()
    s.addEventListener('change', heard)
    await s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('the key', () => {
  it('opens no mail and signs nothing on a device that holds no key, and mints none', async () => {
    const h = host()
    const signer = signerFor(null)
    const fetch = vi.fn(h.fetch)
    const s = new MailService({ fetch, signer: () => signer, extension: () => false }, HOST)
    await expect(s.addresses()).rejects.toMatchObject({ code: 'no-key' })
    await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })).rejects.toMatchObject({ code: 'no-key' })
    expect(signer.calls).not.toContain('sign')
    expect(signer.calls).not.toContain('getPublicKeyHex') // the call that can mint
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks a NIP-07 extension for the key (the only way to know it), and says so when there is no signer at all', async () => {
    const h = host()
    const signer = signerFor(jaime)
    await service(h, signer, true).addresses()
    expect(signer.calls[0]).toBe('getPublicKeyHex')
    expect(signer.calls).not.toContain('knownPublicKeyHex')
    await expect(service(h, undefined).addresses()).rejects.toMatchObject({ code: 'no-signer' })
  })

  it('reports a host that does not answer', async () => {
    const down = new MailService({ fetch: async () => { throw new TypeError('network') }, signer: () => signerFor(jaime), extension: () => false }, HOST)
    await expect(down.addresses()).rejects.toBeInstanceOf(MailError)
    await expect(down.addresses()).rejects.toMatchObject({ code: 'unavailable' })
  })
})

const sha256Hex = async (text: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))), b => b.toString(16).padStart(2, '0')).join('')

describe('who am I, by name', () => {
  it('answers each mailbox with its name and the host that serves it', async () => {
    const h = host()
    expect(await service(h, signerFor(jaime)).mailboxes()).toEqual([{ address: ME, name: 'Jaime', host: 'https://hypercomb.com', can: MAIL_ACTS }])
    expect(await service(h, signerFor(leanne)).mailboxes()).toEqual([{ address: 'leanne@hypercomb.com', host: 'https://hypercomb.com', can: MAIL_ACTS }])
  })
})

describe('the list, as it opens', () => {
  it('opens v2 metadata with everything the Worker sealed, and carries the version, the wraps and the marks', async () => {
    const h = host()
    await h.arrive(MIME)
    const [item] = (await service(h, signerFor(jaime)).list(ME, 'box')).items
    expect(item).toMatchObject({ v: 2, marks: null })
    expect(item!.wraps).toHaveLength(1)
    expect(item!.wraps![0]!.to).toBe(getPublicKey(jaime))
    expect(item!.meta).toMatchObject({ from: 'ana@example.org', messageId: '<m1@example.org>', hasAttachments: true, preview: 'see the attachment' })
  })

  it('reports each row the moment its metadata opens, then answers the page newest first', async () => {
    const h = host()
    for (const n of [1, 2, 3]) {
      await h.arrive(`From: n${n}@example.org\r\nSubject: number ${n}\r\n\r\nhello\r\n`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const heard: { subject?: string; opened: number; total: number }[] = []
    const page = await service(h, signerFor(jaime)).list(ME, 'box', null, (item, progress) => heard.push({ subject: item.meta?.subject, ...progress }))
    expect(heard.map(e => e.opened)).toEqual([1, 2, 3])
    expect(heard.every(e => e.total === 3)).toBe(true)
    expect(new Set(heard.map(e => e.subject))).toEqual(new Set(['number 1', 'number 2', 'number 3']))
    expect(page.items.map(i => i.meta?.subject)).toEqual(['number 3', 'number 2', 'number 1'])
  })

  it('keeps the page when a listener throws', async () => {
    const h = host()
    await h.arrive(MIME)
    const page = await service(h, signerFor(jaime)).list(ME, 'box', null, () => { throw new Error('the window tripped') })
    expect(page.items).toHaveLength(1)
  })

  it('still lists and opens a message an older Worker sealed (v1)', async () => {
    const h = host()
    const raw = enc.encode('From: old@example.org\r\nSubject: from before\r\n\r\nkept\r\n')
    const sealed = await sealMessageV1(raw, getPublicKey(jaime), { from: 'old@example.org', subject: 'from before', at: 7 })
    await h.MAIL.put(`${await sha256Hex(`mail:${ME}`)}/${sealed.sig}`, sealed.envelope, { customMetadata: sealed.customMetadata })
    await h.arrive(MIME)
    const s = service(h, signerFor(jaime))
    const items = (await s.list(ME, 'box')).items
    const old = items.find(i => i.sig === sealed.sig)!
    expect(old).toMatchObject({ v: 1, meta: { subject: 'from before', at: 7 } })
    expect(old.wraps).toBeUndefined()
    expect(items[0]!.v).toBe(2) // the newer one first
    expect((await s.read(ME, sealed.sig)).text).toBe('kept')
  })

  it('refuses bytes that are not the message asked for', async () => {
    const h = host()
    await h.arrive(MIME)
    await h.arrive('From: bo@example.org\r\nSubject: second\r\n\r\nhello\r\n')
    const [a, b] = (await service(h, signerFor(jaime)).list(ME, 'box')).items
    const pool = await sha256Hex(`mail:${ME}`)
    h.MAIL.map.set(`${pool}/${a!.sig}`, h.MAIL.map.get(`${pool}/${b!.sig}`))
    await expect(service(h, signerFor(jaime)).read(ME, a!.sig)).rejects.toMatchObject({ code: 'bad-message' })
  })
})

describe('marks, hiding and forgetting', () => {
  it('marks a message, and the list carries the marks', async () => {
    const h = host()
    await h.arrive(MIME)
    const s = service(h, signerFor(jaime))
    const [item] = (await s.list(ME, 'box')).items
    expect(unreadCount([item!])).toBe(1)
    const marks = await s.setMarks(ME, 'box', item!.sig, { read: true, flagged: true })
    expect(marks).toMatchObject({ read: true, flagged: true })
    expect(typeof marks.at).toBe('number')
    const [after] = (await s.list(ME, 'box')).items
    expect(after!.marks).toMatchObject({ read: true, flagged: true })
    expect(unreadCount([after!])).toBe(0)
    expect(unreadCount([{ marks: { hidden: true } }, { marks: null }, { marks: { read: false } }])).toBe(2)
  })

  it('sends only the four marks, and says not-found for a message that is not there', async () => {
    const h = host()
    await h.arrive(MIME)
    const s = service(h, signerFor(jaime))
    const [item] = (await s.list(ME, 'box')).items
    const marks = await s.setMarks(ME, 'box', item!.sig, { read: true, ...({ owner: 'me' } as object) })
    expect(Object.keys(marks).sort()).toEqual(['at', 'read'])
    await expect(s.setMarks(ME, 'box', 'a'.repeat(64), { read: true })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('forgets a message only once it is hidden and marked deletable (hide first, delete second)', async () => {
    const h = host()
    await h.arrive(MIME)
    const s = service(h, signerFor(jaime))
    const heard = vi.fn()
    s.addEventListener('change', heard)
    const [item] = (await s.list(ME, 'box')).items
    await expect(s.remove(ME, 'box', item!.sig)).rejects.toMatchObject({ code: 'conflict' })
    await s.setMarks(ME, 'box', item!.sig, { hidden: true })
    await expect(s.remove(ME, 'box', item!.sig)).rejects.toMatchObject({ code: 'conflict' })
    await s.setMarks(ME, 'box', item!.sig, { deletable: true })
    await s.remove(ME, 'box', item!.sig)
    expect((await s.list(ME, 'box')).items).toEqual([])
    await expect(s.read(ME, item!.sig)).rejects.toMatchObject({ code: 'not-found' })
    await expect(s.remove(ME, 'box', item!.sig)).rejects.toMatchObject({ code: 'not-found' })
    expect(heard).toHaveBeenCalled()
  })
})

describe('drafts', () => {
  it('keeps a draft, lists it, reads it back and forgets it', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    const { sig, replaced } = await s.saveDraft(ME, { to: ['friend@example.org', 'b@example.org'], subject: 'Half done', text: 'so far' })
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
    expect(replaced).toBe(false)
    const [item] = (await s.list(ME, 'drafts')).items
    expect(item).toMatchObject({ sig, v: 2, marks: null, meta: { to: 'friend@example.org, b@example.org', subject: 'Half done' } })
    expect(await s.readDraft(ME, sig)).toEqual({ to: ['friend@example.org', 'b@example.org'], subject: 'Half done', text: 'so far' })
    await s.removeDraft(ME, sig)
    expect((await s.list(ME, 'drafts')).items).toEqual([])
  })

  it('replaces the draft it grew from, and carries attachments as base64', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    const first = await s.saveDraft(ME, { subject: 'v1', text: 'a' })
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const attachments = [{ filename: 'x.bin', type: 'application/octet-stream', content: bytes }]
    const second = await s.saveDraft(ME, { subject: 'v2', text: 'ab', attachments }, first.sig)
    expect(second.replaced).toBe(true)
    expect((await s.list(ME, 'drafts')).items.map(i => i.sig)).toEqual([second.sig])
    const draft = await s.readDraft(ME, second.sig)
    expect(Array.from(sentAttachmentBytes(draft.attachments![0]!)!)).toEqual(Array.from(bytes))
    // The same draft twice is one draft, and replacing itself forgets nothing.
    expect(await s.saveDraft(ME, { subject: 'v2', text: 'ab', attachments }, second.sig)).toEqual({ sig: second.sig, replaced: false })
  })

  it('carries no marks: the host refuses them', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    const { sig } = await s.saveDraft(ME, { subject: 's' })
    await expect(s.setMarks(ME, 'drafts', sig, { read: true })).rejects.toMatchObject({ code: 'refused' })
  })

  it('refuses a draft too large before it is sent', async () => {
    const h = host()
    const fetch = vi.fn(h.fetch)
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    await expect(s.saveDraft(ME, { text: 'x'.repeat(MAIL_LIMITS.draftBytes) })).rejects.toMatchObject({ code: 'refused' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('sending with attachments', () => {
  it('base64s the attachments for the wire, and the Sent copy keeps them', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    const pdf = enc.encode('%PDF-1.4 pretend')
    const out = await s.send({
      from: ME, to: ['friend@example.org'], subject: 'Plans', text: 'attached', html: '<p>attached</p>',
      attachments: [{ filename: 'plan.pdf', type: 'application/pdf', content: pdf }, { filename: 'note.txt', type: 'text/plain', content: btoa('hi') }],
    })
    expect(h.sent[0]).toMatchObject({
      from: { email: ME, name: 'Jaime' },
      html: '<p>attached</p>',
      attachments: [
        { filename: 'plan.pdf', type: 'application/pdf', content: btoa('%PDF-1.4 pretend'), disposition: 'attachment' },
        { filename: 'note.txt', type: 'text/plain', content: btoa('hi'), disposition: 'attachment' },
      ],
    })
    const [item] = (await s.list(ME, 'sent')).items
    expect(item!.sig).toBe(out.sig)
    expect(item!.meta?.hasAttachments).toBe(true)
    const record = await s.readSent(ME, out.sig!)
    expect(record.name).toBe('Jaime')
    expect(record.html).toBe('<p>attached</p>')
    expect(record.attachments!.map(a => a.filename)).toEqual(['plan.pdf', 'note.txt'])
    expect(Array.from(sentAttachmentBytes(record.attachments![0]!)!)).toEqual(Array.from(pdf))
  })

  it('refuses too many or too large attachments before a byte is sent', async () => {
    const h = host()
    const fetch = vi.fn(h.fetch)
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    const one = { filename: 'a', type: 'text/plain', content: btoa('a') }
    await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't', attachments: Array.from({ length: MAIL_LIMITS.attachments + 1 }, () => one) }))
      .rejects.toMatchObject({ code: 'refused', detail: 'too many attachments' })
    await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't', attachments: [{ filename: 'big', type: 'application/octet-stream', content: new Uint8Array(MAIL_LIMITS.attachmentBytes + 1) }] }))
      .rejects.toMatchObject({ code: 'refused', detail: 'attachments too large' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes on the host\'s own refusal of an attachment', async () => {
    const h = host()
    await expect(service(h, signerFor(jaime)).send({ from: ME, to: ['a@example.org'], subject: 's', text: 't', attachments: [{ filename: 'x', type: 'not a type', content: btoa('x') }] }))
      .rejects.toMatchObject({ code: 'refused' })
    expect(h.sent).toEqual([])
  })
})

// documentation/mail-templates.md, step 2: the template travels as a part of its own beside the baked
// text and html, the host is told its signature, and a picture the html shows goes inline by its id.
describe('sending a template', () => {
  const TEMPLATE = 'a'.repeat(64)
  const PICTURE = 'b'.repeat(64)
  const fill = { guest: 'Leanne', seats: 6 }

  it('carries the part and the signature, and the Sent copy reads back the same reference', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    const out = await s.send({ from: ME, to: ['friend@example.org'], subject: 'Invited', text: 'baked', html: '<p>baked</p>', template: { sig: TEMPLATE, fill } })
    const message = h.sent[0] as { headers?: Record<string, string>; attachments: { type: string; filename: string; disposition: string }[] }
    expect(message.headers).toEqual({ 'X-Hypercomb-Template': TEMPLATE })
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0]).toMatchObject({ type: MAIL_TEMPLATE_PART_TYPE, filename: 'hypercomb-template.json', disposition: 'attachment' })
    const record = await s.readSent(ME, out.sig!)
    expect(readMailPart({ attachments: record.attachments! }, i => sentAttachmentBytes(record.attachments![i]!))).toEqual({ templateSig: TEMPLATE, fill })
  })

  it('the part takes one of the ten slots: ten files and a template is refused before a byte is sent', async () => {
    const h = host()
    const fetch = vi.fn(h.fetch)
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    const one = { filename: 'a', type: 'text/plain', content: btoa('a') }
    await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't', attachments: Array.from({ length: MAIL_LIMITS.attachments }, () => one), template: { sig: TEMPLATE, fill } }))
      .rejects.toMatchObject({ code: 'refused', detail: 'too many attachments' })
    expect(fetch).not.toHaveBeenCalled()
    await s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't', attachments: Array.from({ length: MAIL_LIMITS.attachments - 1 }, () => one), template: { sig: TEMPLATE, fill } })
    expect((h.sent[0] as { attachments: unknown[] }).attachments).toHaveLength(MAIL_LIMITS.attachments)
  })

  it('a picture goes inline under its bare id, the html naming it, and the Sent copy keeps the id', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const out = await s.send({
      from: ME, to: ['friend@example.org'], subject: 's', text: 't', html: `<p><img src="cid:${PICTURE}" alt="room"></p>`,
      attachments: [{ filename: 'room.png', type: 'image/png', content: png, contentId: PICTURE }],
      template: { sig: TEMPLATE, fill },
    })
    const [picture, part] = (h.sent[0] as { attachments: Record<string, unknown>[] }).attachments
    expect(picture).toEqual({ content: btoa(String.fromCharCode(...png)), filename: 'room.png', type: 'image/png', disposition: 'inline', contentId: PICTURE })
    expect(part).not.toHaveProperty('contentId')
    const record = await s.readSent(ME, out.sig!)
    expect(record.attachments![0]!.contentId).toBe(PICTURE)
    expect(record.attachments![1]).not.toHaveProperty('contentId')
  })

  it('a bad or repeated content id, or a template that is not a signature, is refused before a byte is sent', async () => {
    const h = host()
    const fetch = vi.fn(h.fetch)
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    const pic = (contentId: string) => ({ filename: 'p.png', type: 'image/png', content: btoa('x'), contentId })
    for (const attachments of [[pic('<angle>')], [pic('a b')], [pic('')], [pic('x'.repeat(65))], [pic('same'), pic('same')]]) {
      await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't', attachments })).rejects.toMatchObject({ code: 'refused', detail: 'bad content id' })
    }
    for (const sig of ['A'.repeat(64), 'a'.repeat(63), 'not a sig']) {
      await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't', template: { sig, fill } })).rejects.toMatchObject({ code: 'refused', detail: 'bad template' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a message with no template sends exactly as before: no part, no header', async () => {
    const h = host()
    await service(h, signerFor(jaime)).send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })
    expect(h.sent[0]).not.toHaveProperty('headers')
    expect(h.sent[0]).not.toHaveProperty('attachments')
  })
})

describe('more than one host', () => {
  const ANA = 'ana@example.org'
  const SOCIAL = 'jaime@hypercomb.social'

  /** Hosts by origin: a missing or 'down' origin does not answer; 'static' answers every path with its home page. */
  function hosts(table: Record<string, ReturnType<typeof host> | 'down' | 'static'>) {
    const asked: string[] = []
    const fetch = async (url: string, init: RequestInit): Promise<Response> => {
      const { origin, pathname } = new URL(url)
      asked.push(`${init.method ?? 'GET'} ${origin}${pathname}`)
      const entry = table[origin]
      if (!entry || entry === 'down') throw new TypeError('network')
      if (entry === 'static') return new Response('<!doctype html><title>home</title>', { status: 200, headers: { 'content-type': 'text/html' } })
      return entry.fetch(url, init)
    }
    return { fetch, asked }
  }
  const over = (net: ReturnType<typeof hosts>, list?: string[]) =>
    new MailService({ fetch: net.fetch, signer: () => signerFor(jaime), extension: () => false }, list)

  it('unions the addresses across hosts and asks each address of the host that claimed it', async () => {
    const main = host()
    const other = host({ MAIL_KEYS: JSON.stringify({ [ANA]: getPublicKey(jaime) }), MAIL_NAMES: '{}' })
    await other.arrive('From: x@example.org\r\nSubject: on the other host\r\n\r\nhi\r\n', ANA)
    const net = hosts({ 'https://hypercomb.com': main, 'https://mail.example.org': other })
    const s = over(net, ['https://hypercomb.com', 'mail.example.org'])
    expect(s.hosts).toEqual(['https://hypercomb.com', 'https://mail.example.org'])
    expect(await s.mailboxes()).toEqual([
      { address: ANA, host: 'https://mail.example.org', can: MAIL_ACTS },
      { address: ME, name: 'Jaime', host: 'https://hypercomb.com', can: MAIL_ACTS },
    ])
    expect(await s.addresses()).toEqual([ANA, ME])
    net.asked.length = 0
    expect((await s.list(ANA, 'box')).items.map(i => i.meta?.subject)).toEqual(['on the other host'])
    expect(net.asked).toEqual([`GET https://mail.example.org/mail/box/${encodeURIComponent(ANA)}`])
  })

  it('asks the hosts the hive carries when none are given, and no host when it carries none', async () => {
    const net = hosts({ 'https://mail.example.org': host({ MAIL_KEYS: JSON.stringify({ [ANA]: getPublicKey(jaime) }), MAIL_NAMES: '{}' }) })
    const carried: string[] = []
    const s = new MailService({ fetch: net.fetch, signer: () => signerFor(jaime), extension: () => false, hosts: async () => carried })
    expect(s.hosts).toEqual([]) // nothing named in code
    await expect(s.mailboxes()).rejects.toMatchObject({ code: 'no-hosts' })
    await expect(s.list(ANA, 'box')).rejects.toMatchObject({ code: 'no-hosts' })
    expect(net.asked).toEqual([]) // nobody was contacted
    carried.push('mail.example.org', 'MAIL.example.org/') // a zone, as the hosts desk keeps it; once
    expect(await s.hostList()).toEqual(['https://mail.example.org'])
    expect(await s.addresses()).toEqual([ANA])
    expect(net.asked).toEqual(['GET https://mail.example.org/mail/me'])
  })

  it('leaves out only the addresses of a host that does not answer', async () => {
    const net = hosts({ 'https://hypercomb.com': host() })
    expect(await over(net, ['https://down.example.org', 'https://hypercomb.com']).addresses()).toEqual([ME])
  })

  it('asks an address of its own domain first when that domain is one of the given hosts, and remembers the one that served it', async () => {
    const main = host({ MAIL_KEYS: JSON.stringify({ [SOCIAL]: getPublicKey(jaime) }) })
    await main.arrive('From: x@example.org\r\nSubject: here\r\n\r\nhi\r\n', SOCIAL)
    const net = hosts({ 'https://hypercomb.com': main, 'https://hypercomb.social': 'static' })
    const s = over(net, ['https://hypercomb.com', 'https://hypercomb.social'])
    expect((await s.list(SOCIAL, 'box')).items).toHaveLength(1)
    expect(net.asked.map(a => a.split('/mail')[0])).toEqual(['GET https://hypercomb.social', 'GET https://hypercomb.com'])
    net.asked.length = 0
    const [item] = (await s.list(SOCIAL, 'box')).items
    await s.read(SOCIAL, item!.sig)
    expect(net.asked).toHaveLength(2)
    expect(net.asked.every(a => a.includes('https://hypercomb.com/'))).toBe(true)
  })

  it('passes on the most telling answer when no host serves the address', async () => {
    await expect(over(hosts({ 'https://hypercomb.com': host(), 'https://nowhere.example': 'down' }), ['https://hypercomb.com', 'https://nowhere.example']).list('who@nowhere.example', 'box'))
      .rejects.toMatchObject({ code: 'unauthorized' })
    const dark = over(hosts({}), [HOST]) // a host the hive carries, and it is down
    await expect(dark.list('who@nowhere.example', 'box')).rejects.toMatchObject({ code: 'unavailable' })
    await expect(dark.addresses()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('never sends twice: a send that got no answer is not tried on the next host', async () => {
    const main = host({ MAIL_KEYS: JSON.stringify({ [SOCIAL]: getPublicKey(jaime) }) })
    const both = ['https://hypercomb.com', 'https://hypercomb.social']
    await expect(over(hosts({ 'https://hypercomb.com': main, 'https://hypercomb.social': 'down' }), both).send({ from: SOCIAL, to: ['a@example.org'], subject: 's', text: 't' }))
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(main.sent).toEqual([])
    // A host that plainly does not know the key lets the next one be asked.
    const out = await over(hosts({ 'https://hypercomb.com': main, 'https://hypercomb.social': host() }), both).send({ from: SOCIAL, to: ['a@example.org'], subject: 's', text: 't' })
    expect(out.sig).toMatch(/^[a-f0-9]{64}$/)
    expect(main.sent).toHaveLength(1)
  })
})

describe('every way it can fail has a name', () => {
  it('reaches every MailError code', async () => {
    const h = host()
    await h.arrive(MIME)
    const seen = new Set<string>()
    const code = async (act: Promise<unknown>): Promise<void> => {
      try { await act } catch (error) { if (error instanceof MailError) seen.add(error.code) }
    }
    const s = service(h, signerFor(jaime))
    const [item] = (await s.list(ME, 'box')).items as MailListItem[]
    await code(service(h, undefined).addresses())                                         // no-signer
    await code(service(h, signerFor(null)).addresses())                                   // no-key
    await code(service(h, signerFor(leanne)).list(ME, 'box'))                             // unauthorized
    await code(s.read(ME, 'b'.repeat(64)))                                                // not-found
    await code(s.remove(ME, 'box', item!.sig))                                            // conflict
    await code(s.send({ from: ME, to: ['nope'], subject: 's', text: 't' }))               // refused
    await code(service(h, signerFor(jaime, { nip44Decrypt: async () => null })).read(ME, item!.sig)) // bad-message
    await code(new MailService({ fetch: async () => { throw new TypeError('x') }, signer: () => signerFor(jaime), extension: () => false }, HOST).addresses()) // unavailable
    const capped = service(host({ MAX_SEND_PER_DAY: '1' }), signerFor(jaime))
    await capped.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })
    await code(capped.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })) // limit
    const reader = generateSecretKey()
    const roles = host({ MAIL_KEYS: JSON.stringify({ [ME]: [getPublicKey(jaime), { key: getPublicKey(reader), can: ['read'] }] }) })
    await code(service(roles, signerFor(reader)).send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })) // forbidden
    expect([...seen].sort()).toEqual(['bad-message', 'conflict', 'forbidden', 'limit', 'no-key', 'no-signer', 'not-found', 'refused', 'unauthorized', 'unavailable'])
  })
})

/** The NIP-98 event a request was signed with. */
const eventOf = (init: RequestInit): { id: string; tags: string[][] } =>
  JSON.parse(decodeURIComponent(escape(atob(String((init.headers as Record<string, string>)['authorization']).slice('Nostr '.length)))))

describe('after the security review (R1)', () => {
  it('puts a fresh nonce in every write, none in a read, so two identical writes in one second both land', async () => {
    const h = host()
    await h.arrive(MIME)
    const seen: { method: string; tags: string[][]; id: string }[] = []
    const fetch = async (url: string, init: RequestInit) => {
      const event = eventOf(init)
      seen.push({ method: init.method ?? 'GET', tags: event.tags, id: event.id })
      return h.fetch(url, init)
    }
    // One clock for all of it: without the nonce the two mark writes would be one event.
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false, now: () => Date.now() - (Date.now() % 1000) }, HOST)
    const [item] = (await s.list(ME, 'box')).items
    await s.setMarks(ME, 'box', item!.sig, { read: true })
    await s.setMarks(ME, 'box', item!.sig, { read: true })
    const draft = await s.saveDraft(ME, { subject: 'd' })
    await s.removeDraft(ME, draft.sig)
    await s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })
    const nonce = (tags: string[][]) => tags.find(t => t[0] === 'nonce')?.[1]
    for (const r of seen) {
      if (r.method === 'GET') expect(nonce(r.tags)).toBeUndefined()
      else expect(nonce(r.tags)).toMatch(/^[a-f0-9]{32}$/)
    }
    const writes = seen.filter(r => r.method !== 'GET')
    expect(writes.map(r => r.method)).toEqual(['PUT', 'PUT', 'PUT', 'DELETE', 'POST'])
    expect(new Set(writes.map(r => r.id)).size).toBe(writes.length)
    expect(h.sent).toHaveLength(1)
  })

  it('says a send went already when the host saw that very request before, and sends nothing again', async () => {
    const h = host()
    // Something between the hive and the host (a proxy, an extension) sends the same signed request twice.
    const fetch = async (url: string, init: RequestInit) => {
      if ((init.method ?? 'GET') !== 'POST') return h.fetch(url, init)
      await h.fetch(url, init)
      return h.fetch(url, init)
    }
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    const changes: unknown[] = []
    s.addEventListener('change', event => changes.push((event as CustomEvent).detail))
    await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })).rejects.toMatchObject({ code: 'conflict', detail: ALREADY_SENT })
    expect(h.sent).toHaveLength(1)
    expect(changes).toEqual([{ sent: true }]) // Sent has the copy: the window refreshes it
    expect((await service(h, signerFor(jaime)).list(ME, 'sent')).items).toHaveLength(1)
  })

  it('tells a replayed write apart from "hide it first"', async () => {
    const h = host()
    await h.arrive(MIME)
    const fetch = async (url: string, init: RequestInit) => {
      if ((init.method ?? 'GET') !== 'PUT') return h.fetch(url, init)
      await h.fetch(url, init)
      return h.fetch(url, init)
    }
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    const [item] = (await s.list(ME, 'box')).items
    await expect(s.setMarks(ME, 'box', item!.sig, { read: true })).rejects.toMatchObject({ code: 'conflict', detail: ALREADY_DONE })
    expect((await s.list(ME, 'box')).items[0]!.marks).toMatchObject({ read: true }) // the first one did land
    const plain = service(h, signerFor(jaime))
    const refused = await plain.remove(ME, 'box', item!.sig).catch((error: unknown) => error as MailError)
    expect(refused).toMatchObject({ code: 'conflict' })
    expect((refused as MailError).detail).not.toBe(ALREADY_DONE)
  })

  it('carries what each key may do, and names the act a key with a role was refused', async () => {
    const reader = generateSecretKey()
    const h = host({ MAIL_KEYS: JSON.stringify({ [ME]: [getPublicKey(jaime), { key: getPublicKey(reader), can: ['read'] }] }) })
    await h.arrive(MIME)
    expect((await service(h, signerFor(jaime)).mailboxes())[0]!.can).toEqual(MAIL_ACTS)
    const s = service(h, signerFor(reader))
    expect(await s.mailboxes()).toEqual([{ address: ME, name: 'Jaime', host: 'https://hypercomb.com', can: ['read'] }])
    // It still reads: every listed key is sealed to.
    const [item] = (await s.list(ME, 'box')).items
    expect((await s.read(ME, item!.sig)).text).toBe('see the attachment')
    await expect(s.setMarks(ME, 'box', item!.sig, { read: true })).rejects.toMatchObject({ code: 'forbidden', detail: 'mark' })
    await expect(s.saveDraft(ME, { subject: 'd' })).rejects.toMatchObject({ code: 'forbidden', detail: 'draft' })
    await expect(s.remove(ME, 'box', item!.sig)).rejects.toMatchObject({ code: 'forbidden', detail: 'delete' })
    await expect(s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })).rejects.toMatchObject({ code: 'forbidden', detail: 'send' })
    expect(h.sent).toHaveLength(0)
  })

  it('reads a host from before roles as giving every act', async () => {
    const fetch = async () => new Response(JSON.stringify({ addresses: [ME] }), { headers: { 'content-type': 'application/json' } })
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    expect((await s.mailboxes())[0]!.can).toEqual(MAIL_ACTS)
  })

  it('does not open a list line the host moved onto another message', async () => {
    const h = host()
    await h.arrive(MIME)
    await h.arrive('From: bo@example.org\r\nSubject: second\r\n\r\nhello\r\n')
    const pool = await sha256Hex(`mail:${ME}`)
    const [a, b] = (await service(h, signerFor(jaime)).list(ME, 'box')).items
    const from = (await h.MAIL.get(`${pool}/${a!.sig}`))!
    const to = (await h.MAIL.get(`${pool}/${b!.sig}`))!
    await h.MAIL.put(`${pool}/${b!.sig}`, new Uint8Array(await to.arrayBuffer()), { customMetadata: from.customMetadata })
    const items = (await service(h, signerFor(jaime)).list(ME, 'box')).items
    expect(items.find(i => i.sig === a!.sig)!.meta).not.toBeNull()
    expect(items.find(i => i.sig === b!.sig)!.meta).toBeNull()
  })

  it('keeps the lowered caps', () => {
    expect(MAIL_LIMITS).toMatchObject({ attachments: 10, attachmentBytes: 6 * 1024 * 1024, recipients: 20, sendBytes: 10 * 1024 * 1024 })
  })
})

describe('after the second security pass (R2)', () => {
  const json = (value: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) } })

  /** A body of `total` bytes, made only as it is pulled; `pulled()` says how much the reader took. */
  function endless(total: number, chunk = 64 * 1024): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
    let made = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (made >= total) { controller.close(); return }
        const size = Math.min(chunk, total - made)
        made += size
        controller.enqueue(new Uint8Array(size).fill(0x41))
      },
    }, { highWaterMark: 0 })
    return { stream, pulled: () => made }
  }

  it('takes the rows it asked for, each once, so a host cannot make the signer work for 5,000', async () => {
    const epk = getPublicKey(generateSecretKey())
    // Three wraps all mislabelled: the most a row can cost the signer.
    const wraps = [0, 1, 2].map(() => ({ to: 'x', epk, wk: 'x' }))
    const sigOf = (i: number) => i.toString(16).padStart(64, '0')
    const rows = Array.from({ length: 5000 }, (_, i) => ({ sig: sigOf(i), v: 2, meta: 'A.A', wraps }))
    let decrypts = 0
    const signer = signerFor(jaime, { nip44Decrypt: async () => { decrypts++; return null } })
    const s = new MailService({ fetch: async () => json({ items: rows }), signer: () => signer, extension: () => false }, HOST)
    const page = await s.list(ME, 'box')
    expect(page.items).toHaveLength(MAIL_READ_CAPS.rows)
    expect(decrypts).toBeLessThanOrEqual(300)

    decrypts = 0
    const same = Array.from({ length: 5000 }, () => ({ sig: sigOf(7), v: 2, meta: 'A.A', wraps }))
    const once = new MailService({ fetch: async () => json({ items: same }), signer: () => signer, extension: () => false }, HOST)
    expect((await once.list(ME, 'box')).items.map(i => i.sig)).toEqual([sigOf(7)])
    expect(decrypts).toBeLessThanOrEqual(3)
  })

  it('keeps at most 50 addresses from /mail/me', async () => {
    const addresses = Array.from({ length: 20_000 }, (_, i) => `a${i}@hypercomb.com`)
    const s = new MailService({ fetch: async () => json({ addresses }), signer: () => signerFor(jaime), extension: () => false }, HOST)
    const boxes = await s.mailboxes()
    expect(boxes).toHaveLength(MAIL_READ_CAPS.addresses)
  })

  it('stops reading a 400 MB message at its cap, having read only about the cap', async () => {
    const big = endless(400 * 1024 * 1024)
    const s = new MailService({
      fetch: async () => new Response(big.stream, { headers: { 'content-type': 'application/octet-stream' } }),
      signer: () => signerFor(jaime), extension: () => false,
    }, HOST)
    await expect(s.read(ME, 'a'.repeat(64))).rejects.toMatchObject({ code: 'bad-message', detail: 'message too large' })
    const cap = MAIL_READ_CAPS.messageBytes + MAIL_READ_CAPS.envelopeSlack
    expect(big.pulled()).toBeGreaterThan(cap)
    expect(big.pulled()).toBeLessThanOrEqual(cap + 3 * 64 * 1024)
  })

  it('stops reading a 150 MB list, and a 300 MB error, at their caps', async () => {
    const list = endless(150 * 1024 * 1024)
    const s = new MailService({
      fetch: async () => new Response(list.stream, { headers: { 'content-type': 'application/json' } }),
      signer: () => signerFor(jaime), extension: () => false,
    }, HOST)
    await expect(s.list(ME, 'box')).rejects.toMatchObject({ code: 'unavailable', detail: 'answer too large' })
    expect(list.pulled()).toBeLessThanOrEqual(MAIL_READ_CAPS.answerBytes + 3 * 64 * 1024)

    const error = endless(300 * 1024 * 1024)
    const refusing = new MailService({
      fetch: async () => new Response(error.stream, { status: 422, headers: { 'content-type': 'text/plain' } }),
      signer: () => signerFor(jaime), extension: () => false,
    }, HOST)
    const refused = await refusing.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' }).catch((e: unknown) => e as MailError)
    expect(refused).toMatchObject({ code: 'refused' })
    expect((refused as MailError).detail.length).toBeLessThanOrEqual(200)
    expect(error.pulled()).toBeLessThanOrEqual(MAIL_READ_CAPS.errorBytes + 3 * 64 * 1024)
  })

  it('does not read a body whose length already says it is past the cap', async () => {
    const big = endless(50 * 1024 * 1024)
    const s = new MailService({
      fetch: async () => new Response(big.stream, { headers: { 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) } }),
      signer: () => signerFor(jaime), extension: () => false,
    }, HOST)
    await expect(s.list(ME, 'box')).rejects.toMatchObject({ code: 'unavailable', detail: 'answer too large' })
    expect(big.pulled()).toBeLessThanOrEqual(64 * 1024)
  })

  it('never tells an address\'s own domain about the key unless that domain is a host the participant gave', async () => {
    const h = host()
    const asked: string[] = []
    const fetch = async (url: string, init: RequestInit) => {
      const { origin } = new URL(url)
      asked.push(origin)
      if (origin !== 'https://hypercomb.com') throw new TypeError('network')
      return h.fetch(url, init)
    }
    const fresh = () => new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false }, HOST)
    await expect(fresh().list('me@gmail.com', 'box')).rejects.toBeInstanceOf(MailError)
    await expect(fresh().send({ from: 'me@outlook.com', to: ['a@example.org'], subject: 's', text: 't' })).rejects.toBeInstanceOf(MailError)
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every(origin => origin === 'https://hypercomb.com')).toBe(true)
    expect(h.sent).toEqual([])
  })

  it('gives a malformed Sent copy and a malformed draft their shape', async () => {
    const h = host()
    const s = service(h, signerFor(jaime))
    // Where the host keeps this address's Sent copies and drafts: learned from a real one of each.
    await s.send({ from: ME, to: ['a@example.org'], subject: 's', text: 't' })
    const [real] = (await s.list(ME, 'sent')).items
    const draft = await s.saveDraft(ME, { subject: 'd' })
    const poolOf = (sig: string) => [...h.MAIL.map.keys()].find((k: string) => k.endsWith(`/${sig}`) && !k.startsWith('marks/'))!.split('/')[0]
    const plant = async (sig: string, value: unknown): Promise<string> => {
      const sealed = await sealMessageV1(enc.encode(JSON.stringify(value)), getPublicKey(jaime), { at: 1 })
      await h.MAIL.put(`${poolOf(sig)}/${sealed.sig}`, sealed.envelope, { customMetadata: sealed.customMetadata })
      return sealed.sig
    }

    const bad = { to: 'x@y.org', cc: null, bcc: [1, 'b@y.org', {}], subject: 7, html: null, attachments: [{}, { filename: 'f', content: 'QQ==' }, 'x'], at: 'soon' }
    const sent = await s.readSent(ME, await plant(real!.sig, bad))
    expect(sent).toEqual({
      id: null, from: '', to: ['x@y.org'], cc: [], bcc: ['b@y.org'], subject: '', text: '', html: '',
      inReplyTo: null, references: null, attachments: [{ filename: 'f', type: 'application/octet-stream', content: 'QQ==' }], at: 0,
    })
    expect(sent.to.join(', ')).toBe('x@y.org') // what the read pane does with it

    const kept = await s.readDraft(ME, await plant(draft.sig, { ...bad, to: ['a@y.org', null], text: 'hi' }))
    expect(kept).toEqual({ to: ['a@y.org'], cc: [], bcc: ['b@y.org'], text: 'hi', attachments: [{ filename: 'f', type: 'application/octet-stream', content: 'QQ==' }] })
    expect(await s.readDraft(ME, await plant(draft.sig, { to: 'typed, as is' }))).toEqual({ to: 'typed, as is' })
  })
})

// ── GRANTED ADDRESSES: the hive half of the admin contract ─────────────────────────────────────
//
// jwize, 2026-11-08: "Mail shouldn't be hardcoded to my address. Instead you should be able make that
// available." The key that runs a host (ADMIN_KEYS) gives an address to a key from the desk, over
// GET/PUT/DELETE /mail/grants — the same signed, single-use requests as every write. First against a
// recording fake answering the contract's shapes (the request side, pinned whatever the Worker does),
// then end to end through the real Worker.
describe('granted addresses (the admin contract)', () => {
  const ana = generateSecretKey()
  const ANA = 'ana@hypercomb.com'
  const ZONES = ['hypercomb.com', 'mail.hypercomb.com']

  /** A host answering the contract's shapes, every call recorded with the signed event behind it. */
  function recording(over: { admin?: boolean; grants?: Record<string, unknown>; answer?: (method: string, path: string) => Response | null } = {}) {
    const calls: { method: string; url: string; body: unknown; event: { id: string; tags: string[][] } }[] = []
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
    const fetch = async (url: string, init: RequestInit): Promise<Response> => {
      const body = init.body ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array)) as Record<string, unknown> : undefined
      const method = init.method ?? 'GET'
      calls.push({ method, url, body, event: eventOf(init) })
      const { pathname } = new URL(url)
      const forced = over.answer?.(method, pathname)
      if (forced) return forced
      if (pathname === '/mail/me') return json(over.admin === false ? { addresses: [], names: {}, can: {}, admin: false } : { addresses: [], names: {}, can: {}, admin: true, zones: ZONES })
      if (pathname === '/mail/grants') return json({ zones: ZONES, grants: over.grants ?? {} })
      if (pathname.startsWith('/mail/grants/')) {
        if (method === 'DELETE') return new Response(null, { status: 204 })
        const keys = (body!['keys'] as unknown[]).map(k => (typeof k === 'string' ? { key: k, can: MAIL_ACTS } : k))
        return json({ address: decodeURIComponent(pathname.slice('/mail/grants/'.length)), v: 1, ...body, keys, by: getPublicKey(jaime), at: 1_700_000_000_000 })
      }
      return new Response('not found', { status: 404 })
    }
    return { fetch, calls }
  }
  const over = (net: ReturnType<typeof recording>, signer = signerFor(jaime)) =>
    new MailService({ fetch: net.fetch, signer: () => signer, extension: () => false }, HOST)
  const tag = (event: { tags: string[][] }, name: string): string | undefined => event.tags.find(t => t[0] === name)?.[1]

  it('keeps the hosts this key runs from /mail/me; an admin with no mailbox yet is an empty list, not an error', async () => {
    const s = over(recording())
    expect(s.hostsRun()).toEqual([])
    expect(await s.mailboxes()).toEqual([])
    expect(s.hostsRun()).toEqual([{ origin: HOST, zones: ZONES }])
    // A host that does not say so is not run by this key — and a host from before the contract says nothing.
    const plain = over(recording({ admin: false }))
    await plain.mailboxes()
    expect(plain.hostsRun()).toEqual([])
    const old = new MailService({ fetch: async () => new Response(JSON.stringify({ addresses: [ME] }), { headers: { 'content-type': 'application/json' } }), signer: () => signerFor(jaime), extension: () => false }, HOST)
    await old.mailboxes()
    expect(old.hostsRun()).toEqual([])
  })

  it('reads what the host lists through the caps: 50 grants, 3 keys, the five acts, a name of 64, nothing else', async () => {
    const grants: Record<string, unknown> = {
      [ANA]: { keys: [{ key: getPublicKey(ana), can: ['read', 'send', 'fly'] }], name: 'A'.repeat(100), copyTo: 'copy@example.org', source: 'grant', by: getPublicKey(jaime), at: 5, extra: 'dropped' },
      [ME]: { keys: [getPublicKey(jaime), getPublicKey(leanne), getPublicKey(ana), 'f'.repeat(64), 'e'.repeat(64)], source: 'secret' },
      'leanne@hypercomb.com': { keys: [{ key: getPublicKey(leanne), can: 'read' }, 'not a key', getPublicKey(leanne)], source: 'whatever' },
      'no keys@hypercomb.com': { keys: [] },
      'not an address': { keys: [getPublicKey(ana)] },
      'broken@hypercomb.com': { keys: [], source: 'secret' }, // the host's own entry with no valid key: shown
      'empty@hypercomb.com': { keys: [], source: 'grant' }, // a grant with no key is nothing
    }
    for (let i = 0; i < 60; i++) grants[`u${i}@hypercomb.com`] = { keys: [getPublicKey(ana)], source: 'grant' }
    const listed = await over(recording({ grants })).grants(HOST)
    expect(listed.zones).toEqual(ZONES)
    expect(listed.grants).toHaveLength(MAIL_READ_CAPS.grants)
    expect(listed.grants.map(g => g.address).slice(0, 4)).toEqual([ANA, 'broken@hypercomb.com', ME, 'leanne@hypercomb.com'])
    const by = (address: string) => listed.grants.find(g => g.address === address)
    expect(by(ANA)).toEqual({ address: ANA, keys: [{ key: getPublicKey(ana), can: ['read', 'send'] }], name: 'A'.repeat(64), copyTo: 'copy@example.org', source: 'grant', by: getPublicKey(jaime), at: 5 })
    expect(by(ME)).toEqual({ address: ME, keys: [getPublicKey(jaime), getPublicKey(leanne), getPublicKey(ana)].map(key => ({ key, can: MAIL_ACTS })), source: 'secret' })
    expect(by('leanne@hypercomb.com')).toEqual({ address: 'leanne@hypercomb.com', keys: [{ key: getPublicKey(leanne), can: ['read'] }], source: 'grant' })
    expect(by('broken@hypercomb.com')).toEqual({ address: 'broken@hypercomb.com', keys: [], source: 'secret' })
    expect(by('empty@hypercomb.com')).toBeUndefined()
    expect(listed.grants.some(g => g.address.includes(' '))).toBe(false)
  })

  it('grant() PUTs the record over a signed, single-use request and reads the stored record back; revoke() DELETEs', async () => {
    const net = recording()
    const s = over(net)
    const stored = await s.grant(HOST, ' Ana@Hypercomb.com ', { keys: [{ key: getPublicKey(ana).toUpperCase(), can: ['send', 'read'] }, getPublicKey(leanne), getPublicKey(leanne)], name: ' Ana ' })
    const put = net.calls.at(-1)!
    expect(put.method).toBe('PUT')
    expect(put.url).toBe(`${HOST}/mail/grants/ana%40hypercomb.com`)
    expect(put.body).toEqual({ keys: [{ key: getPublicKey(ana), can: ['read', 'send'] }, getPublicKey(leanne)], name: 'Ana' })
    expect(tag(put.event, 'method')).toBe('PUT')
    expect(tag(put.event, 'u')).toBe(put.url)
    expect(tag(put.event, 'payload')).toBe(await sha256Hex(JSON.stringify(put.body)))
    expect(tag(put.event, 'nonce')).toMatch(/^[0-9a-f]{32}$/)
    // The answer's `v: 1` (and anything else this client does not know) is not carried.
    expect(stored).toEqual({ address: ANA, keys: [{ key: getPublicKey(ana), can: ['read', 'send'] }, { key: getPublicKey(leanne), can: MAIL_ACTS }], name: 'Ana', source: 'grant', by: getPublicKey(jaime), at: 1_700_000_000_000 })
    // A copy address goes as a string and only when there is one — never null.
    await s.grant(HOST, ANA, { keys: [getPublicKey(ana)], copyTo: ' Copy@Example.org ' })
    expect(net.calls.at(-1)!.body).toEqual({ keys: [getPublicKey(ana)], copyTo: 'copy@example.org' })
    await s.grant(HOST, ANA, { keys: [getPublicKey(ana)], copyTo: '', name: '' })
    expect(net.calls.at(-1)!.body).toEqual({ keys: [getPublicKey(ana)] })

    await s.revoke(HOST, 'ANA@hypercomb.com')
    const del = net.calls.at(-1)!
    expect(del.method).toBe('DELETE')
    expect(del.url).toBe(`${HOST}/mail/grants/ana%40hypercomb.com`)
    expect(del.body).toBeUndefined()
    expect(tag(del.event, 'nonce')).toMatch(/^[0-9a-f]{32}$/)
    expect(tag(del.event, 'payload')).toBeUndefined()
    // a read is not spent and carries no nonce
    await s.grants(HOST)
    expect(tag(net.calls.at(-1)!.event, 'nonce')).toBeUndefined()
  })

  it('refuses a bad key, too many keys or a bad address before a byte is signed, and passes the host\'s refusals on as what they are', async () => {
    const net = recording({
      answer: (method, path) => {
        if (method !== 'PUT') return null
        if (path.endsWith('zone%40elsewhere.example')) return new Response("not this host's zone", { status: 422 })
        if (path.endsWith('many%40hypercomb.com')) return new Response(JSON.stringify({ error: 'daily grant limit reached' }), { status: 429, headers: { 'content-type': 'application/json' } })
        if (path.endsWith('ghost%40hypercomb.com')) return new Response('not authorized', { status: 401 })
        return null
      },
    })
    const s = over(net)
    await expect(s.grant(HOST, ANA, { keys: ['nope'] })).rejects.toMatchObject({ code: 'refused', detail: 'bad keys' })
    await expect(s.grant(HOST, ANA, { keys: [] })).rejects.toMatchObject({ code: 'refused', detail: 'bad keys' })
    await expect(s.grant(HOST, ANA, { keys: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)] })).rejects.toMatchObject({ code: 'refused', detail: 'bad keys' })
    await expect(s.grant(HOST, 'not an address', { keys: [getPublicKey(ana)] })).rejects.toMatchObject({ code: 'refused', detail: 'bad address' })
    await expect(s.grant(HOST, ANA, { keys: [getPublicKey(ana)], copyTo: 'nowhere' })).rejects.toMatchObject({ code: 'refused', detail: 'bad copy address' })
    await expect(s.revoke(HOST, '@')).rejects.toMatchObject({ code: 'refused', detail: 'bad address' })
    expect(net.calls).toHaveLength(0) // nothing was signed or sent
    await expect(s.grant(HOST, 'zone@elsewhere.example', { keys: [getPublicKey(ana)] })).rejects.toMatchObject({ code: 'refused', detail: "not this host's zone" })
    await expect(s.grant(HOST, 'many@hypercomb.com', { keys: [getPublicKey(ana)] })).rejects.toMatchObject({ code: 'limit', detail: 'daily grant limit reached' })
    await expect(s.grant(HOST, 'ghost@hypercomb.com', { keys: [getPublicKey(ana)] })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(net.calls).toHaveLength(3)
  })

  it('end to end through the real Worker: an admin gives ana an address, her key lists and reads it, a revoke takes it back', async () => {
    const h = host({ ADMIN_KEYS: getPublicKey(jaime) })
    const admin = service(h, signerFor(jaime))
    expect((await admin.mailboxes()).map(box => box.address)).toEqual([ME])
    expect(admin.hostsRun()).toEqual([{ origin: HOST, zones: ['hypercomb.com'] }])
    const hers = service(h, signerFor(ana))
    expect(await hers.mailboxes()).toEqual([])
    expect(hers.hostsRun()).toEqual([])

    const stored = await admin.grant(HOST, ANA, { keys: [{ key: getPublicKey(ana), can: ['read', 'mark', 'send'] }], name: 'Ana' })
    expect(stored).toMatchObject({ address: ANA, keys: [{ key: getPublicKey(ana), can: ['read', 'mark', 'send'] }], name: 'Ana', source: 'grant', by: getPublicKey(jaime) })
    expect(typeof stored.at).toBe('number')
    expect(await hers.mailboxes()).toEqual([{ address: ANA, name: 'Ana', host: HOST, can: ['read', 'mark', 'send'] }])
    const listed = await admin.grants(HOST)
    expect(listed.zones).toEqual(['hypercomb.com'])
    expect(listed.grants.map(g => [g.address, g.source])).toEqual([[ANA, 'grant'], [ME, 'secret'], ['leanne@hypercomb.com', 'secret']])
    expect(listed.grants[1]).toMatchObject({ keys: [{ key: getPublicKey(jaime), can: MAIL_ACTS }], name: 'Jaime' })

    // Mail to her is sealed to her key from now on, and she reads it.
    await h.arrive('From: bo@example.org\r\nSubject: for ana\r\n\r\nhello ana\r\n', ANA)
    const [item] = (await hers.list(ANA, 'box')).items
    expect((await hers.read(ANA, item!.sig)).text).toBe('hello ana')

    // A key that is not an admin is told nothing; the host's refusals arrive as refused, with its words.
    await expect(service(h, signerFor(leanne)).grants(HOST)).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(admin.grant(HOST, 'x@elsewhere.example', { keys: [getPublicKey(ana)] })).rejects.toMatchObject({ code: 'refused', detail: "not this host's zone" })
    await expect(admin.grant(HOST, 'y@hypercomb.com', { keys: [getPublicKey(ana)], name: 'N'.repeat(65) })).rejects.toMatchObject({ code: 'refused', detail: 'bad name' })

    // A grant is the address's WHOLE record: given over the host's own entry for jaime, its keys, name and copy
    // replace the secret's while it stands; revoked, the secret's entry stands again, name and all.
    await admin.grant(HOST, ME, { keys: [getPublicKey(jaime), getPublicKey(ana)], name: 'Jaime W', copyTo: 'copy@example.org' })
    expect((await admin.grants(HOST)).grants.find(g => g.address === ME)).toMatchObject({ keys: [{ key: getPublicKey(jaime), can: MAIL_ACTS }, { key: getPublicKey(ana), can: MAIL_ACTS }], name: 'Jaime W', copyTo: 'copy@example.org', source: 'grant' })
    expect((await hers.mailboxes()).map(box => [box.address, box.name])).toEqual([[ANA, 'Ana'], [ME, 'Jaime W']])
    await admin.revoke(HOST, ME)
    expect((await admin.grants(HOST)).grants.find(g => g.address === ME)).toMatchObject({ keys: [{ key: getPublicKey(jaime), can: MAIL_ACTS }], name: 'Jaime', source: 'secret' })
    expect((await hers.mailboxes()).map(box => box.address)).toEqual([ANA])

    await admin.revoke(HOST, ANA)
    expect(await hers.mailboxes()).toEqual([])
    expect((await admin.grants(HOST)).grants.map(g => g.address)).toEqual([ME, 'leanne@hypercomb.com'])
    await expect(admin.revoke(HOST, ANA)).rejects.toMatchObject({ code: 'not-found' })
    await expect(admin.revoke(HOST, ME)).rejects.toMatchObject({ code: 'conflict' })
    // What arrived stays exactly where it was.
    expect((await h.MAIL.list({ prefix: await sha256Hex(`mail:${ANA}`) })).objects).toHaveLength(1)
  })
})
