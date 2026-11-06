// mail/contacts.ts
//
// WHO THE PARTICIPANT WRITES TO — the composer's suggestions, merged into one
// list. Pure: no network, no storage, no key, no IoC. It reads nothing; it is
// handed everything.
//
// ── WHERE THE ADDRESSES COME FROM ──────────────────────────────────────────
//
// The window hands in what it has already opened: the people it wrote to (Sent)
// and the people who wrote (the inbox). `contactsIn(field, source)` turns a
// header field as it was read — `"Doe, Jane" <jane@x.com>, bob@y.org` — into
// those entries, names kept.
//
// THE HIVE'S CONTACT TILES ARE NOT LISTED BY ANY SERVICE — the gap, stated
// precisely. A contact card is a JSON record (`ContactPayload`,
// contact/contact-card.ts), not a vCard: it lives in ONE tile's `contacts` slot
// and is read one tile at a time by `listContacts(segments)`. vCard is only the
// shell form's import/export format (hypercomb-shared/ui/contact-card/vcard.ts).
// `ContactService` answers synchronous presence for the page being viewed
// (`active()`, `hasCards(label)`), never "every card in the hive", and nothing
// else walks for them. So this module invents no walk and no index: a caller
// that holds cards (from `listContacts` at tiles it chose) passes them through
// `cardContacts(cards)` into `extra`. The owner of a hive-wide reader would be
// contact/contact.service.ts (a `cards()` read over the tiles it has already
// hydrated), or — if it must be complete across the whole hive — a derived
// cache pool keyed by layer signature, minted only in the optimize phase
// (D1, D2, D4). Either way the merge below does not change.
//
// ── THE MERGE ──────────────────────────────────────────────────────────────
//
// One entry per address, compared in lowercase (the house's own reading of an
// address, as reply.ts reads one). The richest name wins: a name of its own
// over the local part said again over the address said again, then the longer
// one, then the first seen; the address said again is never shown. The
// source travels with the name it came with. Sorted the way a person looks a
// name up: named entries first by name, then the nameless by address.

import type { ContactPayload } from '../contact/contact-card.js'

export interface Contact {
  readonly address: string
  readonly name?: string
  /** Where this entry was learned: `sent`, `inbox`, `contact`, … — the caller's word. */
  readonly source: string
}

/** What a caller hands in. `address` may also be a whole mailbox (`Name <a@b>`). */
export interface ContactSeed {
  readonly address: string
  readonly name?: string
  readonly source: string
}

/** The two fields of a contact card that matter here. */
export type ContactCard = Pick<ContactPayload, 'name'> & Partial<Pick<ContactPayload, 'email'>>

/** The source word for an entry learned from a contact tile's card. */
export const CONTACT_CARD_SOURCE = 'contact'

