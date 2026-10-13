// sharing/version-answers.ts
//
// WHAT BECAME OF A DRAFT. A builder answers every ask it takes — built,
// refused or failed — with a signed word (hypercomb-shim host/builder.mjs
// answerEvent), and the host it was asked on notes that word for the ask's
// author alone (hypercomb-relay build-asks.js, the worker's host:answers).
// This brings those answers back into the browser that asked:
//
//   1. the LISTING, asked of each host this key sent an open ask to, under the
//      key's own signature (NIP-98): `<answer signature> <origin>` per line
//   2. each ANSWER by its signature, kept only when it is one — shaped exactly
//      as a builder signs it, verifying, answering an ask of this key's that
//      is held here, listed by the host that ask was sent to
//   3. a BUILT answer is kept only once everything it names is held here:
//      each revision, which must name this draft and this ask, sit in a drafts
//      channel and carry the label and version the answer says; the builder's
//      signature on each, verifying; and the closure each needs
//      (version-pools.ts revisionClosure, the builder's own walk). Every file
//      is taken by its name and kept only if it hashes to it.
//
// NOTHING IS KEPT UNTIL THE ANSWER IS. What a take fetches is held in memory
// and written only once every check has passed — the revisions last — so a
// builder or a host cannot leave a file behind by answering falsely, and
// nothing in a build but the revisions the answer names may be a revision or
// a draft. One refresh takes at most MAX_TAKE_FILES files and MAX_TAKE_BYTES
// bytes in all, counted as they arrive.
//
// So an answer held here means its revisions are whole here, and a device
// that asked is a backup of what was built from its draft. A revision built
// from a draft sits in the drafts channel: seen, never taken as the
// channel's next until it is reviewed. A builder's why is its words, not the
// author's: shown as it was said, never followed.

import { SignatureService } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'
import { nip98Header } from './hive-pointer.js'
import { ASK_KIND, DRAFT_HEAD, DRAFTS_HERE_MEANING, askPreimage, signerHere, type Signer } from './version-drafts.js'
import {
  BUILD_HEAD, BUILDS_MEANING, BUILD_SIGNATURE_KIND, DRAFTS_SUFFIX, HEAD_BYTES, SIGNATURES_MEANING, opfsPools, poolHeads,
  revisionClosure, signaturePreimage, type PoolIo,
} from './version-pools.js'

export const ANSWER_KIND = 30569
export const ANSWERS_MEANING = 'host:answers'
export const answerPreimage = (ask: string, state: string): string => `hc:answer:v1\n${ask}\n${state}`
export const ANSWER_STATES = ['built', 'refused', 'failed'] as const
export type AnswerState = typeof ANSWER_STATES[number]
/** A host keeps an ask this long; a builder answers within it. */
export const ASK_TTL_DAYS = 7
/** A host lists an answer this long after it was given. */
export const ANSWER_TTL_DAYS = 14
/** The clock allowance a host gives an event's time (build-asks.js). */
const AHEAD_SECS = 600
/** The most files one refresh takes for built drafts. A build that changed
 *  every dependency it vendors is still well below. */
export const MAX_TAKE_FILES = 4096
/** The most bytes one refresh takes for built drafts, counted as they
 *  arrive — what turns out not to be what it is named counts too. */
export const MAX_TAKE_BYTES = 128 * 1024 * 1024
/** Answers read from one host's listing in one refresh, newest first. */
export const MAX_LISTED = 64
/** The most a listing may say: a name and an origin a line. */
const MAX_LISTING_BYTES = 1 << 20

const MAX_ASK_BYTES = 4096
const MAX_ANSWER_BYTES = 4096
const MAX_WHY = 280
const MAX_BUILT = 4
/** A label or a version as a revision names it: short, one line. */
const NAME = /^[^\u0000-\u001f\u007f]{1,64}$/
/** One line of why. */
const WHY = /^[^\u0000-\u001f\u007f]+$/
const SIG = /^[a-f0-9]{64}$/
/** Files fetched at once from one host. */
const AT_ONCE = 8
/** Files read at once from this browser's own pools. */
const READ_AT_ONCE = 32
const DAY = 86_400

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const signOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
const poolOf = (meaning: string): Promise<string> => SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)

type Event = { kind?: unknown; pubkey?: unknown; content?: unknown; tags?: unknown; created_at?: unknown; id?: unknown; sig?: unknown }
const tagsOf = (event: Event): string[][] =>
  Array.isArray(event.tags) ? event.tags.filter((t): t is string[] => Array.isArray(t) && t.every(part => typeof part === 'string')) : []
