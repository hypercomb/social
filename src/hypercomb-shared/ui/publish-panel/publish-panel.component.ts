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
// The panel is a PROPERTIES WINDOW over a LIST. It opens on the page you are
// standing on and follows the list — a tapped row becomes its subject — so
// every branch's addresses are reachable, including at the hive root, where
// the drone can name no current branch at all.
//
// One action per row, never a bulk selection bar: bulk selection is
// pointer-only and dies on a phone, where this panel becomes a bottom sheet.
// Unpublish lives in the properties pane, under its honest limit stated in
// full — it stops the branch being advertised, it does not un-share it.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, inject, signal, type OnDestroy } from '@angular/core'
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

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
  busyPhase: string | null
  /** The view the branch ROOT opens as ('' = hexagons) — view:default mark. */
  opensAs: string
  /** Published heads, newest first — a version IS a signature. */
  versions: { sig: string; at: number }[]
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
  /** The ROOT domain of the target — the only choosable part of an address:
   *  the tile's name is the subdomain, the content endpoint is plumbing. */
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
}

/** One rendered section of THE LIST. Empty ones never reach the template. */
interface PublishSection {
  key: 'live' | 'changed' | 'unpublished' | 'attention'
  titleKey: string
  rows: PublishRow[]
}

/** Which section a settled verdict files under. `comparing` is deliberately
 *  absent — it has no section (see the header note). */
const SECTION_OF: Record<Exclude<PublishRowState, 'comparing'>, PublishSection['key']> = {
  'live': 'live',
  'drift': 'changed',
  'pending': 'changed',
  'unpublished': 'unpublished',
  'gone': 'attention',
  'stale-edge': 'attention',
  'cannot-compare': 'attention',
  'unknown': 'attention',
}

const SECTION_TITLES: { key: PublishSection['key']; titleKey: string }[] = [
  { key: 'live', titleKey: 'publish.section.live' },
  { key: 'changed', titleKey: 'publish.section.changed' },
  { key: 'unpublished', titleKey: 'publish.section.unpublished' },
  { key: 'attention', titleKey: 'publish.section.attention' },
]

/** The properties window's tabs. Sticky — the choice survives the session. */
type PublishTab = 'status' | 'opens' | 'versions'
const TAB_STORE_KEY = 'hc:publish-panel:tab'

