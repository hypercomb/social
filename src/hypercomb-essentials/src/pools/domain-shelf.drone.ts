// pools/domain-shelf.drone.ts
//
// DomainShelfDrone: the bee that brings the node shelf. It defines
// <hc-domain-shelf> (domain-shelf.element.ts) and adds it to the shell's
// surface registry through IoC (the `element:` shape, never a tag in an
// app.html and never an Angular class), right after the shelf it stands under
// (A9), so every shell mounts it. The element does the showing, the switching
// and the announcing of whom this hive takes from (T5): the hosts it follows
// and the participants of the room it joined, as one row of nodes. This drone
// only makes sure the element exists.

import { Drone } from '@hypercomb/core'
import { DOMAIN_SHELF_WANTED, LIGHTS_MODE, SOURCES_CHANGED, SOURCES_COUNTED, SOURCES_NODES, SOURCES_QUERY } from './lights-contract.js'
import { DOMAIN_SHELF_SURFACE, defineDomainShelf } from './domain-shelf.element.js'

const DRONE_KEY = '@diamondcoreprocessor.com/DomainShelfDrone'

export class DomainShelfDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  public override description =
    'The node shelf under the shelf: the hosts you follow and the people in the room you joined, as small chips that switch on and off, and a search over what they offer. What is on is where pools are drawn from.'

  protected override deps = {}
  protected override listens: string[] = [
    DOMAIN_SHELF_WANTED, LIGHTS_MODE, SOURCES_NODES, SOURCES_QUERY, SOURCES_COUNTED, 'hosts:render', 'shelf:changed', 'viewport:inset-poll',
  ]
  protected override emits: string[] = [SOURCES_CHANGED, 'viewport:inset', 'keymap:suppress', 'keymap:unsuppress']

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { defineDomainShelf() }
}

defineDomainShelf()
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: DOMAIN_SHELF_SURFACE, owner: DRONE_KEY, element: DOMAIN_SHELF_SURFACE, order: 153 })
  } catch {
    // duplicate add (hot reload): the mounted surface is already live
  }
})
window.ioc.register(DRONE_KEY, new DomainShelfDrone())
