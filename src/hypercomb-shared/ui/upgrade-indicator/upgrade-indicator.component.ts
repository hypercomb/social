// hypercomb-shared/ui/upgrade-indicator/upgrade-indicator.component.ts
//
// In-place "New features" control. Appears when the web shell's post-boot
// `checkForUpdate` emits `update:available` (the bundled `/content/` package
// differs from the cached install). It is NOT a window and it never opens the
// DCP installer — the three actions happen right here in the header:
//
//   • Adopt   — install the update now. Dispatches `hypercomb:apply-update`;
//               the shell fetches this origin's bytes and reloads, the bee
//               swarm (install:sync) is the in-flow cue. The installer is only
//               the messenger (sig → domains, via the hidden sentinel); the
//               origin does the fetch.
//   • Save    — not now, remind me later. Snoozed for THIS session and
//               remembered in a saved list (so a future "saved features" view
//               can re-offer it); the chip reappears next session.
//   • Discard — dismiss this version for good; the chip never re-nags for
//               this package signature.
//
// All decisions are participant-local (localStorage / sessionStorage), keyed
// by the package signature, so they're per-version and never skew a layer.
//
// Stays hidden until an update is detected, and hidden once decided. In the
// dev shell (no `/content/` to compare) the event never fires, so this never
// shows.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

/** Payload of `update:available` — availability, delta count, and the package
 *  signature the Save/Discard decisions are keyed on. */
interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
  packageSig?: string
}

const SAVED_KEY = 'hc:features-saved'         // localStorage: remembered for later
const DISCARDED_KEY = 'hc:features-discarded' // localStorage: dismissed for good
const SNOOZE_KEY = 'hc:features-snoozed'      // sessionStorage: hidden this session (Save)

@Component({
  selector: 'hc-upgrade-indicator',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (available()) {
      <div class="upgrade-indicator" role="group" [attr.aria-label]="'upgrade.available' | t">
        <span class="upgrade-meta">
          <span class="mat-sym">deployed_code_update</span>
          <span class="upgrade-label">{{ 'upgrade.label' | t }}</span>
          @if (newCount() > 0) {
            <span class="upgrade-count">{{ newCount() }}</span>
          }
        </span>
        <button class="upgrade-act adopt" type="button" (click)="adopt()"
          [attr.aria-label]="'upgrade.adopt' | t" [attr.title]="'upgrade.adopt' | t">{{ 'upgrade.adopt' | t }}</button>
        <button class="upgrade-act save" type="button" (click)="save()"
          [attr.aria-label]="'upgrade.save' | t" [attr.title]="'upgrade.save' | t">{{ 'upgrade.save' | t }}</button>
        <button class="upgrade-act discard" type="button" (click)="discard()"
          [attr.aria-label]="'upgrade.discard' | t" [attr.title]="'upgrade.discard' | t">{{ 'upgrade.discard' | t }}</button>
      </div>
    }
  `,
  styleUrls: ['./upgrade-indicator.component.scss'],
})
export class UpgradeIndicatorComponent implements OnDestroy {
  readonly available = signal(false)
  readonly newCount = signal(0)
  #packageSig = ''
  #unsub: (() => void) | null = null

  constructor() {
    // Last-value replay means a late-mounted component still catches an
    // update detected before it rendered.
    this.#unsub = EffectBus.on<UpdateAvailablePayload>(
      'update:available',
      (payload) => {
        const sig = String(payload?.packageSig ?? '').trim().toLowerCase()
        this.#packageSig = sig
        // Hide if the participant already discarded this version for good, or
        // snoozed it this session (Save). A saved-but-new-session update shows
        // again — Save is "remind me later", not "never".
        const suppressed = this.#inList(DISCARDED_KEY, sig, localStorage)
          || this.#inList(SNOOZE_KEY, sig, sessionStorage)
        this.available.set(!!payload?.available && !suppressed)
        this.newCount.set(payload?.newCount ?? 0)
      },
    )
  }

  ngOnDestroy(): void {
    this.#unsub?.()
  }

  /** Adopt — install now. Fires the window event the web shell binds to
   *  upgradeFromBundled() + reload (which also raises the install:sync bee
   *  swarm). No installer shown; the shell's apply guards re-entry. */
  readonly adopt = (): void => {
    window.dispatchEvent(new CustomEvent('hypercomb:apply-update'))
  }

  /** Save — remind me later. Snooze for this session + remember the sig. */
  readonly save = (): void => {
    this.#remember(SNOOZE_KEY, this.#packageSig, sessionStorage)
    this.#remember(SAVED_KEY, this.#packageSig, localStorage)
    this.available.set(false)
  }

  /** Discard — dismiss this version for good. */
  readonly discard = (): void => {
    this.#remember(DISCARDED_KEY, this.#packageSig, localStorage)
    this.available.set(false)
  }

  #inList(key: string, sig: string, store: Storage): boolean {
    if (!sig) return false
    try {
      const arr = JSON.parse(store.getItem(key) ?? '[]')
      return Array.isArray(arr) && arr.includes(sig)
    } catch { return false }
  }

  #remember(key: string, sig: string, store: Storage): void {
    if (!sig) return
    try {
      const arr = JSON.parse(store.getItem(key) ?? '[]')
      const set = new Set<string>(Array.isArray(arr) ? arr : [])
      set.add(sig)
      store.setItem(key, JSON.stringify([...set]))
    } catch { /* storage unavailable — decision is best-effort */ }
  }
}
