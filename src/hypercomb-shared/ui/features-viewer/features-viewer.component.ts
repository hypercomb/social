// hypercomb-shared/ui/features-viewer/features-viewer.component.ts
//
// Right-docked "Features" panel. Opened when a tile's puzzle-piece icon is
// clicked (ShowFeaturesDrone answers `tile:action` with `features:open`). For
// each tile it shows TWO sections:
//
//   • On this layer — the features the tile already HAS (direct + cascaded),
//     each tagged with where it comes from.
//   • Available to add — every feature the app knows that this layer does NOT
//     have yet, each with its slash command.
//
// Click another tile's icon and its sections APPEND to the list — you run
// through the hive comparing what each layer has against what it could have,
// without leaving for the installer.
//
// Shell UI, so it must NOT import essentials. It renders straight from the
// `features:open` payload (already i18n-resolved by the drone) and owns only
// the BENIGN "like" staging: a per-row star records the feature in
// feature-staging.ts (hive-local). Nothing activates — when the participant
// later opens the installer, portal-overlay hands the staged branch sigs over
// and they come pre-ticked / focused.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { featureKey, isStaged, toggleStaged, clearStaged, type StagedFeature } from './feature-staging'
import { markVerified } from './feature-verified'
import { hideFeature, restoreFeature, loadHidden, hiddenKey, type HiddenFeature } from './feature-hidden'

/** A feature already applied to the layer. */
interface FeatureRow {
  view: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  behavior?: string
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
}

/** Minimal shape the staging helpers need — both row kinds satisfy it. */
type StageableRow = { kind: string; branchSig?: string; view: string; label: string }

interface FeatureGroup {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
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
  readonly groups = signal<FeatureGroup[]>([])

  /** A foreign feature the participant has been asked to REVIEW before enabling.
   *  Set from `feature:review:open` (emitted by the website gate when it blocks
   *  an unverified page). Shows the feature's actual code; Accept / Bypass write
   *  the verified sig and re-activate it. Null = no review in progress. */
  readonly reviewTarget = signal<{
    cell: string; segments: string[]; sig: string; kind: string; label: string; code: string
  } | null>(null)

  /** Reactivity trigger for staged state (read synchronously from
   *  localStorage, mirroring DCP's domain-visibility pattern). */
  readonly stagingVersion = signal(0)

  /** Hidden pool members, loaded from the signature pool. Drives two things:
   *  filtering hidden features OUT of the active lists, and the "show hidden"
   *  view (where each carries a Restore affordance). */
  readonly hidden = signal<HiddenFeature[]>([])

  /** When true the panel reveals HIDDEN features (with restore) instead of
   *  hiding them. The hidden set is scoped per location (per group). */
  readonly showHidden = signal(false)

  /** Row the participant has highlighted — purely a selection affordance so it
   *  reads as actionable (hover highlights, click pins the highlight). */
  readonly selectedKey = signal<string | null>(null)

