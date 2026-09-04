// assistant/chat-thread.ts
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

// ── ARCHIVING: a conversation put away, not thrown away ──
//
// Delete was the only thing you could do with a thread you were finished
// with, and delete is not what "finished with" means — a conversation you
// have stopped needing is still a record of what was said, and the only way
// to get a list you can read was to destroy things. So: archive. The thread
// keeps every turn; the lists stop showing it until they are asked to.
//
// WHERE THE FLAG LIVES. In the conversation's OWN bucket, as one small file —
// not in an index, and not in localStorage.
//
//   • Not an index, because this module has exactly one rule about indexes
//     and it is that there must not be one (see ConversationSummary): the
//     bucket describes itself, so an index is a second copy of a fact, free
//     to drift the first time a write half-lands.
//   • Not localStorage, because — unlike SEEN, which genuinely IS per device
//     — "I am finished with this conversation" is a fact about the THREAD.
//     It should be true on the phone too, and it should survive the browser
//     forgetting its storage.
//
// The marker is named by a CONSTANT rather than by its own content hash. Turn
// files are content-hashed because turns are append-only; this one is a
// MUTABLE fact about the thread, so it needs a stable name that setting can
// overwrite and un-setting can remove. A hashed constant can never collide
// with a turn file, whose name is the hash of a JSON record.
const ARCHIVE_MARKER = 'chat-archived'
const GOAL_MARKER = 'chat-goal-reached'

/** The marker file's name inside a bucket. Derived once, then held. */
let archiveNamePromise: Promise<string> | null = null
const archiveName = (): Promise<string> =>
  (archiveNamePromise ??= sha256(new TextEncoder().encode(ARCHIVE_MARKER).buffer as ArrayBuffer))
let goalNamePromise: Promise<string> | null = null
const goalName = (): Promise<string> =>
  (goalNamePromise ??= sha256(new TextEncoder().encode(GOAL_MARKER).buffer as ArrayBuffer))

/** The STEP LEDGER's directory name inside a bucket — the agent's recorded
 *  attempts, written beside the turns by `chat-steps.ts`. Named HERE, with
 *  the archive and goal markers, because this file owns the bucket's shape:
 *  the writer and `deleteConversation`'s proof of ownership must never be
 *  able to drift apart. A directory rather than more files beside the turns
 *  so that every existing reader skips it — `readBucketRaw` walks under
 *  `handle.kind !== 'file'` — and the conversation list never pays for a
 *  busy run. */
export const STEP_LEDGER = 'chat-steps'
let stepLedgerPromise: Promise<string> | null = null
export const STEP_LEDGER_NAME = (): Promise<string> =>
  (stepLedgerPromise ??= sha256(new TextEncoder().encode(STEP_LEDGER).buffer as ArrayBuffer))

