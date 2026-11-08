// mail/mail.view.spec.ts — the mail window, with the service replaced so nothing
// is fetched and no key is touched. What it proves: the window shows what it is
// given as TEXT, never as markup; a stranger's HTML runs in a frame that can do
// nothing; a message goes out only on a press, only once; closing the window
// drops what it held; every act says what it is doing the moment it is pressed
// (placeholders before any row opens, rows arriving one by one in their final
// places); hide comes before delete, and delete takes two acts; and an arrival
// lights a pill but never opens the window.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { MailElement, MAIL_OPEN, MAIL_UNREAD, UNREAD_INDICATOR, explain } from './mail.view.js'
import { ALREADY_DONE, ALREADY_SENT, MAIL_LIMITS, MailError, type MailAct, type MailListItem, type MailService } from './mail.service.js'
import { sizeLabel } from './cue.js'
import type { SaveMessageInput, SaveMessageResult } from './mail-to-hive.js'
import { MAIL_TEMPLATE_PART_TYPE, mailPart, type MailTemplateDocument } from './template.js'
import { listTemplates, saveTemplate, type TemplateStore } from './template-pool.js'

// Every walk of a message's bytes, counted: the real reader runs, and the spec sees which bytes it was
// handed. A stranger chooses how large a message is, so how often the window walks it is what matters.
const walks = vi.hoisted(() => ({ of: [] as Uint8Array[] }))
vi.mock('./mime.js', async importOriginal => {
  const real = await importOriginal<typeof import('./mime.js')>()
  return {
    ...real,
    parseMail: (bytes: Uint8Array) => { walks.of.push(bytes); return real.parseMail(bytes) },
    attachmentBytes: (raw: Uint8Array, index: number) => { walks.of.push(raw); return real.attachmentBytes(raw, index) },
    attachmentsBytes: (raw: Uint8Array, indices: readonly number[]) => { walks.of.push(raw); return real.attachmentsBytes(raw, indices) },
  }
})

const SIG = 'a'.repeat(64)
const SIG2 = 'b'.repeat(64)
const SIG3 = 'c'.repeat(64)
const ME = 'jaime@hypercomb.com'

/**
 * A received message as the host hands it over: raw bytes, which the window parses itself (and keeps,
 * for downloads, forwards and Save to hive). Plain text alone, or text + html, plus any files.
 */
function mime(over: { text?: string; html?: string; files?: readonly { filename: string; type: string; base64: string }[] } = {}): Uint8Array {
  const text = over.text ?? 'the plain text'
  const head = ['From: Ana <ana@example.org>', `To: ${ME}`, 'Subject: plans', 'Date: Thu, 5 Nov 2026', 'Message-ID: <m1@example.org>', 'MIME-Version: 1.0']
  const plain = ['Content-Type: text/plain; charset=utf-8', '', text]
  const body = over.html === undefined ? plain
    : ['Content-Type: multipart/alternative; boundary="a"', '', '--a', ...plain, '--a', 'Content-Type: text/html; charset=utf-8', '', over.html, '--a--']
  const lines = !over.files?.length ? [...head, ...body]
    : [...head, 'Content-Type: multipart/mixed; boundary="b"', '', '--b', ...body,
      ...over.files.flatMap(f => ['--b', `Content-Type: ${f.type}; name="${f.filename}"`, `Content-Disposition: attachment; filename="${f.filename}"`, 'Content-Transfer-Encoding: base64', '', f.base64]),
      '--b--', '']
  return new TextEncoder().encode(lines.join('\r\n'))
}

type Row = Partial<MailListItem> & Pick<MailListItem, 'sig'>

function fakeService(over: Record<string, unknown> = {}) {
  const service = {
    addresses: vi.fn(async () => [ME]),
    // The window asks for mailboxes (names and all); a spec that overrides `addresses` still steers it.
    mailboxes: vi.fn(async () => (await service.addresses()).map((address: string) => ({ address, host: 'https://hypercomb.com' }))),
    publicKey: vi.fn(async () => 'f'.repeat(64)),
    list: vi.fn(async (_address: string, folder: string, _cursor?: string | null, _onItem?: unknown) => ({
      items: folder === 'box'
        ? [{ sig: SIG, at: 2, meta: { from: 'ana@example.org', subject: 'plans', at: 2 } }, { sig: SIG2, at: 1, meta: { from: 'bo@example.org', subject: '<img src=x onerror="window.pwned=1">', at: 1 } }]
        : folder === 'sent' ? [{ sig: SIG, at: 3, meta: { to: 'friend@example.org', subject: 'sent one', at: 3 } }] : [],
      cursor: null,
    }) as { items: Row[]; cursor: string | null }),
    readRaw: vi.fn(async (_address: string, _sig: string) => mime()),
    readSent: vi.fn(async () => ({ id: '<o@h>', from: ME, to: ['friend@example.org'], cc: [], bcc: [], subject: 'sent one', text: 'what I wrote', html: '', inReplyTo: null, references: null, at: 3 }) as Record<string, unknown>),
    readDraft: vi.fn(async () => ({ to: 'friend@example.org', subject: 'half done', text: 'so far' }) as Record<string, unknown>),
    send: vi.fn(async (_request: Record<string, unknown>) => ({ messageId: '<o@h>', sig: SIG })),
    setMarks: vi.fn(async (_a: string, _f: string, _s: string, marks: Record<string, boolean>) => ({ ...marks, at: 9 })),
    remove: vi.fn(async () => undefined),
    saveDraft: vi.fn(async (_address: string, _draft: Record<string, unknown>, _replaces?: string | null) => ({ sig: SIG3, replaced: false })),
    removeDraft: vi.fn(async () => undefined),
    ...over,
  }
  return service
}

const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
/** One drawn frame: rows that opened are drawn together on the next one. */
const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()))

let mounted: MailElement | null = null
async function windowWith(service: ReturnType<typeof fakeService>, setup: (element: MailElement) => void = () => {}): Promise<MailElement> {
  const element = document.createElement('hc-mail') as MailElement
  element.service = service as unknown as MailService
  setup(element)
  document.body.appendChild(element)
  mounted = element
  element.open()
  await settle()
  return element
}
const panel = (): HTMLElement => document.querySelector('.hc-mail') as HTMLElement
const buttons = (): HTMLButtonElement[] => Array.from(panel().querySelectorAll('button'))
const button = (label: string): HTMLButtonElement => {
  const found = buttons().find(b => b.textContent === label)
  if (!found) throw new Error(`no button "${label}" in: ${buttons().map(b => b.textContent).join(' | ')}`)
  return found
}
const press = (label: string): void => { button(label).click() }
const fill = (name: string, value: string): void => {
  const field = panel().querySelector(`[name="${name}"]`) as HTMLInputElement
  field.value = value
}
const type = (name: string, value: string): void => {
  fill(name, value)
  panel().querySelector(`[name="${name}"]`)!.dispatchEvent(new Event('input', { bubbles: true }))
}
const rows = (): HTMLElement[] => Array.from(panel().querySelectorAll<HTMLElement>('.hc-mail-row'))
const subjects = (): string[] => Array.from(panel().querySelectorAll('.hc-mail-row-subject')).map(s => s.textContent ?? '')
const cue = (): string => (panel().querySelector('.hc-mail-cue') as HTMLElement).hidden ? '' : panel().querySelector('.hc-mail-cue-text')?.textContent ?? ''
const said = (): string => panel().querySelector('.hc-mail-said:not([hidden])')?.textContent ?? ''
const key = (k: string, target: EventTarget = panel()): void => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) }

/** A promise the spec releases by hand. */
function gate<T = void>(): { promise: Promise<T>; open: (value: T) => void; fail: (error: unknown) => void } {
  let open: (value: T) => void = () => {}
  let fail: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => { open = resolve; fail = reject })
  return { promise, open, fail }
}

// A real message, so the raw-bytes path (parseMail, attachmentBytes) runs as it does live.
const RAW = [
  'From: Ana <ana@example.org>', `To: ${ME}`, 'Subject: plans', 'Message-ID: <m1@example.org>', 'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b"', '',
  '--b', 'Content-Type: text/plain; charset=utf-8', '', 'the plain text',
  '--b', 'Content-Type: application/pdf; name="plan.pdf"', 'Content-Disposition: attachment; filename="plan.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0x',
  '--b', 'Content-Type: image/png; name="dot.png"', 'Content-Disposition: attachment; filename="dot.png"', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=',
  '--b--', '',
].join('\r\n')
const rawBytes = (): Uint8Array => new TextEncoder().encode(RAW)

beforeAll(() => { if (!customElements.get('hc-mail')) customElements.define('hc-mail', MailElement) })
afterEach(() => { mounted?.remove(); mounted = null; document.body.replaceChildren(); vi.restoreAllMocks() })

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

  it('shows names beside addresses: its own mailbox, and who wrote', async () => {
    await windowWith(fakeService({
      mailboxes: vi.fn(async () => [{ address: ME, name: 'Jaime', host: 'https://hypercomb.com' }]),
      list: vi.fn(async () => ({ items: [{ sig: SIG, at: 2, meta: { from: '"Ana Ruiz" <ana@example.org>', subject: '=?utf-8?B?Q2Fmw6k=?=', at: 2 } }], cursor: null })),
    }))
    expect(panel().querySelector('.hc-mail-who')?.textContent).toBe(`Jaime <${ME}>`)
    expect(panel().querySelector('.hc-mail-row-who')?.textContent).toBe('Ana Ruiz <ana@example.org>')
    expect(subjects()).toEqual(['Café']) // the sealed subject as the sender encoded it, read for a person
  })
})

