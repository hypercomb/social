// mail/mail-to-hive.ts
//
// A MESSAGE BECOMES ONE TILE. "Save to hive" is the participant's press, and
// the press is their yes: nothing is minted that it did not ask for. Each tile
// is a building block — the saved message stands alone, carries its own text
// and its own files, and depends on no other tile (A1, A2).
//
// ── WHAT LANDS, IN THIS ORDER ──────────────────────────────────────────────
//
//   1. the tile   — made where the participant stands, through the command
//                   line's one create path (`command:create-cells`, the door
//                   create.queen.ts, assistant/harness-tiles.ts and
//                   assistant/glossary-tiles.ts already use). Named by the
//                   subject, folded the way every tile name folds
//                   (`normalizeCell`, a fixed point — M4), else "mail from
//                   <sender>". The name is the grammar (N1): a saved message
//                   joins the molecule of its subject's word like any tile.
//   2. the bytes  — the raw message as a resource at ITS OWN signature, and
//                   each attachment at its own sha256 (S1). Same bytes, one
//                   signature: what the hive already holds is shared, never
//                   copied (A6), and the result says how much was.
//   3. the note   — the message's text, written the way notes are written
//                   today (NotesService.addAtSegments: the cell's `notes` slot
//                   and the word's notes facet, notes/notes-facet.ts).
//   4. the files  — one `files:attachment` record per attachment
//                   (files/files-attachment.ts — the house's "a downloadable
//                   file placed on ONE tile"), so the tile's files list shows
//                   them and the closure carries their bytes (refs, T6).
//   5. the mark   — `mail:message` { sig, content, from, subject, date,
//                   messageId }, a CONTENT RECORD on the tile, written through
//                   commands/decoration-manifest.ts `writeDecoration`. These
//                   are facts about the THING, so they go in its own record
//                   (A4); a group mark names a relation (A3), and one message
//                   alone is in none. `sig` is the message's name — the same in
//                   the mailbox and in the hive (I1). `content` is the hop
//                   through which its bytes are reached, a meta envelope
//                   { meta:1, resource:sig, relation:'mail:message' }
//                   (presentation/tiles/artifact-content.ts, L2, L4). The mark
//                   is written LAST: a tile that wears it is complete, so the
//                   mark is never a claim made before the hive holds the rest
//                   (C4).
//
// Nothing else: no pool, no index, no group, no second tile. Every write goes
// through the store's put or the layer committer, never raw storage (B4).
//
// ── VERIFIED BEFORE ANYTHING IS WRITTEN ────────────────────────────────────
//
// `sig` must equal sha256(raw), or the save is refused and nothing is written
// (S3). The store names the bytes again when it puts them; a name that differs
// stops the save there.
//
// ── "HERE" ─────────────────────────────────────────────────────────────────
//
// The page the participant stands on (Lineage.explorerSegments), bound at the
// press, before any await — the same rule the link drop follows ("the drop
// must always write where it landed"). The create path makes a tile where the
// participant stands WHEN IT RUNS, so the save is refused if they moved in
// between, and after the create the page is read again to prove the tile
// stands on it.
//
// ── SAVING TWICE ───────────────────────────────────────────────────────────
//
// A tile on this page named for the message (or its numbered sibling, when a
// tile of that name is already something else) that wears `mail:message` with
// this `sig` IS the saved message: a second save places nothing and says so.
// The same message saved on ANOTHER page is another incidence of the same
// atoms (A7): new tile, no bytes copied. A tile here that already wears the
// name but not this message is never written into — the message takes the
// next free name (`<name>-2`, …), because a press must not graft a message
// onto a tile the participant made.
//
// ── PRIVACY ────────────────────────────────────────────────────────────────
//
// The mailbox holds a message sealed to the owner's key. Saving it puts its
// text, its raw bytes and its attachments into the hive IN THE CLEAR: whatever
// the participant shares or publishes of this page carries the message with it.
// The window should say so beside the press. No key is read here.
//
// ── GAPS (what is missing, who would own it, what constrains it) ────────────
//
//  • No sanctioned "make a tile AT these segments" for a module. The only
//    create path is the command line's (hypercomb-shared/ui/command-line/
//    command-line.component.ts, `command:create-cells`): it makes the tile
//    where the participant stands at that moment, it RETURNS QUIETLY on a
//    reserved word or a saved root (so the page is re-read here), and it may
//    land the tile elsewhere — at a doorway's target or in a holder's group
//    (commands/create-landing.ts) — without saying where. On such a page this
//    module writes the note, files and mark onto the tile named here (the
//    incidence), not onto where the create landed. The fix belongs in that
//    one path: `command:create-cells` carrying the segments to make at and
//    `complete` reporting the name and page it made (B1: the shell keeps the
//    act; N1, P4: the naming gate stays where it is).
//  • No hive-wide answer to "has this message been saved anywhere". Saving
//    twice is caught per page. A hive-wide answer is derivable from layers
//    alone, so it is a derived cache: keyed by signature, minted only in the
//    optimize phase, never on this path (D1–D4). The plan's `mail:message`
//    POOL is therefore not minted: membership is read from the marks the
//    tiles wear (M2), and a pool directory is a replica's memory, never truth
//    (P6).

