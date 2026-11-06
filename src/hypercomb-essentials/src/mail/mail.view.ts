// mail/mail.view.ts
//
// THE MAIL WINDOW — your inbox, your Sent folder, a message, and a draft.
//
// ── A PRESS SENDS; THE COMMAND LINE OPENS ───────────────────────────────────
//
// The word `mail` only opens this window (mail.queen.ts). Sending is a press on
// Send, on a draft the participant can read: an act that speaks as the
// participant to someone else is never a word typed at a prompt.
//
// ── NOTHING IS KEPT ─────────────────────────────────────────────────────────
//
// Messages are opened into memory and shown. Nothing is written to storage, a
// pool or a layer, and closing the window drops every decrypted byte it held.
//
// ── A STRANGER'S HTML CANNOT ACT ────────────────────────────────────────────
//
// HTML mail is made safe in mail-html.ts and shown in a sandboxed, script-less
// iframe that may load nothing but a data: image. Plain text is shown as text
// (textContent), never as markup. Every other string here is textContent too.
//
// ── AN ELEMENT, NOT A COMPONENT ─────────────────────────────────────────────
//
// Module chrome is a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { mailFrameDocument, makeMailHtmlSafe } from './mail-html.js'
import {
  MailError, MailService,
  type Folder, type MailListItem, type SentRecord,
} from './mail.service.js'
import type { ParsedMail } from './mime.js'
import { recipientsIn, replyDraft, replySubject, type Draft } from './reply.js'

export const MAIL_OPEN = 'mail:open'
/** An open request older than this is stale — a replayed last value, not a press. */
export const OPEN_STAMP_MS = 5_000

const SURFACE = 'hc-mail'
const STYLE_ID = 'hc-mail-style'

const STEEL = '126, 182, 214'
const ACCENT = '201, 162, 39'

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const interpolate = (text: string, params?: Record<string, string | number>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : interpolate(fallback, params)
  } catch { return interpolate(fallback, params) }
}

