// notes/notes-facet.ts
//
// NOTES ONTO THE FACET — the forward half of the notes write.
//
// Decided 2026-09-04: a tile's notes are a FACET OF ITS WORD,
// `sign('notes:' + moleculeAddress(name))`. Two tiles named `cigars` anywhere
// share one notes facet, because the same word is the same molecule; and the
// word is what a search across hosts holds. Each note stays the atom it always
// was (its bytes and signature do not change); what is new is the incidence —
// an envelope per note with `relation: 'notes'` and its `slot` — a succession
// atom listing them in order, and one signed head claim in this author's
// bucket. See molecule/facet-succession.ts for the shape.
//
// WRITTEN ALONGSIDE, NOT INSTEAD. The cell layer's `notes` slot keeps being
// written and keeps being read; this runs after that commit and never gates
// it. A client that has not learned the facet sees nothing different. Reads
// move to the facet in a later step.
//
// NO IDENTITY IS MINTED FOR A NOTE. Without a cached author key the facet is
// simply not written this time; the layer slot still holds the note.

import { moleculeAddress } from '@hypercomb/core'
import { writeFacetHead, type FacetStore, type FacetWriteResult } from '../molecule/facet-succession.js'
import { cachedPubkey } from '../sharing/head-claim-signer.js'

/** The plural. Position after the colon makes it a facet; `note` and `notes`
 *  are different addresses forever, and this is the one the doctrine chose. */
export const NOTES_FACET_PLURAL = 'notes'

const store = (): FacetStore | undefined =>
  (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<FacetStore>('@hypercomb.social/Store')

/**
 * Put a tile's current note list on its facet, in order. Best-effort and
 * never throws: the layer commit that called this has already landed.
 */
export const writeNotesFacet = async (
  tileName: string,
  noteSigs: readonly string[],
  io: { store?: FacetStore; pubkey?: string | null } = {},
): Promise<FacetWriteResult> => {
  const pubkey = io.pubkey === undefined ? cachedPubkey() : io.pubkey
  if (!pubkey) return { ok: false, reason: 'no identity' }
  const name = String(tileName ?? '').trim()
  if (!name) return { ok: false, reason: 'bad subject', detail: 'a tile with no name has no molecule' }
  let subjectSig: string
  try { subjectSig = await moleculeAddress(name) } catch (err) { return { ok: false, reason: 'bad subject', detail: String(err) } }
  const s = io.store ?? store()
  if (!s) return { ok: false, reason: 'no store' }
  return writeFacetHead({ plural: NOTES_FACET_PLURAL, subjectSig, members: noteSigs, kind: 'resource', store: s, pubkey })
}
