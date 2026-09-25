// sharing/hive-pointer.ts
//
// Client for the per-publisher hive index — the ONE mutable object in the
// static-hive protocol: a schnorr-signed nostr event (kind 30564, see
// hive-link.ts) whose content maps the publisher's public lineage keys to
// their current sealed head sigs. Served at `GET /hive/<pubkey>` by the
// public content endpoint (blossom-worker) and, in the own-domain future,
// by any static file at the same path.
//
// Trust never comes from the host: fetchHiveManifest re-verifies the
// event's schnorr signature against the PINNED pubkey (carried in the
// hive-link bundle), so a host can withhold an index but never substitute
// one. putHiveManifest signs with the participant's own NostrSigner and
// authenticates the HTTP write with a NIP-98 header — the same envelope
// HostSyncService uses for byte PUTs.

import { get } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'
import { HIVE_INDEX_EVENT_KIND, HIVE_LINK_VERSION } from './hive-link.js'

interface SignerLike {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
  getPublicKeyHex?: () => Promise<string | null>
}

export interface HiveManifest {
  /** lineageKey → current sealed head sig, exactly as published. */
  roots: Record<string, string>
  /** Seconds-epoch of the signed event — the monotonic freshness stamp. */
  createdAt: number
  /** Publisher pubkey the signature verified against. */
  pubkey: string
  /** lineageKey → the root domains that branch opens on. The host serves a
   *  branch only on a listed domain; an absent entry grants no door. This
   *  map, signed with the roots, is the per-domain on/off switch. */
  doors?: Record<string, string[]>
  /** Optional public declarations. Values are held as signed data here; the
   *  offering reader decides their meaning when that protocol is defined. */
  offerings?: Record<string, unknown>
  /** The verified event's complete content. A roots/doors rewrite must carry
   *  fields it does not interpret, or one ordinary publish erases them. */
  signedContent?: Record<string, unknown>
}

/** Why an index read produced no manifest. `fetchHiveManifest` collapses all
 *  of these to `null` (its callers only ever asked "did I get one?"), but the
 *  publish differential MUST tell them apart: an unreachable host is a quiet
 *  "unknown", while a signature that does not verify is a host actively
 *  serving something that is not the publisher's — the single most alarming
 *  condition in the protocol, and the one a status panel exists to surface.
 *
 *  - `unreachable` — network/CORS/DNS failure. Nothing asserted.
 *  - `http`        — the host answered, but not with 200 (404 = never published).
 *  - `malformed`   — 200 with unparseable JSON, wrong kind, or bad roots.
 *  - `forged`      — well-formed event whose schnorr signature does not verify
 *                    against the pinned pubkey, or whose pubkey is not ours. */
export type HiveIndexFailure = 'unreachable' | 'http' | 'malformed' | 'forged'

export type HiveIndexResult =
  | { ok: true; manifest: HiveManifest }
  | { ok: false; reason: HiveIndexFailure; status?: number }

const SIG_RE = /^[a-f0-9]{64}$/
const NIP98_KIND = 27235
// Loopback hosts use plain http (content-side analog of allow-loopback);
// real domains use https. Same rule as HostSyncService / the invite queen.
// Any *.localhost name is loopback too (RFC 6761): a zone's content face on
// one machine is content.localhost.
const LOOPBACK_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

export function hiveIndexUrl(host: string, pubkey: string): string {
  const bare = host.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
  const scheme = LOOPBACK_RE.test(bare) ? 'http' : 'https'
  return `${scheme}://${bare}/hive/${pubkey}`
}

/** Fetch + verify one host's copy of the publisher's hive index, REPORTING
 *  WHY it failed. Never throws.
 *
 *  The distinction matters because callers act on it differently: a publish
 *  MUST NOT rewrite the index off an `unreachable` read (doing so PUTs an
 *  index missing every branch it could not see — see publish-branch.ts), and
 *  a status surface must render `forged` loudly while rendering `unreachable`
 *  as silence. */
