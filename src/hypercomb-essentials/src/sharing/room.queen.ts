// sharing/room.queen.ts
//
// `room` — the room's own word (documentation/swarm-pools.md, step six).
//
//   room                       what this room asks of whoever joins, and where
//                              "take home" sends what you collected
//   room asks notes keep-alive the selected tile — the room's tile — asks for
//                              these behaviours (`room asks ~ keep-alive` drops
//                              one, `room asks =` asks for nothing)
//   room home                  take home the selected tile (else the room's
//                              tile here) to your own hive
//   room home <address>        your own hive is at <address> — remembered on
//                              this device, asked for once
//   room start                 the session starts: everyone who has been in
//                              this room is told, with a Join button
//   room list                  the rooms this device remembers (it hears their
//                              start notices)
//   room forget <room>         stop remembering a room on this device
//   room host <domain>         put this room at the top of <domain>'s front
//                              page — "Join the swarm" — for anyone who
//                              opens it (`room host off <domain>` takes it
//                              down; `@<host>` names the host that keeps the
//                              card, else your public host)
//
// What a room asks rides the room tile's layer (`asks`, room-asks.ts); on
// arrival each asked word is offered to be turned on (room-asks.drone.ts).
// Taking home hands the tile to your own hive by signature (take-home.ts).
// A start notice is posted at the room's notice address on its meeting point
// (room-notice.ts) and re-posted while you stay in the room; room-notice.drone.ts
// does both, and hears it on every device that remembers the room.
// The front-page button is the room's sealed link (swarm-door-landing.ts
// sealedRoomLink) carried on the domain's signed card (host-welcome.ts):
// public by design — it hides the room and its secret, it does not keep them.

import { EffectBus, QueenBee, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { ROOM_ASKS_SLOT, applyAsks, currentRoomAsks, readAsks } from './room-asks.js'
import { readHome, takeBundle, takeClosure, takeLinkText, writeHome } from './take-home.js'
import { isJoinedHere, ownZone, readTabZone } from './membership.js'
import { readRememberedRooms, withoutRoom } from './room-notice.js'
import { saveRememberedRooms } from './meeting-invite.join.js'
import { guestsCanReach, landingOrigin, sealedRoomLink } from './swarm-door-landing.js'
import { publishWelcome, readOwnWelcome, shownRoom, welcomeSwarm, welcomeZone, type FrontPageRoom } from './host-welcome.js'

/** The toast's button opens the home hive INSIDE its own click — the upload
 *  before it takes too long for the word's own keypress to still count. */
export const TAKE_HOME_OPEN_EFFECT = 'take-home:open'

type HistoryShape = {
  sign(l: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  warmHeadSigFor(sig: string): string | null
}
type CommitterShape = { update(segments: readonly string[], layer: { name?: string; [slot: string]: unknown }, nameSlots?: ReadonlySet<string>): Promise<string> }
type StoreShape = { getResourceLocal?(sig: string): Promise<Blob | null> }
type HostSyncShape = {
  publicHostDomain?(): string | null | undefined
  putOne?(host: string, sig: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; reason: string }>
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>): Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}
type MeshShape = { meetingRelay?: () => string }
type NoticeShape = { announce?: (room: string, secret: string, relay: string, label: string, segments: readonly string[]) => Promise<boolean> }
type SwarmShape = { peerTilesAtCurrentSig?: () => readonly { name: string; layerSig?: unknown; template?: boolean }[] }

const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
/** Where a front-page link lands when the room's host has no swarm door. */
const APP_ORIGIN = 'https://hypercomb.io'
// A door holds a publisher's index a few seconds (worker.js INDEX_EDGE_SECONDS):
// a read-back that does not show a card just signed reads once more after it.
const READ_BACK_AGAIN_MS = 6_000

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

const sha256 = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))]
    .map(b => b.toString(16).padStart(2, '0')).join('')

EffectBus.on<{ url?: unknown }>(TAKE_HOME_OPEN_EFFECT, (payload) => {
  const url = typeof payload?.url === 'string' ? payload.url : ''
  if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener')
})

