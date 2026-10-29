// sharing/adopt-queue.view.ts
//
// <hc-adopt-queue> — what has been adopted, full screen, and what is still in
// transit. It reads AdoptQueueService (the sticky, signature-keyed work-list
// that outlives the swarm) and shows each owed signature's standing: fetching
// now, waiting for its next try, or an egg holding its place until a host
// serves the bytes — with who published it, whether they are still in the
// swarm, which host it is expected from and how long it has been asked.
// Below sit the ones that landed this session.
//
// A small chip stays in the corner while anything is owed and pulses when an
// adopt is added; click it (or emit `adopt-queue:open`) for the full screen.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// (swarm-adopt.drone.ts defines it) — all words are drawn as text, never markup.

import { EffectBus } from '@hypercomb/core'
import type { AdoptQueueDone, AdoptQueueEntry } from './adopt-queue.service.js'

export const ADOPT_QUEUE_SURFACE = 'hc-adopt-queue'
export const ADOPT_QUEUE_OWNER = '@diamondcoreprocessor.com/AdoptQueueView'
const QUEUE_KEY = '@diamondcoreprocessor.com/AdoptQueueService'
const STYLE_ID = 'hc-adopt-queue-style'
/** A publisher whose offer was seen inside this window is still in the swarm. */
const LIVE_MS = 60_000

