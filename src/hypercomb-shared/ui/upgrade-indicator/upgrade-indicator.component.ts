import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
  packageSig?: string
  newBees?: string[]
  previous?: string | null
  label?: string
}

type UpdatePhase = 'idle' | 'available' | 'naming' | 'snapshotting' | 'applying' | 'complete' | 'error'
interface UpdateStatusPayload {
  phase?: Exclude<UpdatePhase, 'idle' | 'available' | 'naming'>
  message?: string
}

const SAVED_KEY = 'hc:features-saved'
const DISCARDED_KEY = 'hc:features-discarded'
const SNOOZE_KEY = 'hc:features-snoozed'
const COMPLETE_KEY = 'hc:update-complete'
const COMPLETE_VISIBLE_MS = 12_000

@Component({
  selector: 'hc-upgrade-indicator',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (phase() !== 'idle') {
      <div class="upgrade-indicator" role="status" aria-live="polite" [attr.data-phase]="phase()">
        <button class="status-button" type="button" (click)="toggleExpanded()"
          [disabled]="busy()" [attr.aria-expanded]="expanded()"
          [attr.aria-label]="statusText()" [title]="statusText()">
          <span>{{ statusText() }}</span>
          @if (phase() === 'available' && newCount() > 0) {
            <span class="upgrade-count">{{ newCount() }}</span>
          }
        </button>

        @if (phase() === 'available' && expanded()) {
          <button class="upgrade-act adopt" type="button" (click)="beginAdopt()">{{ 'upgrade.adopt' | t }}</button>
          <button class="upgrade-act save" type="button" (click)="save()">{{ 'upgrade.save' | t }}</button>
          <button class="upgrade-act discard" type="button" (click)="discard()">{{ 'upgrade.discard' | t }}</button>
        }

        @if (phase() === 'naming') {
          <label class="restore-name">
            <span>Restore point</span>
            <input type="text" autofocus [value]="restorePointName()"
              (input)="restorePointName.set($any($event.target).value)"
              (keydown.enter)="adopt()" (keydown.escape)="cancelAdopt()" />
          </label>
          <button class="upgrade-act adopt" type="button" (click)="adopt()"
            [disabled]="!restorePointName().trim()">Update</button>
          <button class="upgrade-act save" type="button" (click)="cancelAdopt()">Cancel</button>
        }

        @if (phase() === 'error') {
          <button class="upgrade-act save" type="button" (click)="returnToAvailable()">Try again</button>
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
  readonly expanded = signal(false)
  readonly restorePointName = signal('Default')
  readonly statusMessage = signal('')

  #packageSig = ''
  #newBees: string[] = []
  #previous: string | null = null
  #label = ''
  #unsubs: (() => void)[] = []
  #completeTimer: number | null = null

  constructor() {
    this.#restoreCompletedState()

    this.#unsubs.push(EffectBus.on<UpdateAvailablePayload>('update:available', payload => {
      const sig = String(payload?.packageSig ?? '').trim().toLowerCase()
      this.#packageSig = sig
      this.#newBees = Array.isArray(payload?.newBees) ? payload.newBees.map(String) : []
      this.#previous = typeof payload?.previous === 'string' ? payload.previous : null
      this.#label = String(payload?.label ?? '').trim()
      const suppressed = this.#inList(DISCARDED_KEY, sig, localStorage)
        || this.#inList(SNOOZE_KEY, sig, sessionStorage)
      this.available.set(!!payload?.available && !suppressed)
      this.newCount.set(payload?.newCount ?? 0)
      if (payload?.available && !suppressed && !this.busy() && this.phase() !== 'complete') {
        this.phase.set('available')
      } else if (!payload?.available && this.phase() === 'available') {
        this.phase.set('idle')
      }
    }))

    this.#unsubs.push(EffectBus.on<UpdateStatusPayload>('update:status', payload => {
      const next = payload?.phase
      if (!next) return
      this.statusMessage.set(String(payload.message ?? '').trim())
      this.expanded.set(false)
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

  readonly busy = (): boolean => this.phase() === 'snapshotting' || this.phase() === 'applying'

  readonly statusText = (): string => {
    if (this.statusMessage()) return this.statusMessage()
    switch (this.phase()) {
      case 'naming': return 'Name the restore point first'
      case 'snapshotting': return 'Saving restore point…'
      case 'applying': return 'Updating…'
      case 'complete': return 'Everything is updated'
      case 'error': return 'Update stopped safely'
      default: return 'Update available'
    }
  }

  readonly toggleExpanded = (): void => {
    if (this.phase() === 'available') this.expanded.update(value => !value)
  }

  readonly beginAdopt = (): void => {
    this.expanded.set(false)
    window.dispatchEvent(new CustomEvent('portal:open', {
      detail: {
        target: 'dcp',
        label: this.#label,
        upgrade: {
          packageSig: this.#packageSig || null,
          newBees: this.#newBees,
          previous: this.#previous,
        },
      },
    }))
  }

  readonly cancelAdopt = (): void => {
    this.phase.set('available')
    this.expanded.set(true)
  }

  readonly adopt = (): void => {
    const restorePointName = this.restorePointName().trim()
    if (!restorePointName) return
    window.dispatchEvent(new CustomEvent('hypercomb:apply-update', { detail: { restorePointName } }))
  }

  readonly save = (): void => {
    this.#remember(SNOOZE_KEY, this.#packageSig, sessionStorage)
    this.#remember(SAVED_KEY, this.#packageSig, localStorage)
    this.available.set(false)
    this.phase.set('idle')
  }

  readonly discard = (): void => {
    this.#remember(DISCARDED_KEY, this.#packageSig, localStorage)
    this.available.set(false)
    this.phase.set('idle')
  }

  readonly returnToAvailable = (): void => {
    this.statusMessage.set('')
    this.phase.set(this.available() ? 'available' : 'idle')
    this.expanded.set(this.available())
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
