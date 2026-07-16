// hypercomb-shared/ui/features-viewer/features-viewer.component.ts
//
// Right-docked "Beehaviors" panel — a pure CONTEXT surface. Opened when a
// tile's puzzle-piece icon is clicked — or by the ADOPT gesture, which folds
// the branch and lands here (ShowFeaturesDrone answers `tile:action` with
// `features:open`). While the panel is open it FOLLOWS NAVIGATION: move
// through the hive and it re-targets to where you are, so a behavior is
// discovered and managed at the place it applies — go to the page, toggle
// the behavior. For each tile it shows:
//
//   • On this layer — the behaviors the tile already HAS (direct + cascaded
//     + the website scope it sits inside), each tagged with where it comes
//     from. The row's switch turns the behavior OFF into the retainable
//     hidden pool — for a scope feature (a website) the record is written AT
//     THE NODE YOU'RE ON, so a child page or branch turns off individually
//     while the rest of the site stays on; the site-root row is the master
//     switch, with a reset for descendant overrides. A row the community
//     gate BLOCKS renders its switch OFF + disabled (the honest-switch rule)
//     with a quiet "needs your OK" chip and an inline allow override.
//   • Off — kept here — behaviors turned off here (or above here). Nothing
//     is deleted; each row has a one-tap restore.
//   • Available to add — every behavior the app knows that this layer does
//     NOT have yet.
//
// Beehaviors are TOGGLES ONLY: tiles are never added, removed, or merged
// from this window. Adopt is adopt — SwarmAdoptDrone folds the tiles on the
// adopt click itself; this panel only ever flips behaviors of tiles you
// already hold.
//
// Shell UI, so it must NOT import essentials — module services are reached
// only through window.ioc at runtime, and gate state arrives pre-computed on
// the `features:open` payload.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { markVerified, markAllowedRoot, branchRootFor } from './feature-verified'
import { hideFeature, restoreFeature, loadHidden, hiddenKey, type HiddenFeature } from './feature-hidden'
import { enableAggregation, disableAggregation, listAggregation } from '../../core/aggregation-layer'

/** A feature already applied to the layer. */
interface FeatureRow {
  view: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  behavior?: string
  /** True when this is a VIEW BEHAVIOUR whose view can be entered (slides,
   *  website, home, tutor). The row gets an Open action that navigates into
   *  the tile and switches to that view; the switch stays the on/off control.
   *  Stamped by ShowFeaturesDrone, which has the visual-bee registry. */
  openable?: boolean
  branchSig?: string
  /** True when this feature, declared on a container, flows to its subtree. */
  cascades?: boolean
  /** Where it applies from: `direct` = on this tile; `cascade` = inherited
   *  from an ancestor (named by `originCell`, absent = the hive root). */
  origin?: 'direct' | 'cascade'
  originCell?: string
  /** Full hive path of where the feature is attached (tile for direct, the
   *  declaring ancestor for cascade). Empty/absent = the hive root. */
  originSegments?: string[]
  /** For a SCOPE feature (a website): the site ROOT's path — the outermost
   *  node declaring it. Descendant rows show "part of the website at {path}";
   *  the root row (scopeSegments == the tile's own path) gets the
   *  descendant-override reset. */
  scopeSegments?: string[]
  /** Where the off-switch writes its hidden record: `node` = at the tile the
   *  panel is describing (scope features — per-page/branch off), absent =
   *  at the feature's attach point (node-local features, unchanged). */
  hideAt?: 'node' | 'origin'
  /** True when the community verification gate currently blocks activation —
   *  the row's switch renders OFF + disabled with the "needs your OK" chip
   *  and the allow override beside it. */
  gated?: boolean
  /** The payload sig the gate evaluates — what the allow override verifies. */
  gateSig?: string
  /** Publisher domain attributed to the gate sig (empty = unknown origin). */
  publisherDomain?: string
}

/** A feature the app knows but this layer doesn't have yet. */
interface AvailableRow {
  view: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  /** True when adding this feature would cascade to the layer's subtree. */
  cascades?: boolean
  /** True when the panel can ADD this feature mechanically (essentials writes
   *  the decoration at the tile's segments on `features:enable`). View bees
   *  are not addable — their content (a page, a deck) must be authored, so
   *  their rows carry the slash-command chip instead of a switch. */
  addable?: boolean
}

/** Minimal shape the selection / bulk helpers need — both row kinds satisfy
 *  it (available rows simply have no branchSig/gateSig/originSegments). */
type RowLike = {
  kind: string
  view: string
  label: string
  branchSig?: string
  gateSig?: string
  gated?: boolean
  originSegments?: string[]
  hideAt?: 'node' | 'origin'
}

interface FeatureGroup {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
}

/** Download-leash trip point: this much SILENCE (no progress tick, no done)
 *  means the producer died mid-walk — matches the sync pill's stale guard. */
const DOWNLOAD_STALL_MS = 90_000

/** One row of the download pathway stepper: sent → receiving → done. */
interface DownloadPath {
  cell: string
  /** 1 = request sent, 2 = bytes streaming, 3 = terminal (ok or failed). */
  stage: 1 | 2 | 3
  /** Still in flight — the frontier node pulses. */
  active: boolean
  ok: boolean
  stalled?: boolean
  files: number
  failed: number
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
}

