// core/attestation.types.ts
//
// WHO MAY MAKE A PACKAGE LIVE HERE. The contract, in core, where everything
// can reach it.
//
// Integrity is settled at admission: every atom hashes to its own name, so a
// host can never serve a wrong byte. That proves WHAT the bytes are. It does
// not prove WHO published the tree — and a package is code that will run in
// THIS origin with THIS origin's OPFS underneath it. "May this tree become
// current here?" therefore has a second half, and this is its shape: an
// attester that answers whether a publisher the participant FOLLOWS has
// signed a sentinel naming this package.
//
// CORE DOES NO IO. The pinned key, the index fetch and the schnorr check live
// in the module that owns nostr (essentials, sharing/package-attestation.ts);
// it registers under the key below, and runtime's activation gate
// (activation-authority.ts) reaches it through IoC. Same seam as
// HeadClaimVerifier and HostProvider, for the same reason — and a runtime
// that finds no attester must still be able to REFUSE.

/** IoC key for the package attester. Implemented where nostr lives (essentials),
 *  asked by runtime before a foreign package is fetched. */
export const ATTESTATION_IOC_KEY = '@hypercomb.social/PackageAttestation'

export type AttestationRefusal =
  /** The participant follows no publisher, so nobody can vouch. */
  | 'no-follow'
  /** No host handed back the followed publisher's index. */
  | 'unreachable'
  /** A host handed back an index that is not the followed publisher's. */
  | 'forged'
  /** The index verifies and does not name this package — a stranger's build,
   *  or one that was never stamped. */
  | 'not-named'

export type AttestationVerdict =
  | { ok: true; pubkey: string; witnessed: 'current' | 'held' }
  | {
      ok: false
      reason: AttestationRefusal
      detail?: string
      /** On 'not-named': the root the followed publisher DOES name, in full,
       *  so a caller can offer that build instead of a refusal. */
      named?: string
    }

export interface PackageAttestation {
  /** May `packageSig` become the live package of this origin? `zones` are the
   *  domains offering it — asked for the publisher's signed index alongside
   *  the followed hosts, so a host that serves that index vouches for its own
   *  head. Never throws. */
  attest(packageSig: string, zones: readonly string[]): Promise<AttestationVerdict>
}
