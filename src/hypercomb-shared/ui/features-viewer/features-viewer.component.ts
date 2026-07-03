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
}

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
      // A fresh group replaces its rows — any in-flight ADD for it is settled.
      if (this.pending().size) this.pending.set(new Set())
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

    // A bulk download finished for a tile — drop its busy marker.
    this.#cleanups.push(EffectBus.on<{ cell?: string }>('features:download:done', (p) => {
      const cell = String(p?.cell ?? '')
      if (!cell) return
      this.downloading.update(set => {
        if (!set.has(cell)) return set
        const next = new Set(set)
        next.delete(cell)
        return next
      })
    }))
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
    this.selectedKeys.set(new Set())
    this.pending.set(new Set())
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

  /** Every currently-selected row, resolved back to its group. Applied rows
   *  are matched first; available rows carry `applied: false`. */
  #selectedRows(): { group: FeatureGroup; feat: RowLike; applied: boolean }[] {
    const picked = this.selectedKeys()
    const out: { group: FeatureGroup; feat: RowLike; applied: boolean }[] = []
    for (const group of this.groups()) {
      for (const feat of group.applied) {
        if (picked.has(this.rowKey(group, feat))) out.push({ group, feat, applied: true })
      }
      for (const feat of group.available) {
        if (picked.has(this.rowKey(group, feat))) out.push({ group, feat, applied: false })
      }
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

  /** The switch's ON gesture on an applied row: flip active ⇄ off IN PLACE.
   *  Off = written to the hidden pool (inert but retained; the render gate
   *  keeps it from mounting). On = its pool member removed (the gate re-mounts).
   *  The row never leaves the list either way. */
  async toggleActive(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    if (this.isHidden(group, feat)) await this.#turnOn(group, feat)
    else await this.#turnOff(group, feat)
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

  /** True when this feature carries an installer-resolvable branch sig. */
  installable(row: RowLike): boolean {
    return typeof row.branchSig === 'string' && /^[a-f0-9]{64}$/.test(row.branchSig)
  }

  /** True when this tile is offered by a peer — at least one applied feature
   *  carries an installer-resolvable branch sig. Only then is there a branch to
   *  adopt. */
  adoptable(group: FeatureGroup): boolean {
    return group.applied.some(r => this.installable(r))
  }

  /** Lead into the adopt process for this peer-offered tile. Emits the canonical
   *  single-adopt verb — SwarmAdoptDrone resolves the branch, DISAMBIGUATES when
   *  several publishers offer the same name (choose-panel), folds inline
   *  (code-bearing branches prompt for consent), then this panel reopens with
   *  the tile's real rows + gate states. NOT `adopt-selected` — that form skips
   *  the multi-publisher check and would silently adopt whichever copy the
   *  cache lists first. */
  adopt(group: FeatureGroup): void {
    EffectBus.emit('tile:action', { action: 'adopt', label: group.cell })
  }

  /** Override the community block for one feature: record its payload sig as
   *  verified (an explicit bypass) and tell the render gate to re-reconcile —
   *  the feature activates and its resources may stream. */
  allow(group: FeatureGroup, feat: FeatureRow): void {
    if (!feat.gateSig) return
    markVerified({ sig: feat.gateSig, cell: group.cell, kind: feat.kind, label: feat.label, bypassed: true })
    EffectBus.emit('feature:verified', { sig: feat.gateSig })
    feat.gated = false
    this.groups.update(list => [...list])   // re-render the cleared line
  }

  /** Bulk allow — override the block for every SELECTED blocked feature. */
  allowSelected(): void {
    let cleared = false
    for (const { group, feat } of this.#selectedRows()) {
      if (!feat.gated || !feat.gateSig) continue
      markVerified({ sig: feat.gateSig, cell: group.cell, kind: feat.kind, label: feat.label, bypassed: true })
      EffectBus.emit('feature:verified', { sig: feat.gateSig })
      feat.gated = false
      cleared = true
    }
    if (cleared) this.groups.update(list => [...list])
  }

  /** Bulk download — mirror every selected feature's bytes onto this machine.
   *  SwarmAdoptDrone answers `features:download` with the broker's full walk
   *  (branch) or the page + its refs (page-only), and confirms per cell. */
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
    if (cells.size) this.downloading.update(set => new Set([...set, ...cells]))
  }

  isDownloading(): boolean {
    return this.downloading().size > 0
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
