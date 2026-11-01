// keyboard-desk/chord/chord.ts
//
// TRAIT `chord` — how a press is written down and read back. A chord names every
// modifier, on or off, so it fires on that press and no other. The platform's
// primary modifier is written as `primary`, so a chord chosen on Windows means
// the same press on a Mac.

import { formatChord, isMac, type KeyChord } from '@hypercomb/core'
import { sameChord, type Press } from '../../keyboard/chord-match.js'
import type { Cap, Chord, ChordPart, Held } from '../parts.js'

const LOWERCASE_CODE = /^[a-z0-9]+$/

export const pressOfCap = (cap: Cap, held: Held): Press => ({
  key: held.shift && cap.shiftKey ? cap.shiftKey : cap.key,
  code: cap.code,
  ...held,
})

export const chordOfPress = (press: Press): KeyChord => ({
  key: press.key,
  ...(LOWERCASE_CODE.test(press.code) ? { code: press.code } : {}),
  primary: isMac ? press.meta : press.ctrl,
  shift: press.shift,
  alt: press.alt,
  ...(isMac ? { ctrl: press.ctrl } : { meta: press.meta }),
})

export const readChord = (chord: Chord): readonly (readonly string[])[] =>
  chord.map(step => formatChord([step]))

export const chordPart: ChordPart = { pressOfCap, chordOfPress, sameChord, read: readChord }
