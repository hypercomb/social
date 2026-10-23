// calendar/event.queen.ts
//
// `event` — a meeting on the calendar, and who is coming
// (documentation/calendar-events.md).
//
//   event <date> [<time>] at <where> [: <title>] on <host>
//        Put a meeting of the tile you stand on (its series) on the calendar
//        the host serves. The record goes to the host as an atom; your signed
//        index names it `event:<sig>` — the host lists it under
//        sign('calendar:events') — and `rsvp:<sig>`, which opens its list. A
//        note on the tile says so.
//   event list on <host>
//        The calendar: every meeting the host lists, in union with the hosts
//        you carry, and how many are coming to each.
//   event join <date|sig> as <name> on <host>
//        Say you are coming — from your own hive, to the meeting's own host.
//        When your key has a profile on a host, the claim carries it, and the
//        meeting's door shows your picture and your about line.
//   event here <date|sig> as <name> on <host>
//        Check in at the meeting: you are here now.
//   event roll <date|sig> on <host>
//        Read who is coming and KEEP it in the hive: the roll as a record the
//        tile you stand on wears (a calendar:roll decoration) and a note.
//
// The host is said the way publish says it, `on <host>`; `@<host>` is read
// too. There is no default host (jwize 2026-10-11): a line that names none
// reads nothing and signs nothing. The arguments are dates, signatures, places
// and names, never words: the line arrives exactly as said.

import { EffectBus, QueenBee, SignatureService } from '@hypercomb/core'
import { zoneDoor } from '../sharing/zone-door.js'
import { setHiveRoot } from '../sharing/hive-pointer.js'
import { listCommunityHosts } from '../sharing/community-hosts.js'
import { listDecorations, removeDecoration, writeDecoration } from '../commands/decoration-manifest.js'
import { coming, eventSignature, eventText } from './event.js'
import { readEvents, readRsvps, type ListedEvent } from './event-read.js'
import type { RsvpOutcome } from './rsvp.drone.js'

const SIG_RE = /^[a-f0-9]{64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const short = (sig: string): string => `${sig.slice(0, 12)}…`

export const ROLL_KIND = 'calendar:roll'
export const ROLL_RECORD_KIND = 'rsvp-roll'

type Verb = 'make' | 'list' | 'join' | 'here' | 'roll' | ''
export interface EventLine {
  readonly verb: Verb
  readonly date: string
  readonly time: string
  readonly ends: string
  readonly where: string
  readonly title: string
  /** A meeting named by signature or by its date. */
  readonly ref: string
  readonly who: string
  readonly host: string
}

const say = (message: string): void => { EffectBus.emit('activity:log', { message, icon: 'event' }) }
const tell = (type: 'success' | 'warning' | 'error' | 'info', message: string): void => {
  EffectBus.emit('toast:show', { type, title: 'event', message, duration: 8000 })
}

const get = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

/** The words of an `event` line. */
export const parseEventArgs = (args: string): EventLine => {
  let rest = args.trim()
  let host = ''
  const on = /(?:^|\s)on\s+(\S+)\s*$/i.exec(rest)
  if (on) { host = zoneDoor(on[1]!); rest = rest.slice(0, on.index).trim() }
  else {
    const at = rest.split(/\s+/).find(part => part.startsWith('@'))
    if (at) { host = zoneDoor(at.slice(1)); rest = rest.split(/\s+/).filter(part => part !== at).join(' ') }
  }
  const none: EventLine = { verb: '', date: '', time: '', ends: '', where: '', title: '', ref: '', who: '', host }
  const words = rest.split(/\s+/).filter(Boolean)
  const first = (words[0] ?? '').toLowerCase()
  if (first === 'list') return { ...none, verb: 'list' }
  if (first === 'join' || first === 'here' || first === 'roll') {
    const ref = (words[1] ?? '').toLowerCase()
    const asAt = words.findIndex((word, i) => i > 1 && word.toLowerCase() === 'as')
    const who = asAt > 0 ? words.slice(asAt + 1).join(' ').trim() : ''
    return { ...none, verb: first, ref, who }
  }
  // `09:15` or `09:15-11:00`: when it starts, and when it ends if the line says.
  const made = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?)?\s+at\s+(.+?)(?:\s*:\s*(.+))?$/is.exec(rest)
  if (made) {
    const time = made[2] ? made[2].padStart(5, '0') : ''
    const ends = time && made[3] ? made[3].padStart(5, '0') : ''
    return { ...none, verb: 'make', date: made[1]!, time, ends, where: made[4]!.trim(), title: (made[5] ?? '').trim() }
  }
  return none
}

type LineageLike = { explorerSegments?: () => readonly string[] }
type StoreLike = { putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string> }
type NotesLike = { addAtSegments?: (parent: readonly string[], cell: string, text: string) => Promise<unknown> }
type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}
type JoinerLike = { join: (ask: { event: string; host?: string; name: string; going?: 'yes' | 'no' | 'here'; from?: string }) => Promise<RsvpOutcome> }

