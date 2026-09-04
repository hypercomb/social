// sharing/offers.view.ts
//
// THE OFFERS WINDOW — what the hosts you know have declared, held for you.
//
// ── A HOST DECLARES; YOU PLACE ──────────────────────────────────────────
//
// `published-pools.ts` probes every learned domain and HOLDS what verifies:
// nothing reaches a handler on a visit. This window lists what is held, by
// host and by meaning, and carries the only two acts a list may show:
// PLACE (the yes — `placeOffers`, the one path to a handler) and NOT NOW
// (drops the offer for this session; the host will say it again, and the
// window says so). Nothing is deleted anywhere, because nothing was written.
//
// ── OPENING READS MEMORY AND WRITES NOTHING ─────────────────────────────
//
// Offers live in memory in `published-pools.ts`. Opening this window reads
// that map. It does not probe, does not fetch, and does not touch a pool.
//
// ── AN ELEMENT, NOT A COMPONENT ─────────────────────────────────────────
//
// Module chrome is a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  dismissOffers,
  offeredPools,
  placeOffers,
  type PublishedOffer,
} from './published-pools.js'

export const OFFERS_OPEN = 'offers:open'
/** Emitted by the probe when a domain's verified members are held. */
export const OFFERS_OFFERED = 'published-pools:offered'
/** An open request older than this is stale — a replayed last value, not a press. */
export const OPEN_STAMP_MS = 5_000

const SURFACE = 'hc-offers'
const STYLE_ID = 'hc-offers-style'
const OWNER = '@diamondcoreprocessor.com/OffersView'

const STEEL = '126, 182, 214'
const ACCENT = '201, 162, 39'

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : interpolate(fallback, params)
  } catch { return interpolate(fallback, params) }
}

const interpolate = (text: string, params?: Record<string, string | number>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text

// ---------------------------------------------------------------------------
// THE WORDS
// ---------------------------------------------------------------------------

export const PANEL_EMPTY =
  'Nothing is on offer. When a host you know publishes something this hive understands, it appears here — and stays here until you place it.'
export const PANEL_HELD =
  'These were declared by hosts you have visited and verified against their signatures. None of them is in your hive. Placing one is your act.'
export const PANEL_NOT_NOW =
  '“Not now” drops an offer for this session. The host will offer it again the next time it is learned.'

/** What a held record is called on a row: its own id or name if it says one,
 *  else the first eight of its signature. Never the whole record. */
export const offerLabel = (offer: PublishedOffer): string => {
  const record = offer.record as Record<string, unknown> | null
  for (const key of ['id', 'name', 'title'] as const) {
    const value = record?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80)
  }
  return `${offer.sig.slice(0, 8)}…`
}

export interface OfferGroup {
  readonly origin: string
  readonly meaning: string
  readonly offers: readonly PublishedOffer[]
}

/** Group a flat offer list by origin, then meaning — sorted, so two reads of
 *  the same map draw the same window. */