export async function fetchHiveIndex(host: string, pubkey: string): Promise<HiveIndexResult> {
  const key = String(pubkey ?? '').trim().toLowerCase()
  if (!SIG_RE.test(key)) return { ok: false, reason: 'malformed' }
  let res: Response
  try {
    res = await fetch(hiveIndexUrl(host, key), { cache: 'no-store' })
  } catch { return { ok: false, reason: 'unreachable' } }
  if (!res.ok) return { ok: false, reason: 'http', status: res.status }

  let evt: Record<string, unknown>
  try { evt = await res.json() as Record<string, unknown> } catch { return { ok: false, reason: 'malformed' } }

  if (Number(evt?.['kind']) !== HIVE_INDEX_EVENT_KIND) return { ok: false, reason: 'malformed' }
  // Wrong pubkey and bad signature are BOTH substitution, not corruption:
  // the host handed back an index that is not this publisher's.
  if (String(evt?.['pubkey'] ?? '').toLowerCase() !== key) return { ok: false, reason: 'forged' }
  try { if (!verifyEvent(evt as never)) return { ok: false, reason: 'forged' } }
  catch { return { ok: false, reason: 'forged' } }

  let content: unknown
  try { content = JSON.parse(String(evt['content'] ?? '')) as unknown }
  catch { return { ok: false, reason: 'malformed' } }
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { ok: false, reason: 'malformed' }
  const signedContent = content as Record<string, unknown>
  const rawRoots = signedContent['roots']
  if (!rawRoots || typeof rawRoots !== 'object' || Array.isArray(rawRoots)) return { ok: false, reason: 'malformed' }
  const roots: Record<string, string> = {}
  for (const [k, v] of Object.entries(rawRoots as Record<string, unknown>)) {
    const sig = String(v ?? '').trim().toLowerCase()
    if (!k.trim() || !SIG_RE.test(sig)) return { ok: false, reason: 'malformed' }
    roots[k] = sig
  }
  const rawOfferings = signedContent['offerings']
  if (rawOfferings !== undefined && (!rawOfferings || typeof rawOfferings !== 'object' || Array.isArray(rawOfferings))) {
    return { ok: false, reason: 'malformed' }
  }
  return { ok: true, manifest: {
    roots, createdAt: Number(evt['created_at'] ?? 0), pubkey: key,
    doors: readDoors(signedContent['doors'], roots),
    ...(rawOfferings !== undefined ? { offerings: rawOfferings as Record<string, unknown> } : {}),
    signedContent,
  } }
}

/** The signed doors map, leniently: a malformed entry drops that entry, so
 *  the host has no usable door claim for that branch. It does not discard
 *  the whole index. */
function readDoors(raw: unknown, roots: Record<string, string>): Record<string, string[]> {
  const doors: Record<string, string[]> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return doors
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in roots) || !Array.isArray(v)) continue
    doors[k] = [...new Set(v.map(z => String(z ?? '').trim().toLowerCase()).filter(Boolean))]
  }
  return doors
}

/** Fetch + verify one host's copy of the publisher's hive index. Returns
 *  null on any failure — unreachable host, bad JSON, wrong kind, wrong
 *  pubkey, bad signature, malformed roots. Never throws.
 *
 *  Kept as the simple predicate for callers that genuinely only need "did I
 *  get a verified index?"; anything that must act on WHY should call
 *  `fetchHiveIndex`. */
export async function fetchHiveManifest(host: string, pubkey: string): Promise<HiveManifest | null> {
  const result = await fetchHiveIndex(host, pubkey)
  return result.ok ? result.manifest : null
}

/** Try each host in order; first verified index wins. The signature check
 *  makes order a matter of latency, never of trust. */
export async function fetchHiveManifestFromAny(hosts: readonly string[], pubkey: string): Promise<HiveManifest | null> {
  for (const host of hosts) {
    const manifest = await fetchHiveManifest(host, pubkey)
    if (manifest) return manifest
  }
  return null
}

export interface PutHiveResult {
  ok: boolean
  /** Own pubkey the index was written under ('' when signing failed). */
  pubkey: string
  /** SECONDS-epoch `created_at` of the event we signed — 0 when signing
   *  failed. Returned (not discarded) because it is the ONLY defence against
   *  a stale-but-authentic index: a schnorr check proves an index is the
   *  publisher's, never that it is the LATEST. A later read whose
   *  `created_at` is older than one we ourselves signed proves the host (or
   *  an edge in front of it) is serving a superseded index. */
  createdAt: number
  reason?: string
}

/** Sign and PUT the participant's own hive index to one host. `roots` is
 *  the COMPLETE public map (lineageKey → sealed head sig) — the index is
 *  replaceable, not mergeable, so callers merge before writing (see the
 *  /host queen). Never throws. */
