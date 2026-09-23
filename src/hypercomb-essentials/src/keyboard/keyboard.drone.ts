// keyboard/keyboard.drone.ts
//
// THE KEYBOARD IS A BEHAVIOUR (atomic-modules-plan.md, step 6). The keymap
// service and the Escape cascade are its dependencies; this bee is the one
// that registers them. Importing the cascade attaches its listeners.

import { Drone } from '@hypercomb/core'
import type { BackGesture } from '../navigation/back-gesture.service.js'
import { KeyMapService } from './keymap.service.js'
import { CLIPBOARD_MODE_BACK_ENTRY } from './escape-cascade.js'

export class KeyboardDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The keyboard: registers the keymap service and the Escape cascade.'

  protected override sense = (): boolean => false
}

window.ioc.register('@diamondcoreprocessor.com/KeyMapService', new KeyMapService())
window.ioc.whenReady<BackGesture>('@diamondcoreprocessor.com/BackGesture', gesture => gesture.register(CLIPBOARD_MODE_BACK_ENTRY))

window.ioc.register('@diamondcoreprocessor.com/KeyboardDrone', new KeyboardDrone())
