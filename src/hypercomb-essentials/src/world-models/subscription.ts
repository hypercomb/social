// world-models/subscription.ts
//
// What the subscription seat is allowed to know: the names of subscriptions
// already on this device. No key is read here. The drone (subscription.drone.ts)
// is the layer; this file is the read both the page and that layer share.

import { llmKeyStore } from '@hypercomb/core'

export const SUBSCRIPTION_EFFECT = 'world-models:subscriptions'
const REGISTRY = '@diamondcoreprocessor.com/LlmProviderRegistry'

export type DeviceSubscription = { readonly id: string; readonly label: string }

type Registry = { get?(id: string): { label?: string } | undefined }

/** Provider ids this device can already spend with, named. No key is returned. */
export const deviceSubscriptions = (): DeviceSubscription[] => {
  const registry = (globalThis as { ioc?: { get?: (key: string) => Registry | undefined } }).ioc
    ?.get?.(REGISTRY)
  return llmKeyStore.configured().map(id => ({
    id,
    label: registry?.get?.(id)?.label || id,
  }))
}
