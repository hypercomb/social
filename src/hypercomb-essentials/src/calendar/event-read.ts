// calendar/event-read.ts
//
// READING THE CALENDAR ACROSS HOSTS (documentation/calendar-events.md). Every
// host answers the same derived address, sign('calendar:events'), with the
// meetings it lists; a calendar is the union of that one address across the
// hosts a reader carries, deduplicated by signature — the same bytes are the
// same meeting wherever they were picked up. Each record is believed only
// when it hashes to its name. Who is coming is read the same way from the
// meeting's own host: the list at sign('rsvp:<event>'), each claim checked.

import { hostBase, readBySig } from '../sharing/derivation-attestation.js'
import {
  coming, eventsPoolAddress, listingNames, parseEvent, readRsvp, rsvpPoolAddress, standingRsvps,
  type EventRecord, type Rsvp,
} from './event.js'

export interface ListedEvent {
  readonly sig: string
  readonly record: EventRecord
  /** The hosts that listed it — the first is where it was read. */
  readonly hosts: readonly string[]
}

const LIST_MS = 8_000

const listAt = async (host: string, pool: string): Promise<string[]> => {
  try {
    const res = await fetch(`${hostBase(host)}/${pool}/`, { cache: 'no-store', signal: AbortSignal.timeout(LIST_MS) })
    return res.ok ? listingNames(await res.text()) : []
  } catch { return [] }
}

/** Every meeting the hosts list, once each, with the hosts that list it. */
export async function readEvents(hosts: readonly string[]): Promise<ListedEvent[]> {
  const pool = await eventsPoolAddress()
  const named = new Map<string, string[]>()
  const unique = [...new Set(hosts.map(h => String(h ?? '').trim().toLowerCase()).filter(Boolean))]
  const listings = await Promise.all(unique.map(async host => [host, await listAt(host, pool)] as const))
  for (const [host, names] of listings) {
    for (const name of names) named.set(name, [...(named.get(name) ?? []), host])
  }
  const out: ListedEvent[] = []
  await Promise.all([...named.entries()].map(async ([sig, from]) => {
    for (const host of from) {
      const bytes = await readBySig(host, sig)
      const record = bytes ? parseEvent(new TextDecoder().decode(bytes)) : null
      if (record) { out.push({ sig, record, hosts: from }); return }
    }
  }))
  return out.sort((a, b) => a.record.date.localeCompare(b.record.date) || a.sig.localeCompare(b.sig))
}

/** Who is coming to one meeting, as its host lists them: each key's newest
 *  verified claim, in the order they arrived. */
export async function readRsvps(host: string, eventSig: string): Promise<Rsvp[]> {
  const pool = await rsvpPoolAddress(eventSig)
  const names = await listAt(host, pool)
  const claims = await Promise.all(names.map(async name => {
    try {
      const res = await fetch(`${hostBase(host)}/${pool}/${name}`, { cache: 'force-cache', signal: AbortSignal.timeout(LIST_MS) })
      if (!res.ok) return null
      return readRsvp(pool, name, new Uint8Array(await res.arrayBuffer()))
    } catch { return null }
  }))
  return standingRsvps(claims.filter((claim): claim is Rsvp => claim !== null))
}

/** How many say they are coming. */
export const countComing = async (host: string, eventSig: string): Promise<number> => coming(await readRsvps(host, eventSig)).length
