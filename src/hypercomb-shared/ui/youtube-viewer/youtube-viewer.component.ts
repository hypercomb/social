// youtube-viewer.component.ts — full-screen YouTube embed overlay
//
// Listens for `viewer:open` effect with kind 'youtube'.
// Shows an iframe embed with autoplay. The exit FAB (bottom-right, same
// identity as the website-mode exit) is ALWAYS present while the viewer is
// open — it dims with the chrome but never disappears, so the takeover can't
// read as "the hive is broken". Backdrop click and Escape also close.
// Moving the mouse or clicking the backdrop reveals the chrome; it auto-hides
// again after a timeout.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, HostListener, signal } from '@angular/core'
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser'
import { EffectBus } from '@hypercomb/core'
import { parseYouTubeVideoId } from '@hypercomb/essentials/diamondcoreprocessor.com/link/youtube'
import { TranslatePipe } from '../../core/i18n.pipe'

type ViewerOpenPayload = { kind: string; url: string; label?: string }

const CHROME_HIDE_DELAY = 3000

// Injected once into <head> — survives Angular's CSS purge
const VIEWER_STYLE_ID = 'hc-viewer-chrome-style'
function ensureViewerStyle(): void {
  if (document.getElementById(VIEWER_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = VIEWER_STYLE_ID
  // NOTE: hiding the Pixi canvas under `.viewer-open` is NOT done here. It is
  // the shared `suppress-canvas-under('.viewer-open')` rule compiled into the
  // shell styles.scss (visibility + canvas pointer-events). A hand-rolled
  // `#pixi-host { visibility:hidden }` here was incomplete — it left the
  // pointer-events:auto <canvas> eating clicks through the viewer. This style
  // tag now only fades the chrome; the `viewer-open` body class (toggled below)
  // triggers the shared canvas-suppress rule.
  style.textContent = `
    .header-bar, hc-controls-bar { transition: opacity 0.5s ease; }
    body.viewer-active .header-bar,
    body.viewer-active hc-controls-bar { opacity: 0; pointer-events: none; }
  `
  document.head.appendChild(style)
}

@Component({
  selector: 'hc-youtube-viewer',
  standalone: true,
  imports: [TranslatePipe],
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

  // Mouse movement reveals the chrome (the natural "where am I" gesture) and
  // keeps it up while the pointer is active. Only fires over our own elements —
  // the iframe swallows pointer events over the video itself.
  onPointerMove(): void {
    if (!this.chromeVisible()) {
      this.#showChrome()
      return
    }
    this.#scheduleHideChrome()
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

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-youtube-viewer',
  owner: '@hypercomb.shared/YoutubeViewerComponent',
  component: YoutubeViewerComponent,
  order: 350,
})
