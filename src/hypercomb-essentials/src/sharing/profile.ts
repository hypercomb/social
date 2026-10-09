// sharing/profile.ts
//
// WHO A KEY IS, SAID BY THE KEY (documentation/sealed-audiences.md, "Names",
// build step 3). A participant's profile is a Nostr kind-0 event signed by
// their own key: `{ name?, about?, picture? }`. The COMPLETE signed event is
// an atom — its bytes are the UTF-8 JSON of `{id, pubkey, created_at, kind,
// tags, content, sig}`, its address is the sha256 of exactly those bytes — and
// the participant's signed hive index names it as `roots['nostr:profile']`.
//
// On its own a profile proves nothing: anyone can write any name into their
// own. The DOMAIN vouches (NIP-05, `name@host`), which is the host's half; this
// is the key's half, and the reader believes it only when four things hold
// together:
//
//   1. sha256(bytes) is the signature the key's own index named;
//   2. the event verifies (nostr-tools verifyEvent);
//   3. it is kind 0;
//   4. its pubkey IS the key whose index named it — the comparison, not the
//      schnorr check, is what stops substitution (hive-pointer.ts says why).
//
// The name inside passes THE NAME RULE (hypercomb-relay/nip05-names.js): a
// name a host could vouch for, or nothing — never folded, never invented. The
// rule is read through names.service.ts `nip05Name`, this package's one copy.
//
// Nothing here says WHY in prose: every failure is a reason code the word
// translates (`profile.reason.<code>`), so the toast speaks the participant's
// language all the way through.
//
// Every collaborator is injected, so the acts are testable without a network,
// a store, or a key: `profile.queen.ts` wires the live ones.

import { SignatureService } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import type { HiveIndexResult } from './hive-pointer.js'
import { nip05Name } from './names.service.js'

/** The participant's index names the profile atom under this root key. A
 *  reserved key (word:word, hive-link.ts isReservedRootKey): a pointer, never a branch. */
export const PROFILE_ROOT_KEY = 'nostr:profile'
export const PROFILE_EVENT_KIND = 0
export const PROFILE_NAME_MAX = 64
export const PROFILE_ABOUT_MAX = 280
/** A picture's address, as it is STORED (the normalized href), is at most this. */
export const PROFILE_PICTURE_MAX = 2_048
export const PROFILE_FIELDS = ['name', 'about', 'picture'] as const
export type ProfileField = typeof PROFILE_FIELDS[number]

export interface ProfileFields {
  readonly name?: string
  readonly about?: string
  readonly picture?: string
}

/** The complete signed event, exactly the seven fields the atom carries. */
export interface ProfileEvent {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: string[][]
  readonly content: string
  readonly sig: string
}

export interface ProfileRecord {
  /** The atom's signature: sha256 of the event's bytes. */
  readonly sig: string
  readonly pubkey: string
  readonly createdAt: number
  readonly fields: ProfileFields
  readonly event: ProfileEvent
}

type UnsignedEvent = { kind: number; created_at: number; tags: string[][]; content: string }
type Verify = (event: never) => boolean

/** Everything the profile acts touch, injected. */
export interface ProfileDeps {
  /** The key this session already knows, or null. NEVER resolves one: a
   *  read must not mint an identity (head-claim-signer.ts cachedPubkey). */
  cachedPubkey(): string | null
  /** The signer's key, resolved — a set is an author's act, so it may. */
  signerPubkey(): Promise<string | null>
  sign(event: UnsignedEvent): Promise<Record<string, unknown>>
  /** A key's signed index on a host, verified (hive-pointer.ts fetchHiveIndex). */
  readIndex(host: string, pubkey: string): Promise<HiveIndexResult>
  /** An atom this hive holds, or null. */
  readLocal(sig: string): Promise<Uint8Array | null>
  /** An atom from the host's flat heap (`<host>/<sig>`), or null. */
  fetchAtom(host: string, sig: string): Promise<Uint8Array | null>
  /** Keep bytes as an atom; resolves to its signature. */
  put(bytes: Uint8Array): Promise<string>
  /** Ship atoms to the host (HostSyncService.publishAtoms). */
  publish(host: string, sigs: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }>
  /** Name an atom in the participant's own index on the host (setHiveRoot) —
   *  ONLY if the read that merge is built on still names `expected` under that
   *  key (null: nothing). Otherwise nothing is written and it answers
   *  `{ ok: false, changed: true }`: the profile this set merged from is no
   *  longer the one the host holds, and stamping would drop what replaced it. */
  stamp(host: string, key: string, sig: string, expected: string | null): Promise<{ ok: boolean; changed?: boolean; reason?: string }>
  now(): number
  /** Defaults to nostr-tools verifyEvent. */
  verify?: Verify
}

