// hypercomb-shared/ui/features-viewer/features-viewer.component.ts
//
// Right-docked "Features" panel. Opened when a tile's puzzle-piece icon is
// clicked — or by the ADOPT gesture, which folds the branch and lands here
// (ShowFeaturesDrone answers `tile:action` with `features:open`). For each
// tile it shows TWO sections:
//
//   • On this layer — the features the tile already HAS (direct + cascaded),
//     each tagged with where it comes from. The row's switch turns the
//     feature OFF into the retainable hidden pool. A row the community gate
//     BLOCKS carries a small "enabled — blocked" line with an inline allow
//     override (markVerified bypass → `feature:verified` → the render gate
//     re-reconciles and the feature activates).
//   • Available to add — every feature the app knows that this layer does NOT
//     have yet. The row's switch ADDS it — routed through the bee's OWN slash
//     command (the same attach logic the command line's `@feature` uses), so
//     payloads and gating stay correct.
//
// Rows are multi-selectable; a bulk bar at the top acts on the selection:
// ALLOW overrides the community block for every selected blocked feature,
// DOWNLOAD mirrors the selected features' bytes locally (`features:download`,
// handled by SwarmAdoptDrone → broker walk).
//
// Click another tile's icon and its sections APPEND to the list — you run
// through the hive comparing what each layer has against what it could have,
// without leaving for the installer.
//
// Shell UI, so it must NOT import essentials — module services are reached
// only through window.ioc at runtime, and gate state arrives pre-computed on
// the `features:open` payload.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { markVerified, markAllowedRoot, branchRootFor } from './feature-verified'
import { hideFeature, restoreFeature, loadHidden, hiddenKey, type HiddenFeature } from './feature-hidden'
import { adoptTargetSuggestions, createAdoptTargetPath, type AdoptTargetSuggestion } from './adopt-target'

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
  /** False = a NOT-YET-ADOPTED peer tile's feature (listed from the peer's
   *  branch root; nothing local yet). Its switch renders OFF and turning it
   *  on emits `adopt-feature` — the individual add, and the only moment
   *  anything folds or downloads. Absent = on the local layer. */
  adopted?: boolean
  /** True when the community verification gate currently blocks activation —
   *  the row shows the "enabled — blocked" line + allow override. */
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
  adopted?: boolean
}

interface FeatureGroup {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
  /** True = the tile exists in the LOCAL layer. False = a peer-only offer —
   *  the adopt-target row shows only then. */
  held?: boolean
  /** Held tile with a live peer counterpart: the children each copy has that
   *  the other doesn't. `missing` rows merge in per name; `extra` (yours
   *  only) is informational — a diff never deletes your content. */
  hierarchy?: { missing: string[]; extra: string[] }
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
  held?: boolean
  hierarchy?: { missing: string[]; extra: string[] }
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

