import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-initial-cell',
  imports: [],
  templateUrl: './initial-cell.component.html',
  styleUrl: './initial-cell.component.scss'
})
export class InitialCellComponent {
  @Output() create = new EventEmitter<void>()

  startEditing() {
    this.create.emit()
  }
}
