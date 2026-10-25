// calendar/kept-events.ts
//
// THE MEETINGS YOU KEEP (jwize, 2026-10-24: enter a domain, tick the meetings
// you want, and they are synchronized to your list). A kept meeting is the
// SAME signed record the host serves — a resource by its own signature, held
// in your store — and a member of your own `calendar:kept` pool. Nothing is
// copied into a second shape and nothing is retyped: keeping is replication,
// so the meeting is on your list offline, and a change the host makes arrives
// as a different signature, never as an edit of this one.
//
// VERIFY BEFORE ADDING — always, typed or from a link. A record is kept only
// when the bytes the host gave hash to the signature asked for (readBySig),
// are small enough to be a meeting, and read as one (parseEvent). Anything
// else is refused by name and nothing is written. The host's listing is never
// believed alone, and a signature is never kept unread.
//
// ONE DOCUMENT, like publish:results: `{ meaning, kept: [{ sig, host, at }] }`,
// `keep: 'current'` (the software writes it for a person's act, and a kept
// list is replaced whole, never versioned). Written one act at a time, each
// reading the list before it; complete-or-absent — a list that could not be
// read is never rewritten as a list of one.

import { EffectBus, SignatureService, get, registerPoolMeaning } from '@hypercomb/core'
import { readBySig } from '../sharing/derivation-attestation.js'
import { EVENT_MAX_BYTES, parseEvent, type EventRecord } from './event.js'

export const KEPT_EVENTS_POOL = 'calendar:kept'
/** Emitted with `{ kept, forgotten }` after the list changes. */
export const KEPT_EVENTS_EFFECT = 'calendar:kept-changed'
const MAX_KEPT = 512
const STORE_KEY = '@hypercomb.social/Store'
const SIG_RE = /^[a-f0-9]{64}$/

export interface KeptEvent {
  /** The record's own signature — what is kept. */
  readonly sig: string
  /** The host it was read from. */
  readonly host: string
  /** When it was kept, epoch ms. */
  readonly at: number
}

export interface KeptMeeting extends KeptEvent {
  readonly record: EventRecord
}

export interface KeepAsk {
  readonly sig: string
  /** The host to read the record from. */
  readonly host: string
}

export interface KeepResult {
  readonly kept: readonly string[]
  readonly already: readonly string[]
  readonly refused: readonly { readonly sig: string; readonly reason: string }[]
}

type StoreLike = {
  opfsRoot?: FileSystemDirectoryHandle
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (
    pool: FileSystemDirectoryHandle,
    bytes: ArrayBuffer,
    subKey?: string,
    options?: { keep?: 'versions' | 'current' },
  ) => Promise<string | null>
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
}

const store = (): StoreLike | undefined => get<StoreLike>(STORE_KEY)

const valid = (value: unknown): KeptEvent | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const sig = String(row['sig'] ?? '').toLowerCase()
  const host = String(row['host'] ?? '').trim().toLowerCase()
  const at = Number(row['at'])
  if (!SIG_RE.test(sig) || !host || !Number.isFinite(at)) return null
  return { sig, host, at }
}

const parse = (bytes: ArrayBuffer | null): KeptEvent[] => {
  if (!bytes) return []
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as { kept?: unknown }
    return Array.isArray(raw?.kept) ? raw.kept.map(valid).filter((row): row is KeptEvent => row !== null) : []
  } catch { return [] }
}

const readOnlyPool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const root = store()?.opfsRoot
  if (!root) return null
  try { return await root.getDirectoryHandle(await registerPoolMeaning(KEPT_EVENTS_POOL), { create: false }) }
  catch { return null }
}

/** Every meeting kept, oldest kept first. Empty when the pool was never
 *  written — a reader never mints it. */
export async function listKept(): Promise<KeptEvent[]> {
  const s = store()
  const pool = await readOnlyPool()
  if (!pool || !s?.getPoolDoc) return []
  return parse(await s.getPoolDoc(pool))
}

/** Whether the pool already holds a document — so a read that came back
 *  empty is a failed read, not an empty list. */
