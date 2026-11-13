// sharing/site-manage.view.ts
//
// <hc-site-manage> — A MANAGED SITE DOOR'S CARD, WITH THE CHAT (jwize,
// 2026-11-12: "I need to be only with the visual card and the chat ai to
// improve", "the card is showing https://business-card.jwize.com so I need a
// way to show my ai chat new non angular version and then connect and enter
// my api key and start working").
//
// The owner opened <name>.<zone>/@hypercomb once; the worker now serves the
// framework-free page there to that browser and tells it what it manages (a
// page record, <script id="hc-manage">: the site, its title, its publisher and
// the head they published). This element fills the screen with that head's
// card, running exactly as the website runs it (the revision viewer's frame:
// revision-viewer.model.ts versionFrame), and lays a thin bar over the top:
// what is managed, the Chat, and the way back to the website. The chat opens
// over the card (it stacks above), so the card stays in view while you talk.
//
// A dependency: it exports the element and registers nothing. The bee beside
// it (site-manage.drone.ts) defines it and adds it to the shell, only on a
// page that carries the record.
//
// MIRRORED: hypercomb-shim/src/bootstrap/manage-record.ts reads the same record
// (a module may not import the shim). Every field is untrusted page text.

import { EffectBus, I18N_IOC_KEY, INSTALL_IOC_KEY, type I18nProvider, type InstallProvider } from '@hypercomb/core'
import { FRAME_MAX_ONE, versionFrame, type FrameReader, type FrameLayer } from '../history/revision-viewer.model.js'
// Whom builds follow here — the same record the scout read the offer from (the
// Packages window reads it the same way: host-directory.view.ts #follow).
import { readInstallFollow } from './update-scout.service.js'

export const SITE_MANAGE_SURFACE = 'hc-site-manage'
export const SITE_MANAGE_OWNER = '@diamondcoreprocessor.com/SiteManageView'
const STYLE_ID = 'hc-site-manage-style'
const LEAVE_HREF = '/@hypercomb/leave'
const SIG_RE = /^[0-9a-f]{64}$/

export type SiteManageRecord = { readonly lineage: string; readonly title: string; readonly head: string | null }

/** The record the worker put in the page, or null on any other page. */
export function siteManageRecord(doc: Document = document): SiteManageRecord | null {
  try {
    const raw = doc.getElementById('hc-manage')?.textContent
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    const lineage = typeof value['lineage'] === 'string' ? value['lineage'].slice(0, 200) : ''
    if (!lineage) return null
    const title = typeof value['title'] === 'string' && value['title'] ? value['title'].slice(0, 200) : lineage
    const head = typeof value['head'] === 'string' && SIG_RE.test(value['head']) ? value['head'] : null
    return { lineage, title, head }
  } catch {
    return null
  }
}

type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}
type Ioc = { get?: <T>(key: string) => T | undefined; whenReady?: (key: string, cb: () => void) => void }
type ModesLike = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }
const ioc = (): Ioc | undefined => (window as { ioc?: Ioc }).ioc
const store = (): StoreLike | undefined => ioc()?.get?.<StoreLike>('@hypercomb.social/Store')
const modes = (): ModesLike | undefined => ioc()?.get?.<ModesLike>('@diamondcoreprocessor.com/ModeRegistry')
type GestureLike = { register(entry: { owner: string; exact?: boolean; back: () => void }): () => void }
const gesture = (): GestureLike | undefined => ioc()?.get?.<GestureLike>('@diamondcoreprocessor.com/BackGesture')
const install = (): Pick<InstallProvider, 'installedSig' | 'acquire'> | undefined =>
  ioc()?.get?.<Pick<InstallProvider, 'installedSig' | 'acquire'>>(INSTALL_IOC_KEY)

/** The zone a site door hangs off (`business-card.jwize.com` → `jwize.com`):
 *  the address that serves its publisher's packages. MIRRORED from the shim's
 *  manage-record.ts siteDoorZone (a module may not import the shim). */
export function managedSiteZone(host: string): string {
  const bare = String(host || '').toLowerCase().replace(/:\d+$/, '')
  const labels = bare.split('.').filter(Boolean)
  return labels.length >= 3 ? labels.slice(1).join('.') : bare
}

/** Where an offered update's bytes are asked for: the site's zone, then the
 *  hosts the follow record names (where the scout read the offer). */
