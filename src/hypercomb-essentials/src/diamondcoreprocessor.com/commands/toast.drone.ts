// diamondcoreprocessor.com/commands/toast.drone.ts
//
// Toast notification system — manages a queue of auto-dismissing notifications.
// All UI communication (tips, successes, warnings, info) flows through here.
//
// Usage:
//   EffectBus.emit('toast:show', { type: 'tip', message: 'Press / for shortcuts' })
//   EffectBus.emit('toast:show', { type: 'success', title: 'Done', message: 'Layout saved' })
//   EffectBus.emit('toast:dismiss', { id: 42 })
//   EffectBus.emit('toast:clear', undefined)

import { EffectBus } from '@hypercomb/core'

export type ToastType = 'info' | 'success' | 'tip' | 'warning'

export interface ToastRequest {
  type: ToastType
  message: string
  title?: string
  duration?: number            // ms — 0 means sticky (no auto-dismiss)
  actionLabel?: string         // optional action button text
  actionEffect?: string        // effect to emit when action is clicked
  actionPayload?: unknown      // payload for the action effect
}

export interface Toast {
  id: number
  type: ToastType
  title: string
  message: string
  duration: number
  actionLabel: string | null
  actionEffect: string | null
  actionPayload: unknown
  fading: boolean
  createdAt: number
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  info: 5_000,
  success: 4_000,
  tip: 8_000,
  warning: 6_000,
}

const MAX_VISIBLE = 5

export class ToastDrone extends EventTarget {
  #toasts: Toast[] = []
  #nextId = 0
  #timers = new Map<number, ReturnType<typeof setTimeout>>()

  get toasts(): readonly Toast[] { return this.#toasts }

  constructor() {
    super()

    EffectBus.on<ToastRequest>('toast:show', request => {
      if (!request?.message) return
      this.#show(request)
    })

    EffectBus.on<{ id: number }>('toast:dismiss', payload => {
      if (payload?.id != null) this.dismiss(payload.id)
    })

    EffectBus.on('toast:clear', () => this.#clearAll())
  }

  #show(request: ToastRequest): void {
    const id = this.#nextId++
    const duration = request.duration ?? DEFAULT_DURATIONS[request.type] ?? 5_000

    const toast: Toast = {
      id,
      type: request.type,
      title: request.title ?? '',
      message: request.message,
      duration,
      actionLabel: request.actionLabel ?? null,
      actionEffect: request.actionEffect ?? null,
      actionPayload: request.actionPayload ?? null,
      fading: false,
      createdAt: Date.now(),
    }

    // prepend — newest on top
    this.#toasts = [toast, ...this.#toasts].slice(0, MAX_VISIBLE)
    this.#emit()

    // schedule auto-dismiss
    if (duration > 0) {
      const timer = setTimeout(() => this.dismiss(id), duration)
      this.#timers.set(id, timer)
    }
  }

  dismiss(id: number): void {
    const toast = this.#toasts.find(t => t.id === id)
    if (!toast || toast.fading) return

    // clear timer
    const timer = this.#timers.get(id)
    if (timer != null) { clearTimeout(timer); this.#timers.delete(id) }

    // fade out
    toast.fading = true
    this.#toasts = [...this.#toasts]
    this.#emit()

    setTimeout(() => {
      this.#toasts = this.#toasts.filter(t => t.id !== id)
      this.#emit()
    }, 280)
  }

  executeAction(id: number): void {
    const toast = this.#toasts.find(t => t.id === id)
    if (!toast?.actionEffect) return
    EffectBus.emit(toast.actionEffect, toast.actionPayload)
    this.dismiss(id)
  }

  #clearAll(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer)
    this.#timers.clear()
    this.#toasts = []
    this.#emit()
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('toast:state', { toasts: this.#toasts })
  }
}

const _toast = new ToastDrone()
window.ioc.register('@diamondcoreprocessor.com/ToastDrone', _toast)
