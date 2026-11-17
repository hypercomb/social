// assistant/code-tree.view.ts
//
// THE CODE TREE, IN THE CHAT'S LEFT COLUMN (jwize, 2026-11-16: "can we
// please have a third icon at the top of this and have the logical code
// view", "then we can read code in the main window as well to explore the
// structure").
//
// Two parts, one under the other:
//
//   • WHAT THE CHAT IS ABOUT: the tile the conversation is on, the tiles
//     inside it, and the files each holds (a page in parts keeps its script
//     and stylesheet as files on tiles).
//   • THE RUNNING CODE: every module the hive runs, as folders and files
//     (code-tree.ts), with the platform's own sources unfolding into the
//     source files they ship.
//
// Pressing a file opens it in the chat's MAIN PANE (chat-code.ts
// openChatCode), where the inspect view draws it with line numbers and what
// it emits, listens to and registers. The tree only finds; the pane reads.
//
// A dependency: it exports the view and registers nothing. The chat's rail
// (agent-tiles-rail.ts) holds one and shows it behind its third icon.

import { EffectBus, I18N_IOC_KEY, sectionIndex, type I18nProvider } from '@hypercomb/core'
import { openChatCode } from './chat-code.js'
import { BEHAVIOURS_PATH, UNNAMED_PATH, findModules, moduleTree, sectionTree, type CodeEntry, type CodeNode, type CodeOpens } from './code-tree.js'
import { HIVE_TREE_READER_IOC_KEY } from './hive-tree-reader.js'
import type { InspectFrame } from './inspect-window.view.js'
import { sizeWords } from './tile-holds.js'

const STYLE_ID = 'hc-code-tree-styles'
/** Rows one folder draws before it says how many more there are. */
const FOLDER_ROWS = 400
/** How long after a change lands before the tiles in the tree are read again. */
const REREAD_MS = 400

type Reader = {
  codeIndex?(): Promise<readonly CodeEntry[]>
  moduleText?(sig: string): Promise<{ readonly name: string; readonly text: string } | undefined>
  readNode?(segments: readonly string[], options?: { withContent?: boolean }): Promise<{
    readonly ok: boolean
    readonly children?: readonly { readonly name: string }[]
    readonly files?: readonly { readonly name: string; readonly sig: string; readonly size: number }[]
  }>
}

type TileHolds = {
  readonly tiles: readonly string[]
  readonly files: readonly { readonly name: string; readonly sig: string; readonly size: number }[]
}

const ioc = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const glyph = (name: string, className = 'hc-code-glyph'): HTMLSpanElement => {
  const span = el('span', `mat-sym ${className}`, name)
  span.setAttribute('aria-hidden', 'true')
  return span
}

const tileKey = (segments: readonly string[]): string => `tile:/${segments.join('/')}`

/** A row's left edge for its depth, in rem, to two places (0.4 + 0.8 a level). */
const indent = (depth: number, more = 0): number => Math.round((0.4 + depth * 0.8 + more) * 100) / 100

export class CodeTreeView {
  readonly element: HTMLDivElement
  #target: string[] = []
  #targeted = false
  #query = ''
  #entries: readonly CodeEntry[] | null = null
  #tree: readonly CodeNode[] = []
  #failed = false
  /** Folders that are unfolded, by path. The tile in hand starts unfolded. */
  readonly #open = new Set<string>()
  /** What a tile holds, once read. */
  readonly #tiles = new Map<string, TileHolds | 'reading'>()
  /** The source files a bundle ships, once read. */
  readonly #bundles = new Map<string, readonly CodeNode[] | 'reading'>()
  /** The row last opened in the main pane. */
  #shown = ''
  #loading = false
  #reread = 0
  readonly #offWrote: () => void

  constructor() {
    ensureStyles()
    this.element = el('div', 'hc-code-tree')
    this.element.setAttribute('role', 'tree')
    // A file written on a tile (the chat's own work) shows in the tree: the
    // tiles already read are read again, quietly, a moment after a change.
    this.#offWrote = EffectBus.on('history:marker-wrote', () => {
      if (!this.#tiles.size || !this.element.isConnected) return
      clearTimeout(this.#reread)
      this.#reread = setTimeout(() => { void this.#rereadTiles() }, REREAD_MS) as unknown as number
    })
  }

