// keyboard-desk/board/board.ts
//
// TRAIT `board` — the keys and where they sit. Data only: the own version is an
// ANSI tenkeyless board; another layout is another list of caps.

import type { BoardPart, Cap, Modifier } from '../parts.js'

const WIDE = { h: 1 }

const cap = (x: number, y: number, w: number, label: string, code: string, key: string, shiftKey?: string, modifier?: Modifier): Cap =>
  ({ id: `${code}@${x}`, code, key, label, x, y, w, ...WIDE, ...(shiftKey ? { shiftKey } : {}), ...(modifier ? { modifier } : {}) })

/** A run of equal keys, left to right. */
const run = (x: number, y: number, keys: readonly (readonly [label: string, code: string, key: string, shiftKey?: string])[]): Cap[] =>
  keys.map(([label, code, key, shiftKey], index) => cap(x + index, y, 1, label, code, key, shiftKey))

const letter = (c: string): readonly [string, string, string] => [c.toUpperCase(), `key${c}`, c]
const letters = (text: string): readonly (readonly [string, string, string])[] => [...text].map(letter)
const fn = (n: number): readonly [string, string, string] => [`F${n}`, `f${n}`, `f${n}`]

const ROW_FN = 0
const ROW_DIGITS = 1.25
const ROW_TOP = 2.25
const ROW_HOME = 3.25
const ROW_LOW = 4.25
const ROW_SPACE = 5.25
const NAV = 15.25

const CAPS: readonly Cap[] = [
  cap(0, ROW_FN, 1, 'Esc', 'escape', 'escape'),
  ...run(2, ROW_FN, [fn(1), fn(2), fn(3), fn(4)]),
  ...run(6.5, ROW_FN, [fn(5), fn(6), fn(7), fn(8)]),
  ...run(11, ROW_FN, [fn(9), fn(10), fn(11), fn(12)]),

  ...run(0, ROW_DIGITS, [
    ['`', 'backquote', '`', '~'], ['1', 'digit1', '1', '!'], ['2', 'digit2', '2', '@'], ['3', 'digit3', '3', '#'],
    ['4', 'digit4', '4', '$'], ['5', 'digit5', '5', '%'], ['6', 'digit6', '6', '^'], ['7', 'digit7', '7', '&'],
    ['8', 'digit8', '8', '*'], ['9', 'digit9', '9', '('], ['0', 'digit0', '0', ')'], ['-', 'minus', '-', '_'],
    ['=', 'equal', '=', '+'],
  ]),
  cap(13, ROW_DIGITS, 2, '⌫', 'backspace', 'backspace'),
  ...run(NAV, ROW_DIGITS, [['Ins', 'insert', 'insert'], ['Home', 'home', 'home'], ['PgUp', 'pageup', 'pageup']]),

  cap(0, ROW_TOP, 1.5, 'Tab', 'tab', 'tab'),
  ...run(1.5, ROW_TOP, [...letters('qwertyuiop'), ['[', 'bracketleft', '[', '{'], [']', 'bracketright', ']', '}']]),
  cap(13.5, ROW_TOP, 1.5, '\\', 'backslash', '\\', '|'),
  ...run(NAV, ROW_TOP, [['Del', 'delete', 'delete'], ['End', 'end', 'end'], ['PgDn', 'pagedown', 'pagedown']]),

  cap(0, ROW_HOME, 1.75, 'Caps', 'capslock', 'capslock'),
  ...run(1.75, ROW_HOME, [...letters('asdfghjkl'), [';', 'semicolon', ';', ':'], ['\'', 'quote', '\'', '"']]),
  cap(12.75, ROW_HOME, 2.25, '↵', 'enter', 'enter'),

  cap(0, ROW_LOW, 2.25, 'Shift', 'shiftleft', 'shift', undefined, 'shift'),
  ...run(2.25, ROW_LOW, [...letters('zxcvbnm'), [',', 'comma', ',', '<'], ['.', 'period', '.', '>'], ['/', 'slash', '/', '?']]),
  cap(12.25, ROW_LOW, 2.75, 'Shift', 'shiftright', 'shift', undefined, 'shift'),
  cap(NAV + 1, ROW_LOW, 1, '↑', 'arrowup', 'arrowup'),

  cap(0, ROW_SPACE, 1.25, 'Ctrl', 'controlleft', 'ctrl', undefined, 'ctrl'),
  cap(1.25, ROW_SPACE, 1.25, 'Win', 'metaleft', 'meta', undefined, 'meta'),
  cap(2.5, ROW_SPACE, 1.25, 'Alt', 'altleft', 'alt', undefined, 'alt'),
  cap(3.75, ROW_SPACE, 6.25, 'Space', 'space', 'space'),
  cap(10, ROW_SPACE, 1.25, 'Alt', 'altright', 'alt', undefined, 'alt'),
  cap(11.25, ROW_SPACE, 1.25, 'Win', 'metaright', 'meta', undefined, 'meta'),
  cap(12.5, ROW_SPACE, 1.25, 'Menu', 'contextmenu', 'contextmenu'),
  cap(13.75, ROW_SPACE, 1.25, 'Ctrl', 'controlright', 'ctrl', undefined, 'ctrl'),
  ...run(NAV, ROW_SPACE, [['←', 'arrowleft', 'arrowleft'], ['↓', 'arrowdown', 'arrowdown'], ['→', 'arrowright', 'arrowright']]),
]

export const ansiBoard: BoardPart = { id: 'ansi', width: 18.25, height: 6.25, caps: CAPS }