export interface ChatGoalReached {
  /** Human-readable attained goals, one per line when there is more than one. */
  readonly details: string
  readonly at: number
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

/** One bucket, read once: its turns and whether it has been put away. Both
 *  come out of the SAME walk — the flag is a file in the same directory. */
type BucketRead = {
  readonly turns: RawTurn[]
  readonly archived: boolean
  readonly goal?: ChatGoalReached
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
  /** PUT AWAY, not thrown away — see the archive marker below. */
  readonly archived: boolean
  /** Set by a bridge responder when the conversation's requested outcome is complete. */
  readonly goal?: ChatGoalReached
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

// ── a conversation per tile ──────────────────────────────
//
// EVERY TILE HAS A CHAT, and nothing mints it. The id is DERIVED from the
// tile's path, so the tile and its conversation are the same address said two
// ways: arriving at a tile resolves to the same thread every time, on any
// device, with no index and no registry to keep in step. A tile nobody has
// spoken to is DORMANT — the derivation exists, the bucket does not, and a
// dormant chat costs a directory that was never created.
//
// The path rides in the id in the clear (`chat:tile:/dolphin/site`) rather
// than as a location sig, because the bucket name is already a one-way hash:
// an id that says which tile it belongs to is what lets the list label a
// thread, and what will let the orchestrator sweep them later.

export const TILE_CONVO_PREFIX = 'chat:tile:'

/** The path a tile chat is keyed by — the same `/path/name` shape a target
 *  rides as, so a thread, a draft and an ask all name the tile identically. */
export const tilePath = (segments: readonly string[]): string =>
  '/' + segments.map(s => String(s ?? '').trim()).filter(Boolean).join('/')

/** A tile's FIRST conversation. Pure derivation: no store, no await, so
 *  arriving at a tile always resolves to the same thread and a tile nobody
 *  has spoken to costs nothing. */
export const tileConvoId = (segments: readonly string[]): string =>
  `${TILE_CONVO_PREFIX}${tilePath(segments)}`

/** Separates a tile's path from the chat's own id. A path segment can never
 *  contain it — `lineageKey` folds every non-letter/number to `-` — so the
 *  split is unambiguous forever. */
const CHAT_SEP = '::'

/** ANOTHER conversation about the same tile.
 *
 *  A tile is not one conversation, it is a SUBJECT: you can have the
 *  architecture thread and the copy-edit thread about the same tile and want
 *  neither to pollute the other. The first is the derived id above (so the
 *  common case still needs no bookkeeping); every one after it hangs off the
 *  same path with its own suffix, which keeps `tilePathOf` — and therefore
 *  every row mark, draft key and ask target — working unchanged. */
export const newTileConvoId = (segments: readonly string[], seed?: string): string =>
  `${tileConvoId(segments)}${CHAT_SEP}${seed ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`

/** The tile a conversation belongs to, or '' for a free-floating chat. */
export const tilePathOf = (convoId: string): string => {
  if (!convoId.startsWith(TILE_CONVO_PREFIX)) return ''
  const rest = convoId.slice(TILE_CONVO_PREFIX.length)
  const cut = rest.indexOf(CHAT_SEP)
  return cut < 0 ? rest : rest.slice(0, cut)
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
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

/** A conversation's bucket, for the modules that keep their OWN records
 *  beside the turns (`chat-steps.ts`). Exported so the addressing rule —
 *  `sha256(convoId)` — is spelled in exactly ONE place: a second spelling
 *  is a second copy of a fact, free to drift the first time either is
 *  touched, and a drifted bucket name is a thread that silently forks in
 *  two. `create: false` mints nothing, so reading a conversation that has
 *  never been spoken to stays free. */
export const conversationBucket = async (
  convoId: string,
  create = false,
): Promise<FileSystemDirectoryHandle | null> => {
  const id = String(convoId ?? '').trim()
  if (!id) return null
  // ONLY the directory miss is caught. A store that FAILS must propagate:
  // "the bucket is not there yet" and "I could not find out" are different
  // answers, and collapsing them is how a transient fault comes to read as a
  // run that never did anything — which a resuming responder takes as
  // permission to do the work again. The rejection travels out through
  // readSteps to thread-read, which answers `ok:false`, which is what
  // `loop-run.cjs`'s resume() turns into a thrown error rather than an empty
  // ledger. Null from here means the conversation has no bucket, nothing more.
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) return null
  const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
  try {
    return await pool.getDirectoryHandle(name, { create })
  } catch { return null }
}

/** The step ledger's files, but ONLY when every one of them is this
 *  conversation's own. Null means unproven, and unproven is not ours to
 *  delete — the same standard `deleteConversation` holds a turn to. A
 *  ledger that holds anything else, or that nests further, does not pass. */
const provedLedgerEntries = async (
  ledger: FileSystemDirectoryHandle,
  convoId: string,
): Promise<string[] | null> => {
  const names: string[] = []
  const entries = (ledger as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
  for await (const [entryName, handle] of entries) {
    if (handle.kind !== 'file') return null
    try {
      const file = await (handle as FileSystemFileHandle).getFile()
      // A ZERO-BYTE entry is this ledger's own interrupted write, never
      // somebody else's bytes: `getFileHandle({create:true})` lands the file
      // before its contents, so a crash mid-write leaves exactly this. Left
      // unaccounted it is unparseable, and an unparseable entry refuses the
      // delete FOREVER — the chat window's Delete button silently stops
      // working, with a hashed directory name in a console warning as the
      // only symptom. It is ours; it goes with the rest.
      if (file.size === 0) { names.push(entryName); continue }
      const parsed = JSON.parse(await file.text()) as { kind?: string; convoId?: string }
      if (parsed?.kind !== 'chat-step' || parsed.convoId !== convoId) return null
    } catch { return null }
    names.push(entryName)
  }
  return names
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
): Promise<BucketRead | null> => {
  const out: RawTurn[] = []
  let archived = false
  let goal: ChatGoalReached | undefined
  let decided = !humanOnly
  const entries = (bucket as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
  for await (const [, handle] of entries) {
    if (handle.kind !== 'file') continue
    try {
      const file = await (handle as FileSystemFileHandle).getFile()
      const turn = JSON.parse(await file.text()) as RawTurn & { kind?: string }
      // The archive marker rides in the same directory as the turns, so the
      // walk that was already reading every file learns the flag for free —
      // no second pass, no second read per thread.
      if (turn?.kind === ARCHIVE_MARKER) { archived = true; continue }
      if (turn?.kind === GOAL_MARKER) {
        const details = typeof turn.text === 'string' ? turn.text : ''
        goal = { details, at: Number(turn.at) || 0 }
        continue
      }
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
  return { turns: out.sort((a, b) => a.at - b.at), archived, goal }
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
    const raw = ((await readBucketRaw(bucket))?.turns ?? []).filter(turn => turn.convoId === id)
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
        const read = await readBucketRaw(handle as FileSystemDirectoryHandle, true)
        if (!read) continue   // a machine bucket, skipped after one read
        const raw = read.turns
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
          archived: read.archived,
          ...(read.goal ? { goal: read.goal } : {}),
        })
        // AN ARCHIVED THREAD IS NEVER "where you were". `latestTurns` is what
        // a window opening onto resume will show, and resuming into a
        // conversation you just put away would undo the act on the next
        // reload.
        if (!read.archived && lastAt > latestAt) { latestAt = lastAt; latestRaw = raw }
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

// ── what a tile's conversation looks like from outside ───
//
// The list of tiles IS the list of chats, so the list has to be able to SAY
// which tiles are chats. Three facts do it, and the rail paints all three:
// whether a conversation exists at all, whether its newest turn has been
// read, and (from the surface, not from here) whether something is in
// flight right now. Without them every row looks identical and choosing one
// is a guess — a dormant tile and a tile holding forty turns read the same.
//
// SEEN IS PER DEVICE, on purpose. "I have read this" is not a fact about the
// hive — the same thread genuinely is unread on your phone after you read it
// on your desktop — so it lives in localStorage beside the per-conversation
// model choice, never in a pool. Losing it costs one bold row, not data.

const SEEN_KEY = 'hc:chat-seen'

/** WHICH MODEL EACH CONVERSATION WAS LAST HELD IN — `{ [convoId]: model }`.
 *  Per-device like SEEN above, and for the same reason: the tier you chose
 *  for a thread is part of how YOU are set up, not a fact about the hive.
 *
 *  WRITTEN by the chat window (hypercomb-shared/ui/chat-window, `MODEL_KEY`),
 *  read here so the render layer can brand a tile's resting bee with the
 *  model its newest thread was last held in — a conversation you have been
 *  holding in Haiku should not wear Opus's colours over its tile. Shared may
 *  not import essentials nor the other way round, so the key is spelled in
 *  both places and each names the other. Change one, change both. */
const MODEL_KEY = 'hc:chat-models'

/** The model a conversation was last held in, or '' when it has never been
 *  chosen. Best-effort: a missing map is not an error, it is a thread you
 *  have not picked a tier for. */
export const conversationModel = (convoId: string): string => {
  const id = String(convoId ?? '').trim()
  if (!id) return ''
  try {
    const map = JSON.parse(localStorage.getItem(MODEL_KEY) ?? '{}') as Record<string, string>
    const held = map[id]
    return typeof held === 'string' ? held : ''
  } catch { return '' }
}

/** What the rail needs to know about one tile's conversation. */
export interface TileConversation {
  /** The tile it is about — several conversations can share one path. */
  readonly path: string
  readonly convoId: string
  /** Its first message, which is what names it in the list. */
  readonly title: string
  readonly turns: number
  readonly lastAt: number
  /** The newest turn landed after the last time this thread was opened. */
  readonly unread: boolean
  /** PUT AWAY — hidden from the lists until they are asked to show it. */
  readonly archived: boolean
}

const seenMap = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number> }
  catch { return {} }
}

/** Remember that this conversation has been read up to `at`. Called when a
 *  thread is opened and when a turn lands while you are looking at it. */
export const markConversationSeen = (convoId: string, at: number = Date.now()): void => {
  const id = String(convoId ?? '').trim()
  if (!id) return
  try {
    const map = seenMap()
    if ((map[id] ?? 0) >= at) return
    map[id] = at
    localStorage.setItem(SEEN_KEY, JSON.stringify(map))
  } catch { /* participant-local convenience — never worth failing a read */ }
}

/** Every conversation that belongs to a TILE — several per tile is normal.
 *  One walk of the threads pool; free-floating chats are skipped because no
 *  row can show them. */
export const listTileConversations = async (): Promise<TileConversation[]> => {
  const seen = seenMap()
  const out: TileConversation[] = []
  for (const convo of await listConversations()) {
    const path = tilePathOf(convo.convoId)
    if (!path) continue
    out.push({
      path,
      convoId: convo.convoId,
      title: convo.title,
      turns: convo.turnCount,
      lastAt: convo.lastAt,
      unread: convo.lastAt > (seen[convo.convoId] ?? 0),
      archived: convo.archived,
    })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt)
}

/** The hive's own address — the location every tile hangs under. `tilePath([])`
 *  said once, so the root is spelled the same everywhere. */
export const HIVE_PATH = tilePath([])

/** EVERY CONVERSATION A ROW CAN SHOW, in ONE walk of the pool.
 *
 *  The rail needs the tiles' threads and the hive's own, and asking for them
 *  separately walked the pool twice — once per list — for the same buckets.
 *  Every reply that lands re-runs this, so a walk you did not need is a walk
 *  taken out of the frames the rest of the hive was going to use: while a
 *  session is grinding away over the bridge, the bees are competing with the
 *  chat for the same main thread, and this is the cheapest place to give it
 *  back. One walk, and a chat about no tile is filed at the hive's address. */
export const listRailConversations = async (): Promise<TileConversation[]> => {
  const seen = seenMap()
  const out: TileConversation[] = []
  for (const convo of await listConversations()) {
    out.push({
      path: tilePathOf(convo.convoId) || HIVE_PATH,
      convoId: convo.convoId,
      title: convo.title,
      turns: convo.turnCount,
      lastAt: convo.lastAt,
      unread: convo.lastAt > (seen[convo.convoId] ?? 0),
      archived: convo.archived,
    })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt)
}

/** ONE conversation, read from ITS OWN bucket. What a turn landing actually
 *  changed is one thread; re-walking every bucket in the pool to learn that
 *  is the difference between a read that costs one directory and a read that
 *  costs all of them — and it is paid on every single reply. */
export const readConversationSummary = async (convoId: string): Promise<TileConversation | null> => {
  const id = String(convoId ?? '').trim()
  if (!id) return null
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool || !store) return null
  try {
    const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
    const bucket = await pool.getDirectoryHandle(name, { create: false })
    const read = await readBucketRaw(bucket, true)
    const raw = (read?.turns ?? []).filter(turn => turn.convoId === id)
    if (!raw.length) return null
    const lastAt = raw[raw.length - 1]?.at ?? 0
    return {
      path: tilePathOf(id) || HIVE_PATH,
      convoId: id,
      title: await titleOfRaw(raw, store),
      turns: raw.length,
      lastAt,
      unread: lastAt > (seenMap()[id] ?? 0),
      archived: !!read?.archived,
    }
  } catch { /* no bucket yet — an empty conversation, not an error */ }
  return null
}

/** THE HIVE'S OWN CONVERSATIONS — the ones about no single tile.
 *
 *  The root is a LOCATION like any other: `tileConvoId([])` is `chat:tile:/`,
 *  and a conversation there is about the hive as a whole. Older free-floating
 *  chats (`chat:<stamp>`, minted before there was a row that could show them)
 *  are folded in at the same address rather than left stranded — they were
 *  global too; nothing else was ever true about them. */
export const listGlobalConversations = async (): Promise<TileConversation[]> => {
  const seen = seenMap()
  const out: TileConversation[] = []
  for (const convo of await listConversations()) {
    const path = tilePathOf(convo.convoId)
    if (path && path !== HIVE_PATH) continue
    out.push({
      path: HIVE_PATH,
      convoId: convo.convoId,
      title: convo.title,
      turns: convo.turnCount,
      lastAt: convo.lastAt,
      unread: convo.lastAt > (seen[convo.convoId] ?? 0),
      archived: convo.archived,
    })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt)
}

/** What a row has to say about a TILE, folded from all of its conversations:
 *  the deepest thread's turn count is not the point — whether ANY of them is
 *  unread, and how much has been said here in total, is.
 *
 *  ARCHIVED THREADS DO NOT COUNT. A row's mark is about the conversations you
 *  can see; a thread you put away that still made the tile look deep, or that
 *  kept an unread badge lit on a row whose visible chats you have all read,
 *  would make archiving something you cannot actually finish doing. */
export const foldTileConversations = (
  chats: readonly TileConversation[],
): Map<string, { turns: number; unread: boolean; chats: number; lastAt: number }> => {
  const byPath = new Map<string, { turns: number; unread: boolean; chats: number; lastAt: number }>()
  for (const chat of chats) {
    if (chat.archived) continue
    const held = byPath.get(chat.path) ?? { turns: 0, unread: false, chats: 0, lastAt: 0 }
    byPath.set(chat.path, {
      turns: held.turns + chat.turns,
      unread: held.unread || chat.unread,
      chats: held.chats + 1,
      lastAt: Math.max(held.lastAt, chat.lastAt),
    })
  }
  return byPath
}

/** Drop a conversation and every turn in it. The one destructive act this
 *  module has, and it is scoped to a single bucket inside the threads pool —
 *  it never reaches the root, a lineage bag, or another pool. The turn
 *  MANIFESTS go with the bucket; the text RESOURCES they pointed at stay at
 *  the content root — they are content-addressed and possibly shared (a note
 *  may carry the same bytes), so their lifecycle belongs to root-resource GC,
 *  never to this delete. */
/** Put a conversation away, or bring it back. Additive and reversible — the
 *  turns are untouched either way, which is the whole difference between this
 *  and {@link deleteConversation}. Returns false only when the bucket cannot
 *  be reached; setting a flag that is already set is a success, not a no-op
 *  to report. */
export const setConversationArchived = async (
  convoId: string,
  archived: boolean,
): Promise<boolean> => {
  const id = String(convoId ?? '').trim()
  if (!id) return false

  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) return false

  try {
    const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
    // `create: true` on the ARCHIVE path only: putting away a conversation
    // that has no bucket yet (a chat you opened and never spoke in) is a
    // legitimate act, and it must not mint an empty directory when the act
    // is UN-archiving.
    const bucket = await pool.getDirectoryHandle(name, { create: archived })
    const marker = await archiveName()
    if (!archived) {
      try { await bucket.removeEntry(marker) } catch { /* already not archived */ }
      // Announced from HERE, not from the surface that pressed the button:
      // several surfaces list the same thread (the rail's fold, the window's
      // flat list), and only this function knows the write landed.
      EffectBus.emit('chat:threads-changed', { convoId: id, archived: false })
      return true
    }
    const bytes = new TextEncoder().encode(
      JSON.stringify({ kind: ARCHIVE_MARKER, convoId: id, at: Date.now() }),
    ).buffer as ArrayBuffer
    const handle = await bucket.getFileHandle(marker, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([bytes as BlobPart])) } finally { await writable.close() }
    EffectBus.emit('chat:threads-changed', { convoId: id, archived: true })
    return true
  } catch { return false }
}