/** Head sigs are shown at this length — enough to compare two by eye, short
 *  enough to sit on a phone row. */
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
  styleUrls: ['./publish-panel.component.scss'],
})
export class PublishPanelComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Put away while the hive is covered, brought back on the way home. No
   *  `publish:close` on the park — that would stop the drone's sweep, and we
   *  are hiding a window, not ending an observation. */
  readonly session = signalSession(this.visible, undefined, { close: () => this.close() })

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

  /** THE SUBJECT of the properties pane. It STARTS as the current page and
   *  follows the list: tapping a row makes that branch the subject, so every
   *  branch is configurable, not just the one you happen to be standing on.
   *
   *  This is why it exists at all — at the hive ROOT the drone can name no
   *  current branch (there is no path above you to seal), so `current()` was
   *  null and the pane, its tabs and the address editor all vanished. Falling
   *  through to the first row means the addresses are always reachable. */
  readonly selectedKey = signal('')
  readonly subject = computed<PublishRow | null>(() => {
    const rows = this.rows()
    return rows.find(r => r.key === this.selectedKey())
      ?? rows.find(r => r.key === this.currentKey())
      ?? rows[0]
      ?? null
  })

  /** Make a list row the properties-pane subject. */
  select(row: PublishRow): void {
    this.selectedKey.set(row.key)
    EffectBus.emit('publish:inspect', { key: row.key })
  }

  /** THE LIST — every branch, not just the page you are on. The tabbed block
   *  above answers "what about HERE"; the list answers "what about the rest",
   *  and the current page's own row is marked in it rather than hidden, so the
   *  two readings are visibly the same rows. */
  readonly comparing = computed(() => this.rows().filter(r => r.state === 'comparing'))

  /** The four sections, in reading order, empty ones dropped. */
  readonly sections = computed<PublishSection[]>(() => {
    const byKey = new Map<PublishSection['key'], PublishRow[]>()
    for (const row of this.rows()) {
      if (row.state === 'comparing') continue
      const key = SECTION_OF[row.state] ?? 'attention'
      const list = byKey.get(key) ?? []
      list.push(row)
      byKey.set(key, list)
    }
    return SECTION_TITLES
      .map(s => ({ key: s.key, titleKey: s.titleKey, rows: byKey.get(s.key) ?? [] }))
      .filter(s => s.rows.length > 0)
  })

  readonly hasRows = computed(() => this.rows().length > 0)

  /** The open tab — sticky across sessions like every panel choice. */
  readonly activeTab = signal<PublishTab>(this.#loadTab())

  #loadTab(): PublishTab {
    try {
      const v = localStorage.getItem(TAB_STORE_KEY)
      // `domains` and `community` are both retired spellings of the tab that
      // LEFT: the hosts you carry are their own panel now (`/hosts`), because
      // a host exists before any branch names it and outlives every branch
      // that does. A participant whose last open tab was that one lands on
      // Status rather than on nothing.
      return v === 'opens' || v === 'versions' ? v : 'status'
    } catch { return 'status' }
  }

  setTab(tab: PublishTab): void {
    this.activeTab.set(tab)
    try { localStorage.setItem(TAB_STORE_KEY, tab) } catch { /* in-session only */ }
  }

  /** A sticky tab the current row cannot honestly show (no faces to pick, no
   *  versions yet) falls back to status rather than rendering blank. */
  effectiveTab(row: PublishRow): PublishTab {
    const tab = this.activeTab()
    if (tab === 'opens' && (row.segments.length === 0 || this.viewsFor(row).length === 0)) return 'status'
    if (tab === 'versions' && this.versionsOf(row).length === 0 && this.hiddenFor(row).length === 0) return 'status'
    return tab
  }

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

  /** THE PICK-LIST for one branch: every host you know, each saying whether
   *  this branch answers there. `chosen` comes from the branch's own list —
   *  which falls back to the standing default, so a branch that never chose
   *  still shows where it actually rides. */
  hostChoices(row: PublishRow): { zone: string; chosen: boolean; primary: boolean }[] {
    const known = this.hosts()
    // A host the branch claims but the roster has not caught up on must still
    // appear, or a live address would be invisible and un-droppable.
    const zones = [...new Set([...known, ...row.zones])]
    return zones.map(zone => ({
      zone,
      chosen: row.zones.includes(zone),
      primary: row.zones[0] === zone,
    }))
  }

  /** Answer here, or stop answering here. The LAST remaining host cannot be
   *  dropped: a branch always publishes somewhere, and an empty list only
   *  means "back to the standing default", which would re-tick itself and
   *  read as a control that did nothing. */
  toggleHost(row: PublishRow, zone: string): void {
    const has = row.zones.includes(zone)
    if (has && row.zones.length <= 1) return
    const zones = has ? row.zones.filter(z => z !== zone) : [...row.zones, zone]
    EffectBus.emit('publish:set-target', { key: row.key, domains: zones })
  }

  /** Promote one chosen host to PRIMARY — first in the list. The primary is
   *  the door the index write goes through and the address a bare visit
   *  lands on, so which one leads is a real choice, not presentation. */
  makePrimary(row: PublishRow, zone: string): void {
    if (!row.zones.includes(zone) || row.zones[0] === zone) return
    EffectBus.emit('publish:set-target', {
      key: row.key,
      domains: [zone, ...row.zones.filter(z => z !== zone)],
    })
  }

  /** Where ONE address lives once published. A branch with no name of its own
   *  (the hive root) has no subdomain — the zone IS the address. */
  addressUrl(row: PublishRow, zone: string): string {
    const name = this.label(row)
    return `https://${name ? `${name}.` : ''}${zone}`
  }

  constructor() {
    const ageTimer = setInterval(() => this.renderedAt.set(Date.now()), 15_000)
    this.#cleanups.push(() => clearInterval(ageTimer))

    // WHAT HAS BEEN PUT AWAY — the same pool and the same owner the host
    // ledger reads, so hiding means one thing across the shell.
    this.#cleanups.push(EffectBus.on<HiddenRenderish>('hidden:render', (p) => {
      const items = (p?.items ?? []).filter(i => i?.scope === VERSION_SCOPE)
      this.hidden.set(items)
      this.concealed.set(new Set([...items.map(i => i.sig), ...(p?.gone ?? [])]))
    }))

    this.#cleanups.push(EffectBus.on<PublishRenderPayload>('publish:render', (p) => {
      if (!p) return
      this.zone.set(String(p.zone ?? '') || String(p.host ?? '').replace(/^content\./, ''))
      this.hosts.set(Array.isArray(p.hosts) ? p.hosts.map(String).filter(Boolean) : [])
      const nextCurrent = String(p.currentKey ?? '')
      // Walking to another tile re-aims the pane. A selection made by hand
      // survives repeated renders of the SAME page, so a refresh mid-edit does
      // not yank the subject out from under the address being typed.
      if (nextCurrent !== this.currentKey()) this.selectedKey.set(nextCurrent)
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
            opensAs: String(row.opensAs ?? ''),
            versions: Array.isArray(row.versions) ? row.versions.map(v => ({ ...v })) : [],
          }))
        : [])
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
      // No sibling is closed here — the lane decides what fits on an edge and
      // parks whatever it displaces.
      this.visible.set(!!p.open)
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

  /** The row's ONE action. Null = nothing to offer (a row still comparing).
   *
   *  Rows with no segments were published from another device: there is no
   *  branch here to seal, so they are only ever re-checked. */
  actionKey(row: PublishRow): string | null {
    if (row.state === 'comparing' || row.busyPhase) return null
    if (row.segments.length === 0) return 'publish.action.recheck'
    switch (row.state) {
      case 'unpublished': return 'publish.action.publish'
      // The head 404s: putting it back is a publish, not an update.
      case 'gone': return 'publish.action.publish'
      case 'drift': return 'publish.action.republish'
      // The bytes are hosted and the index is authentic — what is missing is
      // the host catching up, so the honest offer is to look again.
      case 'stale-edge': return 'publish.action.recheck'
      case 'pending': return 'publish.action.recheck'
      case 'live': return row.link ? 'publish.action.copy-link' : 'publish.action.recheck'
      // unknown / cannot-compare: the branch's own door is not answering, but
      // every door writes the same shared index — so publishing is still a
      // real offer (the routine falls back through live doors), and it is
      // what a participant staring at "can't tell" actually wants to do.
      case 'unknown':
      case 'cannot-compare': return 'publish.action.publish'
      default: return 'publish.action.recheck'
    }
  }

  /** Run whatever `actionKey` offered. */
  act(row: PublishRow): void {
    const key = this.actionKey(row)
    if (!key) return
    if (key === 'publish.action.recheck') { this.refresh(); return }
    if (key === 'publish.action.copy-link') { this.copyLink(row); return }
    this.run(row)
  }

  /** The quiet why-line under a row, or '' for none. Never restates the state
   *  label — it says the one thing the label cannot. */
  whyKey(row: PublishRow): string {
    if (row.busyPhase === 'confirming') return 'publish.why.confirming'
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
