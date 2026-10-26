// sharing/sealed-publish.ts
//
// PUBLISHING A PRIVATE VERSION, AND OPENING ONE (documentation/sealed-audiences.md, items 4 and 5).
//
//   publish:  closure of the head → seal every atom → key index → fresh door secret → seal the key index under it →
//             an envelope sealing that secret to each member (and the publisher) → upload ciphertexts, door and envelope
//             → name the envelope in the signed index (`sealed`, hive-pointer.ts).
//   open:     the index's envelopes, in order → the first with a seal for this key → door secret → key index → any atom
//             a layer names, opened and CHECKED against the signature it was asked by.
//
// The orchestration takes its collaborators as arguments, so every step is held by a spec; `liveSealedDeps` wires them to
// the running hive (store, host sync, signer), and `publishPrivate` is the whole act for one branch. Nothing here is reached
// from a switch or a word yet, and `publishPrivate` has not been run against a live host.

import { SignatureService } from '@hypercomb/core'
import { lineageKey } from '../history/lineage-key.js'
import { fetchHiveIndex, setHiveSealed } from './hive-pointer.js'
import { publisherKeyHex } from './key-list.client.js'
import { nodesFor } from './publish-branch.js'
import { isPublishNode } from './zone-door.js'
import { openKeyIndex, openFromIndex, collectClosure, sealClosure, sealKeyIndex, signBytes, type KeyIndex } from './sealed-closure.js'
import { envelopeBytes, newDoorSecret, openEnvelope, parseEnvelope, sealEnvelope, type Nip44 } from './sealed-envelope.js'

export type SealedPublishDeps = {
  /** The plaintext closure's source: the local store, by signature. */
  readonly getBytes: (sig: string) => Promise<Uint8Array | null>
  /** Put bytes where hosts can serve them, each under its own signature. */
  readonly upload: (atoms: ReadonlyMap<string, Uint8Array>) => Promise<{ ok: true } | { ok: false; reason: string }>
  /** Name these envelopes, first-to-try first, in the signed index for the branch. */
  readonly setSealed: (envelopes: readonly string[]) => Promise<{ ok: boolean; reason?: string }>
  readonly nip44: Nip44
  readonly publisher: string
  /** Envelopes the branch already names; the new one is tried first and these follow. */
  readonly previous?: readonly string[]
}

export type SealedPublishResult =
  | { ok: true; envelope: string; door: string; atoms: number }
  | { ok: false; reason: 'no-head' | 'seal-failed' | 'envelope-failed' | 'upload-failed' | 'index-failed'; detail?: string }

export async function publishSealed(head: string, members: readonly string[], deps: SealedPublishDeps): Promise<SealedPublishResult> {
  const closure = await collectClosure(head, deps.getBytes)
  if (!closure.has(head)) return { ok: false, reason: 'no-head' }
  const sealed = await sealClosure(closure, head)
  if (!sealed) return { ok: false, reason: 'seal-failed' }
  const secret = newDoorSecret()
  const door = await sealKeyIndex(sealed.keyIndex, secret)
  if (!door) return { ok: false, reason: 'seal-failed' }
  const envelope = await sealEnvelope({ door: door.sig, secret, publisher: deps.publisher, members }, deps.nip44)
  if (!envelope) return { ok: false, reason: 'envelope-failed' }
  const envelopeData = envelopeBytes(envelope)
  const envelopeSig = await signBytes(envelopeData)

  // The bytes go first, the index after: the index only ever names what is served.
  const upload = new Map(sealed.sealed)
  upload.set(door.sig, door.bytes)
  upload.set(envelopeSig, envelopeData)
  const sent = await deps.upload(upload)
  if (!sent.ok) return { ok: false, reason: 'upload-failed', detail: sent.reason }
  const named = await deps.setSealed([envelopeSig, ...(deps.previous ?? []).filter(sig => sig !== envelopeSig)])
  if (!named.ok) return { ok: false, reason: 'index-failed', ...(named.reason ? { detail: named.reason } : {}) }
  return { ok: true, envelope: envelopeSig, door: door.sig, atoms: sealed.sealed.size }
}

export type OpenedVersion = {
  readonly head: string
  readonly envelope: string
  /** One plaintext atom, by the signature a layer names it with; null when it cannot be opened and verified. */
  readonly read: (plainSig: string) => Promise<Uint8Array | null>
}

/** The first private version this key can open, in the order the index names them; null when none opens. */
export async function openSealedVersion(
  envelopes: readonly string[],
  me: string,
  nip44: Nip44,
  fetchBytes: (sig: string) => Promise<Uint8Array | null>,
): Promise<OpenedVersion | null> {
  for (const sig of envelopes) {
    const data = await fetchBytes(sig)
    if (!data || (await signBytes(data)) !== sig) continue
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(data)) } catch { continue }
    const envelope = parseEnvelope(parsed)
    if (!envelope) continue
    const secret = await openEnvelope(envelope, me, nip44)
    if (!secret) continue
    const doorBytes = await fetchBytes(envelope.door)
    if (!doorBytes || (await signBytes(doorBytes)) !== envelope.door) continue
    const keyIndex: KeyIndex | null = await openKeyIndex(doorBytes, secret)
    if (!keyIndex) continue
    return { head: keyIndex.head, envelope: sig, read: plainSig => openFromIndex(keyIndex, plainSig, fetchBytes) }
  }
  return null
}

// ── the live collaborators ──

