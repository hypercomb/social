// history/history.boot.drone.ts
//
// THE HISTORY BOOT BEE (atomic-modules-plan.md, step 6). The runtime
// initializer reads `@HistoryService` in phase 1, before any ordinary bee
// loads, and the Lineage and the shell read the history and its cursor from
// the start — so a boot bee, loaded right after the dependencies, registers
// them, with the slot registry every slot declaration waits on and history's
// own slots. Each is a dependency; this bee is the one that registers them.

import { Drone } from '@hypercomb/core'
import { HistoryService } from './history.service.js'
import { HistoryCursorService } from './history-cursor.service.js'
import { LayerSlotRegistry } from './layer-slot-registry.js'
import { BUILDS_SLOT_DECLARATION } from './builds-slot.js'
import { SNAPSHOTS_SLOT_DECLARATION } from './snapshots-slot.js'

export class HistoryBootDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  /** The boot lane: named in the root, loaded before the bee wave. */
  readonly lane = 'boot'

  public override description =
    'History at boot: registers the history service, its cursor, the layer slot registry and history\'s own slots.'

  protected override sense = (): boolean => false
}

{
  const history = new HistoryService()
  window.ioc.register('@diamondcoreprocessor.com/HistoryService', history)
  // RUNTIME CONTRACT KEY — @hypercomb/runtime names no essentials namespace
  // and resolves this as '@HistoryService'.
  window.ioc.register('@HistoryService', history)
}
window.ioc.register('@diamondcoreprocessor.com/HistoryCursorService', new HistoryCursorService())
{
  const slots = new LayerSlotRegistry()
  window.ioc.register('@diamondcoreprocessor.com/LayerSlotRegistry', slots)
  slots.register(BUILDS_SLOT_DECLARATION)
  slots.register(SNAPSHOTS_SLOT_DECLARATION)
}

window.ioc.register('@diamondcoreprocessor.com/HistoryBootDrone', new HistoryBootDrone())
