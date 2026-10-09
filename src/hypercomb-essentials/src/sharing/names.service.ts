// sharing/names.service.ts
//
// WHO A KEY IS, SEEN WITH ITS HOST (documentation/sealed-audiences.md, Names).
//
// A host is a domain, so a participant's name is their name AT their host:
// `leanne@cafesociety.me`. NIP-05 makes the DOMAIN the voucher — the name is
// true when `https://<host>/.well-known/nostr.json` answers
// `{ "names": { "<name>": "<hex pubkey>" } }`. This service reads that
// document and answers, wherever the hive shows a key, the best thing it can
// honestly say about it:
//
//   1. a name VERIFIED against a host — `jwize@jwize.com`, or just the host
//      for the domain's own key (`_`);
//   2. else the caller's own unverified claim (a swarm label, a ledger
//      label), marked unverified — the mark LEADS, so no claim can push it
//      out of view, and a verified name can never begin with it;
//   3. else a short npub.
//
// ONE request per host: the whole document (no `?name=`), inverted to
// pubkey → names, shared by every caller while in flight, kept in memory only
// — ten minutes for an answer, two for a failure. Nothing is written anywhere.
// When an answer a surface is showing runs out, `names:changed` says so; the
// surfaces re-read, and only what is still on screen is asked again.
//
// WHICH HOSTS ARE ASKED — exactly two kinds, never a host named in free text:
//
//   - the host a call site is SHOWING: the zone being browsed, a plate's own
//     address, a preview's byte hosts. It asks through `nameOf(key, host)` /
//     `label(key, host, …)` and that read answers for that host alone.
//   - a host the key ADVERTISED in an event IT signed, as a byte source
//     (`hint`). Only these feed the host-less read `nameOf(key)` — so no third
//     party (an unsigned recovery answer, a foreign directory) can choose
//     which host vouches for someone else's key. A key keeps at most a few,
//     and all keys together at most MAX_ADVERTISED_HOSTS — keys are free, so
//     the cap is on hosts, not per key.
//
// A host on the participant's own machine or network (loopback, an IP literal,
// a single label, `.local`) is asked only by a hive that is itself on
// loopback — a dev shell. At most a few lookups run at once; the rest wait.
//
// A dependency: it registers nothing. sharing.boot.drone.ts registers the one
// instance as '@diamondcoreprocessor.com/NameService'; Angular code reaches it
// by that key through a duck-typed interface, never by import.
//
// The name rule is the hosts' rule (hypercomb-relay/nip05-names.js) — copied,
// never imported, because a module never reaches into the relay package.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { npubEncode } from 'nostr-tools/nip19'

export const NAME_SERVICE_KEY = '@diamondcoreprocessor.com/NameService'

/** Sticky (last-value replay): `{ version }`, bumped when what the hive can
 *  show for a key a surface asked about changes — a name lands, changes, is
 *  withdrawn, or runs out. Render paths recompute on it. */
export const NAMES_CHANGED = 'names:changed'

/** The domain's own key. `_@host` shows as just `host`. */
export const PRIMARY_NAME = '_'

/** Leads every unverified claim (`~Jaime`). Never the first character of a
 *  verified display: names and hosts are `[a-z0-9._-]`. */
export const UNVERIFIED_MARK = '~'

/** An answer is kept this long. */
export const NAMES_TTL_MS = 10 * 60_000
/** A host that did not answer is not asked again for this long. */
export const NAMES_FAILURE_TTL_MS = 2 * 60_000
/** At most this many advertised hosts are remembered per key — first wins. */
export const MAX_HOSTS_PER_KEY = 4
/** At most this many distinct advertised hosts across every key — first wins. */
export const MAX_ADVERTISED_HOSTS = 32
/** At most this many lookups at once; the rest wait their turn. */
export const MAX_CONCURRENT_LOOKUPS = 4
/** Changes landing this close together are said once. */
export const NAMES_COALESCE_MS = 50
/** A names document past this many bytes is not a names document — and is
 *  not read past it. */
