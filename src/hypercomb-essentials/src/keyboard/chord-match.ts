// keyboard/chord-match.ts
//
// WHAT A PRESS IS, AND WHETHER A CHORD FITS IT. One rule, read by the keymap
// service when a key goes down and by the keyboard desk when it draws what a key
// would do, so the drawing cannot disagree with the press.

import { isMac, type KeyChord } from '@hypercomb/core'

/** The bindings a participant chose. A record here needs only `cmd` and
 *  `sequence`: the rest comes from the layer beneath it. */
export const USER_KEYMAP_LAYER = 'user-overrides'

/** A key going down, with the modifiers read off it. `key` and `code` are the
 *  normalized lowercase forms the keymap is written in. */
export interface Press {
  readonly key: string
  readonly code: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly meta: boolean
}

export function normalizeKey(key: unknown): string {
  // Defensive: synthetic events can deliver undefined key. Returning an empty
  // string is harmless — it just won't match any binding.
  if (typeof key !== 'string' || !key) return ''
  const k = key.toLowerCase()
  if (k === 'control') return 'ctrl'
  if (k === ' ') return 'space'
  return k
}

export function pressOfEvent(e: KeyboardEvent): Press {
  return {
    key: normalizeKey(e.key),
    // Defensive: synthetic events (IME, mobile soft-keyboards, autofill chips)
    // can deliver an event with `code` undefined.
    code: typeof e.code === 'string' ? e.code.toLowerCase() : '',
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
  }
}

/** A modifier the chord does not name is one it does not look at, so `{ key: 'h' }`
 *  fits Ctrl+H as well as H. */
export function chordFits(press: Press, k: KeyChord): boolean {
  if (k.code) {
    if (press.code !== k.code) return false
  } else if (press.key !== k.key) return false

  if (k.ctrl !== undefined && press.ctrl !== k.ctrl) return false
  if (k.shift !== undefined && press.shift !== k.shift) return false
  if (k.alt !== undefined && press.alt !== k.alt) return false
  if (k.meta !== undefined && press.meta !== k.meta) return false

  if (k.primary !== undefined) {
    const actual = isMac ? press.meta : press.ctrl
    if (actual !== k.primary) return false
  }

  return true
}

/** Two written chords that are the same press, `primary` read for this platform. */
export function sameChord(a: KeyChord, b: KeyChord): boolean {
  const primary = (k: KeyChord): boolean => !!(k.primary || (isMac ? k.meta : k.ctrl))
  const other = (k: KeyChord): boolean => !!(isMac ? k.ctrl : k.meta)
  const sameKey = a.code && b.code ? a.code === b.code : a.key === b.key
  return sameKey && primary(a) === primary(b)
    && !!a.shift === !!b.shift && !!a.alt === !!b.alt && other(a) === other(b)
}
