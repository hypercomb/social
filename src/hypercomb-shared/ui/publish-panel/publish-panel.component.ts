// hypercomb-shared/ui/publish-panel/publish-panel.component.ts
//
// Right-docked "Staging" panel — TWO ACTS, NOTHING ELSE (jwize 2026-11-16: "you
// should have your own domain and the community separate since you are feeding
// the community from all domains including yourself. Then there are only on off
// no selected … This makes only two things you can do in the app here. Add to
// community through domains and publish live"):
//
//   YOUR COMMUNITY — apart, at the top, on your own domain. Everything switched
//   on in any domain stands in it: GRAY while it is only staged, LIT once it is
//   published live (the owners' signed showcase, what every visitor sees). A
//   press on a gray one publishes it live; a press on a lit one takes it out —
//   gray again, still on in its domains. A name with several versions (two
//   domains, two publishers) opens to its versions, and a press on one makes
//   that one the live one.
//
//   THE DOMAINS — yours first, then every host you carry. Press one and you are
//   in it: the creations, each a switch, ON or OFF. On STAGES it on that domain
//   (sealed, uploaded, its door opened) — and it is then gray in the community.
//   Locally, publishing is staging; publish is the community's word alone.
//
// ONE INPUT, always at the top: it searches whatever list is showing. And STAGE
// CHANGES under it: every staged creation on the list that has moved on from
// what its domains serve.
//
// Shell UI, so it must NOT import essentials. Everything arrives on the
// `publish:render` payload (the drone owns the read-model, every verdict and the
// community's live list) and leaves as intents: publish:doors, publish:run-many,
// publish:community, publish:inspect, publish:close.
//
// THE DISCIPLINE THIS SURFACE INHERITS: the drone never claims more than it can
// prove, and the panel must not undo that in the rendering. `unknown`,
// `cannot-compare` and `comparing` are QUIET — they are never a change, and the
// top button says "checking" rather than "nothing to stage" while they run.
// `gone` is the only 404-backed absence, and `forged` — a host serving an index
// that is not ours — is the ONE loud banner in the panel.
//
// The pure answers (what a domain hosts, the community's entries, the text
// match) are in publish-apps.ts.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { ChangeDetectionStrategy, Component, computed, effect, signal, viewChild, type ElementRef, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import {
  appsOn, communityEntries, communityNameKey, communityPress, hasChanges, lineageName, matchesQuery,
  type CommunityEntry, type CommunityVersion,
} from './publish-apps'

// Mirrors of the essentials read-model shapes (shared cannot import
// essentials): the fields THIS panel reads, identical to PublishRenderPayload
// in sharing/publish-status.drone.ts.
type PublishRowState =
  | 'live' | 'drift' | 'unpublished' | 'pending' | 'stale-edge'
  | 'gone' | 'unknown' | 'cannot-compare' | 'comparing'

type PublishIndexState =
  | 'ok' | 'none' | 'unreachable' | 'http' | 'malformed' | 'forged' | 'checking'

interface PublishRow {
  key: string
  path: string
  segments: string[]
  state: PublishRowState
  live: string | null
  /** Every root domain this branch claims, primary first. */
  zones: string[]
  /** Domains the signed index opens this branch on; null = every domain. */
  doors: string[] | null
  busyPhase: string | null
  /** zone → where this creation is shown there: the zone's root path by
   *  default, its own address when the signed index gives it one. */
  urls: Record<string, string>
  /** A domain this branch publishes to that takes none of its bytes, and why
   *  (unresolved, page, refused, full, unreachable); null when none. Optional:
   *  an older drone sends none. */
  hostTrouble?: { host: string; why: string } | null
  /** Drift published from another device: offered to take, never restaged
   *  over. Optional: an older drone sends none. */
  elsewhere?: boolean
}

/** Mirrors PublishCommunity in sharing/publish-status.drone.ts. */
interface CommunityPayload {
  zone: string
  read: 'ok' | 'none' | 'unreachable' | 'checking'
  live: { pubkey: string; lineage: string }[]
  offered: { name: string; pubkey: string; lineage: string; hosts: string[] }[]
  busy: string[]
}

