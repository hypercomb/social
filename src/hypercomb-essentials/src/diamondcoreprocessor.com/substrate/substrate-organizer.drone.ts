// diamondcoreprocessor.com/substrate/substrate-organizer.drone.ts
//
// SubstrateOrganizerDrone — fixed-overlay modal for managing substrate
// sources. Follows the drone-DOM pattern established by HistorySliderDrone:
// plain DOM, inline cssText, appended to document.body, opened/closed via
// EffectBus events. No Angular dependency.
//
// Listens:
//   substrate-organizer:open   → show the modal (rebuild content from registry)
//   substrate:changed          → if open, refresh content
// Emits:
//   activity:log               → toast messages
//   (service methods also emit substrate:changed which feeds back in)

import { EffectBus, type SubstrateSource } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'
import { isFolderAccessSupported } from './folder-handles.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

const MAX_THUMBS = 30

export class SubstrateOrganizerDrone {
  #root: HTMLElement | null = null
  #backdrop: HTMLElement | null = null
  #panel: HTMLElement | null = null
  #listEl: HTMLElement | null = null           // horizontal card strip
  #leftArrow: HTMLElement | null = null
  #rightArrow: HTMLElement | null = null
  #previewEl: HTMLElement | null = null
  #previewLabel: HTMLElement | null = null
  #footerEl: HTMLElement | null = null
  #visible = false
  #thumbUrls = new Map<string, string>() // sig → object URL (for cleanup)
  #keydownHandler: ((ev: KeyboardEvent) => void) | null = null
  #cardStep = 138                               // card width + gap, set on build
  #dragSuppressClick = false

