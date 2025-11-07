import { Injectable, inject } from "@angular/core"
import { POLICY } from "src/app/core/models/enumerations"
import { Cell } from "src/app/cells/cell"
import { PolicyService } from "src/app/navigation/menus/policy-service"
import { EditorService } from "src/app/state/interactivity/editor-service"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { HypercombState } from "src/app/state/core/hypercomb-state"   // ✅ add this

@Injectable({ providedIn: 'root' })
export class CellEditor extends PixiDataServiceBase {
  private readonly es = inject(EditorService)
  private readonly policy = inject(PolicyService)

  public readonly isBlocked = this.policy.any(
    POLICY.NotFirstTile,
    POLICY.EditInProgress,
    POLICY.KeyboardBlocked,
    POLICY.MovingTiles
  )

  private readonly localDomains = [
    'https://localhost:4200/',
    'https://hypercomb.io',
    'https://staging.hypercomb.io',
    'https://testing.hypercomb.io',
    'https://rc.hypercomb.io',
    'https://www.hypercomb.io'
  ] as const

  public isLocalDomain = (link?: string): boolean =>
    !!link && this.localDomains.some(domain => link.startsWith(domain))

  public beginEditing = (cell: Cell) => {
    if (!cell.image) throw new Error('Cannot edit a cell without an image!')
    this.state.setContextActive(false)   // ✅ reset context when entering editor
    this.es.setContext(cell)
  }

  public complete = () => {
    this.es.setContext(null)
    this.state.setContextActive(false)   // ✅ ensure cleared after editing
    const current = this.stack.cell()!
    this.stack.push(current)
  }

  public cancel = () => this.complete()
  public delete = (cell: Cell) => this.complete()
}
