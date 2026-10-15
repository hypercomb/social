// sharing/link-acts.ts
//
// WHAT A LINK NAMES — resolved once, for every word said on a coloured name.
// A participant says `raise <what>` or `recommend <what> <word>`, and <what>
// is either an address (`business-card.jwize.com`, with or without a scheme)
// or the NAME of a creation in the door table (publish-results.ts). Both fold
// to one door: the address it opens at, its zone, and, when it is one of
// ours, the route to it inside this hive.
//
// A foreign door is read at its live head (published-address.ts): the host's
// door record checked against the publisher's signed index. That read is what
// `raise` needs to offer the creation in your hive and what `recommend` needs
// to deposit on its head signature.

import { nameWords } from './domain-links.js'
import { readAddressHead, type AddressHead } from './published-address.js'
import { publishedDoors, type PublishedDoor } from './publish-results.js'

export type ResolvedLink =
  | { kind: 'own'; door: PublishedDoor }
  | { kind: 'address'; address: string }
  | { kind: 'none' }

const fold = (name: string): string => nameWords(name).join(' ').toLowerCase()

const looksLikeAddress = (text: string): boolean =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text)

/** The address a reader would open: scheme added, trailing slash dropped. */
export const addressOf = (text: string): string => {
  const raw = text.trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw)
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''))
  } catch { return '' }
}

/** Resolve what a sentence names: one of our doors by name or address, else
 *  an address to read, else nothing. */
export async function resolveLink(text: string, doors?: readonly PublishedDoor[]): Promise<ResolvedLink> {
  const raw = String(text ?? '').trim()
  if (!raw) return { kind: 'none' }
  const own = doors ?? await publishedDoors().catch(() => [] as PublishedDoor[])
  if (looksLikeAddress(raw)) {
    const address = addressOf(raw)
    if (!address) return { kind: 'none' }
    const door = own.find(d => addressOf(d.address) === address)
    return door ? { kind: 'own', door } : { kind: 'address', address }
  }
  const wanted = fold(raw)
  const door = own.find(d => fold(d.name) === wanted || d.lineageKey.toLowerCase() === raw.toLowerCase())
  return door ? { kind: 'own', door } : { kind: 'none' }
}

/** A foreign door at its live head, or the reason it could not be read. */
export async function readLinkHead(address: string): Promise<AddressHead> {
  return readAddressHead(address)
}

/** The last word of a sentence and the rest before it — `recommend <what> <word>`. */
export const splitLastWord = (text: string): { head: string; last: string } => {
  const parts = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { head: parts.join(' '), last: '' }
  return { head: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] ?? '' }
}