/** Persist the responder's "goals attained" receipt beside this conversation. */
export const setConversationGoalReached = async (
  convoId: string,
  details: string,
): Promise<boolean> => {
  const id = String(convoId ?? '').trim()
  const text = String(details ?? '').trim().slice(0, 8_000)
  if (!id || !text) return false
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) return false
  try {
    const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
    const bucket = await pool.getDirectoryHandle(name, { create: true })
    const marker = await goalName()
    const at = Date.now()
    const handle = await bucket.getFileHandle(marker, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(new Blob([JSON.stringify({ kind: GOAL_MARKER, convoId: id, text, at })]))
    } finally { await writable.close() }
    EffectBus.emit('chat:goal-reached', { convoId: id, details: text, at })
    EffectBus.emit('chat:threads-changed', { convoId: id })
    return true
  } catch { return false }
}

export const deleteConversation = async (convoId: string): Promise<boolean> => {
  const id = String(convoId ?? '').trim()
  if (!id) return false

  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(THREADS_POOL)
  if (!pool) return false

  try {
    const name = await sha256(new TextEncoder().encode(id).buffer as ArrayBuffer)
    // A 64-hex SUBDIRECTORY of a pool is an author bucket as readily as a
    // conversation. THREADS_POOL is still the bare word `threads` (its
    // siblings chat:drafts / chat:streams are already colon-scoped), so the
    // directory must PROVE which it is before anything is removed. Do NOT
    // re-spell THREADS_POOL to fix this — sign() of a new spelling strands
    // every existing thread.
    //
    // `hardDeleteVetoFor` is the WRONG proof here and refusing on it broke
    // deletion outright: a conversation's turns are content-hashed files, so
    // they classify as pool MEMBERS and the veto refuses every real bucket.
    // The right proof is the one the thread already carries — "a bucket is
    // named sha256(convoId) … but every turn inside it carries its own
    // convoId, so the thread describes itself" (see ConversationSummary).
    // So: read the bucket, require EVERY entry to be this conversation's own,
    // and delete only then. An author bucket cannot pass — its claims are not
    // chat turns and do not name this convoId — and neither can a directory
    // holding anything unaccounted for.
    const bucket = await pool.getDirectoryHandle(name, { create: false })
    const own: string[] = []
    let ledger: { dir: FileSystemDirectoryHandle; entries: string[] } | null = null
    for await (const [entryName, handle] of (bucket as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== 'file') {
        // The STEP LEDGER is the one subdirectory a bucket may legitimately
        // hold: the agent's recorded attempts, written beside the turns by
        // chat-steps.ts. Refusing on it outright would make every
        // conversation an agent has ever worked in undeletable, so it is
        // proved rather than assumed — by the same standard as everything
        // else here, every record inside must name THIS conversation. A
        // ledger with one foreign record in it still refuses, and so does
        // any other directory.
        if (entryName === await STEP_LEDGER_NAME()) {
          const proved = await provedLedgerEntries(handle as FileSystemDirectoryHandle, id)
          if (proved) { ledger = { dir: handle as FileSystemDirectoryHandle, entries: proved }; continue }
        }
        console.warn(`[chat] not deleting conversation ${name.slice(0, 8)}… — it holds a subdirectory (${entryName})`)
        return false
      }
      try {
        const parsed = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()) as { kind?: string; convoId?: string }
        const isOurs = (parsed?.kind === ARCHIVE_MARKER || parsed?.kind === GOAL_MARKER || parsed?.kind === 'chat-turn')
          && (parsed?.convoId === undefined || parsed.convoId === id)
        if (!isOurs) {
          console.warn(`[chat] not deleting conversation ${name.slice(0, 8)}… — ${entryName.slice(0, 8)}… is not this conversation's`)
          return false
        }
      } catch {
        // Unreadable is UNPROVEN, and unproven is not ours to delete.
        console.warn(`[chat] not deleting conversation ${name.slice(0, 8)}… — ${entryName.slice(0, 8)}… could not be read`)
        return false
      }
      own.push(entryName)
    }
    // Remove only the entries we just proved, then the emptied bucket — never
    // a recursive sweep over bytes we did not account for.
    for (const entryName of own) await bucket.removeEntry(entryName)
    // The ledger's files one at a time, then the emptied directory — never a
    // recursive sweep, for the same reason the turns get none.
    if (ledger) {
      for (const stepName of ledger.entries) await ledger.dir.removeEntry(stepName)
      await bucket.removeEntry(await STEP_LEDGER_NAME())
    }
    await pool.removeEntry(name)
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

// ── sticky drafts ────────────────────────────────────────
//
// TYPED IS NOT SENT. You are standing on a tile, you start writing what you
// want done there, and then you go and look at something else — the thinking
// must survive the trip without ACTIVATING anything. So a draft is stored the
// moment it is typed and it starts nothing: no ask, no agent, no turn in the
// thread. Come back and it is where you left it, to finish or to throw away.
//
// One pool doc holds them all, keyed by tile path. A map rather than a doc
// per tile because the two readers both want the WHOLE set: the rail marks
// every tile that holds thinking, and the orchestrator that comes through
// later to decide what is worth doing has to see them together. Each record
// still names its own tile, so the map is a convenience, never the only
// place the fact lives.
//
// Distinct from the ask screen's single held question (context-basket.ts):
// that one is one question mid-flight, this is a tile's standing intent.

/** Pool holding unsent drafts. Colon-scoped: a bare `chat` would collide with
 *  any tile slugged "chat", and the root is an untagged union of lineage bags
 *  and pools. */
export const DRAFTS_POOL = 'chat:drafts'

export interface ChatDraft {
  readonly kind: 'chat-draft'
  /** The tile this thinking belongs to — `/dolphin/site`, or `/` for the root. */
  readonly path: string
  readonly text: string
  readonly at: number
}

const draftsDoc = async (): Promise<Record<string, ChatDraft>> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(DRAFTS_POOL)
  if (!pool || !store?.getPoolDoc) return {}
  try {
    const bytes = await store.getPoolDoc(pool)
    if (!bytes) return {}
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, ChatDraft> = {}
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
      const rec = value as Partial<ChatDraft>
      if (typeof rec?.text !== 'string' || !rec.text) continue
      out[path] = { kind: 'chat-draft', path, text: rec.text, at: Number(rec.at) || 0 }
    }
    return out
  } catch { return {} }
}