export async function putHiveManifest(
  host: string,
  roots: Record<string, string>,
  doors: Record<string, string[]> = {},
  /** The `created_at` of the index this write replaces. The host refuses an
   *  index no newer than the one it holds (a rollback), and the stamp is in
   *  whole seconds, so two writes in one second — a sandbox stamped and
   *  promoted back to back — must still move forward. */
  replaces = 0,
  /** Verified signed content from the index being replaced. Uninterpreted
   *  fields (including optional offerings) survive this roots/doors edit. */
  previousContent?: Record<string, unknown>,
): Promise<PutHiveResult> {
  const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
  if (!signer?.signEvent) return { ok: false, pubkey: '', createdAt: 0, reason: 'no signer' }

  let signed: Record<string, unknown>
  try {
    const content: Record<string, unknown> = { ...previousContent, v: HIVE_LINK_VERSION, roots }
    const nextDoors = signedDoors(roots, doors).doors
    if (nextDoors) content['doors'] = nextDoors
    else delete content['doors']
    // The retired landing picture (0ec3c2d15): an index signed with one
    // carries it inertly until this, its next write, drops it.
    delete content['landing']
    signed = await signer.signEvent({
      kind: HIVE_INDEX_EVENT_KIND,
      created_at: Math.max(Math.floor(Date.now() / 1000), Math.floor(Number(replaces) || 0) + 1),
      tags: [],
      content: JSON.stringify(content),
    })
  } catch { return { ok: false, pubkey: '', createdAt: 0, reason: 'signing failed' } }
  const pubkey = String(signed?.['pubkey'] ?? '').toLowerCase()
  // Read the stamp back off the SIGNED event rather than our own clock: a
  // NIP-07 extension signs an event it composed, and the freshness compare is
  // only meaningful against the value the host will actually serve.
  const createdAt = Number(signed?.['created_at'] ?? 0) || 0
  if (!SIG_RE.test(pubkey)) return { ok: false, pubkey: '', createdAt, reason: 'signer returned no pubkey' }

  const url = hiveIndexUrl(host, pubkey)
  const auth = await nip98Header(signer, url, 'PUT')
  if (!auth) return { ok: false, pubkey, createdAt, reason: 'nip-98 signing failed' }

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
    })
    if (!res.ok) return { ok: false, pubkey, createdAt, reason: `host said ${res.status}: ${res.headers.get('X-Reason') ?? ''}`.trim() }
    return { ok: true, pubkey, createdAt }
  } catch { return { ok: false, pubkey, createdAt, reason: 'host unreachable' } }
}

/** The doors a write carries: only keys it also names as roots, and omitted
 *  entirely when empty so a doorless index stays byte-identical to before. */
function signedDoors(roots: Record<string, string>, doors: Record<string, string[]>): { doors?: Record<string, string[]> } {
  const kept: Record<string, string[]> = {}
  for (const [k, zones] of Object.entries(doors ?? {})) {
    if (k in roots && Array.isArray(zones)) kept[k] = [...zones]
  }
  return Object.keys(kept).length > 0 ? { doors: kept } : {}
}

export interface SetHiveRootResult {
  ok: boolean
  key: string
  sig: string
  host: string
  /** Publisher pubkey the write went out under ('' on refusal). */
  pubkey: string
  /** created_at of the signed index (freshness stamp; 0 on refusal). */
  createdAt: number
  /** Refusal reason, or 'unchanged' on the idempotent no-op. */
  reason?: string
}

/** Collaborators, injectable for tests. Defaults are the live module. */
export type SetHiveRootDeps = {
  fetchIndex?: typeof fetchHiveIndex
  putManifest?: typeof putHiveManifest
  publicKey?: () => Promise<string | null>
}

/** Merge ONE root into the participant's OWN index on `host` — the
 *  fetch-verify-merge-PUT step of publishBranch, extracted for callers that
 *  set a root directly (install channels — install-by-replication.md steps
 *  2+6). Same safety rules, exactly:
 *
 *  - a 404 read is the ONLY sanctioned `{}` baseline (nothing published yet);
 *  - an unreachable, malformed, or forged read REFUSES the write — we cannot
 *    see what we would be overwriting, so we do not overwrite it;
 *  - the merge touches exactly one key, so a set can never resurrect or drop
 *    the publisher's other roots;
 *  - a root already at the requested sig no-ops without re-signing
 *    (`reason: 'unchanged'`) — a re-run deploy stamp costs nothing. */
