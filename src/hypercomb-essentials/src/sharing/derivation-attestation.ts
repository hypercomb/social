// sharing/derivation-attestation.ts
//
// DERIVATION ATTESTATIONS (documentation/derivations.md). A derivation record
// says how something was made from something else; an ATTESTATION is one
// person, under their own key, saying what they found when they made it
// again: `reproduced` (the same record came out) or `differs`.
//
// An attestation is a small record on the host, named by its hash, and the
// attester names it in their OWN signed index as `attest:<record sig>` — the
// signature on their index is the signature on their word. The host keeps the
// list of who attested a record as the pool sign('attest:<record>') and answers
// it at its own address (no named route). Membership is never trusted on its
// own: each listed attester's index is read and re-verified, and their record
// must hash to the signature their index names.

import { SignatureService, get, registerPoolMeaning } from '@hypercomb/core'
import { fetchHiveIndex, setHiveRoot } from './hive-pointer.js'

const SIG_RE = /^[a-f0-9]{64}$/
export const ATTEST_PREFIX = 'attest:'
export type AttestationOutcome = 'reproduced' | 'differs'
export const ATTESTATION_KIND = 'derivation-attestation'

export type Attestation = {
  readonly v: 1
  readonly kind: typeof ATTESTATION_KIND
  /** The derivation record attested. */
  readonly record: string
  readonly outcome: AttestationOutcome
  /** The record the attester's own run produced, when they ran it here. */
  readonly got?: string
  /** The transform as the attester ran it (`esbuild-wasm@0.27.3`, …). */
  readonly ran?: string
  readonly at: number
}

type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

/** `https://<host>` — plain http only for a loopback address. */
export const hostBase = (host: string): string => {
  const bare = String(host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `${/^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d+)?$/i.test(bare) ? 'http' : 'https'}://${bare}`
}

/** A file from a host, believed only when its bytes hash to the signature
 *  asked for. Published packages sit under /content/, the heap at the root. */
export const readBySig = async (host: string, sig: string): Promise<Uint8Array | null> => {
  if (!SIG_RE.test(sig)) return null
  for (const path of [`/content/${sig}`, `/${sig}`]) {
    try {
      const res = await fetch(`${hostBase(host)}${path}`, { cache: 'force-cache' })
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (await SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) === sig) return bytes
    } catch { /* the next shape */ }
  }
  return null
}

export const attestationText = (record: string, outcome: AttestationOutcome, extra: { got?: string; ran?: string } = {}): string =>
  JSON.stringify({
    v: 1, kind: ATTESTATION_KIND, record, outcome,
    ...(extra.got && SIG_RE.test(extra.got) ? { got: extra.got } : {}),
    ...(extra.ran ? { ran: extra.ran } : {}),
    at: Date.now(),
  })

/** An attestation of exactly `record`, or nothing. */
export const parseAttestation = (text: string, record: string): Attestation | null => {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (raw['kind'] !== ATTESTATION_KIND || raw['record'] !== record) return null
    if (raw['outcome'] !== 'reproduced' && raw['outcome'] !== 'differs') return null
    return raw as unknown as Attestation
  } catch { return null }
}

/** Put your attestation on the host and name it in your signed index. */
export const publishAttestation = async (
  host: string, record: string, outcome: AttestationOutcome, extra: { got?: string; ran?: string } = {},
): Promise<{ ok: true; sig: string } | { ok: false; reason: string }> => {
  if (!SIG_RE.test(record)) return { ok: false, reason: 'name the derivation record by its signature' }
  const bytes = new TextEncoder().encode(attestationText(record, outcome, extra))
  const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
  const sync = get<HostSyncLike>('@diamondcoreprocessor.com/HostSyncService')
  if (!sync?.publishAtoms) return { ok: false, reason: 'host sync is not available here' }
  const sent = await sync.publishAtoms(host, [sig], async wanted => (wanted === sig ? bytes : null))
  if (!sent.ok) return { ok: false, reason: sent.error }
  const stamped = await setHiveRoot(host, `${ATTEST_PREFIX}${record}`, sig)
  return stamped.ok ? { ok: true, sig } : { ok: false, reason: stamped.reason ?? 'the index refused it' }
}

/** Everyone who attested `record` on `host`, each re-verified from their own
 *  signed index. A listed key whose index no longer names it is not counted. */
export const readAttestations = async (host: string, record: string): Promise<Array<{ pubkey: string; sig: string; attestation: Attestation }>> => {
  let listed: string[] = []
  try {
    const pool = await registerPoolMeaning(`${ATTEST_PREFIX}${record}`)
    const res = await fetch(`${hostBase(host)}/${pool}/`, { cache: 'no-store' })
    if (res.ok) listed = (await res.text()).split('\n').map(line => line.trim().toLowerCase()).filter(line => SIG_RE.test(line))
  } catch { /* nobody listed */ }
  const out: Array<{ pubkey: string; sig: string; attestation: Attestation }> = []
  for (const pubkey of listed) {
    const index = await fetchHiveIndex(host, pubkey)
    if (!index.ok) continue
    const sig = String(index.manifest.roots?.[`${ATTEST_PREFIX}${record}`] ?? '').toLowerCase()
    const bytes = SIG_RE.test(sig) ? await readBySig(host, sig) : null
    const attestation = bytes ? parseAttestation(new TextDecoder().decode(bytes), record) : null
    if (attestation) out.push({ pubkey, sig, attestation })
  }
  return out
}
