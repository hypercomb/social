import { Component } from '@angular/core';
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base';
import { HypercombMode } from 'src/app/core/models/enumerations';

@Component({
  standalone: true,
  selector: 'app-empty-honeycomb',
  imports: [],
  templateUrl: './empty-honeycomb.component.html',
  styleUrl: './empty-honeycomb.component.scss'
})
export class EmptyHoneycombComponent extends Hypercomb {
  
public EditMode: HypercombMode = HypercombMode.EditMode
public setEditMode = () => {
    this.state.setMode(this.EditMode)
  }
}