export function updateSources(host: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): string[] {
  let followed: readonly string[] = []
  try { followed = storage ? readInstallFollow(storage)?.hosts ?? [] : [] } catch { followed = [] }
  return [...new Set([managedSiteZone(host), ...followed].filter(Boolean))]
}
const safeStorage = (): Storage | null => { try { return localStorage } catch { return null } }

/** How the page starts again on the package it just took. A seam, so a test can watch it. */
export const restartPage = { run: (): void => { location.reload() } }
/** How long an update failure is said over the card before its own note returns. */
const UPDATE_FAILED_MS = 8000

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const value = ioc()?.get?.<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    if (typeof value === 'string' && value && value !== key) return value
  } catch { /* the fallback below */ }
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

const ElementBase: typeof HTMLElement = typeof HTMLElement === 'undefined'
  ? (class {} as unknown as typeof HTMLElement)
  : HTMLElement

export class SiteManageElement extends ElementBase {
  #record: SiteManageRecord | null = null
  #built = false
  #ticket = 0
  #bytes = new Map<string, Uint8Array>()
  #missing = new Set<string>()
  #frame: HTMLIFrameElement | null = null
  #note: HTMLDivElement | null = null
  #retry: HTMLButtonElement | null = null
  #title: HTMLSpanElement | null = null
  #chat: HTMLButtonElement | null = null
  #back: HTMLAnchorElement | null = null
  #update: HTMLButtonElement | null = null
  /** The package the publisher's channel names now, when it is not what runs here. */
  #offer: string | null = null
  #updating = false
  #offUpdate: (() => void) | null = null
  /** What the note says for the card itself, so a passing update failure gives it back. */
  #cardNote: { text: string; retry: boolean } = { text: '', retry: false }
  #failTimer = 0