@Component({
  selector: 'hc-features-viewer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './features-viewer.component.html',
  styleUrls: ['./features-viewer.component.scss'],
})
export class FeaturesViewerComponent implements OnDestroy {

  readonly visible = signal(false)

  /** The ONE tile the panel is describing. Beehaviors are managed one tile at a
   *  time — clicking another tile's icon REPLACES the subject (its name rides
   *  in the panel header), never accumulates a second group. Null = closed. */
  readonly group = signal<FeatureGroup | null>(null)

  /** A foreign feature the participant has been asked to REVIEW before enabling.
   *  Set from `feature:review:open` (emitted by the website gate when it blocks
   *  an unverified page). Shows the feature's actual code; Accept / Bypass write
   *  the verified sig and re-activate it. Null = no review in progress. */
  readonly reviewTarget = signal<{
    cell: string; segments: string[]; sig: string; kind: string; label: string; code: string
  } | null>(null)

  /** Hidden pool members, loaded from the signature pool. An OFF feature stays
   *  in the applied list rendered with its switch off (turning it off just
   *  means "not active / not adopted" — it never disappears); this set is what
   *  the row's on/off state reads from, and restoring = flipping the switch
   *  back on in place. */
  readonly hidden = signal<HiddenFeature[]>([])

  /** The header search — filters every section's rows live (label, kind,
   *  description, slash command). Cleared when the subject tile changes and
   *  on close; Escape clears it before it closes the panel. */
  readonly query = signal('')