export class EventQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'event'
  override description = 'A meeting on the calendar: add one, read the calendar across your community, join, or keep the roll'
  override descriptionKey = 'slash.event'
  override options = ['<date> [<time>[-<ends>]] at <where> [: <title>] on <host>', 'list on <host>', 'join <date|sig> as <name> on <host>', 'here <date|sig> as <name> on <host>', 'roll <date|sig> on <host>']
  // Dates, signatures, places and names — the line arrives exactly as said.
  override rawArgs = true
  override examples = [
    { input: 'event 2026-10-24 19:00 at Yaletown, Vancouver on hypercomb.com', result: 'The tile you stand on has a meeting on the calendar the host serves; its list is open' },
    { input: 'event list on hypercomb.com', result: 'Every meeting the host and your community list, and how many are coming' },
    { input: 'event join 2026-10-24 as Jaime on hypercomb.com', result: 'You are on the list for that meeting' },
    { input: 'event roll 2026-10-24 on hypercomb.com', result: 'Who is coming, kept on the tile as a record and a note' },
  ]

  protected async execute(args: string): Promise<void> {
    const line = parseEventArgs(args)
    if (!line.host) { tell('warning', 'Name the host: event 2026-10-24 at Yaletown on example.com, event list on example.com.'); return }
    if (line.verb === 'make') return this.#make(line)
    if (line.verb === 'list') return this.#list(line.host)
    if (line.verb === 'join') return this.#join(line, 'yes')
    if (line.verb === 'here') return this.#join(line, 'here')
    if (line.verb === 'roll') return this.#roll(line)
    tell('warning', 'Say event <date> [<time>] at <where> on <host>, event list on <host>, event join <date> as <name> on <host>, or event roll <date> on <host>.')
  }

  #here(): string[] {
    return (get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  async #note(segments: readonly string[], text: string): Promise<void> {
    const notes = get<NotesLike>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.addAtSegments || !segments.length) return
    try { await notes.addAtSegments(segments.slice(0, -1), segments[segments.length - 1]!, text) } catch (error) {
      console.warn('[event] the note was not filed:', error)
    }
  }

  async #make(line: EventLine): Promise<void> {
    const segments = this.#here()
    if (!segments.length) { tell('warning', 'Go into the tile the meeting belongs to first — the hive root holds no meetings.'); return }
    const series = segments[segments.length - 1]!.toLowerCase()
    const door = line.host.split('.')[0] === series ? line.host : `${series}.${line.host}`
    const title = line.title || series.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const text = eventText({ title, date: line.date, time: line.time || undefined, ends: line.ends || undefined, where: line.where, series, host: door })
    const bytes = new TextEncoder().encode(text)
    const sig = await eventSignature(text)

    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putResource) { tell('error', 'The store is not available here.'); return }
    await store.putResource(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/json' }), { emit: false })

    const sync = get<HostSyncLike>('@diamondcoreprocessor.com/HostSyncService')
    if (!sync?.publishAtoms) { tell('error', 'Host sync is not available here.'); return }
    const sent = await sync.publishAtoms(line.host, [sig], async wanted => (wanted === sig ? bytes : null))
    if (!sent.ok) { tell('error', `${line.host} did not take the meeting: ${sent.error}`); return }
    const listed = await setHiveRoot(line.host, `event:${sig}`, sig)
    if (!listed.ok) { tell('error', `Your index did not name the meeting: ${listed.reason ?? 'refused'}`); return }
    const opened = await setHiveRoot(line.host, `rsvp:${sig}`, sig)
    if (!opened.ok) { tell('error', `The meeting is listed, but its list did not open: ${opened.reason ?? 'refused'}`); return }

    const when = `${line.date}${line.time ? ` ${line.time}${line.ends ? `–${line.ends}` : ''}` : ''}`
    await this.#note(segments, `Meeting ${when} at ${line.where} — on the calendar at ${door} (event ${short(sig)})`)
    say(`event: ${title} ${when} at ${line.where} is on the calendar ${line.host} serves; join at ${door}`)
    tell('success', `${title} ${when} is on the calendar; its list is open at ${door}.`)
  }

  async #calendar(host: string): Promise<ListedEvent[]> {
    const hosts = [host, ...await listCommunityHosts().catch(() => [] as string[])]
    return readEvents(hosts)
  }

  async #list(host: string): Promise<void> {
    const events = await this.#calendar(host)
    if (!events.length) { tell('info', `${host} and the hosts you carry list no meetings yet.`); return }
    for (const { sig, record, hosts } of events) {
      const n = coming(await readRsvps(record.host, sig)).length
      say(`event: ${record.date}${record.time ? ` ${record.time}` : ''} ${record.title} at ${record.where} — ${n} coming — join at ${record.host}${hosts.length > 1 ? ` (listed by ${hosts.length} hosts)` : ''} ${short(sig)}`)
    }
    tell('info', `${events.length} meeting${events.length === 1 ? '' : 's'} on the calendar.`)
  }

  async #resolve(ref: string, host: string): Promise<ListedEvent | null> {
    const events = await this.#calendar(host)
    if (SIG_RE.test(ref)) return events.find(e => e.sig === ref) ?? null
    if (DATE_RE.test(ref)) {
      const here = this.#here()
      const series = here[here.length - 1]?.toLowerCase()
      const dated = events.filter(e => e.record.date === ref)
      return dated.find(e => e.record.series === series) ?? dated[0] ?? null
    }
    return null
  }

  async #join(line: EventLine, going: 'yes' | 'here'): Promise<void> {
    const verb = going === 'here' ? 'here' : 'join'
    if (!line.ref) { tell('warning', `Say which meeting: event ${verb} 2026-10-24 as <name> on <host>.`); return }
    if (!line.who) { tell('warning', `Say who you are: event ${verb} <date> as <name> on <host>.`); return }
    const found = await this.#resolve(line.ref, line.host)
    if (!found) { tell('warning', `No meeting ${line.ref} on the calendar ${line.host} serves.`); return }
    const joiner = get<JoinerLike>('@diamondcoreprocessor.com/RsvpDrone')
    if (!joiner?.join) { tell('error', 'Joining is not available here.'); return }
    const outcome = await joiner.join({ event: found.sig, host: found.record.host, name: line.who, going, from: line.host })
    if (!outcome.ok) { tell('error', `${found.record.host} did not take it: ${outcome.reason}`); return }
    const shown = outcome.profile ? ' with your profile' : ''
    say(going === 'here'
      ? `event: ${line.who} is here at ${found.record.title} ${found.record.date}${shown} — receipt ${short(outcome.member)}`
      : `event: ${line.who} is coming to ${found.record.title} ${found.record.date}${shown} — receipt ${short(outcome.member)} at ${found.record.host}`)
    tell('success', going === 'here'
      ? `You are checked in at ${found.record.title} ${found.record.date}.`
      : `You are on the list for ${found.record.title} ${found.record.date}.`)
  }

  async #roll(line: EventLine): Promise<void> {
    if (!line.ref) { tell('warning', 'Say which meeting: event roll 2026-10-24 on <host>.'); return }
    const segments = this.#here()
    if (!segments.length) { tell('warning', 'Go into the tile that keeps the roll first.'); return }
    const found = await this.#resolve(line.ref, line.host)
    if (!found) { tell('warning', `No meeting ${line.ref} on the calendar ${line.host} serves.`); return }
    const { sig, record } = found
    const standing = await readRsvps(record.host, sig)
    const yes = standing.filter(claim => claim.going === 'yes' || claim.going === 'here')
    const here = standing.filter(claim => claim.going === 'here')
    const no = standing.filter(claim => claim.going === 'no')
    const roll = {
      v: 1, kind: ROLL_RECORD_KIND, event: sig, host: record.host, date: record.date, at: Date.now(),
      coming: yes.map(claim => ({ who: claim.who, signer: claim.signer, member: claim.name, at: claim.at, ...(claim.profile ? { profile: claim.profile, host: claim.host } : {}) })),
      here: here.map(claim => claim.signer),
      declined: no.map(claim => ({ who: claim.who, signer: claim.signer, member: claim.name, at: claim.at })),
    }
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putResource) { tell('error', 'The store is not available here.'); return }
    const rollBytes = new TextEncoder().encode(JSON.stringify(roll))
    const rollSig = await store.putResource(new Blob([rollBytes.slice().buffer as ArrayBuffer], { type: 'application/json' }), { emit: false })
    if (rollSig !== await SignatureService.sign(rollBytes.slice().buffer as ArrayBuffer)) { tell('error', 'The roll did not land by its own signature.'); return }
    // One roll per meeting on this tile: the newest replaces its own kind for
    // the same event, and leaves other meetings' rolls alone.
    for (const prior of await listDecorations<{ event?: string }>({ kind: ROLL_KIND, segments })) {
      if (prior.record?.payload?.event === sig) removeDecoration({ sig: prior.sig, segments })
    }
    await writeDecoration({
      kind: ROLL_KIND, appliesTo: segments, segments, mark: 'persistent',
      payload: { event: sig, roll: rollSig, date: record.date, coming: yes.length, host: record.host },
      refs: [rollSig],
    })
    const names = yes.map(claim => claim.who)
    const shown = names.slice(0, 40).join(', ') + (names.length > 40 ? ` and ${names.length - 40} more` : '')
    await this.#note(segments, `Roll ${record.date} ${record.title}: ${yes.length} coming${here.length ? `, ${here.length} checked in` : ''}${names.length ? ` — ${shown}` : ''}${no.length ? ` (${no.length} not coming)` : ''}`)
    say(`event: roll for ${record.title} ${record.date} kept — ${yes.length} coming, record ${short(rollSig)}`)
    tell('success', `${yes.length} coming to ${record.title} ${record.date}; the roll is kept here.`)
  }
}

const _event = new EventQueenBee()
window.ioc.register('@diamondcoreprocessor.com/EventQueenBee', _event)
