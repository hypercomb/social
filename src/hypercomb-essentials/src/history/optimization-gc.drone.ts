// history/optimization-gc.drone.ts
//
// The reap for derived optimizations. It runs in the optimize phase. A
// record minted later in the same pass is enrolled on the next pass, on
// the keep line, so import order cannot recycle a fresh write. A pass
// with nothing due returns immediately.
//
// Counts live in sign('optimization:heat'). The derived bytes stay a pure
// function of their source. A count under the keep line is in recycling
// priority and may be dropped, lowest first. A count on or above the line
// is kept. A miss rebuilds the record.

import { Drone } from '@hypercomb/core'

type Reaper = { reapDerivedOptimizations?: () => Promise<void> }

export class OptimizationGcDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'moves derived optimizations in and out of recycling priority by use count'

  public override optimize = async (): Promise<void> => {
    const store = window.ioc?.get<Reaper>('@hypercomb.social/Store')
    await store?.reapDerivedOptimizations?.()
  }
}

window.ioc.register('@diamondcoreprocessor.com/OptimizationGcDrone', new OptimizationGcDrone())
