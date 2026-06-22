// diamondcoreprocessor.com/games/tutor/deck.types.ts
//
// The data contract for the tutor subsystem. Study material generated from
// a hive becomes recall ITEMS — and every item is a FIRST-CLASS,
// content-addressed layer citizen, exactly like a note:
//
//   • Each StudyItem is its own resource in the content pool (one signature).
//   • A cell's `tutor` layer slot is a flat ARRAY of those item signatures —
//     the same shape as `notes` / `children` / `website`. Nothing is an
//     opaque blob; nothing rides the polymorphic `decorations` bucket.
//
// Because items are signatures in the slot, they inherit commit, undo,
// time-travel, cross-browser sync, adoption, and preloader warm-up for free,
// and identical items DEDUPE across decks (same content → same signature →
// stored once). Any media a prompt references (an image/audio) is itself a
// signature embedded in the item, resolved lazily.
//
// Spaced-repetition PROGRESS is the one thing that is NOT a layer citizen —
// it is participant-local (localStorage), keyed by the cell's location and
// by each item's stable `id`. Layer state must be identical across peers or
// a shared deck's lineage signature would fork.

/**
 * One atom of study material — a single thing to recall — stored as its own
 * content-addressed resource and referenced by signature from the `tutor`
 * slot.
 */
export interface StudyItem {
  /**
   * Stable identity — a hash of prompt+answer (first 16 hex). Distinct from
   * the item's resource signature: progress is keyed on `id`, so editing a
   * hint/alternate (which changes the resource sig) does NOT reset progress,
   * while changing the prompt or answer (a genuinely different item) does.
   */
  readonly id: string
  /** The cue shown to the learner (question / clue / cloze / front of card). */
  readonly prompt: string
  /** The thing to recall (answer / word to type / back of card). */
  readonly answer: string
  /** Optional nudge revealed on demand or after a miss. */
  readonly hint?: string
  /** Additional accepted answers for typed-recall games (synonyms, casing). */
  readonly alternates?: readonly string[]
  /** Tags copied from the source cell's `properties.tags`. Used to group / interleave. */
  readonly tags: readonly string[]
  /** Lineage of the cell this item was generated from (attribution / re-gen diffing). */
  readonly sourceSegments: readonly string[]
  /** Display label of the source cell. */
  readonly sourceCell: string
  /** Author/generator difficulty hint, 1 (easy) … 3 (hard). Seeds initial spacing. */
  readonly difficulty?: 1 | 2 | 3
}

/**
 * A logical bundle of items — the GENERATION-TIME input shape (what the
 * tutor-build skill assembles and `_tutor-deck.cjs` reads). It is NOT what
 * the layer stores: the build script writes each item as its own resource
 * and sets the `tutor` slot to the resulting signature array. Kept as a type
 * so the generation side and docs share one shape.
 */
export interface StudyDeck {
  readonly version: 1
  readonly items: readonly StudyItem[]
}

/**
 * A learner's response to one item, normalized across game types. Games that
 * only know correct/incorrect map to a grade; games that self-grade return
 * the grade directly.
 *
 *   - `again` — missed / forgot → reset spacing, see it again soon.
 *   - `good`  — recalled with effort → advance one box.
 *   - `easy`  — instant, confident recall → advance two boxes.
 */
export type Grade = 'again' | 'good' | 'easy'

/** What a game reports back to the shell when a round ends. */
export interface RoundResult {
  readonly itemId: string
  readonly grade: Grade
  /** Whether the learner produced the answer correctly (for stats / juice). */
  readonly correct: boolean
  /** Time-on-item in ms (for stats; future game weighting). */
  readonly elapsedMs: number
}
