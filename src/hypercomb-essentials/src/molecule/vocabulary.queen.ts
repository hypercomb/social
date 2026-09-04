// molecule/vocabulary.queen.ts
//
// `/vocabulary` — SAY YOUR WORDS, AND PUBLISH THEM.
//
// The whole vocabulary stack was built, tested, and had no handle. This is the
// handle. Reading it is free and local; publishing it is an irreversible
// public act, and the two are not the same gesture.
//
// ── THE COMMAND LINE CANNOT PUBLISH ─────────────────────────────────────
//
// `execute` does exactly one thing: it emits `vocabulary:open`. There is no
// import of the publish door anywhere in this module's graph, no `confirmed`
// field on the payload, and no branch that acts. `/vocabulary publish` AIMS
// the window — it focuses the publish button — and the window then says so in
// as many words, because a participant who typed "publish" and saw a panel
// appear could otherwise reasonably believe something was published.
//
// ── NO `machine` GRAMMAR, DELIBERATELY ──────────────────────────────────
//
// `machine` absent is the safe default (`queen.base.ts`), and the window this
// opens contains the only irreversible public act in the module. A model
// speaking the communication layer must not be able to reach it, not even to
// open the door in front of it.
//
// ── NO ALIAS ────────────────────────────────────────────────────────────
//
// Aliases are the participant's to give. Nothing here declares one.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { VOCABULARY_OPEN } from './vocabulary-words.js'

/** The two verbs, in the order the window shows them. Read by `slashComplete`
 *  AND by `execute`, so autocomplete and the aim can never disagree. */
export const VOCABULARY_INTENTS: readonly string[] = Object.freeze(['publish', 'withdraw'])

/** What the window is asked to aim at. `''` is the ordinary case: open and
 *  read. Never a confirmation — this word travels no further than a focus. */
export const readIntent = (args: string): string => {
  const word = String(args ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  return VOCABULARY_INTENTS.includes(word) ? word : ''
}

export class VocabularyQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'vocabulary'
  override description = 'Show the words this hive declares; publish or withdraw them'
  override options = VOCABULARY_INTENTS
  override examples = [
    { input: '/vocabulary', result: 'Shows the words this hive holds — nothing leaves' },
    { input: '/vocabulary publish', result: 'Opens the same window with the publish gesture in front of you' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    return VOCABULARY_INTENTS.filter(o => !q || o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    EffectBus.emit(VOCABULARY_OPEN, { intent: readIntent(args), at: Date.now() })
  }
}

const _vocabulary = new VocabularyQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/VocabularyQueenBee', _vocabulary)
