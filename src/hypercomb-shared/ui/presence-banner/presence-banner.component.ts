// hypercomb-shared/ui/presence-banner/presence-banner.component.ts
//
// Quiet, top-centered strip that surfaces who is at the current
// composedSig. Hidden when there's no swarm context. Renders one
// initials badge per participant — you first, then each peer — with a
// distinct fluorescent text colour derived from identity, so the set
// of people present is glanceable at a stroke.
//
// Your own badge is click-to-name: tapping it opens an inline field
// that writes through SwarmDrone.setMyLabel(), which persists to
// localStorage. The name is sticky across sessions — set it once, and
// every future arrival stamps it onto your outgoing layers.
//
// Clicking a peer badge expands the participant panel: one row per
// peer with two icon toggles — subscribe (data flow + consent
// handshake) and follow (navigation sync).
//
// Source: SwarmDrone effects + APIs. The strip stays inert without a
// SwarmDrone in IoC, so non-swarm shells pay zero cost.
//
// THE ONE STATUS LINE. Under the badges sits a single line that says the
// REAL state — the socket (`mesh:connection`: connecting, live, reconnecting,
// "can't reach <host>"), the room (everyone in it, how many on this page,
// the room's two words), and what YOU are offering here
// (`swarm:share-status` + `sync:state`: sharing, uploading, name-only and
// why, private with a one-tap Share). It replaces the toasts that told a
// meeting "the upload is running" when nothing was. The words themselves
// live in presence-status.ts, pure, so a spec pins each state's exact text.
// Until the mesh has reported a connection state at all (an older essentials
// package never does), the strip renders exactly as it always did.
//
// The badges cover the WHOLE ROOM: solid for someone on this page, dim for
// someone elsewhere in the room, hollow for someone away (their socket
// dropped; their tiles stay until their slot expires). Tapping a badge still
// filters the canvas to that person — but now a chip says so, with the way
// back, because a filter nobody can see reads as "people vanished".
//
// Private mode gate: presence is a public (swarm) concept. In private
// mode the mesh network is disabled, so no peer can ever surface — it's
// only you. Showing a participant badge for yourself alone is noise, so
// the whole strip stays hidden until mesh-public is on. Driven by the
// processor's 'mesh:public-changed' broadcast (last-value replay →
// correct on mount, even if we subscribe after the initial emit).

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, ElementRef, inject, signal, computed, effect, viewChild, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus, requestConfirm } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { fromRuntime } from '../../core/from-runtime'
import {
  SENDING_AFTER_MS, SLOW_FOR_MS, UNREACHABLE_AFTER_MS, clockRefused, hostKeepsNothing, linkPhase, refusalOf, slowLink, statusLine, wordsBeside,
  type MeshConnection, type ShareStatus, type StatusLine, type SyncState,
} from './presence-status'
import { readMeshZone } from '../../core/mesh-session'

interface PresencePayload {
  sig?: string
  peerCount?: number
  alone?: boolean
  peers?: readonly string[]
  /** Everyone live in the room, on any page (SwarmDrone, room-wide roster).
   *  Pubkeys, or `{ pubkey }` rows. Absent on older essentials. */
  zonePeers?: readonly unknown[]
  /** Of `peers`, those STANDING on this page (their page word carries
   *  at:true, or predates the flag). The rest only re-announce a page they
   *  visited this session: their tiles are here, they are not. Absent on an
   *  older swarm — then everyone in `peers` stands here. */
  at?: readonly string[]
  /** Members whose tiles here can be taken while their deeper pages are
   *  still only on their own device (deep: 'owner', D1). */
  deepOwners?: readonly string[]
  reason?: string
}

interface SwarmLabelApi {
  labelFor: (pubkey: string) => string
  myLabel: () => string
  setMyLabel: (label: string) => void
}

interface SwarmConsumerApi extends SwarmLabelApi {
  subscribedTo: () => string
  following: () => string
  subscribeTo: (pubkey: string | null) => Promise<void>
  follow: (pubkey: string | null) => Promise<void>
  // The room-wide roster and share status (all optional — an older
  // essentials package has none of them, and the strip degrades to today's).
  participantsInZone?: () => readonly unknown[]
  awayInZone?: () => readonly unknown[]
  privateCountHere?: () => number
  offerPrivateHere?: () => unknown
  currentSegments?: () => readonly string[]
  peersOnOlderVersion?: () => unknown
}

/** NostrMeshDrone — only its derived host is read here. */
interface MeshApi { swarmHost?: () => string }
/** HostSyncService — the hosts this device knows, read synchronously for the
 *  "did you mean …?" hint (nothing is fetched). */
interface HostsApi {
  swarmHosts?: () => readonly string[]
  publishNodes?: () => readonly string[]
  publicHostDomain?: () => string
  defaultPublicHostDomain?: () => string
}
interface InviteApi { invoke: (args: string) => Promise<void>; meetingLink?: () => Promise<void> }

/** Who a key is, at its host (essentials NameService), consumed via IoC at
 *  runtime — shared never imports modules. A name a host vouches for first,
 *  else the caller's label marked unverified, else a short npub. */
interface NameApi {
  nameOf: (pubkey: string, host?: string) => { name: string; host: string } | null
  label: (pubkey: string, host?: string, unverifiedFallback?: string) => string
}

/** The participant filter (essentials SwarmFilterService), consumed via
 *  IoC at runtime — shared never imports modules. */
interface SwarmFilterApi {
  selected: ReadonlySet<string>
  toggle: (pubkey: string) => void
  clear?: () => void
}