export const groupOffers = (offers: readonly PublishedOffer[]): OfferGroup[] => {
  const groups = new Map<string, PublishedOffer[]>()
  for (const offer of offers) {
    const key = `${offer.origin}::${offer.meaning}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(offer)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const at = key.indexOf('::')
      return { origin: key.slice(0, at), meaning: key.slice(at + 2), offers: list }
    })
}

/** THE SEAM. Replaced wholesale in the spec, so no probe and no handler is
 *  reached there. */
export interface OffersIo {
  readonly offered: () => PublishedOffer[]
  readonly place: (origin: string, meaning: string) => Promise<string[]>
  readonly dismiss: (origin: string, meaning: string) => void
}

// ---------------------------------------------------------------------------
// THE ELEMENT
// ---------------------------------------------------------------------------

export class OffersElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #said: { text: string; tone: 'ok' | 'quiet' | 'bad' } | null = null
  #busy = false
  #cleanup: (() => void)[] = []
  #noticed = new Set<string>()

  io: OffersIo = {
    offered: () => offeredPools(),
    place: (origin, meaning) => placeOffers(origin, meaning),
    dismiss: (origin, meaning) => dismissOffers(origin, meaning),
  }

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<{ at?: number }>(OFFERS_OPEN, payload => {
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > OPEN_STAMP_MS) return
      this.open()
    }))
    // A new offer while the window is open redraws it; while closed, one
    // quiet notice per host-and-meaning names the window. Never opens it.
    this.#cleanup.push(EffectBus.on<{ origin?: string; meaning?: string; count?: number }>(OFFERS_OFFERED, payload => {
      if (this.#panel) { this.#render(); return }
      const key = `${payload?.origin ?? ''}::${payload?.meaning ?? ''}`
      if (!payload?.origin || this.#noticed.has(key)) return
      this.#noticed.add(key)
      EffectBus.emit('toast:show', {
        type: 'info',
        title: t('offers.toast.title', '{origin} is offering something', { origin: payload.origin }),
        message: t('offers.toast.message', '{count} {meaning} held for you. Type /offers to look. Nothing is placed until you say so.',
          { count: payload.count ?? 0, meaning: payload.meaning ?? '' }),
      })
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  open(): void {
    if (!this.#panel) {
      const panel = document.createElement('aside')
      panel.className = 'hc-offers'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', t('offers.title', 'Offers'))
      panel.tabIndex = -1
      panel.setAttribute('data-consumes-wheel', '')
      panel.addEventListener('keydown', this.#onKey)
      this.appendChild(panel)
      this.#panel = panel
    }
    this.#render()
  }

  close(): void {
    if (!this.#panel) return
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = null
  }

  get open$(): boolean { return !!this.#panel }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #head(): HTMLElement {
    const head = document.createElement('header')
    head.className = 'hc-offers-head'
    const title = document.createElement('span')
    title.className = 'hc-offers-title'
    title.textContent = t('offers.title', 'Offers')
    head.appendChild(title)
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-offers-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('panel.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.appendChild(close)
    return head
  }

  #render(): void {
    const panel = this.#panel
    if (!panel) return
    panel.replaceChildren()
    panel.appendChild(this.#head())

    const body = document.createElement('div')
    body.className = 'hc-offers-body'
    panel.appendChild(body)

    let groups: OfferGroup[] = []
    try { groups = groupOffers(this.io.offered()) } catch { groups = [] }

    if (!groups.length) {
      body.appendChild(note('hc-offers-quiet', PANEL_EMPTY))
      if (this.#said) body.appendChild(note(`hc-offers-said is-${this.#said.tone}`, this.#said.text))
      return
    }

    body.appendChild(note('hc-offers-held', PANEL_HELD))

    for (const group of groups) {
      const section = document.createElement('section')
      section.className = 'hc-offers-group'
      section.dataset['origin'] = group.origin
      section.dataset['meaning'] = group.meaning

      const heading = document.createElement('h3')
      heading.className = 'hc-offers-origin'
      heading.textContent = group.origin
      section.appendChild(heading)
      const meaning = document.createElement('p')
      meaning.className = 'hc-offers-meaning'
      meaning.textContent = t('offers.meaning', '{count} × {meaning}', { count: group.offers.length, meaning: group.meaning })
      section.appendChild(meaning)

      const list = document.createElement('ul')
      list.className = 'hc-offers-list'
      for (const offer of group.offers.slice(0, 64)) {
        const row = document.createElement('li')
        row.className = 'hc-offers-row'
        row.textContent = offerLabel(offer)
        row.title = offer.sig
        list.appendChild(row)
      }
      section.appendChild(list)

      const acts = document.createElement('div')
      acts.className = 'hc-offers-acts'
      acts.appendChild(this.#button(t('offers.place', 'Place these'), 'place', group))
      acts.appendChild(this.#button(t('offers.not-now', 'Not now'), 'dismiss', group))
      section.appendChild(acts)

      body.appendChild(section)
    }

    body.appendChild(note('hc-offers-quiet', PANEL_NOT_NOW))
    if (this.#said) body.appendChild(note(`hc-offers-said is-${this.#said.tone}`, this.#said.text))
  }

  #button(label: string, verb: 'place' | 'dismiss', group: OfferGroup): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = verb === 'place' ? 'hc-offers-do is-place' : 'hc-offers-do'
    button.dataset['verb'] = verb
    button.textContent = label
    button.disabled = this.#busy
    button.addEventListener('click', () => { void this.act(verb, group.origin, group.meaning) })
    return button
  }

  /** THE ACT. The press is the yes; nothing above this line places. */
  async act(verb: 'place' | 'dismiss', origin: string, meaning: string): Promise<string[]> {
    if (this.#busy) return []
    this.#busy = true
    this.#said = null
    this.#render()
    try {
      if (verb === 'dismiss') {
        this.io.dismiss(origin, meaning)
        this.#said = { text: t('offers.said.dismissed', 'Set aside for this session. {origin} will offer it again.', { origin }), tone: 'quiet' }
        return []
      }
      const kept = await this.io.place(origin, meaning)
      this.#said = kept.length
        ? { text: t('offers.said.placed', 'Placed {n} from {origin}: {ids}', { n: kept.length, origin, ids: kept.join(', ') }), tone: 'ok' }
        : { text: t('offers.said.none', 'Nothing was placed. {origin} offered records this hive declined.', { origin }), tone: 'quiet' }
      return kept
    } catch (err) {
      this.#said = { text: t('offers.said.failed', 'Nothing was placed. {err}', { err: String(err) }), tone: 'bad' }
      return []
    } finally {
      this.#busy = false
      this.#render()
    }
  }
}

const note = (className: string, text: string): HTMLElement => {
  const p = document.createElement('p')
  p.className = className
  p.textContent = text
  return p
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* The same material as every other tool window — the recipe restated
       with the SHARED values, since a module cannot @use the stylesheet. */
    ${SURFACE} { display: contents; }
    .hc-offers {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: 360px; min-width: 260px; max-width: calc(100vw - 1.5rem);
      box-sizing: border-box; display: flex; flex-direction: column;
      z-index: 100002;
      background: rgba(13, 15, 21, 0.975);
      backdrop-filter: blur(14px) saturate(1.04);
      -webkit-backdrop-filter: blur(14px) saturate(1.04);
      border: 0; border-left: 1px solid rgba(${STEEL}, 0.38); border-radius: 0;
      box-shadow: -14px 0 44px rgba(0, 0, 0, 0.46);
      color: #eef2f5;
      font-family: var(--hc-mono, system-ui);
      font-size: calc(0.8125rem * var(--hc-panel-scale, 1));
      line-height: 1.45; overflow: hidden; outline: none;
    }
    .hc-offers-head {
      flex: 0 0 auto; box-sizing: border-box; display: flex; align-items: center;
      gap: 0.5rem; height: 2.875rem; min-height: 2.875rem; padding: 0 0.75rem;
      background: linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.006));
      border-bottom: 1px solid rgba(${STEEL}, 0.25);
    }
    .hc-offers-title {
      flex: 1; font-weight: 600; font-size: 0.9em; letter-spacing: 0.06em;
      text-transform: uppercase; color: rgba(${ACCENT}, 0.95);
    }
    .hc-offers-close {
      margin-left: auto; display: inline-grid; place-items: center;
      width: 1.75rem; height: 1.75rem; padding: 0;
      background: none; border: 0; border-radius: var(--hc-radius-control, 2px);
      color: rgba(238, 244, 248, 0.62); font: inherit; font-size: 1.125rem;
      line-height: 1; cursor: pointer;
    }
    .hc-offers-close:hover { color: #fff; background-color: rgba(255,255,255,0.075); }
    .hc-offers-body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 0.7rem 0.75rem 1.2rem;
    }
    .hc-offers-body > p { margin: 0 0 0.5rem; line-height: 1.55; }
    .hc-offers-quiet { color: rgba(238, 244, 248, 0.5); font-size: 0.85em; }
    .hc-offers-held { font-size: 0.88em; color: rgba(238, 244, 248, 0.8); }
    .hc-offers-group {
      margin: 0.6rem 0; padding: 0.5rem 0.55rem;
      border: 1px solid rgba(${STEEL}, 0.2); border-radius: var(--hc-radius-card, 3px);
      background: rgba(255, 255, 255, 0.02);
    }
    .hc-offers-origin {
      margin: 0; font-size: 0.95em; font-weight: 600; letter-spacing: 0.03em;
      color: rgba(${ACCENT}, 0.95); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hc-offers-meaning { margin: 0.1rem 0 0.35rem; font-size: 0.82em; color: rgba(${STEEL}, 0.9); }
    .hc-offers-list { margin: 0 0 0.5rem; padding: 0; list-style: none; max-height: 30vh; overflow-y: auto; font-size: 0.88em; }
    .hc-offers-row { padding: 0.05rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hc-offers-acts { display: flex; gap: 0.35rem; }
    .hc-offers-do {
      flex: 1 1 0; padding: 0.35rem 0.5rem;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(${STEEL}, 0.3); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.85em; letter-spacing: 0.05em;
      cursor: pointer;
    }
    .hc-offers-do:hover:not(:disabled) { border-color: rgba(${ACCENT}, 0.8); }
    .hc-offers-do:disabled { opacity: 0.45; cursor: default; }
    .hc-offers-do.is-place { border-color: rgba(${ACCENT}, 0.6); }
    .hc-offers-said {
      margin-top: 0.6rem; padding: 0.45rem 0.55rem; font-size: 0.88em;
      border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px;
    }
    .hc-offers-said.is-ok { border-color: rgba(${ACCENT}, 0.7); }
    .hc-offers-said.is-quiet { color: rgba(238, 244, 248, 0.62); }
    .hc-offers-said.is-bad { border-color: rgba(214, 126, 126, 0.75); }
  `
  document.head.appendChild(style)
}

;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    if (!customElements.get(SURFACE)) customElements.define(SURFACE, OffersElement)
    try {
      registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 142 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
