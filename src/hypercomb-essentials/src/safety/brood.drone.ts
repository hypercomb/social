// safety/brood.drone.ts
//
// THE BROOD'S BEE (atomic-modules-plan.md, rule 1: one behaviour per feature;
// registration is the bee's act). The brood's surface — every held automaton,
// with Read · Accept · Refuse — is a dependency atom (brood.view.ts) that only
// exports. This bee defines its element and adds it to the ShellSurfaceRegistry,
// so `brood:open` — from the `brood` word, or a trial taken by hand whose code
// is waiting — always has a panel to open.

import { Drone } from '@hypercomb/core'
import { BROOD_OWNER, BROOD_SURFACE, BroodElement } from './brood.view.js'

export class BroodDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The brood: puts its surface in the shell, where held code is read, accepted or refused.'

  protected override sense = (): boolean => false
}

window.ioc.whenReady<{ add(surface: unknown): void }>('@hypercomb.social/ShellSurfaceRegistry', registry => {
  if (!customElements.get(BROOD_SURFACE)) customElements.define(BROOD_SURFACE, BroodElement)
  try {
    registry.add({ name: BROOD_SURFACE, owner: BROOD_OWNER, element: BROOD_SURFACE, order: 150 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

window.ioc.register('@diamondcoreprocessor.com/BroodDrone', new BroodDrone())
