// assistant/breaks.ts
//
// THE BREAK REPAIR LOOP'S RECORDS — what broke on the client, folded into
// issues the participant can choose to have fixed
// (documentation/break-repair-loop.md).
//
//   break-capture.drone.ts   →  breaks:queue   one record per burst of one break
//   breaks-compact (bridge)  →  breaks:log     one issue per break fingerprint
//   the review agent         →  interprets what is new
//   the repair conversation  →  the participant chooses; the agent works it
//
// Two pools because they have two owners. The QUEUE is the page's: raw,
// append-only, content-addressed, drained by the fold. The LOG is the loop's:
// one current document per fingerprint, carrying what the agent made of it and
// what the participant decided. A fold is mechanical — same fingerprint, same
// issue — and runs INSIDE the hive, so a break that lands mid-fold is a queue
// member the fold never listed, and simply waits for the next one.
//
// A WARNING is a break one severity down: a console.warn that carries an Error.
// It is described, fingerprinted, queued and folded exactly like a break. The
// type is part of the fingerprint, so a failure that is warned about and one
// that breaks stay two issues. What keeps a warning from ever opening a
// conversation on its own is the tick (scripts/bridge/breaks.cjs), not this file.
//
// Both are TRUTH POOLS, never minted from the optimize phase: a break is an
// event, not a derivation of layers (optimize-phase.md litmus). Colon-scoped so
// neither can collide with a tile slugged `breaks`.
//
// Everything above the IO section is pure, so the spec can pin it.

export const BREAK_QUEUE_POOL = 'breaks:queue'
export const BREAK_LOG_POOL = 'breaks:log'

export type BreakType = 'error' | 'rejection' | 'resource' | 'reported' | 'warning'

/** What one break looked like — the part its fingerprint is taken from. */
export interface BreakSample {
  readonly type: BreakType
  readonly message: string
  readonly stack: string
  /** The script or resource URL, when the event names one. */
  readonly source: string
}

/** One queue record: the occurrences of one break, in one page load, over one
 *  write window. */
export interface BreakRecord extends BreakSample {
  readonly kind: 'break@1'
  readonly fingerprint: string
  readonly origin: string
  readonly route: string
  /** Which page load, and when that load started (epoch ms). */
  readonly session: string
  readonly sessionAt: number
  readonly count: number
  readonly firstAt: number
  readonly lastAt: number
}

/**
 *  new       the fold made it; nobody has read it yet
 *  open      interpreted, waiting for the participant to choose
 *  chosen    the participant picked it; the repair agent works it
 *  fixed     a fix landed — the fold reopens it if it breaks again in a page
 *            load that started after the fix
 *  retired   the participant retired it WITHOUT a fix: the code it blamed had
 *            moved, so the bytes that threw are gone. Falsified exactly the way
 *            a fix is — it is a claim that can be proved wrong, which is why it
 *            exists instead of reaching for `dismissed`.
 *  dismissed the participant said leave it; it keeps counting, silently
 */
export type IssueStatus = 'new' | 'open' | 'chosen' | 'fixed' | 'dismissed' | 'retired'
export type RepairMode = 'fix' | 'investigate'

export interface IssueNote { readonly at: number; readonly text: string }

export interface BreakIssue extends BreakSample {
  readonly kind: 'break-issue@1'
  readonly fingerprint: string
  readonly status: IssueStatus
  /** Place in the list — lower is nearer the top. */
  readonly rank: number
  readonly count: number
  /** Distinct page loads it broke in (approximate past the recent window). */
  readonly sessions: number
  readonly recentSessions: readonly string[]
  readonly firstAt: number
  readonly lastAt: number
  readonly origins: readonly string[]
  readonly routes: readonly string[]
  readonly title?: string
  readonly area?: string
  readonly interpretation?: string
  readonly files?: readonly string[]
  readonly mode?: RepairMode
  /** When the settled claim was made — a fix, or a retirement. One clock for
   *  both, so the fold needs one comparison to falsify either. */
  readonly fixedAt?: number
  /** When a repair conversation last put this issue in front of the
   *  participant. The tick reads it so one batch opens one conversation. */
  readonly offeredAt?: number
  readonly notes: readonly IssueNote[]
}

