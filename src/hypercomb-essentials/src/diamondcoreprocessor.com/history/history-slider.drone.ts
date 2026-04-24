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
  #latestBtn: HTMLElement | null = null
  #posLabel: HTMLElement | null = null
  #scopeLabel: HTMLElement | null = null
  #activityLabel: HTMLElement | null = null
  #scrubber: HTMLInputElement | null = null
  #notification: HTMLElement | null = null
  #notifLabel: HTMLElement | null = null
  #notifRestore: HTMLElement | null = null
  #notifLatest: HTMLElement | null = null
  #notifClose: HTMLElement | null = null
  #visible = false
  #notifVisible = false
  // Sticky-open state: the bar opens on the first undo per-location and
  // stays until the user explicitly closes it (×). Redo to head does not
  // hide it on its own.
  #notifOpen = false
  #notifLastRewound = false
  #notifLastLocationSig = ''
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
    // History is linear append-only — no branching. "Restore" just exits
    // the rewound view; editing from head auto-appends a new layer.
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    cursor?.jumpToLatest()
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

    const latestBtn = document.createElement('span')
    latestBtn.textContent = 'Jump to latest'
    latestBtn.title = 'Discard undo and jump to current head'
    latestBtn.style.cssText = `
      display: none;
      cursor: pointer;
      padding: 1px 6px;
      border: 1px solid rgba(200, 220, 240, 0.25);
      border-radius: 3px;
      background: rgba(200, 220, 240, 0.06);
      color: rgba(200, 220, 240, 0.7);
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.3px;
    `
    latestBtn.addEventListener('click', () => {
      const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
      cursor?.jumpToLatest()
    })

    topRow.append(timeLabel, posLabel, activityLabel, scopeLabel, restoreBtn, latestBtn)

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
    this.#latestBtn = latestBtn
    this.#scrubber = scrubber

    // ── compact notification bar (shows when rewound outside revision mode) ──
    this.#buildNotification()
  }

  #buildNotification(): void {
    const bar = document.createElement('div')
    bar.id = 'hc-history-notification'
    bar.style.cssText = `
      position: fixed;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9000;
      display: none;
      align-items: center;
      gap: 10px;
      padding: 6px 14px;
      background: rgba(10, 12, 18, 0.92);
      border: 1px solid rgba(255, 170, 60, 0.3);
      border-radius: 6px;
      backdrop-filter: blur(8px);
      font-family: var(--hc-mono);
      font-size: 11px;
      color: rgba(255, 200, 120, 0.85);
      user-select: none;
      pointer-events: auto;
      white-space: nowrap;
    `

    const label = document.createElement('span')

    const btnStyle = (accent: boolean) => `
      cursor: pointer;
      padding: 2px 8px;
      border: 1px solid ${accent ? 'rgba(255, 170, 60, 0.4)' : 'rgba(200, 220, 240, 0.25)'};
      border-radius: 3px;
      background: ${accent ? 'rgba(255, 170, 60, 0.12)' : 'rgba(200, 220, 240, 0.06)'};
      color: ${accent ? 'rgba(255, 200, 120, 0.9)' : 'rgba(200, 220, 240, 0.7)'};
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.3px;
    `

    const restore = document.createElement('span')
    restore.textContent = 'Restore'
    restore.title = 'Make this the current state'
    restore.style.cssText = btnStyle(true)
    restore.addEventListener('click', () => this.#promote())

    const latest = document.createElement('span')
    latest.textContent = 'Jump to latest'
    latest.title = 'Discard undo position'
    latest.style.cssText = btnStyle(false)
    latest.addEventListener('click', () => {
      const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
      cursor?.jumpToLatest()
    })

    const close = document.createElement('span')
    close.textContent = '×'
    close.title = 'Close'
    close.style.cssText = `
      cursor: pointer;
      padding: 0 6px;
      margin-left: 2px;
      color: rgba(200, 220, 240, 0.5);
      font-weight: 600;
      font-size: 14px;
      line-height: 1;
    `
    close.addEventListener('click', () => {
      this.#notifOpen = false
      this.#syncUI()
    })

    bar.append(label, restore, latest, close)
    document.body.appendChild(bar)

    this.#notification = bar
    this.#notifLabel = label
    this.#notifRestore = restore
    this.#notifLatest = latest
    this.#notifClose = close
  }

  // ── sync UI ────────────────────────────────────────────────

  #syncUI(): void {
    if (!this.#clock || !this.#timeLabel || !this.#posLabel || !this.#restoreBtn || !this.#latestBtn || !this.#scopeLabel || !this.#activityLabel || !this.#scrubber) return

    const { position, total, rewound, at } = this.#state

    // ── Compact notification bar (sticky after first undo) ──
    this.#syncNotification(rewound, position, total)

    // ── Full revision clock (only in /revise mode) ──
    const shouldShowClock = this.#reviseActive && total > 0

    if (!shouldShowClock) {
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

    // Activity label — just show position; detailed diff per-layer is a
    // future concern (would be derived from diffLayers, not stored ops).
    this.#activityLabel.textContent = ''

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
    this.#latestBtn.style.display = rewound ? 'inline-block' : 'none'
  }

  #syncNotification(rewound: boolean, position: number, total: number): void {
    if (!this.#notification || !this.#notifLabel || !this.#notifRestore || !this.#notifLatest) return

    // "First undo" is tracked per-location — switching layers resets the
    // sticky state so an unrelated layer doesn't open with a stale bar.
    if (this.#state.locationSig !== this.#notifLastLocationSig) {
      this.#notifLastLocationSig = this.#state.locationSig
      this.#notifOpen = false
      this.#notifLastRewound = false
    }

    // Open on the edge into rewound (the first undo), outside revision mode.
    // Once open, stays open until the × close button fires.
    if (rewound && !this.#notifLastRewound && !this.#reviseActive) {
      this.#notifOpen = true
    }
    this.#notifLastRewound = rewound

    const shouldDisplay = this.#notifOpen && !this.#reviseActive

    if (!shouldDisplay) {
      if (this.#notifVisible) {
        this.#notification.style.display = 'none'
        this.#notifVisible = false
      }
      return
    }

    if (!this.#notifVisible) {
      this.#notification.style.display = 'flex'
      this.#notifVisible = true
    }

    // Restore / Jump-to-latest only apply while rewound; hide them at head
    // so the sticky bar keeps just the status text + close affordance.
    if (rewound) {
      const stepsBack = total - position
      this.#notifLabel.textContent = `${stepsBack} step${stepsBack === 1 ? '' : 's'} back`
      this.#notifRestore.style.display = 'inline-block'
      this.#notifLatest.style.display = 'inline-block'
    } else {
      this.#notifLabel.textContent = 'At latest'
      this.#notifRestore.style.display = 'none'
      this.#notifLatest.style.display = 'none'
    }
  }
}

const _historySliderDrone = new HistorySliderDrone()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistorySliderDrone', _historySliderDrone)
