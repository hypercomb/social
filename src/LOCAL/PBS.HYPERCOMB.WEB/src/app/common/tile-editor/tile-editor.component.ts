import { Component, computed, effect, ElementRef, inject, ViewChild } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatIconModule } from '@angular/material/icon'
import { Assets } from 'pixi.js'
import { AiSearchPath, AlignMiddle, BranchPath } from 'src/app/helper/path'
import { CellOptions, POLICY } from 'src/app/core/models/enumerations'
import { EditorActionsComponent } from './editor-actions/editor-actions.component'
import { SaveBranchButtonComponent } from './save-branch-button/save-branch-button.component'
import { SpaceContinuationDirective } from './space-continuation.directive'
import { SwatchPanelComponent } from './swatch-panel/swatch-panel.component'
import { TileImageComponent } from './tile-image/tile-image.component'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { CellEditor } from 'src/app/common/tile-editor/cell-editor'
import { Cell } from 'src/app/cells/cell'
import { Events } from 'src/app/helper/events/events'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { CellFactory } from 'src/app/inversion-of-control/factory/cell-factory'
import { MODIFY_COMB_SVC } from 'src/app/shared/tokens/i-comb-service.token'
import { ImagePersistenceService } from './tile-image/image-persistence-service'
import { PointerState } from 'src/app/state/input/pointer-state'
import { HiveService } from 'src/app/hive/storage/hive-service'
import { ImageCaptureManager } from './tile-image/image-capture-manager'
import { CellEditContext } from 'src/app/state/interactivity/cell-edit-context'

@Component({
  standalone: true,
  selector: '[app-tile-editor]',
  templateUrl: './tile-editor.component.html',
  styleUrls: ['./tile-editor.component.scss'],
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    EditorActionsComponent,
    SaveBranchButtonComponent,
    SpaceContinuationDirective,
    SwatchPanelComponent,
    TileImageComponent
  ]
})
export class TileEditorComponent extends Hypercomb {
  @ViewChild('name') name!: ElementRef<HTMLInputElement>

  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────
  public readonly es = inject(EditorService)
  private readonly factory = inject(CellFactory)
  private readonly hexagonEditor = inject(CellEditor)
  public readonly hivesvc = inject(HiveService)
  public readonly captureManager = inject(ImageCaptureManager)
  private readonly modify = inject(MODIFY_COMB_SVC)
  public readonly persistence = inject(ImagePersistenceService)
  private hasInitializedFocus = false
  private readonly ps = inject(PointerState)

  // ─────────────────────────────────────────────
  // local state
  // ─────────────────────────────────────────────
  public get context(): CellEditContext | null {
    return this.es.context()
  }

  public get editCell(): Cell | null {
    return this.context?.cell ?? null
  }

  AiSearchPath = AiSearchPath
  BranchPath = BranchPath
  AlignMiddle = AlignMiddle

  public readonly isComponentReady = computed(() => !!this.es.cell())
  public readonly imagePrompt = computed(() => this.es.cell()?.name ?? '')
  public readonly isBranch = computed(() => this.es.cell()?.isBranch ?? false)
  public readonly canDrop = this.policy.none(
    POLICY.EditInProgress,
    POLICY.ViewingClipboard,
    POLICY.MovingTiles
  )

  public readonly operation = this.es.operation

  public readonly editorKind = computed(() => {
    switch (this.operation()) {
      case 'edit-hive': return 'Edit Hive';
      case 'edit-cell': return 'Edit Tile';
      case 'new-hive': return 'New Hive';
      case 'new-cell': return 'New Tile';
      default: return 'Edit';
    }
  })

  public get deleteText(): string {
    switch (this.operation()) {
      case 'edit-hive':
      case 'new-hive':
        return 'Delete Hive';
      case 'edit-cell':
      case 'new-cell':
        return 'Delete Tile';
      default:
        return 'Delete';
    }
  }

  public get deleteWarning(): string {
    switch (this.operation()) {
      case 'edit-hive':
      case 'new-hive':
        return 'Delete will remove hive and all sub-tiles permanently.';
      case 'edit-cell':
      case 'new-cell':
        return 'Delete will remove tile permanently.';
      default:
        return '';
    }
  }

  constructor() {
    super()

    effect(() => {
      const ctx = this.es.context()
      const seq = this.ps.downSeq()
      if (!ctx || seq === 0) return

      const e = this.ps.pointerDownEvent()
      if (!e) return

      // uncomment for right-click only:  
      if (e.button !== 2) return

      // invalidate the editor context; reactive cleanup handles the rest
      this.es.setContext?.(null) ?? this.es.clearContext?.()
    })

    effect(() => {
      const ctx = this.context

      if (ctx && !this.hasInitializedFocus && this.name) {
        this.hasInitializedFocus = true
        queueMicrotask(() => this.name.nativeElement.focus())
      }
    })

    document.addEventListener(Events.EscapeCancel, () => this.es.setContext(null))
  }

  // ─────────────────────────────────────────────
  // actions
  // ─────────────────────────────────────────────
  public cancel = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation()
    event.preventDefault()
    this.hexagonEditor.cancel()
  }

  public delete = async (cell: Cell): Promise<void> => {

    await this.modify.removeCell(cell)
    this.hexagonEditor.delete(cell)

    const hiveName = this.state.scout.name
    await this.hivesvc.moveHiveToHistory(hiveName);
  }

  // ─────────────────────────────────────────────
  // field updates
  // ─────────────────────────────────────────────
  public onCaptionChange = (value: string): void => {
    const context = this.context
    const cell = context?.cell
    if (!cell) return
    const updated = this.factory.update(cell, { name: value })
    context.setCell(updated)
  }

  public onLinkChange = (value: string): void => {
    const context = this.context
    const cell = context?.cell
    if (!cell) return
    const updated = this.factory.update(cell, { link: value })
    context.setCell(updated)
  }

  // ─────────────────────────────────────────────
  // save pipeline
  // ─────────────────────────────────────────────
  public save = async (event: any): Promise<void> => {
    const context = this.context!
    const cell = context.cell
    await Assets.unload(this.state.cacheId(cell))

    // capture and persist the working (small) snapshot
    if (context.imageDirty) {
      const snapshot = await this.captureManager.capture()
      await this.persistence.saveSmall(cell, snapshot)
    }

    // handle large image only if rules require
    if (context.modifiedLarge && context.imageDirty) {
      await this.persistence.saveLargeIfChanged(context.modifiedLarge)
    }

    await Assets.unload(this.state.cacheId(cell))
    await this.modify.updateCell(cell)

    // optional: handle navigation after save
    // if (this.operation() === 'new-hive') this.utility.changeLocation(cell.hive)
    this.hexagonEditor.complete()
  }

  public saveAsBranch = async (event: MouseEvent): Promise<void> => {
    const context = this.context!
    const cell = context.cell
    cell.options.update(o => o | CellOptions.Branch)
    await this.save(event)
  }

}