/** Every tile currently holding unsent thinking, newest first. What the rail
 *  marks and what a sweep over standing intent reads. */
export const listTileDrafts = async (): Promise<ChatDraft[]> =>
  Object.values(await draftsDoc()).sort((a, b) => b.at - a.at)

/** One tile's draft, or '' when it holds none. */
export const readTileDraft = async (path: string): Promise<string> =>
  (await draftsDoc())[String(path ?? '')]?.text ?? ''

/** Store (or, with empty text, forget) one tile's draft. Returns false when
 *  there is no store to write to — the caller keeps the text on screen, which
 *  is the only copy left, rather than believing it was kept. */
export const saveTileDraft = async (path: string, text: string): Promise<boolean> => {
  const key = String(path ?? '')
  if (!key) return false
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(DRAFTS_POOL)
  if (!pool || !store?.putPoolDoc) return false

  const body = String(text ?? '')
  const map = await draftsDoc()
  if (body.trim()) map[key] = { kind: 'chat-draft', path: key, text: body, at: Date.now() }
  else if (key in map) delete map[key]
  else return true   // nothing held, nothing asked for — already true

  const bytes = new TextEncoder().encode(JSON.stringify(map)).buffer as ArrayBuffer
  const ok = await store.putPoolDoc(pool, bytes)
  if (ok) EffectBus.emit('chat:drafts-changed', { path: key, held: !!body.trim() })
  return !!ok
}

