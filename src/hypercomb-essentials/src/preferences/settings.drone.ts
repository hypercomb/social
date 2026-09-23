// settings/settings.drone.ts
import { Drone, EffectBus } from '@hypercomb/core'
import { ZoomSettings } from './zoom-settings.js'
import { MobileModeService } from './mobile-mode.service.js'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from './mobile-pheromones.js'

export class SettingsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Registers user-configurable settings into IoC for other drones to resolve.'

  public override heartbeat = async (): Promise<void> => {
    // placeholder — settings registration will use global register() when enabled
  }
}

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register('@diamondcoreprocessor.com/ZoomSettings', ZoomSettings())
{
  const mobileMode = new MobileModeService()
  window.ioc.register(MOBILE_MODE_IOC_KEY, mobileMode)
  // Seed the channel so late subscribers (the gate) read the current state
  // even before the first change. EffectBus replays the last value.
  try { EffectBus.emit(MOBILE_MODE_EFFECT, { active: mobileMode.active }) } catch { /* ignore */ }
}
