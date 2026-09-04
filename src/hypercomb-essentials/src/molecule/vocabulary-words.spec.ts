// molecule/vocabulary-words.spec.ts
//
// THE COPY IS A MECHANISM, so it gets a test.
//
// An UNKNOWN that renders as a blank, a zero, a dash or "not found" has been
// merged into an ABSENCE without anyone deciding to. These assertions are what
// stop a later edit walking the copy back toward absence-wording.

import { describe, expect, it } from 'vitest'
import {
  EMPTY_HORIZON,
  LOCAL_CANNOT_SAY,
  LOCAL_HELD,
  LOCAL_NOT_HELD,
  NO_READER,
  PANEL_NEVER_PUBLISHED,
  PANEL_PARTIAL,
  PANEL_SCOPE,
  UNKNOWN_WORDS,
  VERDICT_LABEL,
  VERDICT_MARK,
  allUnknownWords,
  counterWords,
  doorWords,
  unknownFooter,
} from './vocabulary-words.js'
import type { VocabularyUnknown } from './vocabulary-search.js'

/** The closed set, restated here on purpose: if `VocabularyUnknown` grows a
 *  fourteenth member, `UNKNOWN_WORDS` fails to compile AND this list fails. */
const EVERY_UNKNOWN: readonly VocabularyUnknown[] = [
  'no-key', 'unreachable', 'no-index', 'no-claim', 'index-unsafe', 'claim-absent',
  'unsigned', 'malformed', 'body-absent', 'body-mismatch', 'partial', 'regressed', 'superseded',
]

const BANNED = ['not found', 'none', 'no results', '0']

describe('the unknown sentences', () => {
  it('has one for every reason, and no reason shares a sentence with another', () => {
    const said = EVERY_UNKNOWN.map(why => UNKNOWN_WORDS[why])
    expect(said).toHaveLength(13)
    expect(said.every(s => typeof s === 'string' && s.trim().length > 10)).toBe(true)
    expect(new Set(said).size).toBe(13)
  })

  it('never says a word that reads as an ANSWER about the word', () => {
    const surfaces = [
      ...Object.values(UNKNOWN_WORDS),
      EMPTY_HORIZON, LOCAL_CANNOT_SAY, LOCAL_HELD, LOCAL_NOT_HELD, NO_READER,
      PANEL_NEVER_PUBLISHED, PANEL_PARTIAL, PANEL_SCOPE,
    ]
    for (const text of surfaces) {
      for (const banned of BANNED) {
        expect(text.toLowerCase(), `"${text}" contains "${banned}"`).not.toContain(banned)
      }
      expect(text.toLowerCase(), `"${text}" says "found"`).not.toContain('found')
    }
  })

  it('separates the two proven unknowns that are most easily read as absences', () => {
    // "the host answered 404" and "a verified index that names no vocabulary"
    // are DIFFERENT FACTS, and neither is "that word is not in this hive".
    expect(UNKNOWN_WORDS['no-index']).not.toBe(UNKNOWN_WORDS['no-claim'])
    expect(UNKNOWN_WORDS['partial']).toContain('says nothing either way')
  })

  it('renders a DOOR outcome for every value, claim included', () => {
    expect(doorWords('claim')).toBe('served the claim')
    for (const why of EVERY_UNKNOWN) expect(doorWords(why)).toBe(UNKNOWN_WORDS[why])
  })
})

describe('the verdict marking', () => {
  it('never rests on colour: a word AND a mark for all three', () => {
    expect(VERDICT_LABEL).toEqual({ declared: 'DECLARED', absent: 'NOT HELD', unknown: 'CANNOT SAY' })
    expect(new Set(Object.values(VERDICT_MARK)).size).toBe(3)
  })

  it('gives unknown its OWN label — never a blank and never "not held"', () => {
    expect(VERDICT_LABEL.unknown).not.toBe(VERDICT_LABEL.absent)
    expect(VERDICT_LABEL.unknown.trim()).not.toBe('')
  })
})

describe('the counters', () => {
  it('always renders THREE labelled numbers, even when two of them are zero', () => {
    const line = counterWords(0, 0, 3)
    expect(line).toContain('declares it 0')
    expect(line).toContain('does not hold it 0')
    expect(line).toContain('cannot say 3')
  })

  it('says out loud that unknown is not no', () => {
    expect(unknownFooter(2, 3)).toContain('Unknown is not')
    expect(unknownFooter(2, 3)).toContain('2 of 3')
    expect(allUnknownWords(3)).toContain('This is not an absence')
  })

  it('gives an empty horizon its own words rather than an empty list', () => {
    expect(EMPTY_HORIZON).toContain('NOBODY TO ASK')
    expect(EMPTY_HORIZON).toContain('not an answer about the word')
  })
})