import {
  EffectBus,
  I18N_IOC_KEY,
  SignatureService,
  isReservedPoolWord,
  normalizeCell,
  type I18nProvider,
} from '@hypercomb/core'
import { listDecorations, writeDecoration } from '../commands/decoration-manifest.js'
import { writeAttachment, type AttachmentPayload } from '../files/files-attachment.js'
import { childNamesOfStrict, resolveCurrentLayer, type PlacementHistory } from '../history/layer-placement.js'
import { mintContentRef } from '../presentation/tiles/artifact-content.js'
import { contactsIn } from './contacts.js'
import type { ParsedMail } from './mime.js'

/** The content record a saved message's tile wears. Colon-scoped (P4, A5). */
export const MAIL_MESSAGE_KIND = 'mail:message'
/** The role the raw message plays in its content envelope. */
export const MAIL_MESSAGE_RELATION = 'mail:message'
/** The note holds this many characters of a long message; the raw message,
 *  kept whole beside it, is the truth. */
export const NOTE_TEXT_LIMIT = 50_000

const SIG = /^[0-9a-f]{64}$/
/** How many names a message tries on one page before saying so. */
const NAME_TRIES = 9

export interface MailMessageMark {
  /** sha256 of the raw message — its name in the mailbox and in the hive. */
  readonly sig: string
  /** The meta envelope naming the raw bytes — the hop a reader follows (L2). */
  readonly content: string
  readonly from: string
  readonly subject: string
  readonly date: string
  readonly messageId: string
}

export interface SaveMessageInput {
  readonly mail: ParsedMail
  /** The raw message, exactly the bytes `sig` names. */
  readonly raw: Uint8Array
  readonly sig: string
  /** The bytes of the n-th attachment as `mail.attachments` numbers them (mime.ts `attachmentBytes`). */
  readonly attachmentBytes: (index: number) => Uint8Array | null
}

export type SaveStatus = 'saved' | 'already-saved' | 'refused' | 'failed'

export interface SaveMessageResult {
  readonly status: SaveStatus
  /** The tile's name, once there is one. */
  readonly cell?: string
  /** The page the tile is on. */
  readonly page?: readonly string[]
  /** The tile's layer signature after the save, when it could be read. */
  readonly cellSig?: string
  /** Every resource signature the tile now references: the message, then its attachments. */
  readonly placed: string[]
  /** The part of `placed` the hive already held — shared, not copied (A6). */
  readonly shared: string[]
  /** Attachments left out, by name: their bytes could not be read. */
  readonly skipped: string[]
  /** What happened, in words the window can show. */
  readonly message: string
}

