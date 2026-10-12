// sharing/share-ask.worker.ts
//
// ASK, PER PAGE, ONCE (jwize 2026-10-10, option b). Joining a swarm shares
// what you make there; the tiles that were already in your hive stay private.
// This worker asks about those — one line, about the page you stand on, after
// that page has been announced to the room:
//
//   "Share the 12 tiles on this page with downtown?"   [Share] [Not now]
//
// - The count is exactly what SwarmDrone.offerPrivateHere would flip here
//   (privateToOfferHere: own tiles still private, collection items, hidden
//   tiles and the sets page left out). Tiles made in the meeting are public
//   already, so they are never counted. A count of 0 asks nothing.
// - Share runs offerPrivateHere and nothing else: tile by tile, names only,
//   and the walk that follows shares and uploads them like any tile made in
//   the meeting.
// - Not now, the ×, or the line timing out change nothing, and that page is
//   not asked again in this meeting — not after a reload either. The memory
//   is this tab's sessionStorage: digests of (zone, page lineage key), never
//   the secret, never a name. A new meeting (another zone) asks again.
// - Only an ANSWER uses a page's ask up. A line taken down before it was
//   answered — you walked to another page, left the meeting, or the tab went
//   to the background — asks again: when you come back to the page, rejoin,
//   or look at the tab again. A line is never shown to a hidden tab.
// - It never delays the join: it waits for SwarmDrone's
//   `swarm:page-announced` (sent once the page's word is in the room), then
//   for idle time, and reads the names locally. Nothing is sealed or uploaded
//   before Share. Navigating takes the line down at once (the Lineage
//   `change`), before the next page is announced.
// - The count and the names go into no event payload of this worker's, no
//   log, pool or resource. The line itself shows the count; it is sent
//   transiently, so the bus keeps no copy for late subscribers.

import { EffectBus, I18N_IOC_KEY, SignatureService, Worker, get, lineageKey, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere } from './membership.js'

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const TOAST_KEY = '@diamondcoreprocessor.com/ToastDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const SIGNATURE_STORE_KEY = '@hypercomb/SignatureStore'

/** This tab's decided pages — digests of (zone, page), nothing readable. */
export const SHARE_ASKED_KEY = 'hc:share-asked'
const ASKED_MAX = 256
/** The line's two buttons answer here; the payload is an opaque ask id. */
export const SHARE_ASK_ANSWER = 'swarm:share-ask'
/** How long the line stays up before it times out (= Not now). */
export const SHARE_ASK_DURATION_MS = 15_000
const IDLE_TIMEOUT_MS = 2_000
const IDLE_FALLBACK_MS = 200

interface SwarmLike {
  currentSegments?: () => readonly string[]
  privateToOfferHere?: () => Promise<number | null>
  offerPrivateHere?: () => Promise<number>
}
interface LineageLike {
  explorerSegments?: () => readonly string[]
  addEventListener?: (type: string, fn: () => void) => void
  removeEventListener?: (type: string, fn: () => void) => void
}
interface ValueStore { value?: unknown }
interface SignatureStoreLike { signText?: (text: string) => Promise<string> }
interface ToastLike { id: number; fading?: boolean; actions?: readonly { payload?: unknown }[] }
interface ToastsLike { toasts?: readonly ToastLike[] }
/** A line on screen: which page, in which meeting. `seen` once the toast
 *  surface has it up — its going away after that is the × or the timeout. */
interface Ask { id: string; page: string; digest: string; seen: boolean; timer: ReturnType<typeof setTimeout> | null }
/** A consideration waiting for idle time. */
interface Pass { page: string; cancel: () => void }

const encoder = new TextEncoder()

/** Run `cb` when the page is idle (bounded); returns the cancel. */
const whenIdle = (cb: () => void): (() => void) => {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof g.requestIdleCallback === 'function') {
    const id = g.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS })
    return () => g.cancelIdleCallback?.(id)
  }
  const t = setTimeout(cb, IDLE_FALLBACK_MS)
  return () => clearTimeout(t)
}