const ADDRESS = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+$/
const FIND_ADDRESS = /[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+/

const cleanAddress = (raw: string): string => {
  const address = String(raw ?? '').trim().replace(/^mailto:/i, '').toLowerCase()
  return ADDRESS.test(address) ? address : ''
}

/** A display name as a header carries it: quotes off, escapes undone, space folded. */
const cleanName = (raw: string | undefined): string =>
  String(raw ?? '')
    .trim()
    .replace(/^"([\s\S]*)"$/, '$1')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** Split a header field at commas and semicolons that are not inside quotes,
 *  angle brackets or a comment — `"Doe, Jane" <j@x>` is ONE mailbox. */
const splitMailboxes = (field: string): string[] => {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let angle = 0
  let comment = 0
  for (let i = 0; i < field.length; i++) {
    const ch = field[i]
    if (ch === '\\' && quoted && i + 1 < field.length) { current += ch + field[++i]; continue }
    if (ch === '"' && angle === 0 && comment === 0) quoted = !quoted
    else if (!quoted) {
      if (ch === '<') angle++
      else if (ch === '>' && angle > 0) angle--
      else if (ch === '(' && angle === 0) comment++
      else if (ch === ')' && comment > 0) comment--
      else if ((ch === ',' || ch === ';') && angle === 0 && comment === 0) {
        parts.push(current)
        current = ''
        continue
      }
    }
    current += ch
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(Boolean)
}

/** One mailbox — `Name <a@b>`, `a@b (Name)` or a bare `a@b` — as address and name. */
const readMailbox = (text: string): { address: string; name: string } | null => {
  const angled = /^([\s\S]*?)<([^<>]*)>\s*$/.exec(text)
  if (angled) {
    const address = cleanAddress(angled[2])
    return address ? { address, name: cleanName(angled[1]) } : null
  }
  const found = FIND_ADDRESS.exec(text)
  if (!found) return null
  const address = cleanAddress(found[0])
  if (!address) return null
  const commented = /\(([^()]*)\)/.exec(text)
  return { address, name: cleanName(commented?.[1]) }
}

/** Every mailbox in a header field as read (`From`, `To`, `Cc`, a typed To line). */
export function contactsIn(field: string, source: string): ContactSeed[] {
  const out: ContactSeed[] = []
  for (const part of splitMailboxes(String(field ?? ''))) {
    const box = readMailbox(part)
    if (box) out.push(box.name ? { address: box.address, name: box.name, source } : { address: box.address, source })
  }
  return out
}

/** A contact tile's cards as entries. A card's `email` field may hold several
 *  addresses; each is its own entry under the card's name. */
export function cardContacts(cards: readonly ContactCard[], source: string = CONTACT_CARD_SOURCE): ContactSeed[] {
  const out: ContactSeed[] = []
  for (const card of cards ?? []) {
    const name = cleanName(card?.name)
    for (const seed of contactsIn(String(card?.email ?? ''), source)) {
      out.push(name ? { address: seed.address, name, source } : seed)
    }
  }
  return out
}

/** How much a name says beyond the address: 0 nothing, 1 the address again,
 *  2 its local part again (Leanne for leanne@ — often a real first name, so it
 *  is shown, but anything more loses to it), 3 a name of its own. */
const richness = (name: string, address: string): number => {
  if (!name) return 0
  const said = name.toLowerCase()
  if (said === address) return 1
  return said === address.split('@')[0] ? 2 : 3
}

const richer = (candidate: string, held: string, address: string): boolean => {
  const a = richness(candidate, address)
  const b = richness(held, address)
  if (a !== b) return a > b
  return Array.from(candidate).length > Array.from(held).length
}

const byPerson = (a: Contact, b: Contact): number => {
  if (a.name && b.name) {
    const named = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    if (named !== 0) return named
  } else if (a.name || b.name) {
    return a.name ? -1 : 1
  }
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0
}

/**
 * The addresses this participant can write to: `extra` (what the window has
 * opened) merged into one entry per address. Async because the hive's own
 * reader, when one exists, is a read (see the header); today it merges `extra`
 * alone, and nothing here touches the network, the store or a key.
 */
export async function knownAddresses(extra: readonly ContactSeed[] = []): Promise<Contact[]> {
  const merged = new Map<string, { name: string; source: string; nameSource: string }>()
  for (const seed of extra ?? []) {
    const source = String(seed?.source ?? '').trim()
    const box = readMailbox(String(seed?.address ?? '').trim())
    if (!box) continue
    // A name said beside the address and a name inside it compete like any two.
    const said = cleanName(seed?.name)
    const name = said && (!box.name || richer(said, box.name, box.address)) ? said : box.name
    const held = merged.get(box.address)
    if (!held) { merged.set(box.address, { name, source, nameSource: source }); continue }
    if (richer(name, held.name, box.address)) { held.name = name; held.nameSource = source }
  }
  const out: Contact[] = []
  for (const [address, entry] of merged) {
    // A name that only repeats the address carries nothing to show.
    const name = richness(entry.name, address) >= 2 ? entry.name : ''
    const source = name ? entry.nameSource : entry.source
    out.push(name ? { address, name, source } : { address, source })
  }
  return out.sort(byPerson)
}