// ─── describing ─────────────────────────────────────────────────────────

const MESSAGE_CAP = 500
const STACK_CAP = 4000
const SOURCE_CAP = 300
const NOTE_CAP = 2000
const NOTES_KEPT = 30
const RECENT_SESSIONS = 50
const PLACES_KEPT = 8

/** Drop control and invisible/bidi codepoints and cap the length. This text
 *  is read by a person in a list and by an agent that must not be steered by
 *  what a page happened to throw. */
const clean = (value: unknown, cap: number): string => {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value)
  const t = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
  return t.length > cap ? t.slice(0, cap) : t
}

const asJson = (value: unknown): string => {
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}

type ErrorLike = { message?: unknown; stack?: unknown; name?: unknown }

const isErrorLike = (value: unknown): value is ErrorLike =>
  value instanceof Error || (
    !!value && typeof value === 'object'
    && typeof (value as ErrorLike).message === 'string'
    && typeof (value as ErrorLike).stack === 'string'
  )

/** Not breaks: the browser's own layout warning, and cancellations — which are
 *  how work is SUPPOSED to stop. */
const isNoise = (message: string, name?: unknown): boolean =>
  message.includes('ResizeObserver loop') || name === 'AbortError'

/** Only these elements failing to load breaks the page. An image that fails is
 *  handled where it is drawn (and a missing foreign picture is not a bug). */
const BREAKING_ELEMENTS: ReadonlySet<string> = new Set(['SCRIPT', 'LINK'])

/**
 * Turn what a listener saw into a break, or null when it is not one.
 *
 *   error      the window `error` event (capture phase, so resource failures too)
 *   rejection  the unhandled rejection's reason
 *   reported   the arguments of a console.error — a break only when one is an
 *              Error (Angular's ErrorHandler reports through it)
 *   warned     the arguments of a console.warn — a WARNING, and only when one
 *              is an Error; a warning that is only words is a condition the
 *              code expected, not a failure
 */
export const describeBreak = (kind: string, detail: unknown): BreakSample | null => {
  if (kind === 'error') {
    const e = detail as {
      target?: { tagName?: unknown; src?: unknown; href?: unknown }
      error?: unknown; message?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown
    } | null
    if (!e || typeof e !== 'object') return null
    const tag = typeof e.target?.tagName === 'string' ? e.target.tagName.toUpperCase() : ''
    if (tag) {
      if (!BREAKING_ELEMENTS.has(tag)) return null
      return { type: 'resource', message: `${tag.toLowerCase()} failed to load`, stack: '', source: clean(e.target?.src || e.target?.href, SOURCE_CAP) }
    }
    const err = isErrorLike(e.error) ? e.error : null
    const message = clean(err?.message ?? e.message, MESSAGE_CAP)
    // "Script error." is a cross-origin throw with everything useful withheld.
    if (!message || message === 'Script error.' || isNoise(message, err?.name)) return null
    const where = typeof e.filename === 'string' && e.filename ? `    at ${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}` : ''
    return { type: 'error', message, stack: clean(err?.stack ?? where, STACK_CAP), source: clean(e.filename, SOURCE_CAP) }
  }

  if (kind === 'rejection') {
    if (isErrorLike(detail)) {
      const message = clean(detail.message, MESSAGE_CAP)
      if (isNoise(message, detail.name)) return null
      return { type: 'rejection', message: message || clean(detail.name, 100) || 'rejected', stack: clean(detail.stack, STACK_CAP), source: '' }
    }
    const message = clean(typeof detail === 'string' ? detail : detail === undefined ? '' : asJson(detail), MESSAGE_CAP)
    return { type: 'rejection', message: message || 'rejected without a reason', stack: '', source: '' }
  }

  if (kind === 'reported' || kind === 'warned') {
    const args = Array.isArray(detail) ? detail : []
    const err = args.find(isErrorLike)
    if (!err) return null
    // Angular re-reports a window error event that carried no Error (a muted
    // cross-origin throw, `throw null`) as a NEW Error whose cause is that
    // event. The window listener already judged the event itself — recorded it
    // or dropped it as noise — so the echo is never a second break. Recognised
    // by shape: an ErrorEvent has a message, a filename and a line; a plain
    // Event wrapped by real code (a WebSocket's, IndexedDB's) has none of them.
    const cause = (err as { cause?: unknown }).cause as { message?: unknown; filename?: unknown; lineno?: unknown } | null | undefined
    if (cause && typeof cause === 'object' && typeof cause.message === 'string' && typeof cause.filename === 'string' && typeof cause.lineno === 'number') return null
    const said = args.filter((a): a is string => typeof a === 'string').join(' ')
    const message = clean([said, clean(err.message, MESSAGE_CAP)].filter(Boolean).join(': '), MESSAGE_CAP)
    if (!message || isNoise(message, err.name) || message.endsWith('Script error.')) return null
    return { type: kind === 'warned' ? 'warning' : 'reported', message, stack: clean(err.stack, STACK_CAP), source: '' }
  }

  return null
}

