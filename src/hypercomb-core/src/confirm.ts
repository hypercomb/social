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
  /** A quiet line under the question — where to find the thing again. */
  hint?: string
  hintParams?: Record<string, string | number>
  /** A box the person may tick to stop being asked this question. The answer
   *  comes back as `optedOut`; keeping it is the caller's. */
  optOut?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmResponse {
  id: string
  confirmed: boolean
  /** The opt-out box was ticked when the person confirmed. */
  optedOut?: boolean
}

/** Ask, and hear the whole answer — including a ticked opt-out box. */
export function requestConfirmDetailed(
  opts: Omit<ConfirmRequest, 'id'>,
): Promise<ConfirmResponse> {
  const id = crypto.randomUUID()

  return new Promise<ConfirmResponse>(resolve => {
    // subscribe before emitting so we never miss the response
    const unsub = EffectBus.on<ConfirmResponse>('confirm:response', (res) => {
      if (res.id !== id) return
      unsub()
      resolve(res)
    })

    EffectBus.emit<ConfirmRequest>('confirm:request', { ...opts, id })
  })
}

export async function requestConfirm(
  opts: Omit<ConfirmRequest, 'id'>,
): Promise<boolean> {
  return (await requestConfirmDetailed(opts)).confirmed
}
