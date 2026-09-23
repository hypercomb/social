// commands/commands.boot.drone.ts
//
// THE COMMANDS BOOT BEE (atomic-modules-plan.md, the boot lane). What the
// shell reads as it first renders, and what other bees expect to find when
// they load, registered before the runtime and Angular start — the timing
// the eager commands bundle used to give:
//   - the `decorations` slot. LayerCommitter subscribes only to a registered
//     slot's triggers, so a decoration written before the slot exists
//     vanishes, silently (decoration-manifest.ts);
//   - the `website` slot, so the preloader warms it with the rest;
//   - DecorationService — the controls bar reads tile titles through it on
//     its first render;
//   - the decoration index's overlap metrics and context index;
//   - VisualBeeRegistry, which every visual bee registers into.

import { Drone } from '@hypercomb/core'
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
import { DECORATIONS_SLOT, DECORATIONS_TRIGGER } from './decoration-manifest.js'
import { DecorationService } from './decoration.service.js'
import { contextIndex, overlapMetrics } from './decoration-kind-index.js'
import { VisualBeeRegistry } from './visual-bee-registry.js'
import { WEBSITE_SLOT } from './website-slot.js'

export class CommandsBootDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Registers the decorations, the decoration index and the visual-bee registry before the shell renders.'

  protected override sense = (): boolean => false
}

window.ioc.whenReady<LayerSlotRegistry>('@diamondcoreprocessor.com/LayerSlotRegistry', slotRegistry => {
  // LOUD: whenReady swallows what a callback throws, and a missing
  // decorations slot is exactly the silent failure this code once paid for.
  try {
    slotRegistry.register({ slot: DECORATIONS_SLOT, triggers: [DECORATIONS_TRIGGER] })
  } catch (error) {
    console.error('[commands.boot] decorations slot registration FAILED', error)
  }
  slotRegistry.register({ slot: WEBSITE_SLOT, triggers: [] })
})
window.ioc.register('@diamondcoreprocessor.com/DecorationService', new DecorationService())
window.ioc.register('@diamondcoreprocessor.com/OverlapMetrics', overlapMetrics)
window.ioc.register('@diamondcoreprocessor.com/ContextIndex', contextIndex)
window.ioc.register('@diamondcoreprocessor.com/VisualBeeRegistry', new VisualBeeRegistry())

window.ioc.register('@diamondcoreprocessor.com/CommandsBootDrone', new CommandsBootDrone())
