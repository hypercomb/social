// hypercomb-shared/ui/pools-of-meaning/pools-of-meaning.component.ts
//
// The "Pools of Meaning" card — the reference feature's surface. Hover the
// command-bar icon (hc-pools-icon) for a peek of every hive ROOT you
// reference — your own domain, community hosts, and roots learned by adopting
// other publishers' content; click the icon (or the peek) to STICK the card.
// Composes PinnableHoverBase — the same hover-peek → click-to-stick →
// drag-to-compare stack as the contact card and the action study card, never
// re-rolled. Persistent: a stuck card survives refresh (it's a management
// surface, not a passing tooltip).
//
// Managing here means the participant-local reference list: open a root, or
// FORGET a learned one (drops it from `hc:known-domains` and re-posts the
// domain set to the service worker). The cross-domain follow/fork machinery
// ([[tile-alias-references]]) will feed this same card when it lands.

import { Component } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { postCommunityDomainsToServiceWorker } from '../../core/sw-domains'
import { PinnableHoverBase, type PinnablePanel } from '../pinnable/pinnable-hover.base'
import { forgetPoolRoot, type PoolRoot, type PoolsPayload } from './pools-data'

export interface PoolsData {
  roots: PoolRoot[]
}

@Component({
  selector: 'hc-pools-of-meaning',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './pools-of-meaning.component.html',
  styleUrls: ['./pools-of-meaning.component.scss'],
})
export class PoolsOfMeaningComponent extends PinnableHoverBase<PoolsData> {

  protected get ns(): string { return 'pools' }
  protected get posKey(): string { return 'hc:pools-pins-pos' }
  protected override get panelWidth(): number { return 340 }
  // A management surface you keep on screen — the stuck card re-opens on
  // reload. Global, not page-scoped: your referenced roots are not a page.
  protected override get persistent(): boolean { return true }

  protected toPanel(payload: unknown): { key: string; data: PoolsData } | null {
    const p = payload as PoolsPayload | undefined
    if (!p || !Array.isArray(p.roots)) return null
    // ONE card identity — hover refreshes it, pinning sticks it.
    return { key: 'pools-of-meaning', data: { roots: p.roots } }
  }

  /** Click-to-stick straight from the peek (the icon's click pins too). */
  stick(panel: PinnablePanel<PoolsData>): void {
    if (!panel.ephemeral) return
    EffectBus.emit('pools:hover-pin', { roots: panel.data.roots })
  }

  openRoot(root: PoolRoot, ev: Event): void {
    ev.stopPropagation()
    window.open(`https://${root.domain}`, '_blank', 'noopener,noreferrer')
  }

  /** Drop a LEARNED root from the reference list and refresh the card (and
   *  the service worker's host set) in place. */
  forget(panel: PinnablePanel<PoolsData>, root: PoolRoot, ev: Event): void {
    ev.stopPropagation()
    if (root.kind !== 'learned') return
    const fresh = forgetPoolRoot(root.domain)
    void postCommunityDomainsToServiceWorker()
    this.updateData(panel.id, { roots: fresh.roots })
  }
}
