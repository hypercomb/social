// hypercomb-shared/ui/upgrade-indicator/upgrade-indicator.component.ts
//
// Header affordance that appears when a package the hive runs has changed
// (the web shell's post-boot `checkForUpdate` emits `update:available`
// after diffing the cached install against the bundled `/content/`
// package). Clicking it JUST APPLIES — no window, no review modal. It
// dispatches `hypercomb:apply-update`; the web shell installs the new
// package straight from THIS origin's bundled `/content/`
// (upgradeFromBundled) and reloads. The mesh is only the messenger — it
// announces WHICH features changed; the bytes are always fetched by this
// origin itself.
//
// The visualization is IN-FLOW, not a dialog: upgradeFromBundled emits the
// `install:sync` operation cue, so the bee swarm rises to install the update
// (the same "the operation shows itself" idea as tiles riding a copy-drag),
// then the shell reloads. Clicking is the act.
//
// It deliberately uses a "new features" glyph (not an up-arrow, which reads
// as the backup direction) and shows a visible label so the meaning —
// "there are new things to apply" — is legible at a glance.
//
// Stays hidden until an update is detected. In the dev shell (no
// `/content/` to compare) the event never fires, so this never shows.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

/** Payload of `update:available` — only the availability + delta count are
 *  needed to render the affordance; the install path needs nothing from here. */
interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
}

@Component({
  selector: 'hc-upgrade-indicator',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (available()) {
      <button
        class="upgrade-indicator"
        type="button"
        (click)="applyUpdate()"
        [attr.aria-label]="'upgrade.available' | t"
        [attr.title]="'upgrade.available' | t"
      >
        <span class="mat-sym">deployed_code_update</span>
        <span class="upgrade-label">{{ 'upgrade.label' | t }}</span>
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
    this.#unsub = EffectBus.on<UpdateAvailablePayload>(
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

  /** Just apply. Fires the window event the web shell binds to
   *  upgradeFromBundled() + reload — which also raises the `install:sync` bee
   *  swarm as the in-flow "installing" cue. No window; the shell's apply
   *  guards re-entry, so a double-click can't double-install. */
  readonly applyUpdate = (): void => {
    window.dispatchEvent(new CustomEvent('hypercomb:apply-update'))
  }
}
