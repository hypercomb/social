// hypercomb-shared/ui/tile-editor/tile-editor.component.ts
// Tile editor with image manager, link, and border color fields.

import {
  Component,
  computed,
  effect,
  ElementRef,
  ViewChild,
  type AfterViewInit,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { fromRuntime } from '../../core/from-runtime'

import type { TileEditorService } from
  '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'
import type { ImageEditorService } from
  '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-editor.service'

@Component({
  selector: 'hc-tile-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './tile-editor.component.html',
  styleUrls: ['./tile-editor.component.scss'],
})
export class TileEditorComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('imageCanvas', { static: false }) imageCanvas!: ElementRef<HTMLDivElement>

  private get editorService(): TileEditorService {
    return get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
  }

  private get editorDrone(): any {
    return get('@diamondcoreprocessor.com/TileEditorDrone')
  }

  private get imageEditor(): ImageEditorService {
    return get('@diamondcoreprocessor.com/ImageEditorService') as ImageEditorService
  }

  // ── reactive state ─────────────────────────────────────────────

  private readonly mode$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService?.mode ?? 'idle',
  )

  private readonly seed$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService?.seed ?? '',
  )

  private readonly link$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService?.link ?? '',
  )

  private readonly borderColor$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService?.borderColor ?? '',
  )

  private readonly backgroundColor$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService?.backgroundColor ?? '',
  )

  private readonly hasImage$ = fromRuntime(
    get('@diamondcoreprocessor.com/ImageEditorService') as EventTarget,
    () => this.imageEditor?.hasImage ?? false,
  )

  public readonly open = computed(() => this.mode$() === 'editing')
  public readonly seed = computed(() => this.seed$())
  public readonly hasImage = computed(() => this.hasImage$())

  // bound form values (updated on open, pushed on change)
  public linkValue = ''
  public borderColorValue = ''
  public backgroundColorValue = ''
  // track previous open state for init/teardown
  #wasOpen = false

  constructor() {
    effect(() => {
      const isOpen = this.open()
      if (isOpen && !this.#wasOpen) {
        this.linkValue = this.link$()
        this.borderColorValue = this.borderColor$()
        this.backgroundColorValue = this.backgroundColor$()

        queueMicrotask(() => this.#initCanvas())
      }
      if (!isOpen && this.#wasOpen) {
        this.linkValue = ''
        this.borderColorValue = ''
        this.backgroundColorValue = ''
      }
      this.#wasOpen = isOpen
    })
  }

  // ── canvas initialization ──────────────────────────────────────

  async #initCanvas(): Promise<void> {
    const el = this.imageCanvas?.nativeElement
    if (!el) return

    const settings = get('@diamondcoreprocessor.com/Settings') as any
    const width = settings?.width ?? 346
    const height = settings?.height ?? 400

    await this.imageEditor.initialize(el, width, height)

    // set initial colors
    this.imageEditor.setBorderColor(this.borderColorValue)
    this.imageEditor.setBackgroundColor(this.backgroundColorValue)

    // if there's a large blob, load it
    const service = this.editorService
    if (service.largeBlob) {
      const transform = (service.properties as any).large
      await this.imageEditor.loadImage(
        service.largeBlob,
        transform ? { x: transform.x ?? 0, y: transform.y ?? 0, scale: transform.scale ?? 1 } : undefined,
      )
    }
  }

  // ── image upload ───────────────────────────────────────────────

  readonly onImageDrop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const file = event.dataTransfer?.files?.[0]
    if (file && file.type.startsWith('image/')) {
      void this.#loadImageFile(file)
    }
  }

  readonly onDragOver = (event: DragEvent): void => {
    event.preventDefault()
  }

  readonly onFileSelect = (event: Event): void => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      void this.#loadImageFile(file)
      input.value = '' // reset so same file can be re-selected
    }
  }

  async #loadImageFile(file: File): Promise<void> {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type })
    this.editorService.setLargeBlob(blob)
    await this.imageEditor.loadImage(blob)
  }

  // ── property changes ───────────────────────────────────────────

  readonly onLinkChange = (value: string): void => {
    this.editorService.setLink(value)
  }

  readonly onBorderColorChange = (value: string): void => {
    this.editorService.setBorderColor(value)
    this.imageEditor.setBorderColor(value)
  }

  readonly onBackgroundColorChange = (value: string): void => {
    this.editorService.setBackgroundColor(value)
    this.imageEditor.setBackgroundColor(value)
  }

  // ── save / cancel ──────────────────────────────────────────────

  readonly save = (): void => {
    this.editorDrone?.saveAndComplete?.()
  }

  readonly cancel = (): void => {
    this.editorDrone?.cancelEditing?.()
  }

  // ── keyboard ───────────────────────────────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      this.cancel()
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────

  ngOnInit(): void {
    window.addEventListener('keydown', this.#onKeyDown)
  }

  ngAfterViewInit(): void {
    // canvas init handled reactively via effect
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.#onKeyDown)
    this.imageEditor?.destroy()
  }
}
