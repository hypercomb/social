// diamondcoreprocessor.com/core/history-slider.drone.ts
import { EffectBus, type KeyMapLayer } from '@hypercomb/core'
import type { HistoryCursorService, CursorState } from './history-cursor.service.js'

/**
 * Revision clock — a compact timestamp display that appears under the
 * command line (top-right) when in revision mode.
 *
 * Shows the `at` timestamp from the history op at the cursor position.
 * Ctrl+Z / Ctrl+Y step through ops. Escape exits revision mode.
 * "Restore" appears when rewound — clicking it promotes cursor state to head.
 */
export class HistorySliderDrone {

  #clock: HTMLElement | null = null
  #timeLabel: HTMLElement | null = null
  #restoreBtn: HTMLElement | null = null
  #posLabel: HTMLElement | null = null
  #visible = false
  #reviseActive = false
  #state: CursorState = { locationSig: '', position: 0, total: 0, rewound: false, at: 0 }

  constructor() {
    EffectBus.on<CursorState>('history:cursor-changed', (state) => {
      this.#state = state
      this.#syncUI()
    })

    EffectBus.on<{ active: boolean }>('revise:mode-changed', ({ active }) => {
      this.#reviseActive = active
      this.#syncUI()
    })

    EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd === 'history.undo') this.#undo()
      if (cmd === 'history.redo') this.#redo()
      if (cmd === 'history.exit-revise') this.#exitRevise()
    })

    this.#registerKeybindings()
    this.#buildClock()
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

  // ── actions ────────────────────────────────────────────────

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

  // ── DOM ────────────────────────────────────────────────────

  #buildClock(): void {
    const clock = document.createElement('div')
    clock.id = 'hc-revision-clock'
    clock.style.cssText = `
      position: fixed;
      top: 8px;
      right: 16px;
      z-index: 9000;
      display: none;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: rgba(10, 12, 18, 0.92);
      border: 1px solid rgba(255, 170, 60, 0.35);
      border-radius: 6px;
      backdrop-filter: blur(8px);
      font-family: var(--hc-mono);
      font-size: 11px;
      color: rgba(255, 200, 120, 0.9);
      user-select: none;
      pointer-events: auto;
    `

    const timeLabel = document.createElement('span')
    timeLabel.style.cssText = 'white-space: nowrap; letter-spacing: 0.5px;'

    const posLabel = document.createElement('span')
    posLabel.style.cssText = `
      white-space: nowrap;
      color: rgba(200, 220, 240, 0.5);
      font-size: 10px;
    `

    const restoreBtn = document.createElement('span')
    restoreBtn.textContent = 'Restore'
    restoreBtn.title = 'Promote this state to head'
    restoreBtn.style.cssText = `
      display: none;
      cursor: pointer;
      padding: 1px 6px;
      margin-left: 4px;
      border: 1px solid rgba(255, 170, 60, 0.4);
      border-radius: 3px;
      background: rgba(255, 170, 60, 0.12);
      color: rgba(255, 200, 120, 0.9);
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.3px;
    `
    restoreBtn.addEventListener('click', () => this.#promote())

    clock.append(timeLabel, posLabel, restoreBtn)
    document.body.appendChild(clock)

    this.#clock = clock
    this.#timeLabel = timeLabel
    this.#posLabel = posLabel
    this.#restoreBtn = restoreBtn
  }

  // ── sync UI ────────────────────────────────────────────────

  #syncUI(): void {
    if (!this.#clock || !this.#timeLabel || !this.#posLabel || !this.#restoreBtn) return

    const { position, total, rewound, at } = this.#state
    const shouldShow = this.#reviseActive && total > 0

    if (!shouldShow) {
      if (this.#visible) {
        this.#clock.style.display = 'none'
        this.#visible = false
      }
      return
    }

    if (!this.#visible) {
      this.#clock.style.display = 'flex'
      this.#visible = true
    }

    // Format timestamp from the op
    if (at > 0) {
      const d = new Date(at)
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      this.#timeLabel.textContent = `${date} ${time}`
    } else {
      this.#timeLabel.textContent = '--:--:--'
    }

    this.#posLabel.textContent = `${position}/${total}`
    this.#restoreBtn.style.display = rewound ? 'inline-block' : 'none'
  }
}

const _historySliderDrone = new HistorySliderDrone()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistorySliderDrone', _historySliderDrone)
