// sharing/peer-models-lending.ts
//
// Whether this participant lends their machine to the swarm — read by the
// peer-models bee and the providers window, so a dependency atom: a bee is
// never imported for a value (atomic-modules-plan.md).

import { EffectBus } from '@hypercomb/core'

/** Device-local: is this participant lending their machine? Off by default. */
export const PEER_OFFER_STORAGE_KEY = 'hc:llm:peer-offer'

const readFlag = (key: string): boolean => {
  try { return /^(1|true|yes|on)$/i.test(String(globalThis.localStorage?.getItem(key) ?? '')) }
  catch { return false }
}

/** Is this participant lending their machine to the swarm? */
export const isLendingModels = (): boolean => readFlag(PEER_OFFER_STORAGE_KEY)

/** Turn lending on or off. The offer stops being renewed either way. */
export const setLendingModels = (on: boolean): void => {
  try { globalThis.localStorage?.setItem(PEER_OFFER_STORAGE_KEY, on ? 'true' : 'false') } catch { /* session */ }
  EffectBus.emit('peer-models:lending', { lending: on })
}
