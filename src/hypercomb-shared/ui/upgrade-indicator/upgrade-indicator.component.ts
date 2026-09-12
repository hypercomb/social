import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
  packageSig?: string
  /** Who announced it: the shell's bundled check, or a followed channel's
   *  scout. Absent reads as the bundle. */
  source?: string
  /** The participant asked (`?upgrade=1`): show it, even for a build they
   *  once dismissed. */
  offer?: boolean
}

type UpdateSource = 'bundled' | 'channel'

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
// press, with nothing on screen saying which build or from where. Updating now
// happens in ONE place — the hosts window, where the build is named, its
// signature is checked before you press, a restore point is saved first and
// the way back is offered after. So the pill only says an update exists and
// takes you there, looking at that build.

@Component({
  selector: 'hc-upgrade-indicator',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (phase() !== 'idle') {
      <div class="upgrade-indicator" role="status" aria-live="polite" [attr.data-phase]="phase()">
        <button class="status-button" type="button" (click)="openHosts()"
          [disabled]="phase() !== 'available'"
          [attr.aria-label]="phase() === 'available' ? ('upgrade.open-hosts' | t) : statusText()"
          [title]="phase() === 'available' ? ('upgrade.open-hosts' | t) : statusText()">
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
  #source: UpdateSource = 'bundled'
  /** One standing offer per announcer. The bundled check saying "nothing newer
   *  HERE" must never hide what a followed channel announced, or the reverse. */
  readonly #offers = new Map<UpdateSource, UpdateAvailablePayload>()
  /** The announcer the participant explicitly asked for, when they did. */
  #asked: UpdateSource | null = null
  #unsubs: (() => void)[] = []
  #completeTimer: number | null = null

  constructor() {
    this.#restoreCompletedState()

    this.#unsubs.push(EffectBus.on<UpdateAvailablePayload>('update:available', payload => {
      const source: UpdateSource = payload?.source === 'channel' ? 'channel' : 'bundled'
      const sig = String(payload?.packageSig ?? '').trim().toLowerCase()
      const suppressed = !payload?.offer && (
        this.#inList(DISCARDED_KEY, sig, localStorage) || this.#inList(SNOOZE_KEY, sig, sessionStorage))
      if (payload?.offer) this.#asked = source
      if (payload?.available && !suppressed) this.#offers.set(source, { ...payload, packageSig: sig, source })
      else this.#offers.delete(source)
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

  /** Go where updating happens: the hosts window, opened on the build this
   *  notice announced. Seeing it there is enough — the notice stays away for
   *  the rest of the session. */
  readonly openHosts = (): void => {
    if (this.phase() !== 'available') return
    EffectBus.emit('hosts:open', { packageSig: this.#packageSig || null, source: this.#source })
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

  /** Put the standing offer on the pill: the one the participant asked for,
   *  else a channel's (signed by the publisher this hive follows), else the
   *  bundle this origin ships. */
  #show(): void {
    const offer = (this.#asked && this.#offers.get(this.#asked))
      || this.#offers.get('channel') || this.#offers.get('bundled') || null
    this.#packageSig = String(offer?.packageSig ?? '')
    this.#source = offer?.source === 'channel' ? 'channel' : 'bundled'
    this.available.set(!!offer)
    this.newCount.set(offer?.newCount ?? 0)
    const busy = this.phase() === 'snapshotting' || this.phase() === 'applying'
    if (offer && !busy && this.phase() !== 'complete') this.phase.set('available')
    else if (!offer && this.phase() === 'available') this.phase.set('idle')
  }

  /** Every announcer's offer of the build on the pill goes; another
   *  announcer's different build may take its place. */
  #dismiss(): void {
    for (const [source, offer] of this.#offers) {
      if (String(offer.packageSig ?? '') === this.#packageSig) this.#offers.delete(source)
    }
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
