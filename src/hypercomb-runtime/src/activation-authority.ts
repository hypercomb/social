// hypercomb-runtime/src/activation-authority.ts
//
// THE SECOND HALF OF ADMISSION — not "are these the bytes" but "may they run
// HERE".
//
// acquire.ts proves integrity: every atom hashes to its own name. Until
// 2026-09-11 that was the whole gate, and it left one act unguarded — the
// hosts window made it a click. A package offered by ANY carried domain could
// be applied: its bees written into this origin's pool and imported on the
// next boot with the participant's whole tree underneath them. A hostile or
// hijacked host could not serve a wrong byte, but it could hand you a
// different tree and call it current, and "current" was bound to nobody.
//
// This module binds it. A package may activate in this origin when ONE of:
//
//   SELF      the domain offering it IS this origin. Its code already runs
//             here — the shim booting a published site, or a shell taking its
//             own /content — so nothing new can run and there is no decision.
//   GENESIS   this shell has never activated a package, no module is loaded
//             that could vouch for anything, and the offer comes from the ONE
//             named seed (DEFAULT_HOST_ZONES): the bootstrap trust the whole
//             chain already rests on, spent once, before there is data to
//             protect.
//   ATTESTED  a publisher the participant FOLLOWS has signed a sentinel
//             naming it (core ATTESTATION_IOC_KEY, implemented where nostr
//             lives — essentials/sharing/package-attestation.ts).
//   HAND      the participant picked ONE revision at ONE path, by hand, from
//             a root nothing here vouches for — a community trial
//             (documentation/module-sandbox.md, "Your own build"). It is let in
//             as a STRANGER's arrival: every bee and dependency bundle it brings
//             that the trunk does not already run is HELD in the brood, and
//             runs only after the participant accepts it with the two warnings
//             (core/brood.ts). Only a pick asks this (acquire.ts pickRevision);
//             an install never does, and a forged index is never answered by it.
//   FLOOR     the shell found the live package below its floor: it cannot
//             answer the update door, so it can never move itself
//             (hypercomb-web package-floor.ts). The old package has no
//             attester, and the offer comes from the ONE named seed. It is
//             genesis again: the bootstrap trust spent a second time, for a
//             package that can vouch for nothing. An attester that IS loaded
//             beside it came from the pool, not from the package — a move cut
//             short leaves the head's modules there, and an install with no
//             bag loads them — so the floor is answered before it is asked.
//
// Everything else is REFUSED, by name, before a single byte is fetched. Fail
// closed: no attester loaded means no foreign package, never a free pass. The
// refusal is the sentence the hosts window shows, and it says what to do
// instead — VISIT their domain. The browser's origin isolation runs their
// build against THEIR storage, never yours; that is the segregation, and it
// costs nothing to enforce.

import { ATTESTATION_IOC_KEY, type AttestationRefusal, type PackageAttestation } from '@hypercomb/core'
import { DEFAULT_HOST_ZONES, hostZone } from './host-zones.js'

export type ActivationVerdict =
  | { ok: true; by: 'self' | 'genesis' | 'attested' | 'floor' | 'hand' }
  | { ok: false; error: string }

export type ActivationQuestion = {
  packageSig: string
  /** The domain that offered the package. */
  zone: string
  /** The zone this shell is running as — `location.host`, folded the same way. */
  self: string
  /** The live package, or null when this shell has never activated one. */
  installed: string | null
  /** Every other domain offering the same signature — byte sources, and
   *  places the publisher's signed index may be served. */
  zones?: readonly string[]
  /** Whoever registered under ATTESTATION_IOC_KEY, or nothing. */
  attester?: PackageAttestation | null
  /** The shell found the live package below its floor (package-floor.ts).
   *  Only the shell sets it, and only the seed may answer it. */
  floor?: boolean
  /** One revision at one path, picked by the participant's own hand. Only a
   *  pick sets it; what it admits is held in the brood (the HAND door). */
  byHand?: boolean
}

/** The attester runtime finds through IoC — null when no module has
 *  registered one, which the gate treats as "refuse every foreign package". */
export const registeredAttester = (): PackageAttestation | null => {
  try {
    const found = window.ioc?.get?.<PackageAttestation>(ATTESTATION_IOC_KEY)
    return found && typeof found.attest === 'function' ? found : null
  } catch { return null }
}

export const activationAuthority = async (q: ActivationQuestion): Promise<ActivationVerdict> => {
  const verdict = await answer(q)
  // HAND: what no door admits, the participant's own pick may bring in —
  // held, never run. A forged index is the loudest condition in the protocol
  // and is never waved through, by hand or otherwise.
  if (!verdict.ok && q.byHand === true && !('forged' in verdict)) return { ok: true, by: 'hand' }
  return verdict.ok ? verdict : { ok: false, error: verdict.error }
}

const answer = async (q: ActivationQuestion): Promise<ActivationVerdict | { ok: false; error: string; forged: true }> => {
  const zone = hostZone(q.zone)
  const self = hostZone(q.self)
  if (zone && zone === self) return { ok: true, by: 'self' }
  if (q.floor === true && DEFAULT_HOST_ZONES.includes(zone)) return { ok: true, by: 'floor' }

  const attester = q.attester ?? null
  if (!attester) {
    if (q.installed === null && DEFAULT_HOST_ZONES.includes(zone)) return { ok: true, by: 'genesis' }
    return {
      ok: false,
      error: `${zone || 'this host'} offers a package nothing here can vouch for — no publisher attester is loaded`,
    }
  }

  const offering = [zone, ...(q.zones ?? []).map(hostZone)].filter(Boolean)
  try {
    const verdict = await attester.attest(q.packageSig, [...new Set(offering)])
    if (verdict.ok) return { ok: true, by: 'attested' }
    const error = refusalText(verdict.reason, zone, verdict.detail)
    return verdict.reason === 'forged' ? { ok: false, error, forged: true } : { ok: false, error }
  } catch {
    return { ok: false, error: `${zone}'s build could not be attested — the attester failed, so it stays unapplied` }
  }
}

/** The sentence a refusal shows. Each names the way forward, because the
 *  honest alternative always exists: try it on its own domain. */
export const refusalText = (reason: AttestationRefusal, zone: string, detail?: string): string => {
  const where = zone || 'that host'
  const tail = detail ? ` (${detail})` : ''
  switch (reason) {
    case 'no-follow':
      return `you follow no publisher, so no build from ${where} can be applied here — visit ${where} to try it on its own domain`
    case 'unreachable':
      return `the followed publisher's signed index could not be read, so ${where}'s build stays unapplied${tail}`
    case 'forged':
      return `${where} served an index that is not the followed publisher's — refused`
    case 'not-named':
      return `not signed by a publisher you follow — visit ${where} to try it on its own domain${tail}`
  }
}
