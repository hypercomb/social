// sharing/swarm-link.ts
//
// THE SWARM LOGIN TRAVELS AS A LINK; THE HOST HOLDS ONLY CIPHERTEXT.
//
// jwize, 2026-10-11: "we host the payload and give the link with a
// signature" — "then the swarm login is retrieved" — "build it as part of
// this merge".
//
// A SWARM LOGIN is { host, location, secret, code? }:
//   host     — the meeting host the participant named. The single source of
//              truth: the login says where the meeting is, and nothing else
//              does. Canonical lowercase host[:port] (canonicalSwarmHost) —
//              the same host the room's identity hashes for the relay a tab
//              dials (nostr-mesh swarmHost → core meetingPointKey).
//   location — the room, exactly as typed.
//   secret   — the room's secret, exactly as typed.
//   code     — the host's access code, only when that host needs one.
// (Case and Unicode folding happen where the room is hashed, not here: the
// login carries what was typed.)
//
// THE RULES THAT BIND IT:
//   - A secret or an access code is never readable in any pool, resource,
//     event, log, export or on any host. So the payload is SEALED before it
//     leaves the device, with core's door seal (content-cipher sealToSecret)
//     under a fresh random 256-bit key per seal. The hosted blob is
//     ciphertext only — the `HCS1` seal header, then AES-GCM — addressed by
//     sha256(blob). The host can serve it and can never read it; a reader
//     that asks core's needsSecret() sees what it is.
//   - The key travels only in the link's #fragment, which a browser never
//     sends to any server:
//         <appOrigin>/#swarm=<sig>@<host>~<key>
//     appOrigin is the page the sharer stands on; it says where the link
//     lands and never enters identity. The host in the link only says where
//     to fetch: the host inside the sealed login is the truth.
//   - Nothing derived from the secret goes on the EffectBus, and nothing here
//     logs. This module imports no bus and writes no storage.
//   - Deterministic for everyone: one login has one byte form (JSON, v:1,
//     fixed key order), and a sealed payload that is not exactly that form is
//     refused. A host is canonical when canonicalizing it again changes
//     nothing.
//
// THE DIAL RULE. An opened login is dialled at swarmRelayUrl(host):
// wss://<host>, and ws:// only on a loopback host. So a login only carries a
// meeting point it can be dialled back to: a relay with a path
// (wss://x.com/io), a query, or a scheme the dial rule would not choose
// (ws:// to a public host, wss:// to a loopback one) is not sealed at all.
//
// THE FALLBACK. Publishing goes through an INJECTED uploader (the merge wires
// host-sync's signed PUT of one atom to the meeting host) and opening through
// an INJECTED fetcher, so the caller decides the transport. Either side comes
// back as a typed reason, never a throw; a publish that fails — including a
// meeting point a login cannot carry whole — leaves the caller to hand out
// today's `#meet=` link (meeting-invite.ts), which names the relay whole.
//
// Anyone who holds the link holds the login — the link IS the invitation,
// exactly as a `#meet=` link is. What changes is that the link no longer
// spells the secret out: it carries a key, and the host carries a blob it
// cannot open.

import { SEAL_OVERHEAD_BYTES, SignatureService, needsSecret, openWithSecret, sealToSecret } from '@hypercomb/core'
import { isAccessCode, trimLinkTail } from './meeting-invite.js'

export const SWARM_LINK_VERSION = 1

/** The fragment prefix a swarm link carries. */
export const SWARM_LINK_PREFIX = '#swarm='

/** The largest blob a swarm link opens (and the largest one sealed). */
export const SWARM_BLOB_MAX = 4096

/** How long the default fetcher waits for the host, body included. */
export const SWARM_FETCH_TIMEOUT_MS = 8_000

const KEY_BYTES = 32
const PLAIN_MAX = SWARM_BLOB_MAX - SEAL_OVERHEAD_BYTES

/** The longest link body read: 64 sig + '@' + a 253-character name and a
 *  port + '~' + 43 key, with room for what a sentence leaves on its end. A
 *  longer token is not a swarm link, and is never handed to trimLinkTail. */
const LINK_BODY_MAX = 512

