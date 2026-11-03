// sharing/device-sync.drone.ts
//
// THE BEE THAT WIRES DEVICE SYNC. The service (device-sync.service.ts) is a
// dependency — it exports and registers nothing; registration is the bee's act.
// This one registers it, answers the Sync button (`device-sync:run`) and the
// `pair` word's news that the record changed (`device-pairing:changed`), and,
// once the store is up, learns whether this device is paired. An unpaired device
// opens nothing: no relay subscription, no cost.

import { Drone, EffectBus } from '@hypercomb/core'
import { DEVICE_PAIRING_CHANGED } from './device-pairing.js'
import { DEVICE_SYNC_RUN, DeviceSyncService } from './device-sync.service.js'

export class DeviceSyncDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description =
    'Sync between your own paired devices: answers when paired, walks the other devices\' trees when sync is pressed'

  protected override listens = [DEVICE_SYNC_RUN, DEVICE_PAIRING_CHANGED]
  protected override emits = ['device-sync:state', 'activity:log', 'toast:show', 'fs:changed']

  /** Always-on listeners, not a pulse-driven behaviour. */
  protected override sense = (): boolean => false

  readonly service = new DeviceSyncService()

  constructor() {
    super()
    EffectBus.on(DEVICE_SYNC_RUN, () => { void this.service.run() })
    EffectBus.on(DEVICE_PAIRING_CHANGED, () => { void this.service.refresh() })
    // Learn whether this device is paired once the store is up — detached from
    // boot and given a moment, as folder-sync is.
    window.ioc.whenReady('@hypercomb.social/Store', () => { setTimeout(() => { void this.service.refresh() }, 3_000) })
  }
}

const _deviceSync = new DeviceSyncDrone()
window.ioc.register('@diamondcoreprocessor.com/DeviceSyncDrone', _deviceSync)
window.ioc.register('@diamondcoreprocessor.com/DeviceSync', _deviceSync.service)