export const MAX_DOCUMENT_BYTES = 512 * 1024
/** A claim is shown to at most this many characters. */
export const MAX_CLAIM_CHARS = 64

const FETCH_TIMEOUT_MS = 8_000

const NAME_RE = /^[a-z0-9._-]{1,64}$/
const PUBKEY_RE = /^[0-9a-f]{64}$/
const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/
// Loopback hosts use plain http, real domains https — the same rule every
// byte fetch keeps (hive-pointer.ts hiveIndexUrl).
const LOOPBACK_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d+)?$/
// A last label a URL parser reads as a number makes the whole host an IPv4
// literal (`192.168.1.1`, `127.1`, `0x7f.1`).
const NUMERIC_LABEL_RE = /^(?:\d+|0x[0-9a-f]*)$/

// What shows as nothing or as blank space, or reorders the text around it:
// controls, format characters (bidi overrides and isolates, zero-width
// joiners, the BOM, tag characters), line and paragraph separators, and the
// fillers that are letters or symbols only by category — the combining
// grapheme joiner, Hangul fillers, Khmer and Mongolian invisibles, the blank
// Braille cell, variation selectors.
const HIDDEN_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}͏ᅟᅠ឴឵᠋-᠏⠀ㅤ︀-️ﾠ\u{e0100}-\u{e01ef}]/gu

/** A NIP-05 local part, or null. ASCII whitespace trimmed, then accepted only
 *  if it is ASCII AS WRITTEN — checked before lowercasing, so a Kelvin sign
 *  or a dotless i can never lowercase into an ASCII name — and only then
 *  lowercased. Never folded, never invented. `_` is the primary's alone.
 *  The same rule as hypercomb-relay/nip05-names.js, pinned by its parity spec. */
const ASCII_SPACE = ' \t\n\v\f\r'
const WRITTEN_RE = /^[A-Za-z0-9._-]{1,64}$/
export const nip05Name = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  let start = 0
  let end = raw.length
  while (start < end && ASCII_SPACE.includes(raw[start]!)) start++
  while (end > start && ASCII_SPACE.includes(raw[end - 1]!)) end--
  const written = raw.slice(start, end)
  if (!WRITTEN_RE.test(written)) return null
  const name = written.toLowerCase()
  return NAME_RE.test(name) && name !== PRIMARY_NAME ? name : null
}

/** A host as the hive names it — bare, lowercase, no scheme or path — or null. */
export const nameHost = (raw: unknown): string | null => {
  const bare = String(raw ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0] ?? ''
  return HOST_RE.test(bare) ? bare : null
}

/** A host on the participant's own machine or network: loopback, an IP
 *  literal, a single label (`router`, `intranet`), or mDNS `.local`. */
export const isLocalHost = (host: string): boolean => {
  const labels = host.replace(/:\d+$/, '').split('.')
  const last = labels[labels.length - 1] ?? ''
  return labels.length < 2 || LOOPBACK_RE.test(host) || NUMERIC_LABEL_RE.test(last)
    || last === 'local' || last === 'localhost'
}

/** A caller's claim as a row may show it: hidden and filler characters
 *  removed, runs of space collapsed, at most MAX_CLAIM_CHARS characters. */
export const cleanClaim = (raw: unknown): string => {
  const text = String(raw ?? '').normalize('NFC').replace(HIDDEN_RE, '').replace(/\s+/gu, ' ').trim()
  return Array.from(text).slice(0, MAX_CLAIM_CHARS).join('').trim()
}

const cleanPubkey = (raw: unknown): string | null => {
  const key = String(raw ?? '').trim().toLowerCase()
  return PUBKEY_RE.test(key) ? key : null
}

