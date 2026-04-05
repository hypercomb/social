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
import { isFolderAccessSupported } from '@hypercomb/shared'

const get = (key: string) => (window as any).ioc?.get?.(key)

const MAX_THUMBS = 30

export class SubstrateOrganizerDrone {
  #root: HTMLElement | null = null
  #backdrop: HTMLElement | null = null
  #panel: HTMLElement | null = null
  #listEl: HTMLElement | null = null
  #previewEl: HTMLElement | null = null
  #previewLabel: HTMLElement | null = null
  #footerEl: HTMLElement | null = null
  #visible = false
  #thumbUrls = new Map<string, string>() // sig → object URL (for cleanup)
  #keydownHandler: ((ev: KeyboardEvent) => void) | null = null

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
      width: min(560px, 92vw);
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

    // Source list
    const listEl = document.createElement('div')
    listEl.style.cssText = `
      padding: 8px;
      overflow-y: auto;
      max-height: 180px;
      border-bottom: 1px solid rgba(140, 170, 220, 0.12);
    `

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

    panel.append(header, listEl, previewWrap, footer)
    root.append(backdrop, panel)
    document.body.appendChild(root)

    this.#root = root
    this.#backdrop = backdrop
    this.#panel = panel
    this.#listEl = listEl
    this.#previewEl = previewGrid
    this.#previewLabel = previewLabel
    this.#footerEl = footer
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

    // Source list rows
    this.#listEl.innerHTML = ''
    for (const source of sources) {
      this.#listEl.appendChild(this.#renderRow(source, source.id === activeId))
    }
    if (sources.length === 0) {
      const empty = document.createElement('div')
      empty.textContent = 'no substrate sources yet'
      empty.style.cssText = 'padding: 12px; font-size: 11px; color: rgba(180, 200, 220, 0.4);'
      this.#listEl.appendChild(empty)
    }

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

  #renderRow(source: SubstrateSource, isActive: boolean): HTMLElement {
    const row = document.createElement('div')
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.12s;
      ${isActive ? 'background: rgba(120, 180, 255, 0.1);' : ''}
    `
    row.addEventListener('mouseenter', () => {
      if (!isActive) row.style.background = 'rgba(140, 170, 220, 0.05)'
    })
    row.addEventListener('mouseleave', () => {
      if (!isActive) row.style.background = 'transparent'
    })

    // Radio marker
    const radio = document.createElement('span')
    radio.textContent = isActive ? '●' : '○'
    radio.style.cssText = `
      font-size: 12px;
      color: ${isActive ? 'rgba(160, 200, 255, 0.95)' : 'rgba(180, 200, 220, 0.4)'};
      width: 12px;
    `

    // Label + meta
    const textWrap = document.createElement('div')
    textWrap.style.cssText = 'flex: 1; min-width: 0;'
    const label = document.createElement('div')
    label.textContent = source.label
    label.style.cssText = `
      font-size: 12px;
      color: rgba(220, 230, 240, 0.92);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `
    const meta = document.createElement('div')
    const typeLabel = source.type + (source.builtin ? ' · built-in' : '')
    const countSuffix = isActive ? ` · ${this.#service()?.resolvedImageCount ?? 0} images` : ''
    meta.textContent = typeLabel + countSuffix
    meta.style.cssText = `
      font-size: 9px;
      color: rgba(180, 200, 220, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 1px;
    `
    textWrap.append(label, meta)

    // Remove button (hidden for builtin)
    const removeBtn = document.createElement('span')
    if (!source.builtin) {
      removeBtn.textContent = '✕'
      removeBtn.title = 'Remove source'
      removeBtn.style.cssText = `
        cursor: pointer;
        padding: 2px 6px;
        font-size: 11px;
        color: rgba(220, 120, 120, 0.55);
        border-radius: 3px;
      `
      removeBtn.addEventListener('mouseenter', () => { removeBtn.style.background = 'rgba(220, 120, 120, 0.15)' })
      removeBtn.addEventListener('mouseleave', () => { removeBtn.style.background = 'transparent' })
      removeBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        await this.#service()?.removeSource(source.id)
      })
    }

    row.append(radio, textWrap, removeBtn)
    row.addEventListener('click', async () => {
      if (isActive) return
      await this.#service()?.setActive(source.id)
    })
    return row
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
