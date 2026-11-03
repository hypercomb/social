// sharing/device-handshake.ts
//
// THE PROOF TWO OF A PARTICIPANT'S DEVICES SHOW EACH OTHER before any atom
// moves. Each side asks the other a fresh question and checks the answer:
//
//   verifier  → challenge (32 random bytes, hex)
//   prover    → a kind-30572 event signed by the prover's OWN key:
//                 tags: ['challenge', <challenge>], ['p', <verifier's key>]
//                 content: { v:1, delegation?: <the master's kind-30571 event> }
//   verifier  → accepts when the proof is fresh, answers THIS challenge, was
//               made FOR this verifier, and its key is either the master itself
//               or one the master has delegated (device-delegation.ts).
//
// The proof is never published and never stored — it is a live answer. Binding
// it to the verifier's key (`p`) is what stops a peer that was shown a proof
// from replaying it to a third device; the challenge stops replay to the same
// device later; the age window bounds a stolen answer to seconds.
//
// Run it in BOTH directions and a pair is mutually authenticated. It says only
// "same participant". What flows afterwards — and in which direction — is the
// replication layer's business, and every atom there is still sha256-checked
// against its own name, so even an authenticated peer cannot slip in a wrong
// byte.

import {
  currentDelegation,
  isGenuine,
  verifyDelegation,
  type DelegationFailure,
  type EventSigner,
  type NostrEventLike,
} from './device-delegation.js'

/** A live answer, never published. 30571 is the delegation itself. */
export const DEVICE_PROOF_KIND = 30572

/** How stale an answer may be and still count (seconds, either direction). */
export const PROOF_WINDOW_SECONDS = 60

const HEX64 = /^[0-9a-f]{64}$/

export type ProofFailure =
  | 'malformed'
  | 'wrong kind'
  | 'wrong challenge'
  | 'wrong verifier'
  | 'stale'
  | 'bad signature'
  | 'not delegated'
  | `delegation: ${DelegationFailure}`

export type ProofVerdict =
  | { ok: true; device: string; master: string; via: 'master' | 'delegation' }
  | { ok: false; reason: ProofFailure }

const tagValue = (event: NostrEventLike, name: string): string | undefined =>
  event.tags?.find(tag => tag?.[0] === name)?.[1]

/** A fresh question. 32 bytes from the platform CSPRNG, hex. */
export const newChallenge = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/**
 * Answer a challenge. `verifier` is the key of the device that asked. A device
 * that IS the master passes no delegation; a delegated device passes the
 * master's current grant for it.
 */
export const proveDevice = async (
  signer: EventSigner,
  options: { challenge: string; verifier: string; delegation?: NostrEventLike | null; now?: number },
): Promise<NostrEventLike | null> => {
  const verifier = String(options.verifier ?? '').toLowerCase()
  if (!HEX64.test(options.challenge) || !HEX64.test(verifier)) return null
  try {
    return await signer.signEvent({
      kind: DEVICE_PROOF_KIND,
      created_at: options.now ?? Math.floor(Date.now() / 1000),
      tags: [['challenge', options.challenge], ['p', verifier]],
      content: JSON.stringify({ v: 1, ...(options.delegation ? { delegation: options.delegation } : {}) }),
    })
  } catch { return null }
}

/**
 * Judge an answer. `self` is the verifier's own key (the proof must have been
 * made for it) and `master` is the participant this pair claims to share.
 * Cheapest checks first; the curve maths runs once, then once more for the
 * delegation only when the prover is not the master.
 */
export const verifyDeviceProof = (
  proof: NostrEventLike | null | undefined,
  options: { challenge: string; self: string; master: string; now?: number; known?: readonly NostrEventLike[] },
): ProofVerdict => {
  if (!proof || typeof proof !== 'object' || !Array.isArray(proof.tags)) return { ok: false, reason: 'malformed' }
  if (proof.kind !== DEVICE_PROOF_KIND) return { ok: false, reason: 'wrong kind' }
  const self = String(options.self ?? '').toLowerCase()
  const master = String(options.master ?? '').toLowerCase()
  const device = String(proof.pubkey ?? '').toLowerCase()
  if (!HEX64.test(self) || !HEX64.test(master) || !HEX64.test(device)) return { ok: false, reason: 'malformed' }
  if (tagValue(proof, 'challenge') !== options.challenge) return { ok: false, reason: 'wrong challenge' }
  if (tagValue(proof, 'p') !== self) return { ok: false, reason: 'wrong verifier' }
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - proof.created_at) > PROOF_WINDOW_SECONDS) return { ok: false, reason: 'stale' }
  if (!isGenuine(proof)) return { ok: false, reason: 'bad signature' }

  if (device === master) return { ok: true, device, master, via: 'master' }

  let delegation: NostrEventLike | undefined
  try { delegation = JSON.parse(proof.content)?.delegation } catch { return { ok: false, reason: 'malformed' } }
  if (!delegation) return { ok: false, reason: 'not delegated' }
  // A revoked device still HOLDS its old grant and will present it. What the
  // master has said since is the verifier's to know (`known`): the newest event
  // for this device stands in for whatever was presented, so a revocation —
  // or a renewal — outranks a stale grant. A verifier that was never told of
  // the revocation cannot see it; telling every device is the pairing layer's job.
  const current = currentDelegation([delegation, ...(options.known ?? [])], master, device) ?? delegation
  const verdict = verifyDelegation(current, master, device, now)
  if (!verdict.ok) return { ok: false, reason: `delegation: ${verdict.reason}` }
  return { ok: true, device, master, via: 'delegation' }
}