describe('the cue: the window says what it is doing', () => {
  it('draws placeholders in the same frame as the open, before the host has answered anything', async () => {
    const boxes = gate<{ address: string; host: string }[]>()
    const element = document.createElement('hc-mail') as MailElement
    element.service = fakeService({ mailboxes: vi.fn(() => boxes.promise) }) as unknown as MailService
    document.body.appendChild(element)
    mounted = element
    element.open() // no await: what is on screen now is what the participant sees at once
    expect(cue()).toBe('Opening your mailbox…')
    expect(panel().querySelectorAll('.hc-mail-skeleton').length).toBeGreaterThan(0)
    expect(panel().querySelector('.hc-mail-bar')?.classList.contains('is-indeterminate')).toBe(true)
    boxes.open([{ address: ME, host: 'https://hypercomb.com' }])
    await settle()
    expect(rows()).toHaveLength(2)
    expect(panel().querySelector('.hc-mail-skeleton')).toBeNull()
    expect(cue()).toBe('')
  })

  it('shows a placeholder per row once the page size is known, and fills each in its final place on the frame after it opens', async () => {
    const page = gate<void>()
    let report: (item: Row, progress: { opened: number; total: number }) => void = () => {}
    const a = { sig: SIG, at: 3, meta: { from: 'a@x.org', subject: 'newest', at: 3 } }
    const b = { sig: SIG2, at: 2, meta: { from: 'b@x.org', subject: 'middle', at: 2 } }
    const c = { sig: SIG3, at: 1, meta: { from: 'c@x.org', subject: 'oldest', at: 1 } }
    const list = vi.fn(async (_a: string, _f: string, _c: unknown, onItem: typeof report) => {
      report = onItem
      await page.promise
      return { items: [a, b, c], cursor: null }
    })
    await windowWith(fakeService({ list }))
    // The host answered nothing yet: placeholders, no rows.
    expect(rows()).toHaveLength(0)
    expect(panel().querySelectorAll('.hc-mail-skeleton')).toHaveLength(3)

    report(c, { opened: 1, total: 3 }) // the rows open in no particular order
    await frame()
    expect(subjects()).toEqual(['oldest'])
    expect(panel().querySelectorAll('.hc-mail-skeleton')).toHaveLength(2)
    expect(cue()).toBe('Opening your mailbox… 1 of 3')
    expect((panel().querySelector('.hc-mail-bar-fill') as HTMLElement).style.width).toBe('33%')
    const oldest = rows()[0]!

    // Two rows opening within one frame are drawn together, each in its place.
    report(a, { opened: 2, total: 3 })
    report(b, { opened: 3, total: 3 })
    expect(subjects()).toEqual(['oldest']) // nothing redrawn per row
    await frame()
    expect(subjects()).toEqual(['newest', 'middle', 'oldest'])
    expect(panel().querySelector('.hc-mail-skeleton')).toBeNull()
    expect(cue()).toBe('Opening your mailbox… 3 of 3')

    page.open()
    await settle()
    // The finished page lands on what is already there: same order, same elements, nothing moved.
    expect(subjects()).toEqual(['newest', 'middle', 'oldest'])
    expect(rows()[2]).toBe(oldest)
    expect(cue()).toBe('')
  })

  it('a refresh keeps the rows on screen and its button says so while it runs', async () => {
    const second = gate<void>()
    const service = fakeService()
    const first = service.list.getMockImplementation()!
    let calls = 0
    service.list.mockImplementation(async (...args: Parameters<typeof first>) => { if (++calls === 2) await second.promise; return first(...args) })
    await windowWith(service)
    press('Refresh')
    expect(button('Refreshing…').disabled).toBe(true)
    expect(cue()).toBe('Refreshing…')
    expect(rows()).toHaveLength(2) // never blanked
    expect(panel().querySelector('.hc-mail-skeleton')).toBeNull()
    second.open()
    await settle()
    expect(button('Refresh').disabled).toBe(false)
    expect(cue()).toBe('')
  })

  it('a message shows what its row knew at once, and the body when it has opened', async () => {
    const body = gate<Uint8Array>()
    await windowWith(fakeService({ readRaw: vi.fn(() => body.promise) }))
    rows()[0]!.click()
    expect(panel().querySelector('.hc-mail-subject')?.textContent).toBe('plans')
    expect(panel().querySelector('.hc-mail-meta')?.textContent).toContain('ana@example.org')
    expect(panel().querySelector('.hc-mail-skeleton-text')).not.toBeNull()
    expect(cue()).toBe('Opening the message…')
    body.open(mime())
    await settle()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('the plain text')
    expect(cue()).toBe('')
  })

  it('Send says it is sending, on the button and on the line', async () => {
    const out = gate<{ messageId: string; sig: string }>()
    await windowWith(fakeService({ send: vi.fn(() => out.promise) }))
    press('Write')
    fill('to', 'friend@example.org'); fill('subject', 'hi'); fill('text', 'body')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    expect(button('Sending…').disabled).toBe(true)
    expect(cue()).toBe('Sending…')
    out.open({ messageId: '<o@h>', sig: SIG })
    await settle()
    expect(said()).toBe('Sent to friend@example.org.')
  })

  it('Save draft says it is saving, then that the draft was kept', async () => {
    const kept = gate<{ sig: string; replaced: boolean }>()
    const service = fakeService({ saveDraft: vi.fn(() => kept.promise) })
    await windowWith(service)
    press('Write')
    fill('to', 'friend@example.org'); fill('text', 'later')
    press('Save draft')
    expect(button('Saving draft…').disabled).toBe(true)
    expect(cue()).toBe('Saving draft…')
    kept.open({ sig: SIG3, replaced: false })
    await settle()
    expect(button('Save draft').disabled).toBe(false)
    expect(panel().querySelector('.hc-mail-status')?.textContent).toBe('Draft saved')
    press('Save draft'); await settle()
    expect(service.saveDraft).toHaveBeenCalledTimes(1) // the same words are not kept twice
  })

  it('a poll says "Checking for mail…" quietly, under anything the participant pressed', async () => {
    const service = fakeService()
    const first = service.list.getMockImplementation()!
    const polled = gate<void>()
    let calls = 0
    service.list.mockImplementation(async (...args: Parameters<typeof first>) => { if (++calls === 2) await polled.promise; return first(...args) })
    await windowWith(service, element => { element.pollEveryMs = 15 })
    await wait(40)
    expect(calls).toBe(2)
    expect(cue()).toBe('Checking for mail…')
    expect(panel().querySelector('.hc-mail-cue')?.classList.contains('is-quiet')).toBe(true)
    expect(rows()).toHaveLength(2)
    expect(panel().querySelector('.hc-mail-skeleton')).toBeNull()
    polled.open()
    await settle()
    expect(cue()).toBe('')
  })
})

describe('tabs, search and conversations', () => {
  const marked = (over: Record<string, unknown> = {}) => fakeService({
    list: vi.fn(async (_a: string, folder: string) => ({
      items: folder === 'box'
        ? [
          { sig: SIG, at: 3, meta: { from: 'ana@example.org', subject: 'plans', preview: 'see you thursday', at: 3 }, marks: null },
          { sig: SIG2, at: 2, meta: { from: 'bo@example.org', subject: 'old news', at: 2 }, marks: { hidden: true, read: true } },
          { sig: SIG3, at: 1, meta: { from: 'cy@example.org', subject: 'lunch', at: 1 }, marks: { read: true } },
        ]
        : folder === 'sent' ? [{ sig: 'd'.repeat(64), at: 4, meta: { to: 'friend@example.org', subject: 'sent one', at: 4 }, marks: { hidden: true } }] : [],
      cursor: null,
    })),
    ...over,
  })

  it('leaves hidden mail out of the inbox, and shows it shaded under Hidden, from Inbox and Sent', async () => {
    const service = marked()
    await windowWith(service)
    expect(subjects()).toEqual(['plans', 'lunch'])
    expect(button('Inbox').dataset['count']).toBe('1') // the one never marked read
    press('Hidden'); await settle()
    expect(service.list).toHaveBeenCalledWith(ME, 'sent', null, expect.any(Function))
    expect(subjects()).toEqual(['sent one', 'old news'])
    expect(rows().every(row => row.classList.contains('is-hidden'))).toBe(true)
    expect(panel().querySelectorAll('.hc-mail-row-folder')[0]?.textContent).toBe('Sent')
  })

  it('searches what has opened — who, subject and preview — and Escape clears the search before it closes', async () => {
    const element = await windowWith(marked())
    const search = panel().querySelector('.hc-mail-search') as HTMLInputElement
    search.value = 'thursday'; search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(subjects()).toEqual(['plans'])
    search.value = 'cy@'; search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(subjects()).toEqual(['lunch'])
    search.value = 'nothing like it'; search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(rows()).toHaveLength(0)
    expect(panel().textContent).toContain('Nothing here matches')
    key('Escape', search)
    expect(subjects()).toEqual(['plans', 'lunch'])
    expect(element.isOpen).toBe(true)
    key('Escape')
    expect(element.isOpen).toBe(false)
  })

  it('groups a conversation into one row, newest first, with a count, and opens it on a press', async () => {
    await windowWith(fakeService({
      list: vi.fn(async () => ({
        items: [
          { sig: SIG, at: 5, meta: { from: 'ana@example.org', subject: 'Re: plans', at: 5, messageId: '<r1@x>', inReplyTo: '<m1@x>', references: ['<m1@x>'] } },
          { sig: SIG3, at: 3, meta: { from: 'cy@example.org', subject: 'lunch', at: 3, messageId: '<l1@x>' } },
          { sig: SIG2, at: 1, meta: { from: 'jo@example.org', subject: 'plans', at: 1, messageId: '<m1@x>' } },
        ],
        cursor: null,
      })),
    }))
    expect(subjects()).toEqual(['Re: plans', 'lunch'])
    expect(panel().querySelector('.hc-mail-row-count')?.textContent).toBe('2')
    rows()[0]!.click()
    expect(rows()[0]!.getAttribute('aria-expanded')).toBe('true')
    expect(subjects()).toEqual(['Re: plans', 'Re: plans', 'plans', 'lunch'])
    expect(panel().querySelectorAll('.hc-mail-row.is-member')).toHaveLength(2)
    rows()[0]!.click()
    expect(subjects()).toEqual(['Re: plans', 'lunch'])
  })

  it('opens a draft from Drafts into the composer, and Discard forgets it', async () => {
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({
        items: folder === 'drafts' ? [{ sig: SIG3, at: 4, meta: { to: 'friend@example.org', subject: 'half done', at: 4 }, marks: null }] : [],
        cursor: null,
      })),
    })
    await windowWith(service)
    press('Drafts'); await settle()
    expect(subjects()).toEqual(['half done'])
    rows()[0]!.click()
    expect(cue()).toBe('Opening the draft…')
    await settle()
    expect(service.readDraft).toHaveBeenCalledWith(ME, SIG3)
    expect((panel().querySelector('[name="subject"]') as HTMLInputElement).value).toBe('half done')
    expect((panel().querySelector('[name="text"]') as HTMLTextAreaElement).value).toBe('so far')
    press('Discard'); await settle()
    expect(service.removeDraft).toHaveBeenCalledWith(ME, SIG3)
    expect(said()).toBe('Draft discarded.')
    expect(service.saveDraft).not.toHaveBeenCalled() // nothing changed, so nothing was kept again
  })
})