  // Every byte the card names is read from its host, never "this device only":
  // the revision viewer asks local-only because its hive already holds the
  // tile, but a managed site door's hive is empty — read local-only, the card's
  // own data never arrived and the page fell back to its list. versionFrame
  // bounds what is carried (FRAME_MAX_CARRIED), so this is no fetch storm.
  readonly #reader: FrameReader = {
    bytes: sig => this.#bytesOf(sig),
    missing: sig => this.#missing.has('any:' + sig),
  }
  #covering = false
  #offBack: (() => void) | null = null

  connectedCallback(): void {
    ensureStyles()
    this.#record = siteManageRecord()
    if (!this.#record) { this.replaceChildren(); return }
    this.#build()
    this.#cover(true)
    // THE PUBLISHER'S NEWER BUILD, OFFERED HERE (jwize, 2026-11-12: "Yes, add
    // it"). The update scout asks once per boot whether the signed channel has
    // moved past what runs here and says so on `update:available` (replayed to
    // a late listener). The hive's own update pill lives in chrome this page
    // does not show, so the bar carries the offer; the owner decides.
    this.#offUpdate ??= EffectBus.on<{ available?: boolean; packageSig?: unknown; source?: unknown }>('update:available', payload => {
      const sig = String(payload?.packageSig ?? '').toLowerCase()
      const fresh = payload?.available === true && payload.source === 'channel' && SIG_RE.test(sig) && sig !== install()?.installedSig()
      this.#offer = fresh ? sig : null
      this.#label()
    })
    void this.#show()
  }

  disconnectedCallback(): void {
    this.#ticket++
    this.#cover(false)
    clearTimeout(this.#failTimer)
    this.#offUpdate?.()
    this.#offUpdate = null
  }

  /** Take the offered package — exactly that signature, admitted by the gate
   *  the way every install is (the attester the installed package carries
   *  vouches for its publisher) — then start again on it. Its bytes come from
   *  the site's zone and from the hosts the offer was read from (the follow
   *  record's), as the Packages window takes an update: the zone may not carry
   *  the channel's newest root yet. */
  async #adopt(): Promise<void> {
    const sig = this.#offer
    const port = install()
    if (!sig || !port || this.#updating) return
    this.#updating = true
    this.#label()
    let failed = ''
    try {
      const outcome = await port.acquire(sig, updateSources(location.host))
      if (outcome.ok) { restartPage.run(); return }
      failed = outcome.error ?? ''
    } catch (error) {
      failed = error instanceof Error ? error.message : ''
    }
    this.#updating = false
    this.#label()
    // Said over the card for a moment, then the card's own note comes back —
    // its Try again included — unless the card has said something newer since.
    const said = t('site-manage.update-failed', 'The update did not complete. {reason}', { reason: failed }).trim()
    const card = this.#cardNote
    this.#paint(said, card.retry)
    clearTimeout(this.#failTimer)
    this.#failTimer = window.setTimeout(() => {
      if (this.#cardNote === card) this.#paint(card.text, card.retry)
    }, UPDATE_FAILED_MS)
  }

  // THE CARD COVERS THE CANVAS, as a takeover view does: it holds `view:active`
  // in the owner-counted ModeRegistry, so the hive's own surfaces stand aside —
  // the empty-layer prompt ("No tiles yet"), the command line and the controls —
  // and only the card, its bar and the chat are here.
  //
  // A view that holds `view:active` owns the Back press too (navigation/
  // view-back.ts traps it while any view is up), so the card says what Back
  // means here: leave the page, as it did before it covered anything — one
  // step back through the browser's history. `exact`: the hive's lineage under
  // the card is not the way out.
  #cover(on: boolean): void {
    if (this.#covering === on) return
    this.#covering = on
    if (on) {
      const claim = (): void => { if (this.#covering) modes()?.enter('view:active', SITE_MANAGE_OWNER) }
      const owns = (): void => {
        if (!this.#covering || this.#offBack) return
        this.#offBack = gesture()?.register({ owner: SITE_MANAGE_OWNER, exact: true, back: () => { history.back() } }) ?? null
      }
      // The way out first, so no Back press can find the claim without it.
      owns()
      if (!this.#offBack) ioc()?.whenReady?.('@diamondcoreprocessor.com/BackGesture', owns)
      claim()
      if (!modes()) ioc()?.whenReady?.('@diamondcoreprocessor.com/ModeRegistry', claim)
      return
    }
    modes()?.exit('view:active', SITE_MANAGE_OWNER)
    this.#offBack?.()
    this.#offBack = null
  }

  /** Read the published head and run its card. */
  async #show(): Promise<void> {
    const record = this.#record
    if (!record || !this.#frame) return
    const ticket = ++this.#ticket
    if (!record.head) { this.#say(t('site-manage.nothing', 'Nothing is published here yet.')); return }
    this.#say(t('site-manage.loading', 'Loading your card…'))
    const layerBytes = await this.#bytesOf(record.head)
    let layer: FrameLayer | null = null
    try { layer = layerBytes ? JSON.parse(new TextDecoder().decode(layerBytes)) as FrameLayer : null } catch { layer = null }
    if (ticket !== this.#ticket) return
    if (!layer) { this.#say(t('site-manage.cold', 'Your card is not on this device yet.'), true); return }
    const framed = await versionFrame(layer, [record.lineage], this.#reader).catch(() => null)
    if (ticket !== this.#ticket) return
    if (!framed || framed.problem === 'cold' || !framed.doc) {
      this.#say(framed?.problem === 'no-page'
        ? t('site-manage.nothing', 'Nothing is published here yet.')
        : t('site-manage.cold', 'Your card is not on this device yet.'), framed?.problem !== 'no-page')
      return
    }
    this.#say('')
    this.#frame.srcdoc = framed.doc
  }

  async #bytesOf(sig: string, localOnly = false): Promise<Uint8Array | null> {
    const kept = this.#bytes.get(sig)
    if (kept) return kept
    const asked = (localOnly ? 'here:' : 'any:') + sig
    if (this.#missing.has(asked)) return null
    const s = store()
    const blob = await (localOnly && s?.getResourceResolvedLocal ? s.getResourceResolvedLocal(sig) : s?.getResource(sig))?.catch(() => null)
    if (!blob) { this.#missing.add(asked); return null }
    if (blob.size > FRAME_MAX_ONE) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    this.#bytes.set(sig, bytes)
    return bytes
  }

  #build(): void {
    if (this.#built) return
    this.#built = true
    const root = document.createElement('div')
    root.className = 'sm'

    const frame = this.#frame = document.createElement('iframe')
    frame.className = 'sm-frame'
    // The card runs with scripts only: an opaque origin, no storage, no way to
    // the parent or the hive, and (its document says so) no network.
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('referrerpolicy', 'no-referrer')

    const bar = document.createElement('header')
    bar.className = 'sm-bar'
    const title = this.#title = document.createElement('span')
    title.className = 'sm-title'
    const chat = this.#chat = document.createElement('button')
    chat.type = 'button'
    chat.className = 'sm-btn sm-chat'
    // A command, never a state: transient, so it is not replayed to a late listener.
    chat.addEventListener('click', () => { EffectBus.emitTransient('chat:open', {}) })
    const back = this.#back = document.createElement('a')
    back.className = 'sm-btn'
    back.href = LEAVE_HREF
    const update = this.#update = document.createElement('button')
    update.type = 'button'
    update.className = 'sm-btn sm-update'
    update.hidden = true
    update.addEventListener('click', () => { void this.#adopt() })
    bar.append(title, update, chat, back)

    const note = this.#note = document.createElement('div')
    note.className = 'sm-note'
    note.setAttribute('role', 'status')
    const retry = this.#retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'sm-btn'
    retry.hidden = true
    retry.addEventListener('click', () => { this.#missing.clear(); void this.#show() })
    note.append(document.createElement('span'), retry)

    root.append(frame, bar, note)
    this.replaceChildren(root)
    this.#label()
    const words = ioc()?.get?.<EventTarget>(I18N_IOC_KEY)
    words?.addEventListener?.('change', () => this.#label())
  }

  /** The bar's words, in the person's language. */
  #label(): void {
    const record = this.#record
    if (this.#title && record) this.#title.textContent = t('site-manage.managing', 'Managing {title}', { title: record.title })
    if (this.#chat) this.#chat.textContent = t('site-manage.chat', 'Chat')
    if (this.#back) this.#back.textContent = t('site-manage.back', 'Back to the site')
    if (this.#retry) this.#retry.textContent = t('site-manage.retry', 'Try again')
    if (this.#update) {
      this.#update.hidden = !this.#offer
      this.#update.disabled = this.#updating
      this.#update.textContent = this.#updating ? t('site-manage.updating', 'Updating…') : t('site-manage.update', 'Update')
    }
    this.#frame?.setAttribute('title', record?.title ?? '')
  }

  /** The card's own state, said in the note. */
  #say(text: string, offerRetry = false): void {
    this.#cardNote = { text, retry: offerRetry }
    this.#paint(text, offerRetry)
  }

  #paint(text: string, offerRetry: boolean): void {
    if (!this.#note) return
    ;(this.#note.firstChild as HTMLElement).textContent = text
    this.#note.hidden = !text
    if (this.#retry) this.#retry.hidden = !offerRetry
  }
}

// The card fills the screen under everything the hive draws for you (the chat
// stacks at 100001 and above), with the bar over its top edge.
function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const T = SITE_MANAGE_SURFACE
  style.textContent = `
${T} { display: contents; }
${T} [hidden] { display: none !important; }
${T} .sm-frame { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 99990; background: #050505; }
${T} .sm-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 99991; display: flex; align-items: center; gap: 0.6rem;
  padding: 0.35rem 0.75rem; background: rgba(8, 10, 13, 0.82); color: #e8e8ea;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  font: 500 0.78rem/1.4 var(--hc-mono, ui-monospace, monospace); border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
${T} .sm-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c8975a; }
${T} .sm-btn {
  flex-shrink: 0; padding: 0.25rem 0.7rem; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06); color: #e8e8ea; font: inherit; cursor: pointer; text-decoration: none;
}
${T} .sm-btn:hover { background: rgba(255, 255, 255, 0.14); }
${T} .sm-chat { border-color: rgba(200, 151, 90, 0.6); }
${T} .sm-update { border-color: rgba(120, 200, 140, 0.7); color: #bfe8c8; }
${T} .sm-btn:disabled { opacity: 0.6; cursor: progress; }
${T} .sm-note {
  position: fixed; left: 50%; top: 3.2rem; transform: translateX(-50%); z-index: 99991; display: flex; align-items: center;
  gap: 0.6rem; padding: 0.45rem 0.8rem; border-radius: 4px; background: rgba(0, 0, 0, 0.78); color: #ddd;
  font: 0.8rem/1.4 system-ui, sans-serif;
}
`
  document.head.appendChild(style)
}
