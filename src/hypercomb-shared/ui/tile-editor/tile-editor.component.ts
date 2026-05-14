// hypercomb-shared/ui/tile-editor/tile-editor.component.ts
// Tile editor with image manager, link, and border color fields.

import {
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  inject,
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
import type { NotesService, Note } from
  '@hypercomb/essentials/diamondcoreprocessor.com/notes'

/** Q&A item view-model — pairs a `[Q]`-prefixed note with the
 *  matching `[A:<qId>]` answer note when one exists. The qId is the
 *  question note's `id`, used as the join key in the `[A:<qId>]`
 *  answer-note text format. */
type QaViewItem = {
  readonly qId: string
  readonly question: string
  readonly answer: string | null
}

// Match `[Q]`, `[Q v2]`, `[Q something]` at the start of a note —
// captures the rest of the line as the question text.
const Q_NOTE_RE = /^\[Q(?:\s+[^\]]*)?\]\s*([\s\S]+)$/
// Match `[A:<qId>] <answer>` — captures the qId and the answer text.
const A_NOTE_RE = /^\[A:([a-zA-Z0-9_-]+)\]\s*([\s\S]+)$/

@Component({
  selector: 'hc-tile-editor',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './tile-editor.component.html',
  styleUrls: ['./tile-editor.component.scss'],
})
export class TileEditorComponent implements OnInit, AfterViewInit, OnDestroy {

  readonly #cdr = inject(ChangeDetectorRef)

  @ViewChild('imageCanvas', { static: false }) imageCanvas!: ElementRef<HTMLDivElement>
  @ViewChild('cameraVideo', { static: false }) cameraVideo!: ElementRef<HTMLVideoElement>
  @ViewChild('cameraFallbackInput', { static: false }) cameraFallbackInput!: ElementRef<HTMLInputElement>
  @ViewChild('nameInput', { static: false }) nameInput!: ElementRef<HTMLInputElement>

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
  public nameValue = ''
  public linkValue = ''
  public linkDenied = false
  public linkWarned = false
  public linkSafetyReason = ''
  public borderColorValue = ''
  public backgroundColorValue = ''
  public isFlat = false
  public isLinked = true
  public cameraActive = false
  public hasMultipleCameras = false
  #stream: MediaStream | null = null
  #facingMode: 'environment' | 'user' = 'environment'
  // track previous open state for init/teardown
  #wasOpen = false

  // ── Q&A panel state ────────────────────────────────────────────
  // qaItems is the derived list of (question, answer) pairs for the
  // current cell, refreshed on open and after each answer submission.
  // qaAnswerDraft holds the in-flight typed text per question id.
  public qaItems: QaViewItem[] = []
  public qaAnswerDraft: Record<string, string> = {}

  // ── open/close side effects (EventTarget listener, no inject) ──

