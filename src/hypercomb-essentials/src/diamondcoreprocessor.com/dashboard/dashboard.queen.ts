// diamondcoreprocessor.com/dashboard/dashboard.queen.ts
//
// `/dashboard` — thin slash-command wrapper around DashboardBee.
//
// All the work happens in the bee: minting the bag, pinning the
// location, emitting the pill, gossip-publishing. The queen exists
// only so the user can type `/dashboard` and so the autocomplete
// surface sees the command in IoC.

import { QueenBee } from '@hypercomb/core'

type DashboardBeeLike = {
  createDashboardForCurrentLocation: () => Promise<{ bagLocSig: string } | null>
}

export class DashboardQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'dashboard'
  override readonly aliases = []
  override description = 'Create a dashboard at the current location'

  protected async execute(_args: string): Promise<void> {
    const bee = get<DashboardBeeLike>('@diamondcoreprocessor.com/DashboardBee')
    if (!bee) return
    await bee.createDashboardForCurrentLocation()
  }
}

const _dashboard = new DashboardQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DashboardQueenBee', _dashboard)
