// hypercomb-shared/ui/publish-panel/publish-panel.component.ts
//
// Right-docked "Publish" panel — the read-only face of the publish
// DIFFERENTIAL: what the world is serving, next to what has changed here
// since. `/publish` toggles it (PublishStatusDrone answers with
// `publish:render`); the rail launcher is the optional second opener.
//
// Shell UI, so it must NOT import essentials. Everything arrives on the
// `publish:render` payload (the drone owns the read-model, the online proof
// and every verdict) and leaves as intents: publish:refresh, publish:expand,
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
// One action per row, never a bulk selection bar: bulk selection is
// pointer-only and dies on a phone, where this panel becomes a bottom sheet.
// Unpublish lives in the row's expansion, under its honest limit stated in
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
// diamondcoreprocessor.com/sharing/publish-status.drone.ts.
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
  expanded: boolean
  link: string | null
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
}

interface PublishCollision {
  key: string
  paths: string[]
}

interface PublishRenderPayload {
  open: boolean
  gateActive: boolean
  host: string
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

/** One rendered section. Empty ones never reach the template. */
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

  readonly gateActive = signal(false)
  readonly host = signal('')
  readonly index = signal<PublishIndexState>('checking')
  readonly indexCreatedAt = signal(0)
  readonly indexStale = signal(false)
  readonly keyMismatch = signal(false)
  readonly refreshing = signal(false)
  readonly rows = signal<PublishRow[]>([])
  readonly collisions = signal<PublishCollision[]>([])
  /** Opens-as choices from the drone — svg sanitized ONCE per payload, never
   *  in a template helper (change detection would re-trust every check). */
  readonly views = signal<{ view: string; label: string; icon: SafeHtml }[]>([])
  readonly #sanitizer = inject(DomSanitizer)
  /** A deliberately coarse render clock. Template helpers must not call
   *  Date.now() themselves: Angular's development check renders twice and a
   *  minute boundary between those reads would make identical input appear
   *  to change during one check. */
  readonly renderedAt = signal(Date.now())

  /** Rows whose verdict has not landed yet — the leading unlabelled block. */
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

  #cleanups: (() => void)[] = []

  constructor() {
    const ageTimer = setInterval(() => this.renderedAt.set(Date.now()), 15_000)
    this.#cleanups.push(() => clearInterval(ageTimer))

    this.#cleanups.push(EffectBus.on<PublishRenderPayload>('publish:render', (p) => {
      if (!p) return
      this.gateActive.set(p.gateActive === true)
      this.host.set(String(p.host ?? ''))
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
            opensAs: String(row.opensAs ?? ''),
            versions: Array.isArray(row.versions) ? row.versions.map(v => ({ ...v })) : [],
          }))
        : [])
      this.views.set(Array.isArray(p.views)
        ? p.views.map(v => ({
            view: String(v.view ?? ''),
            label: String(v.label ?? v.view ?? ''),
            icon: this.#sanitizer.bypassSecurityTrustHtml(String(v.icon ?? '')),
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

  /** Tapping a row opens its detail — which is also what runs the gap check,
   *  so it stays opt-in and per row. */
  toggle(row: PublishRow): void {
    EffectBus.emit('publish:expand', { key: row.key })
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

  /** The collapsed row's face mark — the icon of the view this branch opens
   *  as. Hexagons (no pin) shows nothing: the ground is not a badge. */
  opensAsIcon(row: PublishRow): SafeHtml | null {
    if (!row.opensAs) return null
    return this.views().find(v => v.view === row.opensAs)?.icon ?? null
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
      // unknown / cannot-compare: nothing was asserted, so nothing is fixed
      // from here. Looking again is the only truthful verb.
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

  /** Quiet states read as furniture, not as failure. */
  isQuiet(row: PublishRow): boolean {
    return row.state === 'unknown' || row.state === 'cannot-compare' || row.state === 'comparing'
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