const tag = (event: Event, name: string): string | undefined => tagsOf(event).find(t => t[0] === name)?.[1]
const eventOf = (bytes: Uint8Array | null, max: number): Event | null => {
  if (!bytes || bytes.byteLength > max || bytes[0] !== 0x7b) return null
  try {
    const event = JSON.parse(decode(bytes)) as unknown
    return event && typeof event === 'object' && !Array.isArray(event) ? event as Event : null
  } catch { return null }
}
const verifies = (event: Event): boolean => { try { return verifyEvent(event as never) } catch { return false } }
const json = (bytes: Uint8Array | null): unknown => {
  if (!bytes || bytes[0] !== 0x7b) return null
  try { return JSON.parse(decode(bytes)) } catch { return null }
}

/** The origin a host string names, normalized — lowercase, no default port,
 *  no path; https unless it is loopback (build-asks.js originOf, the same). */
const originOf = (host: string): string => {
  const text = String(host ?? '').trim()
  if (!text) return ''
  const loopback = /^(localhost|127\.|\[::1\])/i.test(text) || /^[^/:]+\.localhost(?::\d+)?(?:\/|$)/i.test(text)
  const withScheme = /^https?:\/\//i.test(text) ? text : `${loopback ? 'http' : 'https'}://${text}`
  try { return new URL(withScheme).origin } catch { return '' }
}

export type HeldAsk = { sig: string; draft: string; author: string; origin: string; at: number }

/** The ask these bytes are, when they are one and it verifies. */
export const askOf = async (bytes: Uint8Array | null): Promise<HeldAsk | null> => {
  const event = eventOf(bytes, MAX_ASK_BYTES)
  if (!event || event.kind !== ASK_KIND) return null
  const draft = tag(event, 'd') ?? ''
  const author = String(event.pubkey ?? '')
  if (!SIG.test(draft) || event.content !== askPreimage(draft) || !SIG.test(author) || !verifies(event)) return null
  return { sig: await signOf(bytes!), draft, author, origin: originOf(tag(event, 'h') ?? ''), at: Number(event.created_at) || 0 }
}

export type Answer = {
  sig: string
  ask: string
  builder: string
  author: string
  state: AnswerState
  /** Refused and failed: the builder's one line. Its words, never the author's. */
  why: string | null
  /** Built: what it promoted. */
  built: { sig: string; label: string; version: string }[]
  /** Built: the builder's signatures on them. */
  signatures: string[]
  origin: string
  at: number
}

/** The answer these bytes are — shaped exactly as a builder signs it
 *  (build-asks.js answerShape, the same rule) and verifying — or null. */
export const answerOf = async (bytes: Uint8Array | null): Promise<Answer | null> => {
  const event = eventOf(bytes, MAX_ANSWER_BYTES)
  if (!event || event.kind !== ANSWER_KIND || !Array.isArray(event.tags)) return null
  const ask = tag(event, 'd') ?? ''
  const state = tag(event, 's') ?? ''
  if (!SIG.test(ask) || !(ANSWER_STATES as readonly string[]).includes(state) || event.content !== answerPreimage(ask, state)) return null
  const builder = String(event.pubkey ?? '')
  const author = tag(event, 'p') ?? ''
  if (!SIG.test(builder) || !SIG.test(author)) return null
  const why = tag(event, 'why')
  if (state === 'built' ? why !== undefined : !(typeof why === 'string' && why.length <= MAX_WHY && WHY.test(why))) return null
  const named = (name: string): string[][] => tagsOf(event).filter(t => t[0] === name)
  const built = named('b')
  const signatures = named('g')
  if (built.length > MAX_BUILT || signatures.length > MAX_BUILT * 2) return null
  if (built.some(t => !SIG.test(t[1] ?? '') || !NAME.test(t[2] ?? '') || !NAME.test(t[3] ?? ''))) return null
  if (signatures.some(t => !SIG.test(t[1] ?? ''))) return null
  if (state === 'built' ? built.length === 0 : built.length + signatures.length > 0) return null
  if (!verifies(event)) return null
  return {
    sig: await signOf(bytes!), ask, builder, author, state: state as AnswerState, why: why ?? null,
    built: built.map(t => ({ sig: t[1]!, label: t[2]!, version: t[3]! })),
    signatures: signatures.map(t => t[1]!),
    origin: originOf(tag(event, 'h') ?? ''), at: Number(event.created_at) || 0,
  }
}

