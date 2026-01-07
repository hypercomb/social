import { Component } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { LayoutSidebarComponent } from './layout-sidebar/layout-sidebar.component'

@Component({
  standalone: true,
  imports: [LayoutSidebarComponent],
  selector: 'app-layout-designer',
  templateUrl: './layout-designer.component.html',
  styleUrls: ['./layout-designer.component.scss']
})
export class LayoutDesignerComponent {
  droppedItems: SafeHtml[] = []

  constructor(private sanitizer: DomSanitizer) { }

  onDragOver(event: DragEvent) {
    event.preventDefault() // Prevent default to allow drop
  }

  onDrop(event: DragEvent) {
    event.preventDefault()

    const svgContent = event.dataTransfer?.getData('text/plain')
    if (svgContent) {
      const sanitizedSvg = this.sanitizer.bypassSecurityTrustHtml(svgContent)
      this.droppedItems.push(sanitizedSvg)
    }
  }
}


