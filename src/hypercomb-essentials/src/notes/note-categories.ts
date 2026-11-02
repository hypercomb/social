// notes/note-categories.ts
//
// THE CATEGORY TREE OF A TILE'S NOTES — the pure half (the service is
// note-categories.service.ts). A shared notes ledger grows a hierarchy: an AI
// names the categories, Jev files each note into the one that fits, and the
// participant can do either by hand. The desk shows the tree to the left of
// the notes; a label takes you to that branch.
//
// THE NOTES ARE NEVER TOUCHED. A note keeps its bytes, its signature and its
// place on the tile's list; filing it is a mark it wears in this document —
// the category names the note, the note does not move under a parent. So
// equal notes stay one note, and a peer's tree files the very same atoms.
//
// One document per tile, canonical JSON, content-addressed, referenced from
// the tile's layer by the `categories` slot. The slot travels with the layer,
// so the swarm carries every participant's tree with no new wire, and a
// category held by many people counts them ("calcified by numbers").
//
// No store, no DOM, no swarm — the service and the spec share this.

import { moleculeKey } from '@hypercomb/core'

/** The participant who holds this document, when a group names them. */
export const SELF_PERSON = 'self'

/** One category: its name, the notes filed directly in it (note sigs, in the
 *  order they were filed), the participants added to it, and the categories
 *  beneath it. A note sits in one category. A participant may be in many. */
export interface NoteCategory {
  readonly name: string
  readonly notes: readonly string[]
  readonly people?: readonly string[]
  readonly children: readonly NoteCategory[]
}

/** A tile's category tree. */
export interface CategoryDoc {
  readonly categories: readonly NoteCategory[]
}

/** A category's place: its index at each level, from the top. */
export type CategoryPath = readonly number[]

/** An outline as an AI proposes it — names and nesting, no notes. */
export interface OutlineNode {
  readonly name: string
  readonly children: readonly OutlineNode[]
}

/** How deep a tree may go. Three levels read as a hierarchy; more reads as a
 *  maze on a lecture's worth of notes. */
export const MAX_DEPTH = 3
/** How many categories one level may hold. */
export const MAX_SIBLINGS = 12
const MAX_NAME = 60
const SIG = /^[0-9a-f]{64}$/

export const EMPTY_DOC: CategoryDoc = { categories: [] }

/** The folded word a category's name is — the same fold a tile name gets, so
 *  "Energy" and "energy " are one category, here and across participants. */
export const categoryKey = (name: string): string => moleculeKey(String(name ?? '').trim())

const cleanName = (name: unknown): string =>
  String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)

/** A participant id this document will keep: `self`, or a pubkey. */
const personId = (raw: unknown): string => {
  const id = String(raw ?? '').trim().toLowerCase()
  if (id === SELF_PERSON) return SELF_PERSON
  return SIG.test(id) ? id : ''
}

/** Read any value as a category document, or null. Tolerant: unknown fields
 *  are dropped, bad notes are dropped, a duplicate name on one level merges,
 *  and a note filed twice keeps its first place. */
export function readCategoryDoc(raw: unknown): CategoryDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const list = (raw as { categories?: unknown }).categories
  if (!Array.isArray(list)) return null
  const seen = new Set<string>()
  const level = (nodes: readonly unknown[], depth: number): NoteCategory[] => {
    const out: NoteCategory[] = []
    for (const node of nodes) {
      if (out.length >= MAX_SIBLINGS) break
      if (!node || typeof node !== 'object') continue
      const name = cleanName((node as { name?: unknown }).name)
      if (!name) continue
      const notes = (Array.isArray((node as { notes?: unknown }).notes) ? (node as { notes: unknown[] }).notes : [])
        .map(s => String(s ?? '').toLowerCase())
        .filter(s => SIG.test(s) && !seen.has(s) && (seen.add(s), true))
      const peopleSeen = new Set<string>()
      const people = (Array.isArray((node as { people?: unknown }).people) ? (node as { people: unknown[] }).people : [])
        .map(personId)
        .filter(id => id.length > 0 && !peopleSeen.has(id) && (peopleSeen.add(id), true))
      const kids = depth < MAX_DEPTH && Array.isArray((node as { children?: unknown }).children)
        ? level((node as { children: unknown[] }).children, depth + 1)
        : []
      const twin = out.findIndex(c => categoryKey(c.name) === categoryKey(name))
      if (twin >= 0) {
        const held = out[twin]
        const joined = [...(held.people ?? []), ...people].filter((id, i, all) => all.indexOf(id) === i)
        out[twin] = joined.length
          ? { name: held.name, notes: [...held.notes, ...notes], people: joined, children: [...held.children, ...kids] }
          : { name: held.name, notes: [...held.notes, ...notes], children: [...held.children, ...kids] }
      } else {
        out.push(people.length ? { name, notes, people, children: kids } : { name, notes, children: kids })
      }
    }
    return out
  }
  return { categories: level(list, 1) }
}

