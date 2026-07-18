// diamondcoreprocessor.com/contact/contact.drone.ts
//
// The contact worker. Three jobs, all over EffectBus so the shell UI stays
// out of essentials:
//
//   CLICK  — the contact icon emits `tile:action {action:'contact'}`; we
//            answer with `contact:form-open` carrying the tile + its current
//            cards so the form (shell UI) can add/edit.
//
//   WRITE  — the form emits `contact:form-submit {segments, contact}`; we
//            persist it as a `visual:contact:card` decoration (and ensure the
//            capability marker is present). `contact:remove` detaches a card.
//
//   HOVER  — TileOverlayDrone emits `tile:hover {label,q,r}`. When the
//            hovered tile carries contact cards (sync hasDecorationKind), we
//            read them and emit `contact:hover-show {label, contacts}` so the
//            draggable hover panel can render the details on the side; an
//            empty hover emits `contact:hover-hide`.
//
// Mirrors FileDropDrone: a Drone that registers its EffectBus handlers in
// heartbeat and resolves services from IoC lazily.

import { Drone, EffectBus, normalizeCell } from '@hypercomb/core'
import {
  writeContact,
  listContacts,
  removeContact,
  type ContactPayload,
} from './contact-card.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type ContactServiceLike = { active(): boolean; hasCards(label: string): boolean }

/** The shell-side icon registry contract (defined locally — essentials must
 *  not import shared). A feature contributes ONE provider declaring the
 *  profiles it lives in + whether it joins the default arrangement; the
 *  arranger (tile-actions) folds it into the overlay with no core edit. */
type IconProviderRegistryLike = {
  add(p: {
    name: string
    owner?: string
    svgMarkup: string
    profiles?: readonly string[]
    defaultActive?: boolean
    featureRow?: boolean
    hoverTint?: number
    visibleWhen?: (ctx: { label?: string }) => boolean
    labelKey?: string
    descriptionKey?: string
  }): void
  remove(name: string): void
}

/** Material "article_person" glyph (white fill so the overlay tint multiplies
 *  clean). Lives WITH the feature — the icon art is not the core catalog's
 *  concern. */
const CONTACT_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="24" height="24" fill="white"><path d="M280-600h400v-80H280v80Zm-80 480q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v258q-23-45-66-71.5T680-600q-45 0-84 21t-65 59H280v80h221q-2 20 0 40t9 40H280v80h157q-19 22-28 48.5t-9 55.5v56H200Zm280 0v-56q0-24 12.5-44.5T528-250q36-15 74.5-22.5T680-280q39 0 77.5 7.5T832-250q23 9 35.5 29.5T880-176v56H480Zm200-200q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29Z"/></svg>'

const lastOf = (a: readonly string[]): string => (a.length ? a[a.length - 1] : '')