type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }
type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}
const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined
type SignerLike = {
  getPublicKeyHex?: () => Promise<string | null>
  nip44Encrypt?: (peer: string, text: string) => Promise<string | null>
  nip44Decrypt?: (peer: string, payload: string) => Promise<string | null>
}

/** The signer's NIP-44, or null when this signer has none (an extension without it). */
export const liveNip44 = (): Nip44 | null => {
  const signer = get<SignerLike>('@diamondcoreprocessor.com/NostrSigner')
  if (!signer?.nip44Encrypt || !signer.nip44Decrypt) return null
  return { encrypt: (peer, text) => signer.nip44Encrypt!(peer, text), decrypt: (peer, payload) => signer.nip44Decrypt!(peer, payload) }
}

/** Bytes by signature from the local store. */
export const liveGetBytes = async (sig: string): Promise<Uint8Array | null> => {
  try {
    const blob = await get<StoreLike>('@hypercomb.social/Store')?.getResource?.(sig)
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } catch { return null }
}

/** Upload by signature to one host through host sync. */
export const liveUpload = (host: string) => async (atoms: ReadonlyMap<string, Uint8Array>): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const sync = get<HostSyncLike>('@diamondcoreprocessor.com/HostSyncService')
  if (!sync?.publishAtoms) return { ok: false, reason: 'host sync is not available here' }
  const sent = await sync.publishAtoms(host, [...atoms.keys()], async sig => atoms.get(sig) ?? null)
  return sent.ok ? { ok: true } : { ok: false, reason: sent.error }
}

/** The signature of bytes, as the rest of the system makes it (kept here so a caller needs one import). */
export const sigOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

export type PublishPrivateResult =
  | SealedPublishResult
  | { ok: false; reason: 'services' | 'no-signer' | 'no-nip44' | 'no-host' | 'not-published' }

/** A private version of ONE published branch for `members`: the ciphertext goes to the host its index lives on, and the
 *  envelope is named in the signed index beside the branch's public root. The head is the one the index already names
 *  (or `options.head`, a sealed head the store holds); the branch must already be published, since a private version
 *  hangs off a root. `members` are public keys. A branch with a private version and NO public one is a design question
 *  still open (what the root names), so it is not made here.
 *
 *  It never seals the subtree itself: that recursive seal is a courtesy the doctrine ratchet only lets shrink. */
export async function publishPrivate(segments: readonly string[], members: readonly string[], options: { head?: string } = {}): Promise<PublishPrivateResult> {
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  const hostSync = get<Parameters<typeof nodesFor>[1]>('@diamondcoreprocessor.com/HostSyncService')
  const nip44 = liveNip44()
  if (segs.length === 0) return { ok: false, reason: 'services' }
  if (!nip44) return { ok: false, reason: 'no-nip44' }
  // Two keys: this device's OWN key seals (and is what a member opens against), while the index is the ANCHOR's when
  // this device publishes for one. The anchor is sealed to as well, so a device that holds it opens the version.
  const signer = get<SignerLike>('@diamondcoreprocessor.com/NostrSigner')
  const own = String((await signer?.getPublicKeyHex?.().catch(() => null)) ?? '').toLowerCase()
  const publisher = await publisherKeyHex()
  if (!/^[0-9a-f]{64}$/.test(own) || !/^[0-9a-f]{64}$/.test(publisher)) return { ok: false, reason: 'no-signer' }
  const hosts = (await nodesFor(segs, hostSync).catch(() => [] as string[])).filter(isPublishNode)
  const key = lineageKey(segs)
  // The host whose index already names this branch is where its private version belongs.
  let host = ''
  let previous: string[] = []
  let head = ''
  for (const candidate of hosts) {
    const read = await fetchHiveIndex(candidate, publisher)
    if (read.ok && key in read.manifest.roots) { host = candidate; previous = read.manifest.sealed?.[key] ?? []; head = read.manifest.roots[key]!; break }
  }
  if (!host) return { ok: false, reason: hosts.length ? 'not-published' : 'no-host' }
  if (options.head && /^[0-9a-f]{64}$/.test(options.head)) head = options.head
  return publishSealed(head, [...new Set([publisher, ...members])], {
    getBytes: liveGetBytes, upload: liveUpload(host), nip44, publisher: own, previous,
    setSealed: async envelopes => {
      const named = await setHiveSealed(host, key, envelopes)
      return { ok: named.ok, ...(named.reason ? { reason: named.reason } : {}) }
    },
  })
}

/** The first private version of a branch that THIS device's key can open, or null: the index is read and verified from
 *  `host`, its envelopes are fetched by signature, and the first with a seal for this key opens. */
export async function openPrivate(host: string, publisher: string, key: string): Promise<OpenedVersion | null> {
  const nip44 = liveNip44()
  const signer = get<SignerLike>('@diamondcoreprocessor.com/NostrSigner')
  const me = String((await signer?.getPublicKeyHex?.().catch(() => null)) ?? '').toLowerCase()
  if (!nip44 || !/^[0-9a-f]{64}$/.test(me)) return null
  const read = await fetchHiveIndex(host, publisher)
  const envelopes = read.ok ? read.manifest.sealed?.[key] : undefined
  if (!envelopes?.length) return null
  const bare = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const scheme = /^(localhost|127\.|\[::1\])/.test(bare) ? 'http' : 'https'
  const fetchBytes = async (sig: string): Promise<Uint8Array | null> => {
    try {
      const response = await fetch(`${scheme}://${bare}/${sig}`, { cache: 'no-store' })
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null
    } catch { return null }
  }
  return openSealedVersion(envelopes, me, nip44, fetchBytes)
}