describe('marks: read, flag, hide first, delete second', () => {
  it('marks a message read when it is opened, and the row stops saying unread', async () => {
    const service = fakeService()
    await windowWith(service)
    expect(rows()[0]!.classList.contains('is-unread')).toBe(true)
    rows()[0]!.click(); await settle()
    expect(service.setMarks).toHaveBeenCalledWith(ME, 'box', SIG, { read: true })
    press('Back')
    expect(rows()[0]!.classList.contains('is-unread')).toBe(false)
  })

  it('flags and unflags from the message', async () => {
    const service = fakeService()
    await windowWith(service)
    rows()[0]!.click(); await settle()
    press('Flag'); await settle()
    expect(service.setMarks).toHaveBeenLastCalledWith(ME, 'box', SIG, { flagged: true })
    press('Unflag'); await settle()
    expect(service.setMarks).toHaveBeenLastCalledWith(ME, 'box', SIG, { flagged: false })
  })

  it('hides from the list: the button says so while it runs, and the row moves under Hidden', async () => {
    const hidden = gate<Record<string, unknown>>()
    const service = fakeService({ setMarks: vi.fn(() => hidden.promise) })
    await windowWith(service)
    const hide = rows()[0]!.querySelector('.hc-mail-row-acts button') as HTMLButtonElement
    expect(hide.textContent).toBe('Hide')
    hide.click()
    const busy = rows()[0]!.querySelector('.hc-mail-row-acts button') as HTMLButtonElement
    expect(busy.textContent).toBe('Hiding…')
    expect(busy.disabled).toBe(true)
    expect(cue()).toBe('Hiding…')
    expect(service.setMarks).toHaveBeenCalledWith(ME, 'box', SIG, { hidden: true })
    hidden.open({ hidden: true })
    await settle()
    expect(subjects()).toEqual(['<img src=x onerror="window.pwned=1">'])
    expect(said()).toContain('Hidden')
  })

  it('takes two acts to delete: Delete waits for "may be deleted", inside Hidden only', async () => {
    let marks: Record<string, boolean> = { hidden: true }
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({ items: folder === 'box' ? [{ sig: SIG, at: 1, meta: { from: 'ana@example.org', subject: 'gone soon', at: 1 }, marks }] : [], cursor: null })),
      setMarks: vi.fn(async (_a: string, _f: string, _s: string, next: Record<string, boolean>) => (marks = { ...marks, ...next })),
    })
    await windowWith(service)
    expect(rows()).toHaveLength(0)
    press('Hidden'); await settle()
    const remove = (): HTMLButtonElement => button('Delete')
    expect(remove().disabled).toBe(true)
    const toggle = panel().querySelector('.hc-mail-row input[type="checkbox"]') as HTMLInputElement
    toggle.click(); await settle()
    expect(service.setMarks).toHaveBeenCalledWith(ME, 'box', SIG, { deletable: true })
    expect(remove().disabled).toBe(false)
    expect(service.remove).not.toHaveBeenCalled()
    remove().click(); await settle()
    expect(service.remove).toHaveBeenCalledWith(ME, 'box', SIG)
    expect(rows()).toHaveLength(0)
    expect(said()).toBe('Deleted. The host keeps it 30 days, then it is gone.')
    expect(panel().textContent).not.toMatch(/permanent/i)
  })

  it('says the host’s refusal of a delete in words', async () => {
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({ items: folder === 'box' ? [{ sig: SIG, at: 1, meta: { subject: 'x', at: 1 }, marks: { hidden: true, deletable: true } }] : [], cursor: null })),
      remove: vi.fn(async () => { throw new MailError('conflict', 'hide it and mark it deletable first') }),
    })
    await windowWith(service)
    press('Hidden'); await settle()
    press('Delete'); await settle()
    expect(said()).toContain('hidden and marked “may be deleted”')
    expect(rows()).toHaveLength(1)
  })

  it('un-hides a message back into its folder', async () => {
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({ items: folder === 'box' ? [{ sig: SIG, at: 1, meta: { subject: 'back again', at: 1 }, marks: { hidden: true } }] : [], cursor: null })),
    })
    await windowWith(service)
    press('Hidden'); await settle()
    press('Un-hide'); await settle()
    expect(service.setMarks).toHaveBeenCalledWith(ME, 'box', SIG, { hidden: false, deletable: false })
    expect(said()).toBe('Back in Inbox.')
    press('Inbox'); await settle()
    expect(subjects()).toEqual(['back again'])
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
    await windowWith(fakeService({ readRaw: vi.fn(async () => mime({ text: '<script>window.pwned=1</script>hello' })) }))
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('<script>window.pwned=1</script>hello')
    expect(panel().querySelector('script')).toBeNull()
  })

  it('shows html mail in a script-less sandboxed frame that may load nothing outside, and says what it held back', async () => {
    const html = '<p onclick="x()">hi</p><script>alert(1)</script><img src="https://tracker.example/p.gif">'
    await windowWith(fakeService({ readRaw: vi.fn(async () => mime({ html })) }))
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
    await windowWith(fakeService({ readRaw: vi.fn(async () => mime({ html: '<p>hi</p>', text: 'hi' })) }))
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('iframe')).not.toBeNull()
    press('Show plain text')
    expect(panel().querySelector('iframe')).toBeNull()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('hi')
  })

  // Was "lists attachments by name without opening them". The name is read from its own span now,
  // because a Download button stands beside it; still nothing is opened, and no link exists, until it
  // is pressed ("attachments" below presses it).
  it('lists attachments by name without opening them', async () => {
    const create = vi.fn(() => 'blob:never')
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    await windowWith(fakeService({ readRaw: vi.fn(async () => mime({ files: [{ filename: 'plan.pdf', type: 'application/pdf', base64: btoa('\0'.repeat(2048)) }] })) }))
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('.hc-mail-attachments .hc-mail-attachment-name')?.textContent).toBe('plan.pdf · application/pdf · 2 KB')
    expect(panel().querySelector('a')).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('attachments', () => {
  it('downloads one as opaque bytes on a press, lets the URL go, and shows pictures only inside the sandboxed frame', async () => {
    const made: Blob[] = []
    const create = vi.fn((blob: Blob) => { made.push(blob); return 'blob:mail/1' })
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
    await windowWith(fakeService({ readRaw: vi.fn(async () => rawBytes()) }))
    rows()[0]!.click(); await settle()
    expect(Array.from(panel().querySelectorAll('.hc-mail-attachment-name')).map(n => n.textContent)).toEqual(['plan.pdf · application/pdf · 1 KB', 'dot.png · image/png · 1 KB'])
    expect(create).not.toHaveBeenCalled() // nothing opens until it is pressed

    ;(panel().querySelector('.hc-mail-attachments li button') as HTMLButtonElement).click()
    expect(create).toHaveBeenCalledTimes(1)
    expect(made[0]!.type).toBe('application/octet-stream')
    expect(clicked[0]!.download).toBe('plan.pdf')
    expect(clicked[0]!.isConnected).toBe(false)
    await settle()
    expect(revoke).toHaveBeenCalledWith('blob:mail/1')

    const pictures = panel().querySelector('iframe.is-previews') as HTMLIFrameElement
    expect(pictures.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox')
    expect(pictures.srcdoc).toContain("default-src 'none'")
    expect(pictures.srcdoc).toContain('src="data:image/png;base64,')
    expect(pictures.srcdoc).not.toMatch(/https?:|dot\.png/)
  })

  it('downloads what a sent copy carried', async () => {
    const create = vi.fn((_blob: Blob) => 'blob:mail/2')
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await windowWith(fakeService({
      readSent: vi.fn(async () => ({ id: null, from: ME, to: ['friend@example.org'], cc: [], bcc: [], subject: 'sent one', text: 'see attached', html: '', inReplyTo: null, references: null, attachments: [{ filename: 'notes.txt', type: 'text/plain', content: 'aGk=' }], at: 3 })),
    }))
    press('Sent'); await settle()
    rows()[0]!.click(); await settle()
    expect(panel().querySelector('.hc-mail-attachment-name')?.textContent).toBe('notes.txt · text/plain · 1 KB')
    press('Download')
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].size).toBe(2) // "hi", out of the copy's base64
  })

  it('carries picked files into the send, and refuses past the caps in words before anything goes', async () => {
    const service = fakeService()
    await windowWith(service)
    press('Write')
    const picker = (): HTMLInputElement => panel().querySelector('input[type="file"]') as HTMLInputElement
    expect(panel().textContent).toContain(`Up to ${MAIL_LIMITS.attachments} files, ${sizeLabel(MAIL_LIMITS.attachmentBytes)} in all.`)
    const pick = (files: File[]): void => {
      Object.defineProperty(picker(), 'files', { value: files, configurable: true })
      picker().dispatchEvent(new Event('change', { bubbles: true }))
    }
    pick([new File(['abc'], 'a.txt', { type: 'text/plain' })])
    await wait(20); await settle()
    expect(panel().querySelector('.hc-mail-files .hc-mail-attachment-name')?.textContent).toBe('a.txt · 1 KB')
    pick(Array.from({ length: 10 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' })))
    await wait(20); await settle()
    expect(panel().textContent).toContain('f9.txt was not added: a message carries at most 10 files.')
    expect(panel().querySelectorAll('.hc-mail-files .hc-mail-attachment-name')).toHaveLength(10)

    fill('to', 'friend@example.org'); fill('subject', 'files'); fill('text', 'here')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    const sent = service.send.mock.calls[0]![0] as { attachments: { filename: string; type: string; content: Uint8Array }[] }
    expect(sent.attachments).toHaveLength(10)
    expect(sent.attachments[0]!.filename).toBe('a.txt')
    expect(sent.attachments[0]!.type).toBe('text/plain')
    expect(Array.from(sent.attachments[0]!.content)).toEqual([97, 98, 99])
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
    const gated = new Promise<void>(resolve => { release = resolve })
    const send = vi.fn(async () => { await gated; throw new MailError('limit') })
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
    const refusal = panel().querySelector('.hc-mail-said.is-bad:not([hidden])')?.textContent ?? ''
    expect(refusal).toContain('bounced before')
    expect(refusal).toContain('hypercomb.ui@gmail.com, friend@example.org')
    expect(refusal).not.toContain('E_RECIPIENT_SUPPRESSED')
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

  it('formats on request, previews in the same script-less frame as it is typed, and sends the html with the text', async () => {
    const service = fakeService()
    await windowWith(service)
    press('Write')
    const preview = (): HTMLElement => panel().querySelector('.hc-mail-preview') as HTMLElement
    expect(preview().hidden).toBe(true)
    ;(panel().querySelector('[name="formatted"]') as HTMLInputElement).click()
    expect(preview().hidden).toBe(false)
    type('text', '**hi** <script>x()</script>')
    await wait(260)
    const frame = preview().querySelector('iframe') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox')
    expect(frame.srcdoc).toContain('<strong>hi</strong>')
    expect(frame.srcdoc).not.toContain('<script>')
    fill('to', 'friend@example.org'); fill('subject', 'hi')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    const sent = service.send.mock.calls[0]![0] as { html?: string; text: string }
    expect(sent.html).toContain('<strong>hi</strong>')
    expect(sent.text).toContain('hi')
    expect(sent.text).not.toContain('**')
  })

  it('keeps a draft once the typing stops, replacing the one before, and says it was kept', async () => {
    let n = 0
    const service = fakeService({ saveDraft: vi.fn(async () => ({ sig: String(++n).repeat(64), replaced: n > 1 })) })
    await windowWith(service, element => { element.draftSaveMs = 20 })
    press('Write')
    fill('to', 'friend@example.org'); fill('subject', 'later')
    type('text', 'first words')
    expect(service.saveDraft).not.toHaveBeenCalled()
    await wait(60)
    expect(service.saveDraft).toHaveBeenCalledTimes(1)
    expect(service.saveDraft).toHaveBeenLastCalledWith(ME, expect.objectContaining({ to: 'friend@example.org', subject: 'later', text: 'first words' }), null)
    expect(panel().querySelector('.hc-mail-status')?.textContent).toBe('Draft saved')
    type('text', 'more words')
    await wait(60)
    expect(service.saveDraft).toHaveBeenLastCalledWith(ME, expect.objectContaining({ text: 'more words' }), '1'.repeat(64))
  })

  it('keeps the words on the way out: Escape saves the draft at once and steps back', async () => {
    const service = fakeService()
    await windowWith(service)
    press('Write')
    fill('to', 'friend@example.org')
    type('text', 'unfinished')
    key('Escape')
    expect(panel().querySelector('form')).toBeNull()
    await settle()
    expect(service.saveDraft).toHaveBeenCalledTimes(1)
    expect(service.saveDraft).toHaveBeenCalledWith(ME, expect.objectContaining({ text: 'unfinished' }), null)
  })

  it('forwards a message with its attachments, read from the raw bytes by index', async () => {
    const service = fakeService({ readRaw: vi.fn(async () => rawBytes()) })
    await windowWith(service)
    rows()[0]!.click(); await settle()
    press('Forward')
    expect((panel().querySelector('[name="subject"]') as HTMLInputElement).value).toBe('Fwd: plans')
    expect(Array.from(panel().querySelectorAll('.hc-mail-files .hc-mail-attachment-name')).map(n => n.textContent)).toEqual(['plan.pdf · 1 KB', 'dot.png · 1 KB'])
    fill('to', 'friend@example.org')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    const sent = service.send.mock.calls[0]![0] as { attachments: { filename: string; type: string; content: Uint8Array }[] }
    expect(sent.attachments.map(a => a.filename)).toEqual(['plan.pdf', 'dot.png'])
    expect(new TextDecoder().decode(sent.attachments[0]!.content)).toBe('%PDF-1')
  })

  it('suggests To and Cc from who wrote and who was written to, and offers every mailbox to send from by name', async () => {
    await windowWith(fakeService({
      mailboxes: vi.fn(async () => [{ address: ME, name: 'Jaime', host: 'h' }, { address: 'leanne@hypercomb.com', name: 'Leanne', host: 'h' }]),
    }))
    press('Write'); await settle()
    const known = Array.from(panel().querySelectorAll('datalist option')).map(o => (o as HTMLOptionElement).value)
    expect(known).toEqual(expect.arrayContaining(['ana@example.org', 'bo@example.org']))
    expect((panel().querySelector('[name="to"]') as HTMLInputElement).getAttribute('list')).toBe(panel().querySelector('datalist')!.id)
    const from = Array.from((panel().querySelector('[name="from"]') as HTMLSelectElement).options).map(o => o.textContent)
    expect(from).toEqual([`Jaime <${ME}>`, 'Leanne <leanne@hypercomb.com>'])
  })
})

describe('save to hive', () => {
  it('is a press that says what it is doing and then what happened, with the privacy sentence beside it', async () => {
    const done = gate<SaveMessageResult>()
    const save = vi.fn((_input: SaveMessageInput) => done.promise)
    await windowWith(fakeService({ readRaw: vi.fn(async () => rawBytes()) }), element => { element.saveToHive = save })
    rows()[0]!.click(); await settle()
    expect(panel().querySelector('.hc-mail-privacy')?.textContent).toContain('unsealed')
    press('Save to hive')
    expect(button('Saving to hive…').disabled).toBe(true)
    expect(cue()).toBe('Saving to hive…')
    const input = save.mock.calls[0]![0]
    expect(input.sig).toBe(SIG)
    expect(new TextDecoder().decode(input.raw)).toBe(RAW)
    expect(input.attachmentBytes(0)).not.toBeNull()
    done.open({ status: 'saved', placed: [], shared: [], skipped: [], message: 'Saved as the tile “plans”.' })
    await settle()
    expect(said()).toBe('Saved as the tile “plans”.')
    expect(button('Save to hive').disabled).toBe(false)
  })
})

describe('what this key may do (Mailbox.can)', () => {
  const asKey = (can: readonly MailAct[], over: Record<string, unknown> = {}) => fakeService({
    mailboxes: vi.fn(async () => [{ address: ME, host: 'https://hypercomb.com', can }]),
    list: vi.fn(async (_a: string, folder: string) => ({
      items: folder === 'box'
        ? [{ sig: SIG, at: 2, meta: { from: 'ana@example.org', subject: 'plans', at: 2 }, marks: null }, { sig: SIG2, at: 1, meta: { from: 'bo@example.org', subject: 'hid', at: 1 }, marks: { hidden: true, deletable: true } }]
        : [],
      cursor: null,
    })),
    ...over,
  })

  it('shows a read-only key a plain reader: nothing to write, mark, keep or delete, and opening marks nothing', async () => {
    const service = asKey(['read'])
    await windowWith(service)
    expect(buttons().map(b => b.textContent)).not.toContain('Write')
    expect(buttons().map(b => b.textContent)).not.toContain('Drafts')
    expect(panel().querySelector('.hc-mail-row-acts')).toBeNull()
    rows()[0]!.click(); await settle()
    const labels = buttons().map(b => b.textContent)
    for (const gone of ['Reply', 'Reply all', 'Forward', 'Flag', 'Hide']) expect(labels).not.toContain(gone)
    expect(labels).toContain('Back') // the reader still reads
    expect(service.setMarks).not.toHaveBeenCalled()
    press('Back')
    press('Hidden'); await settle()
    expect(subjects()).toEqual(['hid'])
    expect(panel().querySelector('.hc-mail-row-acts')).toBeNull()
    expect(panel().textContent).not.toContain('may be deleted')
  })

  it('a key that may not keep drafts never saves one, by press or by pause', async () => {
    const service = asKey(['read', 'send', 'mark'])
    await windowWith(service, element => { element.draftSaveMs = 10 })
    press('Write')
    expect(buttons().map(b => b.textContent)).not.toContain('Save draft')
    fill('to', 'friend@example.org')
    type('text', 'not kept')
    await wait(40)
    key('Escape')
    await settle()
    expect(service.saveDraft).not.toHaveBeenCalled()
  })

  it('a key that may mark but not delete hides and un-hides, and is never offered Delete', async () => {
    await windowWith(asKey(['read', 'mark']))
    expect(rows()[0]!.querySelector('.hc-mail-row-acts button')?.textContent).toBe('Hide')
    press('Hidden'); await settle()
    const labels = buttons().map(b => b.textContent)
    expect(labels).toContain('Un-hide')
    expect(labels).not.toContain('Delete')
    expect(panel().querySelector('.hc-mail-row input[type="checkbox"]')).toBeNull()
  })

  it('a key that may not send from one address is offered only the others in From', async () => {
    await windowWith(fakeService({
      mailboxes: vi.fn(async () => [
        { address: ME, name: 'Jaime', host: 'h', can: ['read', 'send', 'draft'] },
        { address: 'shared@hypercomb.com', name: 'Shared', host: 'h', can: ['read'] },
        { address: 'team@hypercomb.com', name: 'Team', host: 'h', can: ['read', 'send'] },
      ]),
    }))
    press('Write')
    const from = Array.from((panel().querySelector('[name="from"]') as HTMLSelectElement).options).map(o => o.value)
    expect(from).toEqual([ME, 'team@hypercomb.com'])
  })

  it('says a refusal by the act it refused, when roles changed after the window asked', async () => {
    const service = fakeService({ setMarks: vi.fn(async () => { throw new MailError('forbidden', 'mark') }) })
    await windowWith(service)
    ;(rows()[0]!.querySelector('.hc-mail-row-acts button') as HTMLButtonElement).click()
    await settle()
    expect(said()).toBe(`This key may not mark mail at ${ME} (read, flag or hide). Whoever runs the mail host can give it more.`)
    expect(subjects()).toHaveLength(2) // nothing moved
  })

  it('words every refused act, and a delete limit as a delete limit', () => {
    const said = (act: MailAct): string => explain(new MailError('forbidden', act), act === 'send', [], { address: ME })
    expect(said('send')).toBe(`This key may not send from ${ME}. Whoever runs the mail host can give it more.`)
    expect(new Set((['read', 'mark', 'draft', 'delete', 'send'] as const).map(said)).size).toBe(5)
    expect(explain(new MailError('forbidden', 'fly'), false, [], { address: ME })).toContain('may not do that')
    expect(explain(new MailError('limit', 'daily delete limit reached'), false, [], { act: 'delete' })).toContain('daily delete limit')
    expect(explain(new MailError('limit'), true)).toContain('sending limit')
  })
})

describe('a request the host has already spent (replays)', () => {
  it('a send it already took is said as sent: the composer closes, Sent is read again, and nothing offers to send it twice', async () => {
    const service = fakeService({ send: vi.fn(async () => { throw new MailError('conflict', ALREADY_SENT) }) })
    await windowWith(service)
    press('Sent'); await settle()
    const readsOfSent = (): number => service.list.mock.calls.filter(call => call[1] === 'sent').length
    const before = readsOfSent()
    press('Write')
    fill('to', 'friend@example.org'); fill('subject', 'hi'); fill('text', 'body')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    expect(service.send).toHaveBeenCalledTimes(1)
    expect(said()).toBe('This message was already sent; it is in Sent.')
    expect(panel().querySelector('form')).toBeNull()
    expect(readsOfSent()).toBe(before + 1)
    expect(buttons().map(b => b.textContent)).not.toContain('Try again')
    expect(panel().querySelector('.hc-mail-said.is-bad:not([hidden])')).toBeNull()
  })

  it('a mark it already made is not an error: the folder is read again quietly and shows what the host holds', async () => {
    let hidden = false
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({ items: folder === 'box' ? [{ sig: SIG, at: 2, meta: { subject: 'plans', at: 2 }, marks: hidden ? { hidden: true } : null }] : [], cursor: null })),
      setMarks: vi.fn(async () => { hidden = true; throw new MailError('conflict', ALREADY_DONE) }),
    })
    await windowWith(service)
    ;(rows()[0]!.querySelector('.hc-mail-row-acts button') as HTMLButtonElement).click()
    await settle()
    expect(said()).toBe('')
    expect(rows()).toHaveLength(0) // the host had hidden it; the inbox now says so
  })

  it('a delete it already made drops the row without a word', async () => {
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({ items: folder === 'box' ? [{ sig: SIG, at: 1, meta: { subject: 'x', at: 1 }, marks: { hidden: true, deletable: true } }] : [], cursor: null })),
      remove: vi.fn(async () => { throw new MailError('conflict', ALREADY_DONE) }),
    })
    await windowWith(service)
    press('Hidden'); await settle()
    service.list.mockImplementation(async () => ({ items: [], cursor: null }))
    press('Delete'); await settle()
    expect(rows()).toHaveLength(0)
    expect(said()).toBe('')
  })

  it('Delete says what it means — the host’s trash for 30 days — and a daily delete limit in its own words', async () => {
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({ items: folder === 'box' ? [{ sig: SIG, at: 1, meta: { subject: 'x', at: 1 }, marks: { hidden: true, deletable: true } }] : [], cursor: null })),
      remove: vi.fn(async () => { throw new MailError('limit', 'daily delete limit reached') }),
    })
    await windowWith(service)
    press('Hidden'); await settle()
    expect(panel().textContent).toContain('the host keeps it 30 days, then it is gone')
    expect(button('Delete').title).toBe('Removes it from your mailbox. The host keeps it 30 days, then it is gone.')
    expect(panel().textContent).not.toMatch(/permanent/i)
    press('Delete'); await settle()
    expect(said()).toContain('daily delete limit')
    expect(rows()).toHaveLength(1)
  })
})