/** The canonical bytes of a document — keys in a fixed order, so the same
 *  tree always signs the same. */
export function categoryDocJson(doc: CategoryDoc): string {
  const node = (c: NoteCategory): unknown => {
    const out: { children: unknown; name: string; notes: string[]; people?: string[] } = {
      children: c.children.map(node), name: c.name, notes: [...c.notes],
    }
    if (c.people?.length) out.people = [...c.people]
    return out
  }
  return JSON.stringify({ categories: doc.categories.map(node) })
}

/** Is the tree empty? */
export const isEmptyDoc = (doc: CategoryDoc | null | undefined): boolean => !doc || doc.categories.length === 0

/** The category at a path, or null. */
export function categoryAt(doc: CategoryDoc, path: CategoryPath): NoteCategory | null {
  let level = doc.categories
  let found: NoteCategory | null = null
  for (const i of path) {
    found = level[i] ?? null
    if (!found) return null
    level = found.children
  }
  return found
}

/** Rewrite the category at `path` (a missing path changes nothing). */
function updateAt(doc: CategoryDoc, path: CategoryPath, fn: (c: NoteCategory) => NoteCategory | null): CategoryDoc {
  if (path.length === 0) return doc
  const walk = (level: readonly NoteCategory[], depth: number): NoteCategory[] => {
    const out: NoteCategory[] = []
    level.forEach((c, i) => {
      if (i !== path[depth]) { out.push(c); return }
      if (depth === path.length - 1) {
        const next = fn(c)
        if (next) out.push(next)
        return
      }
      out.push({ ...c, children: walk(c.children, depth + 1) })
    })
    return out
  }
  return { categories: walk(doc.categories, 0) }
}

/** Every note filed anywhere in the tree → the path of the category it is in. */
export function filedNotes(doc: CategoryDoc): Map<string, CategoryPath> {
  const out = new Map<string, CategoryPath>()
  const walk = (level: readonly NoteCategory[], at: number[]): void => {
    level.forEach((c, i) => {
      const path = [...at, i]
      for (const n of c.notes) if (!out.has(n)) out.set(n, path)
      walk(c.children, path)
    })
  }
  walk(doc.categories, [])
  return out
}

/** Take a note out of whichever category holds it. */
export function unfileNote(doc: CategoryDoc, noteSig: string): CategoryDoc {
  const strip = (level: readonly NoteCategory[]): NoteCategory[] =>
    level.map(c => ({ ...c, notes: c.notes.filter(n => n !== noteSig), children: strip(c.children) }))
  return { categories: strip(doc.categories) }
}

/** A category with `people` only when the list still has someone. */
const withPeople = (c: NoteCategory, people: readonly string[], children: readonly NoteCategory[]): NoteCategory =>
  people.length
    ? { name: c.name, notes: c.notes, people, children }
    : { name: c.name, notes: c.notes, children }

/** Add a participant to the category at `path`. They stay in every other
 *  group they were already in. Adding them again changes nothing. */
export function addPerson(doc: CategoryDoc, path: CategoryPath, person: string): CategoryDoc {
  const id = personId(person)
  const cat = categoryAt(doc, path)
  if (!id || !cat || (cat.people ?? []).includes(id)) return doc
  return updateAt(doc, path, c => ({ ...c, people: [...(c.people ?? []), id] }))
}

/** Take a participant out of the one category at `path`. */
export function removePerson(doc: CategoryDoc, path: CategoryPath, person: string): CategoryDoc {
  const id = personId(person)
  const cat = categoryAt(doc, path)
  if (!id || !cat || !(cat.people ?? []).includes(id)) return doc
  const people = (cat.people ?? []).filter(p => p !== id)
  return updateAt(doc, path, c => withPeople(c, people, c.children))
}

/** Take a participant out of every category. */
export function clearPerson(doc: CategoryDoc, person: string): CategoryDoc {
  const id = personId(person)
  if (!id) return doc
  const strip = (level: readonly NoteCategory[]): { level: NoteCategory[]; changed: boolean } => {
    let changed = false
    const next = level.map(c => {
      const kids = strip(c.children)
      const people = (c.people ?? []).filter(p => p !== id)
      if (!kids.changed && people.length === (c.people ?? []).length) return c
      changed = true
      return withPeople(c, people, kids.level)
    })
    return { level: changed ? next : level as NoteCategory[], changed }
  }
  const out = strip(doc.categories)
  return out.changed ? { categories: out.level } : doc
}

