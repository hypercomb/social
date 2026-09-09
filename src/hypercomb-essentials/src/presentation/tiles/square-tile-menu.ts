import type { BriefAffordance } from './tile-brief.js'
import { briefText } from './tile-brief.js'
import { buildSquareTileMenuPanel } from './square-tile-menu-panel.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'

type MenuOptions = {
  actionsFor(label: string): readonly BriefAffordance[]
  onDetails(label: string): void
}

/** A neighbour must occupy this row, not merely the next array position.
 *  offset geometry ignores the small hover lift and entrance animation. */
export function squareMenuNeighbour(plate: HTMLElement, grid: HTMLElement): HTMLElement | null {
  const row = [...grid.children].filter((node): node is HTMLElement =>
    node instanceof HTMLElement && node !== plate && node.classList.contains('wv-plate') &&
    Math.abs(node.offsetTop - plate.offsetTop) < 2,
  )
  const right = row.filter(node => node.offsetLeft > plate.offsetLeft)
    .sort((a, b) => a.offsetLeft - b.offsetLeft)[0]
  const left = row.filter(node => node.offsetLeft < plate.offsetLeft)
    .sort((a, b) => b.offsetLeft - a.offsetLeft)[0]
  return right ?? left ?? null
}

/** Keeps the grid fixed while a tile borrows one real neighbour's space.
 *  The wing belongs to the hovered plate, including the gap between columns,
 *  so crossing into the controls never activates the covered tile. */
export class SquareTileMenu {
  #active: { plate: HTMLElement; trigger: HTMLButtonElement; panel: HTMLElement } | null = null
  #covered: { plate: HTMLElement; inert: boolean } | null = null
  #pending: ReturnType<typeof setTimeout> | null = null
  #pinned = false
  #abort = new AbortController()
  #resize: ResizeObserver
  #backOff: (() => void) | undefined