describe('the unread cue', () => {
  it('asks nothing while the page is hidden, and an arrival lights the pill but never opens the window', async () => {
    const service = fakeService()
    let visible = false
    const counts: number[] = []
    const pills: { key: string; label: string }[] = []
    const offs = [
      EffectBus.on<{ count: number }>(MAIL_UNREAD, p => counts.push(p.count)),
      EffectBus.on<{ key: string; label: string }>('indicator:set', p => { if (p.key === UNREAD_INDICATOR) pills.push(p) }),
    ]
    try {
      const element = await windowWith(service, e => { e.pollEveryMs = 10; e.visible = () => visible })
      key('Escape') // closed: from here on only the poll asks
      const asked = service.list.mock.calls.length
      await wait(60)
      expect(service.list.mock.calls.length).toBe(asked)

      visible = true
      service.list.mockImplementation(async () => ({ items: [{ sig: SIG, at: 9, meta: null }, { sig: SIG2, at: 8, meta: null }, { sig: SIG3, at: 7, meta: null, marks: { read: true } }], cursor: null }))
      await wait(60)
      expect(service.list.mock.calls.length).toBeGreaterThan(asked)
      expect(counts.at(-1)).toBe(2)
      expect(pills.at(-1)?.label).toBe('2 unread')
      expect(element.isOpen).toBe(false)
      expect(document.querySelector('.hc-mail')).toBeNull()

      EffectBus.emit('indicator:activate', { key: UNREAD_INDICATOR }) // the participant's press on the pill
      expect(element.isOpen).toBe(true)
    } finally {
      for (const off of offs) off()
    }
  })

  it('stops asking after two failures in a row', async () => {
    const service = fakeService()
    const element = await windowWith(service, e => { e.pollEveryMs = 10 })
    element.close()
    service.list.mockImplementation(async () => { throw new MailError('unavailable') })
    const asked = service.list.mock.calls.length
    await wait(100)
    expect(service.list.mock.calls.length).toBe(asked + 2)
  })

  it('does not open for a pill press made before it was listening', async () => {
    EffectBus.emit('indicator:activate', { key: UNREAD_INDICATOR })
    const element = document.createElement('hc-mail') as MailElement
    element.service = fakeService() as unknown as MailService
    document.body.appendChild(element)
    mounted = element
    await settle()
    expect(element.isOpen).toBe(false)
  })
})

