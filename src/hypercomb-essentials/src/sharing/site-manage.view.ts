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
// THE CARD IS THE PAGE'S OWN TILE (jwize, 2026-11-13: "The whole idea is we
// are upgrading something that we replicated"). Once the bees are up, the
// published head comes into this page's hive as the tile at /<lineage> (the
// visit is the participant action; site-replica.ts), and the frame follows
// that tile LIVE: every marker written at its location re-runs the card, so
// what the chat changes shows as it lands. The bar says when the tile holds
// changes the site does not ("Unpublished changes", with Publish once the
// page's publish port is installed), and when a newer card was published over
// an edited one ("Use it" takes it; the edits stay one step back in history).
// The Chat opens on the card tile's own conversation.
//
// A dependency: it exports the element and registers nothing. The bee beside
// it (site-manage.drone.ts) defines it and adds it to the shell, only on a
// page that carries the record.
//
// MIRRORED: hypercomb-shim/src/bootstrap/manage-record.ts reads the same record
// (a module may not import the shim). Every field is untrusted page text.

import { EffectBus, I18N_IOC_KEY, INSTALL_IOC_KEY, requestConfirm, type I18nProvider, type InstallProvider } from '@hypercomb/core'
import { FRAME_MAX_ONE, versionFrame, type FrameReader, type FrameLayer } from '../history/revision-viewer.model.js'
// Whom builds follow here — the same record the scout read the offer from (the
// Packages window reads it the same way: host-directory.view.ts #follow).
import { readInstallFollow } from './update-scout.service.js'
import {
  BROKER_KEY, CHAT_THREADS_KEY, HISTORY_KEY, LINEAGE_KEY, MANAGED_PUBLISH_KEY, STORE_KEY, SWARM_ADOPT_KEY,
  notePublished, readState, reconcile, replicaConvoId, replicaLocation, takePublished, writeReceipt,
  type AdoptLike, type BrokerLike, type HistoryLike, type ManagedPublishLike, type ReplicaServices,
  type ReplicaSite, type ReplicaState, type StoreLike as ReplicaStoreLike,
} from './site-replica.js'

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
/** How long after a marker lands at the card's location before the card is
 *  read again: the marker is announced before the head moves (history.service
 *  emits, then sets the head), and a burst of commits is one re-read — the
 *  revision viewer's RELIST_MS. */
export const RELIST_MS = 300

/** The services the replica needs, once each is registered (the bees are up). */
function whenServices(): Promise<ReplicaServices> {
  const need = (key: string): Promise<unknown> => new Promise(resolve => {
    const held = ioc()?.get?.<unknown>(key)
    if (held) { resolve(held); return }
    ioc()?.whenReady?.(key, () => resolve(ioc()?.get?.<unknown>(key)))
  })
  return Promise.all([need(HISTORY_KEY), need(STORE_KEY), need(SWARM_ADOPT_KEY), need(BROKER_KEY), need(LINEAGE_KEY)])
    .then(([history, store, adopt, broker]) => ({
      history: history as HistoryLike,
      store: store as ReplicaStoreLike,
      adopt: adopt as AdoptLike,
      broker: broker as BrokerLike,
    }))
}

