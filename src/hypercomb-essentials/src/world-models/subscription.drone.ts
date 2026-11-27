// world-models/subscription.drone.ts
//
// THE OWN VERSION of the subscription trait. The seat was a reminder; this
// layer is what fills it. It publishes the names already on this device when
// they change. The secret stays in the device key store. This file never
// reads a key, never asks for one, and never writes a pool or a layer.

import { Drone, EffectBus, llmKeyStore } from '@hypercomb/core'
import { deviceSubscriptions, SUBSCRIPTION_EFFECT } from './subscription.js'

const publish = (): void => {
  EffectBus.emit(SUBSCRIPTION_EFFECT, { subscriptions: deviceSubscriptions() })
}

llmKeyStore.addEventListener('change', publish)

export class SubscriptionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The subscription seat. It names a subscription this device already holds. The secret stays on the device.'

  protected override sense = (): boolean => false
}

const ioc = (globalThis as { ioc?: { register?: (key: string, value: unknown) => void } }).ioc
ioc?.register?.('@diamondcoreprocessor.com/SubscriptionDrone', new SubscriptionDrone())