// ─── one break, one fingerprint ─────────────────────────────────────────

const SIG_IN_TEXT = /\b[0-9a-f]{64}\b/gi
const UUID_IN_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** The message with what varies between occurrences taken out — signatures,
 *  ids, URLs, numbers — so the same break is the same fingerprint. */
export const normalizeMessage = (message: string): string =>
  message
    .replace(SIG_IN_TEXT, '<sig>')
    .replace(UUID_IN_TEXT, '<id>')
    .replace(/\b[a-z]+:\/\/[^\s'")]+/gi, '<url>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)

/** A resource URL without its host, query or content hashes. */
const normalizeUrl = (url: string): string =>
  url
    .replace(/^[a-z]+:\/\/[^/]*/i, '')
    .replace(/[?#].*$/, '')
    .replace(SIG_IN_TEXT, '<sig>')
    .replace(UUID_IN_TEXT, '<id>')
    .replace(/-[A-Z0-9]{8}(?=\.m?js\b)/g, '')

/** The top frames of a stack, with positions, query strings, hosts and
 *  bundle hashes taken out — a rebuild must never turn one break into two. */
export const stackKey = (stack: string, frames = 3): string =>
  stack.split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('at ') || /^[^\s]*@\S/.test(line))
    .slice(0, frames)
    .map(line => line
      .replace(/\b[a-z]+:\/\/[^/\s)]*/gi, '')
      .replace(/\?[^\s):]*/g, '')
      .replace(/(:\d+)+\)?$/, '')
      .replace(SIG_IN_TEXT, '<sig>')
      .replace(UUID_IN_TEXT, '<id>')
      .replace(/-[A-Z0-9]{8}(?=\.m?js\b)/g, ''))
    .join(' | ')

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** The fingerprint: sign(type, normalized message, where it came from). */
export const fingerprintBreak = async (sample: BreakSample): Promise<string> =>
  sha256Hex([
    sample.type,
    normalizeMessage(sample.message),
    sample.type === 'resource' ? normalizeUrl(sample.source) : stackKey(sample.stack),
  ].join('\n'))

// ─── folding ────────────────────────────────────────────────────────────

const keep = (list: readonly string[], value: string, cap: number): string[] =>
  !value || list.includes(value) ? [...list] : [...list, value].slice(-cap)

export interface FoldResult {
  /** Every issue the fold changed or made, to be written whole. */
  readonly issues: ReadonlyMap<string, BreakIssue>
  readonly created: readonly string[]
  readonly reopened: readonly string[]
}

