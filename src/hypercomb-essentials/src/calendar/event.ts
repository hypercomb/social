// calendar/event.ts
//
// A MEETING IS A RECORD IN A POOL OF MEANING; WHO IS COMING IS A POOL PER
// MEETING (documentation/calendar-events.md). This is the pure half — the
// record, the addresses, a claim's shape and check, which claims stand, and
// which meeting is next — shared by the `event` word, the page's bee and the
// specs. No store, no network.
//
//   pool     sign('calendar:events') on every community host: one member per
//            meeting, named by the record's own signature. A calendar is the
//            union of that ONE derived address across the hosts you carry.
//   record   { v, kind:'event', title, date, time?, where, series, host, at }
//            — `series` is the tile the meeting belongs to (its route name),
//            `host` the door where its list lives, which is where to join.
//   list     sign('rsvp:<record sig>') on the record's host: one member per
//            signed claim (kind RSVP_KIND, tags pool/event/name/going), named
//            by the claim's own hash. Each key's newest claim stands. A
//            check-in is a claim with going 'here'. A HOSTED attendee's claim
//            may also name their host and their profile there (host/profile
//            tags); the door picks that profile and its picture up.

import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'

export const EVENTS_POOL = 'calendar:events'
export const RSVP_POOLS = 'rsvp:pools'
export const EVENT_RECORD_KIND = 'event'
export const RSVP_KIND = 30568
export const RSVP_NAME_MAX = 48
export const RSVP_MAX_BYTES = 2048
export const EVENT_MAX_BYTES = 4096

const SIG_RE = /^[a-f0-9]{64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const utf8 = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

export interface EventRecord {
  readonly v: 1
  readonly kind: typeof EVENT_RECORD_KIND
  readonly title: string
  /** The meeting's own day, YYYY-MM-DD. */
  readonly date: string
  /** HH:MM where it happens, when a time is set. */
  readonly time?: string
  /** HH:MM it ends, when the meeting says so. */
  readonly ends?: string
  readonly where: string
  /** The tile the meeting belongs to — its route name. */
  readonly series: string
  /** The door its list lives on: where to join. */
  readonly host: string
  readonly at: number
}

export type Going = 'yes' | 'no' | 'here'

/** A claim as read: who says they are coming to which meeting, when. */
export interface Rsvp {
  /** The member's name on the host — the claim's own hash: the receipt. */
  readonly name: string
  readonly signer: string
  readonly event: string
  /** The name the person chose. */
  readonly who: string
  readonly going: Going
  readonly at: number
  /** A hosted attendee's host, and the profile their index names there. */
  readonly host?: string
  readonly profile?: string
}

export const rsvpPoolMeaning = (eventSig: string): string => `rsvp:${eventSig.toLowerCase()}`
export const rsvpPoolAddress = (eventSig: string): Promise<string> => registerPoolMeaning(rsvpPoolMeaning(eventSig))
export const eventsPoolAddress = (): Promise<string> => registerPoolMeaning(EVENTS_POOL)

/** The record's bytes, key order fixed so the same meeting is the same signature. */
export const eventText = (fields: {
  title: string; date: string; time?: string; ends?: string; where: string; series: string; host: string; at?: number
}): string => JSON.stringify({
  v: 1, kind: EVENT_RECORD_KIND,
  title: fields.title.trim(), date: fields.date,
  ...(fields.time ? { time: fields.time } : {}),
  ...(fields.time && fields.ends ? { ends: fields.ends } : {}),
  where: fields.where.trim(), series: fields.series.trim().toLowerCase(), host: fields.host.trim().toLowerCase(),
  at: fields.at ?? Date.now(),
})

export const eventSignature = (text: string): Promise<string> => SignatureService.sign(utf8(text))

/** A record's text as the meeting it is, or null. */
export const parseEvent = (text: string): EventRecord | null => {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(text) as Record<string, unknown> } catch { return null }
  if (!raw || raw['kind'] !== EVENT_RECORD_KIND) return null
  const title = String(raw['title'] ?? '').trim()
  const date = String(raw['date'] ?? '')
  const where = String(raw['where'] ?? '').trim()
  const series = String(raw['series'] ?? '').trim().toLowerCase()
  const host = String(raw['host'] ?? '').trim().toLowerCase()
  const time = raw['time'] === undefined ? undefined : String(raw['time'])
  const ends = raw['ends'] === undefined ? undefined : String(raw['ends'])
  if (!title || !DATE_RE.test(date) || !where || !series || !host || (time !== undefined && !TIME_RE.test(time))) return null
  if (ends !== undefined && (!time || !TIME_RE.test(ends))) return null
  return { v: 1, kind: EVENT_RECORD_KIND, title, date, ...(time ? { time } : {}), ...(ends ? { ends } : {}), where, series, host, at: Number(raw['at']) || 0 }
}

