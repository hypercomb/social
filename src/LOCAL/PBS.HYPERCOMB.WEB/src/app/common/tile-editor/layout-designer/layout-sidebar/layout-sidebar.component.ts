import { Component, OnInit } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { SvgFormatter } from 'src/app/helper/image-services/svg-formatter'
import { SvgContents } from './svg-contents'

interface SvgItem {
  name: string
  svgPath: string
  resizedSvg?: SafeHtml // SafeHtml to hold the sanitized SVG content
}

@Component({
  standalone: true,
  selector: 'app-layout-sidebar',
  templateUrl: './layout-sidebar.component.html',
  styleUrls: ['./layout-sidebar.component.scss']
})
export class LayoutSidebarComponent implements OnInit {
  items: SvgItem[] = SvgContents
  filteredItems: SvgItem[] = [...this.items]

  constructor(
    private svgFormatter: SvgFormatter,
    private sanitizer: DomSanitizer
  ) { }

  ngOnInit() {
    this.loadAndResizeSVGs()
  }

  filterItems(event: any) {
    const searchTerm = event.target.value.toLowerCase()
    this.filteredItems = this.items.filter(item =>
      item.name.toLowerCase().includes(searchTerm)
    )
  }

  async loadAndResizeSVGs() {
    for (const item of this.items) {
      try {
        const response = await fetch(item.svgPath)
        if (!response.ok) {
          console.error(`Failed to fetch ${item.svgPath}: ${response.statusText}`)
          continue
        }
        const svgText = await response.text()
        const resizedSvg = this.svgFormatter.resizeAndCenterSVG(svgText, 100, 100)
        item.resizedSvg = this.sanitizer.bypassSecurityTrustHtml(resizedSvg)
      } catch (error) {
        console.error(`Error processing ${item.svgPath}:`, error)
        // Skip this item if there's an error
        continue
      }
    }
  }

  onDragStart(event: DragEvent, item: SvgItem) {
    const sanitizedSvg = item.resizedSvg?.toString() || ''
    event.dataTransfer?.setData('text/plain', sanitizedSvg)
  }
}


