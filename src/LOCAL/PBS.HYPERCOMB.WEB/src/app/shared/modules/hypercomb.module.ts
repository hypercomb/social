import { NgModule } from "@angular/core";
import { ClipboardStore } from "src/app/clipboard/clipboard-store";
import { CarouselService } from "src/app/common/carousel-menu/carousel-service";
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector";
import { ContextMenuService } from "src/app/navigation/menus/context-menu-service";
import { DETECTOR_STATE, CLIPBOARD_STATE, CONTEXT_MENU, CAROUSEL_SVC, ACTION_REGISTRY, SETTINGS_DATA_SVC, TILE_FACTORY } from "../tokens/i-hypercomb.token";
import { SelectionService } from "src/app/cells/selection/selection-service";
import { SELECTIONS } from "../tokens/i-selection.token";
import { QueryHelper } from "src/app/database/query/query-helper";
import { QUERY_HELPER } from "../tokens/i-cell-repository.token";
import { ActionRegistry } from "src/app/actions/action-registry";
import { CellFactory } from "src/app/inversion-of-control/factory/cell-factory";
import { CELL_CREATOR, CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token";

import { ClipboardRepository } from "src/app/clipboard/clipboard-repository";
import { CLIPBOARD_REPOSITORY } from "../tokens/i-clipboard-repository";
import { TileFactory } from "src/app/inversion-of-control/factory/tile-factory";
import { SettingsDataService } from "src/app/cells/storage/settings-service";

@NgModule({
    providers: [
        { provide: ACTION_REGISTRY, useClass: ActionRegistry },
        { provide: CELL_FACTORY, useExisting: CellFactory },
        { provide: CELL_CREATOR, useExisting: CellFactory },
        { provide: DETECTOR_STATE, useExisting: CoordinateDetector },
        { provide: QUERY_HELPER, useExisting: QueryHelper },
        { provide: CLIPBOARD_STATE, useExisting: ClipboardStore },
        { provide: CLIPBOARD_REPOSITORY, useExisting: ClipboardRepository },
        { provide: CONTEXT_MENU, useExisting: ContextMenuService },
        { provide: CAROUSEL_SVC, useExisting: CarouselService },
        { provide: SELECTIONS, useClass: SelectionService },
        { provide: SETTINGS_DATA_SVC, useClass: SettingsDataService },
        { provide: TILE_FACTORY, useClass: TileFactory }
    ]
})
export class HypercombModule { }


