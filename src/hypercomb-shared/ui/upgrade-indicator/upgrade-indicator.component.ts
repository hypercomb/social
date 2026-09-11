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
  /** Who announced it: the shell's bundled check, or a followed channel's
   *  scout. Absent reads as the bundle. */
  source?: string
  /** The participant asked (`?upgrade=1`): open on it, even for a build they
   *  once discarded. */
  offer?: boolean
}

type UpdateSource = 'bundled' | 'channel'

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
      this.#show(!!payload?.offer)
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
   *  exactly where they were, with the restore point already saved. The
   *  announcer rides along: the shell takes a bundled offer from its own
   *  origin and a channel offer from the hosts it carries. Enter in the name
   *  field rides the same path. */
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
        source: this.#source,
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
    this.#dismiss()
  }

  readonly discard = (): void => {
    this.#remember(DISCARDED_KEY, this.#packageSig, localStorage)
    this.#dismiss()
  }

  readonly returnToAvailable = (): void => {
    this.statusMessage.set('')
    this.phase.set(this.available() ? 'available' : 'idle')
    this.expanded.set(this.available())
  }

  /** Put the standing offer on the pill: the one the participant asked for,
   *  else a channel's (signed by the publisher this hive follows), else the
   *  bundle this origin ships. */
  #show(expand: boolean): void {
    const offer = (this.#asked && this.#offers.get(this.#asked))
      || this.#offers.get('channel') || this.#offers.get('bundled') || null
    const wasAvailable = this.phase() === 'available'
    this.#packageSig = String(offer?.packageSig ?? '')
    this.#newBees = Array.isArray(offer?.newBees) ? offer.newBees.map(String) : []
    this.#previous = typeof offer?.previous === 'string' ? offer.previous : null
    this.#label = String(offer?.label ?? '').trim()
    this.#source = offer?.source === 'channel' ? 'channel' : 'bundled'
    // The name is written the moment the update is announced — adopting is
    // one click, and what the participant sees in the field is what the
    // restore point will be called unless they type over it. The AUTHOR'S
    // build name leads; date + time are the changing default, so every
    // revision the hive takes reads as its own line in the list.
    this.restorePointName.set(buildRevisionName({
      packageSig: this.#packageSig,
      label: this.#label,
      locale: this.#locale(),
    }))
    this.available.set(!!offer)
    this.newCount.set(offer?.newCount ?? 0)
    if (offer && !this.busy() && this.phase() !== 'complete') {
      this.phase.set('available')
      if (expand && !wasAvailable) this.expanded.set(true)
    } else if (!offer && this.phase() === 'available') {
      this.phase.set('idle')
    }
  }

  /** Save and Discard answer the build on the pill: every announcer's offer
   *  of that signature goes, and another announcer's different build may take
   *  its place. */
  #dismiss(): void {
    for (const [source, offer] of this.#offers) {
      if (String(offer.packageSig ?? '') === this.#packageSig) this.#offers.delete(source)
    }
    this.expanded.set(false)
    this.phase.set('idle')
    this.#show(false)
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
