// sharing/domain-claim.ts
//
// CLAIMING A DOMAIN — ONE WORD (documentation/domain-claim.md; jwize
// 2026-10-01: "make it so: claim domain with one command").
//
//   domain claim inspiredbyhumans.org
//
// The hive asks its host for the domain under the participant's own key (a
// NIP-98 signed POST /claim on the host's write face) and the host answers
// with two nameservers. Setting them at the registrar is the proof of
// control; nothing else is asked. The hive then keeps asking
// (GET /claim/<domain>, public) every minute while it is open and again at
// every boot, until the claim settles or a week has passed. When the host
// reads the domain active, and answers the participant's own key with it, it
// is the participant's: its apex is their front door and every
// <name>.<domain> a place they can switch on.
//
// This module is the logic and nothing else: it registers nothing, emits
// nothing and toasts nothing. Every outcome is handed to the caller as a
// ClaimReport, and the world it touches (fetch, the signer, storage, the
// clock, the clipboard, timers) is injected, so the spec needs no browser.
// The word is in commands/domain.queen.ts.
//
// WHAT IS KEPT. Only claims still waiting, in localStorage under
// `hc:domain-claims` — a convenience of this browser, never truth: the host's
// record is the claim. A lost entry costs one more `domain claim`, which is
// idempotent on the host. Every read and write is guarded, and the claims of
// this page are mirrored in memory: without storage the word still works and
// keeps checking while the hive is open, it just cannot keep checking across
// a reload.
//
// "YOURS" IS ASKED UNDER YOUR KEY. The public reading (GET) never names the
// key that holds a claim, so `active` from it says only that SOMEONE holds the
// domain — a contest the operator settled for the other key, or a lapsed claim
// another key took, reads exactly the same. Before the hive says "yours" it
// asks again with the signed POST, which answers the holder with the claim
// (idempotent; asked of an active claim it changes nothing on the host) and
// refuses anyone else with 409.

import { get, SignatureService } from '@hypercomb/core'
import { nip98Header } from './hive-pointer.js'
import { foldContentLabel } from './zone-door.js'

/** Where waiting claims are kept, per browser. */
export const DOMAIN_CLAIMS_KEY = 'hc:domain-claims'
/** How often a waiting claim is asked about while the hive is open. */
export const CLAIM_POLL_MS = 60_000
/** How long the hive keeps asking. The host lapses a pending claim at the same age. */
export const CLAIM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/**
 * How many minutes in a row the host must say it holds no claim before a
 * watch calls the claim lost. The host also answers 404 when one read of its
 * bucket fails, and one hiccup must not end a week of waiting.
 */
export const CLAIM_LOST_AFTER = 2

const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const REASON_MAX = 200
// Loopback is its own write face, exactly as a zone root is (zone-door.ts).
const LOOPBACK_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])(?::\d{1,5})?$/i
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/
/** Special-use names (RFC 2606 / 6761) no registrar sells. */
const SPECIAL_TLDS = new Set(['localhost', 'local', 'test', 'invalid', 'example'])

export type ClaimStatus = 'pending' | 'active' | 'contested'
const STATUSES: readonly ClaimStatus[] = ['pending', 'active', 'contested']

/** The host's answer about one domain — never the key that holds it. */
export interface ClaimState {
  domain: string
  status: ClaimStatus
  nameservers: string[]
}

/** A claim this browser is still waiting on. */
export interface KeptClaim {
  /** The write face the claim was made on, bare: the zone root or a loopback
   *  host. A claim kept before the content face retired names `content.<zone>`
   *  and is read as its zone. */
  host: string
  nameservers: string[]
  /** When this hive first heard the claim was pending (ms). */
  since: number
  /** The last status read: `contested` is reported once, not every minute. */
  status: 'pending' | 'contested'
}

