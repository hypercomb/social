import { Component, input } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Intent } from '@hypercomb/core'
@Component({
  selector: 'app-intent-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './intent-viewer.component.html',
  styleUrls: ['./intent-viewer.component.scss']
})
export class IntentViewerComponent {
  public readonly intent = input.required<Intent>()
}