export class ContactDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'contact'

  public override description =
    'Owns the contact-card beehavior: opens the form on the tile icon, writes cards to the layer, and feeds the draggable hover panel.'

  protected override emits = ['contact:form-open', 'contact:hover-show', 'contact:hover-hide', 'contact:hover-pin']
  protected override listens = [
    'tile:action', 'tile:hover', 'tile:click', 'render:cell-count',
    'contact:form-submit', 'contact:remove', 'contacts:changed',
  ]

  #effectsRegistered = false
  /** label currently driving the hover panel (avoid redundant re-emits). */
  #hoverLabel: string | null = null
  /** label → cards cache; invalidated on contacts:changed for that label. */
  readonly #cardCache = new Map<string, Array<{ sig: string; payload: ContactPayload }>>()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    // Contribute the contact overlay icon through the ONE declarative
    // extension point (IconProviderRegistry) — no edit to tile-actions'
    // core catalog. One provider, several profiles, auto-joins the default
    // arrangement; the click is handled by the `tile:action` listener below.
    const iconRegistry = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/IconProviderRegistry') as IconProviderRegistryLike | undefined
    iconRegistry?.add({
      name: 'contact',
      owner: this.iocKey,
      svgMarkup: CONTACT_ICON_SVG,
      profiles: ['private', 'public-own'],
      defaultActive: true,
      // Contact cards are a tile FEATURE — surfaced by ⋮ on the feature row.
      featureRow: true,
      hoverTint: 0xa8ffd8,
      visibleWhen: (ctx) => this.#iconVisible(ctx?.label),
      labelKey: 'action.contact',
      descriptionKey: 'action.contact.description',
    })

    // Contact icon clicked → open the form for that tile (prefilled if a
    // single card already exists, so the icon also edits). Tapping the tile
    // BODY (the default `open` action) instead PINS the details panel so it
    // stays put until the viewer closes it.
    this.onEffect<{ action: string; label: string }>('tile:action', (p) => {
      if (!p?.label) return
      if (p.action === 'contact') { void this.#openForm(p.label); return }
      if (p.action === 'open') void this.#pin(p.label)
    })

    // Selection/modifier clicks route through `tile:click` rather than the
    // default `open` action — pin from there too so any tap on a contact
    // tile locks its details open.
    this.onEffect<{ label?: string }>('tile:click', (p) => {
      if (p?.label) void this.#pin(p.label)
    })

    // Form submitted detail fields → persist (the name comes from the tile).
    this.onEffect<{ segments?: string[]; label?: string; contact?: Partial<ContactPayload> }>('contact:form-submit', (p) => {
      if (!p?.contact) return
      const segments = this.#segmentsFor(p)
      if (!segments) return
      void this.#saveContact(segments, p.contact)
    })

    // Hover panel asked to detach a card.
    this.onEffect<{ decorationSig?: string; segments?: string[] }>('contact:remove', (p) => {
      if (!p?.decorationSig || !p.segments) return
      removeContact(p.decorationSig, p.segments)
    })

    // Hovered tile changed → show/hide the side panel.
    this.onEffect<{ label?: string; q: number; r: number }>('tile:hover', (p) => {
      void this.#onHover(p?.label ?? null)
    })

    // A card was added/removed on some tile (the `contacts` slot changed) —
    // drop its cache and refresh the panel if it's the one we're showing.
    this.onEffect<{ segments?: readonly string[] }>('contacts:changed', (p) => {
      const label = p?.segments ? lastOf(p.segments) : null
      if (!label) return
      this.#cardCache.delete(label)
      if (label === this.#hoverLabel) void this.#emitHover(label, true)
    })
  }

  // ── form ──────────────────────────────────────────────────────

  async #openForm(label: string): Promise<void> {
    const segments = [...this.#parentSegments(), label]
    const existing = await this.#cardsFor(label).catch(() => [])
    EffectBus.emit('contact:form-open', {
      label,
      segments,
      // Prefill from the most recent card when editing a single-card tile.
      prefill: existing.length === 1 ? existing[0].payload : null,
    })
  }

  async #saveContact(segments: readonly string[], contact: Partial<ContactPayload>): Promise<void> {
    // The NAME is the tile's grammar — authoritative, never the form input.
    const clean: ContactPayload = {
      name: lastOf(segments) || 'contact',
      ...trimField('organization', contact.organization),
      ...trimField('title', contact.title),
      ...trimField('phone', contact.phone),
      ...trimField('email', contact.email),
      ...trimField('website', contact.website),
      ...trimField('address', contact.address),
      ...trimField('note', contact.note),
    }
    try {
      // Upsert: a tile IS one contact (named by its grammar), so replace any
      // existing card rather than appending a second one with the same name.
      const existing = await listContacts(segments).catch(() => [])
      for (const c of existing) removeContact(c.sig, segments)
      await writeContact(segments, clean)
      EffectBus.emit('activity:log', { message: `saved contact "${clean.name}"`, icon: '◈' })
    } catch (err) {
      console.warn('[contact] save failed', err)
    }
  }

  // ── hover ─────────────────────────────────────────────────────

  async #onHover(label: string | null): Promise<void> {
    if (!label) { this.#hideHover(); return }
    if (label === this.#hoverLabel) return
    // Sync gate — only tiles that actually carry cards drive the panel
    // (ContactService's `contacts`-slot presence index; no per-hover read).
    if (!this.#service()?.hasCards(label)) { this.#hideHover(); return }
    this.#hoverLabel = label
    await this.#emitHover(label, false)
  }

  async #emitHover(label: string, force: boolean): Promise<void> {
    const cards = await this.#cardsFor(label).catch(() => [])
    // Lost the race (cursor moved on) — don't clobber the newer hover.
    if (!force && label !== this.#hoverLabel) return
    if (cards.length === 0) { this.#hideHover(); return }
    EffectBus.emit('contact:hover-show', {
      label,
      segments: [...this.#parentSegments(), label],
      contacts: cards.map(c => ({ ...c.payload, decorationSig: c.sig })),
    })
  }

  #hideHover(): void {
    if (this.#hoverLabel === null) return
    this.#hoverLabel = null
    EffectBus.emit('contact:hover-hide', {})
  }

  /** Pin the details panel to a contact tile so it persists until the viewer
   *  closes it. Every tile tap routes through here, so it's a silent no-op
   *  for tiles that carry no cards. */
  async #pin(label: string): Promise<void> {
    if (!this.#service()?.hasCards(label)) return
    const cards = await this.#cardsFor(label).catch(() => [])
    if (cards.length === 0) return
    EffectBus.emit('contact:hover-pin', {
      label,
      segments: [...this.#parentSegments(), label],
      contacts: cards.map(c => ({ ...c.payload, decorationSig: c.sig })),
    })
  }

  // ── helpers ───────────────────────────────────────────────────

  /** The contact icon's visibility predicate (registered with the icon
   *  provider). Shows where contact is enabled for the current subtree (a
   *  parent ran `/contact`) OR the tile already carries a card. */
  #iconVisible(label?: string): boolean {
    if (!label) return false
    const svc = this.#service()
    return (svc?.active?.() ?? false) || (svc?.hasCards?.(label) ?? false)
  }

  #service(): ContactServiceLike | undefined {
    return (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@diamondcoreprocessor.com/ContactService') as ContactServiceLike | undefined
  }

  async #cardsFor(label: string): Promise<Array<{ sig: string; payload: ContactPayload }>> {
    const cached = this.#cardCache.get(label)
    if (cached) return cached
    const segments = [...this.#parentSegments(), label]
    const cards = await listContacts(segments)
    this.#cardCache.set(label, cards)
    return cards
  }

  #segmentsFor(p: { segments?: string[]; label?: string }): string[] | null {
    if (Array.isArray(p.segments) && p.segments.length) return p.segments.map(String)
    if (p.label) return [...this.#parentSegments(), normalizeCell(p.label) || p.label]
    return null
  }

  #parentSegments(): string[] {
    const lineage = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Lineage') as LineageLike | undefined
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }
}

/** Spread-helper: include `{ [key]: trimmed }` only when non-empty. */
function trimField(key: keyof ContactPayload, value: string | undefined): Partial<ContactPayload> {
  const v = (value ?? '').trim()
  return v ? { [key]: v } : {}
}

const _contact = new ContactDrone()
window.ioc.register('@diamondcoreprocessor.com/ContactDrone', _contact)