/** The acts a save is made of. Live ones reach the hive's own services
 *  through IoC at call time (`liveMailToHiveDeps`); a spec hands in its own. */
export interface MailToHiveDeps {
  /** The page the participant stands on. */
  here(): readonly string[]
  /** The names of the tiles on `page` — the PAGE answers, by its children,
   *  never the notes (which outlive a tile and are shared by its word). Null
   *  when some child could not be read: a name unseen might be taken. */
  tilesOn(page: readonly string[]): Promise<readonly string[] | null>
  /** The `mail:message` marks the tile at `segments` wears. */
  marksOn(segments: readonly string[]): Promise<readonly Partial<MailMessageMark>[]>
  /** Is a name refused at the naming gesture (a reserved pool word, a saved root)? */
  refusedName(name: string): boolean
  /** Make the tile on the page the participant stands on; rejects when it cannot. */
  create(name: string): Promise<void>
  /** Does the store already hold these bytes? Said in the result, never a gate. */
  holds(sig: string): Promise<boolean>
  /** Put bytes; resolves to the signature the store named them by. */
  put(bytes: Uint8Array, type: string): Promise<string>
  /** Mint the content envelope around bytes already put; resolves to ITS signature. */
  contentRef(bytesSig: string): Promise<string>
  addNote(parent: readonly string[], tile: string, text: string): Promise<void>
  attach(segments: readonly string[], file: AttachmentPayload): Promise<void>
  wear(segments: readonly string[], mark: MailMessageMark): Promise<void>
  /** The tile's current layer signature, read without minting anything. */
  cellSig(segments: readonly string[]): Promise<string | undefined>
}

// ── words ───────────────────────────────────────────────────────────────────

const interpolate = (text: string, params?: Record<string, string | number>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text

const ioc = <T>(key: string): T | undefined => {
  try { return (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key) } catch { return undefined }
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : interpolate(fallback, params)
  } catch { return interpolate(fallback, params) }
}

const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** The committer names its refusal of a write made while viewing the past
 *  (history/layer-committer.drone.ts); it is read by that name, because a bee
 *  is never imported for a value. */
const whyNotMade = (error: unknown): string =>
  (error as { name?: unknown } | null)?.name === 'RewoundCommitError'
    ? t('mail.hive.rewound', 'You are viewing the past, so nothing can be written. Step forward, then save again.')
    : t('mail.hive.not-made', 'The tile could not be made on this page ({reason}); nothing was saved.', { reason: reasonOf(error) })

// ── pure parts ──────────────────────────────────────────────────────────────

const route = (segments: readonly string[]): string => segments.map(s => String(s ?? '').trim()).filter(Boolean).join('/')

/** Asked by tag, not `instanceof`: bytes from a worker, a frame or a test realm
 *  are the same bytes under another realm's constructor. */
const isBytes = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  // A view over its whole buffer is hashed as it is; a slice of a larger one
  // is copied out first, so only the message's own bytes are named.
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    && Object.prototype.toString.call(bytes.buffer) === '[object ArrayBuffer]'
  return SignatureService.sign(whole ? bytes.buffer as ArrayBuffer : bytes.slice().buffer)
}

/** The tile's name: the subject, folded as every tile name folds; a subject
 *  that folds to nothing names the sender instead. A `/` is a word break, never
 *  a nest — the create path would read it as one. */
export function tileNameFor(mail: Pick<ParsedMail, 'subject' | 'from'>): string {
  const subject = normalizeCell(String(mail.subject ?? '').replace(/[/\\]+/g, ' '))
  if (subject) return subject
  const sender = contactsIn(String(mail.from ?? ''), 'inbox')[0]
  const who = sender?.name || sender?.address || String(mail.from ?? '')
  return normalizeCell(`mail from ${who.replace(/@/g, ' ')}`) || 'mail'
}

