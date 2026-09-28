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

import { EffectBus, mountToolWindow, translateOr as t, type ToolWindow } from '@hypercomb/core'
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
/** The window's id: its session, its place in the lane, its width. */
export const OFFERS_WINDOW = 'offers'
const ACCENT = [201, 162, 39] as const

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

  #window: ToolWindow | null = null
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
      if (this.#window) { this.#render(); return }
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
    this.#window ??= mountToolWindow(this, {
      id: OFFERS_WINDOW,
      title: t('offers.title', 'Offers'),
      accent: ACCENT,
      className: 'hc-offers',
      defaultWidth: 360,
      minWidth: 260,
      onClose: () => this.close(),
    })
    this.#render()
  }

  close(): void {
    this.#window?.dispose()
    this.#window = null
  }

  get open$(): boolean { return !!this.#window }

  // ── the drawing: the window's own slice ─────────────────────────────────

  #render(): void {
    const body = this.#window?.body
    if (!body) return
    body.replaceChildren()

    let groups: OfferGroup[] = []
    try { groups = groupOffers(this.io.offered()) } catch { groups = [] }

    if (!groups.length) {
      body.appendChild(note('hc-tw-quiet', PANEL_EMPTY))
      if (this.#said) body.appendChild(note(`hc-tw-said is-${this.#said.tone}`, this.#said.text))
      return
    }

    body.appendChild(note('hc-offers-held', PANEL_HELD))

    for (const group of groups) {
      const section = document.createElement('section')
      section.className = 'hc-tw-card hc-offers-group'
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

    body.appendChild(note('hc-tw-quiet', PANEL_NOT_NOW))
    if (this.#said) body.appendChild(note(`hc-tw-said is-${this.#said.tone}`, this.#said.text))
  }

  #button(label: string, verb: 'place' | 'dismiss', group: OfferGroup): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = verb === 'place' ? 'hc-tw-button hc-offers-do is-primary' : 'hc-tw-button hc-offers-do'
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

/** Only this window's slice: the shell, header, body, cards, buttons and
 *  notes are the base layer's (core/panels/tool-window.ts). */
function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    ${SURFACE} { display: contents; }
    .hc-offers-held { font-size: 0.88em; }
    .hc-offers-origin {
      margin: 0; font-size: 0.95em; font-weight: 600; letter-spacing: 0.03em;
      color: var(--hc-window-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hc-offers-meaning { margin: 0.1rem 0 0.35rem; font-size: 0.82em; color: var(--hc-window-ink-faint); }
    .hc-offers-list { margin: 0 0 0.5rem; padding: 0; list-style: none; max-height: 30vh; overflow-y: auto; font-size: 0.88em; }
    .hc-offers-row { padding: 0.05rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hc-offers-acts { display: flex; gap: 0.35rem; }
    .hc-offers-acts > .hc-tw-button { flex: 1 1 0; }
  `
  document.head.appendChild(style)
}

// sharing/offers.queen.ts defines this element and adds it to the shell's surface registry
// (atomic-modules-plan.md): a dependency registers nothing.
export { SURFACE as OFFERS_SURFACE, OWNER as OFFERS_VIEW_KEY }
