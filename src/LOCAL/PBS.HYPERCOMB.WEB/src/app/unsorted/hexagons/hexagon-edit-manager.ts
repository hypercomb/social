import { Injectable, inject } from "@angular/core"
import { POLICY } from "src/app/core/models/enumerations"
import { Cell } from "src/app/cells/cell"
import { PolicyService } from "src/app/navigation/menus/policy-service"
import { EditorService } from "src/app/state/interactivity/editor-service"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"

@Injectable({ providedIn: 'root' })
export class HexagonEditManager extends PixiDataServiceBase {
    private readonly es = inject(EditorService)
    private readonly policy = inject(PolicyService)
    private readonly store = inject(COMB_STORE)

    // policies
    public readonly isBlocked = this.policy.any(
        POLICY.NotFirstTile,
        POLICY.EditInProgress,
        POLICY.KeyboardBlocked,
        POLICY.MovingTiles
    )

    // domains
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
        this.es.setContext(cell)
    }   

    public complete = (cell: Cell) => {
        this.es.setContext(null)   // end editing session by clearing context
    }

    public cancel = () => {
        this.es.setContext(null)   // cancel editing → no context
    }

    public deleted = (cell: Cell) => {
        this.es.setContext(null)   // deleted tile → clear context
    }

}


