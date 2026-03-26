// youtube-viewer.component.ts — full-screen YouTube embed overlay
//
// Listens for `viewer:open` effect with kind 'youtube'.
// Shows an iframe embed with autoplay. Click backdrop or press Escape to close.
// When open, fades away all chrome (header, controls) and hides the cursor.
// Click the backdrop to reveal chrome; it auto-hides again after a timeout.

import { Component, HostListener, signal } from '@angular/core'
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser'
import { EffectBus } from '@hypercomb/core'
import { parseYouTubeVideoId } from '@hypercomb/essentials/diamondcoreprocessor.com/link/youtube'

type ViewerOpenPayload = { kind: string; url: string; label?: string }

const CHROME_HIDE_DELAY = 3000

// Injected once into <head> — survives Angular's CSS purge
const VIEWER_STYLE_ID = 'hc-viewer-chrome-style'
function ensureViewerStyle(): void {
  if (document.getElementById(VIEWER_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = VIEWER_STYLE_ID
  style.textContent = `
    .header-bar, hc-controls-bar { transition: opacity 0.5s ease; }
    body.viewer-active .header-bar,
    body.viewer-active hc-controls-bar { opacity: 0; pointer-events: none; }
    body.viewer-open #pixi-host { visibility: hidden; }
  `
  document.head.appendChild(style)
}

@Component({
  selector: 'hc-youtube-viewer',
  standalone: true,
  templateUrl: './youtube-viewer.component.html',
  styleUrls: ['./youtube-viewer.component.scss'],
})
export class YoutubeViewerComponent {
  readonly embedUrl = signal<SafeResourceUrl | null>(null)
  readonly chromeVisible = signal(true)

  #unsub: (() => void) | null = null
  #chromeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private sanitizer: DomSanitizer) {
    ensureViewerStyle()

    this.#unsub = EffectBus.on<ViewerOpenPayload>('viewer:open', (payload) => {
      if (payload.kind !== 'youtube') return

      const videoId = parseYouTubeVideoId(payload.url)
      if (!videoId) return

      const url = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`
      )
      this.embedUrl.set(url)
      this.#enterViewerMode()
    })
  }

  close(): void {
    this.embedUrl.set(null)
    this.#exitViewerMode()
  }

  onBackdropClick(): void {
    if (!this.chromeVisible()) {
      this.#showChrome()
      return
    }
    this.close()
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.embedUrl()) this.close()
  }

  ngOnDestroy(): void {
    this.#unsub?.()
    this.#exitViewerMode()
  }

  #enterViewerMode(): void {
    document.body.classList.add('viewer-open')
    this.chromeVisible.set(true)
    this.#scheduleHideChrome()
  }

  #exitViewerMode(): void {
    this.#clearChromeTimer()
    this.chromeVisible.set(true)
    document.body.classList.remove('viewer-active')
    document.body.classList.remove('viewer-open')
  }

  #showChrome(): void {
    this.chromeVisible.set(true)
    document.body.classList.remove('viewer-active')
    this.#scheduleHideChrome()
  }

  #scheduleHideChrome(): void {
    this.#clearChromeTimer()
    this.#chromeTimer = setTimeout(() => {
      if (!this.embedUrl()) return
      this.chromeVisible.set(false)
      document.body.classList.add('viewer-active')
    }, CHROME_HIDE_DELAY)
  }

  #clearChromeTimer(): void {
    if (this.#chromeTimer) {
      clearTimeout(this.#chromeTimer)
      this.#chromeTimer = null
    }
  }
}
