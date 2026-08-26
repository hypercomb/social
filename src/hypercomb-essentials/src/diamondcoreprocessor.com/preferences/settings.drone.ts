// diamondcoreprocessor.com/settings/settings.drone.ts
import { Drone } from '@hypercomb/core'
// The theme service rides the preferences bundle — exactly ONE entry imports
// it (two importers would inline two instances; ioc is first-wins).
import './theme.service.js'

export class SettingsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Registers user-configurable settings into IoC for other drones to resolve.'

  public override heartbeat = async (): Promise<void> => {
    // placeholder — settings registration will use global register() when enabled
  }
}
