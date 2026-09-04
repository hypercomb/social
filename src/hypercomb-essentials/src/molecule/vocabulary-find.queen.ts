// molecule/vocabulary-find.queen.ts
//
// `/find-word <word>` — hash a word, ask the hosts, and show the FOUR
// outcomes without merging any two of them.
//
// ── `slashComplete` RETURNS NOTHING, AND THAT IS THE POINT ───────────────
//
// `dottedToSpaced` in the slash drone rewrites `a.b` into `a b` whenever every
// dotted segment is a word the completer offers. A find behaviour that
// completed this hive's own vocabulary is EXACTLY the case where a typed
// `cigar.maduro` would be silently turned into two words and the wrong
// question asked. So the argument position offers nothing and `options` is
// empty. The affordance is not lost: the window carries an input with a
// datalist of the local spellings, which is a local read and cannot rewrite
// anything.
//
// ── NO `machine` GRAMMAR ────────────────────────────────────────────────
//
// The address is a hash of a word the caller chose, and probing hosts with it
// tells them what was asked. A read that leaves the device is still a
// disclosure, so a model may not choose the word.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { VOCABULARY_FIND } from './vocabulary-words.js'

export class VocabularyFindQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'find-word'
  override description = 'Ask the hosts which of them declare a word — present, absent, or unknown'
  override examples = [
    { input: '/find-word cigar', result: 'Asks every publisher you follow, and says which could not answer' },
    { input: '/find-word', result: 'Opens the lookup with nothing asked yet' },
  ]

  /** Free text. Offering the hive's own words here would let a legitimate
   *  dotted argument be rewritten into two. */
  override slashComplete(_args: string): readonly string[] {
    return []
  }

  protected async execute(args: string): Promise<void> {
    EffectBus.emit(VOCABULARY_FIND, { word: String(args ?? '').trim(), at: Date.now() })
  }
}

const _findWord = new VocabularyFindQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/VocabularyFindQueenBee', _findWord)
