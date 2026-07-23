// diamondcoreprocessor.com/link/photo.view.ts
// Photo view — fullscreen image viewer with forced MIME safety.
// When active, enters the owner-counted `view:active` mode to hide stage +
// chrome — so closing this photo over an open website view can't unhide the
// chrome the view is still covering.

export class PhotoView extends EventTarget {
  #overlay: HTMLDivElement | null = null

  /** Route view-mode through the owner-counted ModeRegistry (not a raw
   *  boolean broadcast): closing this photo must leave the chrome hidden if a
   *  website/slides view underneath is still open. See mode-registry.service.ts. */
  #setViewMode(active: boolean): void {
    const modes = window.ioc.get('@diamondcoreprocessor.com/ModeRegistry') as
      { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void } | undefined
    if (active) modes?.enter('view:active', 'photo')
    else modes?.exit('view:active', 'photo')
  }

  show(imageUrl: string): void {
    if (this.#overlay) this.close()

    // ── backdrop ──────────────────────────────────────────────────
    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '10000',
      background: '#0a0a0a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      opacity: '0',
      transition: 'opacity 250ms ease',
    } as CSSStyleDeclaration)

    // ── frame ─────────────────────────────────────────────────────
    const frame = document.createElement('div')
    Object.assign(frame.style, {
      position: 'relative',
      display: 'inline-flex',
      padding: '6px',
      borderRadius: '3px',
      background: 'linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: [
        '0 0 40px rgba(180, 200, 255, 0.07)',
        '0 0 80px rgba(140, 170, 255, 0.04)',
        '0 2px 16px rgba(0, 0, 0, 0.5)',
        'inset 0 1px 0 rgba(255,255,255,0.04)',
      ].join(', '),
      cursor: 'default',
    } as CSSStyleDeclaration)

    // ── image ─────────────────────────────────────────────────────
    const img = document.createElement('img')
    img.src = imageUrl
    Object.assign(img.style, {
      maxWidth: '88vw',
      maxHeight: '88vh',
      objectFit: 'contain',
      borderRadius: '2px',
      display: 'block',
    } as CSSStyleDeclaration)

    frame.addEventListener('click', (e) => e.stopPropagation())
    frame.appendChild(img)
    overlay.appendChild(frame)
    overlay.addEventListener('click', () => this.close())
    // Right-click anywhere — including on the image — collapses the view
    // rather than surfacing the browser's image context menu. The lightbox
    // is a pure viewer; saving the image is the dropbox's concern, not this
    // overlay's.
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.close()
    })
    document.body.appendChild(overlay)
    this.#overlay = overlay

    // fade in
    requestAnimationFrame(() => { overlay.style.opacity = '1' })

    document.addEventListener('keydown', this.#onKeyDown)
    this.#setViewMode(true)
  }

  showBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob)
    this.show(url)
    const img = this.#overlay?.querySelector('img')
    if (img) {
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true })
    }
  }

  close(): void {
    if (!this.#overlay) return
    const overlay = this.#overlay
    this.#overlay = null

    overlay.style.opacity = '0'
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true })
    setTimeout(() => overlay.remove(), 350)

    document.removeEventListener('keydown', this.#onKeyDown)
    this.#setViewMode(false)
  }

  get isOpen(): boolean {
    return this.#overlay !== null
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    }
  }
}

const _photoView = new PhotoView()
window.ioc.register('@diamondcoreprocessor.com/PhotoView', _photoView)
