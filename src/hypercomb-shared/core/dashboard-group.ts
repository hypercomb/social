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
import { groupRegistry, type GroupMember } from './group-registry'
import { LaunchGroupBase } from './launch-group-base'

type DashboardBeeLike = {
  isAvailable(): boolean
  isActive(): boolean
  toggleBehavior(): void
}

const MEMBER: GroupMember = { key: 'dashboard', label: 'Dashboard', segments: [] }

class DashboardGroup extends LaunchGroupBase {
  override readonly id = 'dashboard'
  override readonly icon = 'dashboard'
  override readonly label = 'Dashboard'
  // The dashboard is a single toggle, not a browsable collection: the rail icon
  // opens the dashboard bag directly (toggleBehavior), never a /dashboard page.
  readonly openDirectly = true

  constructor() {
    super()
    // DashboardBee emits this on mint / open / close (and first paint) — late
    // subscribers get the last value replayed, so boot-time availability lands.
    EffectBus.on('dashboard:state', () => groupRegistry.notifyChanged())
  }

  override members(): GroupMember[] {
    const bee = get<DashboardBeeLike>('@diamondcoreprocessor.com/DashboardBee')
    return bee?.isAvailable() ? [MEMBER] : []
  }

  /** Rail-icon highlight: the dashboard is "on" while its bag is open. The
   *  icon has no page, so the location-derived highlight (currentId) never
   *  covers it — report the bag's live open state instead. */
  isActive(): boolean {
    const bee = get<DashboardBeeLike>('@diamondcoreprocessor.com/DashboardBee')
    return bee?.isActive() ?? false
  }

  // The dashboard participates in the mix as a single launcher tile: its click
  // runs toggleBehavior() while standing on the mixed bag, so DashboardBee
  // captures agg-mix as its return location and navigates back there on close.
  protected override activate(_m: GroupMember): void {
    const bee = get<DashboardBeeLike>('@diamondcoreprocessor.com/DashboardBee')
    bee?.toggleBehavior()
  }
}

groupRegistry.register(new DashboardGroup())
