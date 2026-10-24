// confirm-dialog.component.ts — glassmorphic confirmation dialog
//
// Listens for 'confirm:request' effects and renders a professional
// modal dialog. Responds with 'confirm:response' on user decision.
// Escape key and backdrop click dismiss as cancel.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, signal, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus, type ConfirmRequest, type ConfirmResponse } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

@Component({
  selector: 'hc-confirm-dialog',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './confirm-dialog.component.html',
  styleUrls: ['./confirm-dialog.component.scss'],
})
export class ConfirmDialogComponent implements OnInit, OnDestroy {

  #unsubRequest: (() => void) | null = null
  #unsubEscape: (() => void) | null = null
  #processedIds = new Set<string>()
  /** Requests waiting behind the one on screen. A second request used to
   *  replace the first, and the first caller's promise never settled — a
   *  publish waited forever on a dialog nobody could see again. */
  #waiting: ConfirmRequest[] = []
  /** A request moved up from the queue lands in the same panel under the
   *  same pointer: it answers nothing until this time, so a double-click or a
   *  held key never answers a question nobody has read. */
  #armedAt = 0
  static readonly ARM_MS = 400

  readonly request = signal<ConfirmRequest | null>(null)
  readonly open = computed(() => this.request() !== null)

  ngOnInit(): void {
    this.#unsubRequest = EffectBus.on<ConfirmRequest>('confirm:request', (req) => {
      // guard against last-value replay of already-handled requests
      if (this.#processedIds.has(req.id)) return
      if (this.request()?.id === req.id || this.#waiting.some(w => w.id === req.id)) return
      if (this.request()) { this.#waiting.push(req); return }
      this.request.set(req)
    })

    this.#unsubEscape = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'global.escape' && this.open()) this.dismiss()
    })
  }

  ngOnDestroy(): void {
    this.#unsubRequest?.()
    this.#unsubEscape?.()
  }

  readonly confirm = (): void => {
    this.#respond(true)
  }

  readonly dismiss = (): void => {
    this.#respond(false)
  }

  #respond(confirmed: boolean): void {
    const req = this.request()
    if (!req) return
    if (performance.now() < this.#armedAt) return
    this.#processedIds.add(req.id)
    EffectBus.emit<ConfirmResponse>('confirm:response', { id: req.id, confirmed })
    // The next one waiting is asked in its turn — every caller gets an answer.
    const next = this.#waiting.shift() ?? null
    if (next) this.#armedAt = performance.now() + ConfirmDialogComponent.ARM_MS
    this.request.set(next)
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-confirm-dialog',
  owner: '@hypercomb.shared/ConfirmDialogComponent',
  component: ConfirmDialogComponent,
  order: 240,
})
