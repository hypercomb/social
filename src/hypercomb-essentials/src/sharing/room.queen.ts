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
//
// What a room asks rides the room tile's layer (`asks`, room-asks.ts); on
// arrival each asked word is offered to be turned on (room-asks.drone.ts).
// Taking home hands the tile to your own hive by signature (take-home.ts).
// A start notice is posted at the room's notice address on its meeting point
// (room-notice.ts) and re-posted while you stay in the room; room-notice.drone.ts
// does both, and hears it on every device that remembers the room.

import { EffectBus, QueenBee, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { ROOM_ASKS_SLOT, applyAsks, currentRoomAsks, readAsks } from './room-asks.js'
import { readHome, takeBundle, takeClosure, takeLinkText, writeHome } from './take-home.js'
import { isJoinedHere, ownZone } from './membership.js'

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
  putOne?(host: string, sig: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; reason: string }>
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>): Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}
type MeshShape = { meetingRelay?: () => string }
type NoticeShape = { announce?: (room: string, secret: string, relay: string, label: string, segments: readonly string[]) => Promise<boolean> }
type SwarmShape = { peerTilesAtCurrentSig?: () => readonly { name: string; layerSig?: unknown; template?: boolean }[] }

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
  override options = ['asks <behaviours>', 'asks ~ <behaviour>', 'home', 'home <address>', 'start']
  override examples = [
    { input: 'room', result: 'Says what this room asks and where take home sends' },
    { input: 'room asks notes keep-alive', result: 'The selected room tile asks joiners for notes and keep-alive' },
    { input: 'room home', result: 'Takes the room tile you collected home to your own hive' },
    { input: 'room home hypercomb.io', result: 'Your own hive is at hypercomb.io' },
    { input: 'room start', result: 'Tells everyone who has been in this room that the session is starting' },
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
    this.#say(this.#t('room.usage', 'room — say "room", "room asks <behaviours>", "room home", or "room start"'), 'warning')
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
    const base: { name?: string; [slot: string]: unknown } = prior ? { ...prior } : { name: tile }
    if (next.length) base[ROOM_ASKS_SLOT] = next
    else delete base[ROOM_ASKS_SLOT]
    // Sigs, never names (the same call notes.drone.ts makes).
    await committer.update(segments, base, new Set())
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