/** Where this door's bytes come from: the door, its zone, the followed hosts. */
const doorWhere = (): { host: string; zone: string; sources: string[] } =>
  ({ host: location.host, zone: managedSiteZone(location.host), sources: updateSources(location.host) })

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
  /** Where the replica stands in the bar: what it holds, and what to do about it. */
  #status: HTMLSpanElement | null = null
  #publish: HTMLButtonElement | null = null
  #useNewer: HTMLButtonElement | null = null
  /** The replica's services and its location bag, once the bees are up. */
  #services: ReplicaServices | null = null
  #loc: string | null = null
  #state: ReplicaState | null = null
  /** The head this page published, while the page record still names the old one. */
  #liveHead: string | null = null
  /** Why the card could not be brought in, said in the bar until it lands. */
  #refused = ''
  /** An adopt that deferred: the tile may still land, and its receipt is owed. */
  #replicaOwed = false
  #busy: '' | 'take' | 'publish' = ''
  /** Bumped on every disconnect, so a continuation of an earlier life stops. */
  #life = 0
  #offHistory: Array<() => void> = []
  #relist = 0

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
    void this.#begin()
  }

  disconnectedCallback(): void {
    this.#ticket++
    this.#life++
    this.#cover(false)
    clearTimeout(this.#failTimer)
    clearTimeout(this.#relist)
    this.#offUpdate?.()
    this.#offUpdate = null
    for (const off of this.#offHistory.splice(0)) off()
  }

  /** The site as the replica is judged against it: the record's head, or the
   *  head this page has since published. */
  #site(): ReplicaSite | null {
    const record = this.#record
    return record ? { lineage: record.lineage, head: this.#liveHead ?? record.head } : null
  }

  /** BRING THE CARD IN, THEN FOLLOW IT. Once the bees are up: the one decision
   *  of site-replica.ts reconcile (replicate on the first visit, take a newer
   *  publish over an unedited replica, or leave the choice to the owner), then
   *  every marker at the card's location re-reads it. */
  async #begin(): Promise<void> {
    const life = this.#life
    const record = this.#record
    if (!record) return
    const services = await whenServices()
    if (life !== this.#life) return
    this.#services = services
    let loc: string
    try { loc = await replicaLocation(services.history, record.lineage) } catch { return }
    if (life !== this.#life) return
    this.#loc = loc
    this.#follow(loc)
    const site = this.#site()
    if (!site) return
    // The adopt says WHY it refused on features:outcome (code it cannot take,
    // a closure it cannot reach). Listened to only while it runs; the bus's
    // replay of an older outcome is not this one.
    let armed = false
    let heard = ''
    const offOutcome = EffectBus.on<{ cell?: unknown; ok?: unknown; message?: unknown }>('features:outcome', outcome => {
      if (!armed || outcome?.ok !== false || outcome.cell !== record.lineage) return
      heard = typeof outcome.message === 'string' ? outcome.message : ''
    })
    armed = true
    let outcome: Awaited<ReturnType<typeof reconcile>>
    try { outcome = await reconcile(services, site, doorWhere()) } catch { outcome = { kind: 'refused', status: 'failed', pending: false } } finally { offOutcome() }
    if (life !== this.#life) return
    if (outcome.kind === 'refused') {
      this.#refused = t('site-manage.refused', 'Your card could not be brought onto this device. {reason}', { reason: heard || outcome.status }).trim()
      this.#replicaOwed = outcome.pending
    } else if (outcome.kind === 'take-failed') {
      this.#flash(t('site-manage.take-failed', 'The newer card could not be taken. {reason}', { reason: outcome.error }).trim())
    }
    await this.#refresh()
  }

  /** Re-read the card whenever its location gains a marker — a chat edit, an
   *  adopt that landed late, another tab's commit. */
  #follow(loc: string): void {
    for (const off of this.#offHistory.splice(0)) off()
    const later = (): void => {
      clearTimeout(this.#relist)
      this.#relist = window.setTimeout(() => { void this.#refresh() }, RELIST_MS)
    }
    const here = (payload: { lineageSig?: unknown } | null | undefined): void => { if (payload?.lineageSig === loc) later() }
    this.#offHistory.push(
      EffectBus.on<{ lineageSig?: unknown }>('history:marker-wrote', here),
      EffectBus.on<{ lineageSig?: unknown }>('history:head-external', here),
    )
  }

  /** Read where the replica stands, say it in the bar, and run the card. */
  async #refresh(): Promise<void> {
    const life = this.#life
    const services = this.#services
    const loc = this.#loc
    const site = this.#site()
    if (services && loc && site) {
      let state = await readState(services, site, loc).catch(() => null)
      if (life !== this.#life) return
      // A deferred adopt that has landed since: the card is here now, and its
      // receipt is the head it was taken from.
      if (state?.layer && this.#replicaOwed && site.head) {
        this.#replicaOwed = false
        this.#refused = ''
        await writeReceipt(services.store, site.lineage, site.head, state.sig)
        state = await readState(services, site, loc).catch(() => state)
        if (life !== this.#life) return
      }
      if (state?.layer) this.#refused = ''
      this.#state = state
      this.#label()
    }
    await this.#show()
  }

  /** "Use it": the newer published card replaces the replica; the edits it
   *  replaces stay one step back in history. */
  async #takeNewer(): Promise<void> {
    const services = this.#services
    const site = this.#site()
    if (!services || !site?.head || this.#busy) return
    this.#busy = 'take'
    this.#label()
    const taken = await takePublished(services, { ...site, head: site.head }, doorWhere())
      .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : '' }))
    this.#busy = ''
    if (!taken.ok) this.#flash(t('site-manage.take-failed', 'The newer card could not be taken. {reason}', { reason: taken.error }).trim())
    await this.#refresh()
  }

  /** PUBLISH: the owner's yes in the consent dialog, then the page's own
   *  publish port (its listed key) moves the site's root to this replica's head. */
  async #publishNow(): Promise<void> {
    const record = this.#record
    const services = this.#services
    const sig = this.#state?.sig
    const port = ioc()?.get?.<ManagedPublishLike>(MANAGED_PUBLISH_KEY)
    if (!record || !services || !sig || !port || this.#busy) return
    const yes = await requestConfirm({
      title: 'site-manage.publish-confirm.title',
      message: 'site-manage.publish-confirm.message',
      messageParams: { title: record.title },
      confirmLabel: 'site-manage.publish',
      cancelLabel: 'site-manage.publish-confirm.cancel',
      danger: false,
    })
    if (!yes || this.#busy) return
    const before = this.#site()
    this.#busy = 'publish'
    this.#label()
    let result: { ok: boolean; error?: string; head?: string }
    try { result = await port.publishRoot(record.lineage, sig) } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : '' }
    }
    this.#busy = ''
    if (result.ok) {
      const live = typeof result.head === 'string' && /^[0-9a-f]{64}$/.test(result.head) ? result.head : sig
      if (before) await notePublished(services.store, before, live, sig)
      this.#liveHead = live
      this.#flash(t('site-manage.published', 'Your card is live.'))
    } else {
      this.#flash(t('site-manage.publish-failed', 'The publish did not complete. {reason}', { reason: result.error ?? '' }).trim())
    }
    await this.#refresh()
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
    this.#flash(t('site-manage.update-failed', 'The update did not complete. {reason}', { reason: failed }).trim())
  }

  /** Said over the card for a moment, then the card's own note comes back —
   *  its Try again included — unless the card has said something newer since. */
  #flash(said: string): void {
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

  /** Run the card: the hive's own tile at /<lineage> once it holds one (so an
   *  edit shows as it lands), the published head while it does not. */
  async #show(): Promise<void> {
    const record = this.#record
    const frame = this.#frame
    if (!record || !frame) return
    const ticket = ++this.#ticket
    const local = this.#state?.layer ?? null
    if (!local && !record.head) { this.#say(t('site-manage.nothing', 'Nothing is published here yet.')); return }
    // A re-run over a card already shown says nothing: the frame stays as it is
    // until the new one is ready.
    if (!frame.srcdoc) this.#say(t('site-manage.loading', 'Loading your card…'))
    let layer: FrameLayer | null = local as FrameLayer | null
    if (!layer && record.head) {
      const layerBytes = await this.#bytesOf(record.head)
      try { layer = layerBytes ? JSON.parse(new TextDecoder().decode(layerBytes)) as FrameLayer : null } catch { layer = null }
    }
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
    // Only a card note that says something is cleared, so a passing flash
    // (published, a failed update) keeps its moment over a re-run.
    if (this.#cardNote.text || this.#cardNote.retry) this.#say('')
    if (frame.srcdoc !== framed.doc) frame.srcdoc = framed.doc
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
    // A command, never a state: transient, so it is not replayed to a late
    // listener. It opens on the card tile's own conversation, so the chat's
    // subject — and every change it makes — is the card.
    chat.addEventListener('click', () => {
      const lineage = this.#record?.lineage ?? ''
      const threads = ioc()?.get?.<{ tileConvoId?(segments: readonly string[]): string }>(CHAT_THREADS_KEY)
      EffectBus.emitTransient('chat:open', lineage ? { convoId: replicaConvoId(lineage, threads) } : {})
    })
    const back = this.#back = document.createElement('a')
    back.className = 'sm-btn'
    back.href = LEAVE_HREF
    const update = this.#update = document.createElement('button')
    update.type = 'button'
    update.className = 'sm-btn sm-update'
    update.hidden = true
    update.addEventListener('click', () => { void this.#adopt() })
    const status = this.#status = document.createElement('span')
    status.className = 'sm-state'
    status.setAttribute('role', 'status')
    status.hidden = true
    const useNewer = this.#useNewer = document.createElement('button')
    useNewer.type = 'button'
    useNewer.className = 'sm-btn sm-use-newer'
    useNewer.hidden = true
    useNewer.addEventListener('click', () => { void this.#takeNewer() })
    const publish = this.#publish = document.createElement('button')
    publish.type = 'button'
    publish.className = 'sm-btn sm-publish'
    publish.hidden = true
    publish.addEventListener('click', () => { void this.#publishNow() })
    bar.append(title, status, useNewer, publish, update, chat, back)

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
    // The publish port may arrive after the card: Publish shows when it does.
    if (!ioc()?.get?.(MANAGED_PUBLISH_KEY)) ioc()?.whenReady?.(MANAGED_PUBLISH_KEY, () => this.#label())
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
    const state = this.#state
    if (this.#status) {
      // One line: why the card is not here, else a newer card waiting, else
      // changes the site does not have yet.
      const said = this.#refused
        || (state?.newer ? t('site-manage.newer', 'A newer card is published.') : '')
        || (state?.unpublished ? t('site-manage.unpublished', 'Unpublished changes') : '')
      this.#status.textContent = said
      this.#status.hidden = !said
    }
    if (this.#useNewer) {
      this.#useNewer.hidden = !state?.newer
      this.#useNewer.disabled = this.#busy !== ''
      this.#useNewer.textContent = this.#busy === 'take' ? t('site-manage.taking', 'Taking it…') : t('site-manage.use-newer', 'Use it')
    }
    if (this.#publish) {
      const port = ioc()?.get?.<ManagedPublishLike>(MANAGED_PUBLISH_KEY)
      this.#publish.hidden = !state?.unpublished || typeof port?.publishRoot !== 'function'
      this.#publish.disabled = this.#busy !== ''
      this.#publish.textContent = this.#busy === 'publish' ? t('site-manage.publishing', 'Publishing…') : t('site-manage.publish', 'Publish')
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
${T} .sm-publish { border-color: rgba(120, 200, 140, 0.7); color: #bfe8c8; }
${T} .sm-state { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e3c48f; }
${T} .sm-btn:disabled { opacity: 0.6; cursor: progress; }
${T} .sm-note {
  position: fixed; left: 50%; top: 3.2rem; transform: translateX(-50%); z-index: 99991; display: flex; align-items: center;
  gap: 0.6rem; padding: 0.45rem 0.8rem; border-radius: 4px; background: rgba(0, 0, 0, 0.78); color: #ddd;
  font: 0.8rem/1.4 system-ui, sans-serif;
}
`
  document.head.appendChild(style)
}