/** Each pool member judged once per pools: a member is named by its bytes, so
 *  what it is never changes, and the next call reads only names it has not
 *  seen. Many at once; an empty member (a write cut short) is judged again. */
const judgedOnce = <T extends { sig: string }>(meaning: string, judge: (bytes: Uint8Array) => Promise<T | null>) => {
  const seen = new WeakMap<PoolIo, Map<string, T | null>>()
  return async (io: PoolIo): Promise<Map<string, T>> => {
    let known = seen.get(io)
    if (!known) seen.set(io, known = new Map())
    const names = await io.names(meaning)
    const fresh = names.filter(name => !known.has(name))
    for (let i = 0; i < fresh.length; i += READ_AT_ONCE) {
      await Promise.all(fresh.slice(i, i + READ_AT_ONCE).map(async name => {
        const bytes = await io.read(meaning, name)
        if (!bytes?.byteLength) return
        const value = await judge(bytes)
        known.set(name, value?.sig === name ? value : null)
      }))
    }
    return new Map(names.flatMap(name => { const value = known.get(name); return value ? [[name, value] as [string, T]] : [] }))
  }
}
const asksIn = judgedOnce(SIGNATURES_MEANING, askOf)
const answersIn = judgedOnce(ANSWERS_MEANING, answerOf)

/** Every verifying ask held here, by its signature. */
export const heldAsks = (io: PoolIo = opfsPools()): Promise<Map<string, HeldAsk>> => asksIn(io)

/** Every answer held here that answers one of `asks`, for its own author. */
export const heldAnswers = async (asks: ReadonlyMap<string, HeldAsk>, io: PoolIo = opfsPools()): Promise<Answer[]> =>
  [...(await answersIn(io)).values()].filter(answer => asks.get(answer.ask)?.author === answer.author)

/** An answer that can never be taken here, as it stands: kept out, said why,
 *  and not walked again while this page lasts. */
class Untaken extends Error {}
/** Listed answers judged for good while this page lasts: not this key's, or
 *  never to be taken. */
const judged = new WeakMap<PoolIo, Set<string>>()

type Budget = { files: number; bytes: number }

/** A body, at most `cap` bytes: null when it says or proves to be more. */
const capped = async (response: Response, cap: number): Promise<Uint8Array | null> => {
  const declared = Number(response.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > cap) { await response.body?.cancel().catch(() => undefined); return null }
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength > cap ? null : bytes
  }
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) { await reader.cancel().catch(() => undefined); return null }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.byteLength }
  return out
}

/**
 * Bytes by signature from one host: its flat address, then the pool it keeps
 * them in, at its root or under /content. Wrong bytes from one place are no
 * bytes; the next place is asked. Every byte that arrives counts against the
 * refresh's budget. Past the budget: an answer that alone needs more can never
 * be taken here; one that started after others waits for the next refresh.
 */
const fetcher = (origin: string, get: typeof fetch, budget: Budget) => {
  const first = budget.files === 0 && budget.bytes === 0
  const over = (what: string): Error => first
    ? new Untaken(`the build needs more than ${what} — more than this browser takes from one answer`)
    : new Error('this refresh has taken all it takes; the rest comes on the next')
  const fetchSig = async (meaning: string, sig: string, cap = MAX_TAKE_BYTES - budget.bytes): Promise<Uint8Array> => {
    const pool = await poolOf(meaning)
    let unanswered = false
    for (const url of [`${origin}/${sig}`, `${origin}/${pool}/${sig}`, `${origin}/content/${sig}`, `${origin}/content/${pool}/${sig}`]) {
      const response = await get(url).catch(() => null)
      if (!response || (!response.ok && response.status !== 404 && response.status !== 410)) unanswered = true
      if (!response?.ok) continue
      const bytes = await capped(response, Math.max(0, cap)).catch(() => undefined)
      if (bytes === undefined) { unanswered = true; continue }
      if (bytes === null) throw over(`${Math.round(MAX_TAKE_BYTES / 1048576)} MB`)
      budget.bytes += bytes.byteLength
      if (await signOf(bytes) !== sig) continue
      if (++budget.files > MAX_TAKE_FILES) throw over(`${MAX_TAKE_FILES} files`)
      return bytes
    }
    throw new Error(`${origin} ${unanswered ? 'did not answer for' : 'does not serve'} ${sig.slice(0, 12)}`)
  }
  return { fetchSig, over }
}

