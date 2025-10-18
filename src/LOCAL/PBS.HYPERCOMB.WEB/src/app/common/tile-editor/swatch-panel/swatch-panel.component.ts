import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, effect, inject, signal } from '@angular/core'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { PointerState } from 'src/app/state/input/pointer-state'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { fromEvent, Subscription } from 'rxjs'

@Component({
  standalone: true,
  selector: '[app-swatch-panel]',
  templateUrl: './swatch-panel.component.html',
  styleUrls: ['./swatch-panel.component.scss']
})
export class SwatchPanelComponent extends Hypercomb implements AfterViewInit, OnDestroy {
  @ViewChild('colorPalette', { static: true }) colorPalette!: ElementRef<HTMLImageElement>
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>

  public readonly es = inject(EditorService)
  public readonly ps = inject(PointerState)
  private lastColor: string | null = null
  private selectedColor: string | null = null
  private subs: Subscription[] = []

  constructor() {
    super()

    // reapply visual when signal changes
    effect(() => {
      const cell = this.es.context()
      const colorTile = this.es.borderColorTile()
      if (cell && colorTile) this.es.updateBorderVisual(cell)
    })
  }

  ngAfterViewInit(): void {
    const img = this.colorPalette.nativeElement
    img.onload = () => this.drawImageOnCanvas()

    // attach events directly to the image element
    this.subs.push(
      fromEvent<PointerEvent>(img, 'pointermove').subscribe(e => this.onPointerMove(e)),
      fromEvent<PointerEvent>(img, 'pointerdown').subscribe(e => this.onPointerDown(e)),
      fromEvent<PointerEvent>(img, 'pointerleave').subscribe(e => this.onPointerLeave(e))
    )
  }

  private drawImageOnCanvas(): void {
    const img = this.colorPalette.nativeElement
    const canvas = this.canvas.nativeElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight)
  }

  private getColorFromPointer(event: PointerEvent): string | undefined {
    const img = this.colorPalette.nativeElement
    const canvas = this.canvas.nativeElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = img.getBoundingClientRect()
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height

    const x = Math.max(0, Math.min((event.clientX - rect.left) * scaleX, canvas.width - 1))
    const y = Math.max(0, Math.min((event.clientY - rect.top) * scaleY, canvas.height - 1))

    const [r, g, b, a] = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
    if (a === 0) return
    return this.rgbToHex(r, g, b)
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`
  }

  private onPointerMove(event: PointerEvent): void {
    const color = this.getColorFromPointer(event) || null
    if (color !== this.lastColor) {
      this.lastColor = color
      const cell = this.es.context()
      if (cell) {
        cell.borderColor = color || 'transparent'
        this.es.updateBorderVisual(cell)
      }
    }
  }

  private onPointerDown(event: PointerEvent): void {
    const color = this.getColorFromPointer(event) || null
    this.selectedColor = color
  }

  private onPointerLeave(event: PointerEvent): void {
    const cell = this.es.context()
    if (!cell) return
    cell.borderColor = this.selectedColor || cell.borderColor
    this.es.updateBorderVisual(cell)
  }

  ngOnDestroy(): void {
    for (const s of this.subs) s.unsubscribe()
  }
}
