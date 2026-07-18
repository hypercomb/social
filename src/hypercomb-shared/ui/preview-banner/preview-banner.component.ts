// hypercomb-shared/ui/preview-banner/preview-banner.component.ts
//
// The "adopt for review" banner — the visible face of a static-hive
// preview (essentials sharing/hive-visit.drone.ts). While a preview is
// active the visitor is browsing a FOREIGN branch rendered from a
// session-only virtual head: nothing is written, commits are refused, a
// refresh forgets it. This strip names that state and carries the ONLY
// two exits: Adopt (fold it into your hive — the one real adopt gesture)
// and Dismiss (walk away, nothing kept).
//
// Driven entirely by the `preview:mode` effect (last-value replay makes
// mount order irrelevant). The buttons emit `hive:adopt-accept` /
// `hive:adopt-dismiss`; the drone owns everything that happens next.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, signal, computed, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface PreviewModePayload {
  active?: boolean
  label?: string
  pubkey?: string
  hosts?: readonly string[]
  tiles?: number
}

@Component({
  selector: 'hc-preview-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './preview-banner.component.html',
  styleUrls: ['./preview-banner.component.scss'],
})
export class PreviewBannerComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []

  readonly #state = signal<PreviewModePayload | null>(null)

  readonly visible = computed(() => this.#state()?.active === true)
  readonly label = computed(() => String(this.#state()?.label ?? ''))
  readonly tiles = computed(() => Number(this.#state()?.tiles ?? 0))
  /** Publisher shorthand — the pubkey's first 8 hex chars. Enough to
   *  tell publishers apart; the full key is in the link they opened. */
  readonly publisherShort = computed(() => String(this.#state()?.pubkey ?? '').slice(0, 8))

  ngOnInit(): void {
    this.#unsubs.push(
      EffectBus.on<PreviewModePayload>('preview:mode', (p) => {
        this.#state.set(p ?? null)
      }),
    )
  }

  onAdopt(): void {
    EffectBus.emit('hive:adopt-accept', {})
  }

  onDismiss(): void {
    EffectBus.emit('hive:adopt-dismiss', {})
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-preview-banner',
  owner: '@hypercomb.shared/PreviewBannerComponent',
  component: PreviewBannerComponent,
  order: 340,
})
