// diamondcoreprocessor.com/sharing/hive-pointer.ts
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
import { verifyEvent } from 'nostr-tools'
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
}

const SIG_RE = /^[a-f0-9]{64}$/
const NIP98_KIND = 27235
// Loopback hosts use plain http (content-side analog of allow-loopback);
// real domains use https. Same rule as HostSyncService / the invite queen.
const LOOPBACK_RE = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

export function hiveIndexUrl(host: string, pubkey: string): string {
  const bare = host.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
  const scheme = LOOPBACK_RE.test(bare) ? 'http' : 'https'
  return `${scheme}://${bare}/hive/${pubkey}`
}

/** Fetch + verify one host's copy of the publisher's hive index. Returns
 *  null on any failure — unreachable host, bad JSON, wrong kind, wrong
 *  pubkey, bad signature, malformed roots. Never throws. */
export async function fetchHiveManifest(host: string, pubkey: string): Promise<HiveManifest | null> {
  const key = String(pubkey ?? '').trim().toLowerCase()
  if (!SIG_RE.test(key)) return null
  let evt: Record<string, unknown>
  try {
    const res = await fetch(hiveIndexUrl(host, key), { cache: 'no-store' })
    if (!res.ok) return null
    evt = await res.json() as Record<string, unknown>
  } catch { return null }

  if (Number(evt?.['kind']) !== HIVE_INDEX_EVENT_KIND) return null
  if (String(evt?.['pubkey'] ?? '').toLowerCase() !== key) return null
  try { if (!verifyEvent(evt as never)) return null } catch { return null }

  let content: Record<string, unknown>
  try { content = JSON.parse(String(evt['content'] ?? '')) as Record<string, unknown> } catch { return null }
  const rawRoots = content?.['roots']
  if (!rawRoots || typeof rawRoots !== 'object' || Array.isArray(rawRoots)) return null
  const roots: Record<string, string> = {}
  for (const [k, v] of Object.entries(rawRoots as Record<string, unknown>)) {
    const sig = String(v ?? '').trim().toLowerCase()
    if (!k.trim() || !SIG_RE.test(sig)) return null
    roots[k] = sig
  }
  return { roots, createdAt: Number(evt['created_at'] ?? 0), pubkey: key }
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
  reason?: string
}

/** Sign and PUT the participant's own hive index to one host. `roots` is
 *  the COMPLETE public map (lineageKey → sealed head sig) — the index is
 *  replaceable, not mergeable, so callers merge before writing (see the
 *  /host queen). Never throws. */
export async function putHiveManifest(host: string, roots: Record<string, string>): Promise<PutHiveResult> {
  const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
  if (!signer?.signEvent) return { ok: false, pubkey: '', reason: 'no signer' }

  let signed: Record<string, unknown>
  try {
    signed = await signer.signEvent({
      kind: HIVE_INDEX_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ v: HIVE_LINK_VERSION, roots }),
    })
  } catch { return { ok: false, pubkey: '', reason: 'signing failed' } }
  const pubkey = String(signed?.['pubkey'] ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, pubkey: '', reason: 'signer returned no pubkey' }

  const url = hiveIndexUrl(host, pubkey)
  const auth = await nip98Header(signer, url, 'PUT')
  if (!auth) return { ok: false, pubkey, reason: 'nip-98 signing failed' }

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
    })
    if (!res.ok) return { ok: false, pubkey, reason: `host said ${res.status}: ${res.headers.get('X-Reason') ?? ''}`.trim() }
    return { ok: true, pubkey }
  } catch { return { ok: false, pubkey, reason: 'host unreachable' } }
}

/** NIP-98 Authorization header — same envelope HostSyncService signs for
 *  byte PUTs: a kind-27235 event binding method + url, base64'd. */
async function nip98Header(signer: SignerLike, url: string, method: string): Promise<string | null> {
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
