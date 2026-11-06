// mail/mail.view.spec.ts — the mail window, with the service replaced so nothing
// is fetched and no key is touched. What it proves: the window shows what it is
// given as TEXT, never as markup; a stranger's HTML runs in a frame that can do
// nothing; a message goes out only on a press, only once; and closing the window
// drops what it held.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { MailElement, MAIL_OPEN, explain } from './mail.view.js'
import { MailError, type MailService } from './mail.service.js'
import type { ParsedMail } from './mime.js'

const SIG = 'a'.repeat(64)
const SIG2 = 'b'.repeat(64)
const ME = 'jaime@hypercomb.com'

const parsed = (over: Partial<ParsedMail> = {}): ParsedMail => ({
  from: 'Ana <ana@example.org>', to: ME, cc: '', replyTo: '', subject: 'plans', date: 'Thu, 5 Nov 2026',
  messageId: '<m1@example.org>', inReplyTo: '', references: '', text: 'the plain text', html: '', attachments: [], inlineImages: {}, ...over,
})

function fakeService(over: Record<string, unknown> = {}) {
  return {
    addresses: vi.fn(async () => [ME]),
    publicKey: vi.fn(async () => 'f'.repeat(64)),
    list: vi.fn(async (_address: string, folder: string) => ({
      items: folder === 'box'
        ? [{ sig: SIG, at: 2, meta: { from: 'ana@example.org', subject: 'plans', at: 2 } }, { sig: SIG2, at: 1, meta: { from: 'bo@example.org', subject: '<img src=x onerror="window.pwned=1">', at: 1 } }]
        : [{ sig: SIG, at: 3, meta: { to: 'friend@example.org', subject: 'sent one', at: 3 } }],
      cursor: null,
    })),
    read: vi.fn(async () => parsed()),
    readSent: vi.fn(async () => ({ id: '<o@h>', from: ME, to: ['friend@example.org'], cc: [], bcc: [], subject: 'sent one', text: 'what I wrote', html: '', inReplyTo: null, references: null, at: 3 })),
    send: vi.fn(async () => ({ messageId: '<o@h>', sig: SIG })),
    ...over,
  }
}

const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)) }

let mounted: MailElement | null = null
async function windowWith(service: ReturnType<typeof fakeService>): Promise<MailElement> {
  const element = document.createElement('hc-mail') as MailElement
  element.service = service as unknown as MailService
  document.body.appendChild(element)
  mounted = element
  element.open()
  await settle()
  return element
}
const panel = (): HTMLElement => document.querySelector('.hc-mail') as HTMLElement
const press = (label: string): void => {
  const button = Array.from(panel().querySelectorAll('button')).find(b => b.textContent === label)
  if (!button) throw new Error(`no button "${label}" in: ${Array.from(panel().querySelectorAll('button')).map(b => b.textContent).join(' | ')}`)
  button.click()
}
const fill = (name: string, value: string): void => {
  const field = panel().querySelector(`[name="${name}"]`) as HTMLInputElement
  field.value = value
}

beforeAll(() => { if (!customElements.get('hc-mail')) customElements.define('hc-mail', MailElement) })
afterEach(() => { mounted?.remove(); mounted = null; document.body.replaceChildren() })