const segmentsOf = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : []).map(s => String(s ?? '').trim()).filter(Boolean)

/** Nobody is looking at this tab: a line shown now would time out unseen. */
const tabHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden'

const isMine = (toast: ToastLike, ask: Ask): boolean =>
  (toast.actions ?? []).some(a => (a?.payload as { ask?: unknown } | undefined)?.ask === ask.id)

export class ShareAskWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'When this tab is in a swarm, asks once per page whether to share the tiles on it that were private before the meeting.'

  protected override listens = ['mesh:public-changed', 'swarm:page-announced', SHARE_ASK_ANSWER, 'toast:state']
  protected override emits = ['toast:show', 'toast:dismiss']

  #ask: Ask | null = null
  #pass: Pass | null = null
  /** A page whose ask waits for the tab to be looked at again. */
  #deferred: string | null = null
  /** Bumped by every consideration and every cancel — the newest one wins. */
  #seq = 0
  #nextId = 0
  #lineage: LineageLike | null = null
  #watchingVisibility = false

  protected override act = async (): Promise<void> => {
    this.onEffect<{ public?: boolean }>('mesh:public-changed', (p) => {
      if (p?.public !== true) this.#cancel()
    })
    this.onEffect<{ segments?: unknown }>('swarm:page-announced', (p) => this.#onAnnounced(segmentsOf(p?.segments)))
    this.onEffect<{ ask?: unknown; share?: unknown }>(SHARE_ASK_ANSWER, (p) => { void this.#onAnswer(p) })
    this.onEffect<ToastsLike>('toast:state', (p) => this.#onToasts(p))
    this.#hookLineage()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#onVisibility)
      this.#watchingVisibility = true
    }
  }

  protected override dispose = (): void => {
    this.#cancel()
    this.#lineage?.removeEventListener?.('change', this.#onNavigated)
    this.#lineage = null
    if (this.#watchingVisibility) document.removeEventListener('visibilitychange', this.#onVisibility)
    this.#watchingVisibility = false
  }

  /** Navigation is the Lineage's `change` — heard at once, long before the
   *  next page is announced. Hooked when the Lineage is there (at act, else
   *  at the first announce, which an ask always follows). */
  #hookLineage = (): void => {
    if (this.#lineage) return
    const lineage = get<LineageLike>(LINEAGE_KEY)
    if (typeof lineage?.addEventListener !== 'function') return
    lineage.addEventListener('change', this.#onNavigated)
    this.#lineage = lineage
  }

  /** Walked to another page: what waits or shows for the one left goes,
   *  unanswered — that page asks again when you come back. */
  #onNavigated = (): void => {
    const page = this.#pageArrived()
    if (page === null) return
    if ((this.#ask && this.#ask.page !== page) || (this.#pass && this.#pass.page !== page)
      || (this.#deferred !== null && this.#deferred !== page)) this.#cancel()
  }

  #onAnnounced = (segments: string[]): void => {
    this.#hookLineage()
    if (!isJoinedHere()) return
    const page = lineageKey(segments)
    // Walked to another page: what was asked about the one you left goes.
    if ((this.#ask && this.#ask.page !== page) || (this.#pass && this.#pass.page !== page)) this.#cancel()
    // A heartbeat's re-announce while this page is already waiting its turn.
    if (this.#pass) return
    if (segments[0] === 'sets') return
    this.#schedule(page)
  }

  #schedule = (page: string): void => {
    const pass: Pass = { page, cancel: () => undefined }
    pass.cancel = whenIdle(() => {
      if (this.#pass === pass) this.#pass = null
      void this.#consider(page).catch(() => undefined)
    })
    this.#pass = pass
  }

  #consider = async (page: string): Promise<void> => {
    const seq = ++this.#seq
    const current = (): boolean => seq === this.#seq && isJoinedHere() && this.#pageHere() === page
    if (!current()) return
    // Nobody looking: asked when the tab is looked at again, never unseen.
    if (tabHidden()) { this.#deferred = page; return }
    const swarm = get<SwarmLike>(SWARM_KEY)
    if (typeof swarm?.privateToOfferHere !== 'function' || typeof swarm.offerPrivateHere !== 'function') return
    const zone = this.#zone()
    if (!zone) return
    const digest = await this.#digest(zone.room, zone.secret, page)
    if (!current()) return
    if (this.#ask) {
      // This line is up now, not answered yet.
      if (this.#ask.digest === digest) return
      // The same page in another meeting: the old line goes, this one asks.
      this.#drop(this.#ask)
    }
    if (this.#asked().includes(digest)) return
    const count = await swarm.privateToOfferHere()
    if (!current()) return
    // Unknown (the page could not be read yet): nothing decided — the next
    // announce of this page tries again.
    if (count === null) return
    // Nothing to offer here: decided for this page in this meeting — a tile
    // made private on purpose later is never asked about by a heartbeat.
    if (!(count > 0)) { this.#remember(digest); return }
    // No surface to show the line on: not asked — the next announce tries.
    if (!this.#surface()) return
    if (tabHidden()) { this.#deferred = page; return }
    this.#show(page, digest, count, zone.room)
  }

  #show = (page: string, digest: string, count: number, room: string): void => {
    const ask: Ask = { id: `${Date.now().toString(36)}.${++this.#nextId}`, page, digest, seen: false, timer: null }
    this.#ask = ask
    const i18n = get<I18nProvider>(I18N_IOC_KEY)
    const say = (key: string, fallback: string, params?: Record<string, string | number>): string => {
      // A catalog older than this module answers a missing key with the key.
      const value = i18n?.t(key, params)
      return value && value !== key ? value : fallback
    }
    EffectBus.emitTransient('toast:show', {
      type: 'info',
      message: say('swarm.share.ask',
        count === 1 ? `Share the 1 tile on this page with ${room}?` : `Share the ${count} tiles on this page with ${room}?`,
        { count, room }),
      duration: SHARE_ASK_DURATION_MS,
      actions: [
        { label: say('swarm.share.ask.share', 'Share'), effect: SHARE_ASK_ANSWER, payload: { ask: ask.id, share: true }, kind: 'primary' },
        { label: say('swarm.share.ask.not-now', 'Not now'), effect: SHARE_ASK_ANSWER, payload: { ask: ask.id, share: false }, kind: 'secondary' },
      ],
    })
    // Timed out = Not now — by this worker's own clock too, whatever surface
    // shows the line.
    ask.timer = setTimeout(() => {
      if (this.#ask !== ask) return
      this.#decide(ask)
      this.#dismiss(ask)
    }, SHARE_ASK_DURATION_MS)
  }

  /** The toast surface took the line down without a button: the × or its
   *  own timeout — both are Not now. */
  #onToasts = (p: ToastsLike | undefined): void => {
    const ask = this.#ask
    if (!ask) return
    const toast = (p?.toasts ?? []).find(t => isMine(t, ask))
    if (toast && !toast.fading) { ask.seen = true; return }
    if (ask.seen) this.#decide(ask)
  }

  #onAnswer = async (p: { ask?: unknown; share?: unknown } | undefined): Promise<void> => {
    const ask = this.#ask
    if (!ask || p?.ask !== ask.id) return
    this.#settle(ask)
    if (p.share !== true) { this.#remember(ask.digest); return }
    // Still this meeting, still this page — else the tap is about a place
    // this tab has left: nothing is shared, and nothing is used up, so the
    // page asks again when you are back.
    if (!isJoinedHere()) return
    const zone = this.#zone()
    const swarm = get<SwarmLike>(SWARM_KEY)
    if (!zone || typeof swarm?.offerPrivateHere !== 'function') return
    if (this.#pageHere() !== ask.page) return
    let digest = ''
    try { digest = await this.#digest(zone.room, zone.secret, ask.page) } catch { return }
    if (digest !== ask.digest || !isJoinedHere() || this.#pageHere() !== ask.page) return
    this.#remember(ask.digest)
    try { await swarm.offerPrivateHere() } catch { /* the status line's Share is still there */ }
  }

  #onVisibility = (): void => {
    if (tabHidden()) {
      // A line on a tab nobody looks at goes, unanswered, and asks again
      // when the tab is back.
      const ask = this.#ask
      if (ask) { this.#drop(ask); this.#deferred = ask.page }
      return
    }
    const page = this.#deferred
    this.#deferred = null
    if (page !== null && !this.#pass && !this.#ask && isJoinedHere() && this.#pageHere() === page) this.#schedule(page)
  }

  /** Answered (a button, the ×, or the timeout): this page is decided for
   *  this meeting. */
  #decide = (ask: Ask): void => {
    this.#settle(ask)
    this.#remember(ask.digest)
  }

  /** The line stops being this worker's — before anything takes it down, so
   *  its going away is not read as an answer. */
  #settle = (ask: Ask): void => {
    if (ask.timer !== null) clearTimeout(ask.timer)
    ask.timer = null
    if (this.#ask === ask) this.#ask = null
  }

  /** Take a line down UNANSWERED: nothing is remembered. */
  #drop = (ask: Ask): void => {
    this.#settle(ask)
    this.#dismiss(ask)
  }

  /** Drop what is waiting and take down what is showing — unanswered. */
  #cancel = (): void => {
    this.#seq++
    this.#pass?.cancel()
    this.#pass = null
    this.#deferred = null
    if (this.#ask) this.#drop(this.#ask)
  }

  #dismiss = (ask: Ask): void => {
    for (const t of get<ToastsLike>(TOAST_KEY)?.toasts ?? []) {
      if (isMine(t, ask)) this.emitEffect('toast:dismiss', { id: t.id })
    }
  }

  /** Something shows toasts. `EffectBus.listens` is newer than some shells'
   *  vendored core; without it, the toast drone in IoC answers. */
  #surface = (): boolean => {
    const bus = EffectBus as { listens?: (effect: string) => boolean }
    return typeof bus.listens === 'function' ? bus.listens('toast:show') : !!get(TOAST_KEY)
  }

  /** Where the participant stands (the Lineage) — null when it is not there. */
  #pageArrived = (): string | null => {
    const lineage = this.#lineage ?? get<LineageLike>(LINEAGE_KEY)
    if (typeof lineage?.explorerSegments !== 'function') return null
    return lineageKey(segmentsOf(lineage.explorerSegments()))
  }

  /** The page this tab stands on: where the swarm stands (what
   *  offerPrivateHere offers), and only while the participant stands there
   *  too — mid-navigation the two differ and no page is here. */
  #pageHere = (): string => {
    const page = lineageKey(segmentsOf(get<SwarmLike>(SWARM_KEY)?.currentSegments?.()))
    const arrived = this.#pageArrived()
    return arrived === null || arrived === page ? page : '\0moving'
  }

  #zone = (): { room: string; secret: string } | null => {
    const room = String(get<ValueStore>(ROOM_KEY)?.value ?? '').trim()
    const secret = String(get<ValueStore>(SECRET_KEY)?.value ?? '').trim()
    return room && secret ? { room, secret } : null
  }

  /** One digest names (meeting, page) — signed the way the swarm signs its
   *  addresses (the SignatureStore, else the core primitive). The secret
   *  never leaves this call. */
  #digest = async (room: string, secret: string, page: string): Promise<string> => {
    const text = `share-ask\0${room}\0${secret}\0${page}`
    const store = get<SignatureStoreLike>(SIGNATURE_STORE_KEY)
    if (typeof store?.signText === 'function') return store.signText(text)
    const bytes = encoder.encode(text)
    return SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  }

  #asked = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(SHARE_ASKED_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch { return [] }
  }

  #remember = (digest: string): void => {
    const list = this.#asked().filter(d => d !== digest)
    list.push(digest)
    try { sessionStorage.setItem(SHARE_ASKED_KEY, JSON.stringify(list.slice(-ASKED_MAX))) } catch { /* this page only */ }
  }
}

const _shareAsk = new ShareAskWorker()
window.ioc.register('@diamondcoreprocessor.com/ShareAskWorker', _shareAsk)