/**
 * TAKE WHAT A BUILT ANSWER NAMES from the host that listed it, keeping nothing
 * until all of it is checked: the revisions (each this draft's, this ask's,
 * in a drafts channel, as the answer names it), the builder's signature on
 * each, every file their closure needs that is not held here, and no
 * revision or draft among those files but what the answer names. Then the
 * files, the signatures, and the revisions last. Returns how many files it
 * kept.
 */
const takeBuilt = async (answer: Answer, ask: HeldAsk, origin: string, io: PoolIo, get: typeof fetch, budget: Budget): Promise<number> => {
  const { fetchSig, over } = fetcher(origin, get, budget)
  // Held: named here and not empty (a write cut short leaves an empty file).
  const heads = await poolHeads(io, BUILDS_MEANING)
  const held = (sig: string): boolean => !!heads.get(sig)
  const staged = new Map<string, Uint8Array>()
  const stage = async (sig: string): Promise<Uint8Array> => {
    const bytes = await fetchSig(BUILDS_MEANING, sig)
    staged.set(sig, bytes)
    return bytes
  }
  const bytesOf = async (sig: string): Promise<Uint8Array> =>
    staged.get(sig) ?? (held(sig) ? await io.read(BUILDS_MEANING, sig) : null) ?? await stage(sig)

  // 1. Each revision is this draft's, from this ask, in a drafts channel —
  //    never a channel's next — as the answer names it.
  const revisions = new Set<string>()
  for (const b of answer.built) {
    if (!b.label.endsWith(DRAFTS_SUFFIX)) throw new Untaken(`${b.sig.slice(0, 12)} is not in a drafts channel`)
    const record = json(await bytesOf(b.sig)) as Record<string, unknown> | null
    if (record?.['name'] !== 'build' || record['draft'] !== ask.draft || record['ask'] !== ask.sig
      || record['label'] !== b.label || record['version'] !== b.version) {
      throw new Untaken(`${b.sig.slice(0, 12)} is not a revision of this draft`)
    }
    revisions.add(b.sig)
  }
  // 2. Each carries its builder's signature, before anything more is taken.
  const versionOf = new Map(answer.built.map(b => [b.sig, b.version]))
  const signedHere = new Set(await io.names(SIGNATURES_MEANING))
  const vouched = new Set<string>()
  const signatures = new Map<string, Uint8Array>()
  for (const g of answer.signatures) {
    const local = signedHere.has(g) ? await io.read(SIGNATURES_MEANING, g) : null
    const bytes = local?.byteLength ? local : await fetchSig(SIGNATURES_MEANING, g, MAX_ANSWER_BYTES)
    const event = eventOf(bytes, MAX_ANSWER_BYTES)
    const b = event ? tag(event, 'b') ?? '' : ''
    const version = versionOf.get(b)
    if (!event || event.kind !== BUILD_SIGNATURE_KIND || event.pubkey !== answer.builder || !version || tag(event, 'r') !== 'builder'
      || event.content !== signaturePreimage(b, version, 'builder') || !verifies(event)) {
      throw new Untaken(`${g.slice(0, 12)} is not the builder's signature on this build`)
    }
    vouched.add(b)
    if (!local?.byteLength) signatures.set(g, bytes)
  }
  for (const sig of revisions) if (!vouched.has(sig)) throw new Untaken(`${sig.slice(0, 12)} carries no signature of its builder`)
  // 3. Every file they need, walked as the builder walks it.
  const reach = await revisionClosure([...revisions], async sig => json(await bytesOf(sig)))
  const missing = [...reach].filter(sig => !held(sig) && !staged.has(sig))
  if (missing.length > MAX_TAKE_FILES - budget.files) throw over(`${MAX_TAKE_FILES} files`)
  for (let i = 0; i < missing.length; i += AT_ONCE) await Promise.all(missing.slice(i, i + AT_ONCE).map(stage))
  // 4. A build carries no revision and no draft but its own.
  for (const [sig, bytes] of staged) {
    if (revisions.has(sig) || sig === ask.draft) continue
    const head = decode(bytes.subarray(0, HEAD_BYTES))
    if (head === BUILD_HEAD || head === DRAFT_HEAD) throw new Untaken(`${sig.slice(0, 12)} is a revision or a draft this answer does not name`)
  }
  // 5. Kept: the files, the signatures, the revisions last.
  let kept = 0
  for (const [sig, bytes] of staged) if (!revisions.has(sig)) { await io.write(BUILDS_MEANING, sig, bytes); kept++ }
  for (const [g, bytes] of signatures) await io.write(SIGNATURES_MEANING, g, bytes)
  for (const sig of revisions) {
    const bytes = staged.get(sig)
    if (bytes) { await io.write(BUILDS_MEANING, sig, bytes); kept++ }
  }
  return kept
}

