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
}

/** A domain-level GLOBAL published on a cell's layer (`feature:global` mark
 *  on a domain root) — a game or package tool with no hive location. Name +
 *  meta only, inert: `installed` = a local module answers to the id, so the
 *  row gets a live play affordance; otherwise the module arrives only through
 *  the installer's own consent path. */
interface GlobalRow {
  id: string
  label: string
  icon?: string
  family?: string
  installed?: boolean
}

/** A global of YOUR OWN hive on the Globals tab — with its public state. */
interface OwnGlobalRow extends GlobalRow {
  public: boolean
}

interface FeatureGroup {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
  globals: GlobalRow[]
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
  globals?: GlobalRow[]
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

  /** Active tab: `tiles` = the per-tile groups; `globals` = your domain's
   *  global features (games, package tools) with their PUBLIC switches. */
  readonly tab = signal<'tiles' | 'globals'>('tiles')

  /** Your own globals — every local game plus every published root mark,
   *  from `features:globals` (refreshed on every open and publish toggle). */
  readonly ownGlobals = signal<OwnGlobalRow[]>([])

  /** Publish toggles in flight (by feature id) — guards the double-click. */
  readonly publishPending = signal<ReadonlySet<string>>(new Set())

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
        globals: Array.isArray(p.globals) ? p.globals : [],
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

    // Your domain's globals (local games + public state) — the Globals tab's
    // feed. Last-value replay covers a panel that mounts after the emit.
    this.#cleanups.push(EffectBus.on<{ globals?: OwnGlobalRow[] }>('features:globals', (p) => {
      this.ownGlobals.set(Array.isArray(p?.globals) ? p!.globals! : [])
      if (this.publishPending().size) this.publishPending.set(new Set())
    }))

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

  // ── Globals tab (domain-level features) ───────────────────────────

  setTab(tab: 'tiles' | 'globals'): void {
    this.tab.set(tab)
    // Ask for a fresh listing on entry — covers a panel that opened before
    // the drone's first emit (replay handles the reverse ordering).
    if (tab === 'globals') EffectBus.emit('features:globals-open', {})
  }

  /** Flip a global's PUBLIC switch. The drone writes / removes the root's
   *  `feature:global` mark and answers with a fresh `features:globals`
   *  (which also clears the pending set). */
  togglePublish(g: OwnGlobalRow): void {
    if (this.publishPending().has(g.id)) return
    this.publishPending.update(set => new Set([...set, g.id]))
    EffectBus.emit('features:publish-global', { id: g.id, on: !g.public })
    // Leash: a failed publish must not wedge the switch.
    setTimeout(() => {
      this.publishPending.update(set => {
        if (!set.has(g.id)) return set
        const next = new Set(set)
        next.delete(g.id)
        return next
      })
    }, 4000)
  }

  isPublishPending(g: OwnGlobalRow): boolean {
    return this.publishPending().has(g.id)
  }

  /** Launch an installed global — routes the launcher's uniform
   *  `<gameId>:toggle`, the same gesture as its tile in the games group. */
  playGlobal(g: GlobalRow): void {
    if (g.installed) EffectBus.emit(`${g.id}:toggle`, {})
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

  /** Is this row's switch ON? A not-yet-adopted peer feature is always OFF;
   *  a local feature is ON unless it's in the hidden pool. */
  isOn(group: FeatureGroup, feat: FeatureRow): boolean {
    if (feat.adopted === false) return false
    return !this.isHidden(group, feat)
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

  #adoptFeature(group: FeatureGroup, feat: FeatureRow): void {
    const key = this.rowKey(group, feat)
    if (this.pending().has(key)) return
    this.pending.update(set => new Set([...set, key]))
    this.#pendingAdopt.set(group.cell, feat.kind)
    EffectBus.emit('tile:action', { action: 'adopt-feature', label: group.cell, kind: feat.kind })
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
    this.groups.update(list => [...list])   // re-render the cleared line
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