  #onEditorChange = (): void => {
    const isOpen = this.editorService?.mode === 'editing'
    if (isOpen && !this.#wasOpen) {
      this.#wasOpen = true  // guard before any setter calls that re-dispatch 'change'
      this.nameValue = this.editorService?.isNewCell ? '' : (this.editorService?.cell ?? '')
      this.linkValue = this.editorService?.link ?? ''
      this.borderColorValue = this.editorService?.borderColor || '#c8975a'
      this.backgroundColorValue = this.editorService?.backgroundColor || '#1e1e1e'
      // ensure defaults are persisted in properties
      if (!this.editorService?.borderColor) this.editorService.setBorderColor(this.borderColorValue)
      if (!this.editorService?.backgroundColor) this.editorService.setBackgroundColor(this.backgroundColorValue)

      document.addEventListener('keydown', this.#onKeyDown)
      if (this.editorService.autoCamera) {
        this.editorService.autoCamera = false
        void this.openCamera()
      }
      setTimeout(() => this.#initCanvas(), 0)

      // Refresh Q&A list for the opened cell. Notes are read
      // synchronously from NotesService — if the cache hasn't warmed
      // yet (first selection after page load), the list will be empty
      // and fill in after the next notes:changed.
      this.#refreshQaItems()
    }
    if (!isOpen && this.#wasOpen) {
      document.removeEventListener('keydown', this.#onKeyDown)
      if (this.cameraActive) this.closeCamera()
      this.nameValue = ''
      this.linkValue = ''
      this.borderColorValue = ''
      this.backgroundColorValue = ''
      this.qaItems = []
      this.qaAnswerDraft = {}
    }
    this.#wasOpen = isOpen
  }

  // ── Q&A panel logic ────────────────────────────────────────────

  /** Re-derive `qaItems` from the cell's current notes. Pairs each
   *  `[Q ...]`-prefixed note with the matching `[A:<qId>] ...`
   *  answer note (when present). Called on editor open and after
   *  every successful answer submission. */
  #refreshQaItems(): void {
    const notesService = get('@diamondcoreprocessor.com/NotesService') as NotesService | undefined
    const cell = this.editorService?.cell ?? ''
    if (!notesService || !cell) { this.qaItems = []; return }

    const notes: Note[] = notesService.notesFor(cell)
    const questions = new Map<string, string>()   // q-note id → question text
    const answers = new Map<string, string>()      // q-note id → answer text

    for (const note of notes) {
      const text = (note.text ?? '').trim()
      const q = Q_NOTE_RE.exec(text)
      if (q) {
        questions.set(note.id, q[1].trim())
        continue
      }
      const a = A_NOTE_RE.exec(text)
      if (a) {
        answers.set(a[1], a[2].trim())
      }
    }

    const items: QaViewItem[] = []
    for (const [qId, question] of questions) {
      items.push({ qId, question, answer: answers.get(qId) ?? null })
    }
    this.qaItems = items
  }

  /** Submit an inline answer for a Q&A item. Posts a note of the form
   *  `[A:<qId>] <text>` on the same cell — `notes:changed` will fire
   *  shortly after; we also refresh on a short delay so the panel
   *  reflects the new answer without a manual reload. */
  readonly submitAnswer = (qId: string): void => {
    const text = (this.qaAnswerDraft[qId] ?? '').trim()
    if (!text) return
    const cell = this.editorService?.cell ?? ''
    if (!cell) return
    EffectBus.emit('note:commit', { cellLabel: cell, text: `[A:${qId}] ${text}` })
    this.qaAnswerDraft[qId] = ''
    // Notes commit is async (resource put + layer cascade). Refresh on
    // a short delay so the new [A:…] note shows up in the panel.
    setTimeout(() => this.#refreshQaItems(), 300)
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

    if (service.autoCamera) {
      service.autoCamera = false
      void this.openCamera()
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
    this.#focusNameIfNew()
  }

  #focusNameIfNew(): void {
    if (!this.editorService?.isNewCell) return
    setTimeout(() => {
      const el = this.nameInput?.nativeElement
      if (el) { el.focus(); el.select() }
    }, 0)
  }

  // ── property changes ───────────────────────────────────────────

  readonly onNameBlur = (): void => {
    const normalized = normalizeName(this.nameValue)
    if (normalized) {
      this.nameValue = normalized
      if (normalized !== this.editorService?.cell) {
        this.editorService.setPendingName(normalized)
      }
    } else {
      this.nameValue = this.editorService?.cell ?? ''
    }
  }

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
    if (this.cameraActive || this.#stream) return
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraFallbackInput?.nativeElement?.click()
      return
    }
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this.#facingMode } },
      })
    } catch {
      this.cameraFallbackInput?.nativeElement?.click()
      return
    }
    this.cameraActive = true
    this.#cdr.detectChanges()
    const video = this.cameraVideo?.nativeElement
    if (video) {
      video.srcObject = this.#stream
      video.play().catch(() => {})
    }
    navigator.mediaDevices.enumerateDevices()
      .then(devices => { this.hasMultipleCameras = devices.filter(d => d.kind === 'videoinput').length > 1 })
      .catch(() => {})
  }

  readonly capturePhoto = async (): Promise<void> => {
    const video = this.cameraVideo?.nativeElement
    if (!video || !video.videoWidth) return

    const MAX_PHOTO_PX = 1024
    const rawSize = Math.min(video.videoWidth, video.videoHeight)
    const size = Math.min(rawSize, MAX_PHOTO_PX)
    const sx = (video.videoWidth - rawSize) / 2
    const sy = (video.videoHeight - rawSize) / 2

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) { this.closeCamera(); return }
    ctx.drawImage(video, sx, sy, rawSize, rawSize, 0, 0, size, size)

    const webp = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.9),
    )
    const blob = webp ?? await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
    )
    if (!blob) { this.closeCamera(); return }

    this.closeCamera()
    this.editorService.setLargeBlob(blob)
    await this.imageEditor.loadImage(blob)
    this.#focusNameIfNew()
  }

  readonly closeCamera = (): void => {
    this.#stream?.getTracks().forEach(t => t.stop())
    this.#stream = null
    this.cameraActive = false
    this.hasMultipleCameras = false
  }

  readonly switchCamera = async (): Promise<void> => {
    if (!this.#stream) return
    this.#stream.getTracks().forEach(t => t.stop())
    this.#stream = null
    this.#facingMode = this.#facingMode === 'environment' ? 'user' : 'environment'
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this.#facingMode } },
      })
      const video = this.cameraVideo?.nativeElement
      if (video) {
        video.srcObject = this.#stream
        video.play().catch(() => {})
      }
    } catch {
      this.cameraActive = false
    }
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
    // commit name if blur hasn't fired yet
    const normalized = normalizeName(this.nameValue)
    if (normalized && normalized !== this.editorService?.cell) {
      this.nameValue = normalized
      this.editorService.setPendingName(normalized)
    }
    // commit link if blur hasn't fired yet
    const link = this.linkValue?.trim()
    if (link !== undefined) {
      this.editorService.setLink(link ?? '')
    }
    this.editorDrone?.saveAndComplete?.()
  }

  readonly cancel = (): void => {
    void this.editorDrone?.cancelEditing?.()
  }

  // ── lifecycle ──────────────────────────────────────────────────

  #offNotesChanged: (() => void) | null = null

  ngOnInit(): void {
    const target = get('@diamondcoreprocessor.com/TileEditorService') as EventTarget | undefined
    target?.addEventListener('change', this.#onEditorChange)

    // Keep the Q&A panel in sync with notes changes — covers async
    // hydration on first open (warm cache wasn't ready yet), and
    // reflects newly-submitted answers without polling.
    const handler = (): void => {
      if (this.#wasOpen) this.#refreshQaItems()
    }
    const off = EffectBus.on('notes:changed', handler) as unknown
    this.#offNotesChanged = typeof off === 'function' ? off as () => void : null
  }

  ngAfterViewInit(): void {
    // canvas init handled reactively via change listener
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.#onKeyDown)
    this.closeCamera()
    const target = get('@diamondcoreprocessor.com/TileEditorService') as EventTarget | undefined
    target?.removeEventListener('change', this.#onEditorChange)
    this.#offNotesChanged?.()
    this.imageEditor?.destroy()
  }
}

// ── helpers ──────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}