const SIG_RE = /^[0-9a-f]{64}$/
const HOST_RE = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?$/
const LOOPBACK_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d{1,5})?$/

// ── the reasons ─────────────────────────────────────────────────────────────

/** Why a profile act did not happen. A code, never prose: the word translates
 *  each through `profile.reason.<code>`. */
export const PROFILE_REASONS = [
  'nohost', 'nosigner', 'value',
  'index-unreachable', 'index-http', 'index-malformed', 'index-forged',
  'atom-missing', 'atom-hash',
  'rejected-json', 'rejected-kind', 'rejected-key', 'rejected-signature', 'rejected-content',
  'picture-missing', 'picture-notimage', 'picture-unpublished',
  'sign-failed', 'signer-event', 'signer-key', 'signer-date', 'signer-verify',
  'keep-failed', 'keep-sig', 'unpublished', 'unstamped', 'changed',
] as const
export type ProfileReason = typeof PROFILE_REASONS[number]
/** What fills a reason's slots: `{host}`, `{sig}` (its first 12 hex),
 *  `{status}`, `{field}`, and `{detail}` — the words of the service that
 *  failed (the signer, the store, the host), passed through as it said them. */
export type ProfileReasonParams = Readonly<Record<string, string | number>>

/** What each reason says in English: the fallback when no catalog answers.
 *  profile.queen.spec.ts holds it equal to en.json. */
export const PROFILE_REASON_TEXT: Readonly<Record<ProfileReason, string>> = {
  'nohost': 'no host is configured',
  'nosigner': 'no Nostr signer is available',
  'value': 'the {field} is not one a profile can carry',
  'index-unreachable': 'the index on {host} is unreachable',
  'index-http': 'the index on {host} is answering HTTP {status}',
  'index-malformed': 'the index on {host} is not a readable index',
  'index-forged': 'the index on {host} is not signed by your key',
  'atom-missing': '{host} does not serve the profile {sig}…',
  'atom-hash': '{host} serves bytes for {sig}… that do not hash to it',
  'rejected-json': 'the profile {sig}… your index names is not a readable event',
  'rejected-kind': 'the profile {sig}… your index names is not a profile event (kind 0)',
  'rejected-key': 'the profile {sig}… your index names is signed by another key',
  'rejected-signature': 'the profile {sig}… your index names has a signature that does not verify',
  'rejected-content': 'the profile {sig}… your index names carries no readable profile',
  'picture-missing': 'this hive does not hold the picture {sig}…',
  'picture-notimage': '{sig}… is not an image (PNG, JPEG, GIF, WebP, AVIF or SVG)',
  'picture-unpublished': 'the picture did not reach {host} ({detail})',
  'sign-failed': 'signing failed ({detail})',
  'signer-event': 'the signer returned a different event',
  'signer-key': 'the signer signed with another key',
  'signer-date': 'the signer dated the profile before the one it replaces',
  'signer-verify': 'the signed profile does not verify',
  'keep-failed': 'this hive could not keep the profile ({detail})',
  'keep-sig': 'this hive named the profile by another signature',
  'unpublished': 'the profile did not reach {host} ({detail})',
  'unstamped': 'your index on {host} was not updated ({detail})',
  'changed': 'your profile on {host} changed while this was being set; say it again to build on what is there now',
}

const short = (sig: string): string => sig.slice(0, 12)
const detailOf = (error: unknown): string => String((error as Error)?.message ?? error ?? '').trim() || '—'

// ── the rules ───────────────────────────────────────────────────────────────

/** A host as the profile word takes it: a bare domain, or a loopback name. */
export const profileHost = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const bare = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return HOST_RE.test(bare) || LOOPBACK_RE.test(bare) ? bare : null
}

/** A host as a URL: loopback on http, everything else https — the rule
 *  HostSyncService.publishAtoms ships by, so a picture URL is where it went. */
