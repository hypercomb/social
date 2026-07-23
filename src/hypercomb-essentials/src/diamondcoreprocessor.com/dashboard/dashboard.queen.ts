// diamondcoreprocessor.com/dashboard/dashboard.queen.ts
//
// `/dashboard` — toggle to the global dashboard and back.
//
// The dashboard is a GLOBAL surface (the hive's open questions live at the
// root-level `dashboard` cell, minted by the routine / ensure-dashboard).
// Bare `/dashboard` navigates there from anywhere and remembers where you
// were; `/dashboard` again (or from anywhere under it) returns you to that
// exact spot — an update on the context, not a walk, so "back" lands on
// yourself. Right-click keeps its normal meaning (up one level) throughout.
//
// Syntax:
//   /dashboard        — toggle: go to the dashboard ⇄ return to where you were
//   /dashboard here   — mint a dashboard bag AT the current location (the
//                       original per-location behavior, kept for curators)
//
// Guard: bare toggle refuses to navigate when no `dashboard` cell exists yet
// (navigation would mint a phantom segment) and says how to mint one instead.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'

type DashboardBeeLike = {
  createDashboardForCurrentLocation: () => Promise<{ bagLocSig: string } | null>
}
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const DASHBOARD_SEGMENT = 'dashboard'

export class DashboardQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'dashboard'
  override readonly aliases = []
  override description = 'Toggle the dashboard — open questions for the whole hive'
  override descriptionKey = 'slash.dashboard'
  // No advertised options: the dashboard is GLOBAL, so surfacing a `here`
  // completion reads as nonsense on a page with no dashboard tile (and the
  // auto-param dropdown it triggers confuses the bare toggle). `here` is
  // still ACCEPTED as a typed argument for curators who know it.
  override options = []
  override examples = [
    { input: '/dashboard', result: 'Go to the dashboard; run again to return where you were' },
  ]

  /** Where the user stood before toggling in — restored on toggle-out. */
  #prior: readonly string[] | null = null

  protected async execute(args: string): Promise<void> {
    const a = args.trim().toLowerCase()

    if (a === 'here' || a === 'create') {
      const bee = get<DashboardBeeLike>('@diamondcoreprocessor.com/DashboardBee')
      if (!bee) return
      await bee.createDashboardForCurrentLocation()
      return
    }

    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    if (!nav?.goRaw) { this.#log('Dashboard — navigation unavailable') ; return }

    const current = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)

    // Toggle OUT — anywhere under /dashboard returns to the remembered spot.
    if (current[0] === DASHBOARD_SEGMENT) {
      const back = this.#prior ?? []
      this.#prior = null
      nav.goRaw(back)
      this.#log('Dashboard — closed', '○')
      return
    }

    // Toggle IN — only if the global dashboard cell exists (never mint a
    // phantom segment by navigating to a cell that isn't there).
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (history) {
      const sig = await history.sign({ explorerSegments: () => [DASHBOARD_SEGMENT] })
      const layer = await history.currentLayerAt(sig)
      if (!layer) {
        this.#log('Dashboard — none yet. The routine mints it, or run /dashboard here')
        return
      }
    }
    this.#prior = current
    nav.goRaw([DASHBOARD_SEGMENT])
    this.#log('Dashboard — open questions', '▣')
  }

  #log(message: string, icon = '▣'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _dashboard = new DashboardQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DashboardQueenBee', _dashboard)
