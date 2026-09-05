// hypercomb-shared/ui/camera-capture/camera-capture.component.ts
//
// STANDALONE camera. The mobile bar's centre button is the shutter: take a
// picture, get a tile. It opens this full-screen viewfinder, and the frame it
// captures goes straight into the image router that already backs pasting an
// image — a new cell is created at the current location and the tile editor
// opens on it with the photo loaded, so framing and naming happen where they
// always have.
//
// The in-editor camera (tile-editor) stays what it is: replace the image of a
// tile you are already editing. This one is the other direction — no tile yet.
//
// Registry-fed surface (registerShellSurface), never an <hc-*> tag in app.html.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, ElementRef, ViewChild, signal, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

const OWNER = '@hypercomb.shared/CameraCaptureComponent'

/** Longest edge of the stored frame. A phone sensor hands back 3–4k pixels of
 *  square crop; the tile never renders anywhere near that, and the bytes are
 *  content-addressed forever. Cap on the way in, not on the way out. */
const MAX_PHOTO_PX = 1024

type ImageRouter = { createTileFromImage?: (blob: Blob) => Promise<void> }
type ModeRegistry = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

@Component({
  selector: 'hc-camera-capture',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './camera-capture.component.html',
  styleUrls: ['./camera-capture.component.scss'],
})
export class CameraCaptureComponent implements OnInit, OnDestroy {

  @ViewChild('video', { static: false }) videoRef?: ElementRef<HTMLVideoElement>

  readonly active = signal(false)
  readonly busy = signal(false)
  /** 'environment' (rear) first — the reason to point a phone at something is
   *  usually the thing in front of it, not your face. */
  readonly facing = signal<'environment' | 'user'>('environment')

  #stream: MediaStream | null = null
  #unsub: (() => void) | null = null

  ngOnInit(): void {
    this.#unsub = EffectBus.on('camera:capture-open', () => { void this.open() })
    document.addEventListener('keydown', this.#onKeyDown)
  }

  ngOnDestroy(): void {
    this.#unsub?.()
    document.removeEventListener('keydown', this.#onKeyDown)
    this.close()
  }

  readonly open = async (): Promise<void> => {
    if (this.active()) return
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing() } })
    } catch {
      EffectBus.emit('toast:show', { type: 'error', title: 'camera', message: 'No camera available (or permission was denied).' })
      return
    }
    this.active.set(true)
    get<ModeRegistry>('@diamondcoreprocessor.com/ModeRegistry')?.enter('view:active', OWNER)
    this.#bindStream()
  }

  readonly close = (): void => {
    this.#stream?.getTracks().forEach(t => t.stop())
    this.#stream = null
    this.busy.set(false)
    if (!this.active()) return
    this.active.set(false)
    get<ModeRegistry>('@diamondcoreprocessor.com/ModeRegistry')?.exit('view:active', OWNER)
  }

  /** Front ↔ rear. Tears the stream down and re-opens on the other lens. */
  readonly flip = async (): Promise<void> => {
    this.facing.update(f => (f === 'environment' ? 'user' : 'environment'))
    this.#stream?.getTracks().forEach(t => t.stop())
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing() } })
    } catch {
      this.close()
      return
    }
    this.#bindStream()
  }

  /** Shutter. Centre-square crop (a tile is a hexagon — a square source is the
   *  frame that survives either orientation), capped, WebP, then handed to the
   *  router which creates the cell and opens the editor on it. */
  readonly shoot = async (): Promise<void> => {
    const video = this.videoRef?.nativeElement
    if (!video || !video.videoWidth || this.busy()) return
    this.busy.set(true)

    const source = Math.min(video.videoWidth, video.videoHeight)
    const sx = (video.videoWidth - source) / 2
    const sy = (video.videoHeight - source) / 2
    const size = Math.min(source, MAX_PHOTO_PX)

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) { this.busy.set(false); return }
    ctx.drawImage(video, sx, sy, source, source, 0, 0, size, size)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/webp', 0.9),
    )

    // Stop the camera BEFORE the editor opens — the viewfinder has done its
    // job, and a live stream left running behind a modal is a battery leak.
    this.close()
    if (!blob) return

    const router = get<ImageRouter>('@diamondcoreprocessor.com/ImagePasteWorker')
    if (!router?.createTileFromImage) {
      EffectBus.emit('toast:show', { type: 'error', title: 'camera', message: 'The image router is not loaded — the photo could not be placed.' })
      return
    }
    await router.createTileFromImage(blob)
  }

  #bindStream(): void {
    // The <video> only exists once `active` has rendered it.
    setTimeout(() => {
      const video = this.videoRef?.nativeElement
      if (video) video.srcObject = this.#stream
    }, 0)
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active()) return
    if (e.key === 'Escape') { e.preventDefault(); this.close() }
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts). Above the tile editor's 220:
// the viewfinder is what the editor opens FROM.
registerShellSurface({
  name: 'hc-camera-capture',
  owner: OWNER,
  component: CameraCaptureComponent,
  order: 225,
})
