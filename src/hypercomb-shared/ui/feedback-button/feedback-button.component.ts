// hypercomb-shared/ui/feedback-button/feedback-button.component.ts
//
// A fixed bottom-right "share feedback" affordance. The round button is
// always present; clicking it brings up a dismissible (NOT sticky) frosted
// glass panel with a short message + a category (idea / issue). Submitting
// writes a `kind: 'feedback'` record into the sign('optimization') pool —
// the host inbox — via Store.putOptimization, the exact same call the
// dashboard Q&A modal uses (qa-modal.view.ts #commit). The autonomous
// feedback-loop routine reads it back with optimization-list, turns it into
// tile-linked questions, and the loop closes.
//
// Shell UI: it NEVER imports essentials. It talks to the runtime through
// window.ioc (the local `get` helper) and EffectBus only.

import { Component, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'

/** Runtime service locator — shared must never statically import essentials,
 *  so cross-service resolution goes through window.ioc at call time. */
const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

/** Minimal structural view of the shared Store (resolved at runtime). */
type StoreLike = { putOptimization?: (blob: Blob) => Promise<string> }
/** Minimal structural view of Navigation for the current location path. */
type NavigationLike = { segmentsRaw?: () => readonly string[] }
/** Minimal structural view of the i18n provider. */
type I18nLike = { t?: (key: string, params?: Record<string, unknown>) => string }
/** Swarm: who (if anyone) we're a visitor of. */
type SwarmLike = { subscribedTo?: () => string | null }
/** Feedback handshake drone: has the host granted us posting rights? */
type FeedbackSwarmLike = { isGrantedBy?: (host: string) => boolean }

const HEX64 = /^[0-9a-f]{64}$/
type FeedbackCategory = 'idea' | 'issue'

@Component({
  selector: 'hc-feedback-button',
  standalone: true,
  imports: [FormsModule, TranslatePipe, HcWidgetDirective],
  templateUrl: './feedback-button.component.html',
  styleUrls: ['./feedback-button.component.scss'],
})
export class FeedbackButtonComponent {

  readonly open = signal(false)
  readonly sending = signal(false)
  readonly category = signal<FeedbackCategory>('idea')
  /** Bound to the textarea via ngModel. */
  text = ''

  // ── swarm context (remote feedback) ─────────────────────
  /** When viewing someone else's hive over the swarm, the host's pubkey;
   *  null on your own hive (where feedback is written locally). */
  readonly host = signal<string | null>(null)
  /** The host has approved this participant to post feedback. */
  readonly granted = signal(false)
  /** A permission request has been sent and is awaiting the host's decision. */
  readonly requested = signal(false)

  /** Visitor on another hive who hasn't been granted yet → the panel asks
   *  for permission instead of posting. */
  get needsPermission(): boolean {
    return this.host() !== null && !this.granted()
  }

  constructor() {
    // Activate the form the moment the host approves us.
    EffectBus.on<{ host?: string }>('feedback:access-granted', (p) => {
      const h = String(p?.host ?? '').trim().toLowerCase()
      if (h && h === this.host()) {
        this.granted.set(true)
        this.requested.set(false)
        this.#toast('success', 'feedback.granted.title', 'feedback.granted.message')
      }
    })
  }

  // ── open / close ────────────────────────────────────────

  readonly toggle = (): void => {
    if (this.open()) this.close()
    else this.showPanel()
  }

  readonly showPanel = (): void => {
    this.#refreshContext()
    this.open.set(true)
    // Focus the message field once the panel is in the DOM.
    queueMicrotask(() => {
      document.querySelector<HTMLTextAreaElement>('.feedback-panel textarea')?.focus()
    })
  }

  /** Resolve whether we're a visitor (and on whose hive) + our grant state.
   *  Both swarm drones are essentials, resolved at runtime via window.ioc. */
  #refreshContext(): void {
    const swarm = get('@diamondcoreprocessor.com/SwarmDrone') as SwarmLike | undefined
    const h = String(swarm?.subscribedTo?.() ?? '').trim().toLowerCase()
    const host = HEX64.test(h) ? h : null
    this.host.set(host)
    if (host) {
      const fs = get('@diamondcoreprocessor.com/FeedbackSwarmDrone') as FeedbackSwarmLike | undefined
      this.granted.set(!!fs?.isGrantedBy?.(host))
    } else {
      this.granted.set(false)
    }
  }

  readonly close = (): void => {
    this.open.set(false)
  }

  readonly setCategory = (c: FeedbackCategory): void => {
    this.category.set(c)
  }

  get canSend(): boolean {
    return this.text.trim().length > 0 && !this.sending()
  }

  /** Drives the primary button's enabled state across both modes. */
  get canSubmit(): boolean {
    if (this.needsPermission) return !this.requested() && !this.sending()
    return this.canSend
  }

  // ── submit ──────────────────────────────────────────────

  async submit(): Promise<void> {
    // Ungranted visitor → ask the host's permission instead of posting.
    if (this.needsPermission) { this.requestAccess(); return }
    if (!this.canSend) return
    this.sending.set(true)
    try {
      const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
      const segments = (nav?.segmentsRaw?.() ?? []).map(String)
      // Same payload the loop reads (id/category/text/route/at).
      const payload = {
        id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        category: this.category(),
        text: this.text.trim(),
        route: segments.join('/'),
        at: Date.now(),
      }
      const host = this.host()
      if (host && this.granted()) {
        // Granted visitor → post over the swarm to the host's inbox; the
        // FeedbackSwarmDrone publishes it and the host ingests it.
        EffectBus.emit('feedback:remote-post', { host, payload: { ...payload, appliesTo: segments } })
      } else {
        // Own hive → write straight to the local optimization inbox, the
        // exact same record shape the Q&A modal mints.
        const store = get('@hypercomb.social/Store') as StoreLike | undefined
        if (!store?.putOptimization) { this.#toast('error', 'feedback.error.title', 'feedback.error.message'); return }
        const record = { kind: 'feedback', appliesTo: segments, payload, mark: 'persistent' }
        await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
        EffectBus.emit('feedback:submitted', {})
      }
      this.#toast('success', 'feedback.sent.title', 'feedback.sent.message')
      this.text = ''
      this.category.set('idea')
      this.close()
    } catch (err) {
      console.warn('[feedback] submit failed', err)
      this.#toast('error', 'feedback.error.title', 'feedback.error.message')
    } finally {
      this.sending.set(false)
    }
  }

  /** Visitor: ask the host for permission to share feedback. The
   *  FeedbackSwarmDrone publishes the request over the swarm; the host sees a
   *  consent toast and, on approval, our `feedback:access-granted` fires. */
  requestAccess(): void {
    const host = this.host()
    if (!host || this.requested()) return
    EffectBus.emit('feedback:request-access', { host })
    this.requested.set(true)
    this.#toast('success', 'feedback.request.title', 'feedback.request.message')
    this.close()
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.submit() }
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close()
  }

  // ── helpers ─────────────────────────────────────────────

  /** Toasts take resolved strings (not keys), so localize here with an
   *  English fallback before emitting on the shared bus. */
  #toast(type: 'success' | 'error', titleKey: string, messageKey: string): void {
    const i18n = get('@hypercomb.social/I18n') as I18nLike | undefined
    const fallback: Record<string, string> = {
      'feedback.sent.title': 'Thank you',
      'feedback.sent.message': 'Your feedback is on its way.',
      'feedback.error.title': 'Could not send',
      'feedback.error.message': 'Please try again in a moment.',
      'feedback.request.title': 'Request sent',
      'feedback.request.message': "Waiting for the host to allow you to share feedback.",
      'feedback.granted.title': "You're in",
      'feedback.granted.message': 'The host approved you — share away.',
    }
    EffectBus.emit('toast:show', {
      type,
      title: i18n?.t?.(titleKey) ?? fallback[titleKey] ?? '',
      message: i18n?.t?.(messageKey) ?? fallback[messageKey] ?? '',
    })
  }
}