describe('opening', () => {
  it('shows the inbox of the address this key owns', async () => {
    await windowWith(fakeService())
    expect(panel().textContent).toContain(ME)
    expect(panel().querySelectorAll('.hc-mail-row')).toHaveLength(2)
    expect(panel().querySelector('.hc-mail-row-subject')?.textContent).toBe('plans')
  })

  it('opens on a fresh press of the word, not on a stale replay of it', async () => {
    const element = document.createElement('hc-mail') as MailElement
    element.service = fakeService() as unknown as MailService
    document.body.appendChild(element)
    mounted = element
    EffectBus.emit(MAIL_OPEN, { at: Date.now() - 60_000 })
    await settle()
    expect(element.isOpen).toBe(false)
    EffectBus.emit(MAIL_OPEN, { at: Date.now() })
    await settle()
    expect(element.isOpen).toBe(true)
  })

  it('tells a key with no mailbox its public key so a host can be told, and says nothing else', async () => {
    await windowWith(fakeService({ addresses: vi.fn(async () => []) }))
    expect(panel().querySelector('.hc-mail-keybox')?.textContent).toBe('f'.repeat(64))
    expect(panel().querySelector('.hc-mail-row')).toBeNull()
  })

  it('says why, and offers another try, when the host cannot be reached', async () => {
    await windowWith(fakeService({ addresses: vi.fn(async () => { throw new MailError('unavailable') }) }))
    expect(panel().textContent).toContain('did not answer')
    expect(Array.from(panel().querySelectorAll('button')).some(b => b.textContent === 'Try again')).toBe(true)
  })

  it('says a device without a key holds none, and that none is made', async () => {
    await windowWith(fakeService({ addresses: vi.fn(async () => { throw new MailError('no-key') }) }))
    expect(panel().textContent).toContain('holds no key')
    expect(panel().textContent).toContain('never makes one')
  })
})

describe('what a stranger wrote is only ever text', () => {
  it('shows a hostile subject as words, not as an element', async () => {
    await windowWith(fakeService())
    expect(panel().querySelector('img')).toBeNull()
    expect(panel().textContent).toContain('<img src=x onerror=')
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined()
  })

  it('shows plain text in a text node', async () => {
    await windowWith(fakeService({ read: vi.fn(async () => parsed({ text: '<script>window.pwned=1</script>hello' })) }))
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('<script>window.pwned=1</script>hello')
    expect(panel().querySelector('script')).toBeNull()
  })

  it('shows html mail in a script-less sandboxed frame that may load nothing outside, and says what it held back', async () => {
    const html = '<p onclick="x()">hi</p><script>alert(1)</script><img src="https://tracker.example/p.gif">'
    await windowWith(fakeService({ read: vi.fn(async () => parsed({ html })) }))
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    const frame = panel().querySelector('iframe') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox')
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-scripts|allow-same-origin|allow-top-navigation/)
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.srcdoc).toContain("default-src 'none'")
    expect(frame.srcdoc).toContain('img-src data:')
    expect(frame.srcdoc).not.toMatch(/<script|onclick|tracker\.example/)
    expect(panel().textContent).toContain('remote items were not loaded')
  })

  it('lets the reader choose the plain text of an html message', async () => {
    await windowWith(fakeService({ read: vi.fn(async () => parsed({ html: '<p>hi</p>', text: 'hi' })) }))
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('iframe')).not.toBeNull()
    press('Show plain text')
    expect(panel().querySelector('iframe')).toBeNull()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('hi')
  })

  it('lists attachments by name without opening them', async () => {
    await windowWith(fakeService({ read: vi.fn(async () => parsed({ attachments: [{ filename: 'plan.pdf', type: 'application/pdf', size: 2048 }] })) }))
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('.hc-mail-attachments')?.textContent).toBe('plan.pdf · application/pdf · 2 KB')
    expect(panel().querySelector('a')).toBeNull()
  })
})

