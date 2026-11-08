// assistant/tile-code.ts
//
// THE CODE BEHIND A TILE, AS WORDS TO FOLLOW (documentation/inspect.md). A
// tile runs because code keys on something it carries: its name, the kind of
// each decoration it wears, the slots its layer fills, a behaviour bound to
// where it stands. Each of those is a word some running module QUOTES. And a
// piece of code reaches the rest of the hive the same way: by the effects it
// emits and listens for, and the IoC keys it asks for and registers.
//
// So the drill-down needs nothing but text: the words a tile carries, and the
// words one section of code speaks. Following a word is a quoted search over
// the running code (hive-tree-reader.ts codeQuoting). Pure: nothing here reads
// a store, and no module is ever run to be read.

/** Why a tile carries a word code may key on. */
export type TileHandleKind = 'name' | 'kind' | 'slot' | 'bound'

export type TileHandle = { readonly word: string; readonly from: TileHandleKind }

/** The slots every layer has. Code keys on them everywhere, so they say
 *  nothing about one tile: the tile's own slots are the ones left. */
const STRUCTURAL_SLOTS: ReadonlySet<string> = new Set(['name', 'children', 'cells', 'layers', 'decorations'])

/** A word short of three characters, or one a quote could break, is never
 *  followed (the reader refuses it too). */
const followable = (word: string): boolean => word.length >= 3 && !/['"`\u0000-\u001f]/.test(word)

/** Every word this tile carries that code may key on, in the order a reader
 *  wants them: the name, then decoration kinds, behaviours bound here, and
 *  the layer's own slots. Each word once, at its first reason. */
export const tileHandles = (input: {
  readonly name: string
  readonly layer?: Readonly<Record<string, unknown>> | null
  readonly decorationKinds?: readonly string[]
  readonly boundKinds?: readonly string[]
}): TileHandle[] => {
  const out: TileHandle[] = []
  const seen = new Set<string>()
  const add = (raw: unknown, from: TileHandleKind): void => {
    const word = String(raw ?? '').trim()
    const key = word.toLowerCase()
    if (!followable(word) || seen.has(key)) return
    seen.add(key)
    out.push({ word, from })
  }
  add(input.name, 'name')
  for (const kind of input.decorationKinds ?? []) add(kind, 'kind')
  for (const kind of input.boundKinds ?? []) add(kind, 'bound')
  for (const [slot, value] of Object.entries(input.layer ?? {})) {
    if (STRUCTURAL_SLOTS.has(slot)) continue
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue
    add(slot, 'slot')
  }
  return out
}

/** What one section of code says to the rest of the hive. */
export type CodeLinks = {
  /** Effects it publishes. */
  readonly emits: readonly string[]
  /** Effects it subscribes to. */
  readonly listens: readonly string[]
  /** IoC keys it asks for. */
  readonly needs: readonly string[]
  /** IoC keys it registers. */
  readonly provides: readonly string[]
}

const QUOTED = String.raw`['"\x60]([^'"\x60\s]{3,120})['"\x60]`
const EMIT_CALL = new RegExp(String.raw`\b(?:emit|emitEffect|emitTransient)\s*\(\s*` + QUOTED, 'g')
const LISTEN_CALL = new RegExp(String.raw`\b(?:on|onEffect|once|onTransient)\s*(?:<[^>()]*>)?\s*\(\s*` + QUOTED, 'g')
const REGISTER_CALL = new RegExp(String.raw`\b(?:register|publishService)\s*\(\s*` + QUOTED, 'g')
const DECLARED = /\b(emits|listens)\s*(?::[^=\n]*)?=\s*\[([^\]]*)\]/g
const STRING = /['"`]([^'"`\s]{3,120})['"`]/g
const IOC_KEY = /['"`](@[A-Za-z0-9.-]+\/[A-Za-z0-9_.$-]+)['"`]/g

/** An effect name is a word with a colon in it: `tile:action`, `doctrine:open`. */
const isEffect = (word: string): boolean => /^[a-z][\w.-]*:[\w:.-]+$/i.test(word)
const isIocKey = (word: string): boolean => /^@[A-Za-z0-9.-]+\/[A-Za-z0-9_.$-]+$/.test(word)

const sorted = (set: Set<string>): string[] => [...set].sort((a, b) => a.localeCompare(b))

/** The effects and IoC keys a piece of code speaks, read from its text. Crude
 *  on purpose — patterns over the text, comments included — because a word
 *  listed here is only an offer to follow it, never a claim the code runs it. */
export const codeLinks = (text: string): CodeLinks => {
  const emits = new Set<string>()
  const listens = new Set<string>()
  const provides = new Set<string>()
  const needs = new Set<string>()
  for (const match of text.matchAll(EMIT_CALL)) if (isEffect(match[1])) emits.add(match[1])
  for (const match of text.matchAll(LISTEN_CALL)) if (isEffect(match[1])) listens.add(match[1])
  for (const match of text.matchAll(DECLARED)) {
    const into = match[1] === 'emits' ? emits : listens
    for (const word of match[2].matchAll(STRING)) if (isEffect(word[1])) into.add(word[1])
  }
  for (const match of text.matchAll(REGISTER_CALL)) if (isIocKey(match[1])) provides.add(match[1])
  for (const match of text.matchAll(IOC_KEY)) if (!provides.has(match[1])) needs.add(match[1])
  return { emits: sorted(emits), listens: sorted(listens), needs: sorted(needs), provides: sorted(provides) }
}

/** How one line that quotes a word uses it. */
export type QuoteUse = 'emits' | 'listens' | 'provides' | 'names'

/** What a line quoting `word` does with it: publishes it, listens for it,
 *  registers it, or only names it (asks for it, compares with it, keys on it). */
export const quoteUse = (line: string, word: string): QuoteUse => {
  const links = codeLinks(line)
  if (links.provides.includes(word)) return 'provides'
  if (links.emits.includes(word)) return 'emits'
  if (links.listens.includes(word)) return 'listens'
  return 'names'
}

/** The line, counted from one, that a character offset falls on. */
export const lineAt = (text: string, offset: number): number => {
  let line = 1
  const end = Math.max(0, Math.min(text.length, Math.floor(offset)))
  for (let index = 0; index < end; index++) if (text.charCodeAt(index) === 10) line++
  return line
}