/** What a failure means to the person, in words. */
export const explain = (error: unknown, sending = false, recipients: readonly string[] = []): string => {
  const code = error instanceof MailError ? error.code : 'unavailable'
  const detail = error instanceof MailError ? error.detail : ''
  switch (code) {
    case 'no-signer': return t('mail.error.no-signer', 'The signing service is not loaded yet. Try again in a moment.')
    case 'no-key': return t('mail.error.no-key', 'This device holds no key, and opening mail never makes one. Open mail on the device that holds your key.')
    case 'unauthorized': return t('mail.error.unauthorized', 'The mail host does not know this key as the owner of that address.')
    case 'not-found': return t('mail.error.not-found', 'That message is not there.')
    case 'limit': return t('mail.error.limit', 'A sending limit was reached. Try again later.')
    case 'refused':
      // Cloudflare learns an address that bounced and will not try it again. Which address is not in the answer, so name
      // the ones in this draft; a typo is by far the usual cause.
      if (detail === 'E_RECIPIENT_SUPPRESSED') {
        return t('mail.error.suppressed', 'Cloudflare will not send to one of these addresses, because it bounced before: {to}. Check To and Cc for a typo.', { to: recipients.join(', ') || '—' })
      }
      return t('mail.error.refused', 'The message was refused: {detail}', { detail: detail || '—' })
    case 'bad-message': return t('mail.error.bad-message', 'This message could not be opened with this key.')
    default: return sending
      ? t('mail.error.unavailable-send', 'The mail host did not answer. Nothing was sent.')
      : t('mail.error.unavailable', 'The mail host did not answer.')
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const when = (at: number | undefined): string =>
  at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''

type Said = { text: string; tone: 'ok' | 'quiet' | 'bad' }
type Phase = 'loading' | 'ready' | 'problem' | 'no-mailbox'

type Pane =
  | { kind: 'list' }
  | { kind: 'read'; sig: string; mail?: ParsedMail; sent?: SentRecord; failed?: string; asText: boolean }
  | { kind: 'compose'; draft: Draft; failed?: string; sending: boolean }

export class MailElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #cleanup: (() => void)[] = []
  #phase: Phase = 'loading'
  #problem = ''
  #key: string | null = null
  #addresses: string[] = []
  #address = ''
  #folder: Folder = 'box'
  #items: MailListItem[] = []
  #cursor: string | null = null
  #pane: Pane = { kind: 'list' }
  #said: Said | null = null
  #turn = 0

  /** THE SEAM. Replaced in the spec, so no network and no signer are reached there. */
  service: MailService = new MailService()

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<{ at?: number }>(MAIL_OPEN, payload => {
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > OPEN_STAMP_MS) return
      this.open()
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  open(): void {
    if (!this.#panel) {
      const panel = el('aside', 'hc-mail')
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', t('mail.title', 'Mail'))
      panel.tabIndex = -1
      panel.setAttribute('data-consumes-wheel', '')
      panel.addEventListener('keydown', this.#onKey)
      this.appendChild(panel)
      this.#panel = panel
    }
    void this.#start()
  }

  close(): void {
    this.#turn++ // an answer still on its way finds nobody waiting
    if (!this.#panel) return
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = null
    // Everything decrypted goes with the window.
    this.#items = []
    this.#pane = { kind: 'list' }
    this.#said = null
  }

  get isOpen(): boolean { return !!this.#panel }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (this.#pane.kind !== 'list') { this.#pane = { kind: 'list' }; this.#render(); return }
    this.close()
  }

  // ── the acts ────────────────────────────────────────────────────────────

  async #start(): Promise<void> {
    const turn = ++this.#turn
    this.#phase = 'loading'
    this.#pane = { kind: 'list' }
    this.#said = null
    this.#render()
    try {
      this.#addresses = await this.service.addresses()
      if (turn !== this.#turn) return
      if (!this.#addresses.length) {
        this.#key = await this.service.publicKey()
        this.#phase = 'no-mailbox'
        this.#render()
        return
      }
      if (!this.#addresses.includes(this.#address)) this.#address = this.#addresses[0]!
      this.#phase = 'ready'
      await this.#load()
    } catch (error) {
      if (turn !== this.#turn) return
      this.#phase = 'problem'
      this.#problem = explain(error)
      this.#render()
    }
  }

  async #load(more = false): Promise<void> {
    const turn = ++this.#turn
    if (!more) { this.#items = []; this.#cursor = null }
    this.#render()
    try {
      const page = await this.service.list(this.#address, this.#folder, more ? this.#cursor : null)
      if (turn !== this.#turn) return
      this.#items = more ? [...this.#items, ...page.items] : page.items
      this.#cursor = page.cursor
      this.#said = null
    } catch (error) {
      if (turn !== this.#turn) return
      this.#said = { text: explain(error), tone: 'bad' }
    }
    this.#render()
  }

  async #openMessage(item: MailListItem): Promise<void> {
    const turn = ++this.#turn
    this.#pane = { kind: 'read', sig: item.sig, asText: false }
    this.#render()
    try {
      const folder = this.#folder
      if (folder === 'sent') {
        const sent = await this.service.readSent(this.#address, item.sig)
        if (turn === this.#turn) this.#pane = { kind: 'read', sig: item.sig, sent, asText: true }
      } else {
        const mail = await this.service.read(this.#address, item.sig)
        if (turn === this.#turn) this.#pane = { kind: 'read', sig: item.sig, mail, asText: !mail.html }
      }
    } catch (error) {
      if (turn === this.#turn) this.#pane = { kind: 'read', sig: item.sig, failed: explain(error), asText: true }
    }
    if (turn === this.#turn) this.#render()
  }

  #compose(draft?: Draft): void {
    this.#pane = { kind: 'compose', draft: draft ?? { to: '', cc: '', subject: '', text: '', inReplyTo: '', references: '' }, sending: false }
    this.#said = null
    this.#render()
  }

  /** THE ACT. The press is the yes; nothing above this line sends. */
  async #send(form: HTMLFormElement): Promise<void> {
    const pane = this.#pane
    if (pane.kind !== 'compose' || pane.sending) return
    const field = (name: string): string => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? ''
    const draft: Draft = { to: field('to'), cc: field('cc'), subject: field('subject'), text: field('text'), inReplyTo: pane.draft.inReplyTo, references: pane.draft.references }
    const from = field('from') || this.#address
    const fail = (failed: string): void => { this.#pane = { kind: 'compose', draft, failed, sending: false }; this.#render() }

    const to = recipientsIn(draft.to)
    if (!to.length) return fail(t('mail.compose.need-to', 'Add at least one address in To.'))
    if (!draft.subject.trim()) return fail(t('mail.compose.need-subject', 'Add a subject.'))
    if (!draft.text.trim()) return fail(t('mail.compose.need-body', 'Write something first.'))

    this.#pane = { kind: 'compose', draft, sending: true }
    this.#render()
    try {
      await this.service.send({
        from, to, cc: recipientsIn(draft.cc), subject: draft.subject.trim(), text: draft.text,
        ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}), ...(draft.references ? { references: draft.references } : {}),
      })
      this.#pane = { kind: 'list' }
      this.#said = { text: t('mail.sent', 'Sent to {to}.', { to: to.join(', ') }), tone: 'ok' }
      if (this.#folder === 'sent') await this.#load(); else this.#render()
    } catch (error) {
      fail(explain(error, true, [...to, ...recipientsIn(draft.cc)]))
    }
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    const panel = this.#panel
    if (!panel) return
    panel.replaceChildren(this.#head())
    const body = el('div', 'hc-mail-body')
    panel.appendChild(body)

    if (this.#phase === 'loading') { body.appendChild(el('p', 'hc-mail-quiet', t('mail.loading', 'Opening your mailbox…'))); return }
    if (this.#phase === 'problem') {
      body.appendChild(el('p', 'hc-mail-said is-bad', this.#problem))
      body.appendChild(this.#button(t('mail.retry', 'Try again'), () => { void this.#start() }))
      return
    }
    if (this.#phase === 'no-mailbox') { this.#noMailbox(body); return }

    if (this.#said) body.appendChild(el('p', `hc-mail-said is-${this.#said.tone}`, this.#said.text))
    if (this.#pane.kind === 'compose') this.#composePane(body, this.#pane)
    else if (this.#pane.kind === 'read') this.#readPane(body, this.#pane)
    else this.#listPane(body)
  }

  #head(): HTMLElement {
    const head = el('header', 'hc-mail-head')
    head.appendChild(el('span', 'hc-mail-title', t('mail.title', 'Mail')))

    if (this.#phase === 'ready') {
      if (this.#addresses.length > 1) {
        const select = el('select', 'hc-mail-address')
        select.setAttribute('aria-label', t('mail.address', 'Address'))
        for (const address of this.#addresses) {
          const option = el('option', '', address)
          option.value = address
          option.selected = address === this.#address
          select.appendChild(option)
        }
        select.addEventListener('change', () => { this.#address = select.value; this.#pane = { kind: 'list' }; void this.#load() })
        head.appendChild(select)
      } else {
        head.appendChild(el('span', 'hc-mail-who', this.#address))
      }
      head.appendChild(this.#button(t('mail.compose', 'Write'), () => this.#compose(), 'is-place'))
    }
    const close = el('button', 'hc-mail-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', t('panel.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.appendChild(close)
    return head
  }

  #button(label: string, onPress: () => void, extra = ''): HTMLButtonElement {
    const button = el('button', `hc-mail-do ${extra}`.trim(), label)
    button.type = 'button'
    button.addEventListener('click', onPress)
    return button
  }

  #noMailbox(body: HTMLElement): void {
    body.appendChild(el('p', 'hc-mail-quiet', t('mail.none', 'This device’s key does not own a mailbox on the mail host yet.')))
    if (!this.#key) { body.appendChild(el('p', 'hc-mail-said is-bad', explain(new MailError('no-key')))); return }
    body.appendChild(el('p', 'hc-mail-quiet', t('mail.none-key', 'To give it one, tell whoever runs the mail host to add this key to the address:')))
    body.appendChild(el('code', 'hc-mail-keybox', this.#key))
    const copy = this.#button(t('mail.copy-key', 'Copy key'), () => {
      void (async () => {
        try { await navigator.clipboard.writeText(this.#key ?? ''); copy.textContent = t('mail.copied', 'Copied') } catch { /* the key is selectable above */ }
      })()
    })
    body.appendChild(copy)
    body.appendChild(el('p', 'hc-mail-quiet', t('mail.none-note', 'It is a public key: safe to share. The secret half never leaves this device.')))
  }

  #listPane(body: HTMLElement): void {
    const tabs = el('div', 'hc-mail-tabs')
    for (const [folder, label] of [['box', t('mail.inbox', 'Inbox')], ['sent', t('mail.sent-folder', 'Sent')]] as const) {
      const tab = this.#button(label, () => { this.#folder = folder; this.#said = null; void this.#load() }, folder === this.#folder ? 'is-on' : '')
      tabs.appendChild(tab)
    }
    tabs.appendChild(this.#button(t('mail.refresh', 'Refresh'), () => { void this.#load() }))
    body.appendChild(tabs)

    if (!this.#items.length) {
      body.appendChild(el('p', 'hc-mail-quiet', this.#folder === 'box' ? t('mail.empty-inbox', 'No mail yet.') : t('mail.empty-sent', 'Nothing sent yet.')))
      return
    }
    const list = el('ul', 'hc-mail-list')
    for (const item of this.#items) {
      const row = el('li', 'hc-mail-row')
      row.tabIndex = 0
      const who = this.#folder === 'box' ? item.meta?.from : item.meta?.to
      row.appendChild(el('span', 'hc-mail-row-who', who || t('mail.unknown', '(unreadable)')))
      row.appendChild(el('span', 'hc-mail-row-subject', item.meta?.subject || t('mail.no-subject', '(no subject)')))
      row.appendChild(el('span', 'hc-mail-row-at', when(item.meta?.at ?? item.at)))
      const choose = (): void => { void this.#openMessage(item) }
      row.addEventListener('click', choose)
      row.addEventListener('keydown', event => { if (event.key === 'Enter') { event.stopPropagation(); choose() } })
      list.appendChild(row)
    }
    body.appendChild(list)
    if (this.#cursor) body.appendChild(this.#button(t('mail.more', 'Older'), () => { void this.#load(true) }))
  }

  #readPane(body: HTMLElement, pane: Extract<Pane, { kind: 'read' }>): void {
    const bar = el('div', 'hc-mail-tabs')
    bar.appendChild(this.#button(t('mail.back', 'Back'), () => { this.#pane = { kind: 'list' }; this.#render() }))

    if (pane.failed) { body.appendChild(bar); body.appendChild(el('p', 'hc-mail-said is-bad', pane.failed)); return }
    if (!pane.mail && !pane.sent) { body.appendChild(bar); body.appendChild(el('p', 'hc-mail-quiet', t('mail.opening', 'Opening…'))); return }

    const lines: [string, string][] = pane.mail
      ? [[t('mail.from', 'From'), pane.mail.from], [t('mail.to', 'To'), pane.mail.to], [t('mail.cc', 'Cc'), pane.mail.cc], [t('mail.date', 'Date'), pane.mail.date]]
      : [[t('mail.from', 'From'), pane.sent!.from], [t('mail.to', 'To'), pane.sent!.to.join(', ')], [t('mail.cc', 'Cc'), pane.sent!.cc.join(', ')], [t('mail.date', 'Date'), when(pane.sent!.at)]]
    const subject = pane.mail?.subject ?? pane.sent!.subject

    if (pane.mail) {
      const mail = pane.mail
      bar.appendChild(this.#button(t('mail.reply', 'Reply'), () => this.#compose(replyDraft(mail, this.#address))))
      bar.appendChild(this.#button(t('mail.reply-all', 'Reply all'), () => this.#compose(replyDraft(mail, this.#address, true))))
      if (mail.html) bar.appendChild(this.#button(pane.asText ? t('mail.show-html', 'Show formatted') : t('mail.show-text', 'Show plain text'), () => { pane.asText = !pane.asText; this.#render() }))
    }
    body.appendChild(bar)

    body.appendChild(el('h3', 'hc-mail-subject', subject || t('mail.no-subject', '(no subject)')))
    const meta = el('dl', 'hc-mail-meta')
    for (const [label, value] of lines) {
      if (!value) continue
      meta.appendChild(el('dt', '', label))
      meta.appendChild(el('dd', '', value))
    }
    body.appendChild(meta)

    if (pane.mail?.html && !pane.asText) {
      const safe = makeMailHtmlSafe(pane.mail.html, pane.mail.inlineImages)
      if (safe.blocked) body.appendChild(el('p', 'hc-mail-quiet', t('mail.blocked', '{n} remote items were not loaded, so nothing outside could see you open this.', { n: safe.blocked })))
      const frame = el('iframe', 'hc-mail-frame')
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
      frame.setAttribute('referrerpolicy', 'no-referrer')
      frame.title = t('mail.message', 'Message')
      frame.srcdoc = mailFrameDocument(safe.html)
      body.appendChild(frame)
    } else {
      body.appendChild(el('pre', 'hc-mail-text', pane.mail?.text ?? pane.sent!.text))
    }

    const attachments = pane.mail?.attachments ?? []
    if (attachments.length) {
      body.appendChild(el('p', 'hc-mail-quiet', t('mail.attachments', 'Attachments are listed, not opened here:')))
      const list = el('ul', 'hc-mail-attachments')
      for (const file of attachments) list.appendChild(el('li', '', `${file.filename} · ${file.type} · ${Math.max(1, Math.round(file.size / 1024))} KB`))
      body.appendChild(list)
    }
  }

  #composePane(body: HTMLElement, pane: Extract<Pane, { kind: 'compose' }>): void {
    const form = el('form', 'hc-mail-form')
    form.noValidate = true
    form.addEventListener('submit', event => { event.preventDefault(); void this.#send(form) })

    const field = <T extends HTMLInputElement | HTMLTextAreaElement>(node: T, name: string, label: string, value: string): HTMLLabelElement => {
      const wrap = el('label', 'hc-mail-field')
      wrap.appendChild(el('span', '', label))
      node.name = name
      node.value = value
      node.disabled = pane.sending
      node.setAttribute('data-escape-local', '')
      wrap.appendChild(node)
      return wrap
    }

    if (this.#addresses.length > 1) {
      const wrap = el('label', 'hc-mail-field')
      wrap.appendChild(el('span', '', t('mail.from', 'From')))
      const select = el('select')
      select.name = 'from'
      for (const address of this.#addresses) { const o = el('option', '', address); o.value = address; o.selected = address === this.#address; select.appendChild(o) }
      select.disabled = pane.sending
      wrap.appendChild(select)
      form.appendChild(wrap)
    }
    form.appendChild(field(el('input'), 'to', t('mail.to', 'To'), pane.draft.to))
    form.appendChild(field(el('input'), 'cc', t('mail.cc', 'Cc'), pane.draft.cc))
    form.appendChild(field(el('input'), 'subject', t('mail.subject', 'Subject'), pane.draft.subject))
    const text = el('textarea', 'hc-mail-compose-text')
    text.rows = 12
    form.appendChild(field(text, 'text', t('mail.message', 'Message'), pane.draft.text))

    if (pane.failed) form.appendChild(el('p', 'hc-mail-said is-bad', pane.failed))
    const acts = el('div', 'hc-mail-acts')
    const send = el('button', 'hc-mail-do is-place', pane.sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send'))
    send.type = 'submit'
    send.disabled = pane.sending
    acts.appendChild(send)
    const cancel = this.#button(t('mail.discard', 'Discard'), () => { this.#pane = { kind: 'list' }; this.#render() })
    cancel.disabled = pane.sending
    acts.appendChild(cancel)
    form.appendChild(acts)
    body.appendChild(form)
    if (pane.draft.subject || pane.draft.to) queueMicrotask(() => (form.elements.namedItem(pane.draft.to ? 'text' : 'to') as HTMLElement | null)?.focus())
  }
}

// `Re:` alone is kept for callers that draft a reply from a bare subject.
export { replySubject }

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* The same material as every other tool window — the recipe restated
       with the SHARED values, since a module cannot @use the stylesheet. */
    ${SURFACE} { display: contents; }
    .hc-mail {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: min(44rem, calc(100vw - 1.5rem)); min-width: 16rem;
      box-sizing: border-box; display: flex; flex-direction: column;
      z-index: 100002;
      background: rgba(13, 15, 21, 0.975);
      backdrop-filter: blur(14px) saturate(1.04);
      -webkit-backdrop-filter: blur(14px) saturate(1.04);
      border: 0; border-left: 1px solid rgba(${STEEL}, 0.38); border-radius: 0;
      box-shadow: -14px 0 44px rgba(0, 0, 0, 0.46);
      color: #dfe6ee; font: 0.8125rem/1.45 system-ui, sans-serif;
    }
    .hc-mail-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.8rem; border-bottom: 1px solid rgba(${STEEL}, 0.22); }
    .hc-mail-title { font-weight: 600; letter-spacing: 0.02em; }
    .hc-mail-who, .hc-mail-address { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.8; }
    .hc-mail-address { background: transparent; color: inherit; border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px; padding: 0.15rem 0.3rem; }
    .hc-mail-close { margin-left: auto; background: none; border: 0; color: inherit; font-size: 1.2rem; line-height: 1; cursor: pointer; opacity: 0.7; }
    .hc-mail-close:hover { opacity: 1; }
    .hc-mail-body { flex: 1; min-height: 0; overflow: auto; padding: 0.7rem 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .hc-mail-quiet { margin: 0; opacity: 0.65; }
    .hc-mail-said { margin: 0; padding: 0.4rem 0.6rem; border-radius: 2px; border: 1px solid rgba(${STEEL}, 0.3); }
    .hc-mail-said.is-ok { border-color: rgba(120, 200, 140, 0.55); }
    .hc-mail-said.is-bad { border-color: rgba(220, 110, 110, 0.65); }
    .hc-mail-do { background: rgba(${STEEL}, 0.12); color: inherit; border: 1px solid rgba(${STEEL}, 0.4); border-radius: 2px; padding: 0.25rem 0.65rem; cursor: pointer; font: inherit; }
    .hc-mail-do:hover:not(:disabled) { background: rgba(${STEEL}, 0.22); }
    .hc-mail-do:disabled { opacity: 0.5; cursor: default; }
    .hc-mail-do.is-place, .hc-mail-do.is-on { border-color: rgba(${ACCENT}, 0.75); color: rgb(${ACCENT}); }
    .hc-mail-tabs, .hc-mail-acts { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .hc-mail-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .hc-mail-row { display: grid; grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) auto; gap: 0.6rem; padding: 0.45rem 0.3rem; border-bottom: 1px solid rgba(${STEEL}, 0.14); cursor: pointer; }
    .hc-mail-row:hover, .hc-mail-row:focus { background: rgba(${STEEL}, 0.1); outline: none; }
    .hc-mail-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hc-mail-row-at { opacity: 0.6; font-size: 0.75rem; }
    .hc-mail-subject { margin: 0; font-size: 1rem; }
    .hc-mail-meta { display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 0.6rem; margin: 0; opacity: 0.85; }
    .hc-mail-meta dt { opacity: 0.6; } .hc-mail-meta dd { margin: 0; overflow-wrap: anywhere; }
    .hc-mail-frame { width: 100%; height: 60vh; border: 1px solid rgba(${STEEL}, 0.25); border-radius: 2px; background: #fff; }
    .hc-mail-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    .hc-mail-attachments { margin: 0; padding-left: 1.1rem; opacity: 0.85; }
    .hc-mail-form { display: flex; flex-direction: column; gap: 0.5rem; }
    .hc-mail-field { display: flex; flex-direction: column; gap: 0.15rem; }
    .hc-mail-field > span { opacity: 0.6; font-size: 0.75rem; }
    .hc-mail-field input, .hc-mail-field textarea, .hc-mail-field select { background: rgba(255, 255, 255, 0.05); color: inherit; border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px; padding: 0.35rem 0.5rem; font: inherit; }
    .hc-mail-compose-text { resize: vertical; min-height: 10rem; }
    .hc-mail-keybox { display: block; padding: 0.5rem 0.6rem; border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px; overflow-wrap: anywhere; user-select: all; font-size: 0.75rem; }
  `
  document.head.appendChild(style)
}