  dispose(): void {
    clearTimeout(this.#reread)
    this.#offWrote()
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    let said = fallback
    try {
      const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
      if (typeof value === 'string' && value && value !== key) said = value
    } catch { /* the fallback */ }
    return said.replace(/\{(\w+)\}/g, (all, name: string) => params && name in params ? String(params[name]) : all)
  }

  /** The tile the chat is about: its part of the tree follows it. */
  setTarget(segments: readonly string[]): void {
    const next = segments.map(segment => String(segment ?? '').trim()).filter(Boolean)
    // Only a NEW target unfolds itself: one the participant folded stays folded.
    if (this.#targeted && next.join('/') === this.#target.join('/')) return
    this.#targeted = true
    this.#target = next
    this.#open.add(tileKey(next))
    this.paint()
  }

  /** What is typed in the rail's search: the modules whose name holds it. */
  setQuery(query: string): void {
    const next = String(query ?? '').trim()
    if (next === this.#query) return
    this.#query = next
    this.paint()
  }

  /** Read the names of the running code, once. */
  async load(): Promise<void> {
    if (this.#entries || this.#loading) return
    this.#loading = true
    const reader = ioc<Reader>(HIVE_TREE_READER_IOC_KEY)
    try {
      const entries = await reader?.codeIndex?.()
      this.#entries = entries ?? []
      this.#failed = !entries
      this.#tree = moduleTree(this.#entries, {
        behaviours: this.#t('code-tree.behaviours', 'Behaviours'),
        unnamed: this.#t('code-tree.unnamed', 'Unnamed'),
      })
      // The folders that are paths start unfolded one level: one row is not
      // a tree. The behaviours (hundreds) and the unnamed stay folded.
      for (const node of this.#tree) if (node.path !== BEHAVIOURS_PATH && node.path !== UNNAMED_PATH) this.#open.add(node.path)
    } catch { this.#failed = true; this.#entries = [] }
    this.#loading = false
    this.paint()
  }

  /** Read again every tile already read, and repaint only if one changed.
   *  What was read stays on screen meanwhile: no row blinks. */
  async #rereadTiles(): Promise<void> {
    let changed = false
    for (const [key, held] of [...this.#tiles]) {
      if (held === 'reading') continue
      const fresh = await this.#holdsOf(key.slice('tile:/'.length).split('/').filter(Boolean))
      if (JSON.stringify(fresh) === JSON.stringify(held)) continue
      this.#tiles.set(key, fresh)
      changed = true
    }
    if (changed) this.paint()
  }

  paint(): void {
    const root = this.element
    const kept = root.scrollTop
    root.replaceChildren()
    if (!this.#entries && !this.#loading) void this.load()

    if (this.#query) {
      root.append(this.#head(this.#t('code-tree.found', 'Code named “{query}”', { query: this.#query })))
      const found = findModules(this.#entries ?? [], this.#query)
      if (!found.length) root.append(el('div', 'hc-code-note', this.#entries ? this.#t('code-tree.none', 'No running code has that in its name.') : this.#t('code-tree.reading', 'Reading…')))
      for (const entry of found) {
        root.append(this.#file(0, entry.name, 'code', `module:${entry.sig}`, { kind: 'section', sig: entry.sig, name: entry.name }))
      }
      root.scrollTop = kept
      return
    }

    // What the chat is about.
    root.append(this.#head(this.#t('code-tree.about', 'What this chat is about')))
    this.#tileRows(root, this.#target, 0)

    // The running code.
    root.append(this.#head(this.#t('code-tree.running', 'The running code')))
    if (!this.#entries) root.append(el('div', 'hc-code-note', this.#t('code-tree.reading', 'Reading…')))
    else if (this.#failed || !this.#tree.length) root.append(el('div', 'hc-code-note', this.#t('code-tree.unavailable', 'The running code cannot be listed here.')))
    else for (const node of this.#tree) this.#nodeRows(root, node, 0)
    root.scrollTop = kept
  }

  #head(text: string): HTMLElement {
    return el('div', 'hc-code-head', text)
  }

  // ── what the chat is about ───────────────────────────────

  #tileRows(into: HTMLElement, segments: readonly string[], depth: number): void {
    const key = tileKey(segments)
    const unfolded = this.#open.has(key)
    const name = segments.length ? segments[segments.length - 1]! : this.#t('code-tree.hive', 'The hive')
    const row = this.#folder(depth, name, unfolded, key, () => this.#toggle(key))
    // The tile itself: what it holds and the code that runs it.
    const look = el('button', 'hc-code-look')
    look.type = 'button'
    look.title = this.#t('code-tree.tile', 'What this tile holds, and the code that runs it')
    look.setAttribute('aria-label', look.title)
    look.append(glyph('code'))
    look.addEventListener('click', event => {
      event.stopPropagation()
      this.#show(key, { kind: 'tile', segments: [...segments] })
    })
    row.append(look)
    into.append(row)
    if (!unfolded) return

    const holds = this.#tiles.get(key)
    if (!holds) { void this.#readTile(segments); into.append(this.#note(depth + 1, this.#t('code-tree.reading', 'Reading…'))); return }
    if (holds === 'reading') { into.append(this.#note(depth + 1, this.#t('code-tree.reading', 'Reading…'))); return }
    if (!holds.tiles.length && !holds.files.length) {
      into.append(this.#note(depth + 1, this.#t('code-tree.tile-empty', 'No files or tiles here.')))
      return
    }
    for (const tile of holds.tiles.slice(0, FOLDER_ROWS)) this.#tileRows(into, [...segments, tile], depth + 1)
    for (const file of holds.files.slice(0, FOLDER_ROWS)) {
      into.append(this.#file(depth + 1, file.name, 'description', `${key}#${file.name}`,
        { kind: 'resource', sig: file.sig, name: file.name, file: { route: [...segments], name: file.name } }, sizeWords(file.size)))
    }
  }

  async #readTile(segments: readonly string[]): Promise<void> {
    const key = tileKey(segments)
    this.#tiles.set(key, 'reading')
    this.#tiles.set(key, await this.#holdsOf(segments))
    this.paint()
  }

  async #holdsOf(segments: readonly string[]): Promise<TileHolds> {
    let holds: TileHolds = { tiles: [], files: [] }
    try {
      // With its content: the files a tile holds are part of what it holds
      // (the inspect view reads a tile the same way).
      const node = await ioc<Reader>(HIVE_TREE_READER_IOC_KEY)?.readNode?.(segments, { withContent: true })
      if (node?.ok) {
        // The newest file of each name: a file written twice is one file.
        const files = new Map<string, { name: string; sig: string; size: number }>()
        for (const file of node.files ?? []) files.set(file.name, file)
        holds = {
          tiles: (node.children ?? []).map(child => child.name).sort((a, b) => a.localeCompare(b)),
          files: [...files.values()].sort((a, b) => a.name.localeCompare(b.name)),
        }
      }
    } catch { /* nothing readable there: an empty folder */ }
    return holds
  }

  // ── the running code ─────────────────────────────────────

  #nodeRows(into: HTMLElement, node: CodeNode, depth: number): void {
    if (node.opens && !node.children.length && !node.bundle) {
      into.append(this.#file(depth, node.label, 'code', node.path, this.#frameOf(node.opens)))
      return
    }
    const unfolded = this.#open.has(node.path)
    into.append(this.#folder(depth, node.label, unfolded, node.path, () => this.#toggle(node.path)))
    if (!unfolded) return
    let children = node.children
    if (node.bundle) {
      const filled = this.#bundles.get(node.path)
      if (!filled) { void this.#readBundle(node); into.append(this.#note(depth + 1, this.#t('code-tree.reading', 'Reading…'))); return }
      if (filled === 'reading') { into.append(this.#note(depth + 1, this.#t('code-tree.reading', 'Reading…'))); return }
      children = filled
      if (!children.length) {
        // Not split into files: the module is read whole.
        into.append(this.#file(depth + 1, node.label, 'code', `${node.path}/`, { kind: 'section', sig: node.bundle.sig, name: node.bundle.name }))
        return
      }
    }
    for (const child of children.slice(0, FOLDER_ROWS)) this.#nodeRows(into, child, depth + 1)
    if (children.length > FOLDER_ROWS) {
      into.append(this.#note(depth + 1, this.#t('code-tree.more', '{count} more: type in the search to find one.', { count: children.length - FOLDER_ROWS })))
    }
  }

  async #readBundle(node: CodeNode): Promise<void> {
    if (!node.bundle) return
    this.#bundles.set(node.path, 'reading')
    let children: readonly CodeNode[] = []
    try {
      const module = await ioc<Reader>(HIVE_TREE_READER_IOC_KEY)?.moduleText?.(node.bundle.sig)
      if (module) children = sectionTree(node.bundle.sig, sectionIndex(module.text).map(section => section.path), node.path)
    } catch { /* read whole, below */ }
    this.#bundles.set(node.path, children)
    this.paint()
  }

  #frameOf(opens: CodeOpens): InspectFrame {
    return opens.kind === 'module'
      ? { kind: 'section', sig: opens.sig, name: opens.name }
      : { kind: 'section', sig: opens.sig, section: opens.path }
  }

  // ── rows ─────────────────────────────────────────────────

  #toggle(path: string): void {
    if (this.#open.has(path)) this.#open.delete(path)
    else this.#open.add(path)
    this.paint()
  }

  #show(path: string, frame: InspectFrame): void {
    this.#shown = path
    void openChatCode(frame)
    this.paint()
  }

  /** A row is not a button: a tile's row holds one (its own code view), and
   *  a button may not hold another. It is pressed like one all the same. */
  #row(depth: number, className: string): HTMLDivElement {
    const row = el('div', `hc-code-row ${className}`)
    row.setAttribute('role', 'treeitem')
    row.tabIndex = 0
    row.style.paddingLeft = `${indent(depth)}rem`
    row.addEventListener('keydown', event => {
      if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      row.click()
    })
    return row
  }

  #folder(depth: number, label: string, unfolded: boolean, path: string, press: () => void): HTMLDivElement {
    const row = this.#row(depth, 'hc-code-folder')
    row.setAttribute('aria-expanded', String(unfolded))
    if (this.#shown === path) row.classList.add('shown')
    row.append(glyph(unfolded ? 'expand_more' : 'chevron_right', 'hc-code-chevron'), glyph(unfolded ? 'folder_open' : 'folder'), el('span', 'hc-code-name', label))
    row.title = label
    row.addEventListener('click', press)
    return row
  }

  #file(depth: number, label: string, icon: string, path: string, frame: InspectFrame, tail = ''): HTMLDivElement {
    const row = this.#row(depth, 'hc-code-file')
    if (this.#shown === path) row.classList.add('shown')
    row.append(el('span', 'hc-code-chevron'), glyph(icon), el('span', 'hc-code-name', label))
    if (tail) row.append(el('span', 'hc-code-tail', tail))
    row.title = label
    row.addEventListener('click', () => this.#show(path, frame))
    return row
  }

  #note(depth: number, text: string): HTMLElement {
    const note = el('div', 'hc-code-note', text)
    note.style.paddingLeft = `${indent(depth, 1.1)}rem`
    return note
  }
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.hc-code-tree,.hc-code-tree *{box-sizing:border-box;}
.hc-code-tree{display:flex;flex-direction:column;padding:0.25rem 0 0.75rem;
  font-family:var(--hc-mono,ui-monospace,monospace);font-size:0.74rem;line-height:1.5;color:var(--hc-window-ink, #d7dbe2);}
.hc-code-head{padding:0.6rem 0.6rem 0.25rem;font-size:0.62rem;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;
  color:var(--hc-window-ink-quiet, #8b93a1);}
.hc-code-row{display:flex;align-items:center;gap:0.3rem;width:100%;min-height:1.6rem;padding:0.1rem 0.5rem 0.1rem 0.4rem;
  cursor:pointer;user-select:none;}
.hc-code-row:focus-visible{outline:1px solid var(--hc-window-accent, rgb(126,182,214));outline-offset:-1px;}
.hc-code-row:hover{background:var(--hc-window-tint, rgba(126,182,214,0.06));}
.hc-code-row.shown{background:var(--hc-window-wash, rgba(126,182,214,0.1));color:var(--hc-window-ink-loud, #f1f3f6);}
.hc-code-chevron{flex:0 0 0.9rem;width:0.9rem;color:var(--hc-window-ink-quiet, #8b93a1);}
.hc-code-tree .mat-sym{font-size:0.95rem;line-height:1;}
.hc-code-glyph{flex:0 0 auto;color:var(--hc-window-ink-quiet, #8b93a1);}
.hc-code-folder .hc-code-glyph{color:rgb(224,178,92);}
.hc-code-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-code-tail{flex:0 0 auto;color:var(--hc-window-ink-quiet, #8b93a1);font-size:0.66rem;}
.hc-code-look{flex:0 0 auto;display:inline-grid;place-items:center;width:1.4rem;height:1.4rem;padding:0;border:0;background:none;
  color:var(--hc-window-ink-quiet, #8b93a1);cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-code-look:hover{color:var(--hc-window-ink-loud, #f1f3f6);background:var(--hc-window-tint, rgba(126,182,214,0.12));}
.hc-code-note{padding:0.2rem 0.6rem;color:var(--hc-window-ink-quiet, #8b93a1);font-size:0.7rem;}
`
  document.head.appendChild(style)
}
