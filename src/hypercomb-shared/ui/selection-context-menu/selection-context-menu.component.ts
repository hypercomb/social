// hypercomb-shared/ui/selection-context-menu/selection-context-menu.component.ts
// Floating vertical icon toolbar — appears when tiles are selected.

import {
  Component,
  computed,
  signal,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

const STORAGE_KEY = 'hc:selection-menu-pos'
const MENU_WIDTH = 44
const MENU_HEIGHT_BASE = 160 // approximate height without paste

@Component({
  selector: 'hc-selection-context-menu',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './selection-context-menu.component.html',
  styleUrls: ['./selection-context-menu.component.scss'],
})
export class SelectionContextMenuComponent implements OnInit, OnDestroy {

  // ── reactive state ──────────────────────────────────────

  #hasSelection = signal(false)
  #allHidden = signal(false)
  #moveMode = signal(false)
  #clipboardCount = signal(0)
  #posX = signal(0)
  #posY = signal(0)
  #dragging = signal(false)

  readonly visible = computed(() => this.#hasSelection())
  readonly allHidden = this.#allHidden.asReadonly()
  readonly moveMode = this.#moveMode.asReadonly()
  readonly clipboardCount = this.#clipboardCount.asReadonly()
  readonly posX = this.#posX.asReadonly()
  readonly posY = this.#posY.asReadonly()
  readonly dragging = this.#dragging.asReadonly()

  // ── drag state ──────────────────────────────────────────

  #dragOffsetX = 0
  #dragOffsetY = 0
  #pointerId: number | null = null

  // ── subscriptions ───────────────────────────────────────

  #selectionUnsub: (() => void) | null = null
  #showHiddenUnsub: (() => void) | null = null
  #moveModeUnsub: (() => void) | null = null
  #clipboardUnsub: (() => void) | null = null

  // ── lifecycle ───────────────────────────────────────────

  ngOnInit(): void {
    this.#restorePosition()

    this.#selectionUnsub = EffectBus.on<{ selected?: string[] }>('selection:changed', (payload) => {
      const selected = payload?.selected ?? []
      this.#hasSelection.set(selected.length > 0)
      this.#updateAllHidden(selected)
    })

    this.#showHiddenUnsub = EffectBus.on<{ active: boolean }>('visibility:show-hidden', () => {
      // Re-check hidden state when show-hidden toggles (hidden set may have changed)
      const selection = window.ioc.get<{ selected: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')
      if (selection) this.#updateAllHidden([...selection.selected])
    })

    this.#moveModeUnsub = EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.#moveMode.set(active)
    })

    this.#clipboardUnsub = EffectBus.on<{ items?: { label: string }[] }>('clipboard:changed', (payload) => {
      this.#clipboardCount.set(payload?.items?.length ?? 0)
    })

    window.addEventListener('resize', this.#onResize)
  }

  ngOnDestroy(): void {
    this.#selectionUnsub?.()
    this.#showHiddenUnsub?.()
    this.#moveModeUnsub?.()
    this.#clipboardUnsub?.()
    window.removeEventListener('resize', this.#onResize)
    window.removeEventListener('pointermove', this.#onDragMove)
    window.removeEventListener('pointerup', this.#onDragEnd)
  }

  // ── actions (same effects as controls bar) ─────────────

  readonly cut = (): void => {
    EffectBus.emit('controls:action', { action: 'cut' })
  }

  readonly copy = (): void => {
    EffectBus.emit('controls:action', { action: 'copy' })
  }

  readonly remove = (): void => {
    EffectBus.emit('controls:action', { action: 'remove' })
  }

  readonly moveItem = (): void => {
    EffectBus.emit('controls:action', { action: 'move' })
  }

  readonly paste = (): void => {
    EffectBus.emit('controls:action', { action: 'paste' })
  }

  readonly hide = (): void => {
    EffectBus.emit('controls:action', { action: 'hide' })
  }

  // ── hidden-state check ──────────────────────────────────

  #updateAllHidden(selected: string[]): void {
    if (selected.length === 0) { this.#allHidden.set(false); return }
    const lineage = window.ioc.get<{ explorerLabel(): string }>('@hypercomb.social/Lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = `hc:hidden-tiles:${location}`
    const hiddenSet = new Set<string>(JSON.parse(localStorage.getItem(key) ?? '[]'))
    this.#allHidden.set(selected.every(label => hiddenSet.has(label)))
  }

  // ── drag handle ─────────────────────────────────────────

  readonly onDragStart = (e: PointerEvent): void => {
    this.#pointerId = e.pointerId
    this.#dragOffsetX = e.clientX - this.#posX()
    this.#dragOffsetY = e.clientY - this.#posY()
    this.#dragging.set(true)

    window.addEventListener('pointermove', this.#onDragMove)
    window.addEventListener('pointerup', this.#onDragEnd)
  }

  #onDragMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pointerId) return
    const x = this.#clampX(e.clientX - this.#dragOffsetX)
    const y = this.#clampY(e.clientY - this.#dragOffsetY)
    this.#posX.set(x)
    this.#posY.set(y)
  }

  #onDragEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pointerId) return
    this.#dragging.set(false)
    this.#pointerId = null
    this.#savePosition()
    window.removeEventListener('pointermove', this.#onDragMove)
    window.removeEventListener('pointerup', this.#onDragEnd)
  }

  // ── position persistence ────────────────────────────────

  #restorePosition(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const { x, y } = JSON.parse(stored)
        this.#posX.set(this.#clampX(x))
        this.#posY.set(this.#clampY(y))
        return
      }
    } catch { /* fall through to default */ }

    // default: right side, vertically centered
    this.#posX.set(window.innerWidth - 60)
    this.#posY.set(Math.round(window.innerHeight / 2 - 100))
  }

  #savePosition(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      x: this.#posX(),
      y: this.#posY(),
    }))
  }

  #clampX(x: number): number {
    return Math.max(0, Math.min(x, window.innerWidth - MENU_WIDTH))
  }

  #clampY(y: number): number {
    return Math.max(0, Math.min(y, window.innerHeight - MENU_HEIGHT_BASE))
  }

  #onResize = (): void => {
    this.#posX.set(this.#clampX(this.#posX()))
    this.#posY.set(this.#clampY(this.#posY()))
  }
}
