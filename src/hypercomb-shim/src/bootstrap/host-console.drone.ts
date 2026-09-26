// hypercomb-shim/src/bootstrap/host-console.drone.ts
//
// THE HOST CONSOLE, AS A BEEHAVIOR. It is the host package's one bee, carried
// by that package's `host` tile (build.mjs builds the package; the host
// bundle resolves it by its baked root signature and loads its boot bees,
// host-package.ts). Open the host tile and this is the code that runs there.
//
// It imports nothing stateful: installs go through the host's HOST_ACQUIRE_KEY
// port (replicate.ts), and everything else reaches the host through IoC.
// The host bundle shows it on a cold hive and hides it once an adopted
// surface takes over, through `show` and `hide`.

import { Drone } from '@hypercomb/core'
import { hideHostPanel, showHostPanel } from './host-panel'
import { HOST_CONSOLE_KEY } from './ports'

export class HostConsoleDrone extends Drone {
  readonly namespace = 'hypercomb.social'

  public override description =
    'The host console: this host\'s front door, its hosts and offerings, and the install of a chosen package.'

  protected override sense = (): boolean => false

  public readonly show = (): void => showHostPanel()
  public readonly hide = (): void => hideHostPanel()
}

window.ioc.register(HOST_CONSOLE_KEY, new HostConsoleDrone())