/**
 * Fold queue records into issues. Same fingerprint, same issue: counts add up,
 * the newest stack wins (it is from the build that is running), and a FIXED
 * issue that broke again in a page load started after the fix is reopened with
 * a note saying so — that is how a fix that did not hold comes back.
 */
export const foldBreaks = (
  existing: ReadonlyMap<string, BreakIssue>,
  records: readonly BreakRecord[],
  now: number,
): FoldResult => {
  const issues = new Map<string, BreakIssue>()
  const created: string[] = []
  const reopened: string[] = []
  let bottom = 0
  for (const issue of existing.values()) bottom = Math.max(bottom, issue.rank)

  for (const r of [...records].sort((a, b) => a.firstAt - b.firstAt)) {
    const prior = issues.get(r.fingerprint) ?? existing.get(r.fingerprint)
    if (!prior) {
      issues.set(r.fingerprint, {
        kind: 'break-issue@1', fingerprint: r.fingerprint,
        type: r.type, message: r.message, stack: r.stack, source: r.source,
        status: 'new', rank: ++bottom,
        count: r.count, sessions: 1, recentSessions: [r.session],
        firstAt: r.firstAt, lastAt: r.lastAt,
        origins: keep([], r.origin, PLACES_KEPT), routes: keep([], r.route, PLACES_KEPT),
        notes: [],
      })
      created.push(r.fingerprint)
      continue
    }
    // A retirement is a claim like a fix, so it is falsified like one. This is
    // the whole safety net under retiring without fixing, and it works with no
    // tick installed at all.
    const settled = prior.status === 'fixed' || prior.status === 'retired'
    const recurred = settled && typeof prior.fixedAt === 'number' && r.sessionAt > prior.fixedAt
    issues.set(r.fingerprint, {
      ...prior,
      status: recurred ? 'open' : prior.status,
      // A reopened issue has not been offered in its new state.
      offeredAt: recurred ? undefined : prior.offeredAt,
      count: prior.count + r.count,
      sessions: prior.sessions + (prior.recentSessions.includes(r.session) ? 0 : 1),
      recentSessions: keep(prior.recentSessions, r.session, RECENT_SESSIONS),
      firstAt: Math.min(prior.firstAt, r.firstAt),
      lastAt: Math.max(prior.lastAt, r.lastAt),
      origins: keep(prior.origins, r.origin, PLACES_KEPT),
      routes: keep(prior.routes, r.route, PLACES_KEPT),
      stack: r.stack && r.lastAt >= prior.lastAt ? r.stack : prior.stack,
      notes: recurred
        ? [...prior.notes, { at: now, text: `broke again after it was ${prior.status}, in a page loaded ${new Date(r.sessionAt).toISOString()}` }].slice(-NOTES_KEPT)
        : prior.notes,
    })
    if (recurred && !created.includes(r.fingerprint) && !reopened.includes(r.fingerprint)) reopened.push(r.fingerprint)
  }
  return { issues, created, reopened }
}

const STATUSES: ReadonlySet<string> = new Set(['new', 'open', 'chosen', 'fixed', 'dismissed', 'retired'])

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * Apply what the agent or the participant said about an issue. Only the fields
 * that are theirs to say: status, rank, the interpretation, the repair mode, a
 * note, and "this was offered". Counts, identity and samples belong to the
 * fold. The HIVE stamps every time — never the caller.
 */