  constructor() {
    EffectBus.on('substrate-organizer:open', () => { void this.#open() })
    EffectBus.on('substrate-organizer:close', () => { this.#close() })
    EffectBus.on('substrate:changed', () => { if (this.#visible) void this.#render() })
  }

  // ── DOM build (one-time) ──────────────────────────────────────────

  #build(): void {
    if (this.#root) return

    const root = document.createElement('div')
    root.id = 'hc-substrate-organizer'
    root.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 9500;
      display: none;
      align-items: center;
      justify-content: center;
      font-family: var(--hc-mono, ui-monospace, monospace);
      color: rgba(220, 230, 240, 0.92);
    `

    const backdrop = document.createElement('div')
    backdrop.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(4, 6, 10, 0.55);
      backdrop-filter: blur(4px);
    `
    backdrop.addEventListener('click', () => this.#close())

    const panel = document.createElement('div')
    panel.style.cssText = `
      position: relative;
      width: min(720px, 94vw);
      max-height: 82vh;
      display: flex;
      flex-direction: column;
      background: rgba(12, 16, 24, 0.96);
      border: 1px solid rgba(140, 170, 220, 0.28);
      border-radius: 10px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    `

    // Header
    const header = document.createElement('div')
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(140, 170, 220, 0.12);
    `
    const title = document.createElement('div')
    title.textContent = '◈ Substrate'
    title.style.cssText = 'font-size: 13px; font-weight: 600; letter-spacing: 0.5px;'

    const closeBtn = document.createElement('button')
    closeBtn.textContent = '×'
    closeBtn.title = 'Close (Esc)'
    closeBtn.style.cssText = `
      background: none; border: none; color: rgba(220, 230, 240, 0.6);
      font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px;
    `
    closeBtn.addEventListener('click', () => this.#close())
    header.append(title, closeBtn)

    // Source carousel — horizontal card strip with arrows + drag-to-pan.
    const carousel = document.createElement('div')
    carousel.style.cssText = `
      position: relative;
      padding: 12px 0;
      border-bottom: 1px solid rgba(140, 170, 220, 0.12);
    `

    const listEl = document.createElement('div')
    listEl.style.cssText = `
      display: flex;
      gap: 10px;
      padding: 4px 44px;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      scrollbar-width: none;
      -ms-overflow-style: none;
      cursor: grab;
    `
    // Hide webkit scrollbar
    const styleHide = document.createElement('style')
    styleHide.textContent = `#hc-substrate-organizer .hc-so-strip::-webkit-scrollbar { display: none; }`
    document.head.appendChild(styleHide)
    listEl.classList.add('hc-so-strip')

    // Drag-to-pan handlers
    let dragStartX = 0
    let dragStartScroll = 0
    let dragging = false
    let dragDelta = 0
    listEl.addEventListener('pointerdown', (ev) => {
      dragging = true
      dragStartX = ev.clientX
      dragStartScroll = listEl.scrollLeft
      dragDelta = 0
      listEl.style.cursor = 'grabbing'
      listEl.style.scrollBehavior = 'auto'
      ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
    })
    listEl.addEventListener('pointermove', (ev) => {
      if (!dragging) return
      const dx = ev.clientX - dragStartX
      dragDelta = Math.abs(dx)
      listEl.scrollLeft = dragStartScroll - dx
    })
    const endDrag = () => {
      if (!dragging) return
      dragging = false
      listEl.style.cursor = 'grab'
      listEl.style.scrollBehavior = 'smooth'
      this.#dragSuppressClick = dragDelta > 5
      // Reset suppression on next tick so the click event fires first
      setTimeout(() => { this.#dragSuppressClick = false }, 50)
    }
    listEl.addEventListener('pointerup', endDrag)
    listEl.addEventListener('pointercancel', endDrag)
    listEl.addEventListener('pointerleave', endDrag)

    // Arrow buttons — overlay the strip edges
    const mkArrow = (dir: 'left' | 'right'): HTMLElement => {
      const btn = document.createElement('button')
      btn.textContent = dir === 'left' ? '‹' : '›'
      btn.title = dir === 'left' ? 'Previous' : 'Next'
      btn.style.cssText = `
        position: absolute;
        top: 50%;
        ${dir}: 6px;
        transform: translateY(-50%);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(12, 16, 24, 0.85);
        border: 1px solid rgba(140, 170, 220, 0.35);
        color: rgba(220, 230, 240, 0.88);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.12s, opacity 0.12s;
      `
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(140, 170, 220, 0.25)' })
      btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(12, 16, 24, 0.85)' })
      btn.addEventListener('click', () => {
        const delta = (dir === 'left' ? -1 : 1) * this.#cardStep
        listEl.scrollBy({ left: delta, behavior: 'smooth' })
      })
      return btn
    }
    const leftArrow = mkArrow('left')
    const rightArrow = mkArrow('right')

    // Update arrow visibility based on scroll position
    const updateArrows = () => {
      const max = listEl.scrollWidth - listEl.clientWidth - 1
      leftArrow.style.opacity = listEl.scrollLeft > 2 ? '1' : '0.3'
      leftArrow.style.pointerEvents = listEl.scrollLeft > 2 ? 'auto' : 'none'
      const atEnd = listEl.scrollLeft >= max
      rightArrow.style.opacity = atEnd ? '0.3' : '1'
      rightArrow.style.pointerEvents = atEnd ? 'none' : 'auto'
    }
    listEl.addEventListener('scroll', updateArrows)

    carousel.append(listEl, leftArrow, rightArrow)

    // Preview area
    const previewWrap = document.createElement('div')
    previewWrap.style.cssText = `
      padding: 10px 12px;
      overflow-y: auto;
      flex: 1 1 auto;
      min-height: 120px;
    `
    const previewLabel = document.createElement('div')
    previewLabel.style.cssText = `
      font-size: 10px;
      color: rgba(180, 200, 220, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 6px;
    `
    const previewGrid = document.createElement('div')
    previewGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
      gap: 6px;
    `
    previewWrap.append(previewLabel, previewGrid)

    // Footer actions
    const footer = document.createElement('div')
    footer.style.cssText = `
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      border-top: 1px solid rgba(140, 170, 220, 0.12);
      flex-wrap: wrap;
    `

    panel.append(header, carousel, previewWrap, footer)
    root.append(backdrop, panel)
    document.body.appendChild(root)

    this.#root = root
    this.#backdrop = backdrop
    this.#panel = panel
    this.#listEl = listEl
    this.#leftArrow = leftArrow
    this.#rightArrow = rightArrow
    this.#previewEl = previewGrid
    this.#previewLabel = previewLabel
    this.#footerEl = footer

    // Initial arrow state (after first render).
    queueMicrotask(updateArrows)
  }

  // ── open / close ──────────────────────────────────────────────────

  async #open(): Promise<void> {
    this.#build()
    if (!this.#root) return
    this.#root.style.display = 'flex'
    this.#visible = true

    this.#keydownHandler = (ev) => { if (ev.key === 'Escape') this.#close() }
    document.addEventListener('keydown', this.#keydownHandler)

    await this.#render()
  }

  #close(): void {
    if (!this.#root || !this.#visible) return
    this.#root.style.display = 'none'
    this.#visible = false
    if (this.#keydownHandler) {
      document.removeEventListener('keydown', this.#keydownHandler)
      this.#keydownHandler = null
    }
    this.#disposeThumbs()
  }

  #disposeThumbs(): void {
    for (const url of this.#thumbUrls.values()) URL.revokeObjectURL(url)
    this.#thumbUrls.clear()
  }

  // ── render registry + preview ──────────────────────────────────────

  async #render(): Promise<void> {
    const svc = this.#service()
    if (!svc || !this.#listEl || !this.#footerEl) return
    await svc.ensureLoaded()

    const sources = svc.listSources()
    const activeId = svc.registry.activeId

    // Source cards (horizontal strip)
    this.#listEl.innerHTML = ''
    for (const source of sources) {
      this.#listEl.appendChild(this.#renderCard(source, source.id === activeId))
    }
    if (sources.length === 0) {
      const empty = document.createElement('div')
      empty.textContent = 'no substrate sources yet'
      empty.style.cssText = 'padding: 24px; font-size: 11px; color: rgba(180, 200, 220, 0.4);'
      this.#listEl.appendChild(empty)
    }
    // Refresh arrow state now that content is in place.
    queueMicrotask(() => this.#listEl?.dispatchEvent(new Event('scroll')))

    // Footer buttons
    this.#footerEl.innerHTML = ''
    if (isFolderAccessSupported()) {
      this.#footerEl.appendChild(this.#button('+ Link folder', async () => {
        const source = await svc.linkLocalFolder()
        if (source) {
          EffectBus.emit('activity:log', { message: `linked ${source.label}`, icon: '◈' })
        }
      }))
    }
    this.#footerEl.appendChild(this.#button('+ Use current hive', async () => {
      const lineage = get('@hypercomb.social/Lineage') as { explorerSegments: () => readonly string[] } | undefined
      const segments = lineage?.explorerSegments() ?? []
      if (segments.length === 0) {
        EffectBus.emit('activity:log', { message: 'navigate into a hive first', icon: '◈' })
        return
      }
      const path = segments.join('/')
      await svc.addHiveSource(path)
    }))
    this.#footerEl.appendChild(this.#button('↻ Refresh', async () => {
      await svc.warmUp()
      await this.#render()
    }))
    this.#footerEl.appendChild(this.#button('Off', async () => {
      await svc.setActive(null)
    }))

    // Preview (active source only)
    await this.#renderPreview()
  }

  #renderCard(source: SubstrateSource, isActive: boolean): HTMLElement {
    const card = document.createElement('div')
    card.style.cssText = `
      flex: 0 0 128px;
      scroll-snap-align: start;
      display: flex;
      flex-direction: column;
      background: rgba(140, 170, 220, 0.05);
      border: 1px solid ${isActive ? 'rgba(160, 200, 255, 0.65)' : 'rgba(140, 170, 220, 0.18)'};
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.15s, transform 0.15s;
      position: relative;
      ${isActive ? 'box-shadow: 0 0 0 1px rgba(160, 200, 255, 0.35), 0 4px 12px rgba(60, 120, 200, 0.2);' : ''}
    `
    card.addEventListener('mouseenter', () => {
      if (!isActive) card.style.borderColor = 'rgba(140, 170, 220, 0.4)'
    })
    card.addEventListener('mouseleave', () => {
      if (!isActive) card.style.borderColor = 'rgba(140, 170, 220, 0.18)'
    })

    // Thumbnail area
    const thumb = document.createElement('div')
    thumb.style.cssText = `
      height: 88px;
      background: linear-gradient(135deg, rgba(60, 90, 140, 0.25), rgba(30, 40, 60, 0.35));
      background-size: cover;
      background-position: center;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      color: rgba(180, 200, 220, 0.45);
    `
    // Type glyph placeholder (shown until a thumbnail loads)
    const glyphs: Record<SubstrateSource['type'], string> = {
      folder: '📁', url: '◈', hive: '⬡', layer: '▧',
    }
    thumb.textContent = glyphs[source.type] ?? '◈'

    // Try to show a real thumbnail: active source uses the pool pick; other
    // sources get a placeholder (they'll render a thumbnail the moment they
    // become active).
    if (isActive) {
      const svc = this.#service()
      const sig = svc?.pickRandomImageSync() ?? null
      if (sig) void this.#loadThumbInto(thumb, sig)
    }

    // Active radio badge (top-left)
    const radio = document.createElement('div')
    radio.textContent = isActive ? '●' : '○'
    radio.style.cssText = `
      position: absolute;
      top: 6px;
      left: 8px;
      font-size: 11px;
      color: ${isActive ? 'rgba(160, 200, 255, 0.95)' : 'rgba(220, 230, 240, 0.5)'};
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    `
    thumb.appendChild(radio)

    // Remove button (top-right, hidden for builtin)
    if (!source.builtin) {
      const removeBtn = document.createElement('button')
      removeBtn.textContent = '✕'
      removeBtn.title = 'Remove source'
      removeBtn.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        width: 18px;
        height: 18px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: rgba(12, 16, 24, 0.7);
        color: rgba(220, 120, 120, 0.75);
        font-size: 10px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      `
      removeBtn.addEventListener('mouseenter', () => { removeBtn.style.background = 'rgba(220, 120, 120, 0.3)' })
      removeBtn.addEventListener('mouseleave', () => { removeBtn.style.background = 'rgba(12, 16, 24, 0.7)' })
      removeBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        if (this.#dragSuppressClick) return
        await this.#service()?.removeSource(source.id)
      })
      thumb.appendChild(removeBtn)
    }

    // Text area
    const textWrap = document.createElement('div')
    textWrap.style.cssText = 'padding: 8px 10px;'
    const label = document.createElement('div')
    label.textContent = source.label
    label.style.cssText = `
      font-size: 11px;
      color: rgba(220, 230, 240, 0.92);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `
    const meta = document.createElement('div')
    const typeLabel = source.type + (source.builtin ? ' · built-in' : '')
    const countSuffix = isActive ? ` · ${this.#service()?.resolvedImageCount ?? 0}` : ''
    meta.textContent = typeLabel + countSuffix
    meta.style.cssText = `
      font-size: 9px;
      color: rgba(180, 200, 220, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `
    textWrap.append(label, meta)

    card.append(thumb, textWrap)
    card.addEventListener('click', async () => {
      if (this.#dragSuppressClick) return
      if (isActive) return
      await this.#service()?.setActive(source.id)
    })
    return card
  }

  async #loadThumbInto(el: HTMLElement, sig: string): Promise<void> {
    const store = get('@hypercomb.social/Store') as { getResource: (sig: string) => Promise<Blob | null> } | undefined
    if (!store) return
    try {
      const blob = await store.getResource(sig)
      if (!blob) return
      const url = URL.createObjectURL(blob)
      this.#thumbUrls.set(`card:${sig}`, url)
      el.style.backgroundImage = `url(${url})`
      el.textContent = ''
    } catch { /* ignore */ }
  }

  async #renderPreview(): Promise<void> {
    if (!this.#previewEl || !this.#previewLabel) return
    const svc = this.#service()
    const active = svc?.resolvedSource ?? null

    this.#previewEl.innerHTML = ''
    this.#disposeThumbs()

    if (!active || !svc) {
      this.#previewLabel.textContent = 'no active substrate'
      return
    }

    this.#previewLabel.textContent = `preview — ${active.label}`

    const store = get('@hypercomb.social/Store') as { getResource: (sig: string) => Promise<Blob | null> } | undefined
    if (!store) return

    // We don't have a public accessor for the resolved sigs, so re-pick a
    // sample from the pool by repeatedly drawing unique sigs from the sync
    // picker until we have up to MAX_THUMBS distinct ones or give up.
    const seen = new Set<string>()
    for (let i = 0; i < MAX_THUMBS * 10 && seen.size < MAX_THUMBS; i++) {
      const sig = svc.pickRandomImageSync()
      if (!sig) break
      seen.add(sig)
      if (seen.size >= svc.resolvedImageCount) break
    }

    for (const sig of seen) {
      const thumb = document.createElement('div')
      thumb.style.cssText = `
        aspect-ratio: 1;
        background: rgba(140, 170, 220, 0.08);
        border-radius: 4px;
        overflow: hidden;
        background-size: cover;
        background-position: center;
      `
      this.#previewEl.appendChild(thumb)
      // Lazy-load the blob
      void store.getResource(sig).then((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        this.#thumbUrls.set(sig, url)
        thumb.style.backgroundImage = `url(${url})`
      })
    }
  }

  #button(text: string, onClick: () => void | Promise<void>): HTMLElement {
    const btn = document.createElement('button')
    btn.textContent = text
    btn.style.cssText = `
      background: rgba(140, 170, 220, 0.08);
      border: 1px solid rgba(140, 170, 220, 0.25);
      color: rgba(220, 230, 240, 0.88);
      padding: 6px 12px;
      border-radius: 5px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.12s;
    `
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(140, 170, 220, 0.18)' })
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(140, 170, 220, 0.08)' })
    btn.addEventListener('click', () => { void onClick() })
    return btn
  }

  #service(): SubstrateService | undefined {
    return get('@diamondcoreprocessor.com/SubstrateService')
  }
}

const _substrateOrganizerDrone = new SubstrateOrganizerDrone()
;(window as any).ioc.register('@diamondcoreprocessor.com/SubstrateOrganizerDrone', _substrateOrganizerDrone)