export async function setHiveRoot(host: string, key: string, sig: string, deps: SetHiveRootDeps = {}): Promise<SetHiveRootResult> {
  const fetchIndex = deps.fetchIndex ?? fetchHiveIndex
  const putManifest = deps.putManifest ?? putHiveManifest
  const publicKey = deps.publicKey ?? (() => get<SignerLike>(NOSTR_SIGNER_KEY)?.getPublicKeyHex?.() ?? Promise.resolve(null))

  const cleanKey = key.trim()
  const cleanSig = sig.trim().toLowerCase()
  const refuse = (reason: string): SetHiveRootResult =>
    ({ ok: false, key: cleanKey, sig: cleanSig, host, pubkey: '', createdAt: 0, reason })
  if (!cleanKey) return refuse('empty key')
  if (!SIG_RE.test(cleanSig)) return refuse('sig is not a 64-hex signature')

  const pubkey = String((await publicKey().catch(() => null)) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return refuse('no signer')

  const read = await fetchIndex(host, pubkey)
  let existing: Record<string, string>
  if (read.ok) existing = read.manifest.roots
  else if (read.reason === 'http' && read.status === 404) existing = {}
  else return refuse(`index-unsafe: ${read.reason}`)
  // Carry every branch's doors through untouched — a root set must never
  // quietly reopen a branch on domains its publisher switched off.
  const doors = read.ok ? read.manifest.doors ?? {} : {}

  if (existing[cleanKey] === cleanSig) {
    return { ok: true, key: cleanKey, sig: cleanSig, host, pubkey, createdAt: read.ok ? read.manifest.createdAt : 0, reason: 'unchanged' }
  }

  const put = await putManifest(host, { ...existing, [cleanKey]: cleanSig }, doors,
    read.ok ? read.manifest.createdAt : 0, read.ok ? read.manifest.signedContent : undefined)
  if (!put.ok) return refuse(put.reason ?? 'index write failed')
  return { ok: true, key: cleanKey, sig: cleanSig, host, pubkey: put.pubkey, createdAt: put.createdAt }
}

/** Take ONE root out of the participant's OWN index on `host` — the
 *  counterpart of `setHiveRoot`, under the same rules: only a verified read
 *  (or a 404) is a baseline, the merge touches exactly that key, and a key
 *  already absent no-ops (`reason: 'unchanged'`). The bytes the key named are
 *  not touched: a withdrawn root is unreachable, never deleted. */
export async function clearHiveRoot(host: string, key: string, deps: SetHiveRootDeps = {}): Promise<SetHiveRootResult> {
  const fetchIndex = deps.fetchIndex ?? fetchHiveIndex
  const putManifest = deps.putManifest ?? putHiveManifest
  const publicKey = deps.publicKey ?? (() => get<SignerLike>(NOSTR_SIGNER_KEY)?.getPublicKeyHex?.() ?? Promise.resolve(null))
  const cleanKey = key.trim()
  const refuse = (reason: string): SetHiveRootResult => ({ ok: false, key: cleanKey, sig: '', host, pubkey: '', createdAt: 0, reason })
  if (!cleanKey) return refuse('empty key')
  const pubkey = String((await publicKey().catch(() => null)) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return refuse('no signer')
  const read = await fetchIndex(host, pubkey)
  if (!read.ok && !(read.reason === 'http' && read.status === 404)) return refuse(`index-unsafe: ${read.reason}`)
  const existing = read.ok ? read.manifest.roots : {}
  if (!(cleanKey in existing)) return { ok: true, key: cleanKey, sig: '', host, pubkey, createdAt: read.ok ? read.manifest.createdAt : 0, reason: 'unchanged' }
  const { [cleanKey]: gone, ...rest } = existing
  const put = await putManifest(host, rest, read.ok ? read.manifest.doors ?? {} : {},
    read.ok ? read.manifest.createdAt : 0, read.ok ? read.manifest.signedContent : undefined)
  if (!put.ok) return refuse(put.reason ?? 'index write failed')
  return { ok: true, key: cleanKey, sig: String(gone), host, pubkey: put.pubkey, createdAt: put.createdAt }
}

/** A root the participant's OWN index names on `host`, verified, or null. */
export async function ownHiveRoot(host: string, key: string, deps: Pick<SetHiveRootDeps, 'fetchIndex' | 'publicKey'> = {}): Promise<string | null> {
  const fetchIndex = deps.fetchIndex ?? fetchHiveIndex
  const publicKey = deps.publicKey ?? (() => get<SignerLike>(NOSTR_SIGNER_KEY)?.getPublicKeyHex?.() ?? Promise.resolve(null))
  const pubkey = String((await publicKey().catch(() => null)) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return null
  const read = await fetchIndex(host, pubkey)
  const sig = read.ok ? String(read.manifest.roots[key.trim()] ?? '').toLowerCase() : ''
  return SIG_RE.test(sig) ? sig : null
}

/** NIP-98 Authorization header — same envelope HostSyncService signs for
 *  byte PUTs: a kind-27235 event binding method + url, base64'd. */
export async function nip98Header(signer: SignerLike, url: string, method: string): Promise<string | null> {
  try {
    const signed = await signer.signEvent({
      kind: NIP98_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', method]],
      content: '',
    })
    return 'Nostr ' + btoa(unescape(encodeURIComponent(JSON.stringify(signed))))
  } catch { return null }
}