/** File a note in the category at `path` — out of any other first, because a
 *  note sits in one place in the hierarchy. */
export function fileNote(doc: CategoryDoc, path: CategoryPath, noteSig: string): CategoryDoc {
  const sig = String(noteSig ?? '').toLowerCase()
  if (!SIG.test(sig) || !categoryAt(doc, path)) return doc
  return updateAt(unfileNote(doc, sig), path, c => ({ ...c, notes: [...c.notes, sig] }))
}

/** Add a category under `parent` ([] = the top). A name already on that level
 *  is the same category — nothing is added, and its path is returned. */
export function addCategory(doc: CategoryDoc, parent: CategoryPath, name: string): { doc: CategoryDoc; path: CategoryPath | null } {
  const clean = cleanName(name)
  if (!clean || parent.length >= MAX_DEPTH) return { doc, path: null }
  const level = parent.length === 0 ? doc.categories : categoryAt(doc, parent)?.children
  if (!level) return { doc, path: null }
  const twin = level.findIndex(c => categoryKey(c.name) === categoryKey(clean))
  if (twin >= 0) return { doc, path: [...parent, twin] }
  if (level.length >= MAX_SIBLINGS) return { doc, path: null }
  const made: NoteCategory = { name: clean, notes: [], children: [] }
  if (parent.length === 0) return { doc: { categories: [...doc.categories, made] }, path: [doc.categories.length] }
  return { doc: updateAt(doc, parent, c => ({ ...c, children: [...c.children, made] })), path: [...parent, level.length] }
}

/** Add each name under the last, starting at `parent`. A name already on
 *  that level is that category. When a level is full, or the tree is as deep
 *  as it goes, the rest of the names are left off and the path is the last
 *  category that worked. */
export function placeNames(doc: CategoryDoc, parent: CategoryPath, names: readonly string[]): { doc: CategoryDoc; path: CategoryPath } {
  let next = doc
  let path: CategoryPath = [...parent]
  for (const name of names) {
    const made = addCategory(next, path, name)
    next = made.doc
    if (!made.path) break
    path = made.path
  }
  return { doc: next, path }
}

/** One line of the note-tree command. `/` separates categories. A leading
 *  `/` starts at the top, and a line that is only `/` is the top itself.
 *  A line that ends on `/` steps into that category and files nothing.
 *  Anything else files its last segment as a note. `//` is a slash in the
 *  text, so a line that ends in `//` is a note, not a step. */
export type PlaceLine = {
  readonly absolute: boolean
  readonly root: boolean
  readonly categories: readonly string[]
  readonly note: string | null
}

export function readPlaceLine(raw: string): PlaceLine | null {
  const line = String(raw ?? '').trim()
  if (!line) return null
  if (line === '/') return { absolute: true, root: true, categories: [], note: null }
  let absolute = false
  let i = 0
  if (line.startsWith('/') && !line.startsWith('//')) {
    absolute = true
    i = 1
  }
  const parts: string[] = []
  let current = ''
  let ended = false
  while (i < line.length) {
    if (line[i] === '/' && line[i + 1] === '/') {
      current += '/'
      i += 2
      ended = false
      continue
    }
    if (line[i] === '/') {
      parts.push(current.trim())
      current = ''
      ended = true
      i += 1
      continue
    }
    current += line[i]
    ended = false
    i += 1
  }
  if (!ended) parts.push(current.trim())
  const names = parts.filter(name => name.length > 0)
  if (!names.length) return absolute ? { absolute: true, root: true, categories: [], note: null } : null
  if (ended) return { absolute, root: false, categories: names, note: null }
  const note = names[names.length - 1]
  const categories = names.slice(0, -1)
  return { absolute, root: absolute && categories.length === 0, categories, note }
}

/** The same line, finished as a place: what was the note is the last category. */
export function placeToGo(line: PlaceLine): PlaceLine {
  if (line.note == null) return line
  return { absolute: line.absolute, root: false, categories: [...line.categories, line.note], note: null }
}

/** Remove the category at `path`. Its notes — and those of everything under
 *  it — simply stop being filed; no note is lost. */
export function removeCategory(doc: CategoryDoc, path: CategoryPath): CategoryDoc {
  return updateAt(doc, path, () => null)
}

