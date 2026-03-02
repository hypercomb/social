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
    // placeholder — settings registration will use global register() when enabled
  }
}
