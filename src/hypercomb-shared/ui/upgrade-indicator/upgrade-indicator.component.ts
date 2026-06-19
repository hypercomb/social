// hypercomb-shared/ui/upgrade-indicator/upgrade-indicator.component.ts
//
// Header affordance that appears when a package the hive runs has changed
// (the web shell's post-boot `checkForUpdate` emits `update:available`
// after diffing the cached install against the bundled `/content/`
// package). This is a NOTIFY-AND-ROUTE affordance ONLY: the hive never
// reviews or enables anything itself. Clicking hands the changed package +
// its delta sigs to the DCP installer, which is where the participant
// reviews the changed items (shown off + highlighted) and opts in. An
// enable in DCP is what syncs a delta bee back into the hive.
//
// It deliberately uses a "new features" glyph (not an up-arrow, which reads
// as the backup direction) and shows a visible label so the meaning —
// "there are new things to look at" — is legible at a glance.
//
// Stays hidden until an update is detected. In the dev shell (no
// `/content/` to compare) the event never fires, so this never shows.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

/** Payload of `update:available` — the delta the DCP installer needs to
 *  locate the changed package and mark its changed items. */
interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
  /** Signatures present in the new bundle but not the cached install. */
  newBees?: string[]
  /** Root signature of the changed package. */
  packageSig?: string
  /** Walkback link — the version this one supersedes (delta fallback). */
  previous?: string | null
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
        (click)="openInstaller()"
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
  #newBees: string[] = []
  #packageSig: string | null = null
  #previous: string | null = null
  #unsub: (() => void) | null = null

  constructor() {
    // Last-value replay means a late-mounted component still catches an
    // update detected before it rendered.
    this.#unsub = EffectBus.on<UpdateAvailablePayload>(
      'update:available',
      (payload) => {
        this.available.set(!!payload?.available)
        this.newCount.set(payload?.newCount ?? 0)
        this.#newBees = Array.isArray(payload?.newBees) ? payload!.newBees! : []
        this.#packageSig = payload?.packageSig ?? null
        this.#previous = payload?.previous ?? null
      },
    )
  }

  ngOnDestroy(): void {
    this.#unsub?.()
  }

  /** Open the DCP installer focused on the changed package — the participant
   *  reviews the changed items there (off + highlighted) and opts in. The
   *  delta (packageSig + new sigs + walkback link) rides the `upgrade` detail
   *  so the installer can land on the package and mark exactly what changed.
   *  This does NOT install or reload anything in the hive. */
  readonly openInstaller = (): void => {
    window.dispatchEvent(new CustomEvent('portal:open', {
      detail: {
        target: 'dcp',
        upgrade: {
          packageSig: this.#packageSig,
          newBees: this.#newBees,
          previous: this.#previous,
        },
      },
    }))
  }
}
