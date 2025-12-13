import { NgModule } from "@angular/core";
import { ClipboardStore } from "src/app/clipboard/clipboard-store";
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector";
import { ContextMenu } from "src/app/navigation/menus/context-menu";
import { DETECTOR_STATE, CLIPBOARD_STATE, CONTEXT_MENU, ACTION_REGISTRY, TILE_FACTORY } from "../tokens/i-hypercomb.token";
import { SelectionService } from "src/app/cells/selection/selection-service";
import { SELECTIONS } from "../tokens/i-selection.token";
import { ActionRegistry } from "src/app/actions/action-registry";
import { ClipboardRepository } from "src/app/clipboard/clipboard-repository";
import { CLIPBOARD_REPOSITORY } from "../tokens/i-clipboard-repository";
import { TileFactory } from "src/app/inversion-of-control/factory/tile-factory";

@NgModule({
    providers: [
        { provide: ACTION_REGISTRY, useClass: ActionRegistry },
        { provide: DETECTOR_STATE, useExisting: CoordinateDetector },
        { provide: CLIPBOARD_STATE, useExisting: ClipboardStore },
        { provide: CLIPBOARD_REPOSITORY, useExisting: ClipboardRepository },
        { provide: CONTEXT_MENU, useExisting: ContextMenu },
        { provide: SELECTIONS, useClass: SelectionService },
        { provide: TILE_FACTORY, useClass: TileFactory }
    ]
})
export class HypercombModule { }