const holdsDocument = async (pool: FileSystemDirectoryHandle): Promise<boolean> => {
  try {
    for await (const name of (pool as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (/^[0-9a-f]{64}$/.test(name)) return true
    }
  } catch { return true }
  return false
}

/** Changes are made one at a time, each reading the list the one before it
 *  wrote: two acts finishing together must both be on the list. */
let writing: Promise<unknown> = Promise.resolve()
const inTurn = <T>(act: () => Promise<T>): Promise<T> => {
  const next = writing.then(act, act)
  writing = next.catch(() => undefined)
  return next
}

/** The list as it stands, for a change. `null` when it cannot be changed
 *  safely: no store, or a list that exists but would not read. */
async function openList(): Promise<{ pool: FileSystemDirectoryHandle; list: KeptEvent[] } | null> {
  const s = store()
  if (!s?.getPool || !s.getPoolDoc || !s.putPoolDoc) return null
  const pool = await s.getPool(KEPT_EVENTS_POOL)
  if (!pool) return null
  const bytes = await s.getPoolDoc(pool)
  if (!bytes && await holdsDocument(pool)) return null
  return { pool, list: parse(bytes) }
}

async function saveList(pool: FileSystemDirectoryHandle, list: readonly KeptEvent[]): Promise<boolean> {
  const out = new TextEncoder().encode(JSON.stringify({ meaning: KEPT_EVENTS_POOL, kept: list }))
  return !!await store()?.putPoolDoc?.(pool, out.buffer as ArrayBuffer, undefined, { keep: 'current' })
}

/** One record, read from its host and believed only when it is what its name
 *  says: it hashes to the signature, is small, and reads as a meeting. */
export async function verifiedMeeting(host: string, sig: string): Promise<
  { ok: true; bytes: Uint8Array; record: EventRecord } | { ok: false; reason: string }
> {
  if (!SIG_RE.test(sig)) return { ok: false, reason: 'not a signature' }
  const bytes = await readBySig(host, sig).catch(() => null)
  if (!bytes) return { ok: false, reason: `${host} did not give a record that hashes to its name` }
  if (bytes.byteLength > EVENT_MAX_BYTES) return { ok: false, reason: 'too large to be a meeting' }
  const record = parseEvent(new TextDecoder().decode(bytes))
  if (!record) return { ok: false, reason: 'is not a meeting' }
  return { ok: true, bytes, record }
}

/** Keep these meetings: each verified, held as a resource by its signature,
 *  and added to the list. Nothing is written for one that does not verify;
 *  one already kept is left as it was. */
export function keepEvents(asks: readonly KeepAsk[]): Promise<KeepResult> {
  return inTurn(async () => {
    const refused: { sig: string; reason: string }[] = []
    const verified: { sig: string; host: string; bytes: Uint8Array }[] = []
    const seen = new Set<string>()
    for (const ask of asks) {
      const sig = String(ask.sig ?? '').toLowerCase()
      if (seen.has(sig)) continue
      seen.add(sig)
      const meeting = await verifiedMeeting(String(ask.host ?? '').trim().toLowerCase(), sig)
      if (!meeting.ok) { refused.push({ sig, reason: meeting.reason }); continue }
      verified.push({ sig, host: String(ask.host).trim().toLowerCase(), bytes: meeting.bytes })
    }
    if (!verified.length) return { kept: [], already: [], refused }

    const open = await openList()
    const s = store()
    if (!open || !s?.putResource) {
      for (const v of verified) refused.push({ sig: v.sig, reason: 'your list could not be opened safely — nothing was kept' })
      return { kept: [], already: [], refused }
    }
    const have = new Set(open.list.map(row => row.sig))
    const already: string[] = []
    const added: KeptEvent[] = []
    for (const v of verified) {
      if (have.has(v.sig)) { already.push(v.sig); continue }
      // The record lands by its own signature, or it is not kept.
      const landed = await s.putResource(
        new Blob([v.bytes.slice().buffer as ArrayBuffer], { type: 'application/json' }), { emit: false },
      ).catch(() => '')
      if (landed !== v.sig || await SignatureService.sign(v.bytes.slice().buffer as ArrayBuffer) !== v.sig) {
        refused.push({ sig: v.sig, reason: 'did not land in your store by its own signature' })
        continue
      }
      added.push({ sig: v.sig, host: v.host, at: Date.now() })
    }
    if (!added.length) return { kept: [], already, refused }
    const list = [...open.list, ...added].slice(-MAX_KEPT)
    if (!await saveList(open.pool, list)) {
      for (const row of added) refused.push({ sig: row.sig, reason: 'your list did not save — nothing was kept' })
      return { kept: [], already, refused }
    }
    EffectBus.emit(KEPT_EVENTS_EFFECT, { kept: added.map(row => row.sig), forgotten: [] })
    return { kept: added.map(row => row.sig), already, refused }
  })
}

/** Take a meeting off the list. The record stays in the store, as any
 *  resource does until it is unreferenced; the list no longer names it. */
export function forgetEvent(sig: string): Promise<boolean> {
  return inTurn(async () => {
    const open = await openList()
    if (!open) return false
    const wanted = String(sig ?? '').toLowerCase()
    if (!open.list.some(row => row.sig === wanted)) return false
    if (!await saveList(open.pool, open.list.filter(row => row.sig !== wanted))) return false
    EffectBus.emit(KEPT_EVENTS_EFFECT, { kept: [], forgotten: [wanted] })
    return true
  })
}

/** The kept meetings as meetings, soonest first: each record read back from
 *  the store and checked against its signature again — a record the store no
 *  longer holds, or that no longer hashes to its name, is not listed. */
export async function readKeptMeetings(): Promise<KeptMeeting[]> {
  const s = store()
  if (!s?.getResource) return []
  const out: KeptMeeting[] = []
  for (const row of await listKept()) {
    const blob = await s.getResource(row.sig).catch(() => null)
    if (!blob) continue
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (await SignatureService.sign(bytes.slice().buffer as ArrayBuffer) !== row.sig) continue
    const record = parseEvent(new TextDecoder().decode(bytes))
    if (record) out.push({ ...row, record })
  }
  return out.sort((a, b) => a.record.date.localeCompare(b.record.date) || a.sig.localeCompare(b.sig))
}
