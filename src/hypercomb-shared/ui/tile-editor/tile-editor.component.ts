// hypercomb-shared/ui/tile-editor/tile-editor.component.ts
// Tile editor with image manager, link, and border color fields.

import {
  Component,
  computed,
  ElementRef,
  ViewChild,
  type AfterViewInit,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { EffectBus, type I18nProvider, I18N_IOC_KEY } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'

import type { TileEditorService } from
  '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'
import type { ImageEditorService } from
  '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-editor.service'
import type { LinkSafetyService } from
  '@hypercomb/essentials/diamondcoreprocessor.com/safety/link-safety.service'

@Component({
  selector: 'hc-tile-editor',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './tile-editor.component.html',
  styleUrls: ['./tile-editor.component.scss'],
})
export class TileEditorComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('imageCanvas', { static: false }) imageCanvas!: ElementRef<HTMLDivElement>
  @ViewChild('cameraVideo', { static: false }) cameraVideo!: ElementRef<HTMLVideoElement>

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

  private readonly cell$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService?.cell ?? '',
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

  private readonly hideText$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService?.hideText ?? false,
  )

  public readonly open = computed(() => this.mode$() === 'editing')
  public readonly cell = computed(() => this.cell$())
  public readonly displayCell = computed(() => {
    const raw = this.cell$()
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    return i18n?.resolveCell?.(raw) ?? raw
  })
  public readonly hasImage = computed(() => this.hasImage$())
  public readonly hideText = computed(() => this.hideText$())

  // bound form values (updated on open, pushed on change)
  public linkValue = ''
  public linkDenied = false
  public linkWarned = false
  public linkSafetyReason = ''
  public borderColorValue = ''
  public backgroundColorValue = ''
  public isFlat = false
  public isLinked = true
  public cameraActive = false
  public cameraFlat = false
  #stream: MediaStream | null = null
  // track previous open state for init/teardown
  #wasOpen = false

  // ── open/close side effects (EventTarget listener, no inject) ──

  #onEditorChange = (): void => {
    const isOpen = this.editorService?.mode === 'editing'
    if (isOpen && !this.#wasOpen) {
      this.linkValue = this.editorService?.link ?? ''
      this.borderColorValue = this.editorService?.borderColor || '#c8975a'
      this.backgroundColorValue = this.editorService?.backgroundColor || '#1e1e1e'
      // ensure defaults are persisted in properties
      if (!this.editorService?.borderColor) this.editorService.setBorderColor(this.borderColorValue)
      if (!this.editorService?.backgroundColor) this.editorService.setBackgroundColor(this.backgroundColorValue)

      document.addEventListener('keydown', this.#onKeyDown)
      setTimeout(() => this.#initCanvas(), 0)
    }
    if (!isOpen && this.#wasOpen) {
      document.removeEventListener('keydown', this.#onKeyDown)
      if (this.cameraActive) this.closeCamera()
      this.linkValue = ''
      this.borderColorValue = ''
      this.backgroundColorValue = ''
    }
    this.#wasOpen = isOpen
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter') return
    // allow Enter inside text inputs for normal behavior — only save on bare Enter
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'TEXTAREA') return
    e.preventDefault()
    this.save()
  }

  // ── canvas initialization ──────────────────────────────────────

  #initCanvasRetries = 0

  async #initCanvas(): Promise<void> {
    const el = this.imageCanvas?.nativeElement
    if (!el) {
      if (this.#initCanvasRetries++ < 5) {
        setTimeout(() => this.#initCanvas(), 50)
      }
      return
    }
    this.#initCanvasRetries = 0

    const settings = get('@diamondcoreprocessor.com/Settings') as any
    const size = settings?.editorSize ?? 400

    await this.imageEditor.initialize(el, size)

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

  /** Safety-checked link update — runs on blur so we don't call LLM on every keystroke. */
  readonly onLinkBlur = (): void => {
    const value = this.linkValue.trim()

    // reset safety state
    this.linkDenied = false
    this.linkWarned = false
    this.linkSafetyReason = ''

    // empty link — clear it immediately
    if (!value) {
      this.editorService.setLink('')
      return
    }

    // run safety check (same service used by LinkDropWorker)
    const safety = get('@diamondcoreprocessor.com/LinkSafetyService') as LinkSafetyService | undefined
    if (!safety) {
      // no safety service loaded — allow directly
      this.editorService.setLink(value)
      return
    }

    void safety.check(value).then(verdict => {
      if (verdict.decision === 'deny') {
        this.linkDenied = true
        this.linkSafetyReason = verdict.reason
        this.editorService.setLink('')
        return
      }
      if (verdict.decision === 'warn') {
        this.linkWarned = true
        this.linkSafetyReason = verdict.reason
      }
      this.editorService.setLink(value)
    })
  }

  readonly onBorderColorChange = (value: string): void => {
    this.editorService.setBorderColor(value)
    this.imageEditor.setBorderColor(value)
  }

  readonly onBackgroundColorChange = (value: string): void => {
    this.editorService.setBackgroundColor(value)
    this.imageEditor.setBackgroundColor(value)
  }

  // ── link toggle ────────────────────────────────────────────────

  readonly toggleLink = (): void => {
    this.isLinked = !this.isLinked
    this.imageEditor.linked = this.isLinked
    // when re-linking, sync current transform to both orientations immediately
    if (this.isLinked) {
      const t = this.imageEditor.getTransform()
      this.editorService.updateTransform(t.x, t.y, t.scale, 'point-top')
      this.editorService.updateTransform(t.x, t.y, t.scale, 'flat-top')
    }
  }

  // ── orientation toggle ─────────────────────────────────────────

  readonly toggleOrientation = (): void => {
    // save current transform before switching
    const currentOrientation = this.imageEditor.orientation ?? 'point-top'
    const currentTransform = this.imageEditor.getTransform()
    this.editorService.updateTransform(
      currentTransform.x, currentTransform.y, currentTransform.scale, currentOrientation
    )

    // switch to the other orientation (canvas stays same size)
    const nextOrientation = currentOrientation === 'point-top' ? 'flat-top' as const : 'point-top' as const

    // when linked, keep same position; when unlinked, load saved transform
    let transform: { x: number; y: number; scale: number } | undefined
    if (!this.isLinked) {
      const props = this.editorService.properties as any
      const savedTransform = nextOrientation === 'flat-top'
        ? props?.flat?.large
        : props?.large
      transform = savedTransform
        ? { x: savedTransform.x ?? 0, y: savedTransform.y ?? 0, scale: savedTransform.scale ?? 1 }
        : undefined
    }

    this.isFlat = nextOrientation === 'flat-top'
    void this.imageEditor.setOrientation(nextOrientation, transform)
  }

  // ── camera ───────────────────────────────────────────────────

  readonly openCamera = async (): Promise<void> => {
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      this.cameraActive = true
      this.cameraFlat = this.isFlat
      setTimeout(() => {
        const video = this.cameraVideo?.nativeElement
        if (video) video.srcObject = this.#stream
      }, 0)
    } catch {
      // permission denied or no camera
    }
  }

  readonly capturePhoto = async (): Promise<void> => {
    const video = this.cameraVideo?.nativeElement
    if (!video || !video.videoWidth) return

    const size = Math.min(video.videoWidth, video.videoHeight)
    const sx = (video.videoWidth - size) / 2
    const sy = (video.videoHeight - size) / 2

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size)

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/webp', 0.9),
    )

    this.closeCamera()
    this.editorService.setLargeBlob(blob)
    await this.imageEditor.loadImage(blob)
  }

  readonly closeCamera = (): void => {
    this.#stream?.getTracks().forEach(t => t.stop())
    this.#stream = null
    this.cameraActive = false
  }

  readonly toggleCameraOrientation = (): void => {
    this.cameraFlat = !this.cameraFlat
  }

  // ── search ────────────────────────────────────────────────────

  readonly searchGoogle = (): void => {
    const q = this.cell()
    if (q) window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, '_blank')
  }

  readonly toggleHideText = (): void => {
    this.editorService.setHideText(!this.editorService.hideText)
  }

  // ── save / cancel ──────────────────────────────────────────────

  readonly save = (): void => {
    // Commit the current link input value in case blur hasn't fired yet
    // (e.g. user pastes a URL and clicks save directly)
    const link = this.linkValue?.trim()
    if (link !== undefined) {
      this.editorService.setLink(link ?? '')
    }
    this.editorDrone?.saveAndComplete?.()
  }

  readonly cancel = (): void => {
    this.editorDrone?.cancelEditing?.()
  }

  // ── lifecycle ──────────────────────────────────────────────────

  ngOnInit(): void {
    const target = get('@diamondcoreprocessor.com/TileEditorService') as EventTarget | undefined
    target?.addEventListener('change', this.#onEditorChange)
  }

  ngAfterViewInit(): void {
    // canvas init handled reactively via change listener
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.#onKeyDown)
    this.closeCamera()
    const target = get('@diamondcoreprocessor.com/TileEditorService') as EventTarget | undefined
    target?.removeEventListener('change', this.#onEditorChange)
    this.imageEditor?.destroy()
  }
}

// ── helpers ──────────────────────────────────────────────────

