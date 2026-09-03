// molecule/molecule-index.ts
//
// THE MOLECULE INDEX RECORD — a hive's DECLARED VOCABULARY, derived.
//
// The capability this whole direction is for: say a word, hash it, ask your
// hosts. That needs `sign(fold(canon(name)))` to have CONTENT, and the content
// already exists — it is the names of the tiles that are already committed. So
// this is a pure derivation of what is there, never a new place to write.
//
// THE RECORD: for one layer signature, which molecule addresses the names in
// its subtree fold to.
//
//   derive(S) = ⋃ over manifest(S) of ( {address(child.name)} ∪ derive(child.sig) )
//
// COMPOSITION, NOT TRAVERSAL. A child that already has a record contributes its
// word set WHOLE and is never descended into — the merkle tree paying out, the
// same argument search's records rest on. The union is IDEMPOTENT, so a record
// is bounded by the DISTINCT vocabulary of a subtree rather than by its tile
// count, which is why this index stays complete where a row-per-tile one has to
// truncate.
//
// ═══════════════════════════════════════════════════════════════════════════
// NO LAYER SIGNATURES IN A RECORD. READ THIS BEFORE ADDING sigs 'FOR
// CONVENIENCE'.
// ═══════════════════════════════════════════════════════════════════════════
// `referencesOutside` / `sigsReferencedOutside` credit every 64-hex string
// found in a POOL MEMBER'S BYTES. A record naming member layer sigs would
// therefore PIN those layers against prune — and a derived cache that changes
// what the collector keeps is not wipe-safe, whatever else it claims. The
// address answers WHETHER a word is in this hive; WHERE is what the search
// records already answer, and they are the ones allowed to hold sigs. A
// molecule address is not a content address, so crediting one pins nothing.
//
// Derived-cache contract (documentation/optimize-phase.md), honoured:
//   1. keyed by the SOURCE LAYER SIGNATURE — changed tile = new sig = no
//      record = derive on miss. There is no update path.
//   2. lives in `sign('molecule:index')` — recomputable, wipe-safe, GC-able.
//   3. never load-bearing: `MoleculeIndexService.fallbackVocabulary()` answers
//      the same question with the pool absent, by folding the same names
//      through the same `moleculeAddress`. Identical, only slower.
//   4. mints no truth: no layers, no markers, no lineage writes, and NOTHING is
//      ever placed AT a molecule address. Placement is a publish act; this is
//      only the declaration.

import { moleculeAddress, moleculeKey } from '@hypercomb/core'

/** The pool. COLON-SCOPED twice over: the bare-word list may only shrink, and
 *  a bare `molecule` would BE the bag of a root tile named `molecule` — but
 *  worse, this index's whole subject is bare-word molecule addresses, so it
 *  would land on top of the very bags it indexes. */
export const MOLECULE_INDEX_MEANING = 'molecule:index'

/**
 * THE DERIVATION VERSION. Bump it when the RULE changes — a different fold, a
 * different canon, a different record shape — and every prior record becomes a
 * miss on read and is re-minted by the phase. That reject-on-mismatch IS the
 * invalidation: no migration, no sweep, no pass over old records.
 *
 * Widening the record with an OPTIONAL field that leaves old records CORRECT
 * but incomplete is the other tool, and does not need this.
 */
export const MOLECULE_DERIVATION = 1

/** One word this subtree can say. */
export interface MoleculeWord {
  /** `sign(fold(canon(name)))` — precomputed, because the whole capability is
   *  "say a word, hash it": hashing a hive's worth of names on every cold read
   *  would put the cost straight back on the read path. */
  readonly a: string
  /** A display spelling that was seen. The shallowest wins. NEVER the key —
   *  the address is the key, and two spellings of one word are one molecule. */
  readonly n: string
  /** How many tiles in this subtree fold to `a`.
   *
   *  RANKING DATA, NEVER MEMBERSHIP. It is an index-only enrichment: the cold
   *  path folds the search reader's vocabulary, which has already collapsed
   *  rows by lowercased name, so it under-reports this for a word two tiles
   *  spell differently. Nothing may branch on it — the identical-warm-and-cold
   *  answer is the ADDRESS SET (`declaredVocabulary()`). */
  readonly c: number
}

export interface MoleculeRecord {
  readonly v: number
  /** Sorted by address, so two hives with the same vocabulary produce the same
   *  bytes and a record deduplicates against itself across peers. */
  readonly words: readonly MoleculeWord[]
  /** True when a budget or a cap cut the derivation short. A truncated
   *  vocabulary is a hive with words you cannot say, so it must be visible
   *  rather than read as an absent word. */
  readonly truncated?: boolean
}

/** A record holds at most this many distinct words. Far past any hand-built
 *  hive's vocabulary — this bounds a pathological tree, it is not a limit
 *  anyone should reach. */
export const MAX_RECORD_WORDS = 8000

/** How deep a derivation recurses. A guard on the SHAPE of the walk: a cycle
 *  (a subtree re-homed into itself) is cheap per step, so the node budget alone
 *  would let it eat a whole pass. */
export const MAX_RECORD_DEPTH = 24

