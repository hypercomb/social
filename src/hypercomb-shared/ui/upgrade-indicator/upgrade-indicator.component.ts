import { Component, signal, type OnDestroy } from '@angular/core'
import { buildRevisionName, EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface UpdateAvailablePayload {
  available?: boolean
  newCount?: number
  packageSig?: string
  newBees?: string[]
  previous?: string | null
  label?: string
}

type UpdatePhase = 'idle' | 'available' | 'snapshotting' | 'applying' | 'complete' | 'error'
interface UpdateStatusPayload {
  phase?: Exclude<UpdatePhase, 'idle' | 'available'>
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
          <label class="restore-name">
            <input type="text" [value]="restorePointName()"
              [attr.aria-label]="'upgrade.revision' | t" [title]="'upgrade.revision' | t"
              (input)="restorePointName.set($any($event.target).value)"
              (keydown.enter)="adopt()" (keydown.escape)="collapse()" />
          </label>
          <!-- Adopt applies SILENTLY: snapshot under the shown name, apply,
               reload back to this exact spot. No screen to visit. -->
          <button class="upgrade-act adopt" type="button" (click)="adopt()">{{ 'upgrade.adopt' | t }}</button>
          <button class="upgrade-act save" type="button" (click)="save()">{{ 'upgrade.save' | t }}</button>
          <button class="upgrade-act discard" type="button" (click)="discard()">{{ 'upgrade.discard' | t }}</button>
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
  /** Written for the participant when the update is announced (see the
   *  `update:available` subscription) — theirs to overwrite, never to supply. */
  readonly restorePointName = signal('')
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
      // The name is written the moment the update is announced — adopting is
      // one click, and what the participant sees in the field is what the
      // restore point will be called unless they type over it. The AUTHOR'S
      // build name leads; date + time are the changing default, so every
      // revision the hive takes reads as its own line in the list.
      this.restorePointName.set(buildRevisionName({
        packageSig: sig,
        label: this.#label,
        locale: this.#locale(),
      }))
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
      case 'snapshotting': return 'Saving restore point…'
      case 'applying': return 'Updating…'
      case 'complete': return 'Everything is updated'
      case 'error': return 'Update stopped safely'
      default: return 'Update available'
    }
  }

  readonly toggleExpanded = (): void => {
    if (this.phase() !== 'available') return
    this.expanded.update(value => !value)
  }

  readonly collapse = (): void => {
    this.expanded.set(false)
  }

  /** Adopt goes NOWHERE — updates are installed, never visited. One click
   *  hands the shell the name and the package and waits:
   *  `hypercomb:apply-update` snapshots under that name, installs the newer
   *  files and reloads — the URL is untouched, so the participant lands
   *  exactly where they were, with the restore point already saved. If the
   *  install has to go through DCP it does that off-screen (the portal's
   *  headless iframe). Reviewing in the installer is the OVERRIDE, its own
   *  button — never a step on the silent path. Enter in the name field
   *  rides the same path. */
  readonly adopt = (): void => {
    const restorePointName = this.restorePointName().trim()
      || buildRevisionName({ packageSig: this.#packageSig, label: this.#label, locale: this.#locale() })
    this.collapse()
    window.dispatchEvent(new CustomEvent('hypercomb:apply-update', {
      detail: {
        restorePointName,
        packageSig: this.#packageSig || null,
        newBees: this.#newBees,
        previous: this.#previous,
      },
    }))
  }

  #locale(): string {
    const i18n = window.ioc?.get<{ locale?: string }>('@hypercomb.social/I18n')
    return String(i18n?.locale ?? 'en')
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
