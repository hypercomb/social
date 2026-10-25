// hypercomb-shared/ui/publish-panel/publish-panel.component.ts
//
// Right-docked "Publish" panel — the read-only face of the publish
// DIFFERENTIAL: what the world is serving, next to what has changed here
// since. `/publish` toggles it (PublishStatusDrone answers with
// `publish:render`); the rail launcher is the optional second opener.
//
// Shell UI, so it must NOT import essentials. Everything arrives on the
// `publish:render` payload (the drone owns the read-model, the online proof
// and every verdict) and leaves as intents: publish:refresh, publish:inspect,
// publish:run, publish:unpublish, publish:copy-link, publish:close.
//
// THE DISCIPLINE THIS SURFACE INHERITS — and the reason its copy is so
// carefully hedged: the drone never claims more than it can prove, and the
// panel must not undo that in the rendering.
//
//   • `unknown` (offline, CORS, 5xx, breaker) and `cannot-compare` (a cold
//     child, so the local head cannot be sealed) are QUIET — dim light, grey
//     text, an "as of" age. Never a red light, never the word error. Nothing
//     was asserted, so nothing is claimed.
//   • `gone` is the only 404-backed absence, and `forged` — a host serving an
//     index that is not ours — is the ONE loud banner in the panel.
//   • `comparing` rows paint straight away and fill in progressively. They sit
//     in a LEADING, unlabelled block rather than in one of the four sections:
//     a row whose verdict has not landed cannot honestly be filed under "Live"
//     or "Changed here", and putting it in either would invent a difference
//     (or a confirmation) out of a computation still running.
//
// THE LAYER YOU ARE ON, like behaviours (Jaime, 2026-09-22): the heading is
// the tile, and under it every domain you carry is ONE switch — on = this
// branch is published there, off = it is not. The switch is signed: it writes
// the branch's doors into the hive index, and the host serves a page only on
// the domains listed there.
//
// WHAT EACH DOMAIN HOSTS (jwize 2026-10-24, superseding 09-22's "no list of
// branches"): "each of these should be expandable to see the applications
// hosted on each domain there shouldn't be any duplicate values". A domain
// opens — one at a time, the shell's accordion — on what is published there,
// each by its path and its address there, never the domain twice; a name
// walks to its tile, where the details are (still never in a list row).
// "Each should be … selectable to publish changes only on selected … reset on
// refresh so you can have them available to create a group and then publish
// to it as well": the selection lives in memory only, and from it the
// changed apps publish one after another (`publish:run-many`) or, when they
// share a page, become a publish group there (`publish-groups:create`).
// The answers are pure, in publish-apps.ts.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, computed, inject, signal, type OnDestroy } from '@angular/core'
import { DomSanitizer, type SafeHtml, type SafeResourceUrl } from '@angular/platform-browser'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import { accordion } from '../accordion'
import { isTransientMode } from '../../core/view-mode.service'
import { appsOn, groupCoverage, groupPage, hasChanges, inGroup, othersOn, pickedAfterPress, pruneSelection, selectedRows, shownAt } from './publish-apps'

const isShift = (event?: Event): boolean => !!(event as MouseEvent | KeyboardEvent | undefined)?.shiftKey

// Mirrors of the essentials read-model shapes (shared cannot import
// essentials). Kept field-for-field identical to PublishRenderPayload in
// sharing/publish-status.drone.ts.
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
  here: string | null
  publishedAt: number | null
  seenAt: number | null
  gaps: string[]
  link: string | null
  /** Every root domain this branch claims, primary first. */
  zones: string[]
  /** Domains the signed index opens this branch on; null = every domain. */
  doors: string[] | null
  busyPhase: string | null
  /** The view the branch ROOT opens as ('' = hexagons) — view:default mark. */
  opensAs: string
  /** Published heads, newest first — a version IS a signature. */
  versions: { sig: string; at: number }[]
  /** OPTIMIZE — the published arrival plan (IoC keys); null = whole package. */
  plan: string[] | null
  /** zone → where this creation is shown there: the zone's root path by
   *  default, its own address when the signed index gives it one. */
  urls: Record<string, string>
  /** zone → the own-address label it holds there (absent = root path). */
  ownLabels: Record<string, string>
  /** The tile's name folded to a DNS label — where an own address starts. */
  defaultLabel: string
  /** host → the entrance each address this creation is served at runs —
   *  its own addresses, never a domain's root. */
  entrances: Record<string, PublishEntrance>
  /** A domain this branch publishes to that takes none of its bytes, and why
   *  (unresolved, page, refused, full, unreachable); null when none. Optional:
   *  an older drone sends none. */
  hostTrouble?: { host: string; why: string } | null
}

/** Mirrors PublishEntrance in sharing/publish-status.drone.ts. */
interface PublishEntrance {
  /** The domain the address sits under. */
  zone: string
  /** The page the address runs (H), or null. */
  page: string | null
  /** H runs with its powers on. */
  powered: boolean
  from: { pubkey: string; lineage: string } | null
  /** The card page this tile wears here now. */
  wears: string | null
  /** A newer page the followed head wears, not skipped. */
  offered: string | null
  /** The community's scents on H — read only. */
  scents: { pubkey: string; verdict: string; at: number; own: boolean }[]
  /** Versions put away with Skip, for this address: the page, and the
   *  signature of its skip record (Show again names it). */
  skipped: { page: string; sig: string }[]
}

/** Mirrors the `publish-groups:render` payload of
 *  essentials/sharing/publish-groups.drone.ts — shared cannot import it. */
interface PublishGroupRow {
  meaning: string
  name: string
  icon: string
  color: string
  count: number
  /** Its members' names on the page. Optional: an older drone sends none. */
  members?: string[]
  publishing: { done: number; total: number } | null
}

interface PublishViewChoice {
  view: string
  label: string
  icon: string
  /** The behaviour is not lit in the global roster — offered to nobody, kept
   *  only so a row already pinned to it can still show and un-pin it. */
  dormant?: boolean
}

/** Mirrors ConcealedItem in essentials/concealment/concealment.ts — shared
 *  cannot import essentials, so the shape is kept field-for-field by hand. */
interface HiddenItem {
  sig: string
  scope: string
  label: string
  from: string
  deletable: boolean
}

/** Mirrors HiddenRenderPayload in concealment/concealment.drone.ts. */
interface HiddenRenderish {
  items?: HiddenItem[]
  gone?: string[]
}

/** The scope this panel's rows are hidden under, so the delete area can tell
 *  a published version from a host's build. */
const VERSION_SCOPE = 'publish-version'

interface PublishCollision {
  key: string
  paths: string[]
}

