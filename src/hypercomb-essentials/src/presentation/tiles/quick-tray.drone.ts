// presentation/tiles/quick-tray.drone.ts
//
// QuickTrayDrone — the bee that brings the hand. It defines <hc-quick-tray>
// (quick-tray.element.ts) and adds it to the shell's surface registry through
// IoC (`element:` shape — never a tag in either app.html, never an Angular
// class, so the shim mounts it too). The element does the holding; this drone
// only makes sure it exists. Step one of documentation/recents-and-the-quick-
// tray.md: the clipboard panel still stands until the recents view lands.

import { Drone } from '@hypercomb/core'
import { QUICK_TRAY_SURFACE, defineQuickTray } from './quick-tray.element.js'

const DRONE_KEY = '@diamondcoreprocessor.com/QuickTrayDrone'

export class QuickTrayDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'The quick tray at the top of the screen: holds the references a tile\'s drag handle sends it; a row dragged onto the hive places it (Shift moves it).'

  protected override deps = {}
  protected override listens: string[] = []
  protected override emits: string[] = []

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { defineQuickTray() }
}

defineQuickTray()
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: QUICK_TRAY_SURFACE, owner: DRONE_KEY, element: QUICK_TRAY_SURFACE, order: 152 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})
window.ioc.register(DRONE_KEY, new QuickTrayDrone())
