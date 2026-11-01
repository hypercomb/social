// keyboard-desk/legend/legend.ts
//
// TRAIT `legend` — what a key would do. Read through the same rule the keymap
// service fires on (keyboard/chord-match.ts), so what is drawn is what happens.

import { isMac, type KeyBinding, type KeyChord } from '@hypercomb/core'
import { chordFits, sameChord, type Press } from '../../keyboard/chord-match.js'
import { NOTHING_HELD, type BoardPart, type Cap, type Chord, type Held, type Legend, type LegendPart } from '../parts.js'

/** The bound chord's alternatives in its first step. */
const firstStep = (binding: KeyBinding): readonly KeyChord[] => binding.sequence[0] ?? []

/** Every modifier that is down is one the chord asked for. */
const asksFor = (press: Press, k: KeyChord): boolean => {
  const primary = isMac ? press.meta : press.ctrl
  const other = isMac ? press.ctrl : press.meta
  if (primary && !(k.primary || (isMac ? k.meta : k.ctrl))) return false
  if (other && !(isMac ? k.ctrl : k.meta)) return false
  if (press.shift && !k.shift) return false
  if (press.alt && !k.alt) return false
  return true
}

export const legendOf = (press: Press, bindings: readonly KeyBinding[], mine: ReadonlySet<string>): readonly Legend[] => {
  const out: Legend[] = []
  for (const binding of bindings) {
    const fits = firstStep(binding).filter(k => chordFits(press, k))
    if (!fits.length) continue
    out.push({
      cmd: binding.cmd,
      fit: fits.some(k => asksFor(press, k)) ? 'exact' : 'loose',
      mine: mine.has(binding.cmd),
      shadowed: false,
      continues: binding.sequence.length > 1,
    })
  }
  const claimed = out.some(legend => legend.mine)
  const rank = (legend: Legend): number => (legend.mine ? 0 : legend.fit === 'exact' ? 1 : 2)
  return out
    .map(legend => ({ ...legend, shadowed: claimed && !legend.mine }))
    .sort((a, b) => rank(a) - rank(b))
}

const onCap = (cap: Cap, k: KeyChord): boolean =>
  k.code ? k.code === cap.code : k.key === cap.key || k.key === cap.shiftKey

export const bindingsOn = (cap: Cap, bindings: readonly KeyBinding[]): readonly KeyBinding[] =>
  bindings.filter(binding => firstStep(binding).some(k => onCap(cap, k)))

export const bindingOn = (chord: Chord, bindings: readonly KeyBinding[], mine: ReadonlySet<string>): KeyBinding | null => {
  const fits = bindings.filter(binding => binding.sequence.length === chord.length
    && chord.every((step, index) => binding.sequence[index]?.some(k => sameChord(k, step))))
  return fits.find(binding => mine.has(binding.cmd)) ?? fits[0] ?? null
}

const heldBy = (cap: Cap, k: KeyChord): Held => ({
  ...NOTHING_HELD,
  ctrl: !!(k.ctrl || (!isMac && k.primary)),
  meta: !!(k.meta || (isMac && k.primary)),
  alt: !!k.alt,
  shift: !!k.shift || (!k.code && k.key === cap.shiftKey),
})

export const capsOf = (binding: KeyBinding, board: BoardPart): readonly { readonly cap: Cap; readonly held: Held }[] => {
  const out: { cap: Cap; held: Held }[] = []
  for (const k of firstStep(binding)) {
    for (const cap of board.caps) {
      if (!cap.modifier && onCap(cap, k)) out.push({ cap, held: heldBy(cap, k) })
    }
  }
  return out
}

export const legendPart: LegendPart = { legendOf, bindingsOn, bindingOn, capsOf }
