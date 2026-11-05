// hypercomb-shared/ui/publish-panel/publish-panel.component.ts
//
// Right-docked "Publish" panel — a DRILLDOWN (jwize 2026-11-04):
//
//   THE DOMAINS — the hosts you carry, about two thirds of the window, and under
//   them a shorter list of NAMED GROUPS, each a saved set of domains. Press a
//   domain (or a group) and you are in it.
//
//   MANY AT ONCE — hold Ctrl (⌘) and click several domains; the moment you let
//   go, their creations open together. A set you want again is saved as a group
//   from there.
//
//   THE CREATIONS — a list, each one a switch: on = published on the domain (or
//   on every domain of the set), off = not. Across a set a creation can be MIXED
//   — live on some of the domains and not the others — and then Sync makes it
//   all on or all off. That is the whole window.
//
// ONE INPUT, always at the top: it searches whatever list is showing, and after
// "Save as group" it takes the group's name, with a button to add it. And
// PUBLISH CHANGES under it: every creation on the list that has moved on from
// what the world is served.
//
// The switch is signed (the drone writes the doors into the hive index), and one
// creation across a set of domains is ONE index write (`publish:doors`).
//
// Shell UI, so it must NOT import essentials. Everything arrives on the
// `publish:render` payload (the drone owns the read-model and every verdict) and
// the `hosts:render` payload (the groups), and leaves as intents: publish:doors,
// publish:run-many, publish:inspect, publish:close, hosts:group-save,
// hosts:group-remove.
//
// THE DISCIPLINE THIS SURFACE INHERITS: the drone never claims more than it can
// prove, and the panel must not undo that in the rendering. `unknown`,
// `cannot-compare` and `comparing` are QUIET — they are never a change, and the
// top button says "checking" rather than "nothing to publish" while they run.
// `gone` is the only 404-backed absence, and `forged` — a host serving an index
// that is not ours — is the ONE loud banner in the panel.
//
// The pure answers (what a domain hosts, a creation's state across a set, the
// text match) are in publish-apps.ts.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { ChangeDetectionStrategy, Component, computed, effect, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import { isTransientMode } from '../../core/view-mode.service'
import { appsOn, hasChanges, matchesQuery, scopeState, wantAfterPress, zonesToMove, type ScopeState } from './publish-apps'

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
}

interface PublishRenderPayload {
  open: boolean
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
}

/** A named set of domains — mirrors `HostGroup` in sharing/community-hosts.ts. */
interface HostGroupRow { name: string; zones: string[] }

/** Where the drilldown is: the domains it covers, what it is called, and the
 *  saved group it is, when it is one (its domains then follow the group). */
interface Drill { zones: string[]; title: string; group: string | null }

/** The word at the right end of a row: what is true of it right now. */
interface RowWord {
  key: string
  kind: 'busy' | 'changed' | 'gone'
}

const isMultiPress = (event: Event): boolean => {
  const press = event as MouseEvent | KeyboardEvent
  return press.ctrlKey || press.metaKey
}