// ── in-flight answers ────────────────────────────────────
//
// AN ANSWER MID-ARRIVAL IS NOT NOTHING. The shallow tier streams over HTTP:
// the words arrive a chunk at a time and only become a turn when the last one
// lands. Anything that ends the page before that — a reload, a crash, closing
// the tab — used to take the whole answer with it, including the half the
// participant had already read.
//
// So the accumulating text is CHECKPOINTED here while it streams, and the
// checkpoint is cleared the moment the real turn is stored. On the next boot
// a checkpoint that outlived its stream is exactly one thing: an answer that
// was interrupted. It is appended as the turn it was becoming, so the words
// the host really did say survive the interruption.
//
// Same shape as the drafts doc above (one pool doc, small transient text) and
// for the same reason: both readers want the whole set, and neither is truth
// anybody composes against — the TURN is the truth, this is the thing that
// makes sure the turn gets written.

/** Pool holding partial answers still arriving. Colon-scoped: a bare `chat`
 *  would collide with any tile slugged "chat". */
export const STREAMS_POOL = 'chat:streams'

export interface ChatStream {
  readonly kind: 'chat-stream'
  readonly convoId: string
  readonly text: string
  readonly at: number
}

const streamsDoc = async (): Promise<Record<string, ChatStream>> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(STREAMS_POOL)
  if (!pool || !store?.getPoolDoc) return {}
  try {
    const bytes = await store.getPoolDoc(pool)
    if (!bytes) return {}
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, ChatStream> = {}
    for (const [convoId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const rec = value as Partial<ChatStream>
      if (typeof rec?.text !== 'string' || !rec.text) continue
      out[convoId] = { kind: 'chat-stream', convoId, text: rec.text, at: Number(rec.at) || 0 }
    }
    return out
  } catch { return {} }
}

