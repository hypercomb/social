import { Component, ElementRef, HostListener, ViewChild } from '@angular/core'
import { CoordinateDetector } from 'src/app/services/detection/tile-detector'
import { Tile } from 'src/app/cells/models/tile'

@Component({
  standalone: true,
  selector: '[app-draggable-text-area]', // SUSPECT NOT USED
  templateUrl: './draggable-text-area.component.html',
  styleUrls: ['./draggable-text-area.component.scss']
})
export class DraggableTextAreaComponent {
  @ViewChild('draggableDiv') draggableDiv!: ElementRef

  private isDragging = false
  private offsetX = 0
  private offsetY = 0
  public name: string = 'Hypercomb'
  activeTile: Tile | undefined

  constructor(tileDetector: CoordinateDetector) {
    tileDetector.tileDetected$.subscribe((payload) => {
      this.activeCell = payload?.activeCell
    })
  }

  @HostListener('document:mouseup')
  onMouseUp() {
    this.isDragging = false
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.isDragging) {
      const newX = event.clientX - this.offsetX
      const newY = event.clientY - this.offsetY
      this.draggableDiv.nativeElement.style.left = `${newX}px`
      this.draggableDiv.nativeElement.style.top = `${newY}px`
    }
  }

  onMouseDown(event: MouseEvent) {
    this.isDragging = true
    this.offsetX = event.clientX - this.draggableDiv.nativeElement.offsetLeft
    this.offsetY = event.clientY - this.draggableDiv.nativeElement.offsetTop
  }
}


