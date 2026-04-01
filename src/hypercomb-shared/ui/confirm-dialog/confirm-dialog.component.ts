// confirm-dialog.component.ts — glassmorphic confirmation dialog
//
// Listens for 'confirm:request' effects and renders a professional
// modal dialog. Responds with 'confirm:response' on user decision.
// Escape key and backdrop click dismiss as cancel.

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

  readonly request = signal<ConfirmRequest | null>(null)
  readonly open = computed(() => this.request() !== null)

  ngOnInit(): void {
    this.#unsubRequest = EffectBus.on<ConfirmRequest>('confirm:request', (req) => {
      // guard against last-value replay of already-handled requests
      if (this.#processedIds.has(req.id)) return
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
    this.#processedIds.add(req.id)
    EffectBus.emit<ConfirmResponse>('confirm:response', { id: req.id, confirmed })
    this.request.set(null)
  }
}
