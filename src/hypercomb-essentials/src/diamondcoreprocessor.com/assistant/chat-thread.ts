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
  /** The text's root-resource signature — present on doctrine-shape turns
   *  (see below), absent on legacy inline turns. */
  readonly contentSig?: string
}

/** A turn as it sits ON DISK since the doctrine pass: the TEXT is a root
 *  content resource and the turn is a small manifest pointing at it —
 *  `{ "role", "contentSig" }` is CLAUDE.md's own worked example, and thread
 *  turns are explicitly on signature-system.md's must-be-a-resource list.
 *  What that buys: the bytes are stored ONCE however many windows, asks or
 *  notes carry them (an answer pasted into a note and the turn dedup to one
 *  resource); the list walk reads small manifests instead of whole
 *  conversations; and the text can be shared/expanded by sig anywhere.
 *  LEGACY turns (inline `text`, no `contentSig`) remain readable forever —
 *  a thread is whatever its bucket holds, in either shape. */
type TurnManifest = {
  readonly kind: 'chat-turn'
  readonly convoId: string
  readonly role: TurnRole
  readonly at: number
  readonly contentSig: string
}

/** A parsed bucket file before its text is materialized: either a legacy
 *  inline turn (text present) or a manifest (contentSig present). */
type RawTurn = {
  readonly convoId: string
  readonly role: TurnRole
  readonly at: number
  readonly text?: string
  readonly contentSig?: string
}

/** One conversation, as the chat window lists it. Recovered from the pool —
 *  there is no index file and there must not be one. A bucket is named
 *  `sha256(convoId)`, which is one-way, but every turn inside it carries its
 *  own `convoId`, so the thread describes itself. An index would be a second
 *  copy of a fact the turns already hold, free to drift the first time a write
 *  half-lands. */
export interface ConversationSummary {
  readonly convoId: string
  readonly title: string
  readonly turnCount: number
  readonly lastAt: number
}

/** Conversations that belong to a PERSON, and so appear in the chat window.
 *
 *  An ALLOWLIST, deliberately — not a blocklist of machine ids. Headless
 *  consumers mint conversations on this same channel (keyword-suggestions uses
 *  `keywords:…`), and a blocklist has to be extended every time another one
 *  appears; the day someone forgets, machine chatter turns up in the user's
 *  chat list. Unrecognised means not shown, so a new headless consumer is
 *  invisible here by default and has to opt in on purpose.
 *
 *  `convo-` is the retired ask screen's shape, kept so conversations from
 *  before the chat window still list rather than being orphaned by the change. */
const HUMAN_PREFIXES = ['chat:', 'convo-'] as const

export const isHumanConversation = (convoId: string): boolean =>
  HUMAN_PREFIXES.some(prefix => convoId.startsWith(prefix))

