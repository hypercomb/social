// hypercomb-shared/ui/camera-capture/camera-capture.component.ts
//
// Shell-level fullscreen camera overlay. Triggered by `controls:camera-open`
// when no tile is selected. On shutter, closes the overlay and arms the
// captured image in the command-line chevron slot — the user then types a
// name and presses Enter to create a tile (`cell:attach-resource` pipeline).
//
// When a tile IS selected, this component ignores `controls:camera-open`
// and lets TileEditorDrone handle the retake-photo-for-existing-tile flow.

import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  ViewChild,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { armImageBlob } from
  '@hypercomb/essentials/diamondcoreprocessor.com/editor/arm-resource'

@Component({
  selector: 'hc-camera-capture',
  standalone: true,
  templateUrl: './camera-capture.component.html',
  styleUrls: ['./camera-capture.component.scss'],
})
export class CameraCaptureComponent implements OnInit, OnDestroy {

  readonly #cdr = inject(ChangeDetectorRef)

  @ViewChild('cameraVideo', { static: false }) cameraVideo!: ElementRef<HTMLVideoElement>
  @ViewChild('cameraFallbackInput', { static: false }) cameraFallbackInput!: ElementRef<HTMLInputElement>

  public cameraActive = false
  public hasMultipleCameras = false
  public isFlat = false
  #stream: MediaStream | null = null
  #facingMode: 'environment' | 'user' = 'environment'
  #cameraOpenUnsub: (() => void) | null = null

  ngOnInit(): void {
    this.isFlat = localStorage.getItem('hc:hex-orientation') === 'flat-top'

    const off = EffectBus.on('controls:camera-open', this.#onCameraOpen) as unknown
    this.#cameraOpenUnsub = typeof off === 'function' ? off as () => void : null

    document.addEventListener('keydown', this.#onKeyDown)
  }

  ngOnDestroy(): void {
    this.#cameraOpenUnsub?.()
    document.removeEventListener('keydown', this.#onKeyDown)
    this.closeCamera()
  }

  // ── trigger ──────────────────────────────────────────────────

  #onCameraOpen = (): void => {
    const selection = window.ioc.get<{ active: string | null }>('@diamondcoreprocessor.com/SelectionService')
    if (selection?.active) return  // tile-editor drone handles retake-on-selection
    void this.openCamera()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.cameraActive) return
    if (e.key === 'Escape') {
      e.preventDefault()
      this.closeCamera()
    }
  }

  // ── open / close ─────────────────────────────────────────────

  readonly openCamera = async (): Promise<void> => {
    if (this.cameraActive || this.#stream) return

    if (navigator.mediaDevices?.getUserMedia) {
      this.cameraActive = true
      this.#cdr.detectChanges()

      try {
        this.#stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: this.#facingMode } },
        })
        const video = this.cameraVideo?.nativeElement
        if (video) {
          video.srcObject = this.#stream
          video.play().catch(() => {})
        }
        navigator.mediaDevices.enumerateDevices()
          .then(devices => { this.hasMultipleCameras = devices.filter(d => d.kind === 'videoinput').length > 1 })
          .catch(() => {})
        return
      } catch {
        this.cameraActive = false
        this.#cdr.detectChanges()
      }
    }

    this.cameraFallbackInput?.nativeElement?.click()
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

  // ── shutter ──────────────────────────────────────────────────

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
    await this.#armAndRevealInput(blob)
  }

  // ── file-input fallback (iOS/permission denied) ──────────────

  readonly onFileSelect = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    input.value = ''
    const blob = new Blob([await file.arrayBuffer()], { type: file.type })
    await this.#armAndRevealInput(blob)
  }

  // ── arm + reveal command-line on mobile ──────────────────────

  async #armAndRevealInput(blob: Blob): Promise<void> {
    const isMobile = window.matchMedia('(max-width: 599px)').matches
    if (isMobile) {
      EffectBus.emit('mobile:input-visible', { visible: true, mobile: true })
    }
    await armImageBlob(blob, { type: 'image' })
  }
}