interface PublishRenderPayload {
  open: boolean
  host: string
  /** The ROOT domain of the target — writes go there, and a creation lives
   *  at its root path unless it is given an own address. */
  zone: string
  /** The hosts this participant actually has — the pick-list. */
  hosts: string[]
  /** The row for the CURRENT PAGE — the panel's one subject. */
  currentKey: string
  pubkey: string
  index: PublishIndexState
  indexCreatedAt: number
  indexStale: boolean
  keyMismatch: boolean
  refreshing: boolean
  rows: PublishRow[]
  collisions: PublishCollision[]
  views: PublishViewChoice[]
  /** OPTIMIZE — the features readers never load, and whether the published
   *  snapshot matches them. */
  participantOnly?: string[]
  participantState?: 'published' | 'changed' | 'none'
  /** The page being previewed — a blob: URL of its exact bytes. */
  entrancePreview?: { host: string; page: string; url: string } | null
  /** Pages previewed this session; Turn on is offered for these only. */
  previewed?: string[]
  /** The selected-apps run while it runs; null otherwise. */
  batch?: { done: number; total: number; failed: number } | null
}

const SIG_SHOWN = 12

/** Gaps are "at least this many holes"; five is enough to refuse a green
 *  light without turning the row into a list. */
const GAPS_SHOWN = 5

/** The IoC slice used to walk to a row's branch. */
type NavigationLike = { go?: (segments: readonly string[]) => void }

