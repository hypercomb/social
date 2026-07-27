// core/group-signature.ts
//
// GROUP SIGNATURES — group identity as a first-class citizen.
//
// A "group" is any set of things that were made together and must therefore be
// ADDED and DELETED together: a course's lessons, a collection's members, an
// island of launcher tiles, the tiles a mirror script mints. Until now every
// consumer invented its own ad-hoc grouping token (`'g0'`, a parent name, a
// render-order run), so nothing could answer "what else belongs to this?" —
// and a group could only be removed by walking the code that made it.
//
// The primitive: a group is named by a MEANING, and its identity is
// `sign('group:<meaning>')` — the same content-addressed identity primitive
// everything else uses. Every member carries that signature (as a `group`
// decoration on a tile, as a field on a launcher member, as a provenance
// record's `groupSig`), so membership is DATA, readable by anyone holding the
// signature, and add / delete are set operations over the mark:
//
//     const sig = await groupSignature('tutorial:course:beginner')
//     // …every tile minted for that course carries { kind:'group', payload:{ sig, meaning } }
//     // deleting the course = remove every tile whose group mark is `sig`
//
// The `group:` prefix is load-bearing. Pool addresses and lineage sigbags share
// the flat OPFS root namespace, and `lineageKey` folds every non-letter/number
// to `-` — so a preimage carrying a colon can never be produced by a location
// (see pool-registry.ts). A group signature is therefore collision-proof
// against both bags and pools by construction, and MEANINGS SHOULD THEMSELVES
// be scoped (`tutorial:course:beginner`, `help:tier:basics`) so two features
// can never mint the same group by accident.
//
// Signatures are permanent: `sign()` of a new spelling is a different group
// forever. Renaming a group's meaning is a data migration, never a rename.

import { SignatureService } from './signature.service.js'

/** Decoration kind carrying a group mark on a tile: `{ sig, meaning }`. */
export const GROUP_DECORATION_KIND = 'group'

/** The canonical preimage behind a group's signature. */
export const groupPreimage = (meaning: string): string => `group:${meaning.trim()}`

/** meaning → sign(group:meaning), and the inverse for diagnostics / labelling.
 *  Populated lazily by derivation; never evicted (a session mints a handful). */
const addressByMeaning = new Map<string, string>()
const meaningByAddress = new Map<string, string>()

/**
 * The signature that IS this group. Deterministic across sessions, peers, and
 * rebuilds — two hives that mint the same meaning agree on the group without
 * ever exchanging a message.
 */
export const groupSignature = async (meaning: string): Promise<string> => {
  const key = meaning.trim()
  const known = addressByMeaning.get(key)
  if (known) return known
  const sig = await SignatureService.sign(
    new TextEncoder().encode(groupPreimage(key)).buffer as ArrayBuffer,
  )
  addressByMeaning.set(key, sig)
  meaningByAddress.set(sig, key)
  return sig
}

/** The meaning behind a group signature THIS session derived, if any. A group
 *  minted elsewhere is still a valid group — absence here is not "not a group",
 *  it only means nobody has named it in this process yet. */
export const groupMeaningOf = (signature: string): string | undefined =>
  meaningByAddress.get(signature)

/** A group mark, ready to write as a `group` decoration payload. */
export type GroupMark = { readonly sig: string; readonly meaning: string }

/** Build the mark for a meaning — what every member of the group carries. */
export const groupMark = async (meaning: string): Promise<GroupMark> => ({
  sig: await groupSignature(meaning),
  meaning: meaning.trim(),
})
