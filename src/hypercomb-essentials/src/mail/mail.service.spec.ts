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
import { MailError, MailService, type MailSigner } from './mail.service.js'

const enc = new TextEncoder()
const jaime = generateSecretKey()
const leanne = generateSecretKey()
const ME = 'jaime@hypercomb.com'

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
  new MailService({ fetch: h.fetch, signer: () => signer, extension: () => extension })

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
    const s = new MailService({ fetch, signer: () => signerFor(jaime), extension: () => false })
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
    expect(h.sent).toEqual([{ from: ME, to: ['friend@example.org'], subject: 'Hello', text: 'A line.' }])

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
    const s = new MailService({ fetch, signer: () => signer, extension: () => false })
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
    const down = new MailService({ fetch: async () => { throw new TypeError('network') }, signer: () => signerFor(jaime), extension: () => false })
    await expect(down.addresses()).rejects.toBeInstanceOf(MailError)
    await expect(down.addresses()).rejects.toMatchObject({ code: 'unavailable' })
  })
})
