// calendar/event.spec.ts — a meeting is a record in a pool of meaning, who is
// coming is a pool per meeting, and the calendar is one derived address read
// across hosts (documentation/calendar-events.md).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.mock('../sharing/hive-pointer.js', () => ({
  fetchHiveIndex: async () => ({ ok: false, reason: 'http', status: 404 }),
  setHiveRoot: async () => ({ ok: true }),
  nip98Header: async () => null,
}))

;(globalThis as unknown as { window: unknown }).window ??= globalThis
;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: () => undefined }

const {
  EVENTS_POOL, RSVP_KIND, coming, eventSignature, eventText, hereNow, listingNames, orderEvents, parseEvent, readRsvp,
  rsvpPoolMeaning, rsvpTemplate, standingRsvps,
} = await import('./event.js')
const { readEvents } = await import('./event-read.js')
const { parseEventArgs } = await import('./event.queen.js')

const sha = async (text: string): Promise<string> => SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)
const claimBytes = (pool: string, event: string, who: string, going: 'yes' | 'no', signer: string, at: number): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ ...rsvpTemplate(pool, event, who, going, at), pubkey: signer, id: 'x', sig: 'y' }))

describe('event lines', () => {
  it('reads a meeting to make: date, time, place, title and host', () => {
    expect(parseEventArgs('2026-10-24 19:00 at Yaletown, Vancouver on hypercomb.com')).toMatchObject({
      verb: 'make', date: '2026-10-24', time: '19:00', where: 'Yaletown, Vancouver', title: '', host: 'hypercomb.com',
    })
    expect(parseEventArgs('2026-10-24 at Yaletown: Hypercomb Meetup @hypercomb.com')).toMatchObject({
      verb: 'make', date: '2026-10-24', time: '', where: 'Yaletown', title: 'Hypercomb Meetup', host: 'hypercomb.com',
    })
    expect(parseEventArgs('2026-10-24 9:30 at the café on hypercomb.com').time).toBe('09:30')
    expect(parseEventArgs('2026-10-26 9:15-11:00 at Yaletown Galleria, 1080 Mainland St, Vancouver on hypercomb.com')).toMatchObject({
      verb: 'make', date: '2026-10-26', time: '09:15', ends: '11:00', where: 'Yaletown Galleria, 1080 Mainland St, Vancouver',
    })
  })

  it('reads what kind of meeting it is after a pipe, after the title or the place', () => {
    expect(parseEventArgs('2026-10-31 09:15-11:00 at Yaletown Galleria : Hypercomb Meetup | Beginners on hypercomb.com'))
      .toMatchObject({ where: 'Yaletown Galleria', title: 'Hypercomb Meetup', type: 'Beginners' })
    expect(parseEventArgs('2026-10-31 at Yaletown Galleria | Networking on hypercomb.com'))
      .toMatchObject({ where: 'Yaletown Galleria', title: '', type: 'Networking' })
    const record = parseEvent(eventText({ title: 'Hypercomb Meetup', type: ' Beginners ', date: '2026-10-31', where: 'Y', series: 's', host: 'h.example', at: 1 }))
    expect(record?.type).toBe('Beginners')
    expect(parseEvent(eventText({ title: 'x', date: '2026-10-31', where: 'y', series: 's', host: 'h.example', at: 1 }))?.type).toBeUndefined()
  })

  it('reads a check-in like a join', () => {
    expect(parseEventArgs('here 2026-10-24 as Ada on hypercomb.com')).toMatchObject({ verb: 'here', ref: '2026-10-24', who: 'Ada', host: 'hypercomb.com' })
  })

  it('reads list, join and roll, and refuses a line with no host or no shape', () => {
    expect(parseEventArgs('list on hypercomb.com')).toMatchObject({ verb: 'list', host: 'hypercomb.com' })
    expect(parseEventArgs('keep 2026-10-24 2026-10-31 on hypercomb.com')).toMatchObject({ verb: 'keep', refs: ['2026-10-24', '2026-10-31'], host: 'hypercomb.com' })
    expect(parseEventArgs('keep ' + 'A'.repeat(64) + ' @hypercomb.com')).toMatchObject({ verb: 'keep', refs: ['a'.repeat(64)], host: 'hypercomb.com' })
    expect(parseEventArgs('kept')).toMatchObject({ verb: 'kept', host: '' })
    expect(parseEventArgs('forget 2026-10-24')).toMatchObject({ verb: 'forget', ref: '2026-10-24', host: '' })
    expect(parseEventArgs('join 2026-10-24 as Jaime W on hypercomb.com')).toMatchObject({ verb: 'join', ref: '2026-10-24', who: 'Jaime W', host: 'hypercomb.com' })
    expect(parseEventArgs(`roll ${'a'.repeat(64)} on hypercomb.com`)).toMatchObject({ verb: 'roll', ref: 'a'.repeat(64) })
    expect(parseEventArgs('list')).toMatchObject({ verb: 'list', host: '' })
    expect(parseEventArgs('something else on hypercomb.com')).toMatchObject({ verb: '', host: 'hypercomb.com' })
  })
})

