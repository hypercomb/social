
import { environment } from 'src/environments/environment'
import { ZoomService } from '../../pixi/zoom-service'
import { PasteClipboardButtonComponent } from './paste-clipboard-button/paste-clipboard-button.component'
import { Component, OnInit, inject } from '@angular/core'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { Constants } from 'src/app/unsorted/constants'
import { TouchDetectionService } from 'src/app/core/mobile/touch-detection-service'
import { ScreenService } from 'src/app/unsorted/utility/screen-service'
import { ControlsActiveDirective } from 'src/app/core/directives/controls-active-directive'
import { CenterTileService } from 'src/app/cells/behaviors/center-tile-service'
import { BackHiveAction } from 'src/app/actions/navigation/back.action'
import { DeleteCellsAction } from 'src/app/actions/cells/delete-cells'
import { CellContext, CellListContext, ChangeModeContext } from 'src/app/actions/action-contexts'
import { LockCellAction } from 'src/app/actions/cells/lock-cell.action'
import { LayoutManager } from 'src/app/core/controller/layout-manager'
import { ChangeModeAction } from 'src/app/actions/modes/change-mode'
import { SELECTIONS } from 'src/app/shared/tokens/i-selection.token'
import { ACTION_REGISTRY } from 'src/app/shared/tokens/i-hypercomb.token'

@Component({
  standalone: true,
  imports: [ControlsActiveDirective, PasteClipboardButtonComponent],
  selector: '[app-controls]',
  templateUrl: './controls.component.html',
  styleUrls: ['./controls.component.scss']
})
export class ControlsComponent extends Hypercomb implements OnInit {
  private readonly registry = inject(ACTION_REGISTRY)
  public clipboard = { 
    hasItems: () => false,
    count: () => 0,
    clear: async () => { /* no-op */ },
    selected: () => 0,
  }
  public readonly es = inject(EditorService)
  public readonly selections = inject(SELECTIONS)
  private readonly center = inject(CenterTileService)
  private readonly screen = inject(ScreenService)
  private readonly touch = inject(TouchDetectionService)
  private readonly zoom = inject(ZoomService)
  public clipboardItemCount: number = 0
  public ViewingGoogleDoc: HypercombMode = HypercombMode.ViewingGoogleDocument
  public readonly manager = inject(LayoutManager)


  public get isBuildMode(): boolean { return this.state.isBuildMode }
  public get viewingClipboard(): boolean { return this.state.isViewingClipboard }
  public get supportsTouch(): boolean { return this.touch.supportsTouch() && !this.touch.supportsEdit() }
  public get link(): string { return environment.production ? this.ls.link : this.ls.information }
  public get isCutMode(): boolean { return this.state.isCutMode }
  public get isCopyMode(): boolean { return this.state.isCopyMode }
  public get isCollaborationMode(): boolean { return false }
  public get isRearrangeMode(): boolean { return this.state.isMoveMode }
  public get isSelectMode(): boolean { return this.state.isSelectMode }
  public get isViewingGoogleDoc(): boolean { return this.state.isViewingGoogleDocument }
  public get hasSelections(): boolean { return !!this.selections.items()?.length }
  public get hideClipboardActions(): boolean { return !this.state.isViewingClipboard }


  ngOnInit() {

    // initialize build mode
    this.state.isBuildMode = !this.state.isMobile && localStorage.getItem(Constants.BuildMode) === "true"
  }

  public add = async () => {
    return this.state.setToolMode(HypercombMode.HiveCreation)
  }

  public build = async () => {
    if (this.state.isMobile) return

    this.state.isBuildMode = !this.state.isBuildMode
    if (this.state.isBuildMode) {
      localStorage.setItem(Constants.BuildMode, "true")
    } else {
      localStorage.setItem(Constants.BuildMode, "false")
    }
  }

  public centerTiles = async () => {
    await this.center.arrange()
  }

  public clearClipboard = async () => {
    // if (!this.state.hasMode(HypercombMode.ViewingClipboard)) return
    // await this.clipboard.clear()

    throw new Error('Method not implemented.')
  }

  public copy = async () => {
    const selections = this.selections.items()

    // If there are multiple selections then process all immediately
    if (selections?.length > 0) {
      await this.registry.invoke('clipboard.copy', <CellListContext>{ kind: 'cell-list', cells: selections })
    } else {
      this.registry.invoke(ChangeModeAction.ActionId, <ChangeModeContext>{ mode: HypercombMode.Copy })
    }

  }

  public cut = async () => {
    // const selections = this.ss.items()
    // // If there are selections then process all immediately no need toggle clipboard
    // if (selections?.length) {
    //   await Promise.all(selections.map(cell => clipboard.cut(cell)))
    // }
    // else { 
    //   this.state.toggleToolMode(HypercombMode.Cut)
    // }

    throw new Error('Method not implemented.')
  }

  public async goBack(event: MouseEvent) {
    await this.registry.invoke(BackHiveAction.ActionId, { event })
  }


  public async goHome() {
    // const current = this.stack.cell()
    // if (!current) return
    // const hive = this.store.lookupHive(current?.hive)

    // if (!hive || (hive.uniqueId === current.uniqueId)) return

    // this.modify.invalidate()
    // this.stack.push(hive)
  }

  public fullscreen = async () => {
    this.screen.goFullscreen()
  }

  public lock = async () => {
    const cell = this.stack.cell()!
    this.registry.invoke(LockCellAction.ActionId, <CellContext>{ kind: 'cell', cell })
    console.log('lock')
  }

  public prompt = async () => {
    this.state.setMode(HypercombMode.AiPrompt)
  }

  public delete = async () => {
    const payload = <CellListContext>{ kind: 'cell-list', cells: this.selections.items() }
    this.registry.invoke(DeleteCellsAction.ActionId, payload)
  }

  public select = async () => {
    this.registry.invoke(ChangeModeAction.ActionId, <ChangeModeContext>{ mode: HypercombMode.Select })
  }

  public toggleEditMode = async () => {
    this.registry.invoke(ChangeModeAction.ActionId, <ChangeModeContext>{ mode: HypercombMode.EditMode })
  }

  public toggleMoveMode = async () => {
    this.registry.invoke(ChangeModeAction.ActionId, <ChangeModeContext>{ mode: HypercombMode.Move })
  }

  public viewClipboard = async () => {
    // if (!this.cbs.hasItems()) return
    // await this.clipboard_service.view()
    throw new Error('Method not implemented.')
  }

  public zoomIn = async () => {
    const location = this.screen.getWindowCenter()
    this.zoom.zoomIn(location)
  }

  public zoomOut = async () => {
    const location = this.screen.getWindowCenter()
    this.zoom.zoomOut(location)
  }
}


