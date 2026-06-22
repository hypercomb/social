// hypercomb-shared/ui/feedback-button/feedback-button.component.ts
//
// A fixed bottom-right "share feedback" affordance. The round button is
// always present; clicking it brings up a dismissible (NOT sticky) frosted
// glass panel with a short message + a category (idea / issue). Submitting
// writes a `kind: 'feedback'` record into the __optimization__ substrate —
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

  // ── open / close ────────────────────────────────────────

  readonly toggle = (): void => {
    if (this.open()) this.close()
    else this.showPanel()
  }

  readonly showPanel = (): void => {
    this.open.set(true)
    // Focus the message field once the panel is in the DOM.
    queueMicrotask(() => {
      document.querySelector<HTMLTextAreaElement>('.feedback-panel textarea')?.focus()
    })
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

  // ── submit ──────────────────────────────────────────────

  async submit(): Promise<void> {
    if (!this.canSend) return
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.putOptimization) {
      this.#toast('error', 'feedback.error.title', 'feedback.error.message')
      return
    }
    this.sending.set(true)
    try {
      const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
      const segments = (nav?.segmentsRaw?.() ?? []).map(String)
      // Same record shape the Q&A modal mints (kind/appliesTo/payload/mark),
      // with kind 'feedback' so the loop's optimization-list picks it up.
      const record = {
        kind: 'feedback',
        appliesTo: segments,
        payload: {
          id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          category: this.category(),
          text: this.text.trim(),
          route: segments.join('/'),
          at: Date.now(),
        },
        mark: 'persistent',
      }
      const blob = new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart])
      await store.putOptimization(blob)
      // Let an open review panel refresh itself with the new item.
      EffectBus.emit('feedback:submitted', {})
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
    }
    EffectBus.emit('toast:show', {
      type,
      title: i18n?.t?.(titleKey) ?? fallback[titleKey] ?? '',
      message: i18n?.t?.(messageKey) ?? fallback[messageKey] ?? '',
    })
  }
}