const SIG_RE = /^[0-9a-f]{64}$/
// A 256-bit key is 43 unpadded base64url characters, and its last one only
// ever carries four bits — so it is never '-' or '_', and a minted link never
// ENDS in a character a chat's linkifier would trim off.
const KEY_RE = /^[A-Za-z0-9_-]{43}$/
// The host slot holds only what a minted host can: letters, digits, '.', '-',
// a port, an IPv6 bracket. Never a scheme, a '%' escape, a '/' or an '@'.
const LINK_RE = /^([0-9a-fA-F]{64})@([A-Za-z0-9.:[\]-]+)~([A-Za-z0-9_-]{43})$/
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i
/** The schemes a meeting host may be typed with. Any other names an opaque
 *  host the URL standard does not decode, so it names no host at all. */
const HOST_SCHEMES: ReadonlySet<string> = new Set(['ws', 'wss', 'http', 'https'])
/** Loopback answers over plain http (and plain ws) — the rule host-sync uses. */
const LOOPBACK_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i

export interface SwarmLogin {
  host: string
  location: string
  secret: string
  code?: string
  /** The page the room is invited to (its segments), so a guest lands where
   *  the facilitator stood — as the #meet= link always carried. Omitted at
   *  the root. Each segment one path component, at most PAGE_SEGMENTS_MAX. */
  page?: string[]
}

/** The deepest page a login carries (the #meet= link's own limit). */
const PAGE_SEGMENTS_MAX = 64

/** What a swarm link carries: the blob's signature, where it is fetched from,
 *  and the key that opens it. */
export interface SwarmLinkParts {
  sig: string
  host: string
  key: string
}

export interface SealedSwarmLogin {
  blob: Uint8Array
  sig: string
  /** base64url, no padding. */
  key: string
}

export type SwarmOpenFailure = 'unreachable' | 'missing' | 'tampered' | 'locked' | 'malformed' | 'too-large'
export type SwarmOpenResult = { ok: true; login: SwarmLogin } | { ok: false; reason: SwarmOpenFailure }

export type SwarmFetchResult =
  | { ok: true; bytes: Uint8Array | ArrayBuffer }
  | { ok: false; reason: 'unreachable' | 'missing' | 'too-large' }
/** GET one blob. `url` is `https://<host>/<sig>` (http on loopback); the
 *  transport may use it or route by host and sig itself. */
export type SwarmFetcher = (request: { url: string; host: string; sig: string }) => Promise<SwarmFetchResult>

export type SwarmPutResult = { ok: true } | { ok: false; reason: 'refused' | 'unreachable' }
/** PUT one blob to the meeting host. */
export type SwarmUploader = (request: { url: string; host: string; sig: string; bytes: Uint8Array }) => Promise<SwarmPutResult>

/** 'malformed' — the login could not be sealed: a field missing, too long,
 *  an access code that is not one, a meeting point a login cannot carry
 *  whole (a path, a query, a scheme the dial rule would not choose), or no
 *  WebCrypto on this page. */
export type SwarmPublishFailure = 'refused' | 'unreachable' | 'no-host' | 'malformed'
export type SwarmPublishResult = { ok: true; parts: SwarmLinkParts } | { ok: false; reason: SwarmPublishFailure }

// ── the host ──────────────────────────────────────────────────────────

/** The text as a URL: under its own scheme when it names ws, wss, http or
 *  https, under wss:// when it names none. null for any other scheme. */
const urlOf = (raw: unknown): URL | null => {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return null
  const scheme = SCHEME_RE.exec(text)?.[1]?.toLowerCase()
  if (scheme && !HOST_SCHEMES.has(scheme)) return null
  try { return new URL(scheme ? text : `wss://${text}`) } catch { return null }
}

/** A bare host as wss:// reads it — what core's meetingPointKey reads. */
const wssHost = (text: string): string => {
  try {
    const url = new URL(`wss://${text}`)
    return url.username || url.password || !url.hostname ? '' : url.host.toLowerCase()
  } catch { return '' }
}

