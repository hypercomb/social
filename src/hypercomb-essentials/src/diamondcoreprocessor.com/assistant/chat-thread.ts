// diamondcoreprocessor.com/assistant/chat-thread.ts
//
// DURABLE CHAT TURNS — write the record, then announce it.
//
// `chat-reply` used to be delivery-by-event: it emitted `ask:chat-reply` and
// returned ok. Nothing was stored. With the conversation window closed the
// reply went into a bus with no listener and was gone — and the responder was
// told it succeeded, so it retired the turn believing it had landed. EffectBus
// replays only the LAST value, in memory, per page load, so a reload lost it
// too and a second reply overwrote the first.
//
// That is liveness without durability, which is not a faster system but a
// lossy one, failing silently. The rule this file establishes:
//
//   WRITE THE RECORD, THEN ANNOUNCE IT. Never the announcement as delivery.
//
// The record is what is true; the announcement only makes it feel instant. So
// a closed surface loses nothing (it reads on open), a second device sees the
// same thread, a missed announcement costs latency rather than data, and the
// emit can be as aggressive as you like because nothing depends on it landing.
//
// Turns live in the `sign('threads')` pool, one sub-bucket per conversation,
// one file per turn named by the hash of its own bytes. Append-only: two
// replies are two turns, never an overwrite.

import { EffectBus } from '@hypercomb/core'

/** Pool of meaning holding conversations. Bare word, already in the frozen
 *  registry — do NOT re-spell it; `sign()` of a new spelling is a different
 *  address forever and would strand every existing thread. */
export const THREADS_POOL = 'threads'

export type TurnRole = 'user' | 'assistant'

export interface ChatTurn {
  readonly kind: 'chat-turn'
  readonly convoId: string
  readonly role: TurnRole
  readonly text: string
  readonly at: number
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

const sha256 = async (bytes: ArrayBuffer): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', bytes))

/** The conversation's bucket. Named by the hash of the convoId so an
 *  arbitrary id (`keywords:1785…:ft29d`) becomes a legal directory name and
 *  can never collide with a sig-named sibling. */
const bucketFor = async (
  pool: FileSystemDirectoryHandle,
  convoId: string,
): Promise<FileSystemDirectoryHandle> => {
  const name = await sha256(new TextEncoder().encode(convoId).buffer as ArrayBuffer)
  return pool.getDirectoryHandle(name, { create: true })
}

/**
 * Append a turn and return true only once the bytes are on disk.
 *
 * The return value is the whole point: `chat-reply` reports success to the
 * responder from this, so a turn that could not be stored is a FAILED reply,
 * not a silent one. A responder that sees false can retry or say so instead of
 * retiring an ask whose answer evaporated.
 */
export const appendTurn = async (
  convoId: string,
  role: TurnRole,
  text: string,
): Promise<boolean> => {
  const id = String(convoId ?? '').trim()
  const body = String(text ?? '')
  if (!id || !body) return false

  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) {
    console.warn('[chat-thread] threads pool unavailable — turn NOT stored')
    return false
  }

  try {
    const turn: ChatTurn = { kind: 'chat-turn', convoId: id, role, at: Date.now(), text: body }
    const bytes = new TextEncoder().encode(JSON.stringify(turn)).buffer as ArrayBuffer
    const bucket = await bucketFor(pool, id)
    // Named by its own content hash: append-only, and the same turn written
    // twice (a retry) lands on one file instead of duplicating.
    const handle = await bucket.getFileHandle(await sha256(bytes), { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([bytes as BlobPart])) } finally { await writable.close() }
    return true
  } catch (err) {
    console.warn('[chat-thread] could not store the turn:', err)
    return false
  }
}

/** Every stored turn for a conversation, oldest first. What a window reads
 *  when it opens — which is why a closed window costs nothing. */
export const readTurns = async (convoId: string): Promise<ChatTurn[]> => {
  const id = String(convoId ?? '').trim()
  if (!id) return []

  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) return []

  const out: ChatTurn[] = []
  try {
    const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
    const bucket = await pool.getDirectoryHandle(name, { create: false })
    const entries = (bucket as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
    for await (const [, handle] of entries) {
      if (handle.kind !== 'file') continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const turn = JSON.parse(await file.text()) as ChatTurn
        if (turn?.kind === 'chat-turn' && turn.convoId === id) out.push(turn)
      } catch { /* one unreadable turn must not hide the thread */ }
    }
  } catch { /* no bucket yet — an empty conversation, not an error */ }
  return out.sort((a, b) => a.at - b.at)
}

/** Store the turn, THEN announce it. The effect carries the convoId only —
 *  it says "fresh turns exist", it is not the turn. A listener re-reads;
 *  nothing downstream depends on this arriving. */
export const deliverTurn = async (
  convoId: string,
  role: TurnRole,
  text: string,
): Promise<boolean> => {
  const stored = await appendTurn(convoId, role, text)
  if (!stored) return false
  // `text` rides along purely so an OPEN window can paint without a re-read.
  // The stored turn is the truth; this is a courtesy for the live case.
  EffectBus.emit('ask:chat-reply', { convoId, text })
  return true
}