/** One participant chip in the top strip. */
interface Badge {
  /** Stable track key — pubkey for peers, 'self' for you. */
  key: string
  /** Two-letter initials (or '+' for an unnamed self badge). */
  initials: string
  /** Fluorescent text colour, hashed from identity. */
  color: string
  /** Matching neon glow for text-shadow. */
  glow: string
  isSelf: boolean
  /** True on the self badge when no label is set yet — renders the
   *  "add name" affordance instead of letters. */
  unnamed: boolean
  /** True when this peer is in the participant-filter selection. */
  selected: boolean
  /** Where in the room they are: on this page, sharing here while standing
   *  elsewhere (a page they visited), elsewhere, or away. */
  where: 'self' | 'here' | 'visiting' | 'elsewhere' | 'away'
}

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SWARM_FILTER_KEY = '@diamondcoreprocessor.com/SwarmFilterService'
const NAMES_KEY = '@diamondcoreprocessor.com/NameService'
const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const INVITE_KEY = '@diamondcoreprocessor.com/InviteQueenBee'
const HOSTS_KEY = '@diamondcoreprocessor.com/HostSyncService'

/** How long a relay refusal stays on the line. */
const REJECTED_SHOWN_MS = 20_000

/** A roster entry is a pubkey, or a row carrying one. */
const pubkeysOf = (list: unknown): string[] => {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const e of list) {
    const pk = typeof e === 'string' ? e : (e as { pubkey?: unknown } | null)?.pubkey
    if (typeof pk === 'string' && pk) out.push(pk)
  }
  return out
}

