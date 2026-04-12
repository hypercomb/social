// audio-player.component.ts — classy minimal audio player
//
// Wraps an <audio> element with a pill-shaped control group:
// play/pause button, elapsed time, draggable scrub bar with
// buffered indicator, and total duration. Keyboard support:
// Space toggles playback, ArrowLeft/Right seek by 5 seconds.

import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  signal,
} from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe.js'

@Component({
  selector: 'hc-audio-player',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './audio-player.component.html',
  styleUrls: ['./audio-player.component.scss'],
})
export class AudioPlayerComponent implements AfterViewInit, OnDestroy {
  @Input() src = ''
  @Input() autoplay = false
  @Input() ariaLabel = 'audio player'

  @Output() ended = new EventEmitter<void>()

  @ViewChild('audio', { static: true }) audioRef!: ElementRef<HTMLAudioElement>

  readonly playing = signal(false)
  readonly currentTime = signal(0)
  readonly duration = signal(0)
  readonly buffered = signal(0)
  readonly dragging = signal(false)

  readonly progressPercent = computed(() => {
    const d = this.duration()
    return d > 0 ? (this.currentTime() / d) * 100 : 0
  })

  readonly bufferedPercent = computed(() => {
    const d = this.duration()
    return d > 0 ? (this.buffered() / d) * 100 : 0
  })

  #gestureHandler: (() => void) | null = null
  #viewReady = false

  ngAfterViewInit(): void {
    this.#viewReady = true
    const audio = this.audioRef.nativeElement
    audio.addEventListener('loadedmetadata', this.#onMetadata)
    audio.addEventListener('durationchange', this.#onMetadata)
    audio.addEventListener('progress', this.#onProgress)
    audio.addEventListener('play', this.#onPlay)
    audio.addEventListener('pause', this.#onPause)
    audio.addEventListener('ended', this.#onEnded)
    audio.addEventListener('timeupdate', this.#onTimeUpdate)

    if (this.autoplay) void this.#attemptPlayWithGestureFallback()
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.#viewReady || !changes['src']) return

    const audio = this.audioRef.nativeElement
    this.#removeGestureFallback()
    audio.pause()
    audio.load()
    this.playing.set(false)
    this.currentTime.set(0)
    this.duration.set(0)
    this.buffered.set(0)

    if (this.autoplay && this.src) void this.#attemptPlayWithGestureFallback()
  }

  ngOnDestroy(): void {
    const audio = this.audioRef?.nativeElement
    if (!audio) return
    audio.removeEventListener('loadedmetadata', this.#onMetadata)
    audio.removeEventListener('durationchange', this.#onMetadata)
    audio.removeEventListener('progress', this.#onProgress)
    audio.removeEventListener('play', this.#onPlay)
    audio.removeEventListener('pause', this.#onPause)
    audio.removeEventListener('ended', this.#onEnded)
    audio.removeEventListener('timeupdate', this.#onTimeUpdate)
    this.#removeGestureFallback()
  }

  // ── public API ──────────────────────────────────────────

  play(): Promise<void> {
    return this.audioRef.nativeElement.play().catch(() => {})
  }

  pause(): void {
    this.audioRef.nativeElement.pause()
  }

  reset(): void {
    const audio = this.audioRef.nativeElement
    audio.pause()
    audio.currentTime = 0
    this.currentTime.set(0)
  }

  togglePlay = (): void => {
    const audio = this.audioRef.nativeElement
    if (audio.paused) void this.play()
    else audio.pause()
  }

  skip(seconds: number): void {
    const audio = this.audioRef.nativeElement
    const next = Math.max(0, Math.min(this.duration() || audio.duration || 0, audio.currentTime + seconds))
    audio.currentTime = next
    this.currentTime.set(next)
  }

  formatTime(seconds: number): string {
    const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
    const minutes = Math.floor(s / 60)
    const secs = Math.floor(s % 60)
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  // ── scrub interaction ───────────────────────────────────

  onScrubPointerDown(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    this.dragging.set(true)
    this.#seekFromEvent(event, target)
  }

  onScrubPointerMove(event: PointerEvent): void {
    if (!this.dragging()) return
    this.#seekFromEvent(event, event.currentTarget as HTMLElement)
  }

  onScrubPointerUp(event: PointerEvent): void {
    if (!this.dragging()) return
    const target = event.currentTarget as HTMLElement
    try { target.releasePointerCapture(event.pointerId) } catch {}
    this.#seekFromEvent(event, target)
    this.dragging.set(false)
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      this.togglePlay()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      this.skip(-5)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      this.skip(5)
    }
  }

  // ── internals ───────────────────────────────────────────

  #seekFromEvent(event: PointerEvent, track: HTMLElement): void {
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const next = ratio * this.duration()
    this.currentTime.set(next)
    this.audioRef.nativeElement.currentTime = next
  }

  #onMetadata = (): void => {
    const d = this.audioRef.nativeElement.duration
    if (Number.isFinite(d)) this.duration.set(d)
  }

  #onProgress = (): void => {
    const audio = this.audioRef.nativeElement
    if (audio.buffered.length > 0) {
      this.buffered.set(audio.buffered.end(audio.buffered.length - 1))
    }
  }

  #onPlay = (): void => { this.playing.set(true) }
  #onPause = (): void => { this.playing.set(false) }

  #onEnded = (): void => {
    this.playing.set(false)
    this.ended.emit()
  }

  #onTimeUpdate = (): void => {
    if (!this.dragging()) {
      this.currentTime.set(this.audioRef.nativeElement.currentTime)
    }
  }

  async #attemptPlayWithGestureFallback(): Promise<void> {
    // Attach the gesture fallback BEFORE attempting autoplay, so a user tap
    // during the brief window where play() is still resolving/rejecting is
    // not lost. On mobile, play() rejects asynchronously; without this the
    // first tap can slip through before the listener is registered.
    this.#gestureHandler = (): void => {
      void this.audioRef.nativeElement.play().catch(() => {})
      this.#removeGestureFallback()
    }
    window.addEventListener('pointerdown', this.#gestureHandler, { once: true })
    window.addEventListener('keydown', this.#gestureHandler, { once: true })

    try {
      await this.audioRef.nativeElement.play()
      // Autoplay succeeded (desktop) — no gesture needed.
      this.#removeGestureFallback()
    } catch {
      // Autoplay blocked (mobile) — gesture fallback remains armed.
    }
  }

  #removeGestureFallback(): void {
    if (!this.#gestureHandler) return
    window.removeEventListener('pointerdown', this.#gestureHandler)
    window.removeEventListener('keydown', this.#gestureHandler)
    this.#gestureHandler = null
  }
}
