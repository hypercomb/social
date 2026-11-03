// commands/layout.ts
//
// THE LAYOUT: a tile's list of trait words, kept as one version of its layer
// (documentation/living-presentation.md, "The layout behaviour: the extrude
// names decide what shows"; jwize 2026-11-03: "a layout is just a history item
// … each has a list of traits, these can be assigned").
//
// A layout is a record on the tile (`layout:extrude`) holding the signature of
// its ordered word list. While it is on, the layer shows only the children
// those words name, and every other child is LEFT OUT: still there, untouched,
// just not drawn. Turning it on, off, or taking another tile's is a new version
// of the layer, so every layout the tile has had stays in its history. The word
// list is a resource by signature, so the same layout can be assigned to any
// tile: same list, same signature, one record.
//
// Pure: the parser and the rule. The word is layout.queen.ts; the grid is told
// by layout-view.drone.ts.

import { sameTraitWord } from '@hypercomb/core'

export const LAYOUT_KIND = 'layout:extrude'

/** The record a tile wears. `names` is the signature of a JSON string[]. */
export type LayoutRecord = { readonly on: boolean; readonly names?: string }

export type LayoutArgs =
  | { readonly verb: 'show' }
  | { readonly verb: 'on' }
  | { readonly verb: 'off' }
  | { readonly verb: 'from'; readonly route: readonly string[] }
  | { readonly error: string }

/** `layout`, `layout on`, `layout off`, `layout from /<route>`. */
export function parseLayoutArgs(raw: string): LayoutArgs {
  const words = String(raw ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { verb: 'show' }
  const head = words[0]!.toLowerCase()
  if (head === 'on' && words.length === 1) return { verb: 'on' }
  if (head === 'off' && words.length === 1) return { verb: 'off' }
  if (head === 'from' && words.length === 2 && words[1]!.startsWith('/')) {
    const route = words[1]!.split('/').map(s => s.trim()).filter(Boolean)
    if (route.length && !route.some(s => s === '.' || s === '..')) return { verb: 'from', route }
  }
  return { error: 'say "layout", "layout on", "layout off", or "layout from /<tile>"' }
}

/** The children a layout of `names` leaves out, in the children's order. */
export function leftOut(children: readonly string[], names: readonly string[]): string[] {
  return children.filter(child => !names.some(name => sameTraitWord(name, child)))
}

/** A clean, ordered word list: no blanks, no word twice by fold. */
export function layoutNames(words: readonly unknown[]): string[] {
  const out: string[] = []
  for (const raw of words) {
    const word = String(raw ?? '').trim()
    if (word && !out.some(w => sameTraitWord(w, word))) out.push(word)
  }
  return out
}

/** The newest record of a tile's layout, or null. A layer may hold an older
 *  one for a moment while a switch commits; the last written wins. */
export function currentLayout(records: readonly { record?: { payload?: unknown } }[]): LayoutRecord | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const payload = records[i]?.record?.payload as Partial<LayoutRecord> | undefined
    if (payload && typeof payload.on === 'boolean') {
      return payload.names && /^[0-9a-f]{64}$/.test(payload.names) ? { on: payload.on, names: payload.names } : { on: payload.on }
    }
  }
  return null
}
