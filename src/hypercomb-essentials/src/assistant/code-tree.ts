// assistant/code-tree.ts
//
// THE CODE AS A TREE OF FILES (jwize, 2026-11-15: "Let's have a normal tree
// view with actual typescript files"; 2026-11-16: "a third icon at the top
// of this and have the logical code view", "then we can read code in the
// main window as well to explore the structure").
//
// Nothing here keeps a list of the code. The hive's running modules are
// already named as paths (`@hypercomb/essentials/assistant/chat-thread`), and
// a module that bundles many source files marks each with a header line that
// carries its path (`// src/core/effect-bus.ts`, core module-sections.ts).
// These functions fold those names and paths into folders and files. The
// view (code-tree.view.ts) draws them and opens a file in the chat's main
// pane.
//
// Pure: no store, no DOM.

import { PLATFORM_SOURCE } from './tile-holds.js'

/** A running module by its name and the signature that opens it. `of` says
 *  what the hive runs it as: a behaviour (a bee) or code behaviours import. */
export type CodeEntry = { readonly name: string; readonly sig: string; readonly of?: 'bee' | 'dependency' }

/** The two folders that are not paths: behaviours go by a spoken name
 *  (`Action Card`), and some modules carry no name but their signature. */
export const BEHAVIOURS_PATH = 'group:behaviours'
export const UNNAMED_PATH = 'group:unnamed'
export type TreeWords = { readonly behaviours: string; readonly unnamed: string }
const WORDS: TreeWords = { behaviours: 'Behaviours', unnamed: 'Unnamed' }
const HEX_NAME = /^[0-9a-f]{12,64}$/i

/** What pressing a file opens. */
export type CodeOpens =
  /** A whole running module. */
  | { readonly kind: 'module'; readonly sig: string; readonly name: string }
  /** One source file inside a module that bundles many. */
  | { readonly kind: 'section'; readonly sig: string; readonly path: string }

/** A folder or a file. A folder that `bundle`s is filled on demand from the
 *  source files that module ships (the platform's own sources: thousands of
 *  lines each, read only when unfolded). */
export type CodeNode = {
  /** What the row says: one path segment, or several a lone chain was folded into. */
  readonly label: string
  /** The whole path from the root: the node's identity in the tree. */
  readonly path: string
  readonly children: readonly CodeNode[]
  readonly opens?: CodeOpens
  readonly bundle?: CodeEntry
}

type Building = { label: string; path: string; children: Map<string, Building>; opens?: CodeOpens; bundle?: CodeEntry }

const byName = (a: CodeNode, b: CodeNode): number => {
  // Folders first, then files, each by name: the order of a file explorer.
  const aFolder = a.children.length > 0 || !!a.bundle
  const bFolder = b.children.length > 0 || !!b.bundle
  if (aFolder !== bFolder) return aFolder ? -1 : 1
  return a.label.localeCompare(b.label)
}

/** A folder with one folder in it and nothing else reads as one row
 *  (`@hypercomb/essentials`), as an editor's compact folders do. */
const settle = (node: Building): CodeNode => {
  let label = node.label
  let at = node
  while (!at.opens && !at.bundle && at.children.size === 1) {
    const only = [...at.children.values()][0]!
    if (only.opens && !only.children.size) break
    label = `${label}/${only.label}`
    at = only
  }
  const children = [...at.children.values()].map(settle)
  // A module that is also a folder (a name others are under) is the first
  // file inside it, under its own name.
  if (at.opens && children.length) {
    children.push({ label: at.label, path: `${at.path}/`, children: [], opens: at.opens })
    return { label, path: at.path, children: children.sort(byName) }
  }
  return {
    label, path: at.path, children: children.sort(byName),
    ...(at.opens ? { opens: at.opens } : {}), ...(at.bundle ? { bundle: at.bundle } : {}),
  }
}

const grow = (root: Building, segments: readonly string[]): Building => {
  let at = root
  let path = root.path
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment
    let next = at.children.get(segment)
    if (!next) { next = { label: segment, path, children: new Map() }; at.children.set(segment, next) }
    at = next
  }
  return at
}

/**
 * Every running module as a tree: each `/` in a name is a folder. A platform
 * source (`@hypercomb/source/core`) is a folder that is filled from the files
 * it ships when it is unfolded.
 *
 * Two kinds of name are not paths, and each gets one folder so the tree
 * stays a tree (seen on business-card.jwize.com, 2026-11-16: some three
 * hundred behaviours and bare signatures stood loose at the top). The
 * behaviours, which go by a spoken name, come first; the modules named only
 * by their signature come last.
 */
export const moduleTree = (entries: readonly CodeEntry[], words: TreeWords = WORDS): CodeNode[] => {
  const root: Building = { label: '', path: '', children: new Map() }
  const behaviours: CodeNode[] = []
  const unnamed: CodeNode[] = []
  for (const entry of entries) {
    const name = entry.name.trim()
    if (!name) continue
    const opens: CodeOpens = { kind: 'module', sig: entry.sig, name }
    if (HEX_NAME.test(name)) { unnamed.push({ label: name.slice(0, 12), path: `${UNNAMED_PATH}/${entry.sig}`, children: [], opens }); continue }
    if (entry.of === 'bee' && !name.includes('/')) { behaviours.push({ label: name, path: `${BEHAVIOURS_PATH}/${entry.sig}`, children: [], opens }); continue }
    const segments = name.split('/').map(segment => segment.trim()).filter(Boolean)
    if (!segments.length) continue
    const node = grow(root, segments)
    if (name.startsWith(PLATFORM_SOURCE)) node.bundle = entry
    else node.opens = opens
  }
  const byLabel = (a: CodeNode, b: CodeNode): number => a.label.localeCompare(b.label)
  return [
    ...(behaviours.length ? [{ label: words.behaviours, path: BEHAVIOURS_PATH, children: behaviours.sort(byLabel) }] : []),
    ...[...root.children.values()].map(settle).sort(byName),
    ...(unnamed.length ? [{ label: words.unnamed, path: UNNAMED_PATH, children: unnamed.sort(byLabel) }] : []),
  ]
}

/**
 * The source files one module ships, as a tree under `under` (the path of
 * the folder being filled). The leading `src/` every path shares is dropped.
 */
export const sectionTree = (sig: string, paths: readonly string[], under: string): CodeNode[] => {
  const root: Building = { label: '', path: under, children: new Map() }
  for (const path of paths) {
    const segments = path.split('/').map(segment => segment.trim()).filter(Boolean)
    if (segments[0] === 'src' && segments.length > 1) segments.shift()
    if (!segments.length) continue
    grow(root, segments).opens = { kind: 'section', sig, path }
  }
  return [...root.children.values()].map(settle).sort(byName)
}

/** The modules whose name holds every word, by name. What the tree shows
 *  while something is typed in the search. */
export const findModules = (entries: readonly CodeEntry[], query: string, max = 200): CodeEntry[] => {
  const words = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return entries
    .filter(entry => { const name = entry.name.toLowerCase(); return words.every(word => name.includes(word)) })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, Math.max(1, max))
}
