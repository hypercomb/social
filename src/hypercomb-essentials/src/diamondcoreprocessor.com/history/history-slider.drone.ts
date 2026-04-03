// diamondcoreprocessor.com/core/history-slider.drone.ts
import { EffectBus, type KeyMapLayer } from '@hypercomb/core'
import type { HistoryCursorService, CursorState } from './history-cursor.service.js'
import type { GlobalTimeClock } from './global-time-clock.service.js'

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
  #scopeLabel: HTMLElement | null = null
  #activityLabel: HTMLElement | null = null
  #scrubber: HTMLInputElement | null = null
  #visible = false
  #reviseActive = false
  #globalTimeActive = false
  #scrubbing = false
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

    EffectBus.on<{ timestamp: number | null }>('time:changed', ({ timestamp }) => {
      this.#globalTimeActive = timestamp !== null
      this.#syncUI()
    })

    EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd === 'history.undo') this.#undo()
      if (cmd === 'history.redo') this.#redo()
      if (cmd === 'history.toggle-scope') this.#toggleScope()
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
          cmd: 'history.toggle-scope',
          sequence: [[{ key: 'g', primary: true, shift: true }]],
          description: 'Toggle local/global time scope',
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
    const clock = get<GlobalTimeClock>('@diamondcoreprocessor.com/GlobalTimeClock')
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')

    if (clock?.active && cursor) {
      // Global time mode: step backward across all op timestamps
      clock.stepBack(cursor.allTimestamps)
      // Sync cursor to the new global timestamp
      if (clock.timestamp !== null) cursor.seekToTime(clock.timestamp)
    } else {
      cursor?.undo()
    }
  }

  #redo(): void {
    const clock = get<GlobalTimeClock>('@diamondcoreprocessor.com/GlobalTimeClock')
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')

    if (clock?.active && cursor) {
      // Global time mode: step forward across all op timestamps
      clock.stepForward(cursor.allTimestamps)
      // Sync cursor to the new global timestamp (or go to head if live)
      if (clock.timestamp !== null) cursor.seekToTime(clock.timestamp)
      else cursor.jumpToLatest()
    } else {
      cursor?.redo()
    }
  }

  #promote(): void {
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    cursor?.promote()
  }

  #toggleScope(): void {
    const clock = get<GlobalTimeClock>('@diamondcoreprocessor.com/GlobalTimeClock')
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (!clock || !cursor) return

    if (clock.active) {
      // Switch from global → local: go live, keep cursor where it is
      clock.goLive()
    } else {
      // Switch from local → global: freeze at cursor's current timestamp
      const { at } = cursor.state
      if (at > 0) clock.setTime(at)
    }
  }

  #exitRevise(): void {
    if (!this.#reviseActive) return

    // If in global time mode, go live first
    const clock = get<GlobalTimeClock>('@diamondcoreprocessor.com/GlobalTimeClock')
    if (clock?.active) clock.goLive()

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
      flex-direction: column;
      gap: 4px;
      padding: 6px 12px;
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

    // ── top row: timestamp, position, activity, scope, restore ──
    const topRow = document.createElement('div')
    topRow.style.cssText = 'display: flex; align-items: center; gap: 8px;'

    const timeLabel = document.createElement('span')
    timeLabel.style.cssText = 'white-space: nowrap; letter-spacing: 0.5px;'

    const posLabel = document.createElement('span')
    posLabel.style.cssText = `
      white-space: nowrap;
      color: rgba(200, 220, 240, 0.5);
      font-size: 10px;
    `

    const activityLabel = document.createElement('span')
    activityLabel.style.cssText = `
      white-space: nowrap;
      color: rgba(200, 220, 240, 0.4);
      font-size: 10px;
      font-style: italic;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    `

    const scopeLabel = document.createElement('span')
    scopeLabel.title = 'Toggle local/global time scope'
    scopeLabel.style.cssText = `
      display: none;
      cursor: pointer;
      padding: 1px 6px;
      border: 1px solid rgba(120, 180, 255, 0.3);
      border-radius: 3px;
      background: rgba(120, 180, 255, 0.08);
      color: rgba(160, 200, 255, 0.8);
      font-weight: 600;
      font-size: 9px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    `
    scopeLabel.addEventListener('click', () => this.#toggleScope())

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

    topRow.append(timeLabel, posLabel, activityLabel, scopeLabel, restoreBtn)

    // ── scrub slider ──
    const scrubber = document.createElement('input')
    scrubber.type = 'range'
    scrubber.min = '0'
    scrubber.max = '0'
    scrubber.value = '0'
    scrubber.style.cssText = `
      width: 100%;
      height: 4px;
      appearance: none;
      background: rgba(255, 170, 60, 0.15);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
      margin: 0;
      accent-color: rgba(255, 170, 60, 0.8);
    `
    scrubber.addEventListener('input', () => {
      this.#scrubbing = true
      const pos = parseInt(scrubber.value, 10)
      const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
      cursor?.seek(pos)
    })
    scrubber.addEventListener('change', () => {
      this.#scrubbing = false
    })

    clock.append(topRow, scrubber)
    document.body.appendChild(clock)

    this.#clock = clock
    this.#timeLabel = timeLabel
    this.#posLabel = posLabel
    this.#activityLabel = activityLabel
    this.#scopeLabel = scopeLabel
    this.#restoreBtn = restoreBtn
    this.#scrubber = scrubber
  }

  // ── sync UI ────────────────────────────────────────────────

  #syncUI(): void {
    if (!this.#clock || !this.#timeLabel || !this.#posLabel || !this.#restoreBtn || !this.#scopeLabel || !this.#activityLabel || !this.#scrubber) return

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

    // Activity log — human-readable op summary at cursor
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor && position > 0) {
      const ops = cursor.opsAtCursor()
      const op = ops[position - 1]
      this.#activityLabel.textContent = op ? formatOpDescription(op.op, op.cell) : ''
    } else {
      this.#activityLabel.textContent = ''
    }

    // Scope indicator: local vs global
    this.#scopeLabel.style.display = 'inline-block'
    if (this.#globalTimeActive) {
      this.#scopeLabel.textContent = 'global'
      this.#scopeLabel.style.borderColor = 'rgba(120, 180, 255, 0.5)'
      this.#scopeLabel.style.color = 'rgba(160, 200, 255, 0.9)'
    } else {
      this.#scopeLabel.textContent = 'local'
      this.#scopeLabel.style.borderColor = 'rgba(120, 180, 255, 0.2)'
      this.#scopeLabel.style.color = 'rgba(160, 200, 255, 0.5)'
    }

    // Sync scrubber range and position (skip if user is actively dragging)
    this.#scrubber.max = String(total)
    if (!this.#scrubbing) {
      this.#scrubber.value = String(position)
    }

    this.#restoreBtn.style.display = rewound ? 'inline-block' : 'none'
  }
}

/** Human-readable op summary for the activity log. */
function formatOpDescription(op: string, cell: string): string {
  // For signature-addressed payloads, truncate the sig
  const label = cell.length === 64 && /^[0-9a-f]+$/.test(cell)
    ? ''
    : ` "${cell}"`

  switch (op) {
    case 'add': return `added${label}`
    case 'remove': return `removed${label}`
    case 'reorder': return 'reordered'
    case 'rename': return 'renamed'
    case 'add-drone': return `drone added${label}`
    case 'remove-drone': return `drone removed${label}`
    case 'instruction-state': return 'instructions changed'
    case 'tag-state': return 'tags changed'
    case 'content-state': return 'content saved'
    case 'layout-state': return 'layout changed'
    case 'hide': return `hidden${label}`
    case 'unhide': return `unhidden${label}`
    default: return op
  }
}

const _historySliderDrone = new HistorySliderDrone()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistorySliderDrone', _historySliderDrone)