/** The unsigned claim a key signs: this pool, this meeting, this name — coming,
 *  not coming, or here now — and, for a hosted attendee, where their profile is. */
export function rsvpTemplate(
  pool: string, event: string, who: string, going: Going, at = Math.floor(Date.now() / 1000),
  hosted: { host?: string; profile?: string } = {},
) {
  const where = hosted.host && hosted.profile && SIG_RE.test(hosted.profile.toLowerCase())
    ? [['host', hosted.host.toLowerCase()], ['profile', hosted.profile.toLowerCase()]]
    : []
  return {
    kind: RSVP_KIND,
    created_at: at,
    tags: [['pool', pool], ['event', event.toLowerCase()], ['name', who.trim()], ['going', going], ...where],
    content: '',
  }
}

type ClaimEvent = { kind?: unknown; pubkey?: unknown; created_at?: unknown; tags?: unknown; id?: unknown; sig?: unknown; content?: unknown }

const tag = (evt: ClaimEvent, name: string): string => {
  const tags = Array.isArray(evt.tags) ? evt.tags : []
  const hit = tags.find((t): t is unknown[] => Array.isArray(t) && t[0] === name)
  return String(hit?.[1] ?? '')
}

/** A member's bytes as the claim they are, or null: they must hash to their
 *  name, be a claim on THIS pool's meeting with a name and an answer, and
 *  carry a valid signature. `verify` is injectable for the spec. */
export async function readRsvp(
  pool: string,
  name: string,
  bytes: Uint8Array,
  verify: (evt: unknown) => boolean = (evt) => verifyEvent(evt as Parameters<typeof verifyEvent>[0]),
): Promise<Rsvp | null> {
  if (!SIG_RE.test(name) || bytes.byteLength > RSVP_MAX_BYTES) return null
  if (await SignatureService.sign(bytes.slice().buffer as ArrayBuffer) !== name) return null
  let evt: ClaimEvent
  try { evt = JSON.parse(new TextDecoder().decode(bytes)) as ClaimEvent } catch { return null }
  if (Number(evt?.kind) !== RSVP_KIND || tag(evt, 'pool').toLowerCase() !== pool) return null
  const event = tag(evt, 'event').toLowerCase()
  const who = tag(evt, 'name').trim()
  const going = tag(evt, 'going')
  if (!SIG_RE.test(event) || !who || who.length > RSVP_NAME_MAX || (going !== 'yes' && going !== 'no' && going !== 'here')) return null
  const host = tag(evt, 'host').toLowerCase()
  const profile = tag(evt, 'profile').toLowerCase()
  try { if (!verify(evt)) return null } catch { return null }
  return {
    name, signer: String(evt.pubkey ?? '').toLowerCase(), event, who, going, at: Number(evt.created_at) || 0,
    ...(host && SIG_RE.test(profile) ? { host, profile } : {}),
  }
}

/** The names in a host's pool listing — newline text, one 64-hex per line.
 *  A page (HTML) or anything else yields nothing. */
export function listingNames(text: string): string[] {
  return String(text ?? '').split('\n').map(line => line.trim().toLowerCase()).filter(line => SIG_RE.test(line))
}

/** What stands: each signer's newest claim. Older claims stay on the host
 *  (history never heals); readers take the newest, oldest arrival first. */
export function standingRsvps(claims: Iterable<Rsvp>): Rsvp[] {
  const newest = new Map<string, Rsvp>()
  for (const claim of claims) {
    const held = newest.get(claim.signer)
    if (!held || claim.at > held.at || (claim.at === held.at && claim.name > held.name)) newest.set(claim.signer, claim)
  }
  return [...newest.values()].sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : 1))
}

/** Who is coming, in the order they said so — a check-in counts: they came. */
export const coming = (standing: readonly Rsvp[]): Rsvp[] => standing.filter(claim => claim.going === 'yes' || claim.going === 'here')

/** Who has checked in. */
export const hereNow = (standing: readonly Rsvp[]): Rsvp[] => standing.filter(claim => claim.going === 'here')

/** Today as a meeting's date is spelled, in this device's own day. */
export const localDate = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/** The calendar's order: what is still to come, soonest first; then what has
 *  been, most recent first. A meeting dated today is still to come. */
export function orderEvents<T extends { record: EventRecord }>(events: readonly T[], today = localDate()): { upcoming: T[]; past: T[] } {
  const byWhen = (a: T, b: T): number => (a.record.date + (a.record.time ?? '')).localeCompare(b.record.date + (b.record.time ?? ''))
  const upcoming = events.filter(e => e.record.date >= today).sort(byWhen)
  const past = events.filter(e => e.record.date < today).sort((a, b) => byWhen(b, a))
  return { upcoming, past }
}