  constructor(private readonly grid: HTMLElement, private readonly options: MenuOptions) {
    document.addEventListener('pointerdown', event => {
      if (this.#active && !this.#active.plate.contains(event.target as Node)) this.dismiss()
    }, { capture: true, signal: this.#abort.signal })
    // A reflow can move the borrowed tile to another row. Close before its
    // old geometry can cover an unrelated tile or run beyond the viewport.
    this.#resize = new ResizeObserver(() => this.dismiss())
    this.#resize.observe(grid)
    // Scoped dismissal precedes arrival-view navigation in BackGesture.
    this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')?.register({
      owner: 'square-tile-menu',
      within: () => this.#active ? grid.closest('.hc-square-tile-view') ?? grid : null,
      back: () => { this.dismiss(true) },
    })
  }

  bind(plate: HTMLElement, label: string, title: string): void {
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'wv-manage'
    trigger.textContent = '⋯'
    trigger.title = briefText('square-tile.menu.manage', 'Manage tile')
    trigger.setAttribute('aria-label', `${trigger.title}: ${title}`)
    trigger.setAttribute('aria-expanded', 'false')
    plate.appendChild(trigger)
    const signal = this.#abort.signal

    plate.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse' || this.#active?.plate === plate) return
      this.#cancelPending()
      this.#pending = setTimeout(() => {
        this.#pending = null
        if (plate.isConnected) this.#open(plate, trigger, label, title)
      }, 180)
    }, { signal })
    plate.addEventListener('pointerleave', () => {
      this.#cancelPending()
      if (this.#active?.plate === plate && !this.#pinned &&
        !this.#active.panel.contains(document.activeElement)) this.dismiss()
    }, { signal })
    plate.addEventListener('focusout', event => {
      if (this.#active?.plate === plate && !plate.contains(event.relatedTarget as Node | null)) this.dismiss()
    }, { signal })
    trigger.addEventListener('click', event => {
      event.stopPropagation()
      if (this.#active?.plate === plate && this.#pinned) { this.dismiss(true); return }
      this.#open(plate, trigger, label, title)
      this.#pinned = true
      this.#active?.panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }, { signal })
  }

  /** Returns whether Escape/back consumed an open menu. */
  dismiss(restoreFocus = false): boolean {
    this.#cancelPending()
    const active = this.#active
    this.#active = null
    this.#pinned = false
    if (this.#covered) {
      this.#covered.plate.inert = this.#covered.inert
      this.#covered.plate.removeAttribute('data-menu-covered')
    }
    this.#covered = null
    if (!active) return false
    const hadFocus = active.panel.contains(document.activeElement)
    active.panel.remove()
    active.plate.removeAttribute('data-menu-side')
    active.plate.style.removeProperty('--wv-menu-left')
    active.plate.style.removeProperty('--wv-menu-width')
    active.plate.style.removeProperty('--wv-menu-height')
    active.trigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus || hadFocus) active.trigger.focus({ preventScroll: true })
    return true
  }

  destroy(): void {
    this.dismiss()
    this.#resize.disconnect()
    this.#backOff?.()
    this.#abort.abort()
  }

  #cancelPending(): void {
    if (this.#pending !== null) clearTimeout(this.#pending)
    this.#pending = null
  }

  #open(plate: HTMLElement, trigger: HTMLButtonElement, label: string, title: string): void {
    this.#cancelPending()
    if (this.#active?.plate === plate) return
    this.dismiss()
    const neighbour = squareMenuNeighbour(plate, this.grid)
    const width = neighbour?.offsetWidth ?? plate.offsetWidth
    const left = neighbour ? neighbour.offsetLeft - plate.offsetLeft : 0
    const height = plate.querySelector<HTMLElement>('.wv-mat')?.offsetHeight ?? plate.offsetWidth
    const side = neighbour ? (left < 0 ? 'left' : 'right') : 'inside'
    const panel = buildSquareTileMenuPanel({
      title,
      actions: this.options.actionsFor(label),
      onClose: () => this.dismiss(true),
      onDetails: () => { this.dismiss(true); this.options.onDetails(label) },
    })
    panel.style.left = `${left}px`
    panel.style.width = `${width}px`
    panel.style.height = `${height}px`
    plate.style.setProperty('--wv-menu-left', `${Math.min(0, left)}px`)
    plate.style.setProperty('--wv-menu-width', `${plate.offsetWidth + Math.abs(left)}px`)
    plate.style.setProperty('--wv-menu-height', `${height}px`)
    plate.setAttribute('data-menu-side', side)
    trigger.setAttribute('aria-expanded', 'true')
    plate.appendChild(panel)
    this.#active = { plate, trigger, panel }
    if (neighbour) {
      this.#covered = { plate: neighbour, inert: neighbour.inert }
      neighbour.setAttribute('data-menu-covered', '')
      neighbour.inert = true
    }
  }
}

export const SQUARE_TILE_MENU_LAYOUT_CSS = `
.wv-plate[data-menu-covered]{visibility:hidden}
.wv-plate[data-menu-side]{z-index:5;transform:none}
.wv-plate[data-menu-side]::before{content:'';position:absolute;left:var(--wv-menu-left);top:0;width:var(--wv-menu-width);height:var(--wv-menu-height);box-sizing:border-box;background:#fffdf7;border:1px solid #b8933f;box-shadow:0 12px 32px -8px rgba(58,42,28,.35);pointer-events:auto}
.wv-plate[data-menu-side] .wv-door{position:relative;z-index:1}
.wv-plate[data-menu-side] .wv-mat{box-shadow:none}
.wv-plate[data-menu-side="inside"] .wv-door,.wv-plate[data-menu-side="inside"]>.wv-fold,.wv-plate[data-menu-side="inside"]>.wv-manage{visibility:hidden}
.wv-manage{position:absolute;z-index:3;left:14px;top:14px;display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1px solid rgba(184,147,63,.65);border-radius:50%;background:#fffdf7;color:#5c4630;font:700 22px/1 sans-serif;cursor:pointer;opacity:0;transition:opacity .15s ease}
.wv-plate:hover .wv-manage,.wv-plate:focus-within .wv-manage,.wv-plate[data-menu-side] .wv-manage{opacity:1}
.wv-manage:hover{background:#efe7d6}
.wv-manage:focus-visible{outline:2px solid #8b651b;outline-offset:3px}
@media(hover:none),(pointer:coarse){.wv-manage{opacity:1;width:40px;height:40px;left:10px;top:10px}}
@media(prefers-reduced-motion:reduce){.wv-manage{transition:none}}
`
