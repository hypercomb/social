// src/app/unsorted/start-up-service.ts
import { Injectable, inject } from '@angular/core'

// actions
import { BackHiveAction } from '../actions/navigation/back'
import { BranchAction } from '../actions/navigation/branch'
import { CenterHiveAction } from '../actions/layout/center-hive'
import { ChangeModeAction } from '../actions/modes/change-mode'
import { ClipboardCopyAction } from '../actions/clipboard/copy-comb'
import { DeleteCellsAction } from '../actions/cells/delete-cells'
import { EditTileAction } from '../actions/cells/edit-cell'
import { ExploreStorageAction } from '../actions/storage/explore-storage'
import { ExportDatabaseAction } from '../actions/propagation/export-database'
import { FocusModeAction } from '../actions/modes/focus-mode'
import { GlobalEscapeAction } from '../actions/global-escape'
import { ImportDatabasesToOpfs } from '../actions/propagation/import-to-ofps'
import { ImportOpfsHiveAction } from '../actions/propagation/import-opfs-hive'
import { LockCellAction } from '../actions/cells/lock-cell.action'
import { MouseLockCheckAction } from '../actions/debug/debug-mouselocked'
import { OpenLinkAction } from '../actions/navigation/open-link'
import { RebuildHierarchyAction } from '../actions/propagation/rebuild-hierarchies'
import { RenameHiveAction } from '../actions/hives/rename-hive'
import { ShowHiveAction } from '../actions/modes/show-hive'
import { ToggleBranchAction } from '../actions/navigation/toggle-branch'
import { ToggleCutModeAction } from '../actions/clipboard/toggle-cut-mode'
import { ToggleEditModeAction } from '../actions/modes/cell-edit-mode'
import { ToggleMoveModeAction } from '../actions/modes/cell-move-mode'
import { ViewPhotoAction } from '../actions/cells/view-photo'

// cells and selection
import { CenterTileService } from '../cells/behaviors/center-tile-service'
import { TileSelectionManager } from '../cells/selection/tile-selection-manager'
import { SelectionMoveManager } from '../cells/selection/selection-move-manager'

// hive
import { HiveRouteWatcher } from '../hive/name-resolvers/hive-route-watcher'
import { HiveService } from '../hive/storage/hive-service'

// input and interactivity
import { KeyboardShortcutListener } from '../interactivity/keyboard/keyboard-shortcut-listener'
import { PointerBindingService } from '../state/input/pointer-binding-service'
import { SpacebarPanningService } from '../pixi/spacebar-panning-service'
import { TouchPanningService } from '../pixi/touch-panning-service'
import { PinchZoomService } from '../pixi/pinch-zoom-service'
import { WheelState } from '../common/mouse/wheel-state'

// rendering and visuals
import { ContainerBackgroundService } from '../pixi/container-background-service'
import { TilePointerManager } from '../user-interface/sprite-components/tile-pointer-manager'
import { ColorPicker } from './utility/color-picker'

// shortcuts
import { GlobalShortcutRegistry } from '../shortcuts/global-shortcut-registry'
import { ShortcutService } from '../shortcuts/shortcut-service'

// state
import { EventDispatcher } from '../helper/events/event-dispatcher'
import { StateHub } from '../state/core/state-hub'
import { GhostTileService } from '../cells/creation/ghost-tile-service'
import { RiftAction } from '../actions/navigation/path'
import { PositionSynchronizer } from '../hive/position-synchronizer'

// OPFS BACKUP & EXPORT
import { ExportAllHivesAction } from '../actions/propagation/export-all-hives'
import { OpfsBackupService } from '../actions/propagation/opfs-backup.service'
import { MousewheelZoomService } from '../pixi/mousewheel-zoom-service'


@Injectable({ providedIn: 'root' })
export class StartUpService {
  _ = [
    // visuals
    inject(ContainerBackgroundService),
    inject(ColorPicker),

    // hive
    inject(HiveRouteWatcher),
    inject(HiveService),

    // state
    inject(StateHub),
    inject(EventDispatcher),
    inject(PositionSynchronizer),

    // shortcuts
    inject(GlobalShortcutRegistry),
    inject(ShortcutService),
    inject(KeyboardShortcutListener),

    // input
    inject(PinchZoomService),
    inject(TouchPanningService),
    inject(SpacebarPanningService),
    inject(PointerBindingService),
    inject(WheelState),
    inject(MousewheelZoomService),

    // cells and selection
    inject(CenterTileService),
    inject(TileSelectionManager),
    inject(SelectionMoveManager),
    inject(GhostTileService),

    // rendering
    inject(TilePointerManager),

    // actions
    inject(BackHiveAction),
    inject(BranchAction),
    inject(CenterHiveAction),
    inject(ChangeModeAction),
    inject(ClipboardCopyAction),
    inject(DeleteCellsAction),
    inject(EditTileAction),
    inject(ExploreStorageAction),
    inject(ExportDatabaseAction),
    inject(FocusModeAction),
    inject(GlobalEscapeAction),
    inject(OpfsBackupService),
    inject(ExportAllHivesAction),
    inject(ImportDatabasesToOpfs),
    inject(ImportOpfsHiveAction),
    inject(LockCellAction),
    inject(MouseLockCheckAction),
    inject(OpenLinkAction),
    inject(RiftAction),
    inject(RebuildHierarchyAction),
    inject(RenameHiveAction),
    inject(ShowHiveAction),
    inject(ToggleBranchAction),
    inject(ToggleCutModeAction),
    inject(ToggleEditModeAction),
    inject(ToggleMoveModeAction),
    inject(ViewPhotoAction)
  ]
}