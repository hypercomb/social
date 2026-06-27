// hypercomb-shared/ui/contact-card/contact-hover.component.ts
//
// The contact-details overlay. Composes PinnableHoverBase — hover a contact
// tile for an ephemeral peek (ContactDrone emits `contact:hover-show`), click
// it to pin a card that sticks until closed (`contact:hover-pin`). Pinned cards
// are independently draggable, stack/cascade, and — because contact opts into
// `persistent` — SURVIVE A REFRESH: they re-open at their saved position next
// session. Positions + open set are participant-local (localStorage), never the
// layer. This used to hand-roll the whole pin/drag/persist stack; that logic
// now lives once in PinnableHoverBase and every pinnable feature shares it.
//
// Shell UI — must NOT import essentials. "Save (.vcf)" exports the card so a
// viewer can import the shared contact into their own address book.

import { Component } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { downloadVCard, type ContactFields } from './vcard'
import { PinnableHoverBase, type PinnablePanel } from '../pinnable/pinnable-hover.base'

type ContactCard = ContactFields & { decorationSig: string }
type HoverPayload = { label?: string; segments?: string[]; contacts?: ContactCard[] }

/** Per-panel data. The base keys panels by tile label; we carry the segments
 *  (needed to act on a card) and the contact list alongside. */
export interface ContactData {
  label: string
  segments: string[]
  contacts: ContactCard[]
}

@Component({
  selector: 'hc-contact-hover',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './contact-hover.component.html',
  styleUrls: ['./contact-hover.component.scss'],
})
export class ContactHoverComponent extends PinnableHoverBase<ContactData> {

  protected get ns(): string { return 'contact' }
  protected get posKey(): string { return 'hc:contact-pins-pos' }
  protected override get panelWidth(): number { return 360 }
  // Contact cards are a "keep it on screen" feature — pins come back on reload.
  protected override get persistent(): boolean { return true }
  // …and they belong to the page they were pinned on: hide on navigate-away,
  // re-show on return (per-page persistence across refresh too).
  protected override get pageScoped(): boolean { return true }

  /** Current explorer location, joined — the page a pinned card belongs to.
   *  Mirrors ContactDrone's `#parentSegments()` so a card pinned while viewing
   *  this location re-appears at exactly the same location. */
  protected override currentPageKey(): string {
    const lineage = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  protected toPanel(payload: unknown): { key: string; data: ContactData } | null {
    const p = payload as HoverPayload | undefined
    if (!p?.label) return null
    const segments = Array.isArray(p.segments) ? p.segments.map(String) : []
    const contacts = Array.isArray(p.contacts) ? p.contacts : []
    return { key: p.label, data: { label: p.label, segments, contacts } }
  }

  // ── contact-specific card actions ─────────────────────
  saveVCard(c: ContactCard): void { downloadVCard(c) }

  websiteHref(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`
  }

  remove(panel: PinnablePanel<ContactData>, c: ContactCard): void {
    EffectBus.emit('contact:remove', { decorationSig: c.decorationSig, segments: panel.data.segments })
    const remaining = panel.data.contacts.filter(x => x.decorationSig !== c.decorationSig)
    if (remaining.length === 0) {
      // Last card gone: drop the peek, or close the pinned panel.
      if (panel.ephemeral) this.dismissPeek(); else this.closePanel(panel.id)
      return
    }
    this.updateData(panel.id, { ...panel.data, contacts: remaining })
  }
}