/** Everything the word can come back with. The caller decides how it is said. */
export type ClaimReport =
  | { kind: 'usage' }
  | { kind: 'invalid'; text: string }
  | { kind: 'badhost'; host: string }
  | { kind: 'pending'; domain: string; host: string; nameservers: string[]; again: boolean; copied: boolean }
  | { kind: 'active'; domain: string; host: string }
  | { kind: 'contested'; domain: string; host: string }
  | { kind: 'refused'; domain: string; host: string; reason: string }
  | { kind: 'unconfigured'; domain: string; host: string }
  | { kind: 'unsigned'; domain: string; host: string }
  | { kind: 'unreachable'; domain: string; host: string }
  /** The host answered a check, but not with the claim: its reason, in its own words. */
  | { kind: 'failed'; domain: string; host: string; reason: string }
  /** `word` is the line that claims it again, on the same host. */
  | { kind: 'lost'; domain: string; host: string; word: string }
  | { kind: 'expired'; domain: string; host: string; word: string }

type ClaimStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The world a claim touches, injected. `liveClaimIo()` is the browser's. */
export interface ClaimIo {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  /** The NIP-98 Authorization header for (url, method), or null with no signer.
   *  With `body`, the header also signs its sha256 (the host refuses a claim
   *  whose signature does not cover the body it carries). */
  authorize: (url: string, method: string, body?: string) => Promise<string | null>
  storage: ClaimStorage | null
  now: () => number
  /** Best effort; false when the browser refuses. Never throws. */
  copy?: (text: string) => Promise<boolean>
  every?: (tick: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

// ── names ──────────────────────────────────────────────────────────

/**
 * A domain as the host will be asked for it: lower case, ASCII (an IDN
 * becomes its punycode), no scheme, path, port or trailing dot. '' for
 * anything that is not a registrable-looking name — a single label, an
 * address, a special-use name. Whether the name can actually be claimed is
 * the host's to say.
 */
export const claimDomain = (raw: unknown): string => {
  const text = String(raw ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]?.replace(/\.+$/, '') ?? ''
  if (!text || /[:@\s\\]/.test(text)) return ''
  let ascii: string
  try { ascii = new URL(`http://${text}`).hostname } catch { return '' }
  if (!ascii || ascii.length > 253) return ''
  const labels = ascii.split('.')
  if (labels.length < 2 || !labels.every(label => LABEL_RE.test(label))) return ''
  const tld = labels[labels.length - 1]
  return TLD_RE.test(tld) && !SPECIAL_TLDS.has(tld) ? ascii : ''
}

/**
 * The write face a claim is made on: the host's ZONE ROOT — the `content.`
 * face is retired as a write target (zone-door.ts). `pluginthematrix.com`,
 * `https://content.pluginthematrix.com/` and `content.pluginthematrix.com` are
 * the same face; a loopback host is its own face. '' when it is not a host.
 */
export const claimHost = (raw: unknown): string => {
  const bare = String(raw ?? '').trim().toLowerCase()
    .replace(/^@/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]?.replace(/\.+$/, '') ?? ''
  if (!bare) return ''
  if (LOOPBACK_RE.test(bare)) return bare
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(bare)) return ''
  return foldContentLabel(bare)
}

const baseOf = (host: string): string => `${LOOPBACK_RE.test(host) ? 'http' : 'https'}://${host}`
/** POST here to claim — the exact URL the NIP-98 `u` tag names. */
export const claimUrl = (host: string): string => `${baseOf(host)}/claim`
/** GET here to read a claim. Public. */
export const claimStatusUrl = (host: string, domain: string): string => `${baseOf(host)}/claim/${domain}`

const nameserversOf = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  const names = raw
    .map(name => String(name ?? '').trim().toLowerCase().replace(/\.+$/, ''))
    .filter(name => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name))
  return [...new Set(names)].slice(0, 8)
}

/** The host's answer, checked field by field; null when it is not a claim about `domain`. */
export const claimStateOf = (raw: unknown, domain?: string): ClaimState | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const status = String(record['status'] ?? '') as ClaimStatus
  if (!STATUSES.includes(status)) return null
  const named = claimDomain(record['domain'])
  if (!named || (domain !== undefined && named !== domain)) return null
  const nameservers = nameserversOf(record['nameservers'])
  // A pending claim names its nameservers or it tells the participant nothing.
  if (status === 'pending' && !nameservers.length) return null
  return { domain: named, status, nameservers }
}