const writeStreams = async (map: Record<string, ChatStream>): Promise<boolean> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(STREAMS_POOL)
  if (!pool || !store?.putPoolDoc) return false
  const bytes = new TextEncoder().encode(JSON.stringify(map)).buffer as ArrayBuffer
  return !!(await store.putPoolDoc(pool, bytes))
}

/** Checkpoint the text one answer has produced so far. Empty text forgets the
 *  checkpoint — which is what completion does, once the turn is stored. */
export const saveStreamCheckpoint = async (convoId: string, text: string): Promise<boolean> => {
  const id = String(convoId ?? '').trim()
  if (!id) return false
  const body = String(text ?? '')
  const map = await streamsDoc()
  if (body) map[id] = { kind: 'chat-stream', convoId: id, text: body, at: Date.now() }
  else if (id in map) delete map[id]
  else return true
  return writeStreams(map)
}

/** Every checkpoint left behind, newest first. At boot this is the list of
 *  answers that were still arriving when the page went away. */
export const listStreamCheckpoints = async (): Promise<ChatStream[]> =>
  Object.values(await streamsDoc()).sort((a, b) => b.at - a.at)

/**
 * Turn every abandoned checkpoint into the turn it was becoming.
 *
 * Called on boot. Each partial is appended to its own thread and only then
 * forgotten — a checkpoint whose turn could not be stored is KEPT, so the
 * next boot tries again rather than dropping the words for good.
 *
 * `live` names conversations whose answer is still streaming in THIS page, so
 * a recovery pass running beside an active stream cannot file it early.
 */
