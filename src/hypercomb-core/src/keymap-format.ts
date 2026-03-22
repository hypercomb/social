// keymap-format.ts — platform-aware shortcut display formatting

import { isMac } from './platform.js'
import type { KeyChord } from './keymap.js'

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc', arrowup: '\u2191', arrowdown: '\u2193',
  arrowleft: '\u2190', arrowright: '\u2192', delete: 'Del',
  enter: '\u21B5', space: 'Space', tab: 'Tab',
  backspace: '\u232B', '/': '?',
}

export function formatKey(key: string): string {
  return KEY_LABELS[key] ?? key.toUpperCase()
}

export function formatChord(chord: KeyChord[]): string[] {
  const parts: string[] = []
  for (const k of chord) {
    if (k.primary) parts.push(isMac ? '\u2318' : 'Ctrl')
    if (k.ctrl) parts.push('Ctrl')
    if (k.alt) parts.push(isMac ? '\u2325' : 'Alt')
    if (k.shift) parts.push(isMac ? '\u21E7' : 'Shift')
    if (k.meta) parts.push(isMac ? '\u2318' : 'Win')

    const key = k.key ?? k.code ?? ''
    parts.push(formatKey(key))
  }
  return parts
}
