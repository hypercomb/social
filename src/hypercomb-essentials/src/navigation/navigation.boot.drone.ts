// navigation/navigation.boot.drone.ts
//
// THE NAVIGATION BOOT BEE (atomic-modules-plan.md, step 6). The shell's own
// chrome reads the input gate, the mode registry and the input mode stack as
// it is constructed — before any ordinary bee loads — so a boot bee, loaded
// right after the dependencies, registers the domain's shared services.
// Every one of them is a dependency; this bee is the one that registers them.

import { Drone } from '@hypercomb/core'
import { BackGesture } from './back-gesture.service.js'
import { HexDetector } from './hex-detector.js'
import { InputGate } from './input-gate.service.js'
import { InputModeStack } from './input-mode-stack.service.js'
import { ModeRegistry } from './mode-registry.service.js'
import { ViewBack } from './view-back.js'
import { DEFAULT_HEX_GEOMETRY } from '../presentation/grid/hex-geometry.js'

export class NavigationBootDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Navigation at boot: registers the input gate, the mode registry, the input mode stack, the back gesture, view-back and the hex detector.'

  protected override sense = (): boolean => false
}

window.ioc.register('@diamondcoreprocessor.com/InputGate', new InputGate())
window.ioc.register('@diamondcoreprocessor.com/ModeRegistry', new ModeRegistry())
window.ioc.register('@diamondcoreprocessor.com/InputModeStack', new InputModeStack())
window.ioc.register('@diamondcoreprocessor.com/BackGesture', new BackGesture())
window.ioc.register('@diamondcoreprocessor.com/ViewBack', new ViewBack())
window.ioc.register('@diamondcoreprocessor.com/HexDetector', new HexDetector(DEFAULT_HEX_GEOMETRY.spacing))

window.ioc.register('@diamondcoreprocessor.com/NavigationBootDrone', new NavigationBootDrone())