export type TakeReport = {
  /** Each host asked, and whether it listed. */
  hosts: { host: string; answered: boolean }[]
  /** Answers newly kept, by state. */
  built: number
  refused: number
  failed: number
  /** Listed, but not an answer to an ask of this key's sent to that host. */
  ignored: number
  /** Listed past MAX_LISTED, or not to be had just now: left for the next refresh. */
  unread: number
  /** Files kept for built drafts. */
  files: number
  /** Answers not kept, each with why. */
  pending: { answer: string; why: string }[]
  error?: string
}

/**
 * Ask each host this key sent an open ask to (or those of `hosts`) what its
 * builders answered, and keep every answer that is one — a built one only
 * once what it names is held here (takeBuilt). An ask is open while no built
 * answer to it is held and a host may still list an answer to it: a builder
 * answers within ASK_TTL_DAYS, and the host lists the answer ANSWER_TTL_DAYS.
 */
export const takeAnswers = async ({
  io = opfsPools(), sign = signerHere(), get = (input, init) => fetch(input, init), hosts, now = Date.now(),
}: { io?: PoolIo; sign?: Signer; get?: typeof fetch; hosts?: readonly string[]; now?: number } = {}): Promise<TakeReport> => {
  const report: TakeReport = { hosts: [], built: 0, refused: 0, failed: 0, ignored: 0, unread: 0, files: 0, pending: [] }
  const me = sign ? await sign.getPublicKeyHex?.().catch(() => null) ?? null : null
  if (!sign || !me) return { ...report, error: 'no signer here: answers are listed to the key that asked' }
  const asks = new Map([...await heldAsks(io)].filter(([, ask]) => ask.author === me))
  const done = new Set((await heldAnswers(asks, io)).filter(a => a.state === 'built').map(a => a.ask))
  const since = now / 1000 - (ASK_TTL_DAYS + ANSWER_TTL_DAYS) * DAY - AHEAD_SECS
  const named = hosts?.length ? new Set(hosts.map(originOf).filter(Boolean)) : null
  const where = [...new Set([...asks.values()].filter(a => !done.has(a.sig) && a.at > since && a.origin).map(a => a.origin))]
    .filter(origin => !named || named.has(origin))
  const kept = new Set(await io.names(ANSWERS_MEANING))
  let settled = judged.get(io)
  if (!settled) judged.set(io, settled = new Set())
  const budget: Budget = { files: 0, bytes: 0 }
  const listing = `/${await poolOf(ANSWERS_MEANING)}/`
  for (const origin of where) {
    const url = `${origin}${listing}`
    const auth = await nip98Header(sign, url, 'GET')
    const response = auth ? await get(url, { headers: { Authorization: auth }, cache: 'no-store' }).catch(() => null) : null
    const body = response?.ok && (response.headers.get('content-type') ?? 'text/plain').startsWith('text/plain')
      ? await capped(response, MAX_LISTING_BYTES).catch(() => null) : null
    report.hosts.push({ host: origin, answered: !!body })
    if (!body) continue
    // Only answers noted for asks sent to this host, not yet kept or judged.
    const listed = [...new Set(decode(body).split(/\r?\n/).flatMap(line => {
      const [sig = '', at = ''] = line.trim().split(/\s+/)
      return SIG.test(sig) && originOf(at) === origin && !kept.has(sig) && !settled.has(sig) ? [sig] : []
    }))]
    report.unread += Math.max(0, listed.length - MAX_LISTED)
    for (const sig of listed.slice(0, MAX_LISTED)) {
      const bytes = await fetcher(origin, get, { files: 0, bytes: 0 }).fetchSig(ANSWERS_MEANING, sig, MAX_ANSWER_BYTES).catch(() => null)
      if (!bytes) { report.unread++; continue }
      const answer = await answerOf(bytes)
      const ask = answer ? asks.get(answer.ask) : undefined
      if (!answer || !ask || answer.author !== ask.author || answer.origin !== ask.origin || ask.origin !== origin) {
        settled.add(sig)
        report.ignored++
        continue
      }
      try {
        if (answer.state === 'built') report.files += await takeBuilt(answer, ask, origin, io, get, budget)
        await io.write(ANSWERS_MEANING, sig, bytes)
      } catch (error) {
        if (error instanceof Untaken) settled.add(sig)
        report.pending.push({ answer: sig, why: error instanceof Error ? error.message : String(error) })
        continue
      }
      kept.add(sig)
      report[answer.state]++
    }
  }
  return report
}

