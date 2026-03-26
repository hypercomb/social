// src/app/unsorted/start-up-service.ts
import { Injectable, inject } from '@angular/core'

// actions
import { BackHiveAction } from '../actions/navigation/back.action'
import { BranchAction } from '../actions/navigation/branch.action'
import { CenterHiveAction } from '../actions/layout/center-hive'
import { ChangeModeAction } from '../actions/modes/change-mode'
import { RemoveCellsAction } from '../actions/cells/delete-cells'
import { EditTileAction } from '../actions/cells/edit-cell'
import { ExploreStorageAction } from '../actions/storage/explore-storage'
import { FocusModeAction } from '../actions/modes/focus-mode'
import { GlobalEscapeAction } from '../actions/global-escape'
import { LockCellAction } from '../actions/cells/lock-cell.action'
import { MouseLockCheckAction } from '../actions/debug/debug-mouselocked'
import { OpenLinkAction } from '../actions/navigation/open-link'
import { ToggleBranchAction } from '../actions/navigation/toggle-branch'
import { ToggleCutModeAction } from '../actions/clipboard/toggle-cut-mode'
import { ToggleChatWindowAction } from '../actions/ai/show-chat-window'
import { ToggleEditModeAction } from '../actions/modes/cell-edit-mode'
import { ToggleMoveModeAction } from '../actions/modes/cell-move-mode'
import { ViewPhotoAction } from '../actions/cells/view-photo'

// cells and selection
import { CenterTileService } from '../cells/behaviors/center-tile-service'
import { TileSelectionManager } from '../cells/selection/tile-selection-manager'
import { SelectionMoveManager } from '../cells/selection/selection-move-manager'

// hive
import { HiveRouteWatcher } from '../hive/hive-route-watcher'

// input and interactivity
import { KeyboardShortcutListener } from '../interactivity/keyboard/keyboard-shortcut-listener'
import { PointerBindingService } from '../state/input/pointer-binding-service'
import { SpacebarPanningService } from '../pixi/spacebar-panning-service'
import { TouchPanningService } from '../pixi/touch-panning-service'
import { WheelState } from '../common/mouse/wheel-state'

// rendering and visuals
import { ContainerBackgroundService } from '../pixi/container-background-service'
import { TilePointerManager } from '../user-interface/sprite-components/tile-pointer-manager'


// shortcuts
import { GlobalShortcutRegistry } from '../shortcuts/global-shortcut-registry'
import { ShortcutService } from '../shortcuts/shortcut-service'

// state
import { EventDispatcher } from '../helper/events/event-dispatcher'
import { StateHub } from '../state/core/state-hub'
import { PositionSynchronizer } from '../hive/position-synchronizer'

// OPFS BACKUP & EXPORT
import { MousewheelZoomService } from '../pixi/mousewheel-zoom-service'
import { PinchZoomService } from '../pixi/pinch-zoom-service'
import { CopyAction } from '../actions/clipboard/copy-honeycomb'
import { CloseExternalAction } from '../actions/navigation/close-external'
import { ColorPicker } from '../services/color-picker'
import { NewTileAction } from '../actions/cells/new-tile.action'
import { HiveService } from './hive/hive-service'


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

    // rendering
    inject(TilePointerManager), 

    // actions
    
    inject(BackHiveAction),
    inject(BranchAction),
    inject(CenterHiveAction),
    inject(ChangeModeAction),
    inject(CloseExternalAction),
    inject(CopyAction),
    inject(RemoveCellsAction),
    inject(EditTileAction),
    inject(ExploreStorageAction),
    inject(FocusModeAction),
    inject(GlobalEscapeAction),
    inject(LockCellAction),
    inject(MouseLockCheckAction),
    inject(NewTileAction),
    inject(OpenLinkAction),
    inject(ToggleBranchAction),
    inject(ToggleChatWindowAction), 
    inject(ToggleCutModeAction),
    inject(ToggleEditModeAction),
    inject(ToggleMoveModeAction),
    inject(ViewPhotoAction)
  ]
}