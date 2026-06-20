// hypercomb-shared/ui/contact-card/contact-hover.component.ts
//
// The contact-details overlay. Holds a LIST of cards:
//
//   • one transient "peek" — appears while the pointer hovers a contact tile
//     (ContactDrone emits `contact:hover-show`) and fades shortly after the
//     pointer leaves (unless the pointer is on it, so links stay clickable).
//     Not draggable, no close button — it's ephemeral.
//
//   • any number of PINNED cards — clicking a contact tile emits
//     `contact:hover-pin`; that card sticks until the viewer closes it (× or
//     the Escape cascade). Each pinned card is INDEPENDENTLY draggable and
//     stacks (new pins cascade-offset; clicking/dragging brings to front).
//     Positions are participant-local (localStorage, keyed by tile label) —
//     never in the layer.
//
// Shell UI — must NOT import essentials. "Save (.vcf)" exports the card so a
// viewer can import the shared contact into their own address book.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { downloadVCard, type ContactFields } from './vcard'

type ContactCard = ContactFields & { decorationSig: string }
type HoverPayload = { label?: string; segments?: string[]; contacts?: ContactCard[] }

/** A rendered card. `ephemeral` is the single hover peek; everything else is a
 *  pinned card the viewer parked deliberately. */
interface Panel {
  id: number
  ephemeral: boolean
  label: string
  segments: string[]
  contacts: ContactCard[]
  pos: { x: number; y: number }
}

const POS_KEY = 'hc:contact-pins-pos'   // { [label]: { x, y } }
const HIDE_DELAY_MS = 260
const PANEL_W = 360
const CASCADE_STEP = 26                  // px each fresh pin is offset to fan out
const PEEK_ID = 0                        // reserved id for the lone hover peek

@Component({
  selector: 'hc-contact-hover',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './contact-hover.component.html',
  styleUrls: ['./contact-hover.component.scss'],
})
export class ContactHoverComponent implements OnDestroy {

  /** Render order = stack order (later = on top). At most one ephemeral entry. */
  readonly panels = signal<Panel[]>([])

  #cleanups: (() => void)[] = []
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #peekPointerInside = false
  #savedPos: Record<string, { x: number; y: number }> = this.#loadPos()
  #nextId = 1
  #pinnedAnnounced = false

  // drag state (pinned cards only)
  #dragId: number | null = null
  #dragOffset = { x: 0, y: 0 }