describe('writing and sending', () => {
  it('drafts a reply from what was read, and sends it only on the press', async () => {
    const service = fakeService()
    await windowWith(service)
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    press('Reply')
    expect((panel().querySelector('[name="to"]') as HTMLInputElement).value).toBe('Ana <ana@example.org>')
    expect((panel().querySelector('[name="subject"]') as HTMLInputElement).value).toBe('Re: plans')
    expect(service.send).not.toHaveBeenCalled()

    fill('text', 'my answer')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    expect(service.send).toHaveBeenCalledTimes(1)
    expect(service.send).toHaveBeenCalledWith(expect.objectContaining({
      from: ME, to: ['ana@example.org'], subject: 'Re: plans', text: 'my answer', inReplyTo: '<m1@example.org>', references: '<m1@example.org>',
    }))
    expect(panel().textContent).toContain('Sent to ana@example.org.')
    expect(panel().querySelector('form')).toBeNull()
  })

  it('asks for what is missing and sends nothing until it is there', async () => {
    const service = fakeService()
    await windowWith(service)
    press('Write')
    const submit = (): void => (panel().querySelector('form') as HTMLFormElement).requestSubmit()
    submit(); await settle()
    expect(panel().textContent).toContain('Add at least one address')
    fill('to', 'friend@example.org'); submit(); await settle()
    expect(panel().textContent).toContain('Add a subject')
    fill('to', 'friend@example.org'); fill('subject', 'hi'); submit(); await settle()
    expect(panel().textContent).toContain('Write something first')
    expect(service.send).not.toHaveBeenCalled()
  })

  it('keeps the draft and says why when a send fails, and sends once even if pressed twice', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const send = vi.fn(async () => { await gate; throw new MailError('limit') })
    await windowWith(fakeService({ send }))
    press('Write')
    fill('to', 'friend@example.org'); fill('subject', 'hi'); fill('text', 'body')
    const form = panel().querySelector('form') as HTMLFormElement
    form.requestSubmit(); form.requestSubmit()
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect((panel().querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
    release()
    await settle()
    expect(panel().textContent).toContain('sending limit')
    expect((panel().querySelector('[name="text"]') as HTMLTextAreaElement).value).toBe('body')
  })

  it('names the addresses it tried when Cloudflare will not send to one that bounced before', async () => {
    const send = vi.fn(async () => { throw new MailError('refused', 'E_RECIPIENT_SUPPRESSED') })
    await windowWith(fakeService({ send }))
    press('Write')
    fill('to', 'hypercomb.ui@gmail.com'); fill('cc', 'friend@example.org'); fill('subject', 'hi'); fill('text', 'body')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    const said = panel().querySelector('.hc-mail-said.is-bad')?.textContent ?? ''
    expect(said).toContain('bounced before')
    expect(said).toContain('hypercomb.ui@gmail.com, friend@example.org')
    expect(said).not.toContain('E_RECIPIENT_SUPPRESSED')
    expect((panel().querySelector('[name="to"]') as HTMLInputElement).value).toBe('hypercomb.ui@gmail.com')
  })

  it('shows what was sent from the Sent folder', async () => {
    await windowWith(fakeService())
    press('Sent'); await settle()
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('what I wrote')
    expect(Array.from(panel().querySelectorAll('button')).some(b => b.textContent === 'Reply')).toBe(false)
  })
})

describe('leaving', () => {
  it('Escape steps back out of a message, then closes, and a close drops what was held', async () => {
    const service = fakeService()
    const element = await windowWith(service)
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('.hc-mail-text')).not.toBeNull()
    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(panel().querySelector('.hc-mail-row')).not.toBeNull()
    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element.isOpen).toBe(false)
    expect(document.querySelector('.hc-mail')).toBeNull()

    element.open(); await settle()
    expect(service.list).toHaveBeenCalledTimes(2) // read again, not remembered
  })

  it('does not paint an answer that arrives after the window was closed', async () => {
    let answer: (v: string[]) => void = () => {}
    const slow = new Promise<string[]>(resolve => { answer = resolve })
    const element = document.createElement('hc-mail') as MailElement
    element.service = fakeService({ addresses: vi.fn(() => slow) }) as unknown as MailService
    document.body.appendChild(element)
    mounted = element
    element.open()
    element.close()
    answer([ME])
    await settle()
    expect(document.querySelector('.hc-mail')).toBeNull()
  })
})

describe('explain', () => {
  it('has words for every way mail can fail', () => {
    for (const code of ['no-signer', 'no-key', 'unauthorized', 'not-found', 'limit', 'refused', 'bad-message', 'unavailable'] as const) {
      expect(explain(new MailError(code, 'why')).length).toBeGreaterThan(10)
    }
    expect(explain(new MailError('unavailable'), true)).toContain('Nothing was sent')
    expect(explain(new Error('anything else'))).toContain('did not answer')
  })
})
