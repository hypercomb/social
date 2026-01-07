import { Component, Input } from '@angular/core'

@Component({
  standalone: true,
  selector: 'app-json-viewer',
  templateUrl: './json-viewer.component.html',
  styleUrls: ['./json-viewer.component.scss']
})
export class JsonViewerComponent {
  @Input() jsonData: any
}


