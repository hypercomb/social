// diamondcoreprocessor.com/contact/contact.service.ts
//
// Tracks which CONTAINERS are contact-enabled (`/contact`) and answers,
// synchronously, whether the CURRENT view sits inside one (here or via an
// ancestor — cascading, top-down). The overlay icon's `visibleWhen` is sync
// and runs per tile per hover, so resolution must be sync. Direct sibling of
// DropboxService — same two-source map (live `decorations:changed` +
// `render:cell-count` hydration), same ancestor walk.
//
// Meaning: a PARENT declares the contact behaviour; every descendant tile
// then shows the contact icon so a card can be added to it.

import { EffectBus } from '@hypercomb/core'
import { listContactEnabledHere, hasContactsAt, CONTACT_ENABLED_KIND } from './contact-card.js'

const get = (key: string): any => (window as any).ioc?.get?.(key)

type LineageLike = { explorerSegments?: () => readonly string[] }
type StoreLike = { getResource(sig: string): Promise<Blob | null> }

const keyOf = (segs: readonly string[]): string => segs.join(' ')

export class ContactService {
  /** joined-segments keys that carry the contact capability. */
  #enabled = new Set<string>()
  /** decoration sig → joined-segments key (so removeSig can subtract). */
  #sigKey = new Map<string, string>()
  /** hydration guard — capability keys already walked from committed layers. */
  #checked = new Set<string>()

  /** Full-segment keys (`[...parent,label]`) of tiles that carry ≥1 contact
   *  card in their `contacts` slot — the sync presence index that lets the
   *  overlay icon + hover gate stay synchronous without an OPFS read per tile
   *  per frame. Mirrors decoration-kind-index, but for the dedicated slot. */
  #cardKeys = new Set<string>()
  /** hydration guard — card keys already walked. */
  #checkedCards = new Set<string>()

  constructor() {
    EffectBus.on('render:cell-count', (p) => { this.#hydrate(); this.#hydrateCards(p as { labels?: readonly string[] }) })
    EffectBus.on('decorations:changed', (p) => { void this.#onDecorations(p as any) })
    EffectBus.on('contacts:changed', (p) => { void this.#onContacts(p as { segments?: readonly string[]; op?: string }) })
  }

  /** Is the current view inside a contact-enabled subtree (self or ancestor)?
   *  When true, the overlay shows the contact icon on every tile here. */
  active(): boolean { return this.#resolve() }

  /** Does the tile labelled `label` (a child of the current view) carry ≥1
   *  contact card? Sync — feeds the icon's `visibleWhen` + the hover gate, so
   *  a card stays visible even after `/contact off` (capability removed). */
  hasCards(label: string): boolean {
    return this.#cardKeys.has(keyOf([...this.#currentSegments(), label]))
  }

  /** Capability decoration sigs declared AT this exact location (for
   *  `/contact off`) — sync, no layer read. */
  sigsAt(segments: readonly string[]): string[] {
    const key = keyOf(segments.map(String))
    return [...this.#sigKey.entries()].filter(([, k]) => k === key).map(([sig]) => sig)
  }

  // ── internals ─────────────────────────────────────────────────

  #currentSegments(): string[] {
    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Nearest contact-enabled container covering the current view — self,
   *  then ancestors (root included). */
  #resolve(): boolean {
    const segs = this.#currentSegments()
    for (let depth = segs.length; depth >= 0; depth--) {
      if (this.#enabled.has(keyOf(segs.slice(0, depth)))) return true
    }
    return false
  }

  async #onDecorations(p?: { segments?: readonly string[]; op?: string; sig?: string }): Promise<void> {
    if (!p?.segments || !p?.sig || !p?.op) return
    const key = keyOf(p.segments.map(String))
    if (p.op === 'append') {
      const rec = await this.#fetchRecord(p.sig)
      if (rec?.kind === CONTACT_ENABLED_KIND) {
        this.#enabled.add(key)
        this.#sigKey.set(p.sig, key)
      }
    } else if (p.op === 'removeSig') {
      const k = this.#sigKey.get(p.sig)
      if (k !== undefined) {
        this.#sigKey.delete(p.sig)
        // drop the capability only when no other sig still maps to this location
        if (![...this.#sigKey.values()].includes(k)) this.#enabled.delete(k)
      }
    }
  }

  #hydrate(): void {
    const segs = this.#currentSegments()
    for (let depth = segs.length; depth >= 0; depth--) {
      const sub = segs.slice(0, depth)
      const key = keyOf(sub)
      if (this.#checked.has(key)) continue
      this.#checked.add(key)
      void this.#hydrateKey(sub, key)
    }
  }

  async #hydrateKey(sub: string[], key: string): Promise<void> {
    try {
      const found = await listContactEnabledHere(sub)
      if (found.length) {
        this.#enabled.add(key)
        for (const f of found) this.#sigKey.set(f.sig, key)
      }
    } catch {
      this.#checked.delete(key)  // transient read error — allow a retry
    }
  }

  // ── card presence (the dedicated `contacts` slot) ────────────

  /** On each render, walk the visible tiles' `contacts` slots once and record
   *  which carry cards. Cheap (slot length only); guarded so we don't re-walk
   *  an unchanged tile, and `contacts:changed` clears the guard for a tile that
   *  actually changed. */
  #hydrateCards(p?: { labels?: readonly string[] }): void {
    const labels = Array.isArray(p?.labels) ? p!.labels! : []
    if (!labels.length) return
    const parent = this.#currentSegments()
    for (const raw of labels) {
      const label = String(raw ?? '').trim()
      if (!label) continue
      const segs = [...parent, label]
      const key = keyOf(segs)
      if (this.#checkedCards.has(key)) continue
      this.#checkedCards.add(key)
      void this.#walkCard(segs, key)
    }
  }

  async #walkCard(segs: string[], key: string): Promise<void> {
    try {
      if (await hasContactsAt(segs)) this.#cardKeys.add(key)
      else this.#cardKeys.delete(key)
    } catch {
      this.#checkedCards.delete(key)  // transient read error — retry next render
    }
  }

  /** A card was added/removed on a tile — reflect it now (so the icon/hover
   *  update immediately) and force a re-walk on the next render to confirm. */
  async #onContacts(p?: { segments?: readonly string[]; op?: string }): Promise<void> {
    if (!p?.segments) return
    const segs = p.segments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (!segs.length) return
    const key = keyOf(segs)
    this.#checkedCards.delete(key)
    if (p.op === 'append') { this.#cardKeys.add(key); return }
    // removeSig / bare — re-read to see whether any card remains.
    try {
      if (await hasContactsAt(segs)) this.#cardKeys.add(key)
      else this.#cardKeys.delete(key)
    } catch { /* next render corrects */ }
  }

  async #fetchRecord(sig: string): Promise<{ kind?: string } | null> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      return blob ? JSON.parse(await blob.text()) : null
    } catch { return null }
  }
}

const _contact = new ContactService()
window.ioc.register('@diamondcoreprocessor.com/ContactService', _contact)
