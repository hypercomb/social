// molecule/vocabulary-words.ts
//
// THE WORDS THE TWO VOCABULARY SURFACES SAY — and nothing else.
//
// Pure. No I/O, no registration, no side-effects line. It exists so the copy
// that keeps UNKNOWN from collapsing into ABSENCE cannot drift, and so the
// compiler participates in keeping it honest.
//
// ── WHY THE UNKNOWN SENTENCES ARE A `Record`, NOT A `switch` ─────────────
//
// `UNKNOWN_WORDS` is typed `Record<VocabularyUnknown, string>`. A fourteenth
// member added to `VocabularyUnknown` in `vocabulary-search.ts` is a COMPILE
// ERROR here, not a row that silently renders blank — and a blank row is
// exactly how "we could not find out" turns back into "it is not there".
//
// ── THE BANNED WORDS ────────────────────────────────────────────────────
//
// Not one sentence here may contain "not found", "none", "no results" or a
// bare zero, and `vocabulary-words.spec.ts` asserts it over every value in
// this file. Those are the shapes a reader reads as an ANSWER. An unknown is
// a fact about the ASKING — no door answered, the bytes did not hash, the
// claim admits it is partial — so every sentence below is written about the
// asking and never about the word.
//
// "CANNOT SAY", not "NO ANSWER": several unknowns DID answer. `partial` is an
// authentic signed claim that simply says nothing about this word, and
// `no-claim` is a verified index that names no vocabulary at all. "No answer"
// blames the network for a state of the evidence.

import type {
  VocabularyDoorOutcome,
  VocabularyUnknown,
  VocabularyVerdict,
} from './vocabulary-search.js'

// ---------------------------------------------------------------------------
// THE TWO EFFECT NAMES — shared by a queen and its surface, so neither has to
// import the other and a spec can drive either half alone.
// ---------------------------------------------------------------------------

/** `/vocabulary` asks for the window. The payload carries an INTENT, never a
 *  confirmation: the command line cannot publish. */
export const VOCABULARY_OPEN = 'vocabulary:open'

/** `/find-word` asks for one word to be looked up. */
export const VOCABULARY_FIND = 'vocabulary:find'

/** The bus replays its last value to late subscribers, so a reload would
 *  otherwise re-open a window nobody just asked for. Anything older than this
 *  is a replay, not a request. */
export const OPEN_STAMP_MS = 10_000

// ---------------------------------------------------------------------------
// THE THIRTEEN
// ---------------------------------------------------------------------------

/** One sentence per `VocabularyUnknown`, each a fact about the asking. */
export const UNKNOWN_WORDS: Readonly<Record<VocabularyUnknown, string>> = Object.freeze({
  'no-key': 'no key to ask with — this entry named no publisher, so no question was asked',
  'unreachable': 'no door answered in time',
  'no-index': 'the host says this publisher has published nothing at all',
  'no-claim': 'they publish, but have not declared any vocabulary',
  'index-unsafe': 'the host served an index that is not this publisher’s',
  'claim-absent': 'their index names a claim their host did not serve',
  'unsigned': 'no valid signature by this key at this address',
  'malformed': 'the bytes served are not a vocabulary claim',
  'body-absent': 'the claim verified; its word list did not arrive',
  'body-mismatch': 'the word list does not match what was signed',
  'partial': 'authentic, admits it is incomplete, and does not name this word — which says nothing either way',
  'regressed': 'every door served a claim older than one already proven',
  'superseded': 'a newer claim exists and could not be read; only an older one answered',
})

/** What one DOOR answered. `claim` is the only outcome that is not an unknown. */
export const doorWords = (outcome: VocabularyDoorOutcome): string =>
  outcome === 'claim' ? 'served the claim' : UNKNOWN_WORDS[outcome]

// ---------------------------------------------------------------------------
// THE THREE VERDICTS — a word AND a mark, never a colour alone
// ---------------------------------------------------------------------------

export const VERDICT_LABEL: Readonly<Record<VocabularyVerdict, string>> = Object.freeze({
  declared: 'DECLARED',
  absent: 'NOT HELD',
  unknown: 'CANNOT SAY',
})

/** Marking never rests on colour: a filled disc, a hollow ring, a question. */
export const VERDICT_MARK: Readonly<Record<VocabularyVerdict, string>> = Object.freeze({
  declared: '●',
  absent: '○',
  unknown: '?',
})

// ---------------------------------------------------------------------------
// THE LOCAL ROW — the fourth outcome, and the only certain one
// ---------------------------------------------------------------------------