  /** Multi-selected rows (by stable row key). The bulk bar at the top acts on
   *  this set: allow the blocked ones, download the selected ones. */
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set())

  /** Rows whose ADD is in flight (available-row switch clicked) — guards the
   *  double-click and shows the busy state. */
  readonly pending = signal<ReadonlySet<string>>(new Set())

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

  /** Fast membership: the hide keys currently in the pool. */
  readonly #hiddenKeys = computed(() => {
    const s = new Set<string>()
    for (const d of this.hidden()) s.add(hiddenKey(d.featKind, d.appliesTo))
    return s
  })

  #cleanups: (() => void)[] = []

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
        held: p.held,
        ...(p.hierarchy ? { hierarchy: p.hierarchy } : {}),
      }
      // One tile at a time: re-clicking the SAME tile refreshes it in place;
      // clicking a DIFFERENT tile replaces the subject (and drops the old
      // tile's row selection, which can't carry across cells).
      const prev = this.group()
      if (prev?.cell !== group.cell) this.selectedKeys.set(new Set())
      this.group.set(group)
      if (!this.visible()) this.visible.set(true)
      // A fresh group replaces its rows — any in-flight ADD for it is settled.
      if (this.pending().size) this.pending.set(new Set())
      // An adopt-feature just folded this tile — seed every OTHER direct
      // feature OFF so only the chosen one activates.
      const chosen = this.#pendingAdopt.get(group.cell)
      if (chosen !== undefined) {
        this.#pendingAdopt.delete(group.cell)
        void this.#seedOthersOff(group, chosen)
      }
      // Refresh the hidden pool so the rows' switches read their real state.
      void this.#refreshHidden()
    }))

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
    this.#cancelTargetBlur()
  }

  close(): void {
    this.visible.set(false)
    this.group.set(null)
    this.selectedKeys.set(new Set())
    this.pending.set(new Set())
    this.downloadResults.set([])
    // Reset the target combobox so a reopen starts clean.
    this.openTargetCell.set(null)
    this.activeSuggestIndex.set(-1)
    this.#targetSuggestions.clear()
    this.#cancelTargetBlur()
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

  /** The location an applied feature is attached at — its declaring ancestor
   *  for a cascaded feature, else the tile itself. This is the hide scope. */
  #segmentsFor(group: FeatureGroup, feat: RowLike): string[] {
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

  /** True when this feature is turned OFF (in the hidden pool) — the row's
   *  switch reads this for its on/off state. Off features stay in the list. */
  isHidden(group: FeatureGroup, feat: RowLike): boolean {
    return this.#hiddenKeys().has(this.rowKey(group, feat))
  }

  /** Every feature ON THIS LAYER — both active AND turned-off. Turning a
   *  feature off does NOT remove it from the list (it just flips its switch);
   *  "off" reads the same as "not adopted", so the row stays put and one click
   *  turns it back on. */
  visibleApplied(group: FeatureGroup): FeatureRow[] {
    return group.applied
  }

  /** Is this row's switch ON? A not-yet-adopted peer feature is always OFF;
   *  a local feature is ON unless it's in the hidden pool. */
  isOn(group: FeatureGroup, feat: FeatureRow): boolean {
    if (feat.adopted === false) return false
    return !this.isHidden(group, feat)
  }

  /** Can this row be ENTERED as a view? True for on, local view behaviours
   *  (slides/website/home/tutor). A turned-off or not-yet-adopted row has no
   *  live view to open, so the Open affordance stays hidden for it. */
  isOpenable(group: FeatureGroup, feat: FeatureRow): boolean {
    return feat.openable === true && this.isOn(group, feat)
  }

  /** The applied row's switch. Three cases, all IN PLACE (the row never
   *  leaves the list):
   *   • not-yet-adopted peer feature → `adopt-feature`: THE individual add —
   *     the only moment the branch folds / code-consent runs / bytes move.
   *     Every OTHER feature of the tile starts OFF (seeded on the refresh).
   *   • local + on  → off: written to the hidden pool (inert but retained;
   *     the render gate keeps it from mounting).
   *   • local + off → on: its pool member removed (the gate re-mounts). */
  async toggleActive(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    if (feat.adopted === false) { this.#adoptFeature(group, feat); return }
    if (this.isHidden(group, feat)) await this.#turnOn(group, feat)
    else await this.#turnOff(group, feat)
  }

  /** Cells with an adopt-feature in flight → the feature kind that was chosen.
   *  When the post-fold refresh lands, every OTHER direct feature is seeded
   *  OFF so only the chosen one activates ("click for each individual
   *  feature" — nothing you didn't ask for turns on or downloads). */
  #pendingAdopt = new Map<string, string>()

  // ── adopt target ──────────────────────────────────────────────────
  // WHERE the branch folds. Captured at adopt-click time (the group's own
  // parent path — never re-derived from wherever the participant wanders) and
  // EDITABLE per group, so a reorganized hive adopts straight into the right
  // place instead of "fold at the original position, then move it". Keyed by
  // cell; the version signal drives re-render on edits.
  #targetOverrides = new Map<string, string>()
  readonly #targetsVersion = signal(0)

  /** True when this group is a not-yet-adopted peer tile — the target row
   *  shows only then. A HELD tile (held !== false) keeps its location even
   *  when peer DIFF rows (adopted:false) are mixed into its list — those
   *  merge in place, they don't re-home anything. */
  isPeerGroup(group: FeatureGroup): boolean {
    return group.held === false
  }

  /** Merge one missing child (or all of them) from the peer's copy of this
   *  held tile — the hierarchy half of the diff. Additive only. */
  mergeChild(group: FeatureGroup, name?: string): void {
    EffectBus.emit('tile:action', {
      action: 'merge-children',
      label: group.cell,
      segments: [...group.segments],
      ...(name ? { names: [name] } : {}),
    })
  }

  /** The group's adopt target as a display path ('/' = the hive root). */
  targetFor(group: FeatureGroup): string {
    this.#targetsVersion()   // establish reactive dependency
    const override = this.#targetOverrides.get(group.cell)
    if (override !== undefined) return override
    const parent = group.segments.slice(0, -1)
    return '/' + parent.join('/')
  }

  setTarget(group: FeatureGroup, raw: string): void {
    this.#targetOverrides.set(group.cell, String(raw ?? ''))
    this.#targetsVersion.update(v => v + 1)
  }

  /** Parse the target path into parent segments ([] = root). */
  #targetSegments(group: FeatureGroup): string[] {
    return this.targetFor(group).split('/').map(s => s.trim()).filter(Boolean)
  }

  // ── adopt-target autocomplete ─────────────────────────────────────
  // The target input is a combobox: type a destination and either COMPLETE
  // against locations that exist or CREATE the typed path (the drone refuses a
  // target that doesn't resolve, so create-then-set is what makes an adopt into
  // a not-yet-built folder actually land). One dropdown open at a time, keyed
  // by cell; suggestions are computed async off HistoryService, so a per-cell
  // sequence guards against a slow earlier query clobbering a newer one.

  /** The cell whose target dropdown is open (null = none). */
  readonly openTargetCell = signal<string | null>(null)
  /** Keyboard cursor within the open dropdown (-1 = none highlighted). */
  readonly activeSuggestIndex = signal(-1)

  #targetSuggestions = new Map<string, AdoptTargetSuggestion[]>()
  readonly #targetSuggestVersion = signal(0)
  #targetSeq = new Map<string, number>()
  #targetBlurTimer: ReturnType<typeof setTimeout> | null = null

  /** Rows to render for a group's dropdown (reactive via the version signal). */
  targetSuggestions(group: FeatureGroup): AdoptTargetSuggestion[] {
    this.#targetSuggestVersion()
    return this.#targetSuggestions.get(group.cell) ?? []
  }

  /** Open + non-empty — the only time the listbox renders. */
  isTargetOpen(group: FeatureGroup): boolean {
    return this.openTargetCell() === group.cell && this.targetSuggestions(group).length > 0
  }

  isActiveSuggest(index: number): boolean {
    return this.activeSuggestIndex() === index
  }

  onTargetFocus(group: FeatureGroup): void {
    this.#cancelTargetBlur()
    this.openTargetCell.set(group.cell)
    this.activeSuggestIndex.set(-1)
    void this.#recomputeTargetSuggestions(group)
  }

  onTargetInput(group: FeatureGroup, value: string): void {
    this.setTarget(group, value)
    this.openTargetCell.set(group.cell)
    this.activeSuggestIndex.set(-1)
    void this.#recomputeTargetSuggestions(group)
  }

  /** Close on blur, but after a beat so a mousedown on an option still lands
   *  (option clicks also preventDefault the blur — this is the belt-and-braces). */
  onTargetBlur(group: FeatureGroup): void {
    this.#cancelTargetBlur()
    this.#targetBlurTimer = setTimeout(() => {
      this.#targetBlurTimer = null
      if (this.openTargetCell() === group.cell) this.openTargetCell.set(null)
    }, 150)
  }

  onTargetKey(group: FeatureGroup, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // Close the dropdown WITHOUT letting the panel's own Escape handler fire
      // and close the whole panel.
      if (this.openTargetCell() === group.cell) {
        event.preventDefault()
        event.stopPropagation()
        this.openTargetCell.set(null)
      }
      return
    }
    if (!this.isTargetOpen(group)) return
    const list = this.targetSuggestions(group)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.activeSuggestIndex.set((this.activeSuggestIndex() + 1) % list.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.activeSuggestIndex.set((this.activeSuggestIndex() - 1 + list.length) % list.length)
    } else if (event.key === 'Enter') {
      const i = this.activeSuggestIndex()
      if (i >= 0 && i < list.length) {
        event.preventDefault()
        void this.pickTarget(group, list[i])
      }
    }
  }

  /** Accept a row: a `create` mints the path first (so the drone's existence
   *  check passes), then either kind sets the field to the chosen path. */
  async pickTarget(group: FeatureGroup, suggestion: AdoptTargetSuggestion): Promise<void> {
    this.#cancelTargetBlur()
    if (suggestion.kind === 'create') {
      const ok = await createAdoptTargetPath(suggestion.segments)
      if (!ok) return
    }
    this.setTarget(group, suggestion.path)
    this.openTargetCell.set(null)
    this.activeSuggestIndex.set(-1)
  }

  async #recomputeTargetSuggestions(group: FeatureGroup): Promise<void> {
    const seq = (this.#targetSeq.get(group.cell) ?? 0) + 1
    this.#targetSeq.set(group.cell, seq)
    const list = await adoptTargetSuggestions(this.targetFor(group))
    if (this.#targetSeq.get(group.cell) !== seq) return   // a newer query superseded this one
    this.#targetSuggestions.set(group.cell, list)
    this.#targetSuggestVersion.update(v => v + 1)
  }

  #cancelTargetBlur(): void {
    if (!this.#targetBlurTimer) return
    clearTimeout(this.#targetBlurTimer)
    this.#targetBlurTimer = null
  }

  #adoptFeature(group: FeatureGroup, feat: FeatureRow): void {
    const key = this.rowKey(group, feat)
    if (this.pending().has(key)) return
    this.pending.update(set => new Set([...set, key]))
    // Seed-others-off applies ONLY to a fresh branch adopt. On a HELD tile
    // this switch is a single-feature MERGE from the peer's copy — seeding
    // would turn the participant's own existing features off.
    if (group.held === false) this.#pendingAdopt.set(group.cell, feat.kind)
    EffectBus.emit('tile:action', {
      action: 'adopt-feature',
      label: group.cell,
      kind: feat.kind,
      // The CHOSEN destination — SwarmAdoptDrone validates it exists
      // (refuse-don't-guess) and folds the branch under it. For a held tile
      // this is simply its own parent path (no target row shows).
      at: this.#targetSegments(group),
    })
    // Leash: a failed/declined adopt must not wedge the switch (the refresh
    // normally clears pending long before this).
    setTimeout(() => {
      this.#pendingAdopt.delete(group.cell)
      this.pending.update(set => {
        if (!set.has(key)) return set
        const next = new Set(set)
        next.delete(key)
        return next
      })
    }, 8000)
  }

  /** After an adopt-feature fold lands (the refreshed group arrives), turn
   *  every OTHER direct feature OFF so only the chosen one is on. Idempotent —
   *  hideFeature dedups by pool signature. */
  async #seedOthersOff(group: FeatureGroup, chosenKind: string): Promise<void> {
    for (const feat of group.applied) {
      if (feat.origin !== 'direct' || feat.kind === chosenKind) continue
      if (feat.adopted === false) continue   // still peer-only — nothing local to turn off
      if (this.isHidden(group, feat)) continue
      const segments = this.#segmentsFor(group, feat)
      const sig = await hideFeature({ featKind: feat.kind, view: feat.view, label: feat.label, segments })
      if (sig) EffectBus.emit('feature:hidden', { featKind: feat.kind, segments })
    }
    await this.#refreshHidden()
  }

  /** Turn a feature OFF: write it into the hidden pool (retained) and
   *  re-reconcile its render via `feature:hidden`. */
  async #turnOff(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const segments = this.#segmentsFor(group, feat)
    const sig = await hideFeature({ featKind: feat.kind, view: feat.view, label: feat.label, segments })
    if (!sig) return
    EffectBus.emit('feature:hidden', { featKind: feat.kind, segments })
    await this.#refreshHidden()
  }

  /** Turn a feature back ON: remove its hidden-pool member so the gate
   *  re-mounts it. Resolves the pool record from the row's hide scope. */
  async #turnOn(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const key = this.rowKey(group, feat)
    const rec = this.hidden().find(d => hiddenKey(d.featKind, d.appliesTo) === key)
    if (!rec) return
    const ok = await restoreFeature(rec.recordSig)
    if (!ok) return
    EffectBus.emit('feature:restored', { featKind: rec.featKind, segments: rec.appliesTo })
    await this.#refreshHidden()
  }

  async #refreshHidden(): Promise<void> {
    this.hidden.set(await loadHidden())
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

  /** Bulk download — mirror every selected local/held feature's bytes onto
   *  this machine. For a not-yet-held peer row, "download" must be the same
   *  real add as the row switch: fold the branch into the hive first. A silent
   *  byte mirror alone leaves no local child, so returning to solo makes the
   *  tile vanish even though the panel said the download completed. */
  downloadSelected(): void {
    const cells = new Set<string>()
    for (const { group, feat } of this.#selectedRows()) {
      if (group.held === false && feat.adopted === false) {
        this.#adoptFeature(group, feat as FeatureRow)
        continue
      }
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
    EffectBus.emit('features:enable', {
      cell: group.cell,
      segments: [...group.segments],
      kind: feat.kind,
      view: feat.view,
    })
    // The drone answers with a fresh `features:open` upsert for this tile,
    // which replaces the whole group — clear the busy marker on a short leash
    // so a failed enable doesn't wedge the switch.
    setTimeout(() => {
      this.pending.update(set => {
        if (!set.has(key)) return set
        const next = new Set(set)
        next.delete(key)
        return next
      })
    }, 4000)
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Escape backs out of an in-progress review first, then closes the panel.
    if (this.reviewTarget()) { this.cancelReview(); return }
    this.close()
  }
}