/** The names a message may take on one page, in order. A refused word (a
 *  reserved pool address, a saved root) is never offered: `bees` becomes
 *  `mail-bees`, never a tile inside the install's own pool. */
export function nameCandidates(base: string, refused: (name: string) => boolean = () => false): string[] {
  const first = refused(base) ? normalizeCell(`mail ${base}`) : base
  const out: string[] = []
  for (let n = 1; out.length < NAME_TRIES && n <= NAME_TRIES * 2; n++) {
    const name = n === 1 ? first : normalizeCell(`${first.slice(0, 60)}-${n}`)
    if (name && !refused(name) && !out.includes(name)) out.push(name)
  }
  return out
}

/** The note: the message's text, its opening when it is very long. */
export function noteTextFor(mail: Pick<ParsedMail, 'text'>): { text: string; cut: boolean } {
  const text = String(mail.text ?? '').trim()
  if (text.length <= NOTE_TEXT_LIMIT) return { text, cut: false }
  let head = text.slice(0, NOTE_TEXT_LIMIT)
  // Never end on half a surrogate pair.
  const last = head.charCodeAt(head.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1)
  return { text: `${head.trimEnd()} …`, cut: true }
}

// ── the save ────────────────────────────────────────────────────────────────

const outcome = (status: SaveStatus, message: string, extra: Partial<SaveMessageResult> = {}): SaveMessageResult => ({
  status, placed: [], shared: [], skipped: [], ...extra, message,
})

/**
 * Save one received message as ONE tile on the page the participant stands on.
 * Never throws: every outcome comes back with what happened, in words.
 */