/** A host as a swarm login names it: lowercase host[:port], no scheme, no
 *  path, the default port dropped, an international name in punycode —
 *  'HyperComb.com', 'wss://hypercomb.com/' and 'hypercomb.com:443' are all
 *  'hypercomb.com'. Read the way the room's identity reads the relay a tab
 *  dials: its URL's host (that scheme's default port dropped), then that as
 *  wss:// (443 dropped) — so a relay's canonical host is the point its room
 *  hashes. A fixed point: canonical twice is canonical once. '' when it names
 *  no host — or names it under any scheme but ws, wss, http or https. Never
 *  throws. */
export function canonicalSwarmHost(raw: unknown): string {
  const url = urlOf(raw)
  if (!url || url.username || url.password || !url.hostname) return ''
  const host = wssHost(url.host)
  return host && wssHost(host) === host ? host : ''
}

/** The relay an opened login is dialled at: wss://<host>, ws:// only on a
 *  loopback host — the one dial rule. '' when it names no host. */
export function swarmRelayUrl(host: unknown): string {
  const canonical = canonicalSwarmHost(host)
  if (!canonical) return ''
  return `${LOOPBACK_RE.test(canonical) ? 'ws' : 'wss'}://${canonical}`
}

/** Can a login carry this meeting point whole — dialled back at
 *  swarmRelayUrl, would a guest reach the relay that was named? Not with a
 *  path, a query or a fragment, and a ws:// or wss:// scheme only as the dial
 *  rule would choose it. (A bare host names no scheme, and http:// and
 *  https:// name a site's host, never a relay's scheme.) */
const carriesWhole = (raw: unknown, host: string): boolean => {
  const url = urlOf(raw)
  if (!url || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return false
  const typed = SCHEME_RE.exec(String(raw).trim())?.[1]?.toLowerCase()
  if (typed !== 'ws' && typed !== 'wss') return true
  return `${typed}://${host}` === swarmRelayUrl(host)
}

// ── the login and its bytes ───────────────────────────────────────────

/** The login in its canonical form, or null when it is not one. */
const loginOf = (raw: unknown): SwarmLogin | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const host = canonicalSwarmHost(o['host'])
  const location = o['location']
  const secret = o['secret']
  if (!host || !carriesWhole(o['host'], host)) return null
  if (typeof location !== 'string' || !location.trim()) return null
  if (typeof secret !== 'string' || !secret.trim()) return null
  const codeRaw = o['code']
  const code = typeof codeRaw === 'string' ? codeRaw.trim() : ''
  if (codeRaw !== undefined && codeRaw !== null && typeof codeRaw !== 'string') return null
  if (code && !isAccessCode(code)) return null
  const pageRaw = o['page']
  if (pageRaw !== undefined && pageRaw !== null && !Array.isArray(pageRaw)) return null
  const page = Array.isArray(pageRaw) ? pageRaw : []
  if (page.length > PAGE_SEGMENTS_MAX) return null
  if (!page.every(s => typeof s === 'string' && s.length > 0 && !s.includes('/'))) return null
  return {
    host, location, secret,
    ...(code ? { code } : {}),
    ...(page.length ? { page: [...page as string[]] } : {}),
  }
}

/** The one byte form of a login: JSON `{ v, host, location, secret, code?,
 *  page? }` in that order, the host canonical, the code and the page left out
 *  when empty. null
 *  when the login has no host (or one it cannot carry whole), no location or
 *  no secret, or would not fit a blob. */
export function swarmLoginBytes(login: unknown): Uint8Array | null {
  const canonical = loginOf(login)
  if (!canonical) return null
  const bytes = new TextEncoder().encode(JSON.stringify({ v: SWARM_LINK_VERSION, ...canonical }))
  return bytes.byteLength <= PLAIN_MAX ? bytes : null
}

// ── sealing ───────────────────────────────────────────────────────────

const exactBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const toBase64Url = (bytes: Uint8Array): string => {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A key's 32 bytes, or null — only the one canonical spelling of a key. */
const keyBytesOf = (key: unknown): Uint8Array | null => {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return null
  let text: string
  try { text = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '=') } catch { return null }
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes.byteLength === KEY_BYTES && toBase64Url(bytes) === key ? bytes : null
}

/** Seal a login with core's door seal under a fresh random key, so two seals
 *  of one login are two unrelated blobs. null when the login is not one
 *  (swarmLoginBytes) or this page has no WebCrypto. Never throws. */