export const patchIssue = (issue: BreakIssue, patch: Readonly<Record<string, unknown>>, now: number): BreakIssue => {
  const next: Mutable<BreakIssue> = { ...issue }
  if (typeof patch['status'] === 'string' && STATUSES.has(patch['status'])) {
    next.status = patch['status'] as IssueStatus
    if (next.status === 'fixed' || next.status === 'retired') next.fixedAt = now
  }
  if (typeof patch['rank'] === 'number' && Number.isFinite(patch['rank'])) next.rank = patch['rank']
  if (typeof patch['title'] === 'string') next.title = clean(patch['title'], 120)
  if (typeof patch['area'] === 'string') next.area = clean(patch['area'], SOURCE_CAP)
  if (typeof patch['interpretation'] === 'string') next.interpretation = clean(patch['interpretation'], NOTE_CAP)
  if (Array.isArray(patch['files'])) next.files = patch['files'].map(f => clean(f, SOURCE_CAP)).filter(Boolean).slice(0, 20)
  if (patch['mode'] === 'fix' || patch['mode'] === 'investigate') next.mode = patch['mode']
  if (patch['offered'] === true) next.offeredAt = now
  // Taken back when the conversation the mark announced never opened.
  if (patch['offered'] === false) delete next.offeredAt
  if (typeof patch['note'] === 'string' && patch['note'].trim()) {
    next.notes = [...issue.notes, { at: now, text: clean(patch['note'], NOTE_CAP) }].slice(-NOTES_KEPT)
  }
  return next
}

// ─── IO ─────────────────────────────────────────────────────────────────

const SIG = /^[0-9a-f]{64}$/

type StoreLike = { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }
type DirEntries = { entries(): AsyncIterable<[string, FileSystemHandle]> }

const openPool = async (meaning: string): Promise<FileSystemDirectoryHandle | null> =>
  (await get<StoreLike>('@hypercomb.social/Store')?.getPool?.(meaning)) ?? null

const entriesOf = (dir: FileSystemDirectoryHandle): AsyncIterable<[string, FileSystemHandle]> =>
  (dir as unknown as DirEntries).entries()

const readJson = async (handle: FileSystemFileHandle): Promise<unknown> => {
  try { return JSON.parse(await (await handle.getFile()).text()) } catch { return null }
}

const writeText = async (dir: FileSystemDirectoryHandle, name: string, body: string): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(body)
    await writable.close()
  } catch (err) {
    try { await writable.abort() } catch { /* already closed */ }
    throw err
  }
}

const isRecord = (value: unknown): value is BreakRecord =>
  !!value && typeof value === 'object'
  && (value as BreakRecord).kind === 'break@1'
  && SIG.test(String((value as BreakRecord).fingerprint))
  && typeof (value as BreakRecord).count === 'number'

const isIssue = (value: unknown, name: string): value is BreakIssue =>
  !!value && typeof value === 'object'
  && (value as BreakIssue).kind === 'break-issue@1'
  && (value as BreakIssue).fingerprint === name

/** How many records wait in the queue; null when the store is not up. */
export const queuedCount = async (): Promise<number | null> => {
  const queue = await openPool(BREAK_QUEUE_POOL)
  if (!queue) return null
  let n = 0
  for await (const [, handle] of entriesOf(queue)) if (handle.kind === 'file') n++
  return n
}

/** Append one queue record. False when the store is not up yet — the caller
 *  keeps the burst and tries again later. */
export const appendBreak = async (record: BreakRecord): Promise<boolean> => {
  const queue = await openPool(BREAK_QUEUE_POOL)
  if (!queue) return false
  const body = JSON.stringify(record)
  await writeText(queue, await sha256Hex(body), body)
  return true
}

const readLog = async (log: FileSystemDirectoryHandle): Promise<BreakIssue[]> => {
  const out: BreakIssue[] = []
  for await (const [name, handle] of entriesOf(log)) {
    if (handle.kind !== 'file' || !SIG.test(name)) continue
    const value = await readJson(handle as FileSystemFileHandle)
    if (isIssue(value, name)) out.push(value)
  }
  return out.sort((a, b) => a.rank - b.rank || a.firstAt - b.firstAt)
}

/** Every issue, top of the list first, and how many records wait to be
 *  folded. Null when the store is not up. */
export const listBreaks = async (): Promise<{ issues: BreakIssue[]; queued: number } | null> => {
  const log = await openPool(BREAK_LOG_POOL)
  const queued = await queuedCount()
  if (!log || queued === null) return null
  return { issues: await readLog(log), queued }
}