export type DraftState = 'staged' | 'asked' | 'lapsed' | AnswerState

export type DraftStatus = {
  draft: string
  label: string
  base: string
  at: string
  paths: string[]
  state: DraftState
  /** The newest ask for it, and the host it went to. */
  ask: { sig: string; origin: string; at: number } | null
  /** The answer that decides the state: a built one, else the newest to the
   *  newest ask. Its why is the builder's words. */
  answer: { sig: string; builder: string; state: AnswerState; why: string | null; at: number } | null
  /** Every answer held for it: builders' words, all of them. */
  said: string[]
  /** What it was built as, held here. */
  built: { sig: string; label: string; version: string }[]
}

type DraftRecord = { name?: unknown; label?: unknown; base?: unknown; at?: unknown; files?: unknown }

/**
 * WHERE EACH DRAFT STANDS, from what this browser holds alone — no network:
 * built (a builder built it, and the revisions are here), refused or failed
 * (the newest word on its newest ask), asked (no word yet), lapsed (no word,
 * and too old for a builder to take), or staged (never asked). The asks are
 * `me`'s; with no key known, those for drafts staged here. `staged` adds the
 * drafts staged here and never asked. Newest first.
 */
export const draftStatus = async (
  io: PoolIo = opfsPools(),
  { me = null, staged = false, now = Date.now() }: { me?: string | null; staged?: boolean; now?: number } = {},
): Promise<DraftStatus[]> => {
  const here = new Set(await io.names(DRAFTS_HERE_MEANING))
  const asks = new Map([...await heldAsks(io)].filter(([, ask]) => me ? ask.author === me : here.has(ask.draft)))
  const answers = await heldAnswers(asks, io)
  const byDraft = new Map<string, HeldAsk[]>()
  for (const ask of asks.values()) byDraft.set(ask.draft, [...byDraft.get(ask.draft) ?? [], ask])
  const drafts = new Set(byDraft.keys())
  if (staged) for (const draft of here) drafts.add(draft)
  const out: DraftStatus[] = []
  for (const draft of drafts) {
    const record = json(await io.read(BUILDS_MEANING, draft) ?? await io.read(DRAFTS_HERE_MEANING, draft)) as DraftRecord | null
    if (record?.name !== 'draft') continue
    const layer = typeof record.files === 'string' ? json(await io.read(BUILDS_MEANING, record.files)) as { files?: unknown } | null : null
    const mine = (byDraft.get(draft) ?? []).sort((a, b) => b.at - a.at || (a.sig < b.sig ? -1 : 1))
    const newest = mine[0] ?? null
    const said = answers.filter(a => mine.some(ask => ask.sig === a.ask)).sort((a, b) => b.at - a.at || (a.sig < b.sig ? -1 : 1))
    const builtAnswer = said.find(a => a.state === 'built') ?? null
    const decided = builtAnswer ?? said.find(a => a.ask === newest?.sig) ?? null
    const built: DraftStatus['built'] = []
    for (const b of builtAnswer?.built ?? []) if ((await io.read(BUILDS_MEANING, b.sig))?.byteLength) built.push(b)
    const state: DraftState = decided
      ? decided.state
      : !newest ? 'staged' : newest.at > now / 1000 - ASK_TTL_DAYS * DAY ? 'asked' : 'lapsed'
    out.push({
      draft, label: String(record.label ?? ''), base: String(record.base ?? ''), at: String(record.at ?? ''),
      paths: Object.keys(layer?.files && typeof layer.files === 'object' ? layer.files : {}).sort(),
      state,
      ask: newest ? { sig: newest.sig, origin: newest.origin, at: newest.at } : null,
      answer: decided ? { sig: decided.sig, builder: decided.builder, state: decided.state, why: decided.why, at: decided.at } : null,
      said: said.map(a => a.sig),
      built,
    })
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.draft < b.draft ? -1 : 1))
}