/** One word, checked element by element.
 *
 *  THE ADDRESS MUST BE AN ADDRESS. `declaredVocabulary()` is exactly what a
 *  host answers with when someone says a word and asks who holds it, so a key
 *  that is not a 64-hex molecule address is not a weaker answer, it is a
 *  different kind of thing — a path, a fragment of markup, a number. There is
 *  a user-mediated ingress today (a folder backup restores arbitrary OPFS
 *  paths, verified for bytes and not for shape), and a wire one the moment a
 *  host is asked, so the gate is here rather than at each ingress.
 *
 *  AND THE SPELLING IS NEVER A SIGNATURE. `referencesOutside` credits every
 *  64-hex string in a pool member's bytes, so a tile named a 64-hex string
 *  would put that string in a record and PIN it against prune — a derived
 *  cache that changes what the collector keeps is not wipe-safe. The address
 *  field is unavoidably 64-hex and is a molecule address, never content; the
 *  display spelling has no such excuse, so it is dropped. */
const ADDRESS = /^[0-9a-f]{64}$/i

const readableWord = (raw: unknown): MoleculeWord | null => {
  if (!raw || typeof raw !== 'object') return null
  const word = raw as Record<string, unknown>
  const address = typeof word['a'] === 'string' ? word['a'].toLowerCase() : ''
  if (!ADDRESS.test(address)) return null
  const spelling = typeof word['n'] === 'string' ? word['n'] : ''
  const count = Number(word['c'])
  return {
    a: address,
    n: ADDRESS.test(spelling) ? '' : spelling,
    c: Number.isSafeInteger(count) && count > 0 ? count : 1,
  }
}

/** Is this a record this build can read? The whole of invalidation, plus the
 *  element gate above — a malformed element is DROPPED, never thrown on: the
 *  one failure mode a wipe-safe cache may never have is being the thing that
 *  breaks a read path. A record that loses every word reads as an empty one,
 *  and an empty vocabulary falls through to the cold path. */
export const readableRecord = (parsed: unknown): MoleculeRecord | null => {
  const record = parsed as MoleculeRecord | null
  if (!record || typeof record !== 'object') return null
  if (record.v !== MOLECULE_DERIVATION || !Array.isArray(record.words)) return null
  const words: MoleculeWord[] = []
  for (const raw of record.words) {
    const word = readableWord(raw)
    if (word) words.push(word)
    // The write cap bounds what `seal()` emits; nothing bounded what a READ
    // would absorb, so a 50,000-word file became 50,000 map entries.
    if (words.length >= MAX_RECORD_WORDS) break
  }
  const truncated = record.truncated === true || words.length !== record.words.length
  return { v: MOLECULE_DERIVATION, words, ...(truncated ? { truncated: true } : {}) }
}

/** The molecule address of a tile name, or `null` for a name that has none
 *  (empty, or whitespace only — which would be the ROOT address). */
export const addressOfName = async (name: unknown): Promise<string | null> => {
  if (!moleculeKey(name)) return null
  try { return await moleculeAddress(name) } catch { return null }
}

/** Fold a stream of names into the record's word list. Idempotent and
 *  order-independent apart from the display spelling, where the SHALLOWEST
 *  seen wins — two tiles may share a word and the nearer one is the spelling a
 *  reader means. */
export class MoleculeWordSet {
  #byAddress = new Map<string, { n: string; c: number; d: number }>()

  get size(): number { return this.#byAddress.size }

  /** Add one occurrence. `depth` decides only which spelling is displayed. */
  add(address: string, spelling: string, depth = 0): void {
    const held = this.#byAddress.get(address)
    if (!held) { this.#byAddress.set(address, { n: spelling, c: 1, d: depth }); return }
    held.c += 1
    if (depth < held.d) { held.n = spelling; held.d = depth }
  }

  /** Splice a child's record in WHOLE — the composition step, and the reason
   *  this is cheap. The child's sig did not change, so its words are still
   *  exactly true; its depths shift down by one relative to this parent. */
  absorb(record: MoleculeRecord, depth = 1): void {
    for (const word of record.words) {
      const held = this.#byAddress.get(word.a)
      if (!held) { this.#byAddress.set(word.a, { n: word.n, c: word.c, d: depth }); continue }
      held.c += word.c
      if (depth < held.d) { held.n = word.n; held.d = depth }
    }
  }

  /** Seal the set into a record. Sorted by address; over the cap it keeps the
   *  most-used words and says `truncated`. */
  seal(truncated = false): MoleculeRecord {
    let words = [...this.#byAddress.entries()].map(([a, w]) => ({ a, n: w.n, c: w.c }))
    let cut = truncated
    if (words.length > MAX_RECORD_WORDS) {
      words.sort((x, y) => y.c - x.c || x.a.localeCompare(y.a))
      words = words.slice(0, MAX_RECORD_WORDS)
      cut = true
    }
    words.sort((x, y) => x.a.localeCompare(y.a))
    return { v: MOLECULE_DERIVATION, words, ...(cut ? { truncated: true } : {}) }
  }
}

/** Fold a record into address → word, the shape every reader wants. */
export const vocabularyOf = (record: MoleculeRecord | null): ReadonlyMap<string, MoleculeWord> => {
  const out = new Map<string, MoleculeWord>()
  if (!record) return out
  for (const word of record.words) {
    // Defensive even though `readableRecord` already filters: this is also
    // called on a freshly sealed set, and a vocabulary read must degrade, not
    // throw.
    if (!word || typeof word !== 'object' || typeof word.a !== 'string') continue
    const held = out.get(word.a)
    if (!held) out.set(word.a, word)
    else out.set(word.a, { a: word.a, n: held.n, c: held.c + word.c })
  }
  return out
}
