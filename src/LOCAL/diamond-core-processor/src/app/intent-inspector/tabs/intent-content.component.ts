import { Component, input } from '@angular/core'
import { Intent } from '@hypercomb/core'

@Component({
  selector: 'hc-intent-content',
  standalone: true,
  styleUrls: ['./intent-shared.scss'],
  templateUrl: './intent-content.component.html'
})
export class IntentContentComponent {
  public readonly intent = input.required<Intent>()
}