export class RoomQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'room'
  override description = 'What this room asks of whoever joins, and taking home what you collected'
  override descriptionKey = 'slash.room'
  override options = ['asks <behaviours>', 'asks ~ <behaviour>', 'home', 'home <address>', 'start', 'list', 'forget <room>', 'host <domain>', 'host off <domain>']
  override examples = [
    { input: 'room', result: 'Says what this room asks and where take home sends' },
    { input: 'room asks notes keep-alive', result: 'The selected room tile asks joiners for notes and keep-alive' },
    { input: 'room home', result: 'Takes the room tile you collected home to your own hive' },
    { input: 'room home hypercomb.io', result: 'Your own hive is at hypercomb.io' },
    { input: 'room start', result: 'Tells everyone who has been in this room that the session is starting' },
    { input: 'room list', result: 'Shows the rooms this device remembers' },
    { input: 'room forget lecture', result: 'This device stops remembering the room "lecture"' },
    { input: 'room host example.com', result: 'example.com\'s front page shows "Join the swarm" for this room' },
    { input: 'room host off example.com', result: 'Takes the button off example.com\'s front page' },
  ]

  // What a room asks ARE behaviour words (`keep-alive`), and the command line
  // runs every behaviour word on a line — so the whole line is this word's.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const text = String(args ?? '').trim()
    const [verb, ...rest] = text.split(/\s+/)
    const tail = rest.join(' ')
    if (!verb) return this.#show()
    if (verb === 'asks') return this.#asks(tail)
    if (verb === 'home') return tail ? this.#setHome(tail) : this.#takeHome()
    if (verb === 'start') return this.#start()
    if (verb === 'list') return this.#list()
    if (verb === 'forget') return this.#forget(tail)
    if (verb === 'host') return this.#host(tail)
    this.#say(this.#t('room.usage.hosting', 'room — say "room", "room asks <behaviours>", "room home", "room start", "room list", "room forget <room>" or "room host <domain>"'), 'warning')
  }

  // ── what the room asks ──────────────────────────────────────

  async #show(): Promise<void> {
    const asked = await currentRoomAsks()
    const home = readHome()
    const lines = [
      asked.length
        ? this.#t('room.asks.list', `This room asks for: ${asked.join(', ')}`, { words: asked.join(', ') })
        : this.#t('room.asks.none', 'This room asks for nothing'),
      home
        ? this.#t('room.home.at', `Take home sends to ${home}`, { home })
        : this.#t('room.home.unset', 'Take home needs your hive\'s address once — room home <address>'),
    ]
    this.#say(lines.join('\n'))
  }

  async #asks(args: string): Promise<void> {
    const tile = this.#selectedTile()
    if (!tile) { this.#say(this.#t('room.asks.select', 'room asks: select the room\'s tile first'), 'warning'); return }
    const segments = [...this.#here(), tile]
    const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterShape>('@diamondcoreprocessor.com/LayerCommitter')
    if (!history || !committer) return
    const prior = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
    const next = applyAsks(readAsks(prior), args)
    // Only the asks slot travels: the commit hydrates the LIVE head, so a
    // concurrent write to the room tile is kept, and an empty list ([])
    // clears the slot (a deleted key was "not mentioned" and did nothing).
    await committer.update(segments, { name: tile, [ROOM_ASKS_SLOT]: next }, new Set())
    // A shared tile's word is re-announced on `notes:changed`, so the room
    // sees what it asks as soon as it sees anything else of the tile.
    EffectBus.emit('notes:changed', { segments: [...segments] })
    this.#say(next.length
      ? this.#t('room.asks.set', `"${tile}" asks joiners for: ${next.join(', ')}`, { tile, words: next.join(', ') })
      : this.#t('room.asks.cleared', `"${tile}" asks joiners for nothing`, { tile }), 'success')
  }

  // ── take home ───────────────────────────────────────────────

  #setHome(address: string): void {
    if (!writeHome(address)) {
      this.#say(this.#t('room.home.bad', `"${address}" is not an address a hive opens at`, { address }), 'warning')
      return
    }
    this.#say(this.#t('room.home.set', `Take home sends to ${readHome()}`, { home: readHome() }), 'success')
  }

  async #takeHome(): Promise<void> {
    const home = readHome()
    if (!home) {
      EffectBus.emit('search:prefill', { value: 'room home ', focus: true })
      this.#say(this.#t('room.home.ask', 'Where is your own hive? Type its address after "room home" — it is remembered on this device'), 'info')
      return
    }
    const tile = this.#selectedTile() ?? this.#roomTile()
    if (!tile) { this.#say(this.#t('room.home.nothing', 'Nothing here to take home — select the tile you collected'), 'warning'); return }
    const host = this.#roomHost()
    if (!host) { this.#say(this.#t('room.home.no-host', 'Take home needs the room\'s host — join a room that names one'), 'warning'); return }

    const segments = [...this.#here(), tile]
    const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreShape>('@hypercomb.social/Store')
    const hostSync = get<HostSyncShape>('@diamondcoreprocessor.com/HostSyncService')
    if (!history || !store?.getResourceLocal || !hostSync?.publishAtoms || !hostSync.putOne) return
    const location = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(location)
    const rootSig = history.warmHeadSigFor(location) ?? ''
    if (!layer || !/^[0-9a-f]{64}$/.test(rootSig)) {
      this.#say(this.#t('room.home.not-yours', `"${tile}" is not in your hive yet — take it, or write on it, first`, { tile }), 'warning')
      return
    }
    const pubkey = await this.#pubkey()
    if (!pubkey) { this.#say(this.#t('room.home.no-key', 'Take home needs your key — it signs what goes to the host'), 'warning'); return }

    this.#say(this.#t('room.home.sending', `Taking "${tile}" home…`, { tile }))
    const bytesOf = async (sig: string): Promise<Uint8Array | null> => {
      try { const blob = await store.getResourceLocal!(sig); return blob ? new Uint8Array(await blob.arrayBuffer()) : null } catch { return null }
    }
    const closure = await takeClosure(rootSig, bytesOf)
    const sent = await hostSync.publishAtoms(host, closure, bytesOf)
    if (!sent.ok) { this.#say(this.#t('room.home.refused', `The room's host did not take it: ${sent.error}`, { detail: sent.error }), 'error'); return }
    const bundle = new TextEncoder().encode(JSON.stringify(takeBundle(tile, rootSig, host, pubkey)))
    const sig = await sha256(bundle)
    const put = await hostSync.putOne(host, sig, bundle)
    if (!put.ok) { this.#say(this.#t('room.home.refused', `The room's host did not take it: ${put.reason}`, { detail: put.reason }), 'error'); return }

    const url = takeLinkText(home, sig, host)
    EffectBus.emit('toast:show', {
      type: 'success',
      title: this.#t('room.home.title', 'Take home'),
      message: this.#t('room.home.ready', `"${tile}" is ready in your hive at ${home}`, { tile, home }),
      duration: 0,
      actionLabel: this.#t('room.home.open', 'Open my hive'),
      actionEffect: TAKE_HOME_OPEN_EFFECT,
      actionPayload: { url },
    })
  }

  // ── the session starts ──────────────────────────────────────

  async #start(): Promise<void> {
    const zone = ownZone()
    const relay = String(get<MeshShape>('@diamondcoreprocessor.com/NostrMeshDrone')?.meetingRelay?.() ?? '').trim()
    const notice = get<NoticeShape>('@diamondcoreprocessor.com/RoomNoticeDrone')
    if (!zone || !relay || !isJoinedHere() || !notice?.announce) {
      this.#say(this.#t('room.start.not-joined', 'room start: join your room first — the notice goes to its meeting point'), 'warning')
      return
    }
    const here = this.#here()
    const label = here.length ? `${zone.room} — /${here.join('/')}` : zone.room
    const taken = await notice.announce(zone.room, zone.secret, relay, label, here)
    this.#say(taken
      ? this.#t('room.start.sent', `The session in "${zone.room}" has started — everyone who has been here is told`, { room: zone.room })
      : this.#t('room.start.unsent', 'The meeting point did not take the notice — try again in a moment'), taken ? 'success' : 'warning')
  }

  // ── the room on a domain's front page ───────────────────────

  /** `room host <domain>`: this room's sealed link at the top of the domain's
   *  front page, kept on its signed card with the card's title and tagline as
   *  they were. `room host off <domain>`: the card without it. Anyone who opens
   *  the page can join — it is a public room whose words are hidden, not kept
   *  (jwize 2026-10-24). */
  async #host(args: string): Promise<void> {
    const words = args.split(/\s+/).filter(Boolean)
    const off = words[0]?.toLowerCase() === 'off'
    const rest = off ? words.slice(1) : words
    const domain = welcomeZone(rest.find(w => !w.startsWith('@')) ?? '')
    if (!domain) {
      this.#say(this.#t('room.host.say', 'room host: name the domain whose front page shows the room — room host example.com'), 'warning')
      return
    }
    const sync = get<HostSyncShape>(HOST_SYNC_KEY)
    const cardHost = (rest.find(w => w.startsWith('@'))?.slice(1) || String(sync?.publicHostDomain?.() ?? '')).trim().toLowerCase()
    if (!cardHost) {
      this.#say(this.#t('room.host.no-host', 'room host: say which host keeps your signed card — room host <domain> @<host>'), 'warning')
      return
    }
    // A card that could not be read is never taken for no card: a word that
    // sets one field must not write blanks over the others.
    const own = await readOwnWelcome(cardHost, domain)
    if (own.state === 'unknown') {
      this.#say(this.#t('room.host.unread', `${domain}'s card could not be read (${own.reason}) — nothing was changed`, { domain, reason: own.reason }), 'warning')
      return
    }
    const held = own.state === 'card' ? own.card : null

    if (off) {
      const mine = held?.swarm ?? ''
      if (mine) {
        const done = await publishWelcome(cardHost, domain, held!.title, held!.tagline, '')
        if (!done.ok) { this.#say(this.#t('room.host.failed', `${domain}'s front page was not changed: ${done.reason}`, { domain, reason: done.reason }), 'warning'); return }
      }
      // What the page itself shows is the answer, never what was signed.
      const { at, page } = mine ? await this.#readBack(domain, swarm => !swarm) : await shownRoom(domain)
      if (!page.read) {
        this.#say(mine
          ? this.#t('room.host.off-unchecked', `Your room is off ${domain}'s card — ${at} could not be reached to check`, { domain, at })
          : this.#t('room.host.none-unchecked', `Your card for ${domain} carries no room — ${at} could not be reached to check`, { domain, at }), 'warning')
        return
      }
      // Whose room a page shows is not known here — the same login is the
      // same link on anyone's card — only whether your card carries it.
      if (page.swarm) {
        this.#say(mine && page.swarm === mine
          ? this.#t('room.host.still-mine', `${at} still shows this room — a publisher ahead of you may carry it too, or its door reads your card from a host other than ${cardHost}`, { at, host: cardHost })
          : this.#t('room.host.still-shown', `${at} shows a room your card on ${cardHost} does not carry — another publisher's, or your card on another host`, { at, host: cardHost }), 'warning')
        return
      }
      if (mine && !page.card) {
        this.#say(this.#t('room.host.off-uncarded', `Your room is off your card for ${domain} — ${at} shows no card of yours, so it never showed it`, { domain, at }), 'success')
        return
      }
      this.#say(mine
        ? this.#t('room.host.off', `${at} no longer shows the room`, { at })
        : this.#t('room.host.none', `${at} shows no room — there is none to take off`, { at }), mine ? 'success' : 'warning')
      return
    }

    const zone = ownZone()
    const relay = String(get<MeshShape>('@diamondcoreprocessor.com/NostrMeshDrone')?.meetingRelay?.() ?? '').trim()
    if (!zone || !relay || !isJoinedHere()) {
      this.#say(this.#t('room.host.not-joined', 'room host: join the room you want on the front page first'), 'warning')
      return
    }
    if (!guestsCanReach(relay)) {
      this.#say(this.#t('room.host.local', 'room host: this room meets on a local meeting point no visitor can reach — nothing was changed'), 'warning')
      return
    }
    // A front page is opened by strangers: the link lands on the room's own
    // swarm door, else on the app — never on whatever page this hive stands on
    // (a staging copy, a tunnel, this machine).
    const landing = (host: string): Promise<string> => landingOrigin(host, APP_ORIGIN)
    const tab = readTabZone()
    const code = tab?.code && tab.relay === relay ? tab.code : undefined
    const link = welcomeSwarm(await sealedRoomLink(zone.room, zone.secret, relay, code, this.#here(), landing))
    if (!link) {
      this.#say(this.#t('room.host.unsealed', 'room host: the room\'s sealed link could not be made or kept on its meeting host — nothing was changed'), 'warning')
      return
    }
    const done = await publishWelcome(cardHost, domain, held?.title ?? '', held?.tagline ?? '', link)
    if (!done.ok) { this.#say(this.#t('room.host.failed', `${domain}'s front page was not changed: ${done.reason}`, { domain, reason: done.reason }), 'warning'); return }
    // Said only when the page itself shows it: a signed card reaches a page
    // the worker fronts, and only in its publishers' order.
    const { at, page } = await this.#readBack(domain, swarm => swarm === link)
    if (page.read && page.swarm === link) {
      this.#say(this.#t('room.host.on', `${at} now says "Join the swarm" — anyone who opens it can join this room`, { at }), 'success')
      return
    }
    if (!page.read) {
      this.#say(this.#t('room.host.on-unchecked', `The room is on your card for ${domain} — ${at} could not be reached to check`, { domain, at }), 'warning')
      return
    }
    const why = this.#whyNotShown(page.swarm, held?.swarm ?? '', cardHost)
    this.#say(this.#t('room.host.not-shown', `The room is on your card for ${domain}, but its front page does not show it: ${why}`, { domain, why }), 'warning')
  }

  /** Where the card shows, read back — once more after a door's index window
   *  when it does not show yet what was just signed. */
  async #readBack(domain: string, settled: (swarm: string) => boolean): Promise<{ at: string; page: FrontPageRoom }> {
    const first = await shownRoom(domain)
    if (!first.page.read || settled(first.page.swarm)) return first
    await new Promise(resolve => setTimeout(resolve, READ_BACK_AGAIN_MS))
    return shownRoom(domain)
  }

  /** Why a page that was read does not show the room just signed — blaming
   *  only what the page itself shows. */
  #whyNotShown(shown: string, previous: string, host: string): string {
    if (shown && shown === previous) return this.#t('room.host.why.stale', `it still shows the room your card carried before — its door may read your card from a host other than ${host}`, { host })
    if (shown) return this.#t('room.host.why.other', `it shows a room your card on ${host} does not carry — another publisher's, or your card on another host`, { host })
    return this.#t('room.host.why.not-read', `its door does not read your card first — it may be its own site, a publisher ahead of you may sign one, or it reads a host other than ${host}`, { host })
  }

  // ── the rooms this device remembers ─────────────────────────

  #list(): void {
    const rooms = readRememberedRooms()
    if (!rooms.length) {
      this.#say(this.#t('room.list.none', 'This device remembers no rooms yet — joining one remembers it'), 'warning')
      return
    }
    const hostOf = (relay: string): string => { try { return new URL(relay).host } catch { return relay } }
    const names = rooms.map(r => r.label === r.room ? r.room : `${r.room} (${r.label})`)
    for (const r of rooms) EffectBus.emit('activity:log', { message: `${r.room} — ${hostOf(r.relay)}`, icon: '⌂' })
    EffectBus.emit('toast:show', {
      type: 'info',
      title: this.#t('room.list.title', 'Rooms this device remembers'),
      message: names.join(', '),
      duration: 10_000,
    })
  }

  #forget(name: string): void {
    const room = name.trim()
    if (!room) { this.#say(this.#t('room.forget.usage', 'room forget: name the room — "room list" shows them'), 'warning'); return }
    const held = readRememberedRooms()
    const { rooms, removed } = withoutRoom(held, room)
    if (!removed) { this.#say(this.#t('room.forget.missing', `This device does not remember "${room}"`, { room }), 'warning'); return }
    // The room this tab is in would be remembered again the moment it is
    // rejoined (a reload): leaving comes first.
    const zone = isJoinedHere() ? ownZone() : null
    if (zone && held.some(r => !rooms.includes(r) && r.room === zone.room && r.secret === zone.secret)) {
      this.#say(this.#t('room.forget.here', `You are in "${room}" — leave it first, then forget it`, { room }), 'warning')
      return
    }
    saveRememberedRooms(rooms)
    this.#say(this.#t('room.forget.done', `This device no longer remembers "${room}" — its sessions will not be announced here`, { room }), 'success')
  }

  // ── where things are ────────────────────────────────────────

  #here(): string[] {
    return [...(get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
      .map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #selectedTile(): string | null {
    const selection = get<{ active?: string | null; selected?: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')
    const pick = selection?.active || [...(selection?.selected ?? [])][0] || ''
    return String(pick).trim() || null
  }

  /** The room's tile here: the host's template first, else the first shared. */
  #roomTile(): string | null {
    const tiles = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')?.peerTilesAtCurrentSig?.() ?? []
    const pick = tiles.find(t => t.template) ?? tiles[0]
    return pick ? String(pick.name).trim() || null : null
  }

  #roomHost(): string {
    try { return String(get<{ host?: () => string }>('@diamondcoreprocessor.com/RoomPool')?.host?.() ?? '').trim() } catch { return '' }
  }

  async #pubkey(): Promise<string> {
    try {
      const pk = await get<{ getPublicKeyHex?: () => Promise<string | null> }>('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.()
      return /^[0-9a-f]{64}$/.test(String(pk ?? '')) ? String(pk) : ''
    } catch { return '' }
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
    return value && value !== key ? value : fallback
  }

  #say(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '⌂' })
    if (type !== 'info') EffectBus.emit('toast:show', { type, message })
  }
}

const _room = new RoomQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RoomQueenBee', _room)
