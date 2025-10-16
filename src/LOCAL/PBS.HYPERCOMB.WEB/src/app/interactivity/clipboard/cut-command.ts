// cut.action.ts
import { inject } from "@angular/core"
import { Action } from "rxjs/internal/scheduler/Action"
import { Cell } from "src/app/cells/cell"
import { ClipboardService } from "src/app/clipboard/clipboard-service"
import { HypercombMode } from "src/app/core/models/enumerations"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { EditorService } from "src/app/state/interactivity/editor-service"

export const cutAction: Action<Cell[]> = {
    id: "tile.cut",
    label: "Cut Tile",
    description: "Cut active tile to clipboard",
    category: "Clipboard",
    risk: "warning",

    enabled: async (cell) => {
        const es = inject(EditorService)
        const honeycomb = inject(HypercombState)
        return !!cell && honeycomb.hasMode(HypercombMode.Cut);
    },

    run: async (cell) => {
        if (!cell) return 

        const clipboard = inject(ClipboardService)
        // TODO: implement actual cut logic
        // await clipboard.cut(ctx.cell)
        throw new Error('Method not implemented.')
    },
}