/** Rename the category at `path`. A name that collides with a sibling merges
 *  into it on the next read, so this refuses one instead. */
export function renameCategory(doc: CategoryDoc, path: CategoryPath, name: string): CategoryDoc {
  const clean = cleanName(name)
  const parent = path.slice(0, -1)
  const level = parent.length === 0 ? doc.categories : categoryAt(doc, parent)?.children ?? []
  if (!clean || level.some((c, i) => i !== path[path.length - 1] && categoryKey(c.name) === categoryKey(clean))) return doc
  return updateAt(doc, path, c => ({ ...c, name: clean }))
}

/** Lay an outline onto the tree: every name not already there is added where
 *  the outline puts it; what is already there, and every note already filed,
 *  stays exactly as it was. An AI's suggestion can only ever ADD structure. */
export function mergeOutline(doc: CategoryDoc, outline: readonly OutlineNode[]): CategoryDoc {
  let next = doc
  const lay = (nodes: readonly OutlineNode[], parent: CategoryPath): void => {
    for (const node of nodes) {
      const made = addCategory(next, parent, node.name)
      next = made.doc
      if (made.path && node.children.length) lay(node.children, made.path)
    }
  }
  lay(outline, [])
  return next
}

/** One group an agent can look at: a category, or the notes no category holds.
 *  `notes` are the words filed directly in that category (a child is its own
 *  group), so a walk never reads the same line twice. */
export type ExploreGroup = {
  readonly key: string
  readonly name: string
  readonly notes: readonly string[]
}

/** The groups of a tile, in the order the tree paints them, with Unsorted
 *  last when anything is still unfiled. `notes` are `{ id, text }` as the
 *  desk holds them; a note the tree names that is not in that list is skipped. */
export function exploreGroups(
  doc: CategoryDoc,
  notes: readonly { id: string; text: string }[],
): ExploreGroup[] {
  const byId = new Map(notes.map(n => [n.id, n.text]))
  const filed = filedNotes(doc)
  const out: ExploreGroup[] = []
  const walk = (level: readonly NoteCategory[], at: number[]): void => {
    level.forEach((c, i) => {
      const path = [...at, i]
      const words = c.notes.map(id => (byId.get(id) ?? '').trim()).filter(Boolean)
      out.push({ key: path.join('.'), name: c.name, notes: words })
      walk(c.children, path)
    })
  }
  walk(doc.categories, [])
  const loose = notes.filter(n => !filed.has(n.id)).map(n => n.text.trim()).filter(Boolean)
  if (loose.length) out.push({ key: 'unsorted', name: 'Unsorted', notes: loose })
  return out
}

/** Every category as one row of a flat list, depth-first — the options Jev
 *  chooses among, and the order the tree paints. */
export function flattenCategories(doc: CategoryDoc): { path: CategoryPath; name: string; label: string; depth: number }[] {
  const out: { path: CategoryPath; name: string; label: string; depth: number }[] = []
  const walk = (level: readonly NoteCategory[], at: number[], trail: string[]): void => {
    level.forEach((c, i) => {
      const path = [...at, i]
      const names = [...trail, c.name]
      out.push({ path, name: c.name, label: names.join(' › '), depth: path.length - 1 })
      walk(c.children, path, names)
    })
  }
  walk(doc.categories, [], [])
  return out
}

/** How many notes sit in a category and everything beneath it, counting only
 *  notes that are still on the tile (`present`). */
export function countUnder(c: NoteCategory, present: ReadonlySet<string>): number {
  return c.notes.filter(n => present.has(n)).length + c.children.reduce((sum, k) => sum + countUnder(k, present), 0)
}

/** Read an AI's answer as an outline. Takes a JSON array (of names, or of
 *  `{ name, children }`), a JSON object with a `categories` array, or an
 *  indented list ("- Energy" / "  - Krebs cycle"). Anything else is no
 *  outline. Fenced code blocks are unwrapped first. */