export interface CompactResult {
  /** Queue records taken into the log and removed from the queue. */
  readonly folded: number
  readonly created: readonly string[]
  readonly reopened: readonly string[]
  readonly issues: number
  /** Issues whose write did not verify — their records stay queued. */
  readonly unwritten: number
}

// Folds and updates both read-modify-write an issue document; one at a time.
let tail: Promise<unknown> = Promise.resolve()
const serially = <T>(work: () => Promise<T>): Promise<T> => {
  const run = tail.then(work, work)
  tail = run.catch(() => undefined)
  return run
}

const foldQueue = async (now: number): Promise<CompactResult | null> => {
  const queue = await openPool(BREAK_QUEUE_POOL)
  const log = await openPool(BREAK_LOG_POOL)
  if (!queue || !log) return null

  const records: BreakRecord[] = []
  const namesOf = new Map<string, string[]>()
  const litter: string[] = []
  for await (const [name, handle] of entriesOf(queue)) {
    if (handle.kind !== 'file') continue
    const file = handle as FileSystemFileHandle
    const value = await readJson(file)
    if (!isRecord(value)) {
      // A write that never finished (the tab closed mid-write). One still in
      // flight gets a minute before it counts as litter.
      try { if (now - (await file.getFile()).lastModified > 60_000) litter.push(name) } catch { /* gone already */ }
      continue
    }
    records.push(value)
    namesOf.set(value.fingerprint, [...(namesOf.get(value.fingerprint) ?? []), name])
  }

  const existing = await readLog(log)
  const fold = foldBreaks(new Map(existing.map(i => [i.fingerprint, i])), records, now)

  // Per fingerprint: write the issue, read it back, and only then remove the
  // records it took in — copy, verify, remove. A failure leaves that
  // fingerprint's records queued, so the next fold counts them exactly once.
  const written = new Set<string>()
  let folded = 0
  for (const [fingerprint, issue] of fold.issues) {
    try {
      await writeText(log, fingerprint, JSON.stringify(issue))
      const back = await readJson(await log.getFileHandle(fingerprint))
      if (!isIssue(back, fingerprint) || back.count !== issue.count) continue
    } catch { continue }
    written.add(fingerprint)
    for (const name of namesOf.get(fingerprint) ?? []) {
      try { await queue.removeEntry(name); folded++ } catch { /* already gone */ }
    }
  }
  for (const name of litter) {
    try { await queue.removeEntry(name) } catch { /* already gone */ }
  }

  const created = fold.created.filter(f => written.has(f))
  return {
    folded,
    created,
    reopened: fold.reopened.filter(f => written.has(f)),
    issues: existing.length + created.length,
    unwritten: fold.issues.size - written.size,
  }
}

/** Fold the queue into the log. Null when the store is not up. */
export const compactBreaks = (now = Date.now()): Promise<CompactResult | null> =>
  serially(() => foldQueue(now))

/**
 * Apply a patch to one issue (see `patchIssue`). `onlyIfStatus` makes the whole
 * patch conditional on the status the issue has NOW — checked here, inside the
 * serialized write, so it cannot be raced: a review's interpretation of a new
 * issue never lands on one a person has chosen since. `'refused'` means nothing
 * was written.
 */
export const updateIssue = (
  fingerprint: string,
  patch: Readonly<Record<string, unknown>>,
  now = Date.now(),
): Promise<BreakIssue | 'no-pool' | 'no-issue' | 'refused'> =>
  serially(async () => {
    const log = await openPool(BREAK_LOG_POOL)
    if (!log) return 'no-pool'
    let handle: FileSystemFileHandle
    try { handle = await log.getFileHandle(fingerprint) } catch { return 'no-issue' }
    const current = await readJson(handle)
    if (!isIssue(current, fingerprint)) return 'no-issue'
    if (typeof patch['onlyIfStatus'] === 'string' && patch['onlyIfStatus'] !== current.status) return 'refused'
    const next = patchIssue(current, patch, now)
    await writeText(log, fingerprint, JSON.stringify(next))
    return next
  })