  constructor() {
    this.#cleanups.push(EffectBus.on<HoverPayload>('contact:hover-show', (p) => {
      if (!p) return
      const label = p.label ?? ''
      const segments = this.#segsOf(p)
      const contacts = this.#cardsOf(p)
      const pinned = this.panels().find(x => !x.ephemeral && x.label === label)
      if (pinned) {
        // Already pinned — refresh it in place (e.g. a card was just edited)
        // rather than stacking a duplicate peek on top of it.
        this.#updatePanel(pinned.id, segments, contacts)
        this.#hidePeek()
        return
      }
      this.#cancelHide()
      this.#showPeek(label, segments, contacts)
    }))

    // Tile clicked → pin a card that stays until closed.
    this.#cleanups.push(EffectBus.on<HoverPayload>('contact:hover-pin', (p) => {
      if (!p?.label) return
      this.#pin(p.label, this.#segsOf(p), this.#cardsOf(p))
    }))

    this.#cleanups.push(EffectBus.on('contact:hover-hide', () => {
      // Only the peek auto-hides; pinned cards are unaffected.
      if (this.#peekPointerInside) return
      this.#scheduleHide()
    }))

    // The Escape cascade closes the front-most pinned card (one per press).
    this.#cleanups.push(EffectBus.on('contact:hover-unpin', () => {
      const list = this.panels()
      for (let i = list.length - 1; i >= 0; i--) {
        if (!list[i].ephemeral) { this.closePanel(list[i].id); return }
      }
    }))
  }

  ngOnDestroy(): void {
    this.#cancelHide()
    this.#detachDrag()
    if (this.#pinnedAnnounced) EffectBus.emit('contact:pinned', { active: false })
    for (const c of this.#cleanups) c()
  }

  // ── payload normalization ─────────────────────────────
  #segsOf(p: HoverPayload): string[] { return Array.isArray(p.segments) ? p.segments.map(String) : [] }
  #cardsOf(p: HoverPayload): ContactCard[] { return Array.isArray(p.contacts) ? p.contacts : [] }

  // ── peek (transient hover) ────────────────────────────
  onPeekEnter(panel: Panel): void {
    if (!panel.ephemeral) return
    this.#peekPointerInside = true
    this.#cancelHide()
  }

  onPeekLeave(panel: Panel): void {
    if (!panel.ephemeral) return
    this.#peekPointerInside = false
    this.#scheduleHide()
  }

  #showPeek(label: string, segments: string[], contacts: ContactCard[]): void {
    const peek: Panel = { id: PEEK_ID, ephemeral: true, label, segments, contacts, pos: this.#basePos() }
    this.panels.update(list => [...list.filter(x => x.id !== PEEK_ID), peek])
  }

  #hidePeek(): void {
    this.#peekPointerInside = false
    this.panels.update(list => list.filter(x => x.id !== PEEK_ID))
  }

  #scheduleHide(): void {
    this.#cancelHide()
    this.#hideTimer = setTimeout(() => this.#hidePeek(), HIDE_DELAY_MS)
  }

  #cancelHide(): void {
    if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = null }
  }

  // ── pin / stack ───────────────────────────────────────
  #pin(label: string, segments: string[], contacts: ContactCard[]): void {
    this.#hidePeek()
    const existing = this.panels().find(x => !x.ephemeral && x.label === label)
    if (existing) {
      // Re-clicking an already-pinned tile refreshes it and floats it up.
      this.#updatePanel(existing.id, segments, contacts)
      this.#bringToFront(existing.id)
      return
    }
    const panel: Panel = {
      id: this.#nextId++,
      ephemeral: false,
      label, segments, contacts,
      pos: this.#nextPinPos(label),
    }
    this.panels.update(list => [...list, panel])
    this.#announce()
  }

  closePanel(id: number): void {
    this.panels.update(list => list.filter(x => x.id !== id))
    this.#announce()
  }

  onPanelFocus(panel: Panel): void {
    if (panel.ephemeral) return
    this.#bringToFront(panel.id)
  }

  #bringToFront(id: number): void {
    this.panels.update(list => {
      const i = list.findIndex(x => x.id === id)
      if (i < 0 || i === list.length - 1) return list
      const copy = list.slice()
      const [p] = copy.splice(i, 1)
      copy.push(p)
      return copy
    })
  }

  #updatePanel(id: number, segments: string[], contacts: ContactCard[]): void {
    this.panels.update(list => list.map(x => x.id === id ? { ...x, segments, contacts } : x))
  }

  /** Tell the Escape cascade (essentials) whether any pinned card is up, so
   *  Escape dismisses cards before falling through to clearing the selection. */
  #announce(): void {
    const active = this.panels().some(x => !x.ephemeral)
    if (active === this.#pinnedAnnounced) return
    this.#pinnedAnnounced = active
    EffectBus.emit('contact:pinned', { active })
  }

  // ── card actions ──────────────────────────────────────
  saveVCard(c: ContactCard): void {
    downloadVCard(c)
  }

  remove(panel: Panel, c: ContactCard): void {
    EffectBus.emit('contact:remove', { decorationSig: c.decorationSig, segments: panel.segments })
    const remaining = panel.contacts.filter(x => x.decorationSig !== c.decorationSig)
    if (remaining.length === 0) {
      if (panel.ephemeral) this.#hidePeek(); else this.closePanel(panel.id)
      return
    }
    this.panels.update(list => list.map(x => x.id === panel.id ? { ...x, contacts: remaining } : x))
  }

  websiteHref(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`
  }

  // ── drag (pinned cards only) ──────────────────────────
  onHeaderDown(event: PointerEvent, panel: Panel): void {
    if (panel.ephemeral) return
    this.startDrag(event, panel.id)
  }

  startDrag(event: PointerEvent, id: number): void {
    if (event.button !== 0) return
    event.preventDefault()
    this.#bringToFront(id)
    const panel = this.panels().find(x => x.id === id)
    if (!panel) return
    this.#dragId = id
    this.#dragOffset = { x: event.clientX - panel.pos.x, y: event.clientY - panel.pos.y }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragEnd)
  }

  #onDragMove = (event: PointerEvent): void => {
    if (this.#dragId === null) return
    const pos = this.#clamp(event.clientX - this.#dragOffset.x, event.clientY - this.#dragOffset.y)
    this.panels.update(list => list.map(x => x.id === this.#dragId ? { ...x, pos } : x))
  }

  #onDragEnd = (): void => {
    if (this.#dragId === null) return
    const panel = this.panels().find(x => x.id === this.#dragId)
    if (panel) { this.#savedPos[panel.label] = panel.pos; this.#savePos() }
    this.#dragId = null
    this.#detachDrag()
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragEnd)
  }

  #clamp(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(0, window.innerWidth - PANEL_W - 8)
    const maxY = Math.max(0, window.innerHeight - 80)
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) }
  }

  // ── positions ─────────────────────────────────────────
  #basePos(): { x: number; y: number } {
    // Docked near the top-right, leaving room for the header chrome.
    const x = typeof window !== 'undefined' ? Math.max(8, window.innerWidth - PANEL_W - 24) : 24
    return { x, y: 96 }
  }

  #nextPinPos(label: string): { x: number; y: number } {
    const saved = this.#savedPos[label]
    if (saved) return this.#clamp(saved.x, saved.y)
    // Never-parked label → cascade down-left from the dock so stacks fan out.
    const base = this.#basePos()
    const n = this.panels().filter(x => !x.ephemeral).length
    return this.#clamp(base.x - n * CASCADE_STEP, base.y + n * CASCADE_STEP)
  }

  // ── position persistence ──────────────────────────────
  #loadPos(): Record<string, { x: number; y: number }> {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (raw) {
        const o = JSON.parse(raw)
        if (o && typeof o === 'object') return o as Record<string, { x: number; y: number }>
      }
    } catch { /* ignore */ }
    return {}
  }

  #savePos(): void {
    try { localStorage.setItem(POS_KEY, JSON.stringify(this.#savedPos)) } catch { /* ignore */ }
  }
}
