import { Component } from '@angular/core'
import { IntentInspectorComponent } from './intent-inspector/intent-inspector.component'

import { PORTAL_OPEN_INTENT, SAMPLE_CODE } from '@hypercomb/core'


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IntentInspectorComponent],
  template: `
    <app-intent-inspector
      [intent]="intent"
      [code]="code">
    </app-intent-inspector>
  `
})
export class App {
  public readonly intent = PORTAL_OPEN_INTENT
  public readonly code = SAMPLE_CODE
}