export async function sealSwarmLogin(login: SwarmLogin): Promise<SealedSwarmLogin | null> {
  const plain = swarmLoginBytes(login)
  if (!plain) return null
  try {
    const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
    const blob = await sealToSecret(plain, raw)
    return { blob, sig: await SignatureService.sign(exactBuffer(blob)), key: toBase64Url(raw) }
  } catch { return null }
}

// ── the link ──────────────────────────────────────────────────────────

/** Where a blob lives: `https://<host>/<sig>` (http on loopback). */
export function swarmBlobUrl(host: string, sig: string): string {
  return `${LOOPBACK_RE.test(host) ? 'http' : 'https'}://${host}/${sig}`
}

/** The parts in their canonical form, or null. */
const partsOf = (parts: unknown): SwarmLinkParts | null => {
  if (!parts || typeof parts !== 'object') return null
  const o = parts as Record<string, unknown>
  const sig = typeof o['sig'] === 'string' ? o['sig'].toLowerCase() : ''
  const host = canonicalSwarmHost(o['host'])
  const key = o['key']
  if (!SIG_RE.test(sig) || !host || !keyBytesOf(key)) return null
  return { sig, host, key: key as string }
}

/** `#swarm=<sig>@<host>~<key>`, or '' when the parts are not a link's. */
export function swarmFragment(parts: SwarmLinkParts): string {
  const p = partsOf(parts)
  return p ? `${SWARM_LINK_PREFIX}${p.sig}@${p.host}~${p.key}` : ''
}

/** The whole link: `${appOrigin}/#swarm=<sig>@<host>~<key>`. appOrigin only
 *  says where the link lands. '' when the parts are not a link's. */
