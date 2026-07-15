// diamondcoreprocessor.com/history/rewound-commit.drone.ts
//
// Handles the UX when a user edits from a rewound history cursor.
// HistoryService auto-promotes the cursor state to a new head before
// recording the intended op; this drone picks up the resulting
// 'history:promoted' effect and:
//   1. Enters move mode (if not already active) so the user can reshape
//   2. Reconciles selection — drops labels that no longer exist at the new head
//   3. Shows a one-time toast explaining the branch
import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { SelectionService } from '../selection/selection.service.js'
import type { MoveDroneApi } from '../move/move.drone.js'

type PromotedPayload = {
  locationSig: string
  reconciledOrder: string[]
  survivingCells: string[]
}

export class RewoundCommitDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Reconciles mode, selection, and user feedback after a rewound-state promotion.'

  #toastShown = false

  protected override deps = {
    selection: '@diamondcoreprocessor.com/SelectionService',
    move: '@diamondcoreprocessor.com/MoveDrone',
  }

  protected override listens = ['history:promoted']
  protected override emits = ['controls:action', 'toast:show']

  #registered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#registered) return
    this.#registered = true

    this.onEffect<PromotedPayload>('history:promoted', (payload) => {
      if (!payload) return
      this.#reconcileSelection(payload.survivingCells)
      this.#ensureMoveMode()
      this.#showBranchToast()
    })
  }

  #reconcileSelection(survivingCells: string[]): void {
    const selection = this.resolve<SelectionService>('selection')
    if (!selection) return

    const surviving = new Set(survivingCells)
    const current = [...selection.selected]
    const stale = current.filter(label => !surviving.has(label))
    if (stale.length === 0) return

    for (const label of stale) selection.remove(label)
  }

  #ensureMoveMode(): void {
    const move = this.resolve<MoveDroneApi>('move')
    if (!move) return
    if (move.moveActive) return
    EffectBus.emit('controls:action', { action: 'move' })
  }

  #showBranchToast(): void {
    if (this.#toastShown) return
    this.#toastShown = true
    const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
    EffectBus.emit('toast:show', {
      type: 'info',
      title: i18n?.t('history.branch.title') ?? 'New path forward',
      message: i18n?.t('history.branch.message') ?? 'Editing from an earlier state — your changes create a new branch from here.',
    })
  }
}

const _rewoundCommit = new RewoundCommitDrone()
window.ioc.register('@diamondcoreprocessor.com/RewoundCommitDrone', _rewoundCommit)
