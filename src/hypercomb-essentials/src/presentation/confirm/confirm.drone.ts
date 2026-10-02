// presentation/confirm/confirm.drone.ts
//
// THE CONFIRM DIALOG'S BEE (atomic-modules-plan.md, rule 1: one behaviour per
// feature; registration is the bee's act). The dialog is a dependency atom
// (confirm.view.ts) that only exports. This bee adds its element to the
// ShellSurfaceRegistry and defines it on the first question, so every
// `confirm:request` (core confirm.ts requestConfirm) has a dialog to answer it.
//
// The first of shared's Angular shell surfaces ported into the package: it
// reaches a hive by replication, like every other beehavior, and the Angular
// shell mounts the same element through the same registry.

import { Drone, EffectBus, type ConfirmRequest, type ConfirmResponse } from '@hypercomb/core'

// THE DIALOG ARRIVES WITH THE FIRST QUESTION, not at boot: the view loads once,
// when a request first comes, and the element the shell's surface host already
// made upgrades in place — its own listener then takes the bus's replay of that
// request. The tag and owner are written out: importing even a constant from
// the view would keep it on the boot path.
const CONFIRM_SURFACE = 'hc-confirm-dialog'
const CONFIRM_OWNER = '@diamondcoreprocessor.com/ConfirmView'
const CONFIRM_REQUEST = 'confirm:request'
type ConfirmView = typeof import('./confirm.view.js')
let viewLoad: Promise<ConfirmView> | null = null
const loadView = (): Promise<ConfirmView> =>
  viewLoad ??= import('./confirm.view.js').catch(error => { viewLoad = null; throw error })

export class ConfirmDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The question before a delete: puts the confirm dialog in the shell, where every confirm:request is answered.'

  // By name, so the hive's drill-down reads what this bee hears and says.
  protected override listens = ['confirm:request']
  protected override emits = ['confirm:response']

  protected override sense = (): boolean => false

  constructor() {
    super()
    this.onEffect<ConfirmRequest>(CONFIRM_REQUEST, request => { if (request?.id) void this.#define(request) })
  }

  /** Define the dialog's element on the first question. The element, once
   *  defined, reads the question itself from the bus's last value. A view
   *  that cannot load answers the question with no, so the asker is never
   *  left waiting; the next question tries again. */
  async #define(request: ConfirmRequest): Promise<void> {
    if (customElements.get(CONFIRM_SURFACE)) return
    try {
      const view = await loadView()
      if (!customElements.get(CONFIRM_SURFACE)) customElements.define(CONFIRM_SURFACE, view.ConfirmElement)
    } catch (error) {
      console.warn('[confirm] the dialog could not load — the question is answered no', error)
      EffectBus.emit<ConfirmResponse>('confirm:response', { id: request.id, confirmed: false })
    }
  }
}

// Added at boot, defined by the first question (#define).
window.ioc.whenReady<{ add(surface: unknown): void }>('@hypercomb.social/ShellSurfaceRegistry', registry => {
  try {
    registry.add({ name: CONFIRM_SURFACE, owner: CONFIRM_OWNER, element: CONFIRM_SURFACE, order: 240 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

window.ioc.register('@diamondcoreprocessor.com/ConfirmDrone', new ConfirmDrone())
