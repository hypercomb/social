// hypercomb-shared/ui/upgrade-indicator/upgrade-indicator.component.ts
//
// Command-line right-side affordance that appears when a newer build is
// available (the web shell's post-boot `checkForUpdate` emits
// `update:available` after comparing the cached install against the
// bundled `/content/` package). Clicking opens the DCP installer portal
// so the user can review the new build and sync/upgrade — the same
// installer sync they'd otherwise do manually.
//
// Stays hidden until an update is detected. In the dev shell (no
// `/content/` to compare) the event never fires, so this never shows.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

@Component({
  selector: 'hc-upgrade-indicator',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (available()) {
      <button
        class="upgrade-indicator"
        type="button"
        (click)="openInstaller()"
        [attr.aria-label]="'upgrade.available' | t"
        [attr.title]="'upgrade.available' | t"
      >
        <span class="mat-sym">upgrade</span>
        @if (newCount() > 0) {
          <span class="upgrade-count">{{ newCount() }}</span>
        }
      </button>
    }
  `,
  styleUrls: ['./upgrade-indicator.component.scss'],
})
export class UpgradeIndicatorComponent implements OnDestroy {
  readonly available = signal(false)
  readonly newCount = signal(0)
  #unsub: (() => void) | null = null

  constructor() {
    // Last-value replay means a late-mounted component still catches an
    // update detected before it rendered.
    this.#unsub = EffectBus.on<{ available?: boolean; newCount?: number }>(
      'update:available',
      (payload) => {
        this.available.set(!!payload?.available)
        this.newCount.set(payload?.newCount ?? 0)
      },
    )
  }

  ngOnDestroy(): void {
    this.#unsub?.()
  }

  /** Open the DCP installer portal — the user reviews the new build and
   *  syncs/upgrades there (same portal the controls-bar 'dcp' action opens). */
  readonly openInstaller = (): void => {
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
  }
}