describe('keyboard', () => {
  it('j and k move between rows, Enter opens the one in focus', async () => {
    await windowWith(fakeService())
    key('j')
    expect(document.activeElement).toBe(rows()[0])
    key('j')
    expect(document.activeElement).toBe(rows()[1])
    key('k')
    expect(document.activeElement).toBe(rows()[0])
    key('Enter', rows()[0]!)
    await settle()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('the plain text')
  })

  it('leaves j and k to a field being typed in', async () => {
    await windowWith(fakeService())
    const search = panel().querySelector('.hc-mail-search') as HTMLInputElement
    search.focus()
    key('j', search)
    expect(document.activeElement).toBe(search)
    expect(search.hasAttribute('data-escape-local')).toBe(true)
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

describe('after R2: what a stranger or a host can make the window do', () => {
  /** A message of `pictures` tiny PNGs, filled out to `filler` bytes with one opaque file (probe V3). */
  const picturesMessage = (pictures: number, filler: number): Uint8Array => {
    const parts = ['--b', 'Content-Type: text/plain', '', 'hello']
    for (let i = 0; i < pictures; i++) parts.push('--b', `Content-Type: image/png; name="p${i}.png"`, `Content-Disposition: attachment; filename="p${i}.png"`, 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=')
    parts.push('--b', 'Content-Type: application/octet-stream; name="big.bin"', 'Content-Disposition: attachment; filename="big.bin"', 'Content-Transfer-Encoding: base64', '')
    const line = 'A'.repeat(76)
    for (let n = 0; n < filler / 78; n++) parts.push(line)
    parts.push('--b--', '')
    return new TextEncoder().encode(['From: a@b.org', `To: ${ME}`, 'Subject: pics', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '', ...parts].join('\r\n'))
  }
  const walked = (raw: Uint8Array): number => walks.of.filter(bytes => bytes === raw).length
  const imagesIn = (): number => ((panel().querySelector('.is-previews') as HTMLIFrameElement | null)?.srcdoc.match(/<img /g) ?? []).length

  it('opens a 6 MB message of 190 small pictures in one walk, and shows at most 12 of them in one more, on a press', async () => {
    const raw = picturesMessage(190, 6 * 1024 * 1024)
    await windowWith(fakeService({ readRaw: vi.fn(async () => raw) }))
    const started = performance.now()
    rows()[0]!.click(); await settle()
    expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('hello')
    expect(walked(raw)).toBe(1) // read once; a large message's pictures wait
    expect(imagesIn()).toBe(0)
    expect(panel().textContent).toContain('This message is large, so its pictures wait for a press.')
    press('Show pictures')
    expect(button('Opening the pictures…').disabled).toBe(true)
    await settle()
    expect(walked(raw)).toBe(2) // all twelve from a single walk
    expect(imagesIn()).toBe(12)
    expect(buttons().map(b => b.textContent)).not.toContain('Show pictures')
    expect(performance.now() - started).toBeLessThan(5_000) // was 45 s
  })

  it('shows a small message’s pictures at once, at most 12, from one walk more than the read', async () => {
    const raw = picturesMessage(30, 0)
    await windowWith(fakeService({ readRaw: vi.fn(async () => raw) }))
    rows()[0]!.click(); await settle()
    expect(walked(raw)).toBe(2)
    expect(imagesIn()).toBe(12)
    expect(panel().querySelectorAll('.hc-mail-attachments li')).toHaveLength(31) // every file still listed
  })

  it('reads every file for Save to hive in one walk of the message, and every file a forward carries in one more', async () => {
    const raw = picturesMessage(4, 0) // five files: four pictures and one opaque
    const save = vi.fn(async (_input: SaveMessageInput): Promise<SaveMessageResult> => ({ status: 'saved', placed: [], shared: [], skipped: [], message: 'Saved.' }))
    const service = fakeService({ readRaw: vi.fn(async () => raw) })
    await windowWith(service, element => { element.saveToHive = save })
    rows()[0]!.click(); await settle()
    const opened = walked(raw)
    press('Save to hive'); await settle()
    const input = save.mock.calls[0]![0]
    for (let i = 0; i < 5; i++) expect(input.attachmentBytes(i)).not.toBeNull()
    expect(walked(raw)).toBe(opened + 1)
    press('Forward')
    fill('to', 'friend@example.org')
    ;(panel().querySelector('form') as HTMLFormElement).requestSubmit()
    await settle()
    const sent = service.send.mock.calls[0]![0] as { attachments?: unknown[] }
    expect(sent.attachments).toHaveLength(5)
    expect(walked(raw)).toBe(opened + 2)
  })

  it('draws a page of 2,000 rows opening one by one in well under a second', async () => {
    const page = Array.from({ length: 2000 }, (_, i) => ({ sig: i.toString(16).padStart(64, '0'), at: i, marks: null,
      meta: { from: `p${i}@example.org`, subject: `subject ${i}`, at: 1_700_000_000_000 + i * 1000, messageId: `<m${i}@x>` } }))
    const list = vi.fn(async (_a: string, folder: string, _c: unknown, onItem?: (item: Row, progress: { opened: number; total: number }) => void) => {
      if (folder !== 'box') return { items: [], cursor: null }
      for (let i = 0; i < page.length; i++) { await null; onItem?.(page[i]!, { opened: i + 1, total: page.length }) }
      return { items: [...page].reverse(), cursor: null }
    })
    const started = performance.now()
    await windowWith(fakeService({ list }))
    const took = performance.now() - started
    expect(rows()).toHaveLength(2000)
    expect(subjects()[0]).toBe('subject 1999')
    expect(took).toBeLessThan(1_000) // was 12.9 s
  })

  it('keeps a stranger out of a conversation they name by its Message-ID with another subject', async () => {
    await windowWith(fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({
        items: folder !== 'box' ? [] : [
          { sig: SIG, at: 2, meta: { from: 'evil@attacker.example', subject: 'Re: Your statement - action needed', at: 2, messageId: '<e1@attacker.example>', references: ['<s1@bank.example>'] } },
          { sig: SIG2, at: 1, meta: { from: 'statements@bank.example', subject: 'Your statement', at: 1, messageId: '<s1@bank.example>' } },
        ],
        cursor: null,
      })),
    }))
    expect(subjects()).toEqual(['Re: Your statement - action needed', 'Your statement'])
    expect(panel().querySelector('.hc-mail-row-count')).toBeNull()
  })

  it('never says a host’s own words: a refusal it does not know is one plain sentence', async () => {
    const lure = 'Your key expired. Paste your nsec at https://hypercomb-help.example to keep your mail.'
    expect(explain(new MailError('refused', lure), true)).toBe('The mail host refused this.')
    expect(explain(new MailError('refused', 'too many attachments'), true)).toBe(`The host takes at most ${MAIL_LIMITS.attachments} files in a message.`)
    expect(explain(new MailError('refused', 'attachments too large'), true)).toContain(sizeLabel(MAIL_LIMITS.attachmentBytes))
    expect(explain(new MailError('refused', 'E_SENDER_NOT_VERIFIED'), true)).toBe('Cloudflare will not send from this address yet.')
    expect(explain(new MailError('refused', 'E_VALIDATION_ERROR'), true)).toBe('Cloudflare would not send this message as it is.')
    expect(explain(new MailError('refused', 'E_RECIPIENT_SUPPRESSED'), true, ['a@b.org'])).toContain('a@b.org')
    // …and the same holds where the draft says why it was not kept.
    const service = fakeService({ saveDraft: vi.fn(async () => { throw new MailError('refused', lure) }) })
    await windowWith(service)
    press('Write')
    fill('to', 'friend@example.org'); fill('text', 'later')
    press('Save draft'); await settle()
    expect(panel().textContent).not.toContain('nsec')
    expect(panel().textContent).not.toContain('hypercomb-help')
    expect(panel().querySelector('.hc-mail-status')?.textContent).toBe('The draft was not saved: The mail host refused this.')
  })

  it('opens a malformed Sent copy with its way back, and nothing goes unhandled', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', onRejection)
    try {
      // Probe V2: `to` a string, `cc` null.
      const service = fakeService({ readSent: vi.fn(async () => ({ from: ME, to: 'x@y.org', cc: null, subject: 'mine', text: 'body', html: '', at: 1 })) })
      await windowWith(service)
      press('Sent'); await settle()
      rows()[0]!.click(); await settle()
      expect(button('Back')).toBeTruthy()
      expect(panel().querySelector('.hc-mail-meta')?.textContent).toContain('x@y.org')
      expect(panel().querySelector('.hc-mail-text')?.textContent).toBe('body')
      press('Back')
      // A copy no drawing survives: still Back, and a line that says so.
      service.readSent.mockImplementation(async () => ({ from: ME, to: [], cc: [], subject: Object.create(null) as string, text: '', html: '', at: 1, attachments: 'nope' }))
      rows()[0]!.click(); await settle()
      expect(button('Back')).toBeTruthy()
      expect(said() || panel().querySelector('.hc-mail-said.is-bad')?.textContent).toBe('This message could not be shown.')
      press('Back')
      expect(rows()).toHaveLength(1)
      await settle()
    } finally { process.off('unhandledRejection', onRejection) }
    expect(rejections).toEqual([])
  })

  it('shows a sender’s name only when it is a name: one that reads as an address is dropped', async () => {
    const service = fakeService({
      list: vi.fn(async (_a: string, folder: string) => ({
        items: folder !== 'box' ? [] : [
          { sig: SIG, at: 2, meta: { from: '"boss@corp.example" <evil@attacker.example>', subject: 'urgent', at: 2 } },
          { sig: SIG2, at: 1, meta: { from: 'Ana <ana@example.org>', subject: 'plans', at: 1 } },
        ],
        cursor: null,
      })),
    })
    await windowWith(service)
    const who = Array.from(panel().querySelectorAll('.hc-mail-row-who')).map(node => node.textContent)
    expect(who).toEqual(['evil@attacker.example', 'Ana <ana@example.org>'])
    press('Write'); await settle()
    const labels = Array.from(document.querySelectorAll('datalist option')).map(option => (option as HTMLOptionElement).label)
    expect(labels).not.toContain('boss@corp.example')
  })
})

// THE DESK. Mail is a full-screen desk as notes, chat, the hosts and the tile editor are: the rows in a
// column on the left, what is open on the right, the hive behind it asleep while it is up.
describe('the mail desk', () => {
  type Stub = Record<string, unknown>
  const withIoc = async (stubs: Record<string, Stub>, run: () => Promise<void>): Promise<void> => {
    const shell = window as unknown as { ioc?: unknown }
    const before = shell.ioc
    shell.ioc = { get: (key: string) => stubs[key], whenReady: () => undefined }
    try { await run() } finally { shell.ioc = before }
  }

  it('keeps the rows on the left while a message opens on the right, and marks the open row', async () => {
    await windowWith(fakeService())
    expect(panel().querySelector('.hc-mail-cols > .hc-mail-side .hc-mail-row')).not.toBeNull()
    expect(panel().querySelector('.hc-mail-main .hc-mail-empty')).not.toBeNull()
    expect(panel().classList.contains('is-reading')).toBe(false)

    rows()[0]!.click()
    await settle()
    expect(panel().querySelector('.hc-mail-main .hc-mail-text')?.textContent).toBe('the plain text')
    expect(rows()).toHaveLength(2) // the list did not go anywhere
    expect(rows()[0]!.classList.contains('is-current')).toBe(true)
    expect(rows()[1]!.classList.contains('is-current')).toBe(false)
    expect(panel().classList.contains('is-reading')).toBe(true)

    key('Escape')
    expect(panel().classList.contains('is-reading')).toBe(false)
    expect(panel().querySelector('.hc-mail-row.is-current')).toBeNull()
    expect(panel().querySelector('.hc-mail-main .hc-mail-empty')).not.toBeNull()
  })

  it('claims the view modes, the input gate, the back gesture and the keymap while it is up, and lets go on close', async () => {
    const modes: string[] = []
    const gate: string[] = []
    let backs = 0
    const suppressed: string[] = []
    // The bus replays its last value to a new listener: only what is said from here on counts.
    let live = false
    const offs = [
      EffectBus.on<{ reason: string }>('keymap:suppress', p => { if (live) suppressed.push(`on:${p.reason}`) }),
      EffectBus.on<{ reason: string }>('keymap:unsuppress', p => { if (live) suppressed.push(`off:${p.reason}`) }),
    ]
    live = true
    try {
      await withIoc({
        '@diamondcoreprocessor.com/ModeRegistry': { enter: (m: string) => modes.push(`+${m}`), exit: (m: string) => modes.push(`-${m}`) },
        '@diamondcoreprocessor.com/InputGate': { lock: (r: string) => gate.push(`lock:${r}`), unlock: (r: string) => gate.push(`unlock:${r}`) },
        '@diamondcoreprocessor.com/BackGesture': { register: () => () => { backs++ } },
      }, async () => {
        const element = await windowWith(fakeService())
        expect(modes).toEqual(['+view:keeps-controls', '+view:active'])
        expect(gate).toEqual(['lock:mail-desk'])
        expect(suppressed).toEqual(['on:mail-desk'])
        element.close()
        expect(modes.slice(2)).toEqual(['-view:active', '-view:keeps-controls'])
        expect(gate).toEqual(['lock:mail-desk', 'unlock:mail-desk'])
        expect(backs).toBe(1)
        expect(suppressed).toEqual(['on:mail-desk', 'off:mail-desk'])
      })
    } finally { for (const off of offs) off() }
  })

  it('Escape in a field lets the field go first; in a search with words it clears them; then it unwinds', async () => {
    await windowWith(fakeService())
    press('Write'); await settle()
    const text = panel().querySelector('[name="text"]') as HTMLTextAreaElement
    text.focus()
    expect(document.activeElement).toBe(text)
    key('Escape', text)
    expect(document.activeElement).not.toBe(text)
    expect(panel().querySelector('.hc-mail-form')).not.toBeNull() // still writing
    key('Escape')
    expect(panel().querySelector('.hc-mail-form')).toBeNull()
    expect(panel().querySelector('.hc-mail-main .hc-mail-empty')).not.toBeNull()
  })
})

// MAIL COMES FROM THE HOSTS YOU CARRY. No host is named in code: a hive with none is told so and
// shown the door to Your Network; a key no host knows is told which hosts were asked.
describe('the hosts you carry', () => {
  it('a hive with no host is told so, with the door to Your Network before Try again', async () => {
    const toggles: unknown[] = []
    let live = false
    const off = EffectBus.on('hosts:view-toggle', p => { if (live) toggles.push(p) })
    live = true
    try {
      await windowWith(fakeService({ hostList: vi.fn(async () => []), mailboxes: vi.fn(async () => { throw new MailError('no-hosts') }) }))
      expect(panel().querySelector('.hc-mail-said.is-bad')?.textContent).toContain('carries none yet')
      const labels = buttons().map(b => b.textContent)
      expect(labels.indexOf('Open Your Network')).toBeLessThan(labels.indexOf('Try again'))
      press('Open Your Network')
      expect(toggles).toHaveLength(1)
    } finally { off() }
  })

  it('a key no host knows is told which hosts were asked, by zone', async () => {
    await windowWith(fakeService({ hostList: vi.fn(async () => ['https://hypercomb.com', 'https://mail.example.org']), addresses: vi.fn(async () => []) }))
    const quiet = Array.from(panel().querySelectorAll('.hc-mail-quiet')).map(p => p.textContent)
    expect(quiet[0]).toContain('any host you carry')
    expect(quiet[1]).toBe('Asked: hypercomb.com, mail.example.org')
    expect(panel().querySelector('.hc-mail-keybox')?.textContent).toBe('f'.repeat(64))
  })
})

describe('explain', () => {
  it('has words for every way mail can fail', () => {
    for (const code of ['no-signer', 'no-key', 'unauthorized', 'not-found', 'limit', 'refused', 'bad-message', 'unavailable', 'conflict', 'no-hosts'] as const) {
      expect(explain(new MailError(code, 'why')).length).toBeGreaterThan(10)
    }
    expect(explain(new MailError('unavailable'), true)).toContain('Nothing was sent')
    expect(explain(new Error('anything else'))).toContain('did not answer')
  })
})

// documentation/mail-templates.md, steps 2 and 3: the composer fills a template this hive keeps and sends
// it baked with its part; a reader that keeps the same template shows the message from its own copy.
describe('templates', () => {
  const enc = new TextEncoder()
  const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
  const sha = async (bytes: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  const bytesOf = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

  /** The hive's store as the templates see it: a heap by signature and the one list document. */
  function templateHive(over: Partial<TemplateStore> = {}) {
    const heap = new Map<string, Uint8Array>()
    let members: string[] | null = null
    const pool = { name: 'pool', keys: async function* () { if (members) yield 'd'.repeat(64) } }
    const store: TemplateStore = {
      getPool: async () => pool,
      openPool: async () => (members ? pool : null),
      getPoolDoc: async () => (members ? enc.encode(JSON.stringify({ meaning: 'mail:template', members })).buffer as ArrayBuffer : null),
      putPoolDoc: async (_pool, bytes) => { members = (JSON.parse(new TextDecoder().decode(bytes)) as { members: string[] }).members; return 'd'.repeat(64) },
      putResource: async blob => { const bytes = await bytesOf(blob); const sig = await sha(bytes); heap.set(sig, bytes); return sig },
      getResourceLocal: async sig => {
        const bytes = heap.get(sig)
        return bytes ? ({ size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } as unknown as Blob) : null
      },
      ...over,
    }
    return { store, heap, members: () => members ?? [] }
  }

  const INVITE = (logo: string): MailTemplateDocument => ({
    name: 'Tasting night',
    description: 'An invitation with the room',
    subject: 'You are invited, {{guest}}',
    holes: { guest: { type: 'text', required: true, label: 'Who it is for' }, seats: { type: 'number', label: 'Seats left' } },
    text: 'Dear {{guest}}, {{seats}} seats are left.',
    html: '<p>Dear <strong>{{guest}}</strong>, {{seats}} seats are left.</p><p>{{@logo}}</p>',
    resources: { logo },
  })

  /** A hive that keeps the invitation, its logo held. */
  async function keeping(over: Partial<TemplateStore> = {}) {
    const hive = templateHive(over)
    const logo = await hive.store.putResource!(new Blob([PNG]))
    const saved = await saveTemplate(hive.store, INVITE(logo))
    if (!saved.ok) throw new Error(saved.reason)
    return { ...hive, logo, sig: saved.sig }
  }

  const holes = (): HTMLElement[] => Array.from(panel().querySelectorAll<HTMLElement>('.hc-mail-template-form > .hc-mail-field'))
  const holeInput = (n: number): HTMLInputElement => holes()[n]!.querySelector('input, textarea') as HTMLInputElement
  const typeInto = (input: HTMLInputElement, value: string): void => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
  const preview = (): string => (panel().querySelector('.hc-mail-preview iframe') as HTMLIFrameElement).srcdoc
  const submit = (): void => (panel().querySelector('form') as HTMLFormElement).requestSubmit()

  it('"Use a template" says what it is doing, lists what this hive keeps, and shows the form instead of the message box', async () => {
    const hive = await keeping()
    const reading = gate()
    const store = { ...hive.store, openPool: async (meaning: string) => { await reading.promise; return hive.store.openPool!(meaning) } }
    await windowWith(fakeService(), element => { element.templates = () => store })
    press('Write')
    press('Use a template')
    // The same frame as the press: the button says it, the cue says it, placeholders hold the place.
    expect(buttons().some(b => b.textContent === 'Reading your templates…' && b.disabled)).toBe(true)
    expect(cue()).toBe('Reading your templates…')
    expect(panel().querySelector('.hc-mail-template-chooser .hc-mail-skeleton-text')).not.toBeNull()
    reading.open()
    await settle()
    expect(panel().querySelector('.hc-mail-template-chooser')!.textContent).toContain('An invitation with the room')
    press('Tasting night')
    expect(panel().querySelector('.hc-mail-template-chooser')).toBeNull()
    expect(panel().querySelector('[name="text"]')).toBeNull()
    expect(panel().querySelector('[name="subject"]')).toBeNull() // the template writes its subject
    expect(holes().map(h => h.querySelector('span')!.textContent)).toEqual(['Who it is for (required)', 'Seats left'])
    expect(panel().textContent).toContain('Filled from your template “Tasting night”.')
  })

  it('the preview is the template filled in as it is typed, its picture from this hive', async () => {
    const hive = await keeping()
    await windowWith(fakeService(), element => { element.templates = () => hive.store })
    press('Write'); press('Use a template'); await settle()
    press('Tasting night'); await settle()
    typeInto(holeInput(0), '<b>Leanne</b>')
    await wait(260); await settle()
    expect(preview()).toContain('Dear <strong>&lt;b&gt;Leanne&lt;/b&gt;</strong>')
    expect(preview()).toContain('src="data:image/png;base64,')
    expect(panel().querySelector('.hc-mail-template-subject')!.textContent).toBe('Subject: You are invited, <b>Leanne</b>')
  })

  it('sends it baked, with the part and the picture inline under its id', async () => {
    const hive = await keeping()
    const service = fakeService()
    await windowWith(service, element => { element.templates = () => hive.store })
    press('Write')
    fill('to', 'friend@example.org')
    press('Use a template'); await settle()
    press('Tasting night'); await settle()
    typeInto(holeInput(0), 'Leanne')
    typeInto(holeInput(1), '6')
    submit(); await settle()
    expect(service.send).toHaveBeenCalledTimes(1)
    const request = service.send.mock.calls[0]![0] as Record<string, unknown>
    expect(request).toMatchObject({
      to: ['friend@example.org'], subject: 'You are invited, Leanne', text: 'Dear Leanne, 6 seats are left.',
      template: { sig: hive.sig, fill: { guest: 'Leanne', seats: 6 } },
    })
    expect(request['html']).toContain(`<img src="cid:${hive.logo}" alt="logo">`)
    expect(request['attachments']).toEqual([{ filename: `${hive.logo.slice(0, 12)}.png`, type: 'image/png', content: PNG, contentId: hive.logo }])
    expect(panel().textContent).toContain('Sent to friend@example.org.')
  })

  it('a missing required field is said beside it, and nothing is sent', async () => {
    const hive = await keeping()
    const service = fakeService()
    await windowWith(service, element => { element.templates = () => hive.store })
    press('Write')
    fill('to', 'friend@example.org')
    press('Use a template'); await settle()
    press('Tasting night'); await settle()
    submit(); await settle()
    expect(service.send).not.toHaveBeenCalled()
    expect(panel().textContent).toContain('The template is not filled in yet')
    expect(holes()[0]!.querySelector('.hc-mail-status:not([hidden])')!.textContent).toBe('This is needed.')
  })

  it('the template takes one of the file slots', async () => {
    const hive = await keeping()
    await windowWith(fakeService(), element => { element.templates = () => hive.store })
    press('Write'); press('Use a template'); await settle()
    press('Tasting night'); await settle()
    expect(panel().textContent).toContain(`Up to ${MAIL_LIMITS.attachments - 1} files`)
  })

  it('a hive that keeps none says so; Escape closes the list before it leaves the draft', async () => {
    const hive = templateHive()
    await windowWith(fakeService(), element => { element.templates = () => hive.store })
    press('Write'); press('Use a template'); await settle()
    expect(panel().textContent).toContain('No templates are kept on this hive yet.')
    expect(mounted!.dismissInner()).toBe(true)
    expect(panel().querySelector('.hc-mail-template-chooser')).toBeNull()
    expect(panel().querySelector('.hc-mail-form')).not.toBeNull() // still writing
  })

  it('stopping brings the message box back with what it said', async () => {
    const hive = await keeping()
    await windowWith(fakeService(), element => { element.templates = () => hive.store })
    press('Write')
    type('text', 'my own words')
    press('Use a template'); await settle()
    press('Tasting night'); await settle()
    press('Stop using it')
    expect((panel().querySelector('[name="text"]') as HTMLTextAreaElement).value).toBe('my own words')
    expect(panel().querySelector('.hc-mail-template-form')).toBeNull()
  })

  it('"Save as template" keeps the draft as one, each {{name}} a field, and "Use a template" offers it', async () => {
    const hive = templateHive()
    await windowWith(fakeService(), element => { element.templates = () => hive.store })
    press('Write')
    fill('subject', 'Hello {{guest}}')
    type('text', 'Dear {{guest}}, see you at {{place}}.')
    press('Save as template'); await settle()
    expect(panel().textContent).toContain('Kept as a template.')
    const listing = await listTemplates(hive.store)
    expect(listing.entries).toHaveLength(1)
    const kept = listing.entries[0]!
    expect(kept.ok && kept.template).toMatchObject({ name: 'Hello guest', subject: 'Hello {{guest}}', holes: { guest: { type: 'text' }, place: { type: 'text' } } })
    press('Use a template'); await settle()
    expect(panel().querySelector('.hc-mail-template-chooser')!.textContent).toContain('Hello guest')
  })

  it('a draft with nothing written is not made a template', async () => {
    const hive = templateHive()
    await windowWith(fakeService(), element => { element.templates = () => hive.store })
    press('Write')
    press('Save as template'); await settle()
    expect(panel().textContent).toContain('Write the message first')
    expect(hive.members()).toEqual([])
  })

  /** A received message filled from the invitation: baked text and html, and the part. */
  const received = async (sig: string, fill: Record<string, string | number>, html = '<p>the sender wrote this</p>') => {
    const part = mailPart(sig, fill)!
    return mime({ text: 'baked text', html, files: [{ filename: part.filename, type: MAIL_TEMPLATE_PART_TYPE, base64: btoa(part.body) }, { filename: 'plan.pdf', type: 'application/pdf', base64: 'JVBERi0x' }] })
  }
  const messageFrame = (): string => (panel().querySelector('.hc-mail-frame:not(.is-previews):not(.is-preview)') as HTMLIFrameElement).srcdoc

  it('a reader that keeps the template shows the message from its own copy, says so, and can show the sender’s', async () => {
    const hive = await keeping()
    const raw = await received(hive.sig, { guest: 'Ana', seats: 2 })
    await windowWith(fakeService({ readRaw: vi.fn(async () => raw) }), element => { element.templates = () => hive.store })
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    expect(panel().querySelector('.hc-mail-subject')!.textContent).toBe('You are invited, Ana')
    expect(messageFrame()).toContain('Dear <strong>Ana</strong>, 2 seats are left.')
    expect(messageFrame()).toContain('data:image/png;base64,')
    expect(panel().textContent).toContain('Shown from your template “Tasting night”')
    // The part is the message's own, never a file.
    const files = Array.from(panel().querySelectorAll('.hc-mail-attachment-name')).map(n => n.textContent!.split(' · ')[0])
    expect(files).toEqual(['plan.pdf'])
    press('Show the sender’s copy')
    expect(messageFrame()).toContain('the sender wrote this')
    press('Show from the template')
    expect(messageFrame()).toContain('Dear <strong>Ana</strong>')
  })

  it('a template this hive does not keep, or a fill it refuses, shows the sender’s copy exactly as before', async () => {
    const hive = await keeping()
    const stranger = 'e'.repeat(64)
    for (const raw of [await received(stranger, { guest: 'Ana' }), await received(hive.sig, { guest: 'Ana', seats: 'six' }), await received(hive.sig, { seats: 2 })]) {
      document.body.replaceChildren()
      await windowWith(fakeService({ readRaw: vi.fn(async () => raw) }), element => { element.templates = () => hive.store })
      ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
      await settle()
      expect(messageFrame()).toContain('the sender wrote this')
      expect(panel().textContent).not.toContain('Shown from your template')
      expect(Array.from(panel().querySelectorAll('.hc-mail-attachment-name')).map(n => n.textContent!.split(' · ')[0])).toEqual(['plan.pdf'])
      mounted?.remove()
    }
  })

  it('a forward never carries the template part on', async () => {
    const hive = await keeping()
    const raw = await received(hive.sig, { guest: 'Ana' })
    await windowWith(fakeService({ readRaw: vi.fn(async () => raw) }), element => { element.templates = () => hive.store })
    ;(panel().querySelector('.hc-mail-row') as HTMLElement).click()
    await settle()
    press('Forward')
    expect(Array.from(panel().querySelectorAll('.hc-mail-files .hc-mail-attachment-name')).map(n => n.textContent!.split(' · ')[0])).toEqual(['plan.pdf'])
  })
})
