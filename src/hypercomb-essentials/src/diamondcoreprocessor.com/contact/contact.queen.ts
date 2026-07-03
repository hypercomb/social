// diamondcoreprocessor.com/contact/contact.queen.ts
//
// /contact — turn the current location (and its whole subtree) contact-
// enabled. This is the "parent decorates the lineage from the top down"
// worker: it writes a `visual:contact:enabled` decoration on the current
// container; ContactService resolves it by walking the lineage upward, so
// every descendant tile shows the contact icon (cascading). Click a tile's
// icon to add a card (ContactDrone → form); cards show in the draggable
// hover panel. Mirrors DropboxQueenBee.
//
//   /contact        — enable contact for this location's children (subtree)
//   /contact off    — remove the contact behaviour declared here

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import { enableContact, removeContactEnabled, listContactEnabledHere } from './contact-card.js'

const get = (key: string): any => (window as any).ioc?.get?.(key)

type LineageLike = { explorerSegments?: () => readonly string[] }
type ContactServiceLike = { sigsAt(segments: readonly string[]): string[] }

export class ContactQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'contact'
  override readonly aliases = []
  override description =
    'Enable contact cards for this location\'s children (cascades to the subtree). Then click the contact icon on a tile to add a shareable contact.'
  override descriptionKey = 'slash.contact'
  override options = ['off']
  override examples = [
    { input: '/contact', result: 'Tiles here can now add contact cards' },
    { input: '/contact off', result: 'Removes the contact behaviour here' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return q ? ['off'].filter(o => o.startsWith(q)) : ['off']
  }

  protected async execute(args: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    const here = segments.length ? segments[segments.length - 1] : 'this hive'
    const token = args.trim().toLowerCase()
    const service = get('@diamondcoreprocessor.com/ContactService') as ContactServiceLike | undefined

    // /contact off — remove the capability declared at this location. Use the
    // service's known sigs (sync, no layer read) so we never hang on a cold
    // remote decoration fetch.
    if (token === 'off' || token === 'none' || token === 'disable') {
      const sigs = service?.sigsAt(segments) ?? []
      if (sigs.length === 0) { this.#log(`no contact behaviour on "${here}"`, '○'); return }
      for (const sig of sigs) removeContactEnabled(sig, segments)
      this.#log(`contact off — "${here}"`, '○')
      this.#refresh()
      return
    }

    // Mark the current location contact-enabled. Write first so the gate goes
    // active immediately (ContactService updates from this event, commit-
    // independent); then dedupe older capability decorations in the background
    // so a cold remote read can't block the command.
    const newSig = await enableContact(segments)
    this.#log(`contact on "${here}" — its tiles can now add a contact`, '●')
    this.#refresh()

    void (async () => {
      try {
        const existing = await listContactEnabledHere(segments)
        for (const { sig } of existing) if (sig !== newSig) removeContactEnabled(sig, segments)
      } catch { /* best-effort cleanup */ }
    })()
  }

  /** Nudge a re-render so the contact icon appears / disappears on the hovered
   *  tile at once. Slight delay lets ContactService process the
   *  `decorations:changed` event first, so `active()` is already current when
   *  the overlay re-evaluates each icon's `visibleWhen`. */
  #refresh(): void {
    setTimeout(() => { try { void new hypercomb().act() } catch { /* ignore */ } }, 90)
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _contact = new ContactQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ContactQueenBee', _contact)
