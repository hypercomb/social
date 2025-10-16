import { Component, EventEmitter, inject, Input, Output } from '@angular/core'
import { DataServiceBase } from 'src/app/actions/service-base-classes'
import { Cell } from 'src/app/cells/cell'
import { isNew, isNewHive } from 'src/app/cells/models/cell-filters'
import { EditorService } from 'src/app/state/interactivity/editor-service'

@Component({
  standalone: true,
  selector: 'app-save-branch-button',
  templateUrl: './save-branch-button.component.html',
  styleUrls: ['./save-branch-button.component.scss']
})
export class SaveBranchButtonComponent extends DataServiceBase {
  private readonly es = inject(EditorService)

  public get isNewHive(): boolean { return  this.es.isNewHive() }
  public get saveName(): string { return this.isNewHive ? 'hive' : 'tile' }

  @Output('save-clicked') saveClicked = new EventEmitter<MouseEvent>()
  @Output('save-as-branch-clicked') saveAsBranchClicked = new EventEmitter<MouseEvent>()

  onSaveClicked(event: MouseEvent) {
    this.saveClicked.emit(event)
  }

  onSaveAsBranchClicked(event: MouseEvent) {
    this.saveAsBranchClicked.emit(event)
  }
}


