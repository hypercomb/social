// assistant/code-tree.view.ts
//
// THE CODE TREE, IN THE CHAT'S LEFT COLUMN (jwize, 2026-11-16: "can we
// please have a third icon at the top of this and have the logical code
// view", "then we can read code in the main window as well to explore the
// structure").
//
// Two parts, one under the other:
//
//   • WHAT THE CHAT IS ABOUT: the tile the conversation is on, as what it is
//     composed of (jwize, 2026-11-16: "It follows the hierarchy of composed
//     parts"): the tile's page and what the page is made of, its card, its
//     traits, then what else is here. A part that is a tile unfolds into its
//     own parts the same way (composed-parts.ts).
//   • THE RUNNING CODE: every module the hive runs, as folders and files
//     (code-tree.ts), with the platform's own sources unfolding into the
//     source files they ship.
//
// Pressing a file opens it in the chat's MAIN PANE (chat-code.ts
// openChatCode), where the inspect view draws it with line numbers and what
// it emits, listens to and registers. The tree only finds; the pane reads.
//
// The view only draws and unfolds. What a tile is composed of is decided in
// composed-parts.ts and read through composed-parts-reader.ts.
//
// A dependency: it exports the view and registers nothing. The chat's rail
// (agent-tiles-rail.ts) holds one and shows it behind its third icon.

import { EffectBus, I18N_IOC_KEY, sectionIndex, type I18nProvider } from '@hypercomb/core'
import { openChatCode } from './chat-code.js'
import { BEHAVIOURS_PATH, UNNAMED_PATH, findModules, moduleTree, sectionTree, type CodeEntry, type CodeNode, type CodeOpens } from './code-tree.js'
import { composedParts, tileKey, type Composition, type PartAt, type PartHow, type PartNode, type PartsReader } from './composed-parts.js'
import { hiveParts } from './composed-parts-reader.js'
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
}

/** The glyph a part is drawn with, by how it is a part. A `more` row is a
 *  note and has none. */
const PART_GLYPH: Readonly<Record<Exclude<PartHow, 'more'>, string>> = {
  page: 'web', shell: 'description', file: 'description', script: 'code', style: 'palette', picture: 'image',
  named: 'data_object', field: 'data_object', trait: 'extension', card: 'badge', tile: 'folder',
}

/** What each word falls back to in English when no catalog answers. */
const KIND_WORDS: Readonly<Record<string, string>> = { script: 'script', style: 'style sheet', picture: 'picture', named: 'resource' }
const STATE_WORDS: Readonly<Record<string, string>> = {
  absent: 'not on this device', filled: 'filled', chosen: 'chosen version', offered: 'several offered',
  own: 'the page’s own', empty: 'empty', stale: 'older than the page',
}
const FIELD_WORDS: Readonly<Record<string, string>> = { dataSig: 'details', themeSig: 'theme', artSig: 'picture' }

const NOTHING: Composition = { parts: [], also: [] }

/** Is a level read from one place the level of another? The tile, and the
 *  files of it the row above already is. */
