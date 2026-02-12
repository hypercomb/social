// src/<domain>/settings/settings.drone.ts
import { Drone } from '@hypercomb/core'

export class SettingsDrone extends Drone {
  private initialized = false

  protected sense = async (grammar: string):  Promise<boolean> => { 
    if(!this.initialized) {
      this.initialized = true
      return true
    }
    return false
  }

  public heartbeat = async (): Promise<void> => {
    const { register, get } = (<any>window).ioc

    // // get settings module (preloaded or importable)
    // const mod = get(SettingsModule)
    // console.log('got settings module:', mod)

    // register(SettingsKeys.ZoomSettings, mod.ZoomSettings())
    // // publish instances
    // ioc.register('diamondcoreprocessor.com/core/settings/zoom-settings', new mod.ZoomSettings())

    // repeat if needed
    // ioc.register('otherSettings', new mod.OtherSettings())
  }
}