export function swarmLinkText(appOrigin: string, parts: SwarmLinkParts): string {
  const fragment = swarmFragment(parts)
  if (!fragment) return ''
  const origin = String(appOrigin ?? '').trim().replace(/#.*$/, '').replace(/\/+$/, '')
  return `${origin}/${fragment}`
}

/** Read a swarm link back — the whole link, the fragment alone, or the text
 *  after `swarm=` — into its parts. Punctuation a sentence or a chat left on
 *  its end is not the link's (trimLinkTail), nor is anything after a space.
 *  A body longer than any link's is refused before it is trimmed. null when
 *  it is not a swarm link. Never throws. */
export function parseSwarmLink(text: unknown): SwarmLinkParts | null {
  if (typeof text !== 'string') return null
  let body = text.trim()
  const at = body.indexOf(SWARM_LINK_PREFIX)
  if (at >= 0) body = body.slice(at + SWARM_LINK_PREFIX.length)
  else if (body.startsWith('swarm=')) body = body.slice('swarm='.length)
  else return null
  const token = /^\S*/.exec(body)?.[0] ?? ''
  if (token.length > LINK_BODY_MAX) return null
  const m = LINK_RE.exec(trimLinkTail(token))
  return m ? partsOf({ sig: m[1], host: m[2], key: m[3] }) : null
}

// ── opening ───────────────────────────────────────────────────────────

const cancelBody = async (response: Response): Promise<void> => {
  try { await response.body?.cancel() } catch { /* already read or closed */ }
}

/** The body, or null once it passes `max` bytes. */
const readCapped = async (response: Response, max: number): Promise<Uint8Array | null> => {
  const reader = response.body?.getReader()
  if (!reader) {
    const all = new Uint8Array(await response.arrayBuffer())
    return all.byteLength > max ? null : all
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      try { await reader.cancel() } catch { /* closed */ }
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength }
  return out
}

/** A fetcher over `fetch`: no credentials, no referrer, no cache-busting
 *  parameters, at most SWARM_BLOB_MAX bytes read, and a deadline over the
 *  whole answer. A sealed login is never a page, so an HTML answer is a host
 *  answering a path it does not hold (an app's fallback page): missing. */
export function swarmFetcher(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): SwarmFetcher {
  return async ({ url }) => {
    const doFetch = options.fetch ?? globalThis.fetch
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? SWARM_FETCH_TIMEOUT_MS)
    try {
      const response = await doFetch(url, {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: abort.signal,
      })
      if (response.status === 404 || response.status === 410) {
        await cancelBody(response)
        return { ok: false, reason: 'missing' }
      }
      if (!response.ok) {
        await cancelBody(response)
        return { ok: false, reason: 'unreachable' }
      }
      if ((response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
        await cancelBody(response)
        return { ok: false, reason: 'missing' }
      }
      if (Number(response.headers.get('content-length') ?? '0') > SWARM_BLOB_MAX) {
        await cancelBody(response)
        return { ok: false, reason: 'too-large' }
      }
      const bytes = await readCapped(response, SWARM_BLOB_MAX)
      return bytes ? { ok: true, bytes } : { ok: false, reason: 'too-large' }
    } catch {
      return { ok: false, reason: 'unreachable' }
    } finally {
      clearTimeout(timer)
    }
  }
}

export const defaultSwarmFetch: SwarmFetcher = swarmFetcher()

const FETCH_FAILURES: readonly string[] = ['unreachable', 'missing', 'too-large']
const failed = (reason: SwarmOpenFailure): SwarmOpenResult => ({ ok: false, reason })

/** Open a swarm link: fetch the blob, check sha256(blob) === sig before
 *  anything else, open the door seal, and accept only a login in its one
 *  byte form. Every failure is a reason; never throws. */
export async function openSwarmLink(parts: SwarmLinkParts, fetchBytes: SwarmFetcher = defaultSwarmFetch): Promise<SwarmOpenResult> {
  try {
    const p = partsOf(parts)
    if (!p) return failed('malformed')
    const raw = keyBytesOf(p.key)!

    let fetched: SwarmFetchResult
    try { fetched = await fetchBytes({ url: swarmBlobUrl(p.host, p.sig), host: p.host, sig: p.sig }) } catch { return failed('unreachable') }
    if (!fetched || fetched.ok !== true) {
      const reason = (fetched as { reason?: unknown } | undefined)?.reason
      return failed(FETCH_FAILURES.includes(reason as string) ? reason as SwarmOpenFailure : 'unreachable')
    }
    let blob: Uint8Array
    try { blob = new Uint8Array(fetched.bytes as ArrayBuffer) } catch { return failed('unreachable') }

    if (blob.byteLength > SWARM_BLOB_MAX) return failed('too-large')
    if (await SignatureService.sign(exactBuffer(blob)) !== p.sig) return failed('tampered')
    if (blob.byteLength <= SEAL_OVERHEAD_BYTES || !needsSecret(blob)) return failed('malformed')

    const plain = await openWithSecret(blob, raw)
    if (!plain) return failed('locked')

    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) } catch { return failed('malformed') }
    if (!value || typeof value !== 'object' || (value as Record<string, unknown>)['v'] !== SWARM_LINK_VERSION) return failed('malformed')
    const login = loginOf(value)
    const canonical = login ? swarmLoginBytes(login) : null
    if (!login || !canonical || canonical.byteLength !== plain.byteLength || canonical.some((b, i) => b !== plain[i])) {
      return failed('malformed')
    }
    return { ok: true, login }
  } catch {
    return failed('unreachable')
  }
}

// ── publishing ────────────────────────────────────────────────────────

/** Seal a login and PUT the blob to its own host through the injected
 *  uploader. On success, the parts a link is made of (swarmLinkText); on
 *  failure a reason, and the caller hands out a `#meet=` link instead.
 *  Never throws. */
export async function publishSwarmLink(login: SwarmLogin, putBytes: SwarmUploader): Promise<SwarmPublishResult> {
  try {
    const host = canonicalSwarmHost((login as { host?: unknown } | null | undefined)?.host)
    if (!host) return { ok: false, reason: 'no-host' }
    const sealed = await sealSwarmLogin(login)
    if (!sealed) return { ok: false, reason: 'malformed' }
    let put: SwarmPutResult
    try {
      put = await putBytes({ url: swarmBlobUrl(host, sealed.sig), host, sig: sealed.sig, bytes: sealed.blob })
    } catch { return { ok: false, reason: 'unreachable' } }
    if (!put || put.ok !== true) {
      return { ok: false, reason: (put as { reason?: unknown } | undefined)?.reason === 'refused' ? 'refused' : 'unreachable' }
    }
    return { ok: true, parts: { sig: sealed.sig, host, key: sealed.key } }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}
