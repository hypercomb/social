// hypercomb-shared/ui/trust-prompt/trust-prompt.component.ts
//
// Modal that fires when adopted code wants to activate and the source
// domain isn't in the participant's trusted community. Subscribes to the
// 'trust:check' EffectBus event (emitted by TrustService.check), shows
// the three-action prompt, and calls the request's onResult callback
// with the decision.
//
// Multiple back-to-back checks are queued — only one prompt visible at a
// time. The caller's promise stays pending until the user responds.

import { Component, signal, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { TrustCheckRequest, TrustDecision } from '../../core/trust-service'

@Component({
  selector: 'hc-trust-prompt',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './trust-prompt.component.html',
  styleUrls: ['./trust-prompt.component.scss'],
})
export class TrustPromptComponent implements OnInit, OnDestroy {

  #unsub: (() => void) | null = null

  /** Queue of pending check requests. Only the head is shown; subsequent
   *  requests wait their turn. Each entry holds the onResult callback so
   *  resolving advances the queue. */
  readonly #queue = signal<TrustCheckRequest[]>([])

  readonly active = computed(() => this.#queue()[0] ?? null)
  readonly visible = computed(() => this.active() !== null)
  readonly domains = computed(() => this.active()?.domains ?? [])
  readonly primaryDomain = computed(() => this.domains()[0] ?? '')
  readonly additionalCount = computed(() => Math.max(0, this.domains().length - 1))

  ngOnInit(): void {
    this.#unsub = EffectBus.on<TrustCheckRequest>('trust:check', (req) => {
      // Defensive: a malformed request (missing onResult) is dropped silently
      // rather than blocking the queue.
      if (!req || typeof req.onResult !== 'function') return
      this.#queue.update((q) => [...q, req])
    })
  }

  ngOnDestroy(): void {
    this.#unsub?.()
  }

  readonly allowOnce = (): void => {
    this.#resolve({ allow: true, addToCommunity: false })
  }

  readonly allowAlways = (): void => {
    this.#resolve({ allow: true, addToCommunity: true })
  }

  readonly deny = (): void => {
    this.#resolve({ allow: false, addToCommunity: false })
  }

  #resolve = (decision: TrustDecision): void => {
    const active = this.active()
    if (!active) return
    try { active.onResult(decision) }
    catch (e) { console.warn('[trust-prompt] onResult threw', e) }
    // Pop the head; the next pending request (if any) becomes active.
    this.#queue.update((q) => q.slice(1))
  }
}
