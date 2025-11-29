// src/app/common/footer-controls/default-view/default-view.component.ts
import { Component, inject } from '@angular/core'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { TouchDetectionService } from 'src/app/core/mobile/touch-detection-service'
import { CenterTileService } from 'src/app/cells/behaviors/center-tile-service'
import { LayoutManager } from 'src/app/core/controller/layout-manager'
import { ZoomService } from 'src/app/pixi/zoom-service'
import { ACTION_REGISTRY } from 'src/app/shared/tokens/i-hypercomb.token'
import { SELECTIONS } from 'src/app/shared/tokens/i-selection.token'
import { BackHiveAction } from 'src/app/actions/navigation/back.action'
import { LockCellAction } from 'src/app/actions/cells/lock-cell.action'
import { CopyAction } from 'src/app/actions/clipboard/copy-honeycomb'
import { DeleteCellsAction } from 'src/app/actions/cells/delete-cells'
import { ChangeModeAction } from 'src/app/actions/modes/change-mode'
import { CellPayload, ChangeModeContext, CopyPayload, DeletePayload } from 'src/app/actions/action-contexts'
import { Constants } from 'src/app/helper/constants'
import { PasteClipboardButtonComponent } from '../paste-clipboard-button/paste-clipboard-button.component'
import { ScreenService } from 'src/app/services/screen-service'

@Component({
  standalone: true,
  selector: 'app-default-view',
  templateUrl: './default-view.component.html',
  styleUrls: ['./default-view.component.scss'],
  imports: [PasteClipboardButtonComponent]
})
export class DefaultViewComponent extends Hypercomb {
  private readonly registry = inject(ACTION_REGISTRY)
  public readonly es = inject(EditorService)
  public readonly selections = inject(SELECTIONS)
  private readonly center = inject(CenterTileService)
  private readonly screen = inject(ScreenService)
  private readonly touch = inject(TouchDetectionService)
  private readonly zoom = inject(ZoomService)
  public readonly manager = inject(LayoutManager)

  public clipboard = {
    hasItems: () => false,
    count: () => 0,
    clear: async (): Promise<void> => { /* no-op */ },
    selected: () => 0
  }

  public clipboardItemCount: number = 0
  public ViewingGoogleDoc: HypercombMode = HypercombMode.ViewingGoogleDocument

  public get isBuildMode(): boolean { return this.state.isBuildMode }
  public get viewingClipboard(): boolean { return this.state.isViewingClipboard }
  public get supportsTouch(): boolean { return this.touch.supportsTouch() && !this.touch.supportsEdit() }
  public get isCutMode(): boolean { return this.state.isCutMode }
  public get isCopyMode(): boolean { return this.state.isCopyMode }
  public get isCollaborationMode(): boolean { return false }
  public get isRearrangeMode(): boolean { return this.state.isMoveMode }
  public get isSelectMode(): boolean { return this.state.isSelectMode }
  public get isViewingGoogleDoc(): boolean { return this.state.isViewingGoogleDocument }
  public get hasSelections(): boolean { return !!this.selections.items()?.length }
  public get hideClipboardActions(): boolean { return !this.state.isViewingClipboard }

  public add = async (): Promise<void> => {
    await this.state.setToolMode(HypercombMode.HiveCreation)
  }

  public build = async (): Promise<void> => {
    if (this.state.isMobile) return

    this.state.isBuildMode = !this.state.isBuildMode
    localStorage.setItem(Constants.BuildMode, this.state.isBuildMode ? 'true' : 'false')
  }

  public centerTiles = async (): Promise<void> => {
    await this.center.arrange()
  }

  public clearClipboard = async (): Promise<void> => {
    throw new Error('Method not implemented.')
  }

  public copy = async (): Promise<void> => {
    const selections = this.selections.items()
    await this.registry.invoke(
      CopyAction.ActionId,
      <CopyPayload>{ kind: 'copy-cells', cells: selections, hasSelections: true }
    )
  }

  public cut = async (): Promise<void> => {
    const selections = this.selections.items()
    // await Promise.all(selections.map(cell => clipboard.cut(cell)))
  }

  public goBack = async (event: MouseEvent): Promise<void> => {
    await this.registry.invoke(BackHiveAction.ActionId, { event })
  }

  public goHome = async (): Promise<void> => {
    // left as a placeholder for the original stack/store navigation
  }

  public fullscreen = async (): Promise<void> => {
    this.screen.goFullscreen()
  }

  public lock = async (): Promise<void> => {
    const cell = this.stack.cell()!
    await this.registry.invoke(
      LockCellAction.ActionId,
      <CellPayload>{ kind: 'cell', cell }
    )
  }

  public prompt = async (): Promise<void> => {
    this.state.setMode(HypercombMode.AiPrompt)
  }

  public delete = async (): Promise<void> => {
    const payload = <DeletePayload>{
      kind: 'delete-cells',
      cells: this.selections.items(),
      hasSelections: this.selections.items().length > 0
    }
    await this.registry.invoke(DeleteCellsAction.ActionId, payload)
  }

  public select = async (): Promise<void> => {
    await this.registry.invoke(
      ChangeModeAction.ActionId,
      <ChangeModeContext>{ mode: HypercombMode.Select }
    )
  }

  public toggleEditMode = async (): Promise<void> => {
    await this.registry.invoke(
      ChangeModeAction.ActionId,
      <ChangeModeContext>{ mode: HypercombMode.EditMode }
    )
  }

  public toggleMoveMode = async (): Promise<void> => {
    await this.registry.invoke(
      ChangeModeAction.ActionId,
      <ChangeModeContext>{ mode: HypercombMode.Move }
    )
  }

  public viewClipboard = async (): Promise<void> => {
    throw new Error('Method not implemented.')
  }

  public zoomIn = async (): Promise<void> => {
    const location = this.screen.getWindowCenter()
    this.zoom.zoomIn(location)
  }

  public zoomOut = async (): Promise<void> => {
    const location = this.screen.getWindowCenter()
    this.zoom.zoomOut(location)
  }
}
