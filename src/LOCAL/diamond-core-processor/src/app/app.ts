import { Component } from '@angular/core'
import { IntentInspectorComponent } from './intent-inspector/intent-inspector.component'

import { PORTAL_OPEN_INTENT, SAMPLE_CODE } from '@hypercomb/core'
import { IntentInspectorProComponent } from "./intent-inspector/intent-inspector-pro.component";


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IntentInspectorProComponent],
  template: `
    <app-intent-inspector-pro
      [intent]="intent"
      [code]="code">
    </app-intent-inspector-pro>
  `
})
export class App {
  public readonly intent = PORTAL_OPEN_INTENT
  public readonly code = SAMPLE_CODE
}
