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

/** One category: its name, the notes filed directly in it (note sigs, in the
 *  order they were filed), and the categories beneath it. */
export interface NoteCategory {
  readonly name: string
  readonly notes: readonly string[]
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
      const kids = depth < MAX_DEPTH && Array.isArray((node as { children?: unknown }).children)
        ? level((node as { children: unknown[] }).children, depth + 1)
        : []
      const twin = out.findIndex(c => categoryKey(c.name) === categoryKey(name))
      if (twin >= 0) {
        const held = out[twin]
        out[twin] = { name: held.name, notes: [...held.notes, ...notes], children: [...held.children, ...kids] }
      } else {
        out.push({ name, notes, children: kids })
      }
    }
    return out
  }
  return { categories: level(list, 1) }
}

/** The canonical bytes of a document — keys in a fixed order, so the same
 *  tree always signs the same. */
export function categoryDocJson(doc: CategoryDoc): string {
  const node = (c: NoteCategory): unknown => ({ children: c.children.map(node), name: c.name, notes: [...c.notes] })
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