/**
 * A host's names document → pubkey → the names it vouches for, in document
 * order. Null when the document is not one (no `names` object).
 *
 * Entry by entry: a value that is not a 64-hex key, or a name the rule
 * refuses, says nothing. A name two DIFFERENT keys claim (`Alice` and `alice`
 * folded together) is contested, and NEITHER gets it — the host has not
 * vouched for one. One key may hold several names.
 */
export const namesFromDocument = (doc: unknown): Map<string, string[]> | null => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const names = (doc as { names?: unknown }).names
  if (!names || typeof names !== 'object' || Array.isArray(names)) return null
  const claims = new Map<string, string | null>()
  for (const [raw, value] of Object.entries(names as Record<string, unknown>)) {
    const pubkey = typeof value === 'string' ? cleanPubkey(value) : null
    if (!pubkey) continue
    const name = raw === PRIMARY_NAME ? PRIMARY_NAME : nip05Name(raw)
    if (name === null) continue
    if (!claims.has(name)) claims.set(name, pubkey)
    else if (claims.get(name) !== pubkey) claims.set(name, null)
  }
  const byPubkey = new Map<string, string[]>()
  for (const [name, pubkey] of claims) {
    if (pubkey === null) continue
    const held = byPubkey.get(pubkey)
    if (held) held.push(name)
    else byPubkey.set(pubkey, [name])
  }
  return byPubkey
}

/** A response body read no further than `cap` bytes — null past it, or when
 *  there is no body to read. A declared length that already says too much is
 *  refused unread; the bytes are counted either way. */
export const readCapped = async (res: Response, cap: number): Promise<string | null> => {
  const declared = Number(res.headers?.get?.('content-length') ?? NaN)
  if (declared > cap) return null
  const reader = res.body?.getReader?.()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      void reader.cancel().catch(() => { /* already gone */ })
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength }
  return new TextDecoder().decode(bytes)
}

/** `npub1abcd…wxyz` — enough to tell keys apart, short enough to sit in a row. */
export const shortNpub = (pubkey: string): string => {
  const key = cleanPubkey(pubkey)
  if (!key) return String(pubkey ?? '').trim().slice(0, 12)
  try {
    const npub = npubEncode(key)
    return `${npub.slice(0, 9)}…${npub.slice(-4)}`
  } catch {
    return key.slice(0, 12)
  }
}

/** A name a host vouched for. `display` is what a row shows. */
export interface VerifiedName {
  readonly name: string
  readonly host: string
  readonly verified: true
  readonly display: string
}

type HostState =
  | { readonly ok: true; readonly byPubkey: Map<string, string[]>; readonly expires: number }
  | { readonly ok: false; readonly expires: number }

export interface NameServiceDeps {
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  readonly now?: () => number
  readonly emit?: (effect: string, payload: unknown) => void
  readonly t?: (key: string, params: Record<string, string>, fallback: string) => string
  /** Run `fn` after `ms` — the coalesced emission and the expiry re-check. */
  readonly later?: (fn: () => void, ms: number) => void
  /** Whether loopback, IP-literal, single-label and `.local` hosts may be
   *  asked. Defaults to whether the hive itself is on loopback. */
  readonly allowLocalHosts?: boolean
}