describe('the meeting record', () => {
  it('is canonical: the same meeting is the same signature, and reads back as itself', async () => {
    const fields = { title: 'Hypercomb Meetup', date: '2026-10-24', time: '19:00', where: 'Yaletown, Vancouver', series: 'meetups', host: 'meetups.hypercomb.com', at: 1 }
    const a = eventText(fields)
    const b = eventText({ ...fields, title: ' Hypercomb Meetup ', series: 'Meetups' })
    expect(a).toBe(b)
    expect(await eventSignature(a)).toBe(await sha(a))
    expect(parseEvent(a)).toEqual({ v: 1, kind: 'event', ...fields })
  })

  it('refuses what is not a meeting', () => {
    expect(parseEvent('{"kind":"event","title":"x","date":"soon","where":"y","series":"s","host":"h.example"}')).toBeNull()
    expect(parseEvent('{"kind":"event","title":"x","date":"2026-10-24","where":"","series":"s","host":"h.example"}')).toBeNull()
    expect(parseEvent('{"kind":"event","title":"x","date":"2026-10-24","time":"7pm","where":"y","series":"s","host":"h.example"}')).toBeNull()
    expect(parseEvent('{"kind":"event","title":"x","date":"2026-10-24","ends":"11:00","where":"y","series":"s","host":"h.example"}')).toBeNull()
    expect(parseEvent(eventText({ title: 'x', date: '2026-10-24', time: '09:15', ends: '11:00', where: 'y', series: 's', host: 'h.example', at: 1 }))).toMatchObject({ time: '09:15', ends: '11:00' })
    expect(parseEvent('{"kind":"other"}')).toBeNull()
    expect(parseEvent('not json')).toBeNull()
  })

  it('orders the calendar: still to come soonest first, then what has been, most recent first', () => {
    const at = (date: string, time?: string) => ({ record: parseEvent(eventText({ title: 't', date, time, where: 'w', series: 's', host: 'h.example', at: 1 }))! })
    const { upcoming, past } = orderEvents([at('2026-10-31'), at('2026-10-17'), at('2026-10-24', '19:00'), at('2026-10-24', '09:00'), at('2026-10-10')], '2026-10-24')
    expect(upcoming.map(e => e.record.date + (e.record.time ?? ''))).toEqual(['2026-10-2409:00', '2026-10-2419:00', '2026-10-31'])
    expect(past.map(e => e.record.date)).toEqual(['2026-10-17', '2026-10-10'])
  })
})

