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
import { featureKey, isStaged, toggleStaged, clearStaged, type StagedFeature } from './feature-staging'

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
  imports: [TranslatePipe],
  templateUrl: './features-viewer.component.html',
  styleUrls: ['./features-viewer.component.scss'],
})
export class FeaturesViewerComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly groups = signal<FeatureGroup[]>([])

  /** Reactivity trigger for staged state (read synchronously from
   *  localStorage, mirroring DCP's domain-visibility pattern). */
  readonly stagingVersion = signal(0)

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
    }))

    this.#cleanups.push(EffectBus.on('features:viewer-close', () => {
      if (this.visible()) this.close()
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  close(): void {
    this.visible.set(false)
    this.groups.set([])
  }

  /** Drop one tile's sections from the view (does not clear its staging). */
  removeGroup(cell: string): void {
    this.groups.update(list => list.filter(g => g.cell !== cell))
    if (this.groups().length === 0) this.close()
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
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
  }
}