@Component({
  selector: 'hc-publish-panel',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './publish-panel.component.html',
  styleUrls: ['./publish-panel.component.scss', './publish-panel.groups.scss', './publish-panel.apps.scss'],
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
      // One level per press: a selection clears, then an open domain closes,
      // then the window does.
      dismiss: () => {
        const open = this.domainsOpen.open()
        if (open !== null) {
          this.#keepFocusOn(open)
          return this.domainsOpen.dismiss()
        }
        if (this.picked().size > 0) { this.clearPicks(); return true }
        if (this.groupPicks().size > 0) { this.groupPicks.set(new Set()); return true }
        if (this.groupFilter().size > 0) { this.clearGroupFilter(); return true }
        return false
      },
      close: () => this.close(),
    },
  )

  /** The STANDING default zone — what a branch that never chose rides. */
  readonly zone = signal('')
  /** THE HOSTS YOU KNOW. A domain is not typed — it is one of these. A
   *  hostname nobody runs is an address that never answers, so the panel
   *  offers the participant's actual hosts and the branch picks among them.
   *  Gaining a NEW host is a consent handshake with whoever runs it, not a
   *  spelling exercise in a properties pane.
   *
   *  The panel never touches the setting itself — a pick leaves as a
   *  `publish:set-target` intent carrying the row's key and its full list;
   *  the drone validates, and a refusal comes back as a toast with nothing
   *  moved, which is the honest outcome. */
  readonly hosts = signal<string[]>([])
  readonly pubkey = signal('')
  /** Every domain you publish to: the ones you carry, plus any the current
   *  tile already names — a door that is on must never be missing its row. */
  readonly domains = computed<string[]>(() =>
    [...new Set([...this.hosts(), ...(this.current()?.zones ?? [])])].sort())
  readonly index = signal<PublishIndexState>('checking')
  readonly indexCreatedAt = signal(0)
  readonly indexStale = signal(false)
  readonly keyMismatch = signal(false)
  readonly refreshing = signal(false)
  readonly rows = signal<PublishRow[]>([])
  readonly collisions = signal<PublishCollision[]>([])
  /** Opens-as choices from the drone — svg sanitized ONCE per payload, never
   *  in a template helper (change detection would re-trust every check). */
  readonly views = signal<{ view: string; label: string; icon: SafeHtml; dormant: boolean }[]>([])
  /** OPTIMIZE — the participant-only features, and whether readers have them. */
  readonly participantOnly = signal<string[]>([])
  readonly participantState = signal<'published' | 'changed' | 'none'>('none')
  /** The text being typed into the Optimize fields, keyed by row / 'features'. */
  readonly optimizeDraft = signal<Record<string, string>>({})
  /** Where each row's last trial arrival opened, keyed by row. */
  readonly optimizeTried = signal<Record<string, string>>({})
  /** THE ENTRANCE PREVIEW — the drone's blob: URL with `#<host>` as its
   *  fragment (the page reads its address from it off https), trusted ONCE
   *  per URL so a re-render never reloads the frame. */
  readonly entrancePreview = signal<{ host: string; page: string; url: string; src: SafeResourceUrl } | null>(null)
  /** Pages previewed this session — the only ones Turn on may name. */
  readonly previewed = signal<ReadonlySet<string>>(new Set())
  readonly #sanitizer = inject(DomSanitizer)
  /** A deliberately coarse render clock. Template helpers must not call
   *  Date.now() themselves: Angular's development check renders twice and a
   *  minute boundary between those reads would make identical input appear
   *  to change during one check. */
  readonly renderedAt = signal(Date.now())

  /** THE CURRENT PAGE's row — where the panel opens. Walking to a tile
   *  selects it, which is why the pane needs no picker of its own. */
  readonly currentKey = signal('')
  readonly current = computed<PublishRow | null>(() =>
    this.rows().find(r => r.key === this.currentKey()) ?? null)

  /** LIKE BEHAVIOURS: the panel is about the layer you are standing on and
   *  nothing else — one switch, publish on or off. Its details (opens as,
   *  versions, status) fold below, one section open at a time — the shell
   *  standard (ui/accordion.ts), all closed by default. The hive is the list:
   *  walk to another branch and the panel follows. */
  readonly sectionsOpen = accordion()

  /** PUBLISH GROUPS on the layer you stand on, as their drone announces them
   *  (`publish-groups:render`): a group publishes from here as it does from
   *  the strip — and from inside a view, where the strip is not drawn. */
  readonly #groups = signal<{ segments: string[]; groups: PublishGroupRow[] }>({ segments: [], groups: [] })
  /** Only the groups of the page this panel is describing — an announcement
   *  for a layer we have already left never shows here. The hive root is a
   *  page too: a group made there from the domains' apps shows, and
   *  publishes, from here. */
  readonly groupsHere = computed<PublishGroupRow[]>(() => {
    const here = this.current()?.segments ?? (this.currentKey() ? null : [])
    const { segments, groups } = this.#groups()
    return here && here.join('/') === segments.join('/') ? groups : []
  })

  // ── WHAT EACH DOMAIN HOSTS ──────────────────────────────────────────

  /** The one domain open on its apps — one at a time, like every list of
   *  headers in the shell (ui/accordion.ts). */
  readonly domainsOpen = accordion()

  /** The apps picked to act on — in memory only: a reload clears it. Keys are
   *  rows' lineage keys, so a pick survives the drone rebuilding its rows. */
  readonly picked = signal<ReadonlySet<string>>(new Set())

  /** The selected-apps run while it runs (`publish:run-many`). */
  readonly batch = signal<{ done: number; total: number; failed: number } | null>(null)

  /** What one domain hosts: each published app once, by path. */
  appsOn(zone: string): PublishRow[] {
    return appsOn(this.rows(), zone)
  }

  /** What another device published there — counted and named, never picked. */
  othersOn(zone: string): PublishRow[] {
    return othersOn(this.rows(), zone)
  }

  /** THE TWO TABS (jwize 2026-10-24): the list, and this page's groups. */
  readonly tab = signal<'list' | 'groups'>('list')

  /** THE GROUPS THE LIST IS SHORTENED TO — their meanings. Filter in the
   *  Groups tab sets them; they read only while those groups are on this
   *  page, so walking away shows every app again. */
  readonly groupFilter = signal<ReadonlySet<string>>(new Set())
  readonly filterGroups = computed<PublishGroupRow[]>(() =>
    this.groupsHere().filter(g => this.groupFilter().has(g.meaning)))

  /** What a domain's list shows: its apps, or only the filter groups'. */
  appsShown(zone: string): PublishRow[] {
    const groups = this.filterGroups()
    const apps = this.appsOn(zone)
    if (groups.length === 0) return apps
    const members = groups.flatMap(g => g.members ?? [])
    return apps.filter(row => inGroup(row, this.#groups().segments, members))
  }

  /** Another device's entries belong to no group here. */
  othersShown(zone: string): PublishRow[] {
    return this.filterGroups().length > 0 ? [] : this.othersOn(zone)
  }

  isFiltering(group: PublishGroupRow): boolean {
    return this.groupFilter().has(group.meaning)
  }

  /** Filter: the list shortened to these groups' members, opened on the
   *  first tab at the first domain that hosts one. */
  filterTo(groups: readonly PublishGroupRow[]): void {
    if (groups.length === 0) return
    this.groupFilter.set(new Set(groups.map(g => g.meaning)))
    this.groupPicks.set(new Set())
    this.tab.set('list')
    const open = this.domainsOpen.open()
    if (open === null || this.appsShown(open).length === 0) {
      const zone = this.domains().find(z => this.appsShown(z).length > 0)
      if (zone) this.domainsOpen.reveal(zone)
    }
  }

  clearGroupFilter(): void {
    this.groupFilter.set(new Set())
  }

  /** The groups picked in the Groups tab — in memory only, like app picks. */
  readonly groupPicks = signal<ReadonlySet<string>>(new Set())
  readonly pickedGroupRows = computed<PublishGroupRow[]>(() =>
    this.groupsHere().filter(g => this.groupPicks().has(g.meaning)))
  #groupAnchor: string | null = null

  isGroupPicked(group: PublishGroupRow): boolean {
    return this.groupPicks().has(group.meaning)
  }

  /** A group row pressed: picked or let go; Shift picks the run from the last. */
  pickGroup(group: PublishGroupRow, event?: Event): void {
    const keys = this.groupsHere().map(g => g.meaning)
    this.groupPicks.set(pickedAfterPress(this.groupPicks(), keys, group.meaning, this.#groupAnchor, isShift(event)))
    this.#groupAnchor = group.meaning
  }

  /** The groups the picked apps can go into — the ones on the page they all
   *  sit on, while this panel knows that page's groups. */
  readonly pickedGroups = computed<PublishGroupRow[]>(() => {
    const page = this.pickedPage()
    const { segments, groups } = this.#groups()
    return page && page.segments.join('/') === segments.join('/') ? groups : []
  })

  /** Are the picked apps all in this group already (a press takes them out),
   *  some of them, or none? */
  pickedCoverage(group: PublishGroupRow): 'all' | 'some' | 'none' {
    return groupCoverage(this.pickedPage()?.members ?? [], group.members ?? [])
  }

  /** The picked apps into this group — or out of it, when all are in. */
  togglePickedGroup(group: PublishGroupRow): void {
    const page = this.pickedPage()
    if (!page || this.batch()) return
    EffectBus.emit('publish-groups:join', { segments: page.segments, meaning: group.meaning, members: page.members })
  }

  /** Everything a domain hosts, from here or not. */
  hostedOn(zone: string): number {
    return this.appsOn(zone).length + this.othersOn(zone).length
  }

  /** An app's name in a domain's list — its path, so two tiles with one name
   *  under different pages never read as the same thing twice. */
  appName(row: PublishRow): string {
    return row.path.replace(/^\/+/, '') || row.key
  }

  /** Where an app is read on a domain, as a word when the address would only
   *  repeat something already on screen: the domain itself (an app at its
   *  front page), or the tile you stand on (its address is the line above).
   *  '' = no address there yet. */
  appAt(row: PublishRow, zone: string): { at: string } | { word: string } | null {
    if (row.key === this.currentKey()) return { word: 'publish.apps.this-tile' }
    const at = shownAt(row, zone)
    if (!at) return null
    return at === zone ? { word: 'publish.apps.front-page' } : { at }
  }

  /** The address as the drone gave it — its own scheme (a host on this
   *  machine is http), never one the panel makes up. */
  appUrl(row: PublishRow, zone: string): string {
    return String(row.urls?.[zone] ?? '')
  }

  appChanged(row: PublishRow): boolean {
    return hasChanges(row)
  }

  /** The line under a domain's name. At the hive root it says how many apps
   *  it hosts — its address would only be the domain again. On a tile it is
   *  where that tile is read there, unless that is the domain itself. */
  domainLine(zone: string): { kind: 'count'; count: number } | { kind: 'at'; at: string } | { kind: 'none' } | null {
    const row = this.current()
    if (!row) return { kind: 'count', count: this.hostedOn(zone) }
    const at = this.address(row, zone)
    if (at === zone) return null
    return at ? { kind: 'at', at } : { kind: 'none' }
  }

  toggleDomain(zone: string): void {
    this.domainsOpen.toggle(zone)
  }

  isPicked(row: PublishRow): boolean {
    return this.picked().has(row.key)
  }

  #pickAnchor: string | null = null

  /** An app row pressed — ROW SELECT, as the shell's other lists: picked or
   *  let go; Shift picks the run from the last row pressed in this list. */
  pickRow(row: PublishRow, list: readonly PublishRow[], event?: Event): void {
    if (row.segments.length === 0) return
    const keys = list.filter(r => r.segments.length > 0).map(r => r.key)
    this.picked.set(pickedAfterPress(this.picked(), keys, row.key, this.#pickAnchor, isShift(event)))
    this.#pickAnchor = row.key
  }

  clearPicks(): void {
    this.picked.set(new Set())
  }

  /** Clear, from its own button — which goes with the bar, so focus moves to
   *  something that stays. */
  clearPicksFromBar(): void {
    this.clearPicks()
    queueMicrotask(() => document.querySelector<HTMLElement>('hc-publish-panel .pcur-hosts-manage')?.focus())
  }

  /** A list about to close holds focus: hand it to its domain's chevron
   *  first, or the next key goes to the hive behind the panel. */
  #keepFocusOn(zone: string): void {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !active.closest('hc-publish-panel .papps-host')) return
    const chevron = [...document.querySelectorAll<HTMLElement>('hc-publish-panel .pdoor-expand')]
      .find(el => el.dataset['zone'] === zone)
    chevron?.focus()
  }

  /** The picked apps as they stand now. */
  readonly pickedRows = computed<PublishRow[]>(() => selectedRows(this.rows(), this.picked()))
  /** The picked apps that have changes to publish — not one already being
   *  published by its own press. */
  readonly pickedChanged = computed<PublishRow[]>(() => this.pickedRows().filter(row => hasChanges(row) && !row.busyPhase))
  /** A sweep re-reads every row, and until it reaches a picked one nothing is
   *  known about it — the bar must not say it has no changes. */
  readonly pickedChecking = computed<boolean>(() =>
    this.refreshing() || this.pickedRows().some(row => row.state === 'comparing'))
  /** A group of this page is publishing — its runs and the picked ones would
   *  both re-sign the index, so one waits for the other. */
  readonly groupPublishing = computed<boolean>(() => this.groupsHere().some(g => !!g.publishing))
  /** The page a group of the picked apps would sit on, or null when they do
   *  not share one (a group holds one page's tiles). */
  readonly pickedPage = computed(() => groupPage(this.pickedRows()))

  /** Publish the picked apps' changes — the drone runs them one after another. */
  publishPicked(): void {
    const keys = this.pickedChanged().map(row => row.key)
    if (this.batch() || this.groupPublishing() || keys.length === 0) return
    EffectBus.emit('publish:run-many', { keys })
  }

  /** Make a publish group of the picked apps, on the page they share; it then
   *  publishes from the Groups section like any group. */
  groupPicked(): void {
    const page = this.pickedPage()
    if (!page || this.batch()) return
    EffectBus.emit('publish-groups:create', { segments: page.segments, members: page.members })
    // The picks are the group now; a second press would make a second group.
    this.clearPicks()
    // A group shows on its own page — where the strip is drawn and Groups
    // lists it. Picks from another page walk there, so it can be published.
    const here = this.current()?.segments ?? []
    if (here.join('/') !== page.segments.join('/')) {
      const nav = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<NavigationLike>('@hypercomb.social/Navigation')
      nav?.go?.([...page.segments])
    }
  }

  /** OVER A VIEW IT IS A POPUP (jwize 2026-10-10) — `p` reaches this panel
   *  from inside a view, and there it floats on the page: it reserves no edge
   *  (the view keeps its width under it) and the scss rounds all four corners.
   *  The same question the shells ask for `body.hc-view-covered`. */
  readonly overView = signal(false)

  #cleanups: (() => void)[] = []

  /** The row's own name — its last path label, which IS its subdomain. */
  label(row: PublishRow): string {
    return row.path.split('/').filter(Boolean).pop() ?? ''
  }

  /** Is the full ledger open? Closed by default: the answer to "which version
   *  is out there" is ONE row, and a standing list of every head this branch
   *  ever published is scrollback, not an answer. The rest is a click away. */
  readonly versionsOpen = signal(false)

  /** The version rows to render: the serving one alone, or the whole ledger.
   *  A branch with no live head yet has nothing to single out, so it opens
   *  showing its newest — there is no "active" to collapse to. */
  versionsShown(row: PublishRow): { sig: string; at: number }[] {
    const versions = this.versionsOf(row)
    if (this.versionsOpen()) return versions
    const live = versions.find(v => v.sig === row.live)
    return live ? [live] : versions.slice(0, 1)
  }

  /**
   * This branch's versions, minus the ones you put away.
   *
   * HIDE FIRST, DELETE SECOND — the same doctrine the host ledger follows, and
   * the same pool behind it. A version list grows with every publish and old
   * heads never stop being valid, so putting one away has to be an ordinary,
   * reversible act; deleting is in the delete area below and nowhere else.
   */
  versionsOf(row: PublishRow): { sig: string; at: number }[] {
    const concealed = this.concealed()
    return concealed.size === 0 ? row.versions : row.versions.filter(v => !concealed.has(v.sig))
  }

  /** Versions you have put away, this panel's scope only. */
  readonly hidden = signal<HiddenItem[]>([])
  /** Every signature not to list — hidden AND deleted. */
  readonly concealed = signal<Set<string>>(new Set())
  /** Is the delete area open? Closed by default: somewhere you go. */
  readonly hiddenOpen = signal(false)

  /** What you put away on THIS branch. */
  hiddenFor(row: PublishRow): HiddenItem[] {
    return this.hidden().filter(i => i.from === row.path)
  }

  toggleHiddenArea(): void {
    this.hiddenOpen.set(!this.hiddenOpen())
  }

  /** Put one version away. The live head is never on offer to hide — the row
   *  that answers "what is out there right now" cannot be the one you lose. */
  hideVersion(row: PublishRow, version: { sig: string; at: number }): void {
    if (version.sig === row.live) return
    EffectBus.emit('hidden:conceal', {
      sig: version.sig,
      scope: VERSION_SCOPE,
      label: `${this.label(row) || row.path} ${this.age(version.at)}`,
      from: row.path,
      // A published head is on the host and in your own history; forgetting
      // the row forgets a listing, never the version.
      deletable: true,
    })
  }

  restoreVersion(item: HiddenItem): void {
    EffectBus.emit('hidden:reveal', { sig: item.sig })
  }

  /** Forget a version listing for good — locally. The pool refuses anything
   *  that was not hidden first, so this cannot be reached from the list. */
  destroyVersion(item: HiddenItem): void {
    if (!item.deletable) return
    EffectBus.emit('hidden:delete', { sig: item.sig })
  }

  /** How many the fold is holding back — 0 means the toggle would say
   *  nothing. NOT the same as hidden: the fold is a view of the list, hiding
   *  is a thing you did to a version. */
  versionsFolded(row: PublishRow): number {
    return Math.max(0, this.versionsOf(row).length - this.versionsShown(row).length)
  }

  /** Is this branch published on this domain? Only while the signed index
   *  names it — and, when its entry lists doors, only on those. An entry with
   *  no doors opens everywhere (every index written before doors). */
  doorOn(row: PublishRow | null, zone: string): boolean {
    if (!row?.live) return false
    return row.doors === null || row.doors.includes(zone)
  }

  /** One domain's switch. The drone decides what the flip costs: a signed
   *  doors rewrite for a published branch, a full publish for the first
   *  domain, a withdrawal for the last. */
  flipDoor(row: PublishRow | null, zone: string): void {
    if (!row || !this.canSwitch(row)) return
    EffectBus.emit('publish:door', { key: row.key, zone, on: !this.doorOn(row, zone) })
  }

  /** The address as a person reads it — the link without its scheme. */
  address(row: PublishRow | null, zone: string): string {
    return this.addressUrl(row, zone).replace(/^https?:\/\//, '')
  }

  /** Where ONE creation lives on a domain: the drone's answer — its own
   *  address, else the host's implicit door where the host opens one, else ''
   *  (the domain has no address for it until it is given its own). For a
   *  domain the drone has not answered for yet, only the one case that needs
   *  no index: a top-level place whose key already is its subdomain label.
   *  The host maps the label to the place verbatim, and root paths are off,
   *  so anything else would open "nothing published here". The hive root is
   *  the zone itself. */
  addressUrl(row: PublishRow | null, zone: string): string {
    if (row?.urls && zone in row.urls) return row.urls[zone] ?? ''
    const parts = (row?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (parts.length === 0) return `https://${zone}`
    const key = row?.key ?? ''
    return parts.length === 1 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(key) ? `https://${key}.${zone}` : ''
  }

  // ── OWN ADDRESS ──────────────────────────────────────────────────────
  // A creation lives at its domain's root path. Given an own address, it is
  // also `<label>.<zone>` — a signed entry in the hive index, written by the
  // drone (it checks the label; `content` and `try-*` are the host's).

  /** Which domain's own-address editor is open, keyed by `<row key> <zone>`. */
  readonly ownOpen = signal('')
  /** The label being typed, per editor. */
  readonly ownDraft = signal<Record<string, string>>({})

  #ownSlot(row: PublishRow, zone: string): string { return `${row.key} ${zone}` }

  ownLabel(row: PublishRow | null, zone: string): string {
    return row?.ownLabels?.[zone] ?? ''
  }

  isOwnOpen(row: PublishRow | null, zone: string): boolean {
    return !!row && this.ownOpen() === this.#ownSlot(row, zone)
  }

  toggleOwn(row: PublishRow | null, zone: string): void {
    if (!row) return
    const slot = this.#ownSlot(row, zone)
    this.ownOpen.set(this.ownOpen() === slot ? '' : slot)
  }

  ownValue(row: PublishRow, zone: string): string {
    const held = this.ownDraft()[this.#ownSlot(row, zone)]
    return held ?? (this.ownLabel(row, zone) || row.defaultLabel || '')
  }

  setOwnDraft(row: PublishRow, zone: string, text: string): void {
    const slot = this.#ownSlot(row, zone)
    this.ownDraft.update(all => ({ ...all, [slot]: text }))
  }

  /** Save the typed label as this creation's own address on `zone`. */
  saveOwn(row: PublishRow, zone: string): void {
    if (row.busyPhase) return
    const label = this.ownValue(row, zone).trim().toLowerCase()
    if (!label || !this.#mayMoveAddress(row, zone, label)) return
    EffectBus.emit('publish:own-address', { key: row.key, zone, label })
    this.ownOpen.set('')
  }

  /** The bare domain opens on this place (`@`, the zone apex); the host card
   *  moves to host.<zone>. */
  saveApex(row: PublishRow, zone: string): void {
    if (row.busyPhase || !this.#mayMoveAddress(row, zone, '@')) return
    EffectBus.emit('publish:own-address', { key: row.key, zone, label: '@' })
    this.ownOpen.set('')
  }

  /** Back to the root path on `zone` — the own address is dropped. */
  clearOwn(row: PublishRow, zone: string): void {
    if (row.busyPhase || !this.#mayMoveAddress(row, zone, null)) return
    EffectBus.emit('publish:own-address', { key: row.key, zone, label: null })
    this.ownOpen.set('')
  }

  /** A creation holds ONE own address per domain, and an entrance lives only
   *  while its address is bound — so moving, clearing or turning the address
   *  into the domain's front page (`@`) takes the entrance of the address it
   *  leaves with it: no page runs there with powers until one is turned on
   *  again. Asked first, as Forget is: true when no page runs there or the
   *  participant agrees. The implicit `<key>.<zone>` stays bound without an
   *  own address. */
  #mayMoveAddress(row: PublishRow, zone: string, label: string | null): boolean {
    const current = this.ownLabel(row, zone)
    if (!current) return true
    const leaving = current === '@' ? zone : `${current}.${zone}`
    const next = label === '@' ? zone : label ? `${label}.${zone}` : ''
    if (leaving === next || leaving === `${row.key}.${zone}`) return true
    if (!this.entranceOf(row, leaving)?.page) return true
    const i18n = window.ioc?.get<{ t?: (k: string, p?: Record<string, string>) => string }>('@hypercomb.social/I18n')
    const question = i18n?.t?.('publish.entrance.unbind-confirm', { host: leaving })
      ?? `${leaving} runs its own page. Moving this address takes that entrance with it, and no page runs at ${leaving} with powers until you turn one on there again. Move it anyway?`
    return window.confirm(question)
  }

  // ── THE ENTRANCES (each app address) ────────────────────────────────
  // Powers are off by default, and the participant turns them on, for the
  // one page they previewed, at an address of its own — never at a domain's
  // root, which stays a plain front door (documentation/using-a-creation.md).
  // The drone writes the signed index; the panel only names the acts. None of
  // these intents is open to the bridge.

  entranceOf(row: PublishRow | null, host: string): PublishEntrance | null {
    return row?.entrances?.[host] ?? null
  }

  /** The addresses under `zone` this row runs an entrance at, in order. */
  entranceHostsOn(row: PublishRow | null, zone: string): string[] {
    return Object.entries(row?.entrances ?? {}).filter(([, e]) => e.zone === zone).map(([host]) => host).sort()
  }

  /** Some address under `zone` has a newer page on offer. */
  entranceOfferedOn(row: PublishRow | null, zone: string): boolean {
    return this.entranceHostsOn(row, zone).some(host => !!this.entranceOf(row, host)?.offered)
  }

  /** The preview open for THIS address, if any. */
  previewFor(host: string): { page: string; src: SafeResourceUrl } | null {
    const preview = this.entrancePreview()
    return preview && preview.host === host ? preview : null
  }

  /** Show a page in a frame sandboxed to scripts alone. */
  previewEntrance(row: PublishRow, host: string, page: string | null): void {
    if (!page) return
    EffectBus.emit('publish:entrance-preview', { key: row.key, host, page })
  }

  closeEntrancePreview(row: PublishRow, host: string): void {
    EffectBus.emit('publish:entrance-preview', { key: row.key, host, page: '' })
  }

  /** Turn on is offered only for the exact page previewed here, this session,
   *  and only when it would change what the address runs. */
  canTurnOn(row: PublishRow, host: string): boolean {
    const preview = this.previewFor(host)
    const entrance = this.entranceOf(row, host)
    if (!preview || !entrance || row.busyPhase || !this.previewed().has(preview.page)) return false
    return !(entrance.powered && entrance.page === preview.page)
  }

  turnOn(row: PublishRow, host: string): void {
    const preview = this.previewFor(host)
    if (!preview || !this.canTurnOn(row, host)) return
    EffectBus.emit('publish:entrance', { key: row.key, host, on: true, page: preview.page })
  }

  turnOff(row: PublishRow, host: string): void {
    if (row.busyPhase || !this.entranceOf(row, host)?.powered) return
    EffectBus.emit('publish:entrance', { key: row.key, host, on: false })
  }

  /** Put the offered version away; the next newer one is still offered. */
  skipEntrance(row: PublishRow, host: string): void {
    const offered = this.entranceOf(row, host)?.offered
    if (!offered) return
    EffectBus.emit('publish:entrance-skip', { key: row.key, host, page: offered })
  }

  /** Forget the entrance entirely — asked first, in the participant's words. */
  forgetEntrance(row: PublishRow, host: string): void {
    if (row.busyPhase) return
    const i18n = window.ioc?.get<{ t?: (k: string, p?: Record<string, string>) => string }>('@hypercomb.social/I18n')
    const question = i18n?.t?.('publish.entrance.forget-confirm', { host })
      ?? `Forget the entrance of ${host}?`
    if (!window.confirm(question)) return
    EffectBus.emit('publish:entrance', { key: row.key, host, forget: true })
  }

  /** The scents line: none yet, or a tally. */
  scentsKey(entrance: PublishEntrance): string {
    return entrance.scents.length === 0 ? 'publish.entrance.scents-none' : 'publish.entrance.scents'
  }

  scentParams(entrance: PublishEntrance): Record<string, number> {
    const count = (verdict: string): number => entrance.scents.filter(s => s.verdict === verdict).length
    return { accept: count('accept'), refuse: count('refuse'), unclear: count('unclear') }
  }

  /** Your own reading, as its catalog key — '' when you have none. */
  ownVerdictKey(entrance: PublishEntrance): string {
    const verdict = entrance.scents.find(s => s.own)?.verdict ?? ''
    return ['accept', 'refuse', 'unclear'].includes(verdict) ? `publish.entrance.verdict.${verdict}` : ''
  }

  /** Bring a skipped version back: it leaves the put-away list, and the
   *  Publish panel may offer it again. */
  showAgain(sig: string): void {
    EffectBus.emit('hidden:reveal', { sig })
  }

  constructor() {
    const ageTimer = setInterval(() => this.renderedAt.set(Date.now()), 15_000)
    this.#cleanups.push(() => clearInterval(ageTimer))

    const viewMode = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<EventTarget & { mode?: string }>('@hypercomb.social/ViewMode')
    if (viewMode?.addEventListener) {
      const onView = (): void => this.overView.set(isTransientMode(viewMode.mode ?? ''))
      onView()
      viewMode.addEventListener('change', onView)
      this.#cleanups.push(() => viewMode.removeEventListener('change', onView))
    }

    // WHAT HAS BEEN PUT AWAY — the same pool and the same owner the host
    // ledger reads, so hiding means one thing across the shell.
    this.#cleanups.push(EffectBus.on<HiddenRenderish>('hidden:render', (p) => {
      const items = (p?.items ?? []).filter(i => i?.scope === VERSION_SCOPE)
      this.hidden.set(items)
      this.concealed.set(new Set([...items.map(i => i.sig), ...(p?.gone ?? [])]))
    }))

    this.#cleanups.push(EffectBus.on<{ segments?: unknown; groups?: unknown }>('publish-groups:render', (p) => {
      const segments = Array.isArray(p?.segments) ? p!.segments.map(s => String(s ?? '')).filter(Boolean) : []
      const groups = Array.isArray(p?.groups) ? p!.groups as PublishGroupRow[] : []
      this.#groups.set({ segments, groups })
    }))

    this.#cleanups.push(EffectBus.on<PublishRenderPayload>('publish:render', (p) => {
      if (!p) return
      this.zone.set(String(p.zone ?? '') || String(p.host ?? ''))
      this.hosts.set(Array.isArray(p.hosts) ? p.hosts.map(String).filter(Boolean) : [])
      this.pubkey.set(String(p.pubkey ?? ''))
      const nextCurrent = String(p.currentKey ?? '')
      // Walking to another tile re-aims the pane. A selection made by hand
      // survives repeated renders of the SAME page, so a refresh mid-edit does
      // not yank the subject out from under the address being typed.
      // Decided here, SENT LAST: the drone may answer an inspect with a
      // render synchronously (a row with no live head), and that render
      // re-enters this handler. Asking before the key and the visibility were
      // recorded made every re-entry look like a new subject — an endless
      // inspect/render loop that overflowed the stack and killed publishing.
      const inspect = !!nextCurrent && (nextCurrent !== this.currentKey() || (!this.visible() && p.open === true))
      this.currentKey.set(nextCurrent)
      this.index.set(this.#normIndex(p.index))
      this.indexCreatedAt.set(Number(p.indexCreatedAt ?? 0) || 0)
      this.indexStale.set(p.indexStale === true)
      this.keyMismatch.set(p.keyMismatch === true)
      this.refreshing.set(p.refreshing === true)
      // The drone progressively mutates its internal rows as observations
      // land. Never retain those objects in the Angular view: an async state
      // transition could otherwise happen between Angular's render and its
      // development-mode verification pass (NG0100). Every bus payload is a
      // stable UI snapshot, including its nested mutable arrays.
      this.rows.set(Array.isArray(p.rows)
        ? p.rows.map(row => ({
            ...row,
            segments: [...row.segments],
            gaps: [...row.gaps],
            zones: Array.isArray(row.zones) ? row.zones.map(String) : [],
            doors: Array.isArray(row.doors) ? row.doors.map(String) : null,
            opensAs: String(row.opensAs ?? ''),
            versions: Array.isArray(row.versions) ? row.versions.map(v => ({ ...v })) : [],
            plan: Array.isArray(row.plan) ? row.plan.map(String) : null,
            urls: { ...(row.urls ?? {}) },
            ownLabels: { ...(row.ownLabels ?? {}) },
            defaultLabel: String(row.defaultLabel ?? ''),
            entrances: Object.fromEntries(Object.entries(row.entrances ?? {}).map(([host, e]) => [host, {
              ...e,
              zone: String(e.zone ?? ''),
              from: e.from ? { ...e.from } : null,
              scents: Array.isArray(e.scents) ? e.scents.map(s => ({ ...s })) : [],
              skipped: Array.isArray(e.skipped) ? e.skipped.map(k => ({ page: String(k?.page ?? ''), sig: String(k?.sig ?? '') })) : [],
            }])),
          }))
        : [])
      this.previewed.set(new Set(Array.isArray(p.previewed) ? p.previewed.map(String) : []))
      const preview = p.entrancePreview
      const shown = this.entrancePreview()
      if (!preview?.url) this.entrancePreview.set(null)
      else if (!shown || shown.url !== preview.url || shown.host !== preview.host) {
        // A blob: URL the drone minted from bytes it checked against their
        // signature; the frame is sandboxed to scripts with no same origin.
        this.entrancePreview.set({
          host: preview.host, page: preview.page, url: preview.url,
          src: this.#sanitizer.bypassSecurityTrustResourceUrl(`${preview.url}#${preview.host}`),
        })
      }
      this.participantOnly.set(Array.isArray(p.participantOnly) ? p.participantOnly.map(String) : [])
      this.participantState.set(p.participantState === 'published' || p.participantState === 'changed' ? p.participantState : 'none')
      this.views.set(Array.isArray(p.views)
        ? p.views.map(v => ({
            view: String(v.view ?? ''),
            label: String(v.label ?? v.view ?? ''),
            icon: this.#sanitizer.bypassSecurityTrustHtml(String(v.icon ?? '')),
            dormant: v.dormant === true,
          }))
        : [])
      this.collisions.set(Array.isArray(p.collisions)
        ? p.collisions.map(collision => ({ ...collision, paths: [...collision.paths] }))
        : [])
      this.batch.set(p.batch ? { done: Number(p.batch.done) || 0, total: Number(p.batch.total) || 0, failed: Number(p.batch.failed) || 0 } : null)
      // A pick whose app is gone (forgotten, withdrawn) drops out.
      this.picked.set(pruneSelection(this.rows(), this.picked()))
      // No sibling is closed here — the lane decides what fits on an edge and
      // parks whatever it displaces.
      this.visible.set(!!p.open)
      if (inspect) EffectBus.emit('publish:inspect', { key: nextCurrent })
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  // ── the intents ───────────────────────────────────────────────────

  close(): void {
    this.visible.set(false)
    EffectBus.emit('publish:close', {})
  }

  refresh(): void {
    EffectBus.emit('publish:refresh', {})
  }

  /** Leave branch publishing and open the directory that owns the host set.
   *  Both surfaces dock on the right, so this is a clean hand-off rather than
   *  two panels stacked over one another. */
  openHosts(): void {
    this.close()
    EffectBus.emit('hosts:open', {})
  }

  run(row: PublishRow): void {
    if (row.busyPhase) return
    EffectBus.emit('publish:run', { key: row.key })
  }

  unpublish(row: PublishRow): void {
    if (row.busyPhase) return
    EffectBus.emit('publish:unpublish', { key: row.key })
  }

  copyLink(row: PublishRow): void {
    EffectBus.emit('publish:copy-link', { key: row.key })
  }

  // ── OPTIMIZE ─────────────────────────────────────────────────────────
  // What a published branch's first view loads, and which features its
  // readers never load. The drone does the acts (the same ones the `arrival`
  // and `features` words do); the panel only names them.

  /** A plan's bees by class — `@diamondcoreprocessor.com/SiteViewDrone` reads
   *  as `SiteViewDrone`. */
  planClasses(row: PublishRow): string[] {
    return (row.plan ?? []).map(key => key.slice(key.lastIndexOf('/') + 1))
  }

  draftOf(slot: string, fallback = ''): string {
    const held = this.optimizeDraft()[slot]
    return held === undefined ? fallback : held
  }

  setDraft(slot: string, text: string): void {
    this.optimizeDraft.update(all => ({ ...all, [slot]: text }))
  }

  #clearDraft(slot: string): void {
    this.optimizeDraft.update(all => { const next = { ...all }; delete next[slot]; return next })
  }

  /** Publish the typed plan: bees by class or IoC key, space-separated. */
  saveArrival(row: PublishRow): void {
    if (row.busyPhase) return
    const names = this.draftOf(row.key, this.planClasses(row).join(' ')).split(/[\s,]+/).filter(Boolean)
    if (!names.length) return
    EffectBus.emit('publish:arrival', { key: row.key, names })
    this.#clearDraft(row.key)
  }

  /** Try the typed plan before saving it: open the published site with it for
   *  one visit (`?arrival=`). The site says in a corner what it came to —
   *  hypercomb-web setup/arrival-trial.ts. Nothing is published. */
  testArrival(row: PublishRow): void {
    const names = this.draftOf(row.key, this.planClasses(row).join(' ')).split(/[\s,]+/).filter(Boolean)
    const zone = row.zones.find(z => this.doorOn(row, z)) ?? row.zones[0]
    if (!names.length || !zone) return
    const url = `${this.addressUrl(row, zone)}/?arrival=${encodeURIComponent(names.join(','))}`
    window.open(url, '_blank', 'noopener')
    this.optimizeTried.update(all => ({ ...all, [row.key]: this.address(row, zone) }))
  }

  /** Withdraw the plan: the branch loads its whole package again. */
  clearArrival(row: PublishRow): void {
    if (row.busyPhase) return
    EffectBus.emit('publish:arrival', { key: row.key, names: [] })
    this.#clearDraft(row.key)
  }

  addParticipant(): void {
    const names = this.draftOf('features').split(/[\s,]+/).filter(Boolean)
    for (const name of names) EffectBus.emit('publish:participant', { name, on: true })
    this.#clearDraft('features')
  }

  removeParticipant(name: string): void {
    EffectBus.emit('publish:participant', { name, on: false })
  }

  publishParticipants(): void {
    EffectBus.emit('publish:participant-publish', {})
  }

  /** Publish one group — its drone runs every member and reports. */
  publishGroup(group: PublishGroupRow): void {
    // While the picked apps publish, a group waits: both re-sign the index.
    if (group.publishing || group.count === 0 || this.batch()) return
    EffectBus.emit('publish-groups:publish', { segments: [...this.#groups().segments], meaning: group.meaning })
  }

  /** Pin (or unpin) the branch root's opening face — the drone writes the
   *  same view:default decorator every arrival surface reads. */
  pickView(row: PublishRow, view: string): void {
    if (row.segments.length === 0 || row.opensAs === view) return
    EffectBus.emit('publish:opens-as', { key: row.key, view })
  }

  /** The faces this row may be pinned to: the ones lit in the global roster,
   *  plus whatever this row is ALREADY pinned to. A behaviour switched off in
   *  the roster is not a choice — offering it here is how the strip filled up
   *  with faces nobody uses; but a face already pinned must stay visible, or
   *  there would be no way to see it, let alone take it off. */
  viewsFor(row: PublishRow): { view: string; label: string; icon: SafeHtml; dormant: boolean }[] {
    return this.views().filter(v => !v.dormant || v.view === row.opensAs)
  }

  /** The collapsed row's face mark — the icon of the view this branch opens
   *  as. Hexagons (no pin) shows nothing: the ground is not a badge. */
  opensAsIcon(row: PublishRow): SafeHtml | null {
    if (!row.opensAs) return null
    return this.views().find(v => v.view === row.opensAs)?.icon ?? null
  }

  /** Nothing was proved — the row recedes rather than shouting. */
  isQuiet(row: PublishRow): boolean {
    return row.state === 'unknown' || row.state === 'cannot-compare' || row.state === 'comparing'
  }

  /** A version IS a signature — tapping the chip puts the full sig on the
   *  clipboard. */
  copySig(sig: string): void {
    try { void navigator.clipboard?.writeText(sig) } catch { /* clipboard denied */ }
  }

  /** An earlier version back out into the world — the drone asks first, then
   *  publishes that head as it is. The tile here keeps its newer changes. */
  makeLive(row: PublishRow, version: { sig: string }): void {
    if (!this.canSwitch(row) || version.sig === row.live) return
    EffectBus.emit('publish:make-live', { key: row.key, sig: version.sig })
  }

  /** Walk to the branch this row describes. Rows published from another
   *  device carry no segments and get no such button. */
  visit(row: PublishRow): void {
    if (row.segments.length === 0) return
    const nav = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<NavigationLike>('@hypercomb.social/Navigation')
    nav?.go?.([...row.segments])
  }

  // ── the header ────────────────────────────────────────────────────

  /** What the index line says. `forged` is NOT here — it gets the banner. */
  readonly indexKey = computed<string>(() => {
    switch (this.index()) {
      case 'ok': return this.indexCreatedAt() > 0 ? 'publish.header.index-age' : 'publish.header.index-none'
      case 'none': return 'publish.header.index-none'
      case 'checking': return 'publish.header.index-checking'
      case 'malformed': return 'publish.header.index-malformed'
      case 'forged': return 'publish.header.index-forged'
      // A transport failure and an HTTP error are the same fact to a reader:
      // the host did not answer with an index we could use.
      default: return 'publish.header.index-unreachable'
    }
  })

  /** `{age}` for the index line — the stamp is SECONDS epoch. */
  readonly indexParams = computed<Record<string, string>>(() =>
    ({ age: this.age(this.indexCreatedAt() * 1000) }))

  /** The index line is quiet unless it is telling us something is wrong. */
  readonly indexQuiet = computed(() =>
    this.index() === 'ok' || this.index() === 'none' || this.index() === 'checking')

  readonly forged = computed(() => this.index() === 'forged')

  collisionParams(collision: PublishCollision): Record<string, string> {
    return { paths: collision.paths.join(', ') }
  }

  // ── the rows ──────────────────────────────────────────────────────

  /** A row published from another device has no branch here to seal or
   *  withdraw, and a row mid-act or still comparing has nothing to flip yet. */
  canSwitch(row: PublishRow | null): boolean {
    return !!row && row.segments.length > 0 && !row.busyPhase && row.state !== 'comparing'
  }

  /** Secure delete is offered only for a place that is off everywhere and has
   *  versions published from here (hide first, delete second). */
  canForget(row: PublishRow): boolean {
    return this.canSwitch(row) && !row.live && row.versions.length > 0
  }

  /** Asks once, in the participant's words, then hands the act to the drone. */
  forget(row: PublishRow): void {
    if (!this.canForget(row)) return
    const i18n = window.ioc?.get<{ t?: (k: string, p?: Record<string, string>) => string }>('@hypercomb.social/I18n')
    const question = i18n?.t?.('publish.forget.confirm', { name: this.label(row) })
      ?? `Securely delete ${this.label(row)} from your hosts?`
    if (!window.confirm(question)) return
    EffectBus.emit('publish:forget', { key: row.key })
  }

  /** Why nothing can be switched right now: no key to sign with, a first
   *  read still running, or the hive root, which is no tile. */
  hereHint(): string {
    if (!this.pubkey()) return 'publish.failure.no-signer'
    if (this.refreshing() && this.rows().length === 0) return 'publish.header.index-checking'
    return 'publish.here.root'
  }

  /** The one extra press a switched-ON row can owe: its content changed here
   *  (or the host lost the head), so the world needs the new version. */
  updateKey(row: PublishRow): string | null {
    if (!this.canSwitch(row) || !row.live) return null
    return row.state === 'drift' || row.state === 'gone' ? 'publish.action.republish' : null
  }

  /** The quiet why-line under a row, or '' for none. Never restates the state
   *  label — it says the one thing the label cannot. */
  whyKey(row: PublishRow): string {
    if (row.busyPhase === 'confirming') return 'publish.why.confirming'
    // Behind another publish from this hive (publish-lane.ts): say so, or a
    // press that waits its turn reads as a press that did nothing.
    if (row.busyPhase === 'queued') return 'publish.why.queued'
    if (row.busyPhase) return ''
    if (row.segments.length === 0) return 'publish.why.other-device'
    switch (row.state) {
      case 'drift': return 'publish.why.drift'
      case 'pending': return 'publish.why.confirming'
      case 'stale-edge': return 'publish.why.edge-lag'
      case 'cannot-compare': return 'publish.why.cold-child'
      // The whole point of `unknown`: say WHEN we last saw it, or say that the
      // host did not answer. Never say it is broken.
      case 'unknown': return row.seenAt ? 'publish.why.as-of' : 'publish.why.offline'
      case 'gone': return row.gaps.length > 0 ? 'publish.why.gaps' : ''
      default: return row.gaps.length > 0 ? 'publish.why.gaps' : ''
    }
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

  whyParams(row: PublishRow): Record<string, string | number> {
    return {
      age: row.seenAt ? this.age(row.seenAt) : '',
      count: row.gaps.length,
    }
  }

  gapsShown(row: PublishRow): string[] {
    return row.gaps.slice(0, GAPS_SHOWN)
  }

  short(sig: string | null): string {
    return sig ? sig.slice(0, SIG_SHOWN) : ''
  }

  /** Compact age since an epoch-ms instant. Unit letters rather than words:
   *  there is no key for a duration, and inventing one per unit would be four
   *  strings the catalog never agreed to. */
  age(at: number | null): string {
    if (!at || at <= 0) return ''
    const seconds = Math.max(0, Math.round((this.renderedAt() - at) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours}h`
    return `${Math.round(hours / 24)}d`
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