interface PublishRenderPayload {
  open: boolean
  /** Your own domain — the public host you named; '' when none. */
  zone?: string
  /** The hosts this participant actually has — the domains the list shows. */
  hosts: string[]
  /** The row for the CURRENT PAGE — the tile you are standing on. */
  currentKey: string
  pubkey: string
  index: PublishIndexState
  refreshing: boolean
  rows: PublishRow[]
  /** The selected-apps run while it runs; null otherwise. */
  batch?: { done: number; total: number; failed: number } | null
  /** Optional: an older drone sends none. */
  community?: CommunityPayload
}

/** Where the drilldown is: one domain, the community, or one name's versions. */
type Drill =
  | { kind: 'domain'; zone: string }
  | { kind: 'showcase' }
  | { kind: 'versions'; name: string }

/** The word at the right end of a row: what is true of it right now. */
interface RowWord {
  key: string
  kind: 'busy' | 'changed' | 'gone'
}

/** The tile tree — the hive's one tile list, the same rows the AI chat's left
 *  sidebar draws. It lives in essentials (assistant/agent-tiles-rail.ts) and
 *  shared must never import essentials, so it arrives structurally through the
 *  factory it registers in IoC. */
type RailPickLike = { readonly key: string; readonly path: readonly string[]; readonly name: string }
type TilesRailLike = {
  onSubjectChanged: (subject: RailPickLike | null) => void
  readonly subject: RailPickLike | null
  mount(host: HTMLElement): void
  clearSubject(): void
  dispose(): void
}
type TilesRailFactoryLike = {
  create?: (profile?: {
    readonly walk?: boolean
    readonly chats?: boolean
    readonly choose?: boolean
    readonly badge?: (row: { readonly name: string; readonly segments: readonly string[] }) => number
  }) => TilesRailLike
}
const RAIL_KEY = '@diamondcoreprocessor.com/AgentTilesRailFactory'

const NO_COMMUNITY: CommunityPayload = { zone: '', read: 'checking', live: [], offered: [], busy: [] }

const pressKey = (event: KeyboardEvent, act: () => void): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  act()
}