export const recoverStreamCheckpoints = async (
  live: ReadonlySet<string> = new Set(),
): Promise<number> => {
  const map = await streamsDoc()
  const entries = Object.values(map).filter(record => !live.has(record.convoId))
  if (!entries.length) return 0

  let recovered = 0
  for (const record of entries) {
    const stored = await appendTurn(record.convoId, 'assistant', record.text)
    if (!stored) continue
    delete map[record.convoId]
    recovered++
    EffectBus.emit('chat:threads-changed', { convoId: record.convoId })
  }
  if (recovered) await writeStreams(map)
  return recovered
}

// ── IoC surface ─────────────────────────────────────────
//
// The chat window is shell UI (hypercomb-shared), which may never import a
// module — the dependency runs the other way. So the module publishes these
// functions and the window resolves them at call time, which is the sanctioned
// way for a shell to consume a module.

export class ChatThreads {
  readonly appendTurn = appendTurn
  readonly listTileConversations = listTileConversations
  readonly foldTileConversations = foldTileConversations
  readonly newTileConvoId = newTileConvoId
  readonly markConversationSeen = markConversationSeen
  readonly tileConvoId = tileConvoId
  readonly tilePath = tilePath
  readonly tilePathOf = tilePathOf
  readonly listTileDrafts = listTileDrafts
  readonly readTileDraft = readTileDraft
  readonly saveTileDraft = saveTileDraft
  readonly saveStreamCheckpoint = saveStreamCheckpoint
  readonly listStreamCheckpoints = listStreamCheckpoints
  readonly recoverStreamCheckpoints = recoverStreamCheckpoints
  readonly readTurns = readTurns
  readonly deliverTurn = deliverTurn
  readonly listConversations = listConversations
  readonly listConversationsWithLatest = listConversationsWithLatest
  readonly deleteConversation = deleteConversation
  readonly setConversationArchived = setConversationArchived
  readonly setConversationGoalReached = setConversationGoalReached
  readonly newConvoId = newConvoId
  readonly isHumanConversation = isHumanConversation
}

export const CHAT_THREADS_IOC_KEY = '@diamondcoreprocessor.com/ChatThreads'

window.ioc.register(CHAT_THREADS_IOC_KEY, new ChatThreads())
