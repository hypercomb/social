// hypercomb-shared/ui/features-viewer/features-viewer.component.ts
//
// Right-docked "Show features" panel. Opened when a tile's puzzle-piece icon
// is clicked (ShowFeaturesDrone answers `tile:action` with `features:open`).
// Lists the META details (no code) of the bee features that tile uses. Click
// another tile's icon and its features APPEND to the list — you run through
// the hive collecting features without leaving for the installer.
//
// Shell UI, so it must NOT import essentials. It renders straight from the
// `features:open` payload (already i18n-resolved by the drone) and owns only
// the BENIGN staging: a per-row "want" toggle records the feature in
// feature-staging.ts (hive-local). Nothing activates — when the participant
// later opens the installer, portal-overlay hands the staged branch sigs over
// and they come pre-ticked.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { featureKey, isStaged, toggleStaged, clearStaged, type StagedFeature } from './feature-staging'

interface FeatureRow {
  view: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  behavior?: string
  branchSig?: string
}

interface FeatureGroup {
  cell: string
  segments: string[]
  features: FeatureRow[]
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  features: FeatureRow[]
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

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<FeaturesOpenPayload>('features:open', (p) => {
      if (!p?.cell) return
      const group: FeatureGroup = {
        cell: p.cell,
        segments: Array.isArray(p.segments) ? p.segments : [],
        features: Array.isArray(p.features) ? p.features : [],
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

  /** Drop one tile's features from the view (does not clear its staging). */
  removeGroup(cell: string): void {
    this.groups.update(list => list.filter(g => g.cell !== cell))
    if (this.groups().length === 0) this.close()
  }

  // ── benign staging ───────────────────────────────────────

  #keyFor(group: FeatureGroup, feat: FeatureRow): string {
    return featureKey({ sig: feat.branchSig, cell: group.cell, kind: feat.kind })
  }

  isWanted(group: FeatureGroup, feat: FeatureRow): boolean {
    this.stagingVersion()   // establish reactive dependency
    return isStaged(this.#keyFor(group, feat))
  }

  /** True when this feature carries an installer-resolvable branch sig — i.e.
   *  staging it will actually pre-tick something in the installer. */
  installable(feat: FeatureRow): boolean {
    return typeof feat.branchSig === 'string' && /^[a-f0-9]{64}$/.test(feat.branchSig)
  }

  toggleWant(group: FeatureGroup, feat: FeatureRow): void {
    const staged: StagedFeature = {
      key: this.#keyFor(group, feat),
      ...(feat.branchSig ? { sig: feat.branchSig } : {}),
      cell: group.cell,
      kind: feat.kind,
      view: feat.view,
      label: feat.label,
    }
    toggleStaged(staged)
    this.stagingVersion.update(v => v + 1)
  }

  clearWants(): void {
    clearStaged()
    this.stagingVersion.update(v => v + 1)
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
  }
}