const i18nT = (key: string, params: Record<string, string>, fallback: string): string => {
  const i18n = (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const text = i18n?.t?.(key, params)
  return text && text !== key ? text : fallback
}

const hiveIsLocal = (): boolean => {
  const here = String((globalThis as { location?: { hostname?: string } }).location?.hostname ?? '').toLowerCase()
  return here === '[::1]' || here === '::1' || (here !== '' && LOOPBACK_RE.test(here))
}

const verifiedName = (names: readonly string[], host: string): VerifiedName => {
  // A real name says who; `_` only says whose domain it is.
  const name = names.find(n => n !== PRIMARY_NAME) ?? PRIMARY_NAME
  return { name, host, verified: true, display: name === PRIMARY_NAME ? host : `${name}@${host}` }
}

export class NameService extends EventTarget {
  readonly #fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly #now: () => number
  readonly #emit: (effect: string, payload: unknown) => void
  readonly #t: (key: string, params: Record<string, string>, fallback: string) => string
  readonly #later: (fn: () => void, ms: number) => void
  readonly #allowLocal: boolean

  /** pubkey → the hosts it advertised in events it signed, in hint order. */
  readonly #hints = new Map<string, string[]>()
  /** Every host any key advertised — capped, so free keys cannot fan out. */
  readonly #advertised = new Set<string>()
  /** host → the keys a surface asked it about: what its answer is FOR. */
  readonly #asked = new Map<string, Set<string>>()
  readonly #state = new Map<string, HostState>()
  readonly #inflight = new Set<string>()
  /** Hosts whose lookup waits for a free slot, in arrival order. */
  readonly #waiting = new Set<string>()
  #pending = false
  #version = 0

  constructor(deps: NameServiceDeps = {}) {
    super()
    this.#fetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.#now = deps.now ?? (() => Date.now())
    this.#emit = deps.emit ?? ((effect, payload) => EffectBus.emit(effect, payload))
    this.#t = deps.t ?? i18nT
    this.#later = deps.later ?? ((fn, ms) => { setTimeout(fn, ms) })
    this.#allowLocal = deps.allowLocalHosts ?? hiveIsLocal()
  }

  /** Bumped each time `names:changed` is said. */
  get version(): number { return this.#version }

  /** `pubkey` advertised `host` as a byte source, in an event IT signed (a
   *  relay-verified swarm layer event). Only such hosts answer the host-less
   *  `nameOf(pubkey)`. Records it; asks nothing until a name is wanted. */
  hint(pubkey: string, host: string): void {
    const key = cleanPubkey(pubkey)
    const where = this.#askable(host)
    if (!key || !where) return
    const hosts = this.#hints.get(key) ?? []
    if (hosts.includes(where) || hosts.length >= MAX_HOSTS_PER_KEY) return
    if (!this.#advertised.has(where)) {
      if (this.#advertised.size >= MAX_ADVERTISED_HOSTS) return
      this.#advertised.add(where)
    }
    hosts.push(where)
    this.#hints.set(key, hosts)
  }

  /** The name a host vouches for, synchronously. With `host` — the host the
   *  caller is showing — that host alone is asked and answers. Without it,
   *  the hosts the key advertised itself, in hint order. A miss starts the
   *  lookups in the background; `names:changed` follows. */
  nameOf(pubkey: string, host?: string): VerifiedName | null {
    const key = cleanPubkey(pubkey)
    if (!key) return null
    const hosts = host === undefined
      ? this.#hints.get(key) ?? []
      : [this.#askable(host)].filter((h): h is string => !!h)
    for (const where of hosts) {
      const asked = this.#asked.get(where) ?? new Set<string>()
      asked.add(key)
      this.#asked.set(where, asked)
      const state = this.#current(where)
      const names = state?.ok ? state.byPubkey.get(key) : undefined
      if (names?.length) return verifiedName(names, where)
    }
    return null
  }

  /** The text a row shows for a key: verified first, else the caller's claim
   *  with the unverified mark in front, else a short npub. */
  label(pubkey: string, host?: string, unverifiedFallback?: string): string {
    const verified = this.nameOf(pubkey, host)
    if (verified) return verified.display
    const claim = cleanClaim(unverifiedFallback)
    if (claim) return this.#t('names.unverified', { name: claim }, `${UNVERIFIED_MARK}${claim}`)
    return shortNpub(pubkey)
  }

  /** A host this hive may ask, or null. */
  #askable(raw: unknown): string | null {
    const host = nameHost(raw)
    return host && (this.#allowLocal || !isLocalHost(host)) ? host : null
  }

  /** The state a read may answer from, starting a lookup when it is missing
   *  or stale. A stale answer still answers while the next one is fetched. */
  #current(host: string): HostState | undefined {
    const state = this.#state.get(host)
    if (!state || state.expires <= this.#now()) this.#load(host)
    return state
  }

  #load(host: string): void {
    if (this.#inflight.has(host)) return
    if (this.#inflight.size >= MAX_CONCURRENT_LOOKUPS) { this.#waiting.add(host); return }
    this.#waiting.delete(host)
    this.#inflight.add(host)
    void this.#ask(host)
      .then(byPubkey => this.#land(host, byPubkey))
      .catch(() => { /* a listener's failure is not the host's */ })
      .finally(() => {
        this.#inflight.delete(host)
        this.#next()
      })
  }

  /** A slot came free: start the oldest waiting lookup still due. */
  #next(): void {
    for (const host of this.#waiting) {
      if (this.#inflight.size >= MAX_CONCURRENT_LOOKUPS) return
      this.#waiting.delete(host)
      const state = this.#state.get(host)
      if (!state || state.expires <= this.#now()) this.#load(host)
    }
  }

  #land(host: string, byPubkey: Map<string, string[]> | null): void {
    const before = this.#vouchedFor(this.#state.get(host), host)
    const now = this.#now()
    const state: HostState = byPubkey
      ? { ok: true, byPubkey, expires: now + NAMES_TTL_MS }
      : { ok: false, expires: now + NAMES_FAILURE_TTL_MS }
    this.#state.set(host, state)
    // Said only when it changes what a surface asked this host about — a
    // host that vouches for nothing on screen moves nothing.
    if (this.#vouchedFor(state, host) !== before) this.#changed()
    if (state.ok) this.#later(() => this.#expire(host, state), NAMES_TTL_MS)
  }

  /** The answer has run out. If it is still the one a surface shows, say so:
   *  the surfaces re-read, and what is still on screen is asked again. */
  #expire(host: string, state: HostState): void {
    if (this.#state.get(host) !== state) return
    const left = state.expires - this.#now()
    if (left > 0) { this.#later(() => this.#expire(host, state), left); return }
    if (this.#vouchedFor(state, host)) this.#changed()
  }

  /** What `state` vouches for among the keys a surface asked `host` about. */
  #vouchedFor(state: HostState | undefined, host: string): string {
    const asked = this.#asked.get(host)
    if (!state?.ok || !asked) return ''
    const out: string[] = []
    for (const key of asked) {
      const names = state.byPubkey.get(key)
      if (names?.length) out.push(`${key}:${names.join(',')}`)
    }
    return out.sort().join('|')
  }

  /** One GET of the whole document. Null for anything but a 200 whose body
   *  is a names document — a redirect, an HTML fallback, a refusal, a body
   *  past MAX_DOCUMENT_BYTES. */
  async #ask(host: string): Promise<Map<string, string[]> | null> {
    const scheme = LOOPBACK_RE.test(host) ? 'http' : 'https'
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null
    try {
      const res = await this.#fetch(`${scheme}://${host}/.well-known/nostr.json`, {
        redirect: 'error',
        credentials: 'omit',
        ...(controller ? { signal: controller.signal } : {}),
      })
      if (res.status !== 200 || res.redirected) return null
      const text = await readCapped(res, MAX_DOCUMENT_BYTES)
      return text === null ? null : namesFromDocument(JSON.parse(text))
    } catch {
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Changes close together are said once. */
  #changed(): void {
    if (this.#pending) return
    this.#pending = true
    this.#later(() => {
      this.#pending = false
      this.#version++
      const payload = { version: this.#version }
      this.dispatchEvent(new CustomEvent('change', { detail: payload }))
      this.#emit(NAMES_CHANGED, payload)
    }, NAMES_COALESCE_MS)
  }
}

/** The one instance — sharing.boot.drone.ts registers it. */
export const nameService = new NameService()
