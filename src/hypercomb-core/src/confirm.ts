// confirm.ts — Promise-based confirmation dialog via EffectBus
//
// Lives in core so both essentials drones and shared components can import it
// without violating dependency direction (modules → core only).
//
// Protocol:
//   caller  → emit('confirm:request', { id, ... })
//   dialog  → emit('confirm:response', { id, confirmed })
//   caller  ← promise resolves boolean

import { EffectBus } from './effect-bus.js'

export interface ConfirmRequest {
  id: string
  title: string
  message: string
  messageParams?: Record<string, string | number>
  warning?: string
  warningParams?: Record<string, string | number>
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmResponse {
  id: string
  confirmed: boolean
}

export function requestConfirm(
  opts: Omit<ConfirmRequest, 'id'>,
): Promise<boolean> {
  const id = crypto.randomUUID()

  return new Promise<boolean>(resolve => {
    // subscribe before emitting so we never miss the response
    const unsub = EffectBus.on<ConfirmResponse>('confirm:response', (res) => {
      if (res.id !== id) return
      unsub()
      resolve(res.confirmed)
    })

    EffectBus.emit<ConfirmRequest>('confirm:request', { ...opts, id })
  })
}
