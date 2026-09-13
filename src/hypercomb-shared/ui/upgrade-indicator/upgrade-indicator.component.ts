import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
  packageSig?: string
  /** Who announced it. Only a followed channel's scout is heard: the shell's
   *  own origin is not a host and announces nothing. */
  source?: string
}

type UpdatePhase = 'idle' | 'available' | 'snapshotting' | 'applying' | 'complete' | 'error'
interface UpdateStatusPayload {
  phase?: Exclude<UpdatePhase, 'idle' | 'available'>
  message?: string
}

const DISCARDED_KEY = 'hc:features-discarded'
const SNOOZE_KEY = 'hc:features-snoozed'
const COMPLETE_KEY = 'hc:update-complete'
const COMPLETE_VISIBLE_MS = 12_000

// A NOTICE, NOT AN INSTALLER (2026-09-12). This pill used to install: Adopt
// saved a restore point and swapped the running build from the header in one
// press. Updating now happens in ONE place — the Packages window, where each
// part of the app is on or off and an update mark sits on what the publisher
// you follow moved. So the pill only says an update exists and opens it.

@Component({
  selector: 'hc-upgrade-indicator',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (phase() !== 'idle') {
      <div class="upgrade-indicator" role="status" aria-live="polite" [attr.data-phase]="phase()">
        <button class="status-button" type="button" (click)="openPackages()"
          [disabled]="phase() !== 'available'"
          [attr.aria-label]="phase() === 'available' ? ('upgrade.open-packages' | t) : statusText()"
          [title]="phase() === 'available' ? ('upgrade.open-packages' | t) : statusText()">
          <span>{{ statusText() }}</span>
          @if (phase() === 'available' && newCount() > 0) {
            <span class="upgrade-count">{{ newCount() }}</span>
          }
        </button>

        @if (phase() === 'available') {
          <button class="upgrade-dismiss" type="button" (click)="dismiss()"
            [attr.aria-label]="'upgrade.dismiss' | t" [title]="'upgrade.dismiss' | t">×</button>
        }

        @if (phase() === 'error') {
          <button class="upgrade-act" type="button" (click)="returnToAvailable()">Try again</button>
        }
      </div>
    }
  `,
  styleUrls: ['./upgrade-indicator.component.scss'],
})
export class UpgradeIndicatorComponent implements OnDestroy {
  readonly available = signal(false)
  readonly newCount = signal(0)
  readonly phase = signal<UpdatePhase>('idle')
  readonly statusMessage = signal('')

  #packageSig = ''
  /** The standing offer, when the followed channel has one. */
  #offer: UpdateAvailablePayload | null = null
  #unsubs: (() => void)[] = []
  #completeTimer: number | null = null

  constructor() {
    this.#restoreCompletedState()

    this.#unsubs.push(EffectBus.on<UpdateAvailablePayload>('update:available', payload => {
      if (payload?.source !== 'channel') return
      const sig = String(payload.packageSig ?? '').trim().toLowerCase()
      const suppressed = this.#inList(DISCARDED_KEY, sig, localStorage) || this.#inList(SNOOZE_KEY, sig, sessionStorage)
      this.#offer = payload.available && !suppressed ? { ...payload, packageSig: sig } : null
      this.#show()
    }))

    this.#unsubs.push(EffectBus.on<UpdateStatusPayload>('update:status', payload => {
      const next = payload?.phase
      if (!next) return
      this.statusMessage.set(String(payload.message ?? '').trim())
      this.phase.set(next)
      if (next === 'complete') {
        try { sessionStorage.setItem(COMPLETE_KEY, String(Date.now())) } catch { /* unavailable */ }
        this.#armCompleteTimer()
      }
    }))
  }

  ngOnDestroy(): void {
    for (const unsub of this.#unsubs) unsub()
    if (this.#completeTimer !== null) window.clearTimeout(this.#completeTimer)
  }

  readonly statusText = (): string => {
    if (this.statusMessage()) return this.statusMessage()
    switch (this.phase()) {
      case 'snapshotting': return 'Saving restore point…'
      case 'applying': return 'Updating…'
      case 'complete': return 'Everything is updated'
      case 'error': return 'Update stopped safely'
      default: return 'Update available'
    }
  }

  /** Go where updating happens: the Packages window. Seeing it there is
   *  enough — the notice stays away for the rest of the session. */
  readonly openPackages = (): void => {
    if (this.phase() !== 'available') return
    EffectBus.emit('packages:open', { packageSig: this.#packageSig || null })
    this.dismiss()
  }

  /** Not now: this build is not announced again this session. */
  readonly dismiss = (): void => {
    this.#remember(SNOOZE_KEY, this.#packageSig, sessionStorage)
    this.#dismiss()
  }

  readonly returnToAvailable = (): void => {
    this.statusMessage.set('')
    this.phase.set(this.available() ? 'available' : 'idle')
  }

  /** Put the standing offer on the pill. */
  #show(): void {
    const offer = this.#offer
    this.#packageSig = String(offer?.packageSig ?? '')
    this.available.set(!!offer)
    this.newCount.set(offer?.newCount ?? 0)
    const busy = this.phase() === 'snapshotting' || this.phase() === 'applying'
    if (offer && !busy && this.phase() !== 'complete') this.phase.set('available')
    else if (!offer && this.phase() === 'available') this.phase.set('idle')
  }

  #dismiss(): void {
    if (String(this.#offer?.packageSig ?? '') === this.#packageSig) this.#offer = null
    this.phase.set('idle')
    this.#show()
  }

  #restoreCompletedState(): void {
    try {
      const at = Number(sessionStorage.getItem(COMPLETE_KEY) ?? 0)
      if (at > 0 && Date.now() - at < COMPLETE_VISIBLE_MS) {
        this.phase.set('complete')
        this.#armCompleteTimer(COMPLETE_VISIBLE_MS - (Date.now() - at))
      } else {
        sessionStorage.removeItem(COMPLETE_KEY)
      }
    } catch { /* unavailable */ }
  }

  #armCompleteTimer(delay = COMPLETE_VISIBLE_MS): void {
    if (this.#completeTimer !== null) window.clearTimeout(this.#completeTimer)
    this.#completeTimer = window.setTimeout(() => {
      this.#completeTimer = null
      try { sessionStorage.removeItem(COMPLETE_KEY) } catch { /* unavailable */ }
      this.statusMessage.set('')
      this.phase.set(this.available() ? 'available' : 'idle')
    }, Math.max(0, delay))
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
    } catch { /* storage unavailable */ }
  }
}
