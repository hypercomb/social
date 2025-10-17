import { Component, computed, effect, ElementRef, inject, ViewChild } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatIconModule } from '@angular/material/icon'
import { Assets } from 'pixi.js'
import { AiSearchPath, AlignMiddle, BranchPath } from 'src/app/unsorted/path'
import { CellOptions, POLICY } from 'src/app/core/models/enumerations'
import { EditorActionsComponent } from './editor-actions/editor-actions.component'
import { SaveBranchButtonComponent } from './save-branch-button/save-branch-button.component'
import { SpaceContinuationDirective } from './space-continuation.directive'
import { SwatchPanelComponent } from './swatch-panel/swatch-panel.component'
import { TileImageComponent } from './tile-image/tile-image.component'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { HexagonEditManager } from 'src/app/unsorted/hexagons/hexagon-edit-manager'
import { ImageCaptureService } from 'src/app/unsorted/image-services/image-capture-service'
import { cacheId, isHive, isNewHive } from 'src/app/cells/models/cell-filters'
import { Cell, EditCell } from 'src/app/cells/cell'
import { Events } from 'src/app/helper/events/events'
import { ServiceBase } from 'src/app/core/mixins/abstraction/service-base'
import { CellFactory } from 'src/app/inversion-of-control/factory/cell-factory'
import { HIVE_HYDRATION, MODIFY_COMB_SVC } from 'src/app/shared/tokens/i-comb-service.token'
import { ImagePersistenceService } from './tile-image/image-persistence-service'
import { PointerState } from 'src/app/state/input/pointer-state'

export type EditorKind = 'new cell' | 'edit cell' | 'new hive' | 'edit hive'

@Component({
  standalone: true,
  selector: '[app-tile-editor]',
  templateUrl: './tile-editor.component.html',
  styleUrls: ['./tile-editor.component.scss'],
  imports: [
    FormsModule,
    MatIconModule,
    EditorActionsComponent,
    SaveBranchButtonComponent,
    SpaceContinuationDirective,
    SwatchPanelComponent,
    TileImageComponent
  ]
})
export class TileEditorComponent extends ServiceBase {
  @ViewChild('name') name!: ElementRef<HTMLInputElement>

  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────
  private readonly captureService = inject(ImageCaptureService)
  
  private readonly factory = inject(CellFactory)
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly modify = inject(MODIFY_COMB_SVC)

  public readonly es = inject(EditorService)
  public readonly persistence = inject(ImagePersistenceService)
  private readonly manager = inject(HexagonEditManager)

  private readonly ps = inject(PointerState)
  // ─────────────────────────────────────────────
  // local state
  // ─────────────────────────────────────────────
  public editCell: EditCell | null = null

  AiSearchPath = AiSearchPath
  BranchPath = BranchPath
  AlignMiddle = AlignMiddle

  public readonly isComponentReady = computed(() => !!this.es.context())
  public readonly imagePrompt = computed(() => this.es.context()?.name ?? '')
  public readonly isBranch = computed(() => this.es.context()?.isBranch ?? false)
  public readonly canDrop = this.policy.none(
    POLICY.EditInProgress,
    POLICY.ViewingClipboard,
    POLICY.MovingTiles
  )

  public readonly editorKind = computed<EditorKind>(() => {
    const cell = this.es.context()
    if (!cell) return 'new cell'
    if (isHive(cell)) return isNewHive(cell) ? 'new hive' : 'edit hive'
    return isNewHive(cell) ? 'new cell' : 'edit cell'
  })

  public get deleteText(): string {
    const cell = this.editCell
    if (!cell) return 'delete'
    return isHive(cell) ? 'delete hive' : 'delete'
  }

  constructor() {
    super()
    this.hydration.invalidate()

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

    // sync local editCell whenever editor context changes
    effect(() => {
      this.editCell = this.es.context()
      if (this.editCell && this.name) {
        queueMicrotask(() => {
          this.name.nativeElement.focus()
          this.name.nativeElement.select()
        })
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
    this.manager.cancel()
  }

  public delete = async (cell: Cell): Promise<void> => {
    await this.modify.removeCell(cell)
    this.manager.deleted(cell)
  }

  // ─────────────────────────────────────────────
  // field updates
  // ─────────────────────────────────────────────
  public onCaptionChange = (value: string): void => {
    if (!this.editCell) return
    const updated = this.factory.update(this.editCell, { name: value })
    this.es.setContext(updated)
  }

  public onLinkChange = (value: string): void => {
    if (!this.editCell) return
    const updated = this.factory.update(this.editCell, { link: value })
    this.es.setContext(updated)
  }

  // ─────────────────────────────────────────────
  // save pipeline
  // ─────────────────────────────────────────────
  public save = async (event: any): Promise<void> => {
    const cell = this.editCell!
    await Assets.unload(cacheId(cell))

    // capture and persist the working (small) snapshot
    if (!cell.image || cell.imageDirty) {
      const snapshot = await this.captureService.capture()
      await this.persistence.saveSmall(cell, snapshot)
    }

    // handle large image only if rules require
    if (cell.largeImage && cell.imageDirty) {
      await this.persistence.saveLargeIfChanged(cell, cell.largeImage)
    }

    await Assets.unload(cacheId(cell))
    await this.modify.updateCell(cell)

    // optional: handle navigation after save
    // if (newHive) this.utility.changeLocation(cell.hive)
    this.manager.complete()
  }

  public saveAsBranch = async (event: MouseEvent): Promise<void> => {
    const cell = this.editCell!
    cell.options.update(o => o | CellOptions.Branch)
    await this.save(event)
  }

}