/** A fresh conversation id. The `chat:` prefix is what marks it as a person's. */
export const newConvoId = (): string =>
  `chat:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
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
    // THE TEXT IS A RESOURCE, THE TURN IS A MANIFEST (signature doctrine —
    // see TurnManifest above). The bytes land once at the content root and
    // dedup against every other holder of the same text; the bucket file is
    // a small pointer record, which is also what makes the list walk cheap.
    // Falls back to the legacy inline shape only when the store cannot mint
    // resources (a partial runtime) — losing the turn entirely would be
    // worse than storing it in the old shape.
    const bucket = await bucketFor(pool, id)
    let record: ChatTurn | TurnManifest
    if (store?.putResource) {
      const contentSig = await store.putResource(new Blob([body], { type: 'text/plain' }))
      record = { kind: 'chat-turn', convoId: id, role, at: Date.now(), contentSig }
    } else {
      record = { kind: 'chat-turn', convoId: id, role, at: Date.now(), text: body }
    }
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    // Named by its own content hash: append-only. (Two deliberate repeats of
    // the same words are two manifests — `at` differs — while the TEXT bytes
    // behind them are one deduped resource.)
    const handle = await bucket.getFileHandle(await sha256(bytes), { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([bytes as BlobPart])) } finally { await writable.close() }
    return true
  } catch (err) {
    console.warn('[chat-thread] could not store the turn:', err)
    return false
  }
}

/** Every turn record in one bucket, oldest first, texts NOT yet materialized —
 *  shared by the single-thread read and the conversation list, so both agree
 *  about what a thread contains.
 *
 *  `humanOnly` is the LIST walk's cost guard: bucket names are `sha256(convoId)`
 *  (one-way), so which conversations are a person's is only knowable from the
 *  turns INSIDE — but it is knowable from the FIRST one, because every turn in
 *  a bucket carries the same convoId. The walk used to read every file of every
 *  machine bucket (`keywords:…` chatter can dwarf the human threads) and throw
 *  the lot away after; with the probe, a machine bucket costs one read. */
const readBucketRaw = async (
  bucket: FileSystemDirectoryHandle,
  humanOnly = false,
): Promise<RawTurn[] | null> => {
  const out: RawTurn[] = []
  let decided = !humanOnly
  const entries = (bucket as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
  for await (const [, handle] of entries) {
    if (handle.kind !== 'file') continue
    try {
      const file = await (handle as FileSystemFileHandle).getFile()
      const turn = JSON.parse(await file.text()) as RawTurn & { kind?: string }
      if (turn?.kind !== 'chat-turn' || !turn.convoId) continue
      // Either shape: legacy inline text, or a manifest pointing at it.
      if (typeof turn.text !== 'string' && typeof turn.contentSig !== 'string') continue
      // The first PARSEABLE turn names the whole bucket.
      if (!decided) {
        if (!isHumanConversation(turn.convoId)) return null
        decided = true
      }
      out.push(turn)
    } catch { /* one unreadable turn must not hide the thread */ }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** The text behind one raw turn: inline (legacy) or resolved from the content
 *  root by sig. An unresolvable resource yields '' — the turn's existence
 *  (role, time) is still true, and hiding the whole turn would silently
 *  shorten a conversation. */
const resolveText = async (raw: RawTurn, store: StoreLike): Promise<string> => {
  if (typeof raw.text === 'string') return raw.text
  if (!raw.contentSig || !store.getResource) return ''
  try {
    const blob = await store.getResource(raw.contentSig)
    return blob ? await blob.text() : ''
  } catch { return '' }
}

/** Raw records → the ChatTurn shape every consumer reads (text materialized). */
const materializeTurns = async (
  raw: readonly RawTurn[],
  store: StoreLike,
): Promise<ChatTurn[]> =>
  Promise.all(raw.map(async r => ({
    kind: 'chat-turn' as const,
    convoId: r.convoId,
    role: r.role,
    at: r.at,
    text: await resolveText(r, store),
    ...(r.contentSig ? { contentSig: r.contentSig } : {}),
  })))

/** Every stored turn for a conversation, oldest first. What a window reads
 *  when it opens — which is why a closed window costs nothing. */
export const readTurns = async (convoId: string): Promise<ChatTurn[]> => {
  const id = String(convoId ?? '').trim()
  if (!id) return []

  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) return []

  try {
    const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
    const bucket = await pool.getDirectoryHandle(name, { create: false })
    const raw = (await readBucketRaw(bucket) ?? []).filter(turn => turn.convoId === id)
    return await materializeTurns(raw, store!)
  } catch { /* no bucket yet — an empty conversation, not an error */ }
  return []
}

/** The first line of the first thing the person said, which is what a
 *  conversation is actually about. Falls back to the first turn of any role so
 *  a thread that somehow starts with a reply still gets a name. Takes RAW
 *  turns and resolves exactly ONE text — the lead's — so naming a thread in
 *  the list walk costs one resource read, not a whole-conversation read. */
const titleOfRaw = async (raw: readonly RawTurn[], store: StoreLike): Promise<string> => {
  const lead = raw.find(turn => turn.role === 'user') ?? raw[0]
  if (!lead) return ''
  const text = await resolveText(lead, store)
  const line = text.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  return line.length > 72 ? line.slice(0, 71).trimEnd() + '…' : line
}

/** The list AND the newest thread's turns from one pass — see
 *  listConversationsWithLatest. */
export interface ConversationList {
  conversations: ConversationSummary[]
  /** The most recently active conversation's turns — the thread a window
   *  opening onto "resume where you were" is about to ask for anyway. */
  latestTurns: ChatTurn[]
}

/**
 * Every human conversation in the pool, most recently active first — plus the
 * newest one's turns.
 *
 * Walks the buckets and reads them. There is no index to consult and no cache
 * to invalidate: the turns ARE the list, and it can never disagree with what
 * opening a conversation shows. Two costs are deliberately NOT paid any more:
 * machine buckets (`keywords:…` and every future headless consumer) are
 * probe-skipped after one read (see readBucket), and the newest thread's turns
 * — which this walk necessarily read — ride out in the result instead of being
 * discarded for the window to immediately re-read.
 */
export const listConversationsWithLatest = async (): Promise<ConversationList> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool || !store) return { conversations: [], latestTurns: [] }

  const out: ConversationSummary[] = []
  let latestRaw: RawTurn[] = []
  let latestAt = -1
  try {
    const entries = (pool as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
    for await (const [, handle] of entries) {
      if (handle.kind !== 'directory') continue
      try {
        const raw = await readBucketRaw(handle as FileSystemDirectoryHandle, true)
        if (!raw) continue   // a machine bucket, skipped after one read
        const convoId = raw[0]?.convoId
        if (!convoId) continue
        const lastAt = raw[raw.length - 1]?.at ?? 0
        out.push({
          convoId,
          // One resource read per thread — the lead turn's text names it;
          // counts and recency come from the manifests alone.
          title: await titleOfRaw(raw, store),
          turnCount: raw.length,
          lastAt,
        })
        if (lastAt > latestAt) { latestAt = lastAt; latestRaw = raw }
      } catch { /* one unreadable bucket must not hide the rest of the list */ }
    }
  } catch { /* no pool yet — no conversations, not an error */ }
  return {
    conversations: out.sort((a, b) => b.lastAt - a.lastAt),
    // Only the thread the window is about to show pays full materialization.
    latestTurns: await materializeTurns(latestRaw, store),
  }
}

/** The list alone — for callers that only want the roster. */
export const listConversations = async (): Promise<ConversationSummary[]> =>
  (await listConversationsWithLatest()).conversations

/** Drop a conversation and every turn in it. The one destructive act this
 *  module has, and it is scoped to a single bucket inside the threads pool —
 *  it never reaches the root, a lineage bag, or another pool. The turn
 *  MANIFESTS go with the bucket; the text RESOURCES they pointed at stay at
 *  the content root — they are content-addressed and possibly shared (a note
 *  may carry the same bytes), so their lifecycle belongs to root-resource GC,
 *  never to this delete. */
export const deleteConversation = async (convoId: string): Promise<boolean> => {
  const id = String(convoId ?? '').trim()
  if (!id) return false

  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) return false

  try {
    const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
    await pool.removeEntry(name, { recursive: true })
    return true
  } catch { return false }
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

// ── IoC surface ─────────────────────────────────────────
//
// The chat window is shell UI (hypercomb-shared), which may never import a
// module — the dependency runs the other way. So the module publishes these
// functions and the window resolves them at call time, which is the sanctioned
// way for a shell to consume a module.

export class ChatThreads {
  readonly appendTurn = appendTurn
  readonly readTurns = readTurns
  readonly deliverTurn = deliverTurn
  readonly listConversations = listConversations
  readonly listConversationsWithLatest = listConversationsWithLatest
  readonly deleteConversation = deleteConversation
  readonly newConvoId = newConvoId
  readonly isHumanConversation = isHumanConversation
}

export const CHAT_THREADS_IOC_KEY = '@diamondcoreprocessor.com/ChatThreads'

window.ioc.register(CHAT_THREADS_IOC_KEY, new ChatThreads())