@Component({
  selector: 'hc-publish-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [TranslatePipe, HcDockedPanelDirective],
  templateUrl: './publish-panel.component.html',
  styleUrls: ['./publish-panel.component.scss'],
})
export class PublishPanelComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Put away while the hive is covered, brought back on the way home —
   *  announced BOTH ways, because the drone holds the open flag: a park it
   *  never heard of let the next background render carry open:true and bring
   *  the panel back by itself. Not `publish:close` — parking hides a window,
   *  it does not end the preview or the sweep's subject. Transient: a park is
   *  a moment, never a state to replay to a drone that loads later. */
  readonly session = signalSession(
    this.visible,
    (open) => { EffectBus.emitTransient('publish:shown', { open }) },
    {
      // One level per press: the search, a level of the drilldown — then the window.
      dismiss: () => {
        if (this.query() !== '') { this.query.set(''); return true }
        if (this.drill()) { this.back(); return true }
        return false
      },
      close: () => this.close(),
    },
  )

  /** THE HOSTS YOU KNOW — the domains the list is made of. A domain is not
   *  typed here; whoever runs a host is a handshake in the host directory. */
  readonly hosts = signal<string[]>([])
  /** YOUR OWN DOMAIN — the public host you named, and your community's home. */
  readonly yourZone = signal('')
  readonly pubkey = signal('')
  readonly index = signal<PublishIndexState>('checking')
  readonly refreshing = signal(false)
  readonly rows = signal<PublishRow[]>([])
  readonly community = signal<CommunityPayload>(NO_COMMUNITY)

  /** THE CURRENT PAGE's row — the tile you are standing on. Walking to a tile
   *  selects it, which is why the pane needs no picker of its own. */
  readonly currentKey = signal('')
  readonly current = computed<PublishRow | null>(() =>
    this.rows().find(r => r.key === this.currentKey()) ?? null)

  /** Every domain you stage to — yours first, then the ones you carry, plus any
   *  the current tile already names: a door that is on must never be missing
   *  its row. */
  readonly domains = computed<string[]>(() => {
    const yours = this.yourZone()
    const rest = [...new Set([...this.hosts(), ...(this.current()?.zones ?? [])])].filter(z => z && z !== yours).sort()
    return yours ? [yours, ...rest] : rest
  })

  /** The selected-apps run while it runs (`publish:run-many`). */
  readonly batch = signal<{ done: number; total: number; failed: number } | null>(null)

  /** THE TILE TREE (left sidebar). Pressing a tile narrows the creations to
   *  that tile's branch; null = every creation. */
  readonly railHost = viewChild<ElementRef<HTMLDivElement>>('publishRail')
  readonly focus = signal<readonly string[] | null>(null)
  #rail: TilesRailLike | null = null

  clearFocus(): void {
    this.focus.set(null)
    this.#rail?.clearSubject()
  }

  #cleanups: (() => void)[] = []

  // ── THE ONE INPUT ─────────────────────────────────────────────────────

  /** The text the showing list is searched by. */
  readonly query = signal('')

  onInput(text: string): void {
    this.query.set(text)
  }

  clearQuery(): void {
    this.query.set('')
  }

  // ── THE TOP LEVEL: YOUR COMMUNITY, THEN THE DOMAINS ──────────────────────

  /** The domains the search leaves. */
  readonly visibleDomains = computed<string[]>(() => {
    const text = this.query()
    return this.domains().filter(zone => matchesQuery(text, zone))
  })

  /** How many creations a domain has staged on it. */
  hostedOn(zone: string): number {
    return appsOn(this.rows(), zone).length
  }

  isYours(zone: string): boolean {
    return zone === this.yourZone()
  }

  openDomain(zone: string): void {
    this.#open({ kind: 'domain', zone })
  }

  domainKey(zone: string, event: KeyboardEvent): void {
    pressKey(event, () => this.openDomain(zone))
  }

  openCommunity(): void {
    this.#open({ kind: 'showcase' })
  }

  communityKey(event: KeyboardEvent): void {
    pressKey(event, () => this.openCommunity())
  }

  // ── THE DRILLDOWN ──────────────────────────────────────────────────────

  /** Where the drilldown is; null = your community and the domains. */
  readonly drill = signal<Drill | null>(null)

  #open(drill: Drill): void {
    this.query.set('')
    this.drill.set(drill)
  }

  /** One level up: a name's versions go back to the community; anything else
   *  to the top. */
  back(): void {
    this.query.set('')
    this.drill.set(this.drill()?.kind === 'versions' ? { kind: 'showcase' } : null)
  }

  /** The domain the drilldown is in; '' outside one. */
  readonly scopeZone = computed<string>(() => {
    const drill = this.drill()
    return drill?.kind === 'domain' ? drill.zone : ''
  })

  /** Rows switched OFF from the list stay on it, dimmed, until the window
   *  closes: an off row is no longer hosted, so the drone's rows stop naming
   *  it, and a switch that vanished when pressed could not be pressed back.
   *  Keyed by the row's key; the value is the row as it was. */
  readonly #kept = signal<ReadonlyMap<string, PublishRow>>(new Map())

  /** The creations a domain lists: every one this hive can stage — the tile you
   *  are standing on (so an unstaged one can be switched on) and everything
   *  already staged — each on or off there. The search shortens it to the text. */
  readonly creations = computed<PublishRow[]>(() => {
    if (this.drill()?.kind !== 'domain') return []
    const rows = this.rows()
    const text = this.query()
    const found = new Map<string, PublishRow>()
    for (const row of rows) if (row.segments.length > 0) found.set(row.key, row)
    for (const [key, was] of this.#kept()) if (!found.has(key)) found.set(key, was)
    return [...found.values()]
      .filter(row => matchesQuery(text, this.appName(row)))
      .filter(row => this.#underFocus(row))
      .sort((a, b) => Number(b.key === this.currentKey()) - Number(a.key === this.currentKey()) || a.path.localeCompare(b.path))
  })

  /** Is this creation the focused tile, or somewhere under it? */
  #underFocus(row: PublishRow): boolean {
    const focus = this.focus()
    if (!focus || focus.length === 0) return true
    return focus.every((part, at) => row.segments[at] === part)
  }

  /** An app's name in the list — its path, so two tiles with one name under
   *  different pages never read as the same thing twice. */
  appName(row: PublishRow): string {
    return row.path.replace(/^\/+/, '') || row.key
  }

  /** The tile's own name — its last path label. */
  label(row: PublishRow): string {
    return row.path.split('/').filter(Boolean).pop() ?? ''
  }

  /** Where one creation lives on a domain: the drone's answer — its own
   *  address, else the host's implicit door where the host opens one, else ''
   *  (the domain has no address for it). For a domain the drone has not
   *  answered for yet, only the one case that needs no index: a top-level place
   *  whose key already is its subdomain label. The drone's own scheme is kept —
   *  a host on this machine is http. */
  addressUrl(row: PublishRow | null, zone: string): string {
    if (row?.urls && zone in row.urls) return row.urls[zone] ?? ''
    const parts = (row?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (parts.length === 0) return `https://${zone}`
    const key = row?.key ?? ''
    return parts.length === 1 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(key) ? `https://${key}.${zone}` : ''
  }

  /** The address as a person reads it — the link without its scheme. */
  address(row: PublishRow, zone: string): string {
    return this.addressUrl(row, zone).replace(/^https?:\/\//, '')
  }

  /** The domain itself is never shown twice: an app at its front page says so
   *  in a word. */
  isFrontPage(row: PublishRow, zone: string): boolean {
    return this.address(row, zone) === zone
  }

  // ── THE DOMAIN'S SWITCH: STAGE ON, OR OFF ────────────────────────────────

  /** Is this branch staged on this domain? Only while the signed index names
   *  it — and, when its entry lists doors, only on those. An entry with no
   *  doors opens everywhere (every index written before doors). */
  doorOn(row: PublishRow | null, zone: string): boolean {
    if (!row) return false
    const pressed = this.#pressed().get(`${row.key}\n${zone}`)
    if (pressed !== undefined) return pressed
    if (!row.live) return false
    return row.doors === null || row.doors.includes(zone)
  }

  /** On or off in the domain the drilldown is in. */
  isOn(row: PublishRow): boolean {
    return this.doorOn(row, this.scopeZone())
  }

  /** Switches shown the moment they are pressed. The first domain is a full
   *  stage and the last is a withdrawal; the signed index says so only when
   *  that lands, so the press answers for the switch until the drone has
   *  finished (see the settle effect) and the real state takes over. */
  readonly #pressed = signal<ReadonlyMap<string, boolean>>(new Map())
  /** Presses whose row has been seen mid-act, so the end of that act settles them. */
  readonly #pressedBusy = new Set<string>()

  #press(key: string, on: boolean): void {
    this.#pressed.update(m => new Map(m).set(key, on))
    // Never held longer than a drone can take: a press the drone refused falls back to the truth.
    const dropped = setTimeout(() => this.#release(key), 60_000)
    this.#cleanups.push(() => clearTimeout(dropped))
    // A press whose act never shows as busy was a paint alone (or refused).
    const unseen = setTimeout(() => { if (!this.#pressedBusy.has(key)) this.#release(key) }, 2_000)
    this.#cleanups.push(() => clearTimeout(unseen))
  }

  #release(key: string): void {
    this.#pressedBusy.delete(key)
    if (!this.#pressed().has(key)) return
    this.#pressed.update(m => { const next = new Map(m); next.delete(key); return next })
  }

  /** A row published from another device has no branch here to seal or
   *  withdraw, and a row mid-act or still comparing has nothing to flip yet. */
  canSwitch(row: PublishRow | null): boolean {
    return !!row && row.segments.length > 0 && !row.busyPhase && row.state !== 'comparing'
  }

  /** A creation pressed in a domain: off is staged on, on is taken off. The
   *  drone decides what it costs: a signed doors rewrite for a staged branch, a
   *  full stage for the first domain, a withdrawal for the last. The switch
   *  answers at once. */
  press(row: PublishRow): void {
    const zone = this.scopeZone()
    if (!zone || !this.canSwitch(row)) return
    const on = !this.doorOn(row, zone)
    this.#press(`${row.key}\n${zone}`, on)
    this.#kept.update(m => {
      const next = new Map(m)
      if (on) next.delete(row.key)
      else if (row.key !== this.currentKey()) next.set(row.key, { ...row, live: null, state: 'unpublished' })
      return next
    })
    EffectBus.emit('publish:doors', { key: row.key, zones: [zone], on })
  }

  /** HOME, HELD: published from another device — its card, and the code
   *  drafts it carries, can be taken into this hive (never restaged over). */
  canTake(row: PublishRow): boolean {
    return !!row.elsewhere && row.state === 'drift' && !row.busyPhase && this.isOn(row)
  }

  take(row: PublishRow, event: Event): void {
    event.stopPropagation()
    if (this.canTake(row)) EffectBus.emit('publish:take', { key: row.key })
  }

  rowKey(row: PublishRow, event: KeyboardEvent): void {
    pressKey(event, () => this.press(row))
  }

  /** What is true of a creation right now, in a word — or null for nothing to say. */
  wordOf(row: PublishRow): RowWord | null {
    if (row.busyPhase) return { key: 'publish.state.pending', kind: 'busy' }
    if (!this.isOn(row)) return null
    // Published from another device: the row offers Take it instead.
    if (row.state === 'drift' && !row.elsewhere) return { key: 'publish.apps.changed', kind: 'changed' }
    if (row.state === 'gone') return { key: 'publish.state.gone', kind: 'gone' }
    return null
  }

  /** The row's domain that takes none of its bytes, as its catalog key —
   *  "<branch>: <host> …" — or '' when every domain it uses takes them. */
  troubleKey(row: PublishRow): string {
    return row.hostTrouble ? `publish.host.${row.hostTrouble.why}` : ''
  }

  troubleParams(row: PublishRow): Record<string, string> {
    return {
      branch: row.segments[row.segments.length - 1] ?? row.path,
      host: row.hostTrouble?.host ?? '',
    }
  }

  /** Said under a creation that is on a domain which takes none of its bytes —
   *  when that domain is the one the drilldown is in. */
  troubleOn(row: PublishRow): boolean {
    const trouble = row.hostTrouble
    return !!trouble && trouble.host === this.scopeZone() && this.isOn(row)
  }

  // ── YOUR COMMUNITY: GRAY IS STAGED, LIT IS LIVE ──────────────────────────

  /** Everything feeding the community, one entry per name: this hive's
   *  creations on in any domain (staged), what the domains it follows offer,
   *  and what the signed showcase names live. */
  readonly #entries = computed<CommunityEntry[]>(() => {
    const domains = this.domains()
    const own = this.rows()
      .filter(row => row.segments.length > 0)
      .map(row => ({ pubkey: this.pubkey(), lineage: row.key, name: this.label(row) || lineageName(row.key), hosts: domains.filter(zone => this.doorOn(row, zone)) }))
      .filter(v => v.hosts.length > 0)
    const community = this.community()
    return communityEntries(this.pubkey(), own, community.offered, community.live)
  })

  /** The entries the search leaves — by name, or by a domain a version is on. */
  readonly communityList = computed<CommunityEntry[]>(() => {
    const text = this.query()
    return this.#entries().filter(entry => matchesQuery(text, entry.name, ...entry.versions.flatMap(v => v.hosts)))
  })

  /** How many names are live, and how many wait staged. */
  readonly communityCounts = computed<{ live: number; staged: number }>(() => {
    const entries = this.#entries()
    const live = entries.filter(e => e.live).length
    return { live, staged: entries.length - live }
  })

  /** The name whose versions are open, with its versions; null elsewhere. */
  readonly versionsOf = computed<CommunityEntry | null>(() => {
    const drill = this.drill()
    if (drill?.kind !== 'versions') return null
    return this.#entries().find(e => communityNameKey(e.name) === communityNameKey(drill.name)) ?? null
  })

  isBusy(version: CommunityVersion): boolean {
    return this.community().busy.includes(`${version.pubkey}\n${version.lineage}`)
  }

  entryBusy(entry: CommunityEntry): boolean {
    return entry.versions.some(v => this.isBusy(v))
  }

  /** A name pressed in the community: one version publishes live or comes out;
   *  several open to their versions. */
  pressEntry(entry: CommunityEntry): void {
    if (entry.versions.length > 1) { this.#open({ kind: 'versions', name: entry.name }); return }
    this.pressVersion(entry, entry.versions[0])
  }

  entryKey(entry: CommunityEntry, event: KeyboardEvent): void {
    pressKey(event, () => this.pressEntry(entry))
  }

  /** One version pressed: gray → live (the other versions of the name out with
   *  it), live → out, gray again. The drone signs it; the row says busy until
   *  the write lands. With no domain of your own named, the drone says so. */
  pressVersion(entry: CommunityEntry, version: CommunityVersion | undefined): void {
    if (!version || this.isBusy(version)) return
    EffectBus.emit('publish:community', communityPress(entry, version))
  }

  versionKey(entry: CommunityEntry, version: CommunityVersion, event: KeyboardEvent): void {
    pressKey(event, () => this.pressVersion(entry, version))
  }

  /** Where a version is on, as a person reads it. */
  versionWhere(version: CommunityVersion): string {
    return version.hosts.join(' · ')
  }

  // ── STAGE CHANGES ──────────────────────────────────────────────────────

  /** Every row the window is showing, once each: the creations in a domain;
   *  every creation staged anywhere (and the tile you stand on) elsewhere. */
  readonly #listed = computed<PublishRow[]>(() =>
    this.drill()?.kind === 'domain' ? this.creations() : this.rows().filter(row => row.segments.length > 0))

  /** A sweep re-reads every row, and until it reaches one nothing is known
   *  about it — a button must not say there are no changes. */
  readonly checking = computed<boolean>(() =>
    this.refreshing() || this.#listed().some(row => row.state === 'comparing'))

  /** Everything on the list that has moved on from what its domains serve —
   *  not a row already being staged by its own press, and in a domain only
   *  what is on there. */
  readonly changed = computed<PublishRow[]>(() =>
    this.#listed().filter(row => hasChanges(row) && !row.elsewhere && !row.busyPhase && (this.drill()?.kind !== 'domain' || this.isOn(row))))

  /** STAGE CHANGES, at the top: every changed creation on the list, one after
   *  another (the drone runs them deepest first). */
  stageChanges(): void {
    const keys = this.changed().map(row => row.key)
    if (this.batch() || keys.length === 0) return
    EffectBus.emit('publish:run-many', { keys })
  }

  // ── the header ────────────────────────────────────────────────────────

  /** THE ONE LOUD BANNER: a host serving an index that does not verify against
   *  our key is not an outage, it is somebody else's index. */
  readonly forged = computed(() => this.index() === 'forged')

  /** Why a domain's list is empty when it is: no key to sign with, a first read
   *  still running, or the hive root, which is no tile. */
  hereHint(): string {
    if (!this.pubkey()) return 'publish.failure.no-signer'
    if (this.refreshing() && this.rows().length === 0) return 'publish.header.index-checking'
    return 'publish.here.root'
  }

  /** Is the list shorter than it would be? */
  readonly shortened = computed<boolean>(() => this.query().trim() !== '')

  constructor() {
    // A press settles when the act it started has ended: seen busy, then idle.
    effect(() => {
      const rows = this.rows()
      for (const press of this.#pressed().keys()) {
        const row = rows.find(r => r.key === press.split('\n')[0])
        if (row?.busyPhase) this.#pressedBusy.add(press)
        else if (this.#pressedBusy.has(press)) this.#release(press)
      }
    })

    // The left sidebar. Its host exists only while the window is open, so
    // this re-fires as the window comes and goes; the rail is made once and
    // re-mounted. Essentials may register the factory AFTER this window is up
    // (web loads its bees from OPFS), so a miss waits on the key.
    effect(() => {
      const host = this.railHost()?.nativeElement
      if (!host) return
      if (this.#rail) { this.#rail.mount(host); return }
      const registry = (window as { ioc?: { get?(k: string): unknown; whenReady?(k: string, cb: (v: unknown) => void): void } }).ioc
      const bring = (factory: TilesRailFactoryLike | undefined): void => {
        if (this.#rail || !factory?.create) return
        const rail = factory.create({ walk: true, chats: false, choose: false, badge: () => 0 })
        rail.onSubjectChanged = subject => this.focus.set(subject ? [...subject.path] : null)
        this.#rail = rail
        const live = this.railHost()?.nativeElement
        if (live) rail.mount(live)
      }
      const now = registry?.get?.(RAIL_KEY) as TilesRailFactoryLike | undefined
      if (now) bring(now)
      else registry?.whenReady?.(RAIL_KEY, value => bring(value as TilesRailFactoryLike))
    })

    this.#cleanups.push(EffectBus.on<PublishRenderPayload>('publish:render', (p) => {
      if (!p) return
      this.hosts.set(Array.isArray(p.hosts) ? p.hosts.map(String).filter(Boolean) : [])
      this.yourZone.set(String(p.zone ?? '').toLowerCase())
      this.pubkey.set(String(p.pubkey ?? ''))
      const nextCurrent = String(p.currentKey ?? '')
      // Walking to another tile re-aims the pane.
      // Decided here, SENT LAST: the drone may answer an inspect with a
      // render synchronously (a row with no live head), and that render
      // re-enters this handler. Asking before the key and the visibility were
      // recorded made every re-entry look like a new subject — an endless
      // inspect/render loop that overflowed the stack and killed publishing.
      // Only while the window shows: the drone keeps the list current with
      // the window closed (renders carry open:false), and a walk made then is
      // asked about when the window next opens.
      const inspect = !!nextCurrent && p.open === true && (nextCurrent !== this.currentKey() || !this.visible())
      this.currentKey.set(nextCurrent)
      this.index.set(this.#normIndex(p.index))
      this.refreshing.set(p.refreshing === true)
      // The drone progressively mutates its internal rows as observations
      // land. Never retain those objects in the Angular view: an async state
      // transition could otherwise happen between Angular's render and its
      // development-mode verification pass (NG0100). Every bus payload is a
      // stable UI snapshot, field by field.
      this.rows.set(Array.isArray(p.rows)
        ? p.rows.map((row): PublishRow => ({
            key: String(row.key ?? ''),
            path: String(row.path ?? ''),
            segments: Array.isArray(row.segments) ? row.segments.map(String) : [],
            state: row.state,
            live: row.live ?? null,
            zones: Array.isArray(row.zones) ? row.zones.map(String) : [],
            doors: Array.isArray(row.doors) ? row.doors.map(String) : null,
            busyPhase: row.busyPhase ?? null,
            urls: { ...(row.urls ?? {}) },
            hostTrouble: row.hostTrouble ? { host: String(row.hostTrouble.host ?? ''), why: String(row.hostTrouble.why ?? '') } : null,
          }))
        : [])
      this.community.set(this.#normCommunity(p.community))
      this.batch.set(p.batch ? { done: Number(p.batch.done) || 0, total: Number(p.batch.total) || 0, failed: Number(p.batch.failed) || 0 } : null)
      // No sibling is closed here — the lane decides what fits on an edge and
      // parks whatever it displaces. A parked window keeps where it was.
      this.visible.set(!!p.open)
      if (inspect) EffectBus.emit('publish:inspect', { key: nextCurrent })
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#rail?.dispose()
    this.#rail = null
  }

  // ── the intents ───────────────────────────────────────────────────

  /** Closed from its own button: the window forgets where it was — the top
   *  level, nothing kept, nothing typed. */
  close(): void {
    this.visible.set(false)
    this.#reset()
    EffectBus.emit('publish:close', {})
  }

  /** Back to the top, with nothing kept or typed. */
  #reset(): void {
    if (this.#kept().size > 0) this.#kept.set(new Map())
    if (this.drill()) this.drill.set(null)
    if (this.focus()) this.clearFocus()
    if (this.query() !== '') this.query.set('')
  }

  #normIndex(value: unknown): PublishIndexState {
    const known: PublishIndexState[] = ['ok', 'none', 'unreachable', 'http', 'malformed', 'forged', 'checking']
    return known.includes(value as PublishIndexState) ? value as PublishIndexState : 'checking'
  }

  /** A field-by-field copy of the community, like the rows. */
  #normCommunity(raw: CommunityPayload | undefined): CommunityPayload {
    if (!raw) return NO_COMMUNITY
    const reads: CommunityPayload['read'][] = ['ok', 'none', 'unreachable', 'checking']
    const item = (v: { pubkey?: unknown; lineage?: unknown }): { pubkey: string; lineage: string } =>
      ({ pubkey: String(v?.pubkey ?? '').toLowerCase(), lineage: String(v?.lineage ?? '') })
    return {
      zone: String(raw.zone ?? '').toLowerCase(),
      read: reads.includes(raw.read) ? raw.read : 'checking',
      live: Array.isArray(raw.live) ? raw.live.map(item).filter(v => v.pubkey && v.lineage) : [],
      offered: Array.isArray(raw.offered)
        ? raw.offered.map(o => ({ ...item(o), name: String(o?.name ?? ''), hosts: Array.isArray(o?.hosts) ? o.hosts.map(String) : [] })).filter(v => v.pubkey && v.lineage)
        : [],
      busy: Array.isArray(raw.busy) ? raw.busy.map(String) : [],
    }
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts). 145 sits between Observe (140)
// and the clipboard panel (150): both neighbours are read-only status windows,
// and no registration in shared or essentials claims it.
registerShellSurface({
  name: 'hc-publish-panel',
  owner: '@hypercomb.shared/PublishPanelComponent',
  component: PublishPanelComponent,
  order: 145,
})