const sameAt = (a: PartAt, b: PartAt): boolean =>
  JSON.stringify([a.segments, a.claimed ?? []]) === JSON.stringify([b.segments, b.claimed ?? []])

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
  /** A page or a card arrives open: the ones the participant folded, by key. */
  readonly #folded = new Set<string>()
  /** What a tile is composed of, once read: by the tile's key for a tile's
   *  row; for any other row that unfolds a tile, by the level it is drawn in
   *  and its own key. One place in the tree is one entry, so two places that
   *  draw the same row never take turns reading over each other. */
  readonly #tiles = new Map<string, { readonly at: PartAt; readonly held: Composition } | 'reading'>()
  /** The source files a bundle ships, once read. */
  readonly #bundles = new Map<string, readonly CodeNode[] | 'reading'>()
  /** The row last opened in the main pane. */
  #shown = ''
  #loading = false
  #reread = 0
  readonly #reader: PartsReader
  readonly #offWrote: () => void

  constructor(reader: PartsReader = hiveParts()) {
    this.#reader = reader
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
   *  What was read stays on screen meanwhile: no row blinks.
   *
   *  Every one is composed again. A tile's own layer signature cannot say
   *  nothing changed: history is per page, so a file written on a child tile
   *  commits the child alone (history/layer-committer.drone.ts), and a page's
   *  part is a file on a child. */
  async #rereadTiles(): Promise<void> {
    let changed = false
    for (const [key, entry] of [...this.#tiles]) {
      if (entry === 'reading') continue
      const fresh = await this.#compose(entry.at)
      // Read from another place meanwhile (what fills the row moved): that read stands.
      if (this.#tiles.get(key) !== entry) continue
      if (JSON.stringify(fresh) === JSON.stringify(entry.held)) continue
      this.#tiles.set(key, { at: entry.at, held: fresh })
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
    this.#tileRows(root, { segments: this.#target }, 0)

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

  // NO TILE IS UNFOLDED UNDER ITSELF. Two tiles can each fill a trait of the
  // other from the hive, and a row's key is its tile's, not the path of rows
  // that led to it, so an inner row is open whenever the outer one is.
  // `within` is the tiles whose level is being drawn above a row: a row that
  // would unfold one of them is drawn without its level. That also bounds
  // how deep the tree draws by the number of tiles on one path.

  #tileRows(into: HTMLElement, at: PartAt, depth: number, within: ReadonlySet<string> = new Set()): void {
    const segments = at.segments
    const key = tileKey(segments)
    const unfolded = this.#open.has(key)
    const name = segments.length ? segments[segments.length - 1]! : this.#t('code-tree.hive', 'The hive')
    const row = this.#folder(depth, name, unfolded, key, () => this.#toggle(key))
    row.append(this.#look(key, segments))
    into.append(row)
    if (unfolded) this.#level(into, key, at, depth + 1, new Set([...within, key]))
  }

  /** The tile itself, from a button on its row: what it holds and the code
   *  that runs it. Every row that unfolds a tile keeps one. */
  #look(key: string, segments: readonly string[]): HTMLButtonElement {
    const look = el('button', 'hc-code-look')
    look.type = 'button'
    look.title = this.#t('code-tree.tile', 'What this tile holds, and the code that runs it')
    look.setAttribute('aria-label', look.title)
    look.append(glyph('code'))
    look.addEventListener('click', event => {
      event.stopPropagation()
      this.#show(key, { kind: 'tile', segments: [...segments] })
    })
    return look
  }

  /** One tile's level, under the row that unfolded it: its parts, then what
   *  else is here. `within` holds this tile and every one above it. */
  #level(into: HTMLElement, key: string, at: PartAt, depth: number, within: ReadonlySet<string>): void {
    const kept = this.#tiles.get(key)
    // A row keeps its key when what fills it moves (a child made with the
    // trait's name takes over from a tile of the hive). A level read from
    // another place is not this row's level: it is read again from here, so
    // a part is never shown, or edited, on the tile that used to fill it.
    const entry = kept && kept !== 'reading' && !sameAt(kept.at, at) ? undefined : kept
    if (!entry || entry === 'reading') {
      if (!entry) void this.#readTile(key, at)
      into.append(this.#note(depth, this.#t('code-tree.reading', 'Reading…')))
      return
    }
    const { parts, also } = entry.held
    if (!parts.length && !also.length) {
      // A tile whose only file is the row above it has nothing else to show.
      into.append(this.#note(depth, at.claimed
        ? this.#t('code-tree.only', 'Nothing else here.')
        : this.#t('code-tree.tile-empty', 'No files or tiles here.')))
      return
    }
    for (const node of parts.slice(0, FOLDER_ROWS)) this.#partRows(into, node, depth, within, key)
    // Said only beside parts: a tile with no parts is its tiles and files, as before.
    if (parts.length && also.length) {
      const sub = el('div', 'hc-code-sub', this.#t('code-tree.also', 'Also here'))
      sub.style.paddingLeft = `${indent(depth, 1.1)}rem`
      into.append(sub)
    }
    // Tiles and files are cut apart: many tiles never push the files off.
    const tiles = also.filter(node => node.how === 'tile')
    const files = also.filter(node => node.how !== 'tile')
    for (const node of [...tiles.slice(0, FOLDER_ROWS), ...files.slice(0, FOLDER_ROWS)]) this.#partRows(into, node, depth, within, key)
    const left = Math.max(0, tiles.length - FOLDER_ROWS) + Math.max(0, files.length - FOLDER_ROWS)
    if (left) into.append(this.#note(depth, this.#t('code-tree.more-parts', '{count} more are not listed.', { count: left })))
  }

  /** One part's row, and what is under it. `under` is the key of the level
   *  the row is drawn in. */
  #partRows(into: HTMLElement, node: PartNode, depth: number, within: ReadonlySet<string>, under: string): void {
    // A row that would unfold a tile already open above it: drawn, with its
    // tile button, and without a chevron or a level.
    const loops = !!node.unfold && within.has(tileKey(node.unfold.segments))
    if (node.how === 'tile' && node.unfold && !loops) { this.#tileRows(into, node.unfold, depth, within); return }
    if (node.how === 'more') {
      into.append(this.#note(depth, this.#t('code-tree.more-parts', '{count} more are not listed.', { count: node.count ?? 0 })))
      return
    }
    // A page and a card arrive open; a part that is a tile is read when unfolded.
    const unfolds = !!node.children?.length || (!!node.unfold && !loops)
    const unfolded = node.children?.length ? !this.#folded.has(node.key) : this.#open.has(node.key)
    const row = this.#row(depth, 'hc-code-file')
    if (this.#shown === node.key) row.classList.add('shown')
    if (unfolds) {
      row.setAttribute('aria-expanded', String(unfolded))
      // The row itself opens the part in the pane, so the chevron is its own button.
      const fold = el('button', 'hc-code-chevron hc-code-fold')
      fold.type = 'button'
      fold.setAttribute('aria-label', this.#t('code-tree.unfold', 'Unfold'))
      fold.append(glyph(unfolded ? 'expand_more' : 'chevron_right', 'hc-code-fold-glyph'))
      fold.addEventListener('click', event => {
        event.stopPropagation()
        if (node.children?.length) this.#flip(this.#folded, node.key)
        else this.#toggle(node.key)
      })
      row.append(fold)
    } else {
      row.append(el('span', 'hc-code-chevron'))
    }
    row.append(glyph(PART_GLYPH[node.how]), el('span', 'hc-code-name', this.#partName(node)))
    const tail = node.state ? this.#t(`code-tree.state.${node.state}`, STATE_WORDS[node.state] ?? node.state) : sizeWords(node.size ?? -1)
    if (tail) row.append(el('span', 'hc-code-tail', tail))
    row.title = node.sig ?? node.label
    if (node.unfold) row.append(this.#look(node.key, node.unfold.segments))
    const opens = node.opens
    if (opens) row.addEventListener('click', () => this.#show(node.key, opens))
    into.append(row)
    if (!unfolded) return
    for (const child of (node.children ?? []).slice(0, FOLDER_ROWS)) this.#partRows(into, child, depth + 1, within, under)
    if (node.unfold && !loops) this.#level(into, `${under}>>${node.key}`, node.unfold, depth + 1, new Set([...within, tileKey(node.unfold.segments)]))
  }

  /** The name a part is read by: its own, else its kind's word, with twelve
   *  digits of its signature for a resource the page names without a name. */
  #partName(node: PartNode): string {
    if (node.how === 'field') return this.#t(`code-tree.field.${node.label}`, FIELD_WORDS[node.label] ?? node.label.replace(/Sig$/, ''))
    if (node.label) return node.label
    if (node.how === 'page') return this.#t('code-tree.page', 'Page')
    if (node.how === 'card') return this.#t('code-tree.card', 'Card')
    return `${this.#t(`code-tree.kind.${node.how}`, KIND_WORDS[node.how] ?? node.how)} · ${(node.sig ?? '').slice(0, 12)}`
  }

  async #readTile(key: string, at: PartAt): Promise<void> {
    this.#tiles.set(key, 'reading')
    this.#tiles.set(key, { at, held: await this.#compose(at) })
    this.paint()
  }

  async #compose(at: PartAt): Promise<Composition> {
    try { return await composedParts(this.#reader, at) } catch { return NOTHING /* nothing readable there: an empty folder */ }
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
    this.#flip(this.#open, path)
  }

  #flip(set: Set<string>, path: string): void {
    if (set.has(path)) set.delete(path)
    else set.add(path)
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
.hc-code-note,.hc-code-sub{padding:0.2rem 0.6rem;color:var(--hc-window-ink-quiet, #8b93a1);font-size:0.7rem;}
.hc-code-fold{border:0;background:none;padding:0;font:inherit;cursor:pointer;}
`
  document.head.appendChild(style)
}