@Component({
  selector: 'hc-presence-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './presence-banner.component.html',
  styleUrls: ['./presence-banner.component.scss'],
})
export class PresenceBannerComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []

  /** The strip's own element — the containment test for the
   *  dismiss-on-outside-pointer handler. */
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef)

  /** Whether the swarm has connected at any point this session.
   *  Gates rendering — until the first presence event lands, the
   *  strip stays hidden (no flashing on cold boot). */
  readonly #seen = signal(false)

  /** True while mesh-public (swarm) mode is on. Private mode can never
   *  have peers, so the strip stays hidden — presence is a public-only
   *  affordance. Seeded from the processor's 'mesh:public-changed'
   *  broadcast (last-value replay makes it correct on mount). */
  readonly #public = signal(false)

  /** Pubkeys of the live participants at our location. Sorted by
   *  the swarm drone (freshest first). */
  readonly #peers = signal<readonly string[]>([])
  /** Of those, the ones standing here (null: the swarm does not say, and
   *  everyone with tiles here stands here, as before). */
  readonly #at = signal<ReadonlySet<string> | null>(null)
  readonly #deepOwners = signal<readonly string[]>([])

  /** True when the swarm published a presence event and we're alone. */
  readonly #alone = signal(true)

  /** Our own chosen label. Seeded from the swarm on mount, updated
   *  locally the instant we rename (setMyLabel persists it). */
  readonly #myLabel = signal('')

  /** Bumped whenever a peer's label lands, forcing badge recompute so
   *  a peer that arrived unlabelled gets re-lettered on their next
   *  event. */
  readonly #labelVersion = signal(0)

  /** Expanded participant panel state. Toggles on peer-badge click. */
  readonly expanded = signal(false)

  /** Inline name editor state + draft. */
  readonly editingName = signal(false)
  readonly draftName = signal('')

  /** The inline name field, present only while editing. Angular signal
   *  queries can't sit on an ES-private (`#`) member, so this stays a
   *  public readonly field per the codebase's viewChild convention. */
  readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput')

  constructor() {
    // Focus + select the field the moment it renders — the HTML
    // `autofocus` attribute doesn't fire on dynamically-inserted nodes.
    effect(() => {
      if (!this.editingName()) return
      const el = this.nameInput()?.nativeElement
      if (el) queueMicrotask(() => { el.focus(); el.select() })
    })
  }

  /** Live subscribe + follow targets — mirrored from swarm via
   *  EffectBus so the row indicators update without polling. */
  readonly #subscribedTo = signal('')
  readonly #following = signal('')

  /** Participant-filter selection, mirrored from `swarm:filter`
   *  (SwarmFilterService owns the truth; empty = everyone shows). */
  readonly #selected = signal<ReadonlySet<string>>(new Set())

  /** The host upload behind a share, while it runs: `done` of `total`
   *  entries of the current drain pass (host-sync `host-sync:progress`).
   *  Painted so a participant sees their tiles going up rather than
   *  wondering — the swarm never waits on it. Null when nothing is
   *  uploading. */
  readonly upload = signal<{ done: number; total: number } | null>(null)

  // ── the one status line ─────────────────────────────────

  /** The socket's real state, as the mesh last reported it. Null until the
   *  first `mesh:connection` — an older essentials package never sends one,
   *  and then the strip keeps its old rendering. */
  readonly #conn = signal<MeshConnection | null>(null)
  /** When the tab last stopped having an OPEN socket (null while open). */
  readonly #downSince = signal<number | null>(null)
  /** Whether a socket has opened since this strip mounted — a first connect
   *  says "Connecting", every later one "Reconnecting". */
  readonly #wasOpen = signal(false)
  /** Bumped by the two timers below; the only clock the line reads. */
  readonly #clock = signal(Date.now())
  #downTimer: ReturnType<typeof setTimeout> | null = null
  #rejectedTimer: ReturnType<typeof setTimeout> | null = null
  #slowTimer: ReturnType<typeof setTimeout> | null = null
  #sendingTimer: ReturnType<typeof setTimeout> | null = null

  /** The meeting point this tab is joined at, as named in its zone ('' =
   *  the default) — what the 'unreachable' line names. */
  readonly #point = signal('')
  /** DELIVERY, NOT THE SOCKET (TS-7). The relay never echoes our own event
   *  back, so its OK (swarm:page-announced) is the only proof the room has
   *  this page's word. #offered: since when this tab's own frames at a page
   *  have gone untaken — `exact` when the swarm counted it (share-status
   *  `unackedMs`: the page's word or the beacon, aged from when it went out,
   *  so a status said again never restarts the count); else since this tab
   *  first heard the page's word was on its way. #taken: when the relay last
   *  took a word, by page. Until a swarm has ever said page-announced, or
   *  that a frame of ours is late (an older essentials), every word counts
   *  as taken — the line reads as it always did. */
  readonly #announceSeen = signal(false)
  readonly #offered = signal<{ location: string; at: number; exact: boolean } | null>(null)
  readonly #taken = signal<ReadonlyMap<string, number>>(new Map())

  /** The relay this tab meets at, as `jwize.com` — what the connection
   *  lines name. Where a page's tiles go is the share status's `host`. */
  readonly #swarmHost = signal('')
  /** Live participants anywhere in the room (not you), and those away. */
  readonly #zone = signal<readonly string[]>([])
  readonly #away = signal<readonly string[]>([])
  /** This page, as the swarm names it: its composed sig and its path. */
  readonly #hereSig = signal('')
  readonly #hereLocation = signal<string | null>(null)
  /** The swarm's per-location share status, newest per location. */
  readonly #shares = signal<ReadonlyMap<string, ShareStatus>>(new Map())
  readonly #lastShare = signal<ShareStatus | null>(null)
  /** Each swarm host's last report, by host, and the newest of them. */
  readonly #syncs = signal<ReadonlyMap<string, SyncState>>(new Map())
  readonly #lastSync = signal<SyncState | null>(null)
  readonly #older = signal(0)
  readonly #rejected = signal('')

  readonly #room = fromRuntime(
    get('@hypercomb.social/RoomStore') as EventTarget | undefined,
    () => (get('@hypercomb.social/RoomStore') as { value?: string } | undefined)?.value ?? '',
  )
  readonly #secret = fromRuntime(
    get('@hypercomb.social/SecretStore') as EventTarget | undefined,
    () => (get('@hypercomb.social/SecretStore') as { value?: string } | undefined)?.value ?? '',
  )
  readonly #locale = fromRuntime(
    get('@hypercomb.social/I18n') as EventTarget | undefined,
    () => (get('@hypercomb.social/I18n') as { locale?: string } | undefined)?.locale ?? 'en',
  )

  /** This page's share status: matched by path or by composed sig, else —
   *  on a swarm that names neither — the newest walk's. */
  readonly #share = computed<ShareStatus | null>(() => {
    const shares = this.#shares()
    const at = this.#hereLocation()
    if (at !== null) return shares.get(at) ?? shares.get(this.#hereSig()) ?? null
    return shares.get(this.#hereSig()) ?? this.#lastShare()
  })

  /** The report of the host THIS page's tiles go to — none while the page
   *  has no host. A swarm that names no host (older essentials): the newest
   *  swarm-host report, as before. */
  readonly #sync = computed<SyncState | null>(() => {
    const share = this.#share()
    if (share && typeof share.host === 'string') return share.host ? this.#syncs().get(share.host) ?? null : null
    return this.#lastSync()
  })

  /** The host the upload lines name: where this page's tiles go. */
  readonly #uploadHost = computed(() => String(this.#share()?.host ?? ''))

  /** THIS page: whether the relay ever took a word of ours for it
   *  (`arrived`), and since when a frame of ours here has been on its way
   *  untaken (null while nothing is). */
  readonly #delivery = computed<{ arrived: boolean; since: number | null }>(() => {
    if (!this.#announceSeen()) return { arrived: true, since: null }
    const share = this.#share()
    const at = this.#hereLocation() ?? String(share?.location ?? '')
    const taken = this.#taken().get(at)
    const offered = this.#offered()
    let mine = offered && offered.location === at ? offered : null
    // A swarm that does not count its own frames: the page's OK after its
    // word went out (or a status that says taken) is the word taken. A count
    // the swarm keeps is cleared only by the swarm (or the page's OK).
    if (mine && !mine.exact && (share?.taken === true || (taken !== undefined && taken >= mine.at))) mine = null
    return { arrived: share?.taken === true || taken !== undefined, since: mine ? mine.at : null }
  })

  /** The line, or null for the old rendering. */
  readonly status = computed<StatusLine | null>(() => {
    const conn = this.#conn()
    const now = this.#clock()
    let phase = linkPhase(conn, this.#downSince(), now, this.#wasOpen())
    if (!phase) return null
    // An OPEN socket answering late is live and slow, never "Reconnecting".
    const slow = phase !== 'down' && slowLink(conn, now)
    if (slow) phase = 'open'
    const away = new Set(this.#away())
    const peersHere = this.#peers().filter(pk => !away.has(pk))
    const at = this.#at()
    const standing = at ? peersHere.filter(pk => at.has(pk)) : peersHere
    const room = new Set([...this.#zone(), ...peersHere])
    for (const pk of away) room.delete(pk)
    // You are here once the relay has taken your word for this page — until
    // then the room does not see you here. A frame of yours untaken for
    // SENDING_AFTER_MS (the page's word, the beacon) says "Sending…", and
    // you are not counted here while it does, whatever the socket says. A
    // re-said word on its way for less than that keeps you counted: the
    // count never blinks on every walk of the page.
    const { arrived, since } = this.#delivery()
    const sending = since !== null && now - since >= SENDING_AFTER_MS
    const selfHere = arrived && !sending
    this.#labelVersion() // dependency: a sharer's name landing renames the line
    const deepOwners = this.#deepOwners().map(pk => this.#labelOf(pk))
    return statusLine({
      phase,
      host: this.#swarmHost() || this.#t('mesh.state.no-host-name'),
      uploadHost: this.#uploadHost(),
      room: this.#room().trim(),
      words: wordsBeside(this.#room(), this.#secret(), this.#swarmHost(), this.#locale()),
      roomCount: room.size + 1,
      hereCount: standing.length + (selfHere ? 1 : 0),
      share: this.#share(),
      sync: this.#sync(),
      older: this.#older(),
      clockOff: clockRefused(conn),
      rejected: this.#rejected(),
      refused: refusalOf(conn),
      point: this.#point(),
      slow,
      sending,
      knownHosts: () => this.#knownHosts(),
      deepOwners,
    })
  })

  /** A phone folds a quiet line to the dot and the counts; a tap opens it. */
  readonly lineOpen = signal(false)

  /** Whether the swarm has reported any share status — once it has, the
   *  status line carries the upload and the old upload caption stands down. */
  readonly shareSeen = computed(() => this.#lastShare() !== null)

  /** "Only Ana's tiles" — the filter, said out loud, while one is on. */
  readonly filterNames = computed(() => {
    this.#labelVersion()
    const selected = [...this.#selected()]
    if (!selected.length) return ''
    return selected.map(pk => this.#labelOf(pk)).join(', ')
  })

  readonly visible = computed(() => (this.#seen() || this.#conn() !== null) && this.#public())
  readonly alone = computed(() => this.#alone())
  readonly peerCount = computed(() => this.#peers().length)

  /** The full badge strip — you first, then each peer. Recomputes on
   *  peer changes, label arrivals, and self renames. */
  readonly badges = computed<readonly Badge[]>(() => {
    this.#labelVersion() // dependency: re-run when any label lands
    const swarm = this.#swarm()
    const out: Badge[] = []

    // Self badge always leads the strip.
    const myLabel = this.#myLabel().trim()
    out.push({
      key: 'self',
      ...this.#chip(myLabel || 'me'),
      initials: myLabel ? this.#initials(myLabel) : '+',
      isSelf: true,
      unnamed: !myLabel,
      selected: false,
      where: 'self',
    })

    const selected = this.#selected()
    const names = this.#names()
    // The whole room, nearest first: on this page, elsewhere, away. A room
    // the swarm does not report (older essentials) is just this page.
    // Away wins: someone whose socket dropped still has tiles on this page
    // until their slot runs out, and the badge says they are away.
    const away = this.#away()
    const awaySet = new Set(away)
    const sharing = this.#peers().filter(pk => !awaySet.has(pk))
    // Standing here, or only re-announcing a page they visited: their tiles
    // are here either way (the badge still filters to them), but only the
    // first are on this page.
    const at = this.#at()
    const here = at ? sharing.filter(pk => at.has(pk)) : sharing
    const visiting = at ? sharing.filter(pk => !at.has(pk)) : []
    const seen = new Set<string>([...sharing, ...away])
    const elsewhere = this.#zone().filter(pk => !seen.has(pk))
    const roster: [string, Badge['where']][] = [
      ...here.map((pk): [string, Badge['where']] => [pk, 'here']),
      ...visiting.map((pk): [string, Badge['where']] => [pk, 'visiting']),
      ...elsewhere.map((pk): [string, Badge['where']] => [pk, 'elsewhere']),
      ...away.map((pk): [string, Badge['where']] => [pk, 'away']),
    ]
    for (const [pk, where] of roster) {
      // A name their host vouches for letters the badge first; the label
      // they announced is the unverified fallback.
      const verified = names?.nameOf?.(pk) ?? null
      const label = (verified ? (verified.name === '_' ? verified.host : verified.name) : '')
        || (swarm?.labelFor?.(pk) ?? '').trim()
      out.push({
        key: pk,
        // Colour seeds from the stable pubkey, not the label — a peer
        // keeps their hue even before (and across) a rename.
        ...this.#chip(pk),
        initials: label ? this.#initials(label) : pk.slice(0, 2).toUpperCase(),
        isSelf: false,
        unnamed: false,
        selected: selected.has(pk),
        where,
      })
    }
    return out
  })

  // (The bulk adopt chip is retired with the adopt button — visiting a
  // peer's tiles is the acquisition now. The participant filter itself
  // stays: selecting peers still scopes the canvas to their tiles.)

  /** Per-row participant data for the expanded panel. Labels
   *  collide-safe: when two peers share a label, we suffix the
   *  pubkey to disambiguate ("Alice • a1b2"). */
  readonly rows = computed<readonly { pubkey: string; label: string; subscribed: boolean; following: boolean; selected: boolean }[]>(() => {
    this.#labelVersion()
    const peers = this.#peers()
    const swarm = this.#swarm()
    const subscribedTo = this.#subscribedTo()
    const following = this.#following()
    const selected = this.#selected()
    const names = this.#names()
    const raw = peers.map(pk => {
      const announced = (swarm?.labelFor?.(pk) ?? '').trim()
      return {
        pubkey: pk,
        label: names?.label?.(pk, undefined, announced) || announced || `${pk.slice(0, 6)}…`,
      }
    })
    const labelCount = new Map<string, number>()
    for (const r of raw) labelCount.set(r.label, (labelCount.get(r.label) ?? 0) + 1)
    return raw.map(r => ({
      pubkey: r.pubkey,
      label: (labelCount.get(r.label) ?? 0) > 1
        ? `${r.label} • ${r.pubkey.slice(0, 4)}`
        : r.label,
      subscribed: r.pubkey === subscribedTo && !!subscribedTo,
      following: r.pubkey === following && !!following,
      selected: selected.has(r.pubkey),
    }))
  })

  ngOnInit(): void {
    const swarm = this.#swarm()
    if (swarm) {
      try { this.#myLabel.set(swarm.myLabel() ?? '') } catch { /* default empty */ }
      try { this.#subscribedTo.set(swarm.subscribedTo() ?? '') } catch { /* default empty */ }
      try { this.#following.set(swarm.following() ?? '') } catch { /* default empty */ }
    }

    this.#unsubs.push(
      EffectBus.on<PresencePayload>('swarm:presence-changed', (payload) => {
        // The swarm exists by the time it reports presence. On the web
        // shell the drones arrive from OPFS AFTER this strip mounted, so
        // the one-time read in ngOnInit found no swarm and left the label
        // empty for the whole session — the badge offered "+" to someone
        // who had named themselves. Seed it here once the swarm is there.
        if (!this.#myLabel()) {
          try { const l = this.#swarm()?.myLabel?.() ?? ''; if (l) this.#myLabel.set(l) } catch { /* default empty */ }
        }
        const peers = Array.isArray(payload?.peers) ? payload.peers : []
        const alone = payload?.alone ?? peers.length === 0
        this.#peers.set(peers)
        this.#at.set(Array.isArray(payload?.at) ? new Set(payload.at.map(String)) : null)
        this.#deepOwners.set(Array.isArray(payload?.deepOwners) ? payload.deepOwners.map(String) : [])
        this.#alone.set(alone)
        this.#seen.set(true)
        if (typeof payload?.sig === 'string') this.#hereSig.set(payload.sig)
        this.#readRoom(payload?.zonePeers)
        // Last peer left: the caret unmounts with them, so an expanded
        // panel would have no way left to close. Collapse with them.
        if (alone) this.expanded.set(false)
      }),

      // A label arrived (or changed) — force badge/row recompute. Our OWN
      // rename lands here too (`self`) when it was saved through the mesh
      // selector rather than this strip's inline field.
      EffectBus.on<{ label?: string; self?: boolean }>('swarm:label-changed', (p) => {
        if (p?.self && typeof p.label === 'string') this.#myLabel.set(p.label)
        this.#labelVersion.update(v => v + 1)
      }),

      // A host vouched for a name (NameService) — re-letter badges and rows.
      EffectBus.on('names:changed', () => {
        this.#labelVersion.update(v => v + 1)
      }),

      // Subscribe/follow target changes — mirror into local signals
      // so row state lights up the moment the swarm flips.
      EffectBus.on<{ pubkey?: string }>('swarm:subscription-changed', (p) => {
        this.#subscribedTo.set(String(p?.pubkey ?? ''))
      }),
      EffectBus.on<{ pubkey?: string }>('swarm:following-changed', (p) => {
        this.#following.set(String(p?.pubkey ?? ''))
      }),

      // Public/private toggle — presence is public-only, so the strip
      // hides the instant mesh-public goes off (and reappears on).
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', ({ public: pub }) => {
        this.#public.set(!!pub)
        // A join (or a leave) starts the socket's story over: the next
        // connect is a first connect, and the 30 s clock runs from now.
        this.#wasOpen.set(false)
        this.#downSince.set(null)
        if (this.#downTimer) { clearTimeout(this.#downTimer); this.#downTimer = null }
        const conn = this.#conn()
        if (pub && conn) this.#onConnection(conn, true)
      }),

      // Participant-filter selection — mirror so badges/rows relight
      // (the service reconciles departures on peers-changed itself).
      EffectBus.on<{ participants?: readonly string[] }>('swarm:filter', (p) => {
        this.#selected.set(new Set((p?.participants ?? []).map(String)))
      }),

      // The upload behind a share — one tick per queued entry; the last
      // tick (done === total) clears the line.
      EffectBus.on<{ done?: number; total?: number }>('host-sync:progress', (p) => {
        const done = Number(p?.done ?? 0), total = Number(p?.total ?? 0)
        this.upload.set(total > 0 && done < total ? { done, total } : null)
      }),

      // The socket's real state. `downSince` is kept HERE rather than taken
      // from the mesh's `since`, which restarts on every ladder step — the
      // "can't reach" threshold is about how long the tab has had no live
      // socket at all.
      EffectBus.on<MeshConnection>('mesh:connection', (c) => this.#onConnection(c, false)),

      // A relay refusal the mesh does not retry itself — said for a while.
      EffectBus.on<{ reason?: unknown }>('mesh:rejected', (p) => {
        const reason = String(p?.reason ?? '').trim()
        if (!reason) return
        this.#rejected.set(reason.slice(0, 120))
        if (this.#rejectedTimer) clearTimeout(this.#rejectedTimer)
        this.#rejectedTimer = setTimeout(() => { this.#rejectedTimer = null; this.#rejected.set('') }, REJECTED_SHOWN_MS)
      }),

      // What the swarm offered at a page on its last walk of it.
      EffectBus.on<ShareStatus>('swarm:share-status', (p) => {
        if (!p || typeof p !== 'object') return
        const at = String(p.location ?? '')
        const next = new Map(this.#shares())
        next.set(at, p)
        this.#shares.set(next)
        this.#lastShare.set(p)
        this.#readHere()
        // A walk of the page we stand on sends (or re-says) its word: it is
        // on its way until the relay takes it — for as long as the swarm says
        // its frames have gone untaken, never from this status's arrival.
        if (at === (this.#hereLocation() ?? at)) this.#noteOffered(at, p)
      }),

      // The relay took this tab's word for the page it stands on (its OK).
      // The swarm says its status again at once if anything of ours (the
      // beacon) is still on its way.
      EffectBus.on<{ location?: string }>('swarm:page-announced', (p) => {
        const at = String(p?.location ?? '')
        this.#announceSeen.set(true)
        const next = new Map(this.#taken())
        next.delete(at)
        next.set(at, Date.now())
        while (next.size > 64) next.delete(next.keys().next().value as string)
        this.#taken.set(next)
        if (this.#offered()?.exact && this.#offered()?.location === at) this.#offered.set(null)
        this.#clock.set(Date.now())
      }),

      // The tab's meeting point moved (the selector, a link): re-read where
      // it meets, for the words and the lines that name it.
      EffectBus.on('mesh:zone', () => queueMicrotask(() => { this.#readHost(); this.#readPoint() })),

      // Does a swarm host take the bytes — and if not, why. Only swarm
      // hosts' reports: another target is a backup, not what the room
      // fetches from. Kept per host; the line reads this page's (#sync).
      EffectBus.on<SyncState>('sync:state', (p) => {
        if (!p || typeof p !== 'object') return
        const host = String(p.host ?? '').trim()
        if (p.swarm !== true && !(host && host === this.#swarmHost())) return
        if (host) {
          const next = new Map(this.#syncs())
          next.set(host, p)
          this.#syncs.set(next)
        }
        this.#lastSync.set(p)
      }),

      // Someone arrived, left, went away or came back anywhere in the room.
      EffectBus.on('swarm:roster-changed', () => this.#readRoom()),
    )

    // The panel is dismissible from anywhere: a pointer down outside
    // the strip, or Escape, collapses it. The caret alone was the only
    // way out — a small target that is easy to miss on a phone, which
    // is why the panel read as stuck open once shown.
    const onPointerDown = (ev: Event) => {
      if (!this.expanded()) return
      const root = this.#host.nativeElement as HTMLElement
      if (root.contains(ev.target as Node)) return
      this.expanded.set(false)
    }
    const onKeydown = (ev: KeyboardEvent) => {
      if (!this.expanded() || ev.key !== 'Escape') return
      ev.stopPropagation()
      this.expanded.set(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeydown, true)
    this.#unsubs.push(() => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeydown, true)
    })

    // Seed from the live service — the replayed effect covers most
    // mounts, but a fresh mount before any toggle has no last value.
    const filter = this.#filter()
    if (filter) this.#selected.set(new Set(filter.selected))
    this.#readHost()
    this.#readPoint()
  }

  /** Click a peer badge (or their row name) → toggle that participant
   *  in the canvas filter. No selection = everyone shows. Only someone on
   *  this page has tiles here to filter to — a badge for someone elsewhere
   *  or away says where they are and does nothing else. */
  onPeerBadgeClick(pubkey: string): void {
    if (!this.#peers().includes(pubkey) && !this.#selected().has(pubkey)) return
    this.#filter()?.toggle(pubkey)
  }

  /** The chip's way back: everyone shows again. */
  onShowEveryone(): void {
    const filter = this.#filter()
    if (filter?.clear) { filter.clear(); return }
    for (const pk of [...(filter?.selected ?? [])]) filter?.toggle(pk)
  }

  /** The line's buttons. `invite` hands out the meeting link (the invite
   *  word, with nothing selected); `share` offers this page's private tiles
   *  after one confirmation — tile by tile, their insides stay private;
   *  `code` opens the selector on the access code (the meeting point refused
   *  this tab's — paste the newest one). */
  async onStatusAction(action: 'invite' | 'share' | 'code' | undefined): Promise<void> {
    if (action === 'code') {
      EffectBus.emit('mesh:open-modal', { focus: 'code' })
      return
    }
    if (action === 'invite') {
      const invite = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(INVITE_KEY) as InviteApi | undefined
      // The meeting link, whatever is selected (an older queen: invoke('')).
      try { await (invite?.meetingLink ? invite.meetingLink() : invite?.invoke?.('')) } catch (e) { console.warn('[presence] invite failed:', e) }
      return
    }
    if (action !== 'share') return
    const swarm = this.#swarm()
    if (typeof swarm?.offerPrivateHere !== 'function') return
    let count = Number(this.#share()?.private ?? 0)
    if (!(count > 0)) { try { count = Number(swarm.privateCountHere?.() ?? 0) } catch { count = 0 } }
    // Who keeps what is shared: this page's upload host, never the relay
    // merely because it is where we meet. An older swarm names no host (the
    // relay was its host); a page with no host, or one not known yet, names
    // no keeper — the confirmation must never promise one that is not there.
    // Nor one that is not taking the bytes (it refused this key, is full,
    // never answered): its tiles go live from this device (decision c).
    const share = this.#share()
    const named = share && typeof share.host === 'string'
    const keeper = named
      ? (hostKeepsNothing(share, this.#sync()) ? '' : this.#uploadHost())
      : (this.#swarmHost() || this.#t('mesh.state.no-host-name'))
    const ok = await requestConfirm({
      title: 'swarm.share.confirm.title',
      message: keeper ? 'swarm.share.confirm.message' : 'swarm.share.confirm.message-local',
      messageParams: { count, host: keeper },
      confirmLabel: 'swarm.share.confirm.ok',
      cancelLabel: 'swarm.share.confirm.cancel',
    })
    if (!ok) return
    try { await swarm.offerPrivateHere() } catch (e) { console.warn('[presence] share failed:', e) }
  }

  /** The phone's folded line opens and closes on a tap. */
  onLineToggle(): void {
    this.lineOpen.set(!this.lineOpen())
  }

  /** Title for a peer badge: what tapping it does, or where they are. */
  badgeTitleKey(b: Badge): string {
    if (b.isSelf) return 'presence.set-name'
    if (b.where === 'elsewhere') return 'presence.room-elsewhere'
    if (b.where === 'visiting') return 'presence.room-visiting'
    if (b.where === 'away') return 'presence.room-away'
    return 'presence.filter-toggle'
  }

  /** The caret toggles the expanded participant panel (expansion no
   *  longer rides badge clicks — those select). */
  onCaretClick(): void {
    if (this.#alone()) return
    this.expanded.set(!this.expanded())
  }

  /** Click your own badge → open the inline name editor. */
  onSelfBadgeClick(): void {
    this.draftName.set(this.#myLabel())
    this.editingName.set(true)
  }

  /** Commit the drafted name. Writes through the swarm (persists to
   *  localStorage) and updates the local mirror so the badge reletters
   *  immediately. Empty input clears the name. Guarded on the editor
   *  being open so the blur that follows Enter/Escape is a no-op. */
  commitName(): void {
    if (!this.editingName()) return
    const next = this.draftName().trim().slice(0, 64)
    const swarm = this.#swarm()
    try { swarm?.setMyLabel?.(next) } catch { /* best-effort */ }
    this.#myLabel.set(next)
    this.editingName.set(false)
  }

  /** Close without saving. Flips the flag first so the blur-triggered
   *  commit early-returns. */
  cancelName(): void {
    this.editingName.set(false)
  }

  /** Keep the editor's keystrokes out of the app's global shortcuts;
   *  Enter commits, Escape cancels. */
  onNameKeydown(ev: KeyboardEvent): void {
    ev.stopPropagation()
    if (ev.key === 'Enter') { ev.preventDefault(); this.commitName() }
    else if (ev.key === 'Escape') { ev.preventDefault(); this.cancelName() }
  }

  onNameInput(ev: Event): void {
    this.draftName.set((ev.target as HTMLInputElement)?.value ?? '')
  }

  /** Row action: flip subscribe for this pubkey. Single-target — if
   *  already subscribed to someone else, the swarm switches. Calling
   *  with the same pubkey unsubscribes (toggle semantics). */
  onSubscribeToggle(pubkey: string): void {
    const swarm = this.#swarm()
    if (!swarm?.subscribeTo) return
    const current = swarm.subscribedTo()
    void swarm.subscribeTo(current === pubkey ? null : pubkey)
  }

  /** Row action: flip follow (nav-sync) for this pubkey. */
  onFollowToggle(pubkey: string): void {
    const swarm = this.#swarm()
    if (!swarm?.follow) return
    const current = swarm.following()
    void swarm.follow(current === pubkey ? null : pubkey)
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
    if (this.#downTimer) clearTimeout(this.#downTimer)
    if (this.#rejectedTimer) clearTimeout(this.#rejectedTimer)
    if (this.#slowTimer) clearTimeout(this.#slowTimer)
    if (this.#sendingTimer) clearTimeout(this.#sendingTimer)
  }

  // ── helpers ───────────────────────────────────────────

  #swarm(): SwarmConsumerApi | undefined {
    return (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SWARM_KEY) as SwarmConsumerApi | undefined
  }

  #names(): NameApi | undefined {
    return (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NAMES_KEY) as NameApi | undefined
  }

  #filter(): SwarmFilterApi | undefined {
    return (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SWARM_FILTER_KEY) as SwarmFilterApi | undefined
  }

  #t(key: string): string {
    const i18n = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/I18n') as
      { t?: (k: string) => string } | undefined
    return i18n?.t?.(key) ?? key
  }

  #labelOf(pk: string): string {
    const announced = (this.#swarm()?.labelFor?.(pk) ?? '').trim()
    return this.#names()?.label?.(pk, undefined, announced) || announced || `${pk.slice(0, 6)}…`
  }

  #onConnection(c: MeshConnection | null | undefined, rejoined: boolean): void {
    if (!c || typeof c.state !== 'string') return
    this.#conn.set(c)
    this.#readHost()
    this.#readPoint()
    // The line reads the clock it is given: bring it to now, and wake it once
    // a stall has outlived the probe deadline (slow → reconnecting).
    const at = Date.now()
    this.#clock.set(at)
    if (this.#slowTimer) { clearTimeout(this.#slowTimer); this.#slowTimer = null }
    if (c.state === 'stalled') {
      const since = typeof c.since === 'number' && c.since > 0 && c.since <= at ? c.since : at
      this.#slowTimer = setTimeout(() => { this.#slowTimer = null; this.#clock.set(Date.now()) }, Math.max(0, since + SLOW_FOR_MS - at) + 50)
    }
    if (c.state === 'open') {
      this.#wasOpen.set(true)
      this.#downSince.set(null)
      if (this.#downTimer) { clearTimeout(this.#downTimer); this.#downTimer = null }
      return
    }
    if (this.#downSince() !== null) return
    const now = Date.now()
    const since = !rejoined && typeof c.since === 'number' && c.since > 0 && c.since <= now ? c.since : now
    this.#downSince.set(since)
    this.#downTimer = setTimeout(() => {
      this.#downTimer = null
      this.#clock.set(Date.now())
    }, Math.max(0, since + UNREACHABLE_AFTER_MS - now) + 50)
  }

  /** The swarm's host: host[:port] of the relay this tab dials. Derived by
   *  the mesh, synchronously — nothing is fetched to know it. */
  #readHost(): void {
    try {
      const mesh = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(MESH_KEY) as MeshApi | undefined
      const host = mesh?.swarmHost?.()
      if (typeof host === 'string') this.#swarmHost.set(host)
    } catch { /* keep the last one */ }
  }

  /** The meeting point named in this tab's zone ('' = the default). */
  #readPoint(): void {
    this.#point.set(String(readMeshZone()?.relay ?? ''))
  }

  /** The swarm said its status for `location`, the page we stand on:
   *  "Sending…" shows once a frame of ours there has gone untaken for
   *  SENDING_AFTER_MS. TS-7: the swarm says its status again exactly when
   *  that age is reached, so restarting the count on every status meant the
   *  line never said it. A swarm that counts (`unackedMs`) gives the age
   *  itself; one that does not keeps the first time its untaken word was
   *  heard of, until the relay takes it. */
  #noteOffered(location: string, p: ShareStatus): void {
    const now = Date.now()
    const unacked = typeof p.unackedMs === 'number' && Number.isFinite(p.unackedMs) ? Math.max(0, p.unackedMs) : null
    const prev = this.#offered()
    let next: { location: string; at: number; exact: boolean } | null
    if (unacked !== null) {
      // Nothing of ours on its way: nothing to say. A frame already late
      // proves the swarm reports delivery even before its first OK.
      next = unacked > 0 ? { location, at: now - unacked, exact: true } : null
      if (unacked >= SENDING_AFTER_MS) this.#announceSeen.set(true)
    } else {
      if (p.taken === true) return
      const taken = this.#taken().get(location)
      const untaken = prev && prev.location === location && !prev.exact && !(taken !== undefined && taken >= prev.at)
      next = untaken ? prev : { location, at: now, exact: false }
    }
    if (next !== prev) this.#offered.set(next)
    this.#clock.set(now)
    if (this.#sendingTimer) { clearTimeout(this.#sendingTimer); this.#sendingTimer = null }
    if (next && next.at + SENDING_AFTER_MS > now) {
      this.#sendingTimer = setTimeout(() => { this.#sendingTimer = null; this.#clock.set(Date.now()) }, next.at + SENDING_AFTER_MS - now + 50)
    }
  }

  /** Hosts this device knows — the pool, the page's hosts, every host heard
   *  from — for the "did you mean …?" hint. Local reads only. */
  #knownHosts(): string[] {
    const out = new Set<string>()
    const add = (h: unknown): void => { const v = String(h ?? '').trim().toLowerCase(); if (v) out.add(v) }
    try {
      const hosts = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(HOSTS_KEY) as HostsApi | undefined
      for (const h of hosts?.swarmHosts?.() ?? []) add(h)
      for (const h of hosts?.publishNodes?.() ?? []) add(h)
      add(hosts?.publicHostDomain?.())
      add(hosts?.defaultPublicHostDomain?.())
    } catch { /* an older host-sync: the line's own hosts below */ }
    for (const h of this.#syncs().keys()) add(h)
    add(this.#swarmHost())
    const share = this.#share()
    for (const h of share?.hosts ?? []) add(h)
    for (const h of share?.passedOver ?? []) add(h)
    return [...out]
  }

  /** Where this page is, as the swarm hashes it (null on a swarm that does
   *  not say — the newest walk's status is then taken as this page's). */
  #readHere(): void {
    try {
      const segs = this.#swarm()?.currentSegments?.()
      if (Array.isArray(segs)) this.#hereLocation.set('/' + segs.join('/'))
    } catch { /* keep the last one */ }
  }

  /** The room-wide roster, from the presence payload and the swarm. */
  #readRoom(zonePeers?: readonly unknown[]): void {
    const swarm = this.#swarm()
    // The presence payload's rows carry each member's place; the swarm's
    // own reads fill in whatever a payload-less refresh (roster-changed)
    // did not bring.
    const zone = new Set<string>()
    const away = new Set<string>()
    for (const row of Array.isArray(zonePeers) ? zonePeers : []) {
      const [pk] = pubkeysOf([row])
      if (!pk) continue
      if ((row as { state?: unknown } | null)?.state === 'away') away.add(pk)
      else zone.add(pk)
    }
    try { for (const pk of pubkeysOf(swarm?.participantsInZone?.())) zone.add(pk) } catch { /* older swarm */ }
    try { for (const pk of pubkeysOf(swarm?.awayInZone?.())) away.add(pk) } catch { /* older swarm */ }
    for (const pk of away) zone.delete(pk)
    let older = 0
    try {
      const o = swarm?.peersOnOlderVersion?.()
      older = Array.isArray(o) ? o.length : Number(o ?? 0) || 0
    } catch { older = 0 }
    this.#zone.set([...zone])
    this.#away.set([...away])
    this.#older.set(older)
    this.#readHere()
  }

  /** Two-letter initials from a label. Two+ words → first letter of
   *  each of the first two words; one word → its first two characters.
   *  Codepoint-safe so emoji/astral names don't split mid-surrogate. */
  #initials(label: string): string {
    const parts = label.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (this.#head(parts[0]) + this.#head(parts[1])).toUpperCase()
    }
    return Array.from(parts[0] ?? '').slice(0, 2).join('').toUpperCase()
  }

  #head(s: string): string {
    return Array.from(s)[0] ?? ''
  }

  /** Fluorescent chip colour + glow, hashed from a seed so each
   *  identity gets a stable, distinct neon hue. */
  #chip(seed: string): { color: string; glow: string } {
    const hue = this.#hue(seed)
    return {
      color: `hsl(${hue} 100% 64%)`,
      glow: `0 0 6px hsl(${hue} 100% 58% / 0.7), 0 0 2px hsl(${hue} 100% 74% / 0.85)`,
    }
  }

  /** DJB2 → hue in [0, 360). */
  #hue(seed: string): number {
    let h = 5381
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
    }
    return h % 360
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-presence-banner',
  owner: '@hypercomb.shared/PresenceBannerComponent',
  component: PresenceBannerComponent,
  order: 330,
})