interface QueueLike extends EventTarget {
  entries: readonly AdoptQueueEntry[]
  done: readonly AdoptQueueDone[]
  isActive: (sig: string, at: readonly string[]) => boolean
  clear: () => void
}

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    ${ADOPT_QUEUE_SURFACE} { display: contents; }
    .hc-aq-chip {
      position: fixed; right: 1rem; bottom: 4.5rem; z-index: 99990;
      padding: 0.3rem 0.7rem; font: inherit; font-size: 0.75rem; cursor: pointer;
      color: var(--hc-window-ink-plain, #ddd); background: rgba(20, 20, 24, 0.85);
      border: 1px solid var(--hc-window-accent, #c8975a); border-radius: 999px;
    }
    .hc-aq-chip[hidden], .hc-aq-screen[hidden] { display: none; }
    .hc-aq-chip.pulse { animation: hc-aq-pulse 700ms ease-out 2; }
    .hc-aq-screen {
      position: fixed; inset: 0; z-index: 100002; display: flex; flex-direction: column;
      background: rgba(10, 10, 14, 0.94); backdrop-filter: blur(8px);
      color: var(--hc-window-ink-plain, #ddd); font-family: var(--hc-mono, system-ui);
    }
    .hc-aq-head { display: flex; align-items: center; gap: 0.75rem; padding: 0.8rem 1.2rem; border-bottom: 1px solid var(--hc-window-line, #333); }
    .hc-aq-title { flex: 1; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--hc-window-ink-quiet, #999); }
    .hc-aq-btn { font: inherit; font-size: 0.75rem; cursor: pointer; background: none; color: var(--hc-window-ink-quiet, #999); border: 1px solid var(--hc-window-line, #333); border-radius: 4px; padding: 0.25rem 0.6rem; }
    .hc-aq-btn:hover { color: var(--hc-window-ink-loud, #fff); }
    .hc-aq-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0.8rem 1.2rem 1.5rem; }
    .hc-aq-body h4 { margin: 1rem 0 0.4rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--hc-window-accent, #c8975a); }
    .hc-aq-row { display: grid; grid-template-columns: 0.7rem minmax(6rem, 1fr) minmax(0, 2fr) 5rem minmax(5rem, 1fr) minmax(10rem, 2fr); align-items: baseline; gap: 0.8rem; padding: 0.35rem 0.2rem; font-size: 0.78rem; border-bottom: 1px solid var(--hc-window-line, #222); }
    .hc-aq-row > span { color: var(--hc-window-ink-quiet, #999); overflow: hidden; text-overflow: ellipsis; }
    .hc-aq-row .name { color: var(--hc-window-ink-plain, #ddd); }
    .hc-aq-row .sig { font-family: monospace; }
    .hc-aq-row .dot { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: #888; }
    .hc-aq-row[data-state='fetching'] .dot { background: #7cc4ff; animation: hc-aq-pulse 900ms ease-out infinite; }
    .hc-aq-row[data-state='egg'] .dot { background: #e8c46a; }
    .hc-aq-row[data-state='done'] .dot { background: #7fd49a; }
    .hc-aq-row .gone { color: #e8a06a; }
    .hc-aq-empty { margin: 0.4rem 0; font-size: 0.78rem; color: var(--hc-window-ink-quiet, #888); }
    @keyframes hc-aq-pulse { 0% { box-shadow: 0 0 0 0 rgba(200, 151, 90, 0.7); } 100% { box-shadow: 0 0 0 0.7rem rgba(200, 151, 90, 0); } }
    @media (max-width: 599px) {
      .hc-aq-row { grid-template-columns: 0.7rem 1fr; }
      .hc-aq-row > span:nth-child(n+3) { grid-column: 2; }
    }
  `
  document.head.appendChild(style)
}

const span = (cls: string, text: string): HTMLSpanElement => {
  const s = document.createElement('span')
  if (cls) s.className = cls
  s.textContent = text
  return s
}

export class AdoptQueueElement extends HTMLElement {
  #queue: QueueLike | undefined
  #open = false
  #chip: HTMLButtonElement | null = null
  #screen: HTMLDivElement | null = null
  #off: Array<() => void> = []
  #tick: ReturnType<typeof setInterval> | undefined
  #pulseTimer: ReturnType<typeof setTimeout> | undefined

  connectedCallback(): void {
    ensureStyles()
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'hc-aq-chip'
    chip.hidden = true
    chip.addEventListener('click', () => this.#show(true))
    const screen = document.createElement('div')
    screen.className = 'hc-aq-screen'
    screen.hidden = true
    screen.setAttribute('role', 'dialog')
    screen.setAttribute('aria-label', 'adopt queue')
    this.append(chip, screen)
    this.#chip = chip
    this.#screen = screen

    const render = (): void => this.#render()
    const ioc = (window as { ioc?: { whenReady?: (k: string, cb: (v: QueueLike) => void) => void } }).ioc
    ioc?.whenReady?.(QUEUE_KEY, q => {
      this.#queue = q
      q.addEventListener('change', render)
      this.#off.push(() => q.removeEventListener('change', render))
      render()
    })
    this.#off.push(
      EffectBus.on('adopt-queue:open', () => this.#show(true)),
      EffectBus.on('adopt:queued', () => {
        chip.classList.remove('pulse')
        clearTimeout(this.#pulseTimer)
        // Next frame, so a second adopt replays the animation.
        requestAnimationFrame(() => chip.classList.add('pulse'))
        this.#pulseTimer = setTimeout(() => chip.classList.remove('pulse'), 1400)
      }),
      EffectBus.on<{ cmd: string }>('keymap:invoke', p => {
        if (p?.cmd === 'global.escape' && this.#open) this.#show(false)
      }),
    )
    this.#tick = setInterval(() => { if (this.#open) render() }, 1000)
  }

  disconnectedCallback(): void {
    for (const off of this.#off) off()
    this.#off = []
    clearInterval(this.#tick)
    clearTimeout(this.#pulseTimer)
    this.replaceChildren()
    this.#chip = this.#screen = null
  }

  #show(open: boolean): void {
    this.#open = open
    this.#render()
  }

  #render(): void {
    const chip = this.#chip
    const screen = this.#screen
    const q = this.#queue
    if (!chip || !screen) return
    const owed = q?.entries ?? []
    chip.hidden = this.#open || owed.length === 0
    chip.textContent = `${owed.length} in transit`
    screen.hidden = !this.#open
    if (!this.#open || !q) return

    const now = Date.now()
    const head = document.createElement('div')
    head.className = 'hc-aq-head'
    head.append(span('hc-aq-title', `adopted · ${owed.length} in transit · ${q.done.length} landed`))
    if (owed.length > 0) {
      const stop = document.createElement('button')
      stop.type = 'button'; stop.className = 'hc-aq-btn'; stop.textContent = 'stop asking'
      stop.addEventListener('click', () => q.clear())
      head.append(stop)
    }
    const close = document.createElement('button')
    close.type = 'button'; close.className = 'hc-aq-btn'; close.textContent = '×'
    close.setAttribute('aria-label', 'close')
    close.addEventListener('click', () => this.#show(false))
    head.append(close)

    const body = document.createElement('div')
    body.className = 'hc-aq-body'
    const section = (title: string, rows: HTMLElement[], empty: string): void => {
      const h = document.createElement('h4')
      h.textContent = title
      body.append(h)
      if (rows.length === 0) {
        const p = document.createElement('p')
        p.className = 'hc-aq-empty'; p.textContent = empty
        body.append(p)
      } else body.append(...rows)
    }

    const row = (state: string, cells: [string, string][]): HTMLDivElement => {
      const r = document.createElement('div')
      r.className = 'hc-aq-row'
      r.dataset['state'] = state
      r.append(span('dot', ''), ...cells.map(([cls, text]) => span(cls, text)))
      return r
    }

    const owedRows = owed.map(e => {
      const state = q.isActive(e.sig, e.at) ? 'fetching' : e.egg ? 'egg' : 'waiting'
      const retryIn = Math.max(0, Math.ceil((e.nextAt - now) / 1000))
      const what = state === 'fetching' ? 'fetching now'
        : state === 'egg' ? `egg · waiting for a host · retry in ${retryIn}s`
        : `waiting · try ${e.tries + 1} in ${retryIn}s`
      const asked = e.addedAt ? ` · asked ${ago(now - e.addedAt)} ago` : ''
      const live = !!e.pubkey && now - (e.seenAt ?? 0) < LIVE_MS
      const who = !e.pubkey ? ''
        : live ? ` · publisher ${e.pubkey.slice(0, 8)} in the swarm`
        : ` · publisher ${e.pubkey.slice(0, 8)} left ${ago(now - (e.seenAt ?? 0))} ago — the host is the way`
      const r = row(state, [
        ['name', e.label],
        ['', ['', ...e.at, e.label].join('/')],
        ['sig', e.sig.slice(0, 8)],
        ['', e.domain || 'any host'],
        ['', `${what}${asked}${who}`],
      ])
      if (e.pubkey && !live) r.lastElementChild?.classList.add('gone')
      return r
    })
    const landedRows = q.done.map(d => row('done', [
      ['name', d.label],
      ['', ['', ...d.at, d.label].join('/')],
      ['sig', d.sig.slice(0, 8)],
      ['', ''],
      ['', `in your hive · ${ago(now - d.doneAt)} ago`],
    ]))
    section('in transit', owedRows, 'nothing in transit')
    section('landed', landedRows, 'nothing landed yet this session')
    screen.replaceChildren(head, body)
  }
}
