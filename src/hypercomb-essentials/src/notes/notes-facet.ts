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
// WRITTEN ALONGSIDE, READ FIRST. The cell layer's `notes` slot keeps being
// written; the write here runs after that commit and never gates it. Reads
// UNION the facet with the slot, facet first (`readNotesFacet` +
// `unionNoteSigs`), and a commit transforms that same union — so two tiles
// named the same read the same notes, and a delete at one is a delete for
// the word. A client that has not learned the facet still reads its slot.
//
// NO IDENTITY IS MINTED FOR A NOTE. Without a cached author key the facet is
// simply not written this time; the layer slot still holds the note.

import { moleculeAddress, moleculeKey } from '@hypercomb/core'
import { readFacetMembers, writeFacetHead, type FacetReadStore, type FacetStore, type FacetWriteResult } from '../molecule/facet-succession.js'
import { cachedPubkey } from '../sharing/head-claim-signer.js'

/** The plural. Position after the colon makes it a facet; `note` and `notes`
 *  are different addresses forever, and this is the one the doctrine chose. */
export const NOTES_FACET_PLURAL = 'notes'

const store = (): (FacetStore & FacetReadStore) | undefined =>
  (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<FacetStore & FacetReadStore>('@hypercomb.social/Store')

/** The last facet list each WORD read this session — what the synchronous
 *  paint path can union without awaiting. Filled by every `readNotesFacet`,
 *  so a tile's strip catches up the moment any tile of its word has been
 *  read once. Keyed by the folded word, never the location. */
const lastRead = new Map<string, string[]>()

/** The facet list for a word as of its last read this session, or `[]`.
 *  Synchronous by construction; never touches the store. */
export const cachedNotesFacet = (tileName: string): string[] => {
  const name = String(tileName ?? '').trim()
  if (!name) return []
  return lastRead.get(moleculeKey(name)) ?? []
}

/** Test seam. */
export const _resetNotesFacetCache = (): void => { lastRead.clear() }

/**
 * The note sigs on a tile's facet, in order — every author, this reader's own
 * bucket first. Empty when the facet is absent, unreadable, or the tile has
 * no name. Never throws, never mints: it OPENS the pool and creates nothing.
 * Remembers what it read for the synchronous path (`cachedNotesFacet`).
 */
export const readNotesFacet = async (
  tileName: string,
  io: { store?: FacetReadStore; pubkey?: string | null } = {},
): Promise<string[]> => {
  const name = String(tileName ?? '').trim()
  if (!name) return []
  let subjectSig: string
  try { subjectSig = await moleculeAddress(name) } catch { return [] }
  const s = io.store ?? store()
  if (!s) return []
  const read = await readFacetMembers({
    plural: NOTES_FACET_PLURAL, subjectSig, store: s,
    ownPubkey: io.pubkey === undefined ? cachedPubkey() : io.pubkey,
  })
  const members = read?.members ?? []
  lastRead.set(moleculeKey(name), members)
  return members
}

/** The one list a tile's notes are: the facet's members first (every author,
 *  own first), then any sig the layer slot still holds that the facet does
 *  not — deduped, order kept. */
export const unionNoteSigs = (facet: readonly string[], slot: readonly string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const sig of [...facet, ...slot]) {
    const s = String(sig ?? '').toLowerCase()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

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
