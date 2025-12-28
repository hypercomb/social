// src/app/intent-inspector/tabs/intent-code.component.ts
import { Component, input } from '@angular/core'
import { Intent } from '@hypercomb/core'
import { CodeViewerComponent } from '../../code-viewer/code-viewer.component'

@Component({
  selector: 'hc-intent-code',
  standalone: true,
  imports: [CodeViewerComponent],
  styleUrls: ['./intent-shared.scss'],
  templateUrl: './intent-code.component.html'
})
export class IntentCodeComponent {
  public readonly code = input.required<string>()
  public readonly intent = input.required<Intent>()
}