export function parseOutline(text: string): OutlineNode[] {
  const body = String(text ?? '').replace(/```[a-z]*\n?/gi, '').trim()
  if (!body) return []
  const fromJson = (value: unknown, depth: number): OutlineNode[] => {
    if (!Array.isArray(value) || depth > MAX_DEPTH) return []
    const out: OutlineNode[] = []
    for (const v of value) {
      if (out.length >= MAX_SIBLINGS) break
      if (typeof v === 'string') { const name = cleanName(v); if (name) out.push({ name, children: [] }); continue }
      if (!v || typeof v !== 'object') continue
      const name = cleanName((v as { name?: unknown; title?: unknown }).name ?? (v as { title?: unknown }).title)
      if (!name) continue
      out.push({ name, children: fromJson((v as { children?: unknown }).children, depth + 1) })
    }
    return out
  }
  const start = body.search(/[[{]/)
  if (start >= 0) {
    try {
      const parsed = JSON.parse(body.slice(start, Math.max(body.lastIndexOf(']'), body.lastIndexOf('}')) + 1))
      const list = Array.isArray(parsed) ? parsed : (parsed as { categories?: unknown })?.categories
      const nodes = fromJson(list, 1)
      if (nodes.length) return nodes
    } catch { /* not JSON — try the indented list */ }
  }
  type Open = { name: string; children: Open[]; indent: number }
  const roots: Open[] = []
  const stack: Open[] = []
  for (const raw of body.split(/\r?\n/)) {
    const m = /^(\s*)(?:[-*•]|\d+[.)])\s+(.+)$/.exec(raw)
    if (!m) continue
    const indent = m[1].replace(/\t/g, '  ').length
    const name = cleanName(m[2].replace(/[*_`]/g, ''))
    if (!name) continue
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const node: Open = { name, children: [], indent }
    if (stack.length >= MAX_DEPTH) continue
    ;(stack.length ? stack[stack.length - 1].children : roots).push(node)
    stack.push(node)
  }
  const close = (nodes: Open[]): OutlineNode[] =>
    nodes.slice(0, MAX_SIBLINGS).map(n => ({ name: n.name, children: close(n.children) }))
  return close(roots)
}

/** The room's categories on one level, by folded name: how many participants
 *  hold each, and whether this participant does. Pure; the swarm hands in
 *  each peer's tree. Sorted most-held first, then by name — the order that
 *  lets an agreed structure settle out of many people's guesses. */
export function roomCategories(
  mine: CategoryDoc,
  peers: readonly { pubkey: string; doc: CategoryDoc }[],
  path: readonly string[] = [],
): { key: string; name: string; holders: number; mine: boolean }[] {
  const levelOf = (doc: CategoryDoc): readonly NoteCategory[] | null => {
    let level = doc.categories
    for (const key of path) {
      const hit = level.find(c => categoryKey(c.name) === key)
      if (!hit) return null
      level = hit.children
    }
    return level
  }
  const out = new Map<string, { key: string; name: string; holders: Set<string>; mine: boolean }>()
  const take = (who: string, doc: CategoryDoc, isMine: boolean): void => {
    for (const c of levelOf(doc) ?? []) {
      const key = categoryKey(c.name)
      const row = out.get(key) ?? { key, name: c.name, holders: new Set<string>(), mine: false }
      row.holders.add(who)
      if (isMine) { row.mine = true; row.name = c.name }
      out.set(key, row)
    }
  }
  take('', mine, true)
  for (const p of peers) take(p.pubkey, p.doc, false)
  return [...out.values()]
    .map(r => ({ key: r.key, name: r.name, holders: r.holders.size, mine: r.mine }))
    .sort((a, b) => b.holders - a.holders || a.name.localeCompare(b.name))
}

// ── settling by count (documentation/swarm-pools.md, step seven) ──────────
//
// "calcified by numbers" (jwize, 2026-10-13). A category is SETTLED in a room
// when enough of the people there hold one of its name at that place: at
// least SETTLE_MIN_HOLDERS of them, and at least SETTLE_SHARE of everyone
// present. A settled category is the room's agreed structure — shown as such,
// and offered whole to anyone who does not hold it yet. Nothing is moved into
// anyone's tree by the count; taking the room's structure is still a tap.

export const SETTLE_MIN_HOLDERS = 2
export const SETTLE_SHARE = 0.5

/** How many holders settle a category among `people` present (you included). */
export function settleThreshold(people: number): number {
  return Math.max(SETTLE_MIN_HOLDERS, Math.ceil(Math.max(1, people) * SETTLE_SHARE))
}

/** The room's settled structure: every category, at every level, held by
 *  enough people — nested as the room holds it. Pure. */
export function settledOutline(
  mine: CategoryDoc,
  peers: readonly { pubkey: string; doc: CategoryDoc }[],
  people: number,
  path: readonly string[] = [],
): OutlineNode[] {
  const needed = settleThreshold(people)
  return roomCategories(mine, peers, path)
    .filter(r => r.holders >= needed)
    .map(r => ({ name: r.name, children: settledOutline(mine, peers, people, [...path, r.key]) }))
}