@Component({
  selector: 'hc-publish-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
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
      // One level per press: a group being named, the search, the domains held
      // for opening, a level of the drilldown — then the window.
      dismiss: () => {
        if (this.naming()) { this.cancelNaming(); return true }
        if (this.query() !== '') { this.query.set(''); return true }
        if (this.chosen().size > 0) { this.chosen.set(new Set()); return true }
        if (this.drill()) { this.back(); return true }
        return false
      },
      close: () => this.close(),
    },
  )

  /** THE HOSTS YOU KNOW — the domains the list is made of. A domain is not
   *  typed here; whoever runs a host is a handshake in the host directory. */
  readonly hosts = signal<string[]>([])
  readonly pubkey = signal('')
  readonly index = signal<PublishIndexState>('checking')
  readonly refreshing = signal(false)
  readonly rows = signal<PublishRow[]>([])

  /** THE CURRENT PAGE's row — the tile you are standing on. Walking to a tile
   *  selects it, which is why the pane needs no picker of its own. */
  readonly currentKey = signal('')
  readonly current = computed<PublishRow | null>(() =>
    this.rows().find(r => r.key === this.currentKey()) ?? null)

  /** Every domain you publish to: the ones you carry, plus any the current
   *  tile already names — a door that is on must never be missing its row. */
  readonly domains = computed<string[]>(() =>
    [...new Set([...this.hosts(), ...(this.current()?.zones ?? [])])].sort())

  /** Your named groups of domains, as the hosts drone renders them. */
  readonly groups = signal<HostGroupRow[]>([])

  /** The selected-apps run while it runs (`publish:run-many`). */
  readonly batch = signal<{ done: number; total: number; failed: number } | null>(null)

  /** OVER A VIEW IT IS A POPUP (jwize 2026-10-10) — `p` reaches this panel
   *  from inside a view, and there it floats on the page: it reserves no edge
   *  (the view keeps its width under it) and the scss rounds all four corners.
   *  The same question the shells ask for `body.hc-view-covered`. */
  readonly overView = signal(false)

  #cleanups: (() => void)[] = []

  // ── THE ONE INPUT ─────────────────────────────────────────────────────

  /** The text the showing list is searched by. */
  readonly query = signal('')
  /** A group is being named: the input takes its name instead of searching. */
  readonly naming = signal(false)
  readonly groupName = signal('')
  /** What the input shows — the search, or the group's name while naming. */
  readonly inputValue = computed(() => this.naming() ? this.groupName() : this.query())

  onInput(text: string): void {
    if (this.naming()) this.groupName.set(text)
    else this.query.set(text)
  }

  /** Enter in the input adds the group while one is being named. */
  onEnter(): void {
    if (this.naming()) this.addGroup()
  }

  clearQuery(): void {
    this.query.set('')
  }

  /** While a group is being named the text is its name, not a search. */
  readonly #text = computed<string>(() => this.naming() ? '' : this.query())

  // ── THE DOMAINS, AND UNDER THEM THE GROUPS ───────────────────────────────

  /** Domains held (Ctrl/⌘-click) to be opened together when the key is let go. */
  readonly chosen = signal<ReadonlySet<string>>(new Set())

  /** The domains the search leaves. */
  readonly visibleDomains = computed<string[]>(() => {
    const text = this.#text()
    return this.domains().filter(zone => matchesQuery(text, zone))
  })

  /** The groups the search leaves — by name, or by a domain they hold. */
  readonly visibleGroups = computed<HostGroupRow[]>(() => {
    const text = this.#text()
    return this.groups().filter(g => matchesQuery(text, g.name, ...g.zones))
  })

  /** How many creations a domain hosts. */
  hostedOn(zone: string): number {
    return appsOn(this.rows(), zone).length
  }

  isChosen(zone: string): boolean {
    return this.chosen().has(zone)
  }

  /** A domain pressed: Ctrl/⌘ holds it for opening together, a plain press
   *  opens it on its own. */
  pressDomain(zone: string, event: Event): void {
    if (isMultiPress(event)) {
      const next = new Set(this.chosen())
      if (next.has(zone)) next.delete(zone)
      else next.add(zone)
      this.chosen.set(next)
      return
    }
    this.chosen.set(new Set())
    this.#open([zone], zone, null)
  }

  domainKey(zone: string, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.pressDomain(zone, event)
  }

  /** The held domains, in the order the list shows them. */
  #openChosen(): void {
    const held = this.domains().filter(zone => this.chosen().has(zone))
    this.chosen.set(new Set())
    if (held.length === 0) return
    this.#open(held, held.length === 1 ? held[0] : '', null)
  }

  openGroup(group: HostGroupRow): void {
    this.chosen.set(new Set())
    this.#open([...group.zones], group.name, group.name)
  }

  /** Forget a group. The domains in it, and what is published to them, stay. */
  removeGroup(group: HostGroupRow, event: Event): void {
    event.stopPropagation()
    EffectBus.emit('hosts:group-remove', { name: group.name })
    if (this.drill()?.group === group.name) this.back()
  }

  groupKey(group: HostGroupRow, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.openGroup(group)
  }

  // ── THE DRILLDOWN ──────────────────────────────────────────────────────

  /** Where the drilldown is; null = the list of domains. */
  readonly drill = signal<Drill | null>(null)

  #open(zones: string[], title: string, group: string | null): void {
    this.query.set('')
    this.cancelNaming()
    this.drill.set({ zones, title, group })
  }

  back(): void {
    this.cancelNaming()
    this.query.set('')
    this.drill.set(null)
  }

  /** The domains the drilldown covers: a group's follow the group. */
  readonly scopeZones = computed<string[]>(() => {
    const drill = this.drill()
    if (!drill) return []
    if (drill.group) {
      const held = this.groups().find(g => g.name === drill.group)
      if (held) return held.zones
    }
    return drill.zones
  })

  /** What the drilldown is called: the domain, the group, or how many domains. */
  readonly scopeTitle = computed<string>(() => {
    const drill = this.drill()
    if (!drill) return ''
    return drill.title || (this.scopeZones().length === 1 ? this.scopeZones()[0] : '')
  })

  /** Rows switched OFF from the list stay on it, dimmed, until the window
   *  closes: an off row is no longer hosted, so the drone's rows stop naming
   *  it, and a switch that vanished when pressed could not be pressed back.
   *  Keyed by the row's key; the value is the row as it was. */
  readonly #kept = signal<ReadonlyMap<string, PublishRow>>(new Map())

  /** The creations the drilldown lists: every one this hive can publish — the
   *  tile you are standing on (so an unpublished one can be switched on) and
   *  everything already published — switched on or off across the scope. The
   *  search shortens it to the text. */
  readonly creations = computed<PublishRow[]>(() => {
    if (!this.drill()) return []
    const rows = this.rows()
    const text = this.#text()
    const found = new Map<string, PublishRow>()
    for (const row of rows) if (row.segments.length > 0) found.set(row.key, row)
    for (const [key, was] of this.#kept()) if (!found.has(key)) found.set(key, was)
    return [...found.values()]
      .filter(row => matchesQuery(text, this.appName(row)))
      .sort((a, b) => Number(b.key === this.currentKey()) - Number(a.key === this.currentKey()) || a.path.localeCompare(b.path))
  })

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

  // ── THE SWITCH ─────────────────────────────────────────────────────────

  /** Is this branch published on this domain? Only while the signed index
   *  names it — and, when its entry lists doors, only on those. An entry with
   *  no doors opens everywhere (every index written before doors). */
  doorOn(row: PublishRow | null, zone: string): boolean {
    if (!row) return false
    const pressed = this.#pressed().get(`${row.key}\n${zone}`)
    if (pressed !== undefined) return pressed
    if (!row.live) return false
    return row.doors === null || row.doors.includes(zone)
  }

  /** How a creation stands across the drilldown's domains: on, off, or mixed. */
  stateOf(row: PublishRow): ScopeState {
    return scopeState(this.scopeZones(), zone => this.doorOn(row, zone))
  }

  /** How many of the scope's domains a creation is on. */
  onCount(row: PublishRow): number {
    return this.scopeZones().filter(zone => this.doorOn(row, zone)).length
  }

  /** Switches shown the moment they are pressed. The first domain is a full
   *  publish and the last is a withdrawal; the signed index says so only when
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

  /** A creation pressed: off goes on across the domains, on goes off, and a mix
   *  is synced to on. */
  press(row: PublishRow): void {
    this.#move(row, wantAfterPress(this.stateOf(row)))
  }

  rowKey(row: PublishRow, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.press(row)
  }

  /** SYNC — a mixed creation made one thing or the other, on every domain. */
  sync(row: PublishRow, on: boolean, event: Event): void {
    event.stopPropagation()
    this.#move(row, on)
  }

  /** Move a creation to `on` across the scope — only the domains not already
   *  there — as ONE intent. The drone decides what it costs: a signed doors
   *  rewrite for a published branch, a full publish for the first domain, a
   *  withdrawal for the last. The switch answers at once. */
  #move(row: PublishRow, on: boolean): void {
    if (!this.canSwitch(row)) return
    const zones = zonesToMove(this.scopeZones(), zone => this.doorOn(row, zone), on)
    if (zones.length === 0) return
    for (const zone of zones) this.#press(`${row.key}\n${zone}`, on)
    this.#kept.update(m => {
      const next = new Map(m)
      if (on) next.delete(row.key)
      else if (row.key !== this.currentKey()) next.set(row.key, { ...row, live: null, state: 'unpublished' })
      return next
    })
    EffectBus.emit('publish:doors', { key: row.key, zones, on })
  }

  /** What is true of a creation right now, in a word — or null for nothing to say. */
  wordOf(row: PublishRow): RowWord | null {
    if (row.busyPhase) return { key: 'publish.state.pending', kind: 'busy' }
    if (this.stateOf(row) === 'off') return null
    if (row.state === 'drift') return { key: 'publish.apps.changed', kind: 'changed' }
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
   *  when that domain is one of the scope's (or the only one there is). */
  troubleOn(row: PublishRow): boolean {
    const trouble = row.hostTrouble
    if (!trouble) return false
    const zones = this.scopeZones()
    return (zones.includes(trouble.host) && this.doorOn(row, trouble.host)) || (this.domains().length === 1 && this.stateOf(row) !== 'off')
  }

  // ── PUBLISH CHANGES ────────────────────────────────────────────────────

  /** Every row the window is showing, once each: the creations in a drilldown;
   *  every creation published anywhere (and the tile you stand on) at the top. */
  readonly #listed = computed<PublishRow[]>(() =>
    this.drill() ? this.creations() : this.rows().filter(row => row.segments.length > 0))

  /** A sweep re-reads every row, and until it reaches one nothing is known
   *  about it — a button must not say there are no changes. */
  readonly checking = computed<boolean>(() =>
    this.refreshing() || this.#listed().some(row => row.state === 'comparing'))

  /** Everything on the list that has moved on from what the world is served —
   *  not a row already being published by its own press, and in a drilldown only
   *  what is live on the scope's domains. */
  readonly changed = computed<PublishRow[]>(() =>
    this.#listed().filter(row => hasChanges(row) && !row.busyPhase && (!this.drill() || this.stateOf(row) !== 'off')))

  /** PUBLISH CHANGES, at the top: every changed creation on the list, one after
   *  another (the drone runs them deepest first). */
  publishChanges(): void {
    const keys = this.changed().map(row => row.key)
    if (this.batch() || keys.length === 0) return
    EffectBus.emit('publish:run-many', { keys })
  }

  // ── A GROUP FROM A SET OF DOMAINS ────────────────────────────────────────

  /** A set gathered by ctrl-selection can be kept: two or more domains, not
   *  already a saved group. */
  readonly canSaveGroup = computed<boolean>(() => {
    const drill = this.drill()
    return !!drill && !drill.group && this.scopeZones().length >= 2
  })

  /** Save as group pressed: the one input takes the group's name. */
  startNaming(): void {
    if (!this.canSaveGroup()) return
    this.groupName.set('')
    this.naming.set(true)
    queueMicrotask(() => document.querySelector<HTMLInputElement>('hc-publish-panel .psearch-input')?.focus())
  }

  cancelNaming(): void {
    this.naming.set(false)
    this.groupName.set('')
  }

  readonly canAddGroup = computed<boolean>(() => this.naming() && this.groupName().trim() !== '' && this.canSaveGroup())

  /** Add the group: these domains, under the typed name. It then shows in the
   *  list under the domains, and the drilldown becomes it. */
  addGroup(): void {
    if (!this.canAddGroup()) return
    const name = this.groupName().trim()
    const zones = [...this.scopeZones()]
    EffectBus.emit('hosts:group-save', { name, zones })
    this.drill.set({ zones, title: name, group: name })
    this.cancelNaming()
  }

  // ── the header ────────────────────────────────────────────────────────

  /** THE ONE LOUD BANNER: a host serving an index that does not verify against
   *  our key is not an outage, it is somebody else's index. */
  readonly forged = computed(() => this.index() === 'forged')

  /** Why the list is empty when it is: no key to sign with, a first read still
   *  running, or the hive root, which is no tile. */
  hereHint(): string {
    if (!this.pubkey()) return 'publish.failure.no-signer'
    if (this.refreshing() && this.rows().length === 0) return 'publish.header.index-checking'
    return 'publish.here.root'
  }

  /** Is the list shorter than it would be? */
  readonly shortened = computed<boolean>(() => this.#text().trim() !== '')

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

    // LET GO OF CTRL (⌘) and the domains held open together, right then.
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== 'Control' && event.key !== 'Meta') return
      if (this.visible() && !this.drill() && this.chosen().size > 0) this.#openChosen()
    }
    window.addEventListener('keyup', onKeyUp)
    this.#cleanups.push(() => window.removeEventListener('keyup', onKeyUp))

    const viewMode = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<EventTarget & { mode?: string }>('@hypercomb.social/ViewMode')
    if (viewMode?.addEventListener) {
      const onView = (): void => this.overView.set(isTransientMode(viewMode.mode ?? ''))
      onView()
      viewMode.addEventListener('change', onView)
      this.#cleanups.push(() => viewMode.removeEventListener('change', onView))
    }

    // THE GROUPS come from the hosts drone, which owns the domains they name.
    this.#cleanups.push(EffectBus.on<{ groups?: unknown }>('hosts:render', (p) => {
      const held = Array.isArray(p?.groups) ? p!.groups as { name?: unknown; zones?: unknown }[] : []
      this.groups.set(held
        .map(g => ({ name: String(g?.name ?? ''), zones: Array.isArray(g?.zones) ? g.zones.map(String).filter(Boolean) : [] }))
        .filter(g => g.name !== '' && g.zones.length > 0))
    }))

    this.#cleanups.push(EffectBus.on<PublishRenderPayload>('publish:render', (p) => {
      if (!p) return
      this.hosts.set(Array.isArray(p.hosts) ? p.hosts.map(String).filter(Boolean) : [])
      this.pubkey.set(String(p.pubkey ?? ''))
      const nextCurrent = String(p.currentKey ?? '')
      // Walking to another tile re-aims the pane.
      // Decided here, SENT LAST: the drone may answer an inspect with a
      // render synchronously (a row with no live head), and that render
      // re-enters this handler. Asking before the key and the visibility were
      // recorded made every re-entry look like a new subject — an endless
      // inspect/render loop that overflowed the stack and killed publishing.
      const inspect = !!nextCurrent && (nextCurrent !== this.currentKey() || (!this.visible() && p.open === true))
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
      this.batch.set(p.batch ? { done: Number(p.batch.done) || 0, total: Number(p.batch.total) || 0, failed: Number(p.batch.failed) || 0 } : null)
      // No sibling is closed here — the lane decides what fits on an edge and
      // parks whatever it displaces. A parked window keeps where it was.
      this.visible.set(!!p.open)
      if (inspect) EffectBus.emit('publish:inspect', { key: nextCurrent })
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  // ── the intents ───────────────────────────────────────────────────

  /** Closed from its own button: the window forgets where it was — the list of
   *  domains, nothing held, nothing kept. */
  close(): void {
    this.visible.set(false)
    this.#reset()
    EffectBus.emit('publish:close', {})
  }

  /** Back to the list of domains, with nothing held, kept or typed. */
  #reset(): void {
    if (this.#kept().size > 0) this.#kept.set(new Map())
    if (this.chosen().size > 0) this.chosen.set(new Set())
    if (this.drill()) this.drill.set(null)
    this.cancelNaming()
    if (this.query() !== '') this.query.set('')
  }

  #normIndex(value: unknown): PublishIndexState {
    const known: PublishIndexState[] = ['ok', 'none', 'unreachable', 'http', 'malformed', 'forged', 'checking']
    return known.includes(value as PublishIndexState) ? value as PublishIndexState : 'checking'
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