  /** Fast membership: the hide keys currently in the pool. */
  readonly #hiddenKeys = computed(() => {
    const s = new Set<string>()
    for (const d of this.hidden()) s.add(hiddenKey(d.featKind, d.appliesTo))
    return s
  })

  /** Total hidden features across the open groups' locations — drives the
   *  header toggle's count. */
  readonly hiddenCount = computed(() => {
    const locs = new Set(this.groups().map(g => g.segments.join('/')))
    return this.hidden().filter(d => locs.has(d.appliesTo.join('/'))).length
  })

  /** Total liked features across all groups — drives the footer hint. */
  readonly likedCount = computed(() => {
    this.stagingVersion()   // establish reactive dependency
    let n = 0
    for (const g of this.groups()) {
      for (const r of g.applied) if (isStaged(this.#keyFor(g, r))) n++
      for (const r of g.available) if (isStaged(this.#keyFor(g, r))) n++
    }
    return n
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
      }
      // Upsert by tile: re-clicking a tile refreshes its group in place
      // rather than duplicating it; a new tile appends to the list.
      this.groups.update(list => {
        const idx = list.findIndex(g => g.cell === group.cell)
        if (idx >= 0) {
          const next = [...list]
          next[idx] = group
          return next
        }
        return [...list, group]
      })
      if (!this.visible()) this.visible.set(true)
      // Refresh the hidden pool so the new group's features are filtered /
      // its hidden ones become restorable.
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
   *  Writes the verified sig and emits `feature:verified` so the gate
   *  re-reconciles and the page activates. */
  acceptReview(bypassed: boolean): void {
    const t = this.reviewTarget()
    if (!t) return
    markVerified({ sig: t.sig, cell: t.cell, kind: t.kind, label: t.label, bypassed })
    EffectBus.emit('feature:verified', { sig: t.sig })
    this.reviewTarget.set(null)
  }

  cancelReview(): void {
    this.reviewTarget.set(null)
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  close(): void {
    this.visible.set(false)
    this.groups.set([])
    this.showHidden.set(false)
    this.selectedKey.set(null)
  }

  /** Drop one tile's sections from the view (does not clear its staging). */
  removeGroup(cell: string): void {
    this.groups.update(list => list.filter(g => g.cell !== cell))
    if (this.groups().length === 0) this.close()
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
  #segmentsFor(group: FeatureGroup, feat: FeatureRow): string[] {
    return feat.originSegments?.length ? [...feat.originSegments] : [...group.segments]
  }

  /** Stable per-row key (feature kind @ scope) — used for both the hide pool
   *  membership and the selection highlight. */
  rowKey(group: FeatureGroup, feat: FeatureRow): string {
    return hiddenKey(feat.kind, this.#segmentsFor(group, feat))
  }

  isSelected(group: FeatureGroup, feat: FeatureRow): boolean {
    return this.selectedKey() === this.rowKey(group, feat)
  }

  /** Click a row to pin/unpin its highlight (the "this is actionable" cue). */
  selectRow(group: FeatureGroup, feat: FeatureRow): void {
    const k = this.rowKey(group, feat)
    this.selectedKey.update(cur => (cur === k ? null : k))
  }

  isHidden(group: FeatureGroup, feat: FeatureRow): boolean {
    return this.#hiddenKeys().has(this.rowKey(group, feat))
  }

  /** Applied features still active at this tile — hidden ones removed unless
   *  the participant is explicitly viewing hidden. */
  visibleApplied(group: FeatureGroup): FeatureRow[] {
    if (this.showHidden()) return []
    return group.applied.filter(f => !this.isHidden(group, f))
  }

  /** Hidden features attached at this tile's location — the "show hidden" view,
   *  each restorable. */
  hiddenFor(group: FeatureGroup): HiddenFeature[] {
    const loc = group.segments.join('/')
    return this.hidden().filter(d => d.appliesTo.join('/') === loc)
  }

  /** Hide an applied feature: write it into the pool (turn off, retained) and
   *  re-reconcile its render via `feature:hidden`. */
  async hide(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const segments = this.#segmentsFor(group, feat)
    const sig = await hideFeature({ featKind: feat.kind, view: feat.view, label: feat.label, segments })
    if (!sig) return
    EffectBus.emit('feature:hidden', { featKind: feat.kind, segments })
    await this.#refreshHidden()
  }

  /** Restore a hidden feature — remove its pool member; the gate re-mounts. */
  async restore(rec: HiddenFeature): Promise<void> {
    const ok = await restoreFeature(rec.recordSig)
    if (!ok) return
    EffectBus.emit('feature:restored', { featKind: rec.featKind, segments: rec.appliesTo })
    await this.#refreshHidden()
  }

  toggleShowHidden(): void {
    this.showHidden.update(v => !v)
  }

  async #refreshHidden(): Promise<void> {
    this.hidden.set(await loadHidden())
  }

  // ── benign "like" staging ─────────────────────────────────

  #keyFor(group: FeatureGroup, row: StageableRow): string {
    return featureKey({ sig: row.branchSig, cell: group.cell, kind: row.kind })
  }

  isLiked(group: FeatureGroup, row: StageableRow): boolean {
    this.stagingVersion()   // establish reactive dependency
    return isStaged(this.#keyFor(group, row))
  }

  /** True when this feature carries an installer-resolvable branch sig — i.e.
   *  liking it will actually pre-tick something in the installer (vs. a benign
   *  metadata-only like for a feature with no peer branch). */
  installable(row: StageableRow): boolean {
    return typeof row.branchSig === 'string' && /^[a-f0-9]{64}$/.test(row.branchSig)
  }

  /** True when this tile is offered by a peer — at least one applied feature
   *  carries an installer-resolvable branch sig. Only then is there a branch to
   *  adopt. */
  adoptable(group: FeatureGroup): boolean {
    return group.applied.some(r => this.installable(r))
  }

  /** Lead into the adopt process for this peer-offered tile. Emits the canonical
   *  adopt verb — SwarmAdoptDrone re-resolves the branch from the live peer cache
   *  and routes into the same install/enable flow used everywhere. NOT a benign
   *  stage: this is "adopt", reached from the features window, the way the
   *  features icon is the one surface in both solo and swarm. */
  adopt(group: FeatureGroup): void {
    EffectBus.emit('tile:action', { action: 'adopt-selected', selections: [{ label: group.cell }] })
  }

  toggleLike(group: FeatureGroup, row: StageableRow): void {
    const staged: StagedFeature = {
      key: this.#keyFor(group, row),
      ...(row.branchSig ? { sig: row.branchSig } : {}),
      cell: group.cell,
      kind: row.kind,
      view: row.view,
      label: row.label,
    }
    toggleStaged(staged)
    this.stagingVersion.update(v => v + 1)
  }

  clearLikes(): void {
    clearStaged()
    this.stagingVersion.update(v => v + 1)
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Escape backs out of an in-progress review first, then closes the panel.
    if (this.reviewTarget()) { this.cancelReview(); return }
    this.close()
  }
}
