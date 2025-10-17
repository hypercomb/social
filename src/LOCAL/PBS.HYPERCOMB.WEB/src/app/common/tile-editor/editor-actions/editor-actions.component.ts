// angular first
import { Component, inject } from '@angular/core'
import { Searcservice } from 'src/app/database/utility/search-service'
import { CellOptions, HypercombMode } from 'src/app/core/models/enumerations'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { ColorPicker } from 'src/app/unsorted/utility/color-picker'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'

@Component({
  standalone: true,
  selector: 'app-editor-actions',
  templateUrl: './editor-actions.component.html',
  styleUrls: ['./editor-actions.component.scss']
})
export class EditorActionsComponent extends Hypercomb {
  public readonly es = inject(EditorService)
  private readonly colorPicker = inject(ColorPicker)
  private readonly searcservice = inject(Searcservice)

  // actions (async arrow style per your preference)
  public googleImageSearch = async () => {
    // search by current name
    this.searcservice.searchImage(this.es.context()!.name)
  }

  public chooseColor = async () => {
    // pick color then update visual
    const color = await this.colorPicker.pickColor()
    const cell = this.es.context()!
    cell.backgroundColor = color
    await this.es.updateBackgroundVisual(cell)
    // if you later trim blobs here, keep it reactive and off the hot path
  }

  public aiLookup = async () => {
    // toggle ai prompt tool
    this.state.toggleToolMode(HypercombMode.AiPrompt)
  }

  public toggleBranch = async () => {
    // flip branch flag and update
    const cell = this.es.context()!
    cell.options.update((options) => options ^ CellOptions.Branch)
    await this.es.updateBranchVisual(cell)
  }
}


