// molecule/molecule-index.authority-skeptic.spec.ts
//
// ADVERSARIAL PASS over the record VALIDATOR.
//
// `readableRecord` is the only gate between a file in `sign('molecule:index')`
// and the vocabulary this hive declares. It checks two things — the derivation
// version and that `words` is an array — and then trusts every element.
//
// That would be fine for a record only ever written by this process. It is not
// what the record is for: the stated capability is "say a word, hash it, ASK
// YOUR HOSTS", and `declaredVocabulary()` is exactly what a host would answer
// with. The moment that answer is fetched — or restored from a backup folder,
// which `folder-sync.service.ts` already does with arbitrary OPFS paths — the
// elements are somebody else's bytes.

import { describe, expect, it } from 'vitest'
import {
  MOLECULE_DERIVATION, readableRecord, vocabularyOf,
} from './molecule-index.js'

describe('a record is trusted element by element', () => {

  it('accepts words whose address is not an address', () => {
    const record = readableRecord({
      v: MOLECULE_DERIVATION,
      words: [
        { a: '<img src=x onerror=alert(1)>', n: 'people', c: 1 },
        { a: '../../../etc/passwd', n: 'people', c: 1 },
        { a: 42, n: null, c: 'lots' },
      ],
    })
    expect(record).not.toBeNull()
    const vocabulary = vocabularyOf(record)
    expect(
      [...vocabulary.keys()],
      'every key of a declared vocabulary must be a 64-hex molecule address',
    ).toEqual([])
  })

  it('accepts an unbounded word list on READ, though it caps one on WRITE', () => {
    const words = Array.from({ length: 50_000 }, (_, i) => ({ a: String(i).padStart(64, '0'), n: 'x', c: 1 }))
    const record = readableRecord({ v: MOLECULE_DERIVATION, words })
    expect(
      record?.words.length,
      'MAX_RECORD_WORDS bounds what seal() writes; nothing bounds what a read will absorb',
    ).toBeLessThanOrEqual(8000)
  })
})
