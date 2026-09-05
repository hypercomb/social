// hypercomb-shared/ui/landing-badge/landing-badge.component.ts
//
// THE THING ON TOP — the visible half of quiet landing.
//
// When the bridge answers an ask raised from a tile, the payload lands in
// the hive immediately: layer minted, note on the cell, resource in the
// pool. The REPAINT is what waits (show-cell.drone.ts #quietLanding), so a
// drained batch of twenty writes doesn't strobe the surface somebody is
// still working in.
//
// This pill is how they find out. It says how many changes are waiting and
// where, and tapping it is the ONLY thing that releases the held paint —
// no idle timer, no auto-apply on navigation. The participant decides when
// the ground moves.
//
// Driven entirely by `landing:pending` (count 0 hides it); the tap emits
// `landing:apply` and the renderer owns everything after that. EffectBus
// last-value replay makes mount order irrelevant.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, computed, signal, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface LandingPendingPayload {
  /** Writes that landed unseen. Zero means nothing is owed — hide. */
  count?: number
  /** Explorer label of the layer they landed on, for "…on /dolphin". */
  where?: string
}

@Component({
  selector: 'hc-landing-badge',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './landing-badge.component.html',
  styleUrls: ['./landing-badge.component.scss'],
})
export class LandingBadgeComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []

  readonly #state = signal<LandingPendingPayload | null>(null)

  readonly count = computed(() => Math.max(0, Number(this.#state()?.count ?? 0)))
  readonly visible = computed(() => this.count() > 0)
  /** Root reads as "/" — no point naming it, the badge is already there. */
  readonly where = computed(() => {
    const raw = String(this.#state()?.where ?? '').trim()
    return raw && raw !== '/' ? raw : ''
  })

  ngOnInit(): void {
    this.#unsubs.push(
      EffectBus.on<LandingPendingPayload>('landing:pending', (p) => {
        this.#state.set(p ?? null)
      }),
    )
  }

  /** The one release. Renderer clears the badge by publishing count 0 on
   *  the pass this triggers — nothing to reset here. */
  onShow(): void {
    EffectBus.emit('landing:apply', {})
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-landing-badge',
  owner: '@hypercomb.shared/LandingBadgeComponent',
  component: LandingBadgeComponent,
  order: 345,
})
