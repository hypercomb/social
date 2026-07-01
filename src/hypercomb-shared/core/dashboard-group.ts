// hypercomb-shared/core/dashboard-group.ts
//
// The "dashboard" launch group — surfaces the Q&A dashboard aggregator as a
// single meaning-icon in the command line, beside the websites icon. The
// dashboard is a navigation-behavior toggle owned by DashboardBee (open =
// navigate into its bag, close = navigate back); the launcher just calls
// toggleBehavior(). The icon appears only once a dashboard exists.
//
// Shell-level: DashboardBee is resolved through window.ioc at call time (never
// imports essentials). The single member means the icon always opens directly
// (count-gated 1 → open), never a hexagon page.

import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember, type LaunchGroup } from './group-registry'

type DashboardBeeLike = {
  isAvailable(): boolean
  isActive(): boolean
  toggleBehavior(): void
}

const MEMBER: GroupMember = { key: 'dashboard', label: 'Dashboard', segments: [] }

class DashboardGroup implements LaunchGroup {
  readonly id = 'dashboard'
  readonly icon = 'dashboard'
  readonly label = 'Dashboard'

  constructor() {
    // DashboardBee emits this on mint / open / close (and first paint) — late
    // subscribers get the last value replayed, so boot-time availability lands.
    EffectBus.on('dashboard:state', () => groupRegistry.notifyChanged())
  }

  members(): GroupMember[] {
    const bee = get<DashboardBeeLike>('@diamondcoreprocessor.com/DashboardBee')
    return bee?.isAvailable() ? [MEMBER] : []
  }

  // The dashboard now participates in the mix as a single launcher tile: its
  // click runs toggleBehavior() while standing on the mixed bag, so DashboardBee
  // captures agg-mix as its return location and closing the dashboard lands back
  // on the mixed page automatically (no dashboard-side wiring needed).
  open(_m: GroupMember): void {
    const bee = get<DashboardBeeLike>('@diamondcoreprocessor.com/DashboardBee')
    bee?.toggleBehavior()
  }
}

groupRegistry.register(new DashboardGroup())