// ── what this browser keeps ────────────────────────────────────────

/** What a stored value holds, read field by field; garbage is nothing. */
const parseClaims = (raw: string | null): Record<string, KeptClaim> => {
  let parsed: unknown
  try { parsed = JSON.parse(raw ?? 'null') } catch { return {} }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const kept: Record<string, KeptClaim> = {}
  for (const [domain, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (claimDomain(domain) !== domain || !value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const host = claimHost(entry['host'])
    const since = Number(entry['since'])
    if (!host || !Number.isFinite(since) || since <= 0) continue
    kept[domain] = {
      host,
      nameservers: nameserversOf(entry['nameservers']),
      since,
      status: entry['status'] === 'contested' ? 'contested' : 'pending',
    }
  }
  return kept
}

/** What storage holds, or null when there is no storage or it refuses to be read. */
const loadClaims = (storage: ClaimStorage | null | undefined): Record<string, KeptClaim> | null => {
  if (!storage) return null
  let raw: string | null
  try { raw = storage.getItem(DOMAIN_CLAIMS_KEY) } catch { return null }
  return parseClaims(raw)
}

/** Every claim this browser is waiting on, by domain. Never throws. */
export const readClaims = (storage: ClaimStorage | null | undefined): Record<string, KeptClaim> =>
  loadClaims(storage) ?? {}

/** True when storage took the write. */
const writeClaims = (storage: ClaimStorage | null | undefined, claims: Record<string, KeptClaim>): boolean => {
  if (!storage) return false
  try {
    if (Object.keys(claims).length) storage.setItem(DOMAIN_CLAIMS_KEY, JSON.stringify(claims))
    else storage.removeItem(DOMAIN_CLAIMS_KEY)
    return true
  } catch { return false /* storage refused — the host still holds the claim */ }
}

// ── reading an answer ──────────────────────────────────────────────

type Answer =
  | { state: ClaimState }
  | { failure: 'unconfigured' | 'lost' | 'refused' | 'transient'; reason: string; status: number }

/** A signed ask, sent or not: an answer, or why it never reached the host. */
type Sent = Answer | { failure: 'unsigned' | 'unreachable' }

/** Why the host said no, in its own words: the body's first line, else X-Reason. */
const reasonOf = (res: Response, body: string): string => {
  const line = body.trim().startsWith('<') ? '' : body.trim().split(/\r?\n/)[0]?.trim() ?? ''
  const reason = line || res.headers?.get?.('X-Reason')?.trim() || `the host answered ${res.status}`
  return reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX - 1)}…` : reason
}

const answerOf = async (res: Response, domain: string, method: 'POST' | 'GET'): Promise<Answer> => {
  let body = ''
  try { body = await res.text() } catch { /* an unreadable body is an empty one */ }
  let json: unknown = null
  try { json = JSON.parse(body) } catch { /* not JSON — a refusal in prose */ }
  const state = claimStateOf(json, domain)
  // A contested claim may come back on a refusal status; it is still an answer.
  if (state && (res.ok || state.status === 'contested')) return { state }
  const reason = reasonOf(res, body)
  const status = res.status
  if (status === 503) return { failure: 'unconfigured', reason, status }
  if (method === 'POST' && (status === 404 || status === 405)) return { failure: 'unconfigured', reason, status }
  if (method === 'GET' && status === 404) return { failure: 'lost', reason, status }
  if (method === 'GET' && (status >= 500 || status === 429)) return { failure: 'transient', reason, status }
  if (res.ok) return { failure: 'transient', reason: 'the host answered something that is not a claim', status }
  return { failure: 'refused', reason, status }
}

// ── the claims ─────────────────────────────────────────────────────

/**
 * The claims of one hive: the word's two acts (claim, check) and the watch
 * that keeps asking. One timer per domain, never two; one question in flight
 * per domain, never two. Every outcome goes to `report` AND is returned.
 */
export class DomainClaims {
  readonly #io: ClaimIo
  readonly #report: (report: ClaimReport) => void
  readonly #defaultHost: string
  readonly #timers = new Map<string, unknown>()
  readonly #inflight = new Map<string, { asked: boolean; question: Promise<ClaimReport | null> }>()
  /** Minutes in a row the host has said it holds no claim, by domain. */
  readonly #misses = new Map<string, number>()
  /** What this page keeps, mirrored: the answer when storage is missing or refuses. */
  #memory: Record<string, KeptClaim> = {}
  /** False once storage has refused a read or a write; memory answers from then on. */
  #stored = true

  constructor(io: ClaimIo, report: (report: ClaimReport) => void, defaultHost: string) {
    this.#io = io
    this.#report = report
    this.#defaultHost = defaultHost
  }

  /** The domains being watched right now. */
  get watching(): string[] { return [...this.#timers.keys()].sort() }

  /**
   * THE WORD: `domain claim <domain> [@<host>]`. A claim already waiting on
   * the same host is checked at once rather than made again. Null only when
   * a tick or another tab settled the claim in the same moment — that
   * outcome was reported where it happened.
   */
  async claim(text: string, at?: string): Promise<ClaimReport | null> {
    if (!String(text ?? '').trim()) return this.#say({ kind: 'usage' })
    const domain = claimDomain(text)
    if (!domain) return this.#say({ kind: 'invalid', text: String(text).trim() })
    const named = at !== undefined ? claimHost(at) : ''
    if (at !== undefined && !named) return this.#say({ kind: 'badhost', host: String(at).replace(/^@/, '') })
    const prior = this.#claims()[domain]
    const kept = prior && !this.#expired(prior) ? prior : null
    // An expired claim not dropped yet still remembers the host it was made on.
    const host = named || prior?.host || claimHost(this.#defaultHost)
    if (!host) return this.#say({ kind: 'badhost', host: '' })
    if (kept && kept.host === host) {
      this.watch(domain)
      return this.check(domain, true)
    }
    return this.#post(domain, host)
  }

  /**
   * Ask the host where a waiting claim stands. `asked` is the participant
   * saying the word: every outcome is reported. A tick reports only what
   * changed — active, newly contested, refused, lost, expired. A question
   * already out is shared; a tick's question does not answer the
   * participant's, so theirs waits for it and is asked afresh.
   */
  check(domain: string, asked = false): Promise<ClaimReport | null> {
    const running = this.#inflight.get(domain)
    if (running && (running.asked || !asked)) return running.question
    const before = running ? running.question.catch(() => null) : Promise.resolve(null)
    const question: Promise<ClaimReport | null> = before
      .then(() => this.#ask(domain, asked))
      .finally(() => { if (this.#inflight.get(domain)?.question === question) this.#inflight.delete(domain) })
    this.#inflight.set(domain, { asked, question })
    return question
  }

  /** Keep asking about `domain` every minute. Idempotent. */
  watch(domain: string): void {
    if (this.#timers.has(domain)) return
    const every = this.#io.every ?? ((tick: () => void, ms: number) => setInterval(tick, ms))
    this.#timers.set(domain, every(() => { void this.check(domain) }, CLAIM_POLL_MS))
  }

  /** Stop asking about `domain`. */
  stop(domain: string): void {
    this.#misses.delete(domain)
    if (!this.#timers.has(domain)) return
    const cancel = this.#io.cancel ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>))
    cancel(this.#timers.get(domain))
    this.#timers.delete(domain)
  }

  /**
   * AT BOOT: every claim younger than a week is asked about now and watched;
   * an older one is dropped and reported expired. Returns how many are watched.
   */
  resume(): number {
    let watched = 0
    for (const [domain, kept] of Object.entries(this.#claims())) {
      if (this.#expired(kept)) { this.#expire(domain, kept); continue }
      this.watch(domain)
      void this.check(domain)
      watched++
    }
    return watched
  }

  /** The signed ask, POST /claim under the participant's key — or why it was never sent. */
  async #send(domain: string, host: string): Promise<Sent> {
    const url = claimUrl(host)
    const body = JSON.stringify({ domain })
    const auth = await this.#io.authorize(url, 'POST', body).catch(() => null)
    if (!auth) return { failure: 'unsigned' }
    let res: Response
    try {
      res = await this.#io.fetch(url, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body,
        cache: 'no-store',
      })
    } catch { return { failure: 'unreachable' } }
    return answerOf(res, domain, 'POST')
  }

  async #post(domain: string, host: string): Promise<ClaimReport | null> {
    const sent = await this.#send(domain, host)
    if (!('failure' in sent)) return this.#settle(domain, host, sent.state, true, null)
    switch (sent.failure) {
      case 'unsigned': return this.#say({ kind: 'unsigned', domain, host })
      case 'unreachable': return this.#say({ kind: 'unreachable', domain, host })
      case 'unconfigured': return this.#say({ kind: 'unconfigured', domain, host })
      default: return this.#say({ kind: 'refused', domain, host, reason: sent.reason })
    }
  }

  async #ask(domain: string, asked: boolean): Promise<ClaimReport | null> {
    const kept = this.#claims()[domain]
    if (!kept) { this.stop(domain); return null }
    if (this.#expired(kept)) return this.#expire(domain, kept)
    let res: Response
    try {
      res = await this.#io.fetch(claimStatusUrl(kept.host, domain), { method: 'GET', cache: 'no-store' })
    } catch {
      return asked ? this.#say({ kind: 'unreachable', domain, host: kept.host }) : null
    }
    const answer = await answerOf(res, domain, 'GET')
    // Another tab of this hive may have settled it while the question was out.
    const current = this.#claims()[domain]
    if (!current) { this.stop(domain); return null }
    const host = current.host
    if ('failure' in answer && answer.failure === 'lost') {
      // The host says it holds no claim — but it says the same when one read
      // of its bucket fails. A watch waits for the next minute to say it
      // again; the participant asking is told at once, and saying the word
      // once more claims afresh (idempotent if the claim still stands).
      const misses = (this.#misses.get(domain) ?? 0) + 1
      if (!asked && misses < CLAIM_LOST_AFTER) { this.#misses.set(domain, misses); return null }
      this.#drop(domain)
      this.stop(domain)
      return this.#say({ kind: 'lost', domain, host, word: this.#word(domain, host) })
    }
    this.#misses.delete(domain)
    if ('failure' in answer) {
      if (!asked) return null
      if (answer.failure === 'unconfigured') return this.#say({ kind: 'unconfigured', domain, host })
      // The host answered, just not with the claim: its words, not "unreachable".
      return this.#say({ kind: 'failed', domain, host, reason: answer.reason })
    }
    // The public reading never names the key, so "active" is SOMEONE's.
    if (answer.state.status === 'active') return this.#confirm(domain, current, asked)
    return this.#settle(domain, host, answer.state, asked, current)
  }

  /**
   * The public reading said active. Ask under the participant's key whether
   * it is theirs: the holder is answered with the claim, anyone else with
   * 409 — someone else's claim, settled against this one. A confirmation
   * that cannot be had now (no signer yet, the host down) is asked again next
   * minute; the participant who asked is told why.
   */
  async #confirm(domain: string, kept: KeptClaim, asked: boolean): Promise<ClaimReport | null> {
    const host = kept.host
    const sent = await this.#send(domain, host)
    const current = this.#claims()[domain]
    if (!current) { this.stop(domain); return null }
    if (!('failure' in sent)) return this.#settle(domain, host, sent.state, asked, current)
    if (sent.failure === 'refused' && sent.status === 409) {
      this.#drop(domain)
      this.stop(domain)
      return this.#say({ kind: 'refused', domain, host, reason: sent.reason })
    }
    if (!asked) return null
    switch (sent.failure) {
      case 'unsigned': return this.#say({ kind: 'unsigned', domain, host })
      case 'unreachable': return this.#say({ kind: 'unreachable', domain, host })
      case 'unconfigured': return this.#say({ kind: 'unconfigured', domain, host })
      default: return this.#say({ kind: 'failed', domain, host, reason: sent.reason })
    }
  }

  /**
   * One answer, applied: kept and watched while it waits, dropped once it is
   * the participant's. `active` arrives here only from the signed POST — the
   * one answer that is the participant's own.
   */
  async #settle(domain: string, host: string, state: ClaimState, asked: boolean, kept: KeptClaim | null): Promise<ClaimReport | null> {
    if (state.status === 'active') {
      this.#drop(domain)
      this.stop(domain)
      return this.#say({ kind: 'active', domain, host })
    }
    const nameservers = state.nameservers.length ? state.nameservers : (kept?.nameservers ?? [])
    const since = kept && kept.host === host ? kept.since : this.#io.now()
    this.#keep(domain, { host, nameservers, since, status: state.status })
    this.watch(domain)
    if (state.status === 'contested') {
      return asked || kept?.status !== 'contested' ? this.#say({ kind: 'contested', domain, host }) : null
    }
    if (!asked) return null
    const copied = nameservers.length ? await this.#copy(nameservers.join('\n')) : false
    return this.#say({ kind: 'pending', domain, host, nameservers, again: kept !== null, copied })
  }

  /** What this page keeps: storage's, while it answers; this page's own copy once it does not. */
  #claims(): Record<string, KeptClaim> {
    const stored = this.#stored ? loadClaims(this.#io.storage) : null
    if (stored) this.#memory = stored
    else this.#stored = false
    return { ...this.#memory }
  }

  #write(claims: Record<string, KeptClaim>): void {
    this.#memory = { ...claims }
    if (this.#stored && !writeClaims(this.#io.storage, claims)) this.#stored = false
  }

  #keep(domain: string, claim: KeptClaim): void {
    this.#write({ ...this.#claims(), [domain]: claim })
  }

  #drop(domain: string): void {
    const claims = this.#claims()
    if (!(domain in claims)) return
    delete claims[domain]
    this.#write(claims)
  }

  #expired(kept: KeptClaim): boolean {
    return this.#io.now() - kept.since > CLAIM_MAX_AGE_MS
  }

  #expire(domain: string, kept: KeptClaim): ClaimReport {
    this.#drop(domain)
    this.stop(domain)
    return this.#say({ kind: 'expired', domain, host: kept.host, word: this.#word(domain, kept.host) })
  }

  /** The line that claims `domain` again on `host` — naming the host unless it is the default. */
  #word(domain: string, host: string): string {
    return host === claimHost(this.#defaultHost) ? `domain claim ${domain}` : `domain claim ${domain} @${host}`
  }

  async #copy(text: string): Promise<boolean> {
    try { return (await this.#io.copy?.(text)) === true } catch { return false }
  }

  #say(report: ClaimReport): ClaimReport {
    try { this.#report(report) } catch { /* a listener's failure is not the claim's */ }
    return report
  }
}

// ── the browser's world ────────────────────────────────────────────

type SignerLike = Parameters<typeof nip98Header>[0]

/** The live io: window fetch, the participant's NostrSigner, localStorage, the clipboard. */
export const liveClaimIo = (): ClaimIo => ({
  fetch: (url, init) => fetch(url, init),
  authorize: async (url, method, body) => {
    const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
    if (!signer?.signEvent) return null
    return nip98Header(signer, url, method, body === undefined ? undefined : await SignatureService.sign(new TextEncoder().encode(body).buffer as ArrayBuffer))
  },
  storage: (() => { try { return globalThis.localStorage ?? null } catch { return null } })(),
  now: () => Date.now(),
  copy: async text => {
    try { await navigator.clipboard.writeText(text); return true } catch { return false }
  },
})