export const profileHostUrl = (host: string): string => {
  const bare = host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${bare}`
}

/** An address a reader may load, normalized — an https URL (http only on
 *  loopback) — before any length is judged. */
const pictureHref = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  try {
    const url = new URL(text)
    if (!url.hostname) return null
    if (url.protocol === 'https:') return url.href
    return url.protocol === 'http:' && LOOPBACK_RE.test(url.host) ? url.href : null
  } catch { return null }
}

/** A picture a reader may load. The cap is judged on the href that is STORED,
 *  not on what was typed — percent-encoding can make it six times longer — so
 *  a set and a read judge the same string. */
export const profilePicture = (raw: unknown): string | null => {
  const href = pictureHref(raw)
  return href && href.length <= PROFILE_PICTURE_MAX ? href : null
}

const ascii = (bytes: Uint8Array, at: number, text: string): boolean =>
  [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0))
const SVG_RE = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+svg[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i

/** What an image's first bytes say it is — or null when they are not one of
 *  the pictures a profile shows: PNG, JPEG, GIF, WebP, AVIF or SVG. */
export const imageKindOf = (bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg' | null => {
  // A view, from whichever realm made it (a store's, a worker's, a test's).
  if (!ArrayBuffer.isView(bytes) || bytes.length < 4) return null
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'gif'
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp'
  if (ascii(bytes, 4, 'ftyp')) {
    // The major brand at 8, then the compatible brands from 16 to the box's end.
    const box = Math.min(((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0, bytes.length, 256)
    for (let at = 8; at + 4 <= box; at += at === 8 ? 8 : 4) {
      if (ascii(bytes, at, 'avif') || ascii(bytes, at, 'avis')) return 'avif'
    }
    return null
  }
  return SVG_RE.test(new TextDecoder().decode(bytes.subarray(0, 4_096))) ? 'svg' : null
}

const length = (text: string): number => [...text].length

export type ProfileProblem = 'empty' | 'toolong' | 'badname' | 'badpicture'

/** What a set form was told, judged before anything is signed. A picture may
 *  be a 64-hex signature: the set publishes that atom first. */
export const profileValue = (field: ProfileField, raw: string):
  { ok: true; value: string } | { ok: false; problem: ProfileProblem; max?: number } => {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, problem: 'empty' }
  if (field === 'name') {
    if (length(text) > PROFILE_NAME_MAX) return { ok: false, problem: 'toolong', max: PROFILE_NAME_MAX }
    const name = nip05Name(text)
    return name ? { ok: true, value: name } : { ok: false, problem: 'badname' }
  }
  if (field === 'about') {
    return length(text) > PROFILE_ABOUT_MAX ? { ok: false, problem: 'toolong', max: PROFILE_ABOUT_MAX } : { ok: true, value: text }
  }
  if (SIG_RE.test(text.toLowerCase())) return { ok: true, value: text.toLowerCase() }
  // A picture is one address: a space inside one is a mistake, and the URL
  // parser would quietly encode it into the address.
  if (/\s/.test(text)) return { ok: false, problem: 'badpicture' }
  const href = pictureHref(text)
  if (!href) return { ok: false, problem: 'badpicture' }
  return href.length > PROFILE_PICTURE_MAX ? { ok: false, problem: 'toolong', max: PROFILE_PICTURE_MAX } : { ok: true, value: href }
}

/** The fields a profile's content carries, each through its rule; anything
 *  else in the content is not part of a profile here. */
export const profileFieldsOf = (content: unknown): ProfileFields => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return {}
  const raw = content as Record<string, unknown>
  const name = nip05Name(raw['name'])
  const said = raw['about']
  const about = typeof said === 'string' && said.trim() && length(said) <= PROFILE_ABOUT_MAX ? said : null
  const picture = profilePicture(raw['picture'])
  return { ...(name ? { name } : {}), ...(about ? { about } : {}), ...(picture ? { picture } : {}) }
}

/** The content a profile event signs: only the three fields, in one order. */
export const profileContent = (fields: ProfileFields): string => JSON.stringify({
  ...(fields.name ? { name: fields.name } : {}),
  ...(fields.about ? { about: fields.about } : {}),
  ...(fields.picture ? { picture: fields.picture } : {}),
})

/** `npub1…` for a hex key, or null. */
export const npubOf = (pubkey: string): string | null => {
  const key = String(pubkey ?? '').trim().toLowerCase()
  if (!SIG_RE.test(key)) return null
  try { return npubEncode(key) } catch { return null }
}

// ── acceptance ──────────────────────────────────────────────────────────────

export type ProfileRejection = 'hash' | 'json' | 'kind' | 'key' | 'signature' | 'content'

const sha256 = async (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.slice().buffer as ArrayBuffer)

/** The seven fields of a signed event, in the atom's order — nothing an
 *  extension added rides along. */
const eventOf = (raw: Record<string, unknown>): ProfileEvent => ({
  id: String(raw['id'] ?? ''),
  pubkey: String(raw['pubkey'] ?? ''),
  created_at: Number(raw['created_at']),
  kind: Number(raw['kind']),
  tags: Array.isArray(raw['tags']) ? raw['tags'] as string[][] : [],
  content: String(raw['content'] ?? ''),
  sig: String(raw['sig'] ?? ''),
})

/**
 * Believe a profile atom, or say why not. `sig` is what the key's index named,
 * `pubkey` is that key. Never throws.
 */
export const acceptProfile = async (bytes: Uint8Array, sig: string, pubkey: string, verify: Verify = verifyEvent as Verify):
  Promise<{ ok: true; profile: ProfileRecord } | { ok: false; reason: ProfileRejection }> => {
  const named = String(sig ?? '').trim().toLowerCase()
  const key = String(pubkey ?? '').trim().toLowerCase()
  if (!SIG_RE.test(named) || await sha256(bytes) !== named) return { ok: false, reason: 'hash' }
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder().decode(bytes)) } catch { return { ok: false, reason: 'json' } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'json' }
  const record = raw as Record<string, unknown>
  if (record['kind'] !== PROFILE_EVENT_KIND) return { ok: false, reason: 'kind' }
  if (record['pubkey'] !== key) return { ok: false, reason: 'key' }
  try { if (!verify(record as never)) return { ok: false, reason: 'signature' } } catch { return { ok: false, reason: 'signature' } }
  let content: unknown
  try { content = JSON.parse(String(record['content'] ?? '')) } catch { return { ok: false, reason: 'content' } }
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { ok: false, reason: 'content' }
  const event = eventOf(record)
  return { ok: true, profile: { sig: named, pubkey: key, createdAt: event.created_at, fields: profileFieldsOf(content), event } }
}

/** A rejection a read can end on: `hash` never does — wrong bytes are the
 *  host's fault, so they read as unreadable, never as the key's profile. */
export type ProfileRefusal = Exclude<ProfileRejection, 'hash'>

export type ProfileRead =
  | { state: 'none' }
  | { state: 'ok'; profile: ProfileRecord }
  /** It may be fine — it could not be seen. A set must not overwrite it. */
  | { state: 'unreadable'; reason: ProfileReason; params: ProfileReasonParams }
  /** Seen, and not a profile of this key. */
  | { state: 'rejected'; sig: string; reason: ProfileRefusal }

const INDEX_REASON: Readonly<Record<string, ProfileReason>> = {
  unreachable: 'index-unreachable', http: 'index-http', malformed: 'index-malformed', forged: 'index-forged',
}

/** The profile a key's own index names on a host: this hive's copy first,
 *  then the host's, each believed only through `acceptProfile`. */
export const readProfile = async (host: string, pubkey: string, deps: Pick<ProfileDeps, 'readIndex' | 'readLocal' | 'fetchAtom' | 'verify'>): Promise<ProfileRead> => {
  const read = await deps.readIndex(host, pubkey)
  if (!read.ok) {
    if (read.reason === 'http' && read.status === 404) return { state: 'none' }
    const reason = INDEX_REASON[read.reason] ?? 'index-malformed'
    return { state: 'unreadable', reason, params: reason === 'index-http' ? { host, status: read.status ?? '?' } : { host } }
  }
  const sig = String(read.manifest.roots[PROFILE_ROOT_KEY] ?? '').toLowerCase()
  if (!SIG_RE.test(sig)) return { state: 'none' }
  const local = await deps.readLocal(sig).catch(() => null)
  if (local) {
    const accepted = await acceptProfile(local, sig, pubkey, deps.verify)
    if (accepted.ok) return { state: 'ok', profile: accepted.profile }
    if (accepted.reason !== 'hash') return { state: 'rejected', sig, reason: accepted.reason }
  }
  const fetched = await deps.fetchAtom(host, sig).catch(() => null)
  if (!fetched) return { state: 'unreadable', reason: 'atom-missing', params: { host, sig: short(sig) } }
  const accepted = await acceptProfile(fetched, sig, pubkey, deps.verify)
  if (accepted.ok) return { state: 'ok', profile: accepted.profile }
  if (accepted.reason === 'hash') return { state: 'unreadable', reason: 'atom-hash', params: { host, sig: short(sig) } }
  return { state: 'rejected', sig, reason: accepted.reason }
}

/** The sig a read found named — what a set's stamp must still find there. */
const namedBy = (read: ProfileRead): string | null =>
  read.state === 'ok' ? read.profile.sig : read.state === 'rejected' ? read.sig : null

// ── the acts ────────────────────────────────────────────────────────────────

export type ProfileShow =
  | { kind: 'nokey' }
  | { kind: 'none'; pubkey: string; npub: string; seed: string | null }
  | { kind: 'shown'; pubkey: string; npub: string; profile: ProfileRecord }
  | { kind: 'unreadable'; pubkey: string; npub: string; reason: ProfileReason; params: ProfileReasonParams }

/** `profile` — the key this session knows, and what its index names on the
 *  host. Reads only: nothing is signed, put, or minted. `seed` is a name this
 *  hive already goes by (the mesh label), offered only when no profile exists. */
export const showProfile = async (
  host: string,
  deps: Pick<ProfileDeps, 'cachedPubkey' | 'readIndex' | 'readLocal' | 'fetchAtom' | 'verify'>,
  seed: () => string | null = () => null,
): Promise<ProfileShow> => {
  const pubkey = String(deps.cachedPubkey() ?? '').toLowerCase()
  const npub = npubOf(pubkey)
  if (!npub) return { kind: 'nokey' }
  const read = await readProfile(host, pubkey, deps)
  if (read.state === 'ok') return { kind: 'shown', pubkey, npub, profile: read.profile }
  if (read.state === 'none') {
    let label: string | null = null
    try { label = nip05Name(seed()) } catch { /* no seed */ }
    return { kind: 'none', pubkey, npub, seed: label }
  }
  if (read.state === 'unreadable') return { kind: 'unreadable', pubkey, npub, reason: read.reason, params: read.params }
  return { kind: 'unreadable', pubkey, npub, reason: `rejected-${read.reason}`, params: { sig: short(read.sig) } }
}

export type ProfileSetResult =
  | { ok: true; sig: string; profile: ProfileRecord; host: string }
  | { ok: false; reason: ProfileReason; params: ProfileReasonParams }

/**
 * `profile <field> <value>` — read the current profile, change ONE field, sign
 * the whole profile anew, keep the complete signed event as an atom, ship it to
 * the host, and name it in the participant's own index. Every step must hold;
 * the first that does not is the reason nothing was published.
 *
 * The stamp is conditional: it names the new atom only while the index still
 * names the profile this merge started from. A second set that raced this one
 * (another tab, another device) is NOT published rather than published over —
 * otherwise both would say Published and the later would drop the earlier's
 * field. The word itself runs one set at a time (profile.queen.ts).
 */
export const setProfileField = async (host: string, field: ProfileField, raw: string, deps: ProfileDeps): Promise<ProfileSetResult> => {
  const fail = (reason: ProfileReason, params: ProfileReasonParams = {}): ProfileSetResult => ({ ok: false, reason, params })
  if (!PROFILE_FIELDS.includes(field)) return fail('value', { field: String(field) })
  const judged = profileValue(field, raw)
  if (!judged.ok) return fail('value', { field })

  // A picture named by signature is an IMAGE this hive holds — never whatever
  // atom a pasted signature happens to name (a note, a layer): it is about to
  // be shipped to a public host.
  let value = judged.value
  const pictureSig = field === 'picture' && SIG_RE.test(value) ? value : null
  if (pictureSig) {
    const held = await deps.readLocal(pictureSig).catch(() => null)
    if (!held) return fail('picture-missing', { sig: short(pictureSig) })
    if (!imageKindOf(held)) return fail('picture-notimage', { sig: short(pictureSig) })
  }

  const pubkey = String((await deps.signerPubkey().catch(() => null)) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return fail('nosigner')

  // What is there now — unseen is not the same as absent: never overwrite a
  // profile that could not be read.
  const current = await readProfile(host, pubkey, deps)
  if (current.state === 'unreadable') return fail(current.reason, current.params)
  const base: ProfileFields = current.state === 'ok' ? current.profile.fields : {}
  const previous = current.state === 'ok' ? current.profile.createdAt : 0

  if (pictureSig) {
    const shipped = await deps.publish(host, [pictureSig]).catch((error: unknown) => ({ ok: false as const, error: detailOf(error) }))
    if (!shipped.ok) return fail('picture-unpublished', { host, detail: detailOf(shipped.error) })
    value = `${profileHostUrl(host)}/${pictureSig}`
  }
  // What is stored is what a reader will judge: the same rule, the same string.
  if (field === 'picture') {
    const href = profilePicture(value)
    if (!href) return fail('value', { field })
    value = href
  }

  const fields: ProfileFields = { ...base, [field]: value }
  const content = profileContent(fields)
  const createdAt = Math.max(Math.floor(deps.now() / 1000), previous + 1)
  let signed: Record<string, unknown>
  try { signed = await deps.sign({ kind: PROFILE_EVENT_KIND, created_at: createdAt, tags: [], content }) }
  catch (error) { return fail('sign-failed', { detail: detailOf(error) }) }

  // The atom is the event the signer returned, cut to its seven fields and
  // checked as a reader will check it before anything leaves this hive.
  const event = eventOf(signed ?? {})
  if (event.kind !== PROFILE_EVENT_KIND || event.content !== content || event.tags.length) return fail('signer-event')
  if (event.pubkey !== pubkey) return fail('signer-key')
  if (!(event.created_at > previous)) return fail('signer-date')
  const verify = deps.verify ?? (verifyEvent as Verify)
  try { if (!verify({ ...event } as never)) return fail('signer-verify') } catch { return fail('signer-verify') }

  const bytes = new TextEncoder().encode(JSON.stringify(event))
  const expected = await sha256(bytes)
  let sig: string
  try { sig = String(await deps.put(bytes)).toLowerCase() }
  catch (error) { return fail('keep-failed', { detail: detailOf(error) }) }
  if (sig !== expected) return fail('keep-sig')

  const published = await deps.publish(host, [sig]).catch((error: unknown) => ({ ok: false as const, error: detailOf(error) }))
  if (!published.ok) return fail('unpublished', { host, detail: detailOf(published.error) })
  const stamped = await deps.stamp(host, PROFILE_ROOT_KEY, sig, namedBy(current))
    .catch((error: unknown) => ({ ok: false, changed: false, reason: detailOf(error) }))
  if (!stamped.ok) return stamped.changed ? fail('changed', { host }) : fail('unstamped', { host, detail: detailOf(stamped.reason) })

  return { ok: true, sig, host, profile: { sig, pubkey, createdAt: event.created_at, fields: profileFieldsOf(JSON.parse(content)), event } }
}

// ── the word's grammar ──────────────────────────────────────────────────────

export type ProfileWord =
  | { form: 'show'; host?: string }
  | { form: 'set'; field: ProfileField; value: string; host?: string }
  | { form: 'usage' }
  | { form: 'badhost'; host: string }

/** Read what follows `profile`, verbatim: an optional leading `@<host>`, then
 *  an optional field and its value. The host comes FIRST, so nothing at the
 *  end of an about is ever taken for one — `about I post on @nostr.com` is
 *  prose, and stays where it was said. Prose passes as it was typed; a name
 *  or a picture is one token, so a second one is a misplaced host or a typo. */
export const parseProfileWord = (args: string): ProfileWord => {
  let text = String(args ?? '').trim()
  let host: string | undefined
  const at = /^@(\S*)/.exec(text)
  if (at) {
    const clean = profileHost(at[1] ?? '')
    if (!clean) return { form: 'badhost', host: at[1] ?? '' }
    host = clean
    text = text.slice(at[0].length).trim()
  }
  if (!text) return { form: 'show', ...(host ? { host } : {}) }
  const space = text.search(/\s/)
  const word = (space < 0 ? text : text.slice(0, space)).toLowerCase()
  const value = space < 0 ? '' : text.slice(space).trim()
  if (!(PROFILE_FIELDS as readonly string[]).includes(word) || !value) return { form: 'usage' }
  if (word !== 'about' && /\s/.test(value)) return { form: 'usage' }
  return { form: 'set', field: word as ProfileField, value, ...(host ? { host } : {}) }
}

/** A machine may look, and nothing else: every set form is the participant's.
 *  And it looks only on the participant's own host — a host named in a
 *  model's words is never asked (names.service.ts: a host named only in free
 *  text is never asked), or a model could send the participant's key and
 *  address to any host it likes. */
export const profileMachineRefusal = (args: string): string | undefined => {
  const word = parseProfileWord(args)
  if (word.form === 'show') return word.host ? "/profile shows the participant's own host; a machine does not name another" : undefined
  if (word.form === 'set') return `/profile ${word.field} publishes under the participant's key; only the participant says it`
  return '/profile takes no arguments from a machine; say /profile alone to show the profile'
}