export async function saveMessageToHive(
  input: SaveMessageInput,
  deps: MailToHiveDeps | null = liveMailToHiveDeps(),
): Promise<SaveMessageResult> {
  const { mail, raw } = input
  const sig = String(input.sig ?? '').trim().toLowerCase()

  // S3 — the name must be the bytes' own, before anything is touched.
  let verified = false
  try { verified = isBytes(raw) && SIG.test(sig) && await sha256(raw) === sig } catch { verified = false }
  if (!verified) {
    return outcome('refused', t('mail.hive.unverified', 'This message does not match its signature, so nothing was saved.'))
  }
  if (!deps) return outcome('refused', t('mail.hive.unavailable', 'The hive is not ready to keep mail yet; nothing was saved.'))

  try {
    // HERE, bound at the press.
    const page = [...deps.here()]
    const names = await deps.tilesOn(page)
    if (!names) {
      // A tile this read could not see might wear the very name the message
      // would take, and the create path would hand that tile back as "made".
      return outcome('refused', t('mail.hive.page-cold',
        'Some tiles on this page could not be read yet, and the message might take one of their names, so nothing was saved. Try again in a moment, or save on another page.'))
    }

    // Saved already? Every name this message could have taken here is asked.
    const standing = new Set(names)
    const candidates = nameCandidates(tileNameFor(mail), deps.refusedName)
    let free: string | undefined
    for (const name of candidates) {
      if (!standing.has(name)) { free ??= name; continue }
      const marks = await deps.marksOn([...page, name])
      if (marks.some(mark => String(mark?.sig ?? '').toLowerCase() === sig)) {
        const cellSig = await deps.cellSig([...page, name]).catch(() => undefined)
        return outcome('already-saved', t('mail.hive.already', 'Already in the hive here as “{name}”; nothing new was placed.', { name }), {
          cell: name, page, ...(cellSig ? { cellSig } : {}),
        })
      }
    }
    if (!free) {
      return outcome('refused', t('mail.hive.names-taken', 'Too many tiles here already carry this message’s name; nothing was saved.'))
    }

    // Everything the tile will hold, read and named in memory first.
    const files: { payload: AttachmentPayload; bytes: Uint8Array }[] = []
    const skipped: string[] = []
    for (let index = 0; index < mail.attachments.length; index++) {
      const listed = mail.attachments[index]
      const name = String(listed?.filename ?? '').trim() || `attachment-${index + 1}`
      let bytes: Uint8Array | null = null
      try { bytes = input.attachmentBytes(index) } catch { bytes = null }
      // An empty file has nothing to keep; its signature would be the empty
      // content's, which no resource is ever written under.
      if (!bytes || bytes.byteLength === 0) { skipped.push(name); continue }
      const mime = String(listed?.type ?? '').trim() || 'application/octet-stream'
      files.push({ payload: { name, mime, size: bytes.byteLength, sig: await sha256(bytes) }, bytes })
    }
    const wanted = [sig, ...files.map(file => file.payload.sig)].filter((s, i, all) => all.indexOf(s) === i)
    const heldBefore = new Set<string>()
    for (const s of wanted) if (await deps.holds(s).catch(() => false)) heldBefore.add(s)

    // 1. the tile — only where the press was made.
    if (route(deps.here()) !== route(page)) {
      return outcome('refused', t('mail.hive.moved', 'You moved to another page, so nothing was saved. Save again where you want it.'))
    }
    try { await deps.create(free) } catch (error) { return outcome('failed', whyNotMade(error)) }
    const after = await deps.tilesOn(page).catch(() => null)
    if (!after?.includes(free)) {
      return outcome('failed', t('mail.hive.not-standing', 'The tile could not be made on this page; nothing was saved.'))
    }

    const cell = free
    const at = [...page, cell]
    const placed: string[] = []
    const keep = (s: string): void => { if (!placed.includes(s)) placed.push(s) }
    const shared = (): string[] => placed.filter(s => heldBefore.has(s))
    const { text, cut } = noteTextFor(mail)
    try {
      // 2. the bytes, each under its own name.
      if (await deps.put(raw, 'message/rfc822') !== sig) throw new Error('the store named the message differently')
      keep(sig)
      for (const file of files) {
        if (await deps.put(file.bytes, file.payload.mime) !== file.payload.sig) {
          throw new Error(`the store named ${file.payload.name} differently`)
        }
        keep(file.payload.sig)
      }
      const content = await deps.contentRef(sig)
      // 3. the note, 4. the files, 5. the mark — last.
      if (text) await deps.addNote(page, cell, text)
      for (const file of files) await deps.attach(at, file.payload)
      await deps.wear(at, {
        sig,
        content,
        from: String(mail.from ?? ''),
        subject: String(mail.subject ?? ''),
        date: String(mail.date ?? ''),
        messageId: String(mail.messageId ?? ''),
      })
    } catch (error) {
      return outcome('failed', t('mail.hive.partial',
        'The tile “{name}” was made, but not everything could be kept with it ({reason}). It does not count as saved: saving again makes another tile.',
        { name: cell, reason: reasonOf(error) }), { cell, page, placed, shared: shared(), skipped })
    }

    const parts = [t('mail.hive.saved', 'Saved “{name}” here as a tile.', { name: cell })]
    if (files.length === 1) parts.push(t('mail.hive.attachments', 'Its attachment is kept with it.', { count: 1 }))
    else if (files.length > 1) parts.push(t('mail.hive.attachments', 'Its {count} attachments are kept with it.', { count: files.length }))
    const held = shared().length
    if (held === 1) parts.push(t('mail.hive.shared', 'The hive already held one of its parts, so it is shared, not copied.', { count: 1 }))
    else if (held > 1) parts.push(t('mail.hive.shared', 'The hive already held {count} of its parts, so they are shared, not copied.', { count: held }))
    if (skipped.length) parts.push(t('mail.hive.skipped', 'Left out, could not be read: {names}.', { names: skipped.join(', ') }))
    if (cut) parts.push(t('mail.hive.note-cut', 'The note holds the opening of a long message; the whole message is kept with the tile.'))
    const cellSig = await deps.cellSig(at).catch(() => undefined)
    return outcome('saved', parts.join(' '), { cell, page, ...(cellSig ? { cellSig } : {}), placed, shared: shared(), skipped })
  } catch (error) {
    return outcome('failed', t('mail.hive.failed', 'The message could not be saved ({reason}).', { reason: reasonOf(error) }))
  }
}