describe('who is coming', () => {
  const event = 'e'.repeat(64)
  const pool = 'p'.repeat(64)

  it('reads a claim only when it hashes to its name, is on this pool and meeting, and verifies', async () => {
    const bytes = claimBytes(pool, event, 'Jaime', 'yes', '1'.repeat(64), 10)
    const name = await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
    expect(rsvpPoolMeaning(event)).toBe(`rsvp:${event}`)
    expect(await readRsvp(pool, name, bytes, () => true)).toEqual({ name, signer: '1'.repeat(64), event, who: 'Jaime', going: 'yes', at: 10 })
    expect(await readRsvp(pool, 'f'.repeat(64), bytes, () => true)).toBeNull()
    expect(await readRsvp('q'.repeat(64), name, bytes, () => true)).toBeNull()
    expect(await readRsvp(pool, name, bytes, () => false)).toBeNull()
    const nameless = claimBytes(pool, event, '   ', 'yes', '1'.repeat(64), 10)
    expect(await readRsvp(pool, await SignatureService.sign(nameless.slice().buffer as ArrayBuffer), nameless, () => true)).toBeNull()
    expect(rsvpTemplate(pool, event, 'x', 'no').kind).toBe(RSVP_KIND)
  })

  it('reads a check-in and a hosted attendee\'s profile, and ignores a profile with no host', async () => {
    const hosted = new TextEncoder().encode(JSON.stringify({ ...rsvpTemplate(pool, event, 'Ada', 'here', 10, { host: 'HyperComb.com', profile: 'C'.repeat(64) }), pubkey: '1'.repeat(64), id: 'x', sig: 'y' }))
    const name = await SignatureService.sign(hosted.slice().buffer as ArrayBuffer)
    expect(await readRsvp(pool, name, hosted, () => true)).toMatchObject({ going: 'here', host: 'hypercomb.com', profile: 'c'.repeat(64) })
    const loose = new TextEncoder().encode(JSON.stringify({ ...rsvpTemplate(pool, event, 'Bo', 'yes', 10), pubkey: '2'.repeat(64), id: 'x', sig: 'y', tags: [['pool', pool], ['event', event], ['name', 'Bo'], ['going', 'yes'], ['profile', 'c'.repeat(64)]] }))
    const looseName = await SignatureService.sign(loose.slice().buffer as ArrayBuffer)
    const read = await readRsvp(pool, looseName, loose, () => true)
    expect(read?.profile).toBeUndefined()
  })

  it('counts a check-in as coming, and as here', () => {
    const claim = (signer: string, going: 'yes' | 'no' | 'here', at: number) => ({ name: signer.slice(0, 1).repeat(64), signer, event, who: signer.slice(0, 2), going, at })
    const standing = standingRsvps([claim('aa'.repeat(32), 'yes', 1), claim('aa'.repeat(32), 'here', 2), claim('bb'.repeat(32), 'yes', 3), claim('cc'.repeat(32), 'no', 4)])
    expect(coming(standing).map(c => c.who)).toEqual(['aa', 'bb'])
    expect(hereNow(standing).map(c => c.who)).toEqual(['aa'])
  })

  it('lets each key\'s newest claim stand, in the order they arrived, and counts who is coming', () => {
    const claim = (signer: string, going: 'yes' | 'no', at: number, name = signer.slice(0, 1).repeat(64)) =>
      ({ name, signer, event, who: signer.slice(0, 2), going, at })
    const standing = standingRsvps([
      claim('aa'.repeat(32), 'yes', 5), claim('bb'.repeat(32), 'yes', 7), claim('aa'.repeat(32), 'no', 9, 'c'.repeat(64)), claim('dd'.repeat(32), 'no', 6),
    ])
    expect(standing.map(c => [c.who, c.going])).toEqual([['dd', 'no'], ['bb', 'yes'], ['aa', 'no']])
    expect(coming(standing).map(c => c.who)).toEqual(['bb'])
  })

  it('reads listing names from newline text and nothing from a page', () => {
    expect(listingNames(`${'a'.repeat(64)}\n ${'B'.repeat(64)} \nnot-a-name\n`)).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(listingNames('<!doctype html><html></html>')).toEqual([])
  })
})

describe('the calendar across hosts', () => {
  let heaps: Record<string, Map<string, string>>
  let listings: Record<string, string[]>

  beforeEach(() => {
    heaps = {}
    listings = {}
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const { hostname, pathname } = new URL(String(url))
      const sig = pathname.replace(/^\/(content\/)?/, '').replace(/\/$/, '')
      if (pathname.endsWith('/')) return listings[hostname] ? new Response(listings[hostname]!.map(n => `${n}\n`).join('')) : new Response('', { status: 404 })
      const text = heaps[hostname]?.get(sig)
      return text ? new Response(text) : new Response('', { status: 404 })
    }) as unknown as typeof fetch
  })

  it('unions one derived address across hosts, once per meeting, believing only bytes that hash to their name', async () => {
    const pool = await sha(EVENTS_POOL)
    const ours = eventText({ title: 'Ours', date: '2026-10-24', where: 'Yaletown', series: 'meetups', host: 'meetups.hypercomb.com', at: 1 })
    const theirs = eventText({ title: 'Theirs', date: '2026-10-25', where: 'Elsewhere', series: 'club', host: 'club.example', at: 1 })
    const [oursSig, theirsSig] = [await sha(ours), await sha(theirs)]
    const forged = 'f'.repeat(64)
    heaps['hypercomb.com'] = new Map([[oursSig, ours], [theirsSig, theirs], [forged, 'not what the name promises']])
    heaps['club.example'] = new Map([[theirsSig, theirs]])
    listings['hypercomb.com'] = [oursSig, theirsSig, forged]
    listings['club.example'] = [theirsSig]
    listings['silent.example'] = []

    const events = await readEvents(['hypercomb.com', 'club.example', 'silent.example', 'gone.example', 'Club.Example'])
    expect(events.map(e => [e.record.title, e.hosts])).toEqual([['Ours', ['hypercomb.com']], ['Theirs', ['hypercomb.com', 'club.example']]])
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes(`/${pool}/`))).toBe(true)
  })
})
