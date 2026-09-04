// molecule/molecule-index.prune-pin.spec.ts
//
// SKEPTIC LENS — DERIVED-CACHE DISCIPLINE.
//
// `molecule-index.ts` makes this promise in a banner comment:
//
//   "AND THE SPELLING IS NEVER A SIGNATURE. `referencesOutside` credits every
//    64-hex string in a pool member's bytes, so a tile named a 64-hex string
//    would put that string in a record and PIN it against prune — a derived
//    cache that changes what the collector keeps is not wipe-safe. ... the
//    display spelling has no such excuse, so it is dropped."
//
// The gate that is supposed to keep that promise is `readableWord`, and it
// runs on the READ path only. Prune does not read records through
// `readableRecord`; `HistoryService.referencesOutside` opens the pool member
// as a FILE and scans its BYTES with an UNANCHORED regex:
//
//   const scanText = (text: string): void => {
//     for (const match of text.matchAll(/[0-9a-f]{64}/gi)) hit(match[0].toLowerCase())
//   }
//
// So the bytes are what matters, and the bytes are produced by
// `MoleculeWordSet.seal()`, which copies the tile name through verbatim.
// These tests are written against the bytes.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifyDirectoryEntry,
  poolCreditsMemberNames,
  poolKindOfMeaning,
} from '@hypercomb/core'
import { MOLECULE_INDEX_MEANING } from './molecule-index.js'
import { MoleculeWordSet } from './molecule-index.js'

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** VERBATIM from `HistoryService.referencesOutside`. */
const PRUNE_SCAN = /[0-9a-f]{64}/gi
const referencedByPrune = (memberBytes: string): Set<string> => {
  const out = new Set<string>()
  for (const match of memberBytes.matchAll(PRUNE_SCAN)) out.add(match[0].toLowerCase())
  return out
}

describe('the molecule index record must not pin content against prune', () => {
  /** A layer signature that has nothing to do with this record — the thing the
   *  collector is deciding about. */
  const LAYER_SIG = sha('some layer nobody references any more')

  it('a tile name that CONTAINS a signature is written into the record bytes', () => {
    const words = new MoleculeWordSet()
    // A perfectly ordinary way to end up with a sig inside a name: a revision
    // label, an adopted tile, a pasted address, a generated backup name.
    words.add(sha('backup'), `backup ${LAYER_SIG}`, 0)

    // This is EXACTLY what `MoleculeIndexService.writeRecord` puts on disk.
    const bytes = JSON.stringify(words.seal())

    expect(referencedByPrune(bytes).has(LAYER_SIG)).toBe(false)
  })

  it('even an EXACTLY-64-hex tile name reaches the bytes — the read-side gate is too late', () => {
    const words = new MoleculeWordSet()
    words.add(sha('a tile named by its signature'), LAYER_SIG, 0)

    const bytes = JSON.stringify(words.seal())

    // `readableWord` drops `n` when it is exactly 64 hex, but prune never
    // calls `readableWord`; it reads the file.
    expect(referencedByPrune(bytes).has(LAYER_SIG)).toBe(false)
  })

  it('a child record spliced in WHOLE carries its spelling into the parent bytes', () => {
    const child = new MoleculeWordSet()
    child.add(sha('note'), `note ${LAYER_SIG}`, 0)

    const parent = new MoleculeWordSet()
    parent.absorb(child.seal(), 1)

    expect(referencedByPrune(JSON.stringify(parent.seal())).has(LAYER_SIG)).toBe(false)
  })

  it('THE RECORD\'S OWN FILENAME is the layer sig, and the walk must NOT credit it', () => {
    // `MoleculeIndexService.writeRecord` opens `pool.getFileHandle(layerSig)`,
    // so the member is NAMED by the layer it derives from — which is exactly
    // what "keyed by the source signature" requires, and is NOT the thing to
    // change: a derived cache's key IS its invalidation rule.
    //
    // `referencesOutside`'s walk credits member NAMES for a real reason:
    // `SubstrateService.addReference` writes an EMPTY file named by an image's
    // signature, and nothing else on disk names it. So a member name is a
    // genuine reference IN A POOL THAT HOLDS TRUTH — and never in a derived
    // cache, where crediting it keeps a layer alive purely because an
    // accelerator was minted for it, and wiping the pool changes what the
    // collector keeps.
    //
    // The rule therefore lives in ONE place, `poolCreditsMemberNames`, and it
    // answers on the DECLARED KIND rather than on a list of pool names.
    // `classifyDirectoryEntry` is untouched: a 64-hex file IS a member,
    // everywhere.
    expect(classifyDirectoryEntry(LAYER_SIG, false)).toBe('member')

    expect(poolKindOfMeaning(MOLECULE_INDEX_MEANING)?.wipeSafe).toBe(true)
    expect(poolCreditsMemberNames(poolKindOfMeaning(MOLECULE_INDEX_MEANING))).toBe(false)

    // A pool that holds TRUTH still credits — including the UNDECLARED case.
    // The collector deletes bytes, so a missed reference is the dangerous
    // direction and `undefined` must never read as wipe-safe.
    expect(poolCreditsMemberNames(poolKindOfMeaning('substrate:references'))).toBe(true)
    expect(poolCreditsMemberNames(poolKindOfMeaning('nobody-declared-this'))).toBe(true)
  })

  it('the reference walk asks that ONE rule, rather than carrying a list', () => {
    // Mechanical, in the repo's own ratchet idiom: the guarantee above is only
    // real if `referencesOutside` actually consults it.
    const src = readFileSync(
      join(process.cwd(), 'hypercomb-essentials', 'src', 'history', 'history.service.ts'),
      'utf8',
    )
    expect(src.includes('poolCreditsMemberNames(facts)')).toBe(true)
    // Name AND bytes: a wipe-safe member is skipped whole, never scanned.
    expect(src.includes('if (!creditsNames) continue')).toBe(true)
    expect(src.includes('if (creditsNames) hit(name.toLowerCase())')).toBe(false)
  })

  it('the addresses themselves are fine — a molecule address is not content', () => {
    const words = new MoleculeWordSet()
    words.add(sha('coffee'), 'coffee', 0)
    // sha('coffee') is a molecule address: a directory address with no bytes
    // behind it. Crediting it pins nothing, which is the design's own point.
    expect(referencedByPrune(JSON.stringify(words.seal())).has(LAYER_SIG)).toBe(false)
  })
})