export const LOCAL_HELD = 'HELD HERE — this hive holds this word.'
export const LOCAL_NOT_HELD = 'NOT HELD HERE — this hive does not hold this word.'
/** A local miss under an incomplete picture is an UNKNOWN, not an absence. */
export const LOCAL_CANNOT_SAY =
  'THIS HIVE — CANNOT SAY. Its own word index is incomplete, so it has not seen this word; ' +
  'that is not the same as not holding it.'
/** The molecule index is not running at all. Never "this hive holds no words". */
export const NO_READER =
  'THIS HIVE — CANNOT SAY. The word index is not running here, so this hive cannot answer for itself.'

// ---------------------------------------------------------------------------
// THE AGGREGATE STATES THAT MUST NOT LOOK LIKE A MISS
// ---------------------------------------------------------------------------

/** `findings.length === 0` — the ONLY way the row list is empty. */
export const EMPTY_HORIZON =
  'NOBODY TO ASK — you follow no publisher and carry no key of your own. ' +
  'This is not an answer about the word.'

/** `gatherHorizon` threw. This is a fact about THIS DEVICE (storage denied, a
 *  module failed to load) — never "you follow nobody", which is a fact about
 *  the participant. Two different claims, two different rows. */
export const HORIZON_FAILED =
  'COULD NOT WORK OUT WHO TO ASK — reading your follows and hosts failed on this device. ' +
  'Nobody was asked. This is not an answer about the word.'

/** No molecule address could be derived for the word, so no door was opened.
 *  The counter line ("Asked N publishers…") is never drawn in this state. */
export const NO_ADDRESS =
  'NO ADDRESS — this word could not be turned into an address, so nobody was asked. ' +
  'This is not an answer about the word.'

/** Every row unknown. */
export const allUnknownWords = (publishers: number): string =>
  `No answer from anyone. ${publishers} publisher${publishers === 1 ? '' : 's'} asked; ` +
  `not one could say. This is not an absence.`

/** The standing footer, drawn whenever a single row did not reach an answer. */
export const unknownFooter = (unknowns: number, total: number): string =>
  `Unknown is not “no”. ${unknowns} of ${total} publisher${total === 1 ? '' : 's'} ` +
  `did not answer — the word may be there.`

/** Always three labelled numbers, even at zero: one number can be misread,
 *  three that sum to the row count cannot. */
export const counterWords = (declared: number, absent: number, unknown: number): string =>
  `declares it ${declared} · does not hold it ${absent} · cannot say ${unknown}`

// ---------------------------------------------------------------------------
// THE VOCABULARY PANEL
// ---------------------------------------------------------------------------

export const PANEL_PRIVATE =
  'Nothing here has left this device. Publishing is a separate act.'

/** `declaredVocabularyPartial()` defaults to TRUE, and a surface that hides
 *  the partiality is not honest. It is a line above the list, never a
 *  footnote. */
export const PANEL_PARTIAL =
  'This picture is INCOMPLETE. Some subtrees could not be read, so this list is a floor ' +
  'and not the whole of it. A claim published now will say so, in the signature.'

export const PANEL_WHOLE = 'This picture is whole.'

/** The panel counts what the HIVE holds; the claim carries only what is inside
 *  published branches. Saying so is the difference between a surprise and a
 *  decision. */
export const PANEL_SCOPE =
  'The confirmation will tell you how many of these are in your published branches — usually fewer.'

export const PANEL_NEVER_PUBLISHED =
  'NEVER PUBLISHED — no claim has ever been signed from this device. Readers who ask which ' +
  'words you hold get “unknown”, not “no”.'

export const PANEL_NO_IDENTITY =
  'No signing identity yet. One is created only if you publish.'

export const PANEL_WARNING =
  'Publishing makes the tile NAMES in your published branches derivable by anyone who asks your host.'

/** `/vocabulary publish` aims the window. It does not publish. */
export const PANEL_INTENT_PUBLISH =
  'Press “Publish these words…” to continue — typing the word did not publish anything.'

export const PANEL_INTENT_WITHDRAW =
  'Press “Withdraw…” to continue — typing the word did not withdraw anything.'

/** An address in `declaredVocabulary()` with no spelling in the union. */
export const NAME_UNKNOWN_LOCALLY = '(name not known locally)'

export const namelessFooter = (n: number): string =>
  `${n} address${n === 1 ? '' : 'es'} ${n === 1 ? 'has' : 'have'} no local spelling. ` +
  `${n === 1 ? 'It is' : 'They are'} still declared.`