// ── the live acts ───────────────────────────────────────────────────────────

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
  getResourceLocal?(sig: string): Promise<Blob | null>
}
type NotesLike = { addAtSegments?(parent: readonly string[], cell: string, text: string): Promise<void> }
type LineageLike = { explorerSegments?(): readonly string[]; readonly domain?: unknown }
type HistoryLike = PlacementHistory & {
  currentLayerRefAt?(locationSig: string): Promise<{ readonly layerSig?: string } | null>
}

/**
 * The acts, reached through the hive's own services at call time. Null when a
 * service a save cannot do without (store, history, notes, lineage) is absent.
 */
export function liveMailToHiveDeps(): MailToHiveDeps | null {
  const store = ioc<StoreLike>('@hypercomb.social/Store')
  const notes = ioc<NotesLike>('@diamondcoreprocessor.com/NotesService')
  const history = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
  if (!store?.putResource || !notes?.addAtSegments || !history?.sign || !lineage?.explorerSegments) return null
  const here = (): string[] => (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  return {
    here,
    tilesOn: async page => {
      // The page's layer the way remove and layout resolve it: the parent
      // chain, then — only for the page being viewed — the renderer's cursor.
      const cursor = ioc<{ currentLayerSig?: string }>('@diamondcoreprocessor.com/HistoryCursorService')
      const viewing = route(here()) === route(page)
      const layer = await resolveCurrentLayer(history, lineage.domain, page, viewing ? cursor?.currentLayerSig : null)
      const read = await childNamesOfStrict(history, layer)
      return read.coldMiss ? null : read.names
    },
    marksOn: async segments =>
      (await listDecorations<Partial<MailMessageMark>>({ kind: MAIL_MESSAGE_KIND, segments })).map(entry => entry.record.payload),
    refusedName: name =>
      isReservedPoolWord(name) || ioc<{ isSaved?(n: string): boolean }>('@diamondcoreprocessor.com/SavedRoots')?.isSaved?.(name) === true,
    create: name => new Promise<void>((resolve, reject) => {
      let accepted = false
      EffectBus.emitTransient('command:create-cells', {
        name,
        accept: () => { accepted = true },
        complete: (error?: unknown) => error === undefined ? resolve() : reject(error),
      })
      if (!accepted) reject(new Error('the command line is unavailable'))
    }),
    holds: async s => store.getResourceLocal ? (await store.getResourceLocal(s)) !== null : false,
    // The window read these bytes off the network into an ArrayBuffer of its
    // own; they are never shared memory, so they go to the Blob as they are
    // rather than copied (a message may be 25 MB).
    put: (bytes, type) => store.putResource(new Blob([bytes as Uint8Array<ArrayBuffer>], { type })),
    contentRef: bytesSig => mintContentRef(store, bytesSig, MAIL_MESSAGE_RELATION),
    addNote: (parent, tile, text) => notes.addAtSegments!(parent, tile, text),
    attach: async (segments, file) => { await writeAttachment(segments, file) },
    wear: async (segments, mark) => {
      await writeDecoration<MailMessageMark>({ kind: MAIL_MESSAGE_KIND, appliesTo: segments, payload: mark, segments })
    },
    cellSig: async segments => {
      const location = await history.sign({ explorerSegments: () => segments })
      const ref = await history.currentLayerRefAt?.(location)
      const layerSig = String(ref?.layerSig ?? '')
      return SIG.test(layerSig) ? layerSig : undefined
    },
  }
}
