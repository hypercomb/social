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
import { openExternalLink } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/document-view-links'
import { TranslatePipe } from '../../core/i18n.pipe'
import { ensureViewportInsetVars } from '../../core/viewport-inset-vars'

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
  // The undo/redo/save cluster shares the bottom-right corner with the video's
  // close FAB, so it must not sit over the video at all — it's hidden for the
  // WHOLE takeover (`viewer-open`), not just once the chrome auto-hides
  // (`viewer-active`). The header + controls-bar still only fade on auto-hide.
  style.textContent = `
    .header-bar, hc-controls-bar { transition: opacity 0.5s ease; }
    body.viewer-active .header-bar,
    body.viewer-active hc-controls-bar { opacity: 0; pointer-events: none; }
    body.viewer-open hc-edit-actions { display: none; }
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
  // Canonical watch URL for the escape hatch below. Armed alongside embedUrl,
  // BEFORE the player has had any chance to refuse — we can never detect the
  // refusal (see watchOnYouTube), so the way out cannot be conditional on it.
  readonly watchUrl = signal<string | null>(null)
  readonly chromeVisible = signal(true)

  #unsub: (() => void) | null = null
  #chromeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private sanitizer: DomSanitizer) {
    ensureViewerStyle()
    // The exit-fab offsets by --hc-inset-right (below) so a docked panel can't
    // cover it; make sure the var is being published even if this viewer is the
    // first chrome to need it. Idempotent.
    ensureViewportInsetVars()

    this.#unsub = EffectBus.on<ViewerOpenPayload>('viewer:open', (payload) => {
      if (payload.kind !== 'youtube') return

      const videoId = parseYouTubeVideoId(payload.url)
      if (!videoId) return

      // `origin` is YouTube's documented requirement for an iframe embed: the
      // player validates the embedding page before configuring itself, and
      // without it some shells and privacy modes answer with "error 153 —
      // video player configuration error" instead of a video. It must be the
      // EMBEDDING page's origin, whatever that is (https://hypercomb.social on
      // the web, http://tauri.localhost inside the native client).
      const url = this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` +
        `&origin=${encodeURIComponent(location.origin)}`
      )
      this.watchUrl.set(`https://www.youtube.com/watch?v=${videoId}`)
      this.embedUrl.set(url)
      this.#enterViewerMode()
    })
  }

  close(): void {
    this.embedUrl.set(null)
    this.watchUrl.set(null)
    this.#exitViewerMode()
  }

  // The escape hatch. An embed can refuse to play for reasons the hive can
  // neither see nor fix — the owner disallowed embedding, the shell's origin
  // isn't one YouTube accepts, tracking prevention starved the player of the
  // storage it configures from — and the refusal renders INSIDE a cross-origin
  // iframe, so it is unreadable from here by construction. Rather than try to
  // detect the failure, the way out is simply always present: one tap hands
  // the video to the OS browser (a new tab on the web) and drops the dead
  // overlay, so a refused embed is never a dead end.
  watchOnYouTube(): void {
    const url = this.watchUrl()
    if (!url) return
    openExternalLink(url)
    this.close()
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