  /** Multi-selected rows (by stable row key). The bulk bar at the top acts on
   *  this set: allow the blocked ones, download the selected ones. */
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set())

  /** Rows whose ADD is in flight (available-row switch clicked) — guards the
   *  double-click and shows the busy state. */
  readonly pending = signal<ReadonlySet<string>>(new Set())

  /** Row-level outcomes: plain-words FAILURE notes by row key, landed by
   *  `features:outcome` (the same sentence the activity log gets — but on
   *  the row you're looking at). Success is the state flipping, so ok
   *  outcomes only CLEAR: silence is the healthy state. Cleared on retry,
   *  on subject change, and on close. */
  readonly rowNotes = signal<ReadonlyMap<string, string>>(new Map())

  /** Latest overall content-health condition (EffectBus last-value replay
   *  seeds it on open) — the quiet WHY line under a failure note while
   *  fetching is degraded: "couldn't fetch" + "{host} isn't answering". */
  readonly health = signal<{ condition: string; host: string | null } | null>(null)

  /** Bulk downloads in flight (by cell) — the bar's download button shows
   *  busy until every `features:download:done` lands. */
  readonly downloading = signal<ReadonlySet<string>>(new Set())

  /** Files fetched since this download batch started — one tick per
   *  `adopt:progress` the broker streams while a download is in flight.
   *  The climbing number IS the "not stalled" cue. */
  readonly downloadedCount = signal(0)

  /** Per-cell download outcomes, in arrival order — what the status block
   *  under the header renders. `stalled` marks a download the leash gave up
   *  waiting on (no progress, no done) — distinct from an honest failure. */
  readonly downloadResults = signal<{ cell: string; ok: boolean; files: number; failed: number; stalled?: boolean }[]>([])

  /** The visible PATHWAY: one stepper row per cell, sent → receiving → done.
   *  Stage 1 fills the instant the click lands (the request is out), stage 2
   *  when bytes start streaming, stage 3 when the outcome arrives — green
   *  track + check on success, red terminal node on failure. Active rows
   *  first (they're what the participant is watching), finished rows after. */
  readonly pathway = computed<DownloadPath[]>(() => {
    const out: DownloadPath[] = []
    const receiving = this.downloadedCount() > 0
    for (const cell of this.downloading()) {
      out.push({ cell, stage: receiving ? 2 : 1, active: true, ok: false, files: 0, failed: 0 })
    }
    for (const r of this.downloadResults()) {
      out.push({ cell: r.cell, stage: 3, active: false, ok: r.ok, stalled: r.stalled, files: r.files, failed: r.failed })
    }
    return out
  })

  readonly selectedCount = computed(() => this.selectedKeys().size)

  /** Selected APPLIED rows the gate currently blocks — what bulk-allow acts on. */
  readonly allowableCount = computed(() => {
    let n = 0
    for (const { feat, applied } of this.#selectedRows()) {
      if (applied && feat.gated && feat.gateSig) n++
    }
    return n
  })

  /** Selected rows with anything to fetch — what bulk-download acts on. */
  readonly downloadableCount = computed(() => {
    let n = 0
    for (const { feat } of this.#selectedRows()) {
      if (feat.branchSig || feat.gateSig) n++
    }
    return n
  })

  /** Selected APPLIED rows that are enterable views AND currently on — what the
   *  bulk-bar Open acts on (opening an off/inert row would render nothing). */
  readonly openableSelectedCount = computed(() => {
    const group = this.group()
    if (!group) return 0
    const picked = this.selectedKeys()
    let n = 0
    for (const feat of group.applied) {
      if (feat.openable && picked.has(this.rowKey(group, feat)) && this.isOn(group, feat)) n++
    }
    return n
  })

  #cleanups: (() => void)[] = []

  /** Last navigation path seen (joined) — the follow-navigation handler only
   *  re-targets when this actually changes, never on fs-only invalidations. */
  #lastNavKey = ''

  constructor() {
    this.#cleanups.push(EffectBus.on<FeaturesOpenPayload>('features:open', (p) => {
      if (!p?.cell) return
      // Mutually exclusive with the Files panel — they share the right-side
      // dock, so opening Features closes Files.
      EffectBus.emit('files:viewer-close', {})
      const group: FeatureGroup = {
        cell: p.cell,
        segments: Array.isArray(p.segments) ? p.segments : [],
        applied: Array.isArray(p.applied) ? p.applied : [],
        available: Array.isArray(p.available) ? p.available : [],
      }
      // One tile at a time: re-clicking the SAME tile refreshes it in place;
      // clicking a DIFFERENT tile replaces the subject (and drops the old
      // tile's row selection, which can't carry across cells).
      const prev = this.group()
      if (prev?.cell !== group.cell) {
        this.selectedKeys.set(new Set())
        this.rowNotes.set(new Map())   // notes describe the OLD subject's rows
        this.query.set('')             // a stale filter would hide the new subject's rows
      }
      this.group.set(group)
      if (!this.visible()) this.visible.set(true)
      // A fresh group replaces its rows — any in-flight ADD for it is settled.
      if (this.pending().size) this.pending.set(new Set())
      // Refresh the hidden pool + websites-menu membership so the rows'
      // checkboxes read their real state.
      void this.#refreshHidden()
      void this.#refreshMembers()
    }))

    // ── the panel FOLLOWS NAVIGATION ──────────────────────────────────
    // While open, moving through the hive re-targets the panel to the new
    // location: behaviors are managed where they apply. Lineage fires
    // 'change' on every fs invalidation too, so re-target ONLY when the
    // PATH actually changed (the key check) — an fs tick must not clobber
    // a tile the participant opened via its puzzle-piece icon.
    const lineage = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<EventTarget & { explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    if (lineage?.addEventListener) {
      this.#lastNavKey = (lineage.explorerSegments?.() ?? []).join('\u0000')
      const onNav = (): void => {
        const segs = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
        const key = segs.join('\u0000')
        if (key === this.#lastNavKey) return
        this.#lastNavKey = key
        if (!this.visible() || segs.length === 0) return
        EffectBus.emit('tile:action', {
          action: 'features',
          label: segs[segs.length - 1],
          segments: segs,
        })
      }
      lineage.addEventListener('change', onNav)
      this.#cleanups.push(() => lineage.removeEventListener('change', onNav))
    }

    this.#cleanups.push(EffectBus.on('features:viewer-close', () => {
      if (this.visible()) this.close()
    }))

    // The website gate blocked a foreign, unverified page and handed it here to
    // be reviewed. Load its code and surface the review panel.
    this.#cleanups.push(EffectBus.on<{ cell: string; segments: string[]; sig: string; kind: string; label: string }>(
      'feature:review:open',
      (p) => {
        if (!p?.sig) return
        void this.#fetchCode(p.sig).then(code => {
          this.reviewTarget.set({
            cell: p.cell ?? '',
            segments: Array.isArray(p.segments) ? p.segments : [],
            sig: p.sig,
            kind: p.kind ?? '',
            label: p.label ?? 'Feature',
            code,
          })
          if (!this.visible()) this.visible.set(true)
        })
      },
    ))

    // A bulk download finished for a tile — drop its busy marker and record
    // the outcome so the status block shows a real result, not a silent
    // un-dimmed button.
    this.#cleanups.push(EffectBus.on<{ cell?: string; ok?: boolean; files?: number; failed?: number }>('features:download:done', (p) => {
      const cell = String(p?.cell ?? '')
      if (!cell) return
      const wasBusy = this.downloading().has(cell)
      this.downloading.update(set => {
        if (!set.has(cell)) return set
        const next = new Set(set)
        next.delete(cell)
        return next
      })
      if (!wasBusy) return   // last-value replay of an old done — not ours
      this.#recordResult({
        cell,
        ok: p?.ok === true,
        files: Number(p?.files ?? 0) || 0,
        failed: Number(p?.failed ?? 0) || 0,
      })
      if (this.downloading().size > 0) this.#armDownloadLeash()
      else this.#clearDownloadLeash()
    }))

    // The broker streams one `adopt:progress` per sig it fills. While a panel
    // download is in flight that stream is OUR download moving — surface it as
    // a climbing file count (and proof the walk hasn't stalled).
    this.#cleanups.push(EffectBus.on('adopt:progress', () => {
      if (this.downloading().size === 0) return
      this.downloadedCount.update(n => n + 1)
      this.#armDownloadLeash()
    }))

    // Row-level outcomes: the drone answers a row's action with the SAME
    // plain-words sentence the activity log gets. The busy switch settles
    // the moment the outcome lands (the leashes become dead-producer
    // backstops), and a failure stays visible on the row that asked.
    this.#cleanups.push(EffectBus.on<{ cell?: string; kind?: string; ok?: boolean; message?: string }>('features:outcome', (p) => {
      const group = this.group()
      if (!group || !p?.cell || p.cell !== group.cell) return
      const kind = String(p.kind ?? '')
      const feat = kind
        ? (group.applied.find(f => f.kind === kind) ?? group.available.find(f => f.kind === kind))
        : undefined
      if (!feat) {
        // Tile-level outcome (no kind, or the row already refreshed away) —
        // settle every busy marker for this tile immediately.
        if (this.pending().size) this.pending.set(new Set())
        return
      }
      const key = this.rowKey(group, feat)
      this.pending.update(set => {
        if (!set.has(key)) return set
        const next = new Set(set)
        next.delete(key)
        return next
      })
      this.rowNotes.update(m => {
        if (p.ok === true && !m.has(key)) return m
        const next = new Map(m)
        if (p.ok === true) next.delete(key)
        else next.set(key, String(p.message ?? '').trim())
        return next
      })
    }))

    // The overall fetch-health condition — last-value replay seeds the
    // current state when the panel opens; transitions keep it live.
    this.#cleanups.push(EffectBus.on<{ condition?: string; host?: string | null }>('content:health', (p) => {
      this.health.set(p?.condition ? { condition: String(p.condition), host: p.host ?? null } : null)
    }))

  }

  // ── download stall leash ──────────────────────────────────────────
  // A producer that dies mid-walk (peer gone, relay dropped) emits neither
  // progress nor done — without a leash the busy state shows forever and
  // "stalled" is exactly what the participant can't distinguish. Prolonged
  // SILENCE (no progress tick, no done) clears the busy markers and records
  // the still-open cells as stalled. Any activity re-arms it.
  #downloadLeash: ReturnType<typeof setTimeout> | null = null

  #armDownloadLeash(): void {
    this.#clearDownloadLeash()
    this.#downloadLeash = setTimeout(() => {
      this.#downloadLeash = null
      const open = [...this.downloading()]
      if (!open.length) return
      this.downloading.set(new Set())
      for (const cell of open) this.#recordResult({ cell, ok: false, files: 0, failed: 0, stalled: true })
    }, DOWNLOAD_STALL_MS)
  }

  #clearDownloadLeash(): void {
    if (!this.#downloadLeash) return
    clearTimeout(this.#downloadLeash)
    this.#downloadLeash = null
  }

  /** Upsert one cell's download outcome (a re-download replaces its line). */
  #recordResult(r: { cell: string; ok: boolean; files: number; failed: number; stalled?: boolean }): void {
    this.downloadResults.update(list => [...list.filter(x => x.cell !== r.cell), r])
  }

  /** Read a feature resource's bytes as text for review. Capped so a huge page
   *  can't lock the panel — the participant is reviewing the shape and any
   *  scripts, not diffing every byte. */
  async #fetchCode(sig: string): Promise<string> {
    try {
      const store = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(sig)
      if (!blob) return '(could not load feature code)'
      const text = await blob.text()
      return text.length > 200_000 ? text.slice(0, 200_000) + '\n… (truncated for review)' : text
    } catch {
      return '(could not load feature code)'
    }
  }

  /** Accept the reviewed feature (or BYPASS the review as an explicit override).
   *  Writes the verified sig — and for a WEBSITE, the allowed ROOT: a site is
   *  accepted as one operation covering every page beneath it, so navigation
   *  never re-gates page by page (nor after a reload). Emits `feature:verified`
   *  so the gate re-reconciles and the page activates. */
  acceptReview(bypassed: boolean): void {
    const t = this.reviewTarget()
    if (!t) return
    markVerified({ sig: t.sig, cell: t.cell, kind: t.kind, label: t.label, bypassed })
    if (t.kind === 'website' && t.segments.length) markAllowedRoot(branchRootFor(t.segments))
    EffectBus.emit('feature:verified', { sig: t.sig })
    this.reviewTarget.set(null)
  }

  cancelReview(): void {
    this.reviewTarget.set(null)
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#clearDownloadLeash()
  }

  close(): void {
    this.visible.set(false)
    this.group.set(null)
    this.selectedKeys.set(new Set())
    this.pending.set(new Set())
    this.rowNotes.set(new Map())
    this.query.set('')
    this.downloadResults.set([])
    // In-flight downloads keep running (the bytes still land, and the header
    // sync pill keeps showing them) — only the panel-local status resets.
  }

  /** Human-readable hive path of where an applied feature is attached — the
   *  tile itself for direct features, the declaring ancestor for cascaded ones.
   *  Surfaced on hover so the location an inherited feature flows from is
   *  explicit (e.g. `/website` cascading from a parent). */
  attachedAt(group: FeatureGroup, feat: FeatureRow): string {
    const segs = feat.originSegments?.length
      ? feat.originSegments
      : (feat.origin === 'cascade' ? [] : group.segments)
    return segs.length ? segs.join(' / ') : '/'
  }

  // ── hidden pool (turn off, retain, restore) ───────────────

  /** WHERE this row's off-switch acts. `hideAt: 'node'` (scope features — the
   *  website) = the tile the panel is describing: turning off a child page
   *  writes the record at that page, so the rest of the site stays on.
   *  Otherwise the feature's attach point (its declaring ancestor for a
   *  cascaded capability, else the tile itself) — unchanged for node-local
   *  features. */
  #segmentsFor(group: FeatureGroup, feat: RowLike): string[] {
    if (feat.hideAt === 'node') return [...group.segments]
    return feat.originSegments?.length ? [...feat.originSegments] : [...group.segments]
  }

  /** Stable per-row key (feature kind @ scope) — used for the hide pool
   *  membership, the multi-selection, and the pending/busy markers. */
  rowKey(group: FeatureGroup, feat: RowLike): string {
    return hiddenKey(feat.kind, this.#segmentsFor(group, feat))
  }

  isSelected(group: FeatureGroup, feat: RowLike): boolean {
    return this.selectedKeys().has(this.rowKey(group, feat))
  }

  /** Click a row to toggle it in the multi-selection the bulk bar acts on. */
  selectRow(group: FeatureGroup, feat: RowLike): void {
    const k = this.rowKey(group, feat)
    this.selectedKeys.update(cur => {
      const next = new Set(cur)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  clearSelection(): void {
    this.selectedKeys.set(new Set())
  }

  /** Every currently-selected row of the active tile. Applied rows are matched
   *  first; available rows carry `applied: false`. */
  #selectedRows(): { group: FeatureGroup; feat: RowLike; applied: boolean }[] {
    const group = this.group()
    if (!group) return []
    const picked = this.selectedKeys()
    const out: { group: FeatureGroup; feat: RowLike; applied: boolean }[] = []
    for (const feat of group.applied) {
      if (picked.has(this.rowKey(group, feat))) out.push({ group, feat, applied: true })
    }
    for (const feat of group.available) {
      if (picked.has(this.rowKey(group, feat))) out.push({ group, feat, applied: false })
    }
    return out
  }

  /** The hidden record currently suppressing this row HERE: the exact node's
   *  record first; for a scope feature (`hideAt: 'node'`) also the NEAREST
   *  ancestor's record — a branch turned off above you turns you off too
   *  (matches the renderer's isFeatureHiddenWithin). Null = nothing off. */
  #suppressingRecord(group: FeatureGroup, feat: RowLike): HiddenFeature | null {
    const byKey = (key: string): HiddenFeature | undefined =>
      this.hidden().find(r => hiddenKey(r.featKind, r.appliesTo) === key)
    const own = byKey(this.rowKey(group, feat))
    if (own) return own
    if (feat.hideAt !== 'node') return null
    for (let depth = group.segments.length - 1; depth >= 1; depth--) {
      const rec = byKey(hiddenKey(feat.kind, group.segments.slice(0, depth)))
      if (rec) return rec
    }
    return null
  }

  /** True when this feature is turned OFF (in the hidden pool, at this node
   *  or above it) — the row's switch reads this for its on/off state. Off
   *  features stay in the list. */
  isHidden(group: FeatureGroup, feat: RowLike): boolean {
    return this.#suppressingRecord(group, feat) != null
  }

  /** Where an off row was turned off, when that was ABOVE this node ('' =
   *  turned off right here). Rendered on the off row so an inherited off is
   *  never a mystery — and its restore flips the record that actually did it. */
  offAt(group: FeatureGroup, feat: FeatureRow): string {
    const rec = this.#suppressingRecord(group, feat)
    if (!rec) return ''
    const here = this.#segmentsFor(group, feat).join('/')
    const at = rec.appliesTo.join('/')
    return at === here ? '' : '/' + at
  }

  // ── website scope: root master switch + descendant overrides ──────

  /** Is this node the row's scope ROOT (the site's declaring tile)? True for
   *  every non-scope feature — only scope rows on descendants return false. */
  #isScopeRoot(group: FeatureGroup, feat: FeatureRow): boolean {
    if (!feat.scopeSegments?.length) return true
    return feat.scopeSegments.join('/') === group.segments.join('/')
  }

  /** The scope this row belongs to, when the panel is on a DESCENDANT of the
   *  scope root ('' at the root itself) — "part of the website at {path}". */
  scopePartOf(group: FeatureGroup, feat: FeatureRow): string {
    if (!feat.scopeSegments?.length || this.#isScopeRoot(group, feat)) return ''
    return '/' + feat.scopeSegments.join('/')
  }

  /** Descendant overrides under this SCOPE-ROOT row — hidden records of the
   *  same kind strictly below this node. The root row surfaces the count with
   *  a one-tap reset ("toggle everything back on from the root"). */
  overrideRecords(group: FeatureGroup, feat: FeatureRow): HiddenFeature[] {
    if (!this.#isScopeRoot(group, feat) || feat.hideAt !== 'node') return []
    const rootKey = group.segments.join('/')
    return this.hidden().filter(r =>
      r.featKind === feat.kind
      && r.appliesTo.length > group.segments.length
      && r.appliesTo.slice(0, group.segments.length).join('/') === rootKey)
  }

  /** Reset every descendant override under this scope root — the whole site
   *  returns to the root switch's state (all pages back on). */
  async resetOverrides(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    for (const rec of this.overrideRecords(group, feat)) {
      const ok = await restoreFeature(rec.recordSig)
      if (ok) EffectBus.emit('feature:restored', { featKind: rec.featKind, segments: rec.appliesTo })
    }
    await this.#refreshHidden()
  }

  /** The header search's live filter. Case-insensitive substring across the
   *  row's searchable text — feature name, kind, description, slash command,
   *  AND the tile lineage it's attached at (plus the subject tile's name) so
   *  "susan/projects" or a tile name finds its rows. Empty query matches all. */
  #matchesQuery(
    group: FeatureGroup,
    feat: { label?: string; kind?: string; description?: string; slashCommand?: string; originSegments?: string[] },
  ): boolean {
    const q = this.query().trim().toLowerCase()
    if (!q) return true
    const segs = feat.originSegments?.length ? feat.originSegments : group.segments
    const lineage = segs.join('/')
    return [feat.label, feat.kind, feat.description, feat.slashCommand, lineage, group.cell]
      .some(v => typeof v === 'string' && v.toLowerCase().includes(q))
  }

  onQuery(value: string): void {
    this.query.set(String(value ?? ''))
  }

  /** The "On this layer" rows — every applied feature, on AND off, in ONE
   *  list. The row is the toggle: an off row stays exactly where it is with
   *  its checkbox cleared (plus a "turned off at /path" note when the record
   *  that silences it lives above this node). Nothing ever moves or
   *  disappears when toggled. */
  visibleApplied(group: FeatureGroup): FeatureRow[] {
    return group.applied.filter(f => this.#matchesQuery(group, f))
  }

  /** The "Available to add" rows, through the same search filter. */
  visibleAvailable(group: FeatureGroup): AvailableRow[] {
    return group.available.filter(f => this.#matchesQuery(group, f))
  }

  /** Is this row's checkbox CHECKED — is the behavior ENABLED here? A hidden
   *  record (at this node or above) always means off. A WEBSITE at its scope
   *  root is additionally enabled only when the site is a MEMBER of the
   *  websites menu — enabling IS what mints the /websites link, so a freshly
   *  adopted site arrives unchecked and checking it is the explicit enable.
   *  The community gate is a separate story: a gated row keeps its checkbox
   *  (your intent) and carries the "needs your OK" chip + allow beside it. */
  isOn(group: FeatureGroup, feat: FeatureRow): boolean {
    if (this.isHidden(group, feat)) return false
    if (feat.view === 'website' && this.#isScopeRoot(group, feat)) {
      return this.websiteMembers().has(group.segments.join('/'))
    }
    return true
  }

  /** Can this row be ENTERED as a view? True for on, local view behaviours
   *  (slides/website/home/tutor). A turned-off or not-yet-adopted row has no
   *  live view to open, so the Open affordance stays hidden for it. */
  isOpenable(group: FeatureGroup, feat: FeatureRow): boolean {
    return feat.openable === true && this.isOn(group, feat)
  }

  /** The ROW is the toggle. A plain click flips the behavior in place (the
   *  row never moves or disappears); Ctrl/Shift-click selects the row for the
   *  bulk bar instead. */
  rowClick(group: FeatureGroup, feat: FeatureRow, event?: MouseEvent): void {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      this.selectRow(group, feat)
      return
    }
    if (this.isPending(group, feat)) return
    void this.toggleActive(group, feat)
  }

  /** An available row's click: ADD it when it's mechanically addable;
   *  Ctrl/Shift-click selects it for the bulk bar. Non-addable rows (view
   *  bees whose content must be authored) only select. */
  availableRowClick(group: FeatureGroup, feat: AvailableRow, event?: MouseEvent): void {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      this.selectRow(group, feat)
      return
    }
    if (feat.addable) this.enableAvailable(group, feat)
    else this.selectRow(group, feat)
  }

  /** Flip the row's behavior. Two cases, both IN PLACE:
   *   • enabled → off: a hidden record written at this row's hide scope. For
   *     a scope feature that scope is THE NODE YOU'RE ON — a page or branch
   *     turns off individually while the rest of the site stays on.
   *   • off → enabled: the SUPPRESSING record is removed — the one here, or
   *     the ancestor record that turned this branch off; a WEBSITE at its
   *     scope root is also (re)committed into the websites menu, which is
   *     what makes its /websites link appear. */
  async toggleActive(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    if (this.isOn(group, feat)) await this.#turnOff(group, feat)
    else await this.#turnOn(group, feat)
  }

  /** Turn a feature OFF: write it into the hidden pool (retained) at this
   *  row's hide scope — the NODE for a scope feature (per-page/branch off) —
   *  and re-reconcile its render via `feature:hidden`. The WEBSITE row's flip
   *  AT THE SITE ROOT additionally commits ONE menu change to the websites
   *  aggregation layer (the master switch IS the menu-membership control;
   *  a child-page off never touches the menu). */
  async #turnOff(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const segments = this.#segmentsFor(group, feat)
    const sig = await hideFeature({ featKind: feat.kind, view: feat.view, label: feat.label, segments })
    if (!sig) return
    EffectBus.emit('feature:hidden', { featKind: feat.kind, segments })
    if (feat.view === 'website' && this.#isScopeRoot(group, feat)) {
      await disableAggregation('websites', segments).catch(() => false)
      await this.#refreshMembers()
    }
    await this.#refreshHidden()
  }

  /** Turn a feature ON. Removes the SUPPRESSING hidden-pool member when one
   *  exists (the record at this node, or the ancestor record that turned this
   *  branch off — restoring from a child re-opens the branch). ENABLING a
   *  WEBSITE at its scope root ALSO commits it into the websites menu — this
   *  is THE moment the /websites link appears, and it runs even when there is
   *  no hidden record at all (a freshly adopted site is not hidden, just not
   *  yet a member). */
  async #turnOn(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const rec = this.#suppressingRecord(group, feat)
    if (rec) {
      const ok = await restoreFeature(rec.recordSig)
      if (!ok) return
      EffectBus.emit('feature:restored', { featKind: rec.featKind, segments: rec.appliesTo })
      await this.#refreshHidden()
    }
    if (feat.view === 'website' && this.#isScopeRoot(group, feat)) {
      const segments = rec?.appliesTo?.length ? rec.appliesTo : this.#segmentsFor(group, feat)
      await enableAggregation('websites', segments, {
        label: segments[segments.length - 1] ?? group.cell,
      }).catch(() => null)
      await this.#refreshMembers()
    }
  }

  async #refreshHidden(): Promise<void> {
    this.hidden.set(await loadHidden())
  }

  /** Current websites-menu membership (path keys) — what the website root
   *  row's checkbox reads. Refreshed with the hidden pool and after every
   *  website enable/disable. */
  readonly websiteMembers = signal<ReadonlySet<string>>(new Set())

  async #refreshMembers(): Promise<void> {
    const list = await listAggregation('websites').catch(() => [])
    this.websiteMembers.set(new Set(list.map(m => m.segments.join('/'))))
  }

  // ── allow / add / download — the toggles are REAL ─────────────────
  // (No group-level adopt button: the features window IS the adopt surface —
  //  each row's switch is the individual add.)

  /** Branch-scope for the allow: a WEBSITE is adopted as ONE operation — its
   *  pages span the whole subtree, so allowing it must cover every page under
   *  the site's root, not just the one page sig in hand. Without this, each
   *  child page re-gated individually (and after a reload — when the
   *  in-memory per-sig domain attributions are gone — the whole adopted site
   *  fell back behind per-page gates: "the site disappeared"). Per-TILE
   *  features (a game on one tile) stay per-sig. */
  #allowScope(group: FeatureGroup, feat: FeatureRow): void {
    if (feat.view === 'website') markAllowedRoot(branchRootFor(this.#segmentsFor(group, feat)))
  }

  /** Override the community block for one feature: record its payload sig as
   *  verified (an explicit bypass) — branch-wide for branch features (see
   *  #allowScope) — and tell the render gate to re-reconcile: the feature
   *  activates and its resources may stream. */
  allow(group: FeatureGroup, feat: FeatureRow): void {
    if (!feat.gateSig) return
    markVerified({ sig: feat.gateSig, cell: group.cell, kind: feat.kind, label: feat.label, bypassed: true })
    this.#allowScope(group, feat)
    EffectBus.emit('feature:verified', { sig: feat.gateSig })
    feat.gated = false
    this.group.update(g => g ? { ...g } : g)   // re-render the cleared line
  }

  /** Bulk allow — override the block for every SELECTED blocked feature. */
  allowSelected(): void {
    let cleared = false
    for (const { group, feat } of this.#selectedRows()) {
      if (!feat.gated || !feat.gateSig) continue
      markVerified({ sig: feat.gateSig, cell: group.cell, kind: feat.kind, label: feat.label, bypassed: true })
      this.#allowScope(group, feat as FeatureRow)
      EffectBus.emit('feature:verified', { sig: feat.gateSig })
      feat.gated = false
      cleared = true
    }
    if (cleared) this.group.update(g => g ? { ...g } : g)
  }

  /** Bulk download — mirror every selected feature's bytes onto this
   *  machine (the tiles are already held; adopt folded them). */
  downloadSelected(): void {
    const cells = new Set<string>()
    for (const { group, feat } of this.#selectedRows()) {
      if (!feat.branchSig && !feat.gateSig) continue
      cells.add(group.cell)
      EffectBus.emit('features:download', {
        cell: group.cell,
        segments: [...group.segments],
        ...(feat.branchSig ? { branchSig: feat.branchSig } : {}),
        ...(feat.gateSig ? { gateSig: feat.gateSig } : {}),
      })
    }
    if (!cells.size) return
    // Fresh batch from idle → the counter starts over; a re-requested cell's
    // old outcome line drops (its NEW outcome replaces it when done lands).
    if (this.downloading().size === 0) this.downloadedCount.set(0)
    this.downloadResults.update(list => list.filter(r => !cells.has(r.cell)))
    this.downloading.update(set => new Set([...set, ...cells]))
    this.#armDownloadLeash()
  }

  isDownloading(): boolean {
    return this.downloading().size > 0
  }

  /** OPEN this view behaviour — the "enter it now" action the deck's slides
   *  needed. Navigates INTO the tile, then flips the global render surface to
   *  the behaviour's view: for slides that hands the viewport to
   *  SlidesViewDrone, which plays the deck's child diagram tiles; for a
   *  website/home/tutor it renders that cell's page. The row's switch stays
   *  the on/off control — this is separate. Activation routes through
   *  `view:toggle` (the same path the command-line view toggle and
   *  `/present on` use, so ViewBee owns the flip), then the panel closes so
   *  the view takes the screen.
   *
   *  Order matters: navigate BEFORE the flip. Renderers reconcile off the
   *  live lineage, so entering the tile first means the first reconcile in the
   *  new view already sees the deck (not the parent we opened the panel from). */
  openBehavior(group: FeatureGroup, feat: FeatureRow): void {
    if (!feat.openable || !feat.view) return
    const nav = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ go?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
    nav?.go?.([...group.segments])
    EffectBus.emit('view:toggle', { view: feat.view, mode: 'on' })
    this.close()
  }

  /** Bulk-bar Open — enter the first selected openable behaviour. Opening a
   *  view is a single-surface action (you're in one view at a time), so the
   *  top-bar button opens the first selected enterable row and closes; the
   *  per-row ▶ button is the direct path for a specific one. */
  openSelected(): void {
    const group = this.group()
    if (!group) return
    const feat = group.applied.find(f =>
      f.openable && this.selectedKeys().has(this.rowKey(group, f)) && this.isOn(group, f))
    if (feat) this.openBehavior(group, feat)
  }

  isPending(group: FeatureGroup, feat: RowLike): boolean {
    return this.pending().has(this.rowKey(group, feat))
  }

  /** The row's plain-words outcome note ('' = none). Failures only —
   *  success is the state flipping, and silence is the healthy state. */
  rowNote(group: FeatureGroup, feat: RowLike): string {
    return this.rowNotes().get(this.rowKey(group, feat)) ?? ''
  }

  /** The WHY line under a failure note while fetching is degraded — the
   *  content-health sentence, same plain words as the indicator pill.
   *  '' while healthy (the note stands alone). */
  healthWhy(): string {
    const h = this.health()
    if (!h || h.condition === 'healthy') return ''
    const i18n = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ t: (k: string, p?: Record<string, unknown>) => string }>('@hypercomb.social/I18n')
    return i18n?.t(`health.${h.condition}`, { host: h.host ?? '' }) ?? ''
  }

  /** Drop one row's note (a retry starts clean). */
  #clearNote(key: string): void {
    this.rowNotes.update(m => {
      if (!m.has(key)) return m
      const next = new Map(m)
      next.delete(key)
      return next
    })
  }

  /** The leash's honest landing: a producer that died without answering
   *  still settles the row with plain words instead of a silent un-wedge. */
  #noteNoAnswer(key: string): void {
    const i18n = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ t: (k: string, p?: Record<string, unknown>) => string }>('@hypercomb.social/I18n')
    const msg = i18n?.t('features.note.noanswer') ?? 'no answer — try again'
    this.rowNotes.update(m => new Map(m).set(key, msg))
  }

  /** ADD an available feature to the tile — the switch's ON gesture. Emits
   *  `features:enable` with the tile's EXPLICIT segments; ShowFeaturesDrone
   *  writes the decoration there and re-opens the group (the row moves into
   *  "On this layer"). Explicit segments — never the current selection or
   *  location — so the attach can't land on the wrong cell. Only rows the
   *  drone marked `addable` render this switch (view bees' slash commands
   *  TOGGLE a view; running one here flipped the whole app into website mode
   *  instead of attaching anything). */
  enableAvailable(group: FeatureGroup, feat: AvailableRow): void {
    if (!feat.addable) return
    const key = this.rowKey(group, feat)
    if (this.pending().has(key)) return
    this.pending.update(set => new Set([...set, key]))
    this.#clearNote(key)   // a retry starts clean
    EffectBus.emit('features:enable', {
      cell: group.cell,
      segments: [...group.segments],
      kind: feat.kind,
      view: feat.view,
    })
    // Backstop leash: the drone answers every enable with `features:outcome`
    // (and success also refreshes the group) — this fires only when the
    // producer died without answering, and it says so on the row.
    setTimeout(() => {
      if (!this.pending().has(key)) return
      this.pending.update(set => {
        const next = new Set(set)
        next.delete(key)
        return next
      })
      this.#noteNoAnswer(key)
    }, 4000)
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Escape backs out of an in-progress review first, then clears an active
    // search, and only then closes the panel.
    if (this.reviewTarget()) { this.cancelReview(); return }
    if (this.query()) { this.query.set(''); return }
    this.close()
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-features-viewer',
  owner: '@hypercomb.shared/FeaturesViewerComponent',
  component: FeaturesViewerComponent,
  order: 120,
})
