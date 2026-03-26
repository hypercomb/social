// diamondcoreprocessor.com/core/history-slider.drone.ts
import { EffectBus, type KeyMapLayer } from '@hypercomb/core'
import type { HistoryCursorService, CursorState } from './history-cursor.service.js'

/**
 * History slider drone — renders a bottom-bar range input for navigating
 * through history ops, and handles Ctrl+Z / Ctrl+Y keyboard shortcuts.
 *
 * The slider is only visible when the current location has >= 1 history op.
 * Moving the slider calls HistoryCursorService.seek(), which emits
 * `history:cursor-changed` — ShowCellDrone picks that up to re-render
 * with divergence overlays.
 */
export class HistorySliderDrone {

  #bar: HTMLElement | null = null
  #slider: HTMLInputElement | null = null
  #label: HTMLElement | null = null
  #promoteBtn: HTMLButtonElement | null = null
  #visible = false
  #reviseActive = false
  #state: CursorState = { locationSig: '', position: 0, total: 0, rewound: false }

  constructor() {
    // Listen for cursor changes
    EffectBus.on<CursorState>('history:cursor-changed', (state) => {
      this.#state = state
      this.#syncUI()
    })

    // Listen for revision mode toggle
    EffectBus.on<{ active: boolean }>('revise:mode-changed', ({ active }) => {
      this.#reviseActive = active
      this.#syncUI()
    })

    // Listen for keymap invocations
    EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd === 'history.undo') this.#undo()
      if (cmd === 'history.redo') this.#redo()
      if (cmd === 'history.exit-revise') this.#exitRevise()
    })

    // Register keybindings
    this.#registerKeybindings()

    // Build DOM (hidden initially)
    this.#buildBar()
  }

  // ── keybindings ──────────────────────────────────────────────

  #registerKeybindings(): void {
    const layer: KeyMapLayer = {
      id: 'history',
      priority: 5,
      bindings: [
        {
          cmd: 'history.undo',
          sequence: [[{ key: 'z', primary: true }]],
          description: 'Undo (step back in history)',
          category: 'History',
          pierce: true,
        },
        {
          cmd: 'history.redo',
          sequence: [[{ key: 'y', primary: true }]],
          description: 'Redo (step forward in history)',
          category: 'History',
          pierce: true,
        },
        {
          cmd: 'history.exit-revise',
          sequence: [[{ key: 'Escape' }]],
          description: 'Exit revision mode',
          category: 'History',
          pierce: true,
        },
      ],
    }

    EffectBus.emit('keymap:add-layer', { layer })
  }

  // ── undo / redo ──────────────────────────────────────────────

  #undo(): void {
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    cursor?.undo()
  }

  #redo(): void {
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    cursor?.redo()
  }

  #promote(): void {
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    cursor?.promote()
  }

  #exitRevise(): void {
    if (!this.#reviseActive) return
    const queen = get('@diamondcoreprocessor.com/ReviseQueenBee') as any
    if (queen?.invoke) queen.invoke('')
  }

  // ── DOM ──────────────────────────────────────────────────────

  #buildBar(): void {
    const bar = document.createElement('div')
    bar.id = 'hc-history-bar'
    bar.style.cssText = `
      position: fixed;
      bottom: 48px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9000;
      display: none;
      align-items: center;
      gap: 10px;
      padding: 6px 16px;
      background: rgba(10, 12, 18, 0.92);
      border: 1px solid rgba(100, 200, 255, 0.15);
      border-radius: 8px;
      backdrop-filter: blur(8px);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11px;
      color: rgba(200, 220, 240, 0.8);
      user-select: none;
      pointer-events: auto;
      min-width: 320px;
    `

    const undoBtn = document.createElement('button')
    undoBtn.textContent = '\u25C0'
    undoBtn.title = 'Undo (Ctrl+Z)'
    undoBtn.style.cssText = this.#btnStyle()
    undoBtn.addEventListener('click', () => this.#undo())

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '0'
    slider.value = '0'
    slider.style.cssText = `
      flex: 1;
      accent-color: #44aaff;
      cursor: pointer;
      height: 4px;
    `
    slider.addEventListener('input', () => {
      const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
      cursor?.seek(parseInt(slider.value, 10))
    })

    const redoBtn = document.createElement('button')
    redoBtn.textContent = '\u25B6'
    redoBtn.title = 'Redo (Ctrl+Y)'
    redoBtn.style.cssText = this.#btnStyle()
    redoBtn.addEventListener('click', () => this.#redo())

    const promoteBtn = document.createElement('button')
    promoteBtn.textContent = 'Restore'
    promoteBtn.title = 'Promote this state to head'
    promoteBtn.style.cssText = `
      ${this.#btnStyle()}
      display: none;
      background: rgba(255, 170, 60, 0.12);
      border-color: rgba(255, 170, 60, 0.4);
      color: rgba(255, 200, 120, 0.9);
      font-weight: 600;
      letter-spacing: 0.3px;
    `
    promoteBtn.addEventListener('click', () => this.#promote())

    const label = document.createElement('span')
    label.style.cssText = 'white-space: nowrap; min-width: 60px; text-align: right;'

    bar.append(undoBtn, slider, redoBtn, promoteBtn, label)
    this.#promoteBtn = promoteBtn
    document.body.appendChild(bar)

    this.#bar = bar
    this.#slider = slider
    this.#label = label
  }

  #btnStyle(): string {
    return `
      background: none;
      border: 1px solid rgba(100, 200, 255, 0.2);
      border-radius: 4px;
      color: rgba(200, 220, 240, 0.8);
      cursor: pointer;
      padding: 2px 8px;
      font-size: 11px;
      line-height: 1;
    `
  }

  // ── sync UI ──────────────────────────────────────────────────

  #syncUI(): void {
    if (!this.#bar || !this.#slider || !this.#label) return

    const { position, total, rewound } = this.#state

    // Slider is only visible when revision mode is active AND there's history
    const shouldShow = this.#reviseActive && total > 0

    if (!shouldShow) {
      if (this.#visible) {
        this.#bar.style.display = 'none'
        this.#visible = false
      }
      return
    }

    if (!this.#visible) {
      this.#bar.style.display = 'flex'
      this.#visible = true
    }

    this.#slider.max = String(total)
    this.#slider.value = String(position)

    // Show/hide restore button based on rewind state
    if (this.#promoteBtn) {
      this.#promoteBtn.style.display = rewound ? 'inline-block' : 'none'
    }

    if (rewound) {
      this.#label.textContent = `${position} / ${total}`
      this.#bar.style.borderColor = 'rgba(255, 170, 60, 0.35)'
    } else {
      this.#label.textContent = `${total} ops`
      this.#bar.style.borderColor = 'rgba(100, 200, 255, 0.15)'
    }
  }
}

const _historySliderDrone = new HistorySliderDrone()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistorySliderDrone', _historySliderDrone)
