import { Component, EventEmitter, inject, Output } from '@angular/core'
import { HypercombData } from 'src/app/actions/hypercomb-data'
import { EditorService } from 'src/app/state/interactivity/editor-service'

@Component({
  standalone: true,
  selector: 'app-save-branch-button',
  templateUrl: './save-branch-button.component.html',
  styleUrls: ['./save-branch-button.component.scss']
})
export class SaveBranchButtonComponent extends HypercombData {
  private readonly es = inject(EditorService)

  public get isNewHive(): boolean { return this.es.isNewHive() }
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


