// assistant/inspect-window.view.ts
//
// INSPECT — DRILL INTO THE CODE A TILE NEEDS TO RUN (documentation/inspect.md).
//
// `inspect [tile]` opens this over the hive. It starts at a tile and goes down
// one press at a time:
//
//   the tile      every word it carries that code keys on — its name, the kind
//                 of each decoration, behaviours bound where it stands, its own
//                 slots — each with the lines of running code that quote it
//   a word        every line of running code that quotes it, by module and
//                 source file, each marked emits / listens / registers / names
//   a section     one source file of a running module, read as text, opened at
//                 the line that was pressed; beside it what that file says to
//                 the rest of the hive (effects it emits and listens for, keys
//                 it asks for and registers) and the other files it ships with
//
// Every word and file is pressable, so a reader follows the code a tile runs
// through every behaviour it touches. Back (or Escape) climbs one step;
// Escape at the tile closes.
//
// READ ONLY, AND NEVER RUN. Modules are read as bytes by signature through the
// hive reader (hive-tree-reader.ts) — the same reads `/read <sig> <section>`
// makes — and code is drawn as text, never as markup. A cold panel: DOM
// singleton, no Angular, the shape of the doctrine viewer.

import { I18N_IOC_KEY, sectionIndex, type I18nProvider } from '@hypercomb/core'
import { HIVE_TREE_READER_IOC_KEY, type CodeHit } from './hive-tree-reader.js'
import { codeLinks, lineAt, quoteUse, tileHandles, type QuoteUse, type TileHandle } from './tile-code.js'
import { allBindings, behaviorPath } from '../sharing/behavior-enablement.js'

const STYLE_ID = 'hc-inspect-styles'
const STEEL = '126, 182, 214'
const AMBER = '224, 178, 92'
const SIG = /^[0-9a-f]{64}$/
/** Lines shown under each word on the tile step; the word's own step shows the rest. */
const HITS_PER_HANDLE = 6
/** Lines a word's step reads. */
const HITS_PER_WORD = 120
/** Lines one section draws; a longer file says how much more there is. */
const SHOWN_LINES = 4_000
/** Other files of a module listed beside a section. */
const SHIPS_WITH = 60

type Reader = {
  codeQuoting?(word: string, options?: { max?: number }): Promise<{ hits: readonly CodeHit[]; more: boolean }>
  moduleText?(sig: string): Promise<{ name: string; text: string } | undefined>
}
type HistoryLike = {
  sign?(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt?(locationSig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = { getResource?(sig: string): Promise<Blob | null> }

/** One step of the drill-down. */
export type InspectFrame =
  | { readonly kind: 'tile'; readonly segments: readonly string[] }
  | { readonly kind: 'word'; readonly word: string }
  | { readonly kind: 'section'; readonly sig: string; readonly section?: string; readonly at?: number; readonly name?: string }

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export class InspectWindowView extends EventTarget {
  #panel: HTMLDivElement | null = null
  #body: HTMLDivElement | null = null
  #crumbs: HTMLDivElement | null = null
  #stack: InspectFrame[] = []
  /** Bumped on every step, so a slow read never draws over a newer one. */
  #turn = 0

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#panel) return
    event.stopPropagation()
    event.preventDefault()
    this.back()
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    const text = value && value !== key ? value : fallback
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
  }

  get isOpen(): boolean { return this.#panel !== null }

  /** Open at a step: a tile, a word, or a module (and file) by signature. */
  open(frame: InspectFrame): void {
    if (!this.#panel) this.#build()
    this.#stack = [frame]
    void this.#render()
  }

  /** One step deeper. */
  push(frame: InspectFrame): void {
    this.#stack.push(frame)
    void this.#render()
  }

  /** One step back; past the first, the panel closes. */
  back(): void {
    if (this.#stack.length <= 1) { this.close(); return }
    this.#stack.pop()
    void this.#render()
  }

  close(): void {
    document.removeEventListener('keydown', this.#onKey, true)
    this.#panel?.remove()
    this.#panel = null
    this.#body = null
    this.#crumbs = null
    this.#stack = []
    this.#turn++
  }

  #build(): void {
    this.#ensureStyles()
    const panel = el('div', 'hc-inspect')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', this.#t('inspect.title', 'Inspect'))
    const head = el('div', 'hc-inspect-head')
    const back = el('button', 'hc-inspect-back', '‹')
    back.type = 'button'
    back.setAttribute('aria-label', this.#t('inspect.back', 'Back'))
    back.addEventListener('click', () => this.back())
    const title = el('div', 'hc-inspect-title', this.#t('inspect.title', 'Inspect'))
    const close = el('button', 'hc-inspect-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', this.#t('inspect.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.append(back, title, close)
    const crumbs = el('div', 'hc-inspect-crumbs')
    const body = el('div', 'hc-inspect-body')
    panel.append(head, crumbs, body)
    document.body.appendChild(panel)
    this.#panel = panel
    this.#body = body
    this.#crumbs = crumbs
    document.addEventListener('keydown', this.#onKey, true)
  }

  #frameLabel(frame: InspectFrame): string {
    if (frame.kind === 'tile') return frame.segments.length ? `/${frame.segments.join('/')}` : this.#t('inspect.hive', 'the hive')
    if (frame.kind === 'word') return `'${frame.word}'`
    return frame.section ? frame.section.replace(/^src\//, '') : frame.name ?? frame.sig.slice(0, 12)
  }

  #drawCrumbs(): void {
    const crumbs = this.#crumbs
    if (!crumbs) return
    crumbs.replaceChildren()
    this.#stack.forEach((frame, index) => {
      if (index) crumbs.append(el('span', 'hc-inspect-sep', '›'))
      const last = index === this.#stack.length - 1
      const crumb = el('button', `hc-inspect-crumb${last ? ' hc-inspect-here' : ''}`, this.#frameLabel(frame))
      crumb.type = 'button'
      crumb.disabled = last
      crumb.addEventListener('click', () => { this.#stack = this.#stack.slice(0, index + 1); void this.#render() })
      crumbs.append(crumb)
    })
  }

  async #render(): Promise<void> {
    const body = this.#body
    const frame = this.#stack[this.#stack.length - 1]
    if (!body || !frame) return
    const turn = ++this.#turn
    this.#drawCrumbs()
    body.replaceChildren(el('div', 'hc-inspect-note', this.#t('inspect.reading', 'Reading the running code…')))
    body.scrollTop = 0
    const reader = ioc<Reader>(HIVE_TREE_READER_IOC_KEY)
    if (!reader?.codeQuoting || !reader.moduleText) {
      body.replaceChildren(el('div', 'hc-inspect-note', this.#t('inspect.unavailable', 'The hive reader is not loaded yet, so the code cannot be read.')))
      return
    }
    try {
      const drawn = frame.kind === 'tile' ? await this.#tile(frame.segments, reader)
        : frame.kind === 'word' ? await this.#word(frame.word, reader)
          : await this.#section(frame, reader)
      if (turn !== this.#turn) return
      body.replaceChildren(...drawn)
      body.querySelector('.hc-inspect-mark')?.scrollIntoView({ block: 'center' })
    } catch (error) {
      if (turn !== this.#turn) return
      body.replaceChildren(el('div', 'hc-inspect-note', this.#t('inspect.failed', 'The code could not be read: {error}', {
        error: error instanceof Error ? error.message : String(error),
      })))
    }
  }

  // ── the tile ──────────────────────────────────────────────────────────

  async #tile(segments: readonly string[], reader: Reader): Promise<Node[]> {
    const name = segments[segments.length - 1] ?? ''
    const layer = await this.#layerAt(segments)
    const decorationKinds = await this.#decorationKinds(layer)
    const here = behaviorPath(segments)
    const boundKinds = Object.entries(allBindings())
      .filter(([, list]) => list.some(binding => binding.path === here))
      .map(([kind]) => kind)
    const handles = tileHandles({ name, layer, decorationKinds, boundKinds })
    if (!handles.length) return [el('div', 'hc-inspect-note', this.#t('inspect.nothing', 'This tile carries nothing running code keys on: it is drawn by the grid alone.'))]

    const out: Node[] = [el('div', 'hc-inspect-lead', this.#t('inspect.tile-lead',
      'The words this tile carries that code keys on, and the running code that quotes each. Press a line to open its file; press a word to see every line.'))]
    let found = 0
    for (const handle of handles) {
      const { hits, more } = await reader.codeQuoting!(handle.word, { max: HITS_PER_HANDLE })
      found += hits.length
      out.push(this.#handleBlock(handle, hits, more))
    }
    if (!found) out.push(el('div', 'hc-inspect-note', this.#t('inspect.unclaimed', 'No running code quotes any of these words: nothing beyond the grid runs this tile.')))
    return out
  }

  #handleBlock(handle: TileHandle, hits: readonly CodeHit[], more: boolean): HTMLElement {
    const block = el('div', 'hc-inspect-block')
    const head = el('div', 'hc-inspect-blockhead')
    const reason = el('span', 'hc-inspect-why', this.#t(`inspect.from.${handle.from}`, {
      name: 'name', kind: 'decoration', bound: 'bound here', slot: 'slot',
    }[handle.from]))
    head.append(reason, this.#wordButton(handle.word))
    const count = el('span', 'hc-inspect-count', hits.length ? `${hits.length}${more ? '+' : ''}` : '0')
    head.append(count)
    block.append(head)
    if (!hits.length) block.append(el('div', 'hc-inspect-none', this.#t('inspect.no-code', 'no running code quotes it')))
    for (const hit of hits) block.append(this.#hitRow(hit, handle.word))
    return block
  }

  // ── a word ────────────────────────────────────────────────────────────

  async #word(word: string, reader: Reader): Promise<Node[]> {
    const { hits, more } = await reader.codeQuoting!(word, { max: HITS_PER_WORD })
    if (!hits.length) return [el('div', 'hc-inspect-note', this.#t('inspect.word-none', "No running code quotes '{word}'.", { word }))]
    const uses = new Map<QuoteUse, number>()
    for (const hit of hits) { const use = quoteUse(hit.text, word); uses.set(use, (uses.get(use) ?? 0) + 1) }
    const sum = [...uses].map(([use, count]) => `${count} ${this.#useLabel(use)}`).join(' · ')
    const out: Node[] = [el('div', 'hc-inspect-lead', this.#t('inspect.word-lead', "{count} lines quote '{word}': {uses}.{more}", {
      count: `${hits.length}${more ? '+' : ''}`, word, uses: sum,
      more: more ? ` ${this.#t('inspect.word-more', 'Only the first are shown.')}` : '',
    }))]
    // Grouped by module, in the order the reader found them.
    const byModule = new Map<string, CodeHit[]>()
    for (const hit of hits) byModule.set(hit.sig, [...(byModule.get(hit.sig) ?? []), hit])
    for (const [sig, group] of byModule) {
      const block = el('div', 'hc-inspect-block')
      const head = el('div', 'hc-inspect-blockhead')
      head.append(this.#moduleButton(sig, group[0].name), el('span', 'hc-inspect-count', String(group.length)))
      block.append(head)
      for (const hit of group) block.append(this.#hitRow(hit, word))
      out.push(block)
    }
    return out
  }

  // ── a section ─────────────────────────────────────────────────────────

  async #section(frame: Extract<InspectFrame, { kind: 'section' }>, reader: Reader): Promise<Node[]> {
    if (!SIG.test(frame.sig)) return [el('div', 'hc-inspect-note', this.#t('inspect.bad-sig', 'That is not a module signature.'))]
    const module = await reader.moduleText!(frame.sig)
    if (!module) return [el('div', 'hc-inspect-note', this.#t('inspect.not-held', 'That module is not code held here.'))]
    const sections = sectionIndex(module.text)
    const section = frame.section ? sections.find(entry => entry.path === frame.section) : undefined
    const out: Node[] = []

    const meta = el('div', 'hc-inspect-meta')
    meta.append(
      el('span', 'hc-inspect-modname', module.name),
      el('span', 'hc-inspect-sig', frame.sig.slice(0, 12)),
      el('span', 'hc-inspect-say', `read ${frame.sig}${section ? ` ${section.path}` : ''}`),
    )
    out.push(meta)

    if (!section && sections.length) {
      // The module itself: its files, to open one.
      out.push(el('div', 'hc-inspect-lead', this.#t('inspect.module-lead', 'This module ships {count} source files. Press one to read it.', { count: sections.length })))
      const list = el('div', 'hc-inspect-files')
      for (const entry of sections) list.append(this.#fileButton(frame.sig, entry.path, entry.lines))
      out.push(list)
      return out
    }

    const text = section ? module.text.slice(section.from, section.to) : module.text
    const mark = frame.at !== undefined ? lineAt(text, frame.at) : 0

    const links = codeLinks(text)
    const linkRow = (label: string, words: readonly string[]): void => {
      if (!words.length) return
      const row = el('div', 'hc-inspect-links')
      row.append(el('span', 'hc-inspect-why', label))
      for (const word of words) row.append(this.#wordButton(word))
      out.push(row)
    }
    linkRow(this.#t('inspect.emits', 'emits'), links.emits)
    linkRow(this.#t('inspect.listens', 'listens'), links.listens)
    linkRow(this.#t('inspect.needs', 'asks for'), links.needs)
    linkRow(this.#t('inspect.provides', 'registers'), links.provides)

    out.push(this.#code(text, mark))

    const others = sections.filter(entry => entry.path !== section?.path)
    if (others.length) {
      out.push(el('div', 'hc-inspect-lead', this.#t('inspect.ships-with', 'Ships in the same module ({count} files):', { count: others.length })))
      const list = el('div', 'hc-inspect-files')
      for (const entry of others.slice(0, SHIPS_WITH)) list.append(this.#fileButton(frame.sig, entry.path, entry.lines))
      if (others.length > SHIPS_WITH) {
        const all = el('button', 'hc-inspect-word', this.#t('inspect.all-files', 'all {count} files', { count: others.length }))
        all.type = 'button'
        all.addEventListener('click', () => this.push({ kind: 'section', sig: frame.sig }))
        list.append(all)
      }
      out.push(list)
    }
    return out
  }

  #code(text: string, mark: number): HTMLElement {
    const lines = text.split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    const pre = el('div', 'hc-inspect-code')
    const shown = lines.slice(0, SHOWN_LINES)
    shown.forEach((line, index) => {
      const number = index + 1
      const row = el('div', `hc-inspect-line${number === mark ? ' hc-inspect-mark' : ''}`)
      row.append(el('span', 'hc-inspect-num', String(number)), el('span', 'hc-inspect-src', line || ' '))
      pre.append(row)
    })
    if (lines.length > shown.length) {
      pre.append(el('div', 'hc-inspect-note', this.#t('inspect.more-lines', '{count} more lines: read it with the command above.', { count: lines.length - shown.length })))
    }
    return pre
  }

  // ── pressables ────────────────────────────────────────────────────────

  #useLabel(use: QuoteUse): string {
    return this.#t(`inspect.use.${use}`, { emits: 'emits', listens: 'listens', provides: 'registers', names: 'names' }[use])
  }

  #hitRow(hit: CodeHit, word: string): HTMLElement {
    const row = el('button', 'hc-inspect-hit')
    row.type = 'button'
    const use = quoteUse(hit.text, word)
    row.append(
      el('span', `hc-inspect-use hc-inspect-use-${use}`, this.#useLabel(use)),
      el('span', 'hc-inspect-where', `${hit.name} · ${(hit.section ?? '').replace(/^src\//, '') || hit.sig.slice(0, 12)}`),
      el('span', 'hc-inspect-text', hit.text),
    )
    row.addEventListener('click', () => this.push({ kind: 'section', sig: hit.sig, name: hit.name, ...(hit.section ? { section: hit.section } : {}), at: hit.at }))
    return row
  }

  #wordButton(word: string): HTMLElement {
    const button = el('button', 'hc-inspect-word', word)
    button.type = 'button'
    button.title = this.#t('inspect.follow', 'Every line of running code that quotes it')
    button.addEventListener('click', () => this.push({ kind: 'word', word }))
    return button
  }

  #moduleButton(sig: string, name: string): HTMLElement {
    const button = el('button', 'hc-inspect-word hc-inspect-modname', name)
    button.type = 'button'
    button.addEventListener('click', () => this.push({ kind: 'section', sig, name }))
    return button
  }

  #fileButton(sig: string, path: string, lines: number): HTMLElement {
    const button = el('button', 'hc-inspect-file')
    button.type = 'button'
    button.append(el('span', 'hc-inspect-src', path.replace(/^src\//, '')), el('span', 'hc-inspect-count', String(lines)))
    button.addEventListener('click', () => this.push({ kind: 'section', sig, section: path }))
    return button
  }

  // ── what the tile carries ─────────────────────────────────────────────

  async #layerAt(segments: readonly string[]): Promise<Record<string, unknown> | null> {
    const history = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign || !history.currentLayerAt) return null
    const sig = await history.sign({ explorerSegments: () => segments })
    return (await history.currentLayerAt(sig).catch(() => null)) ?? null
  }

  async #decorationKinds(layer: Record<string, unknown> | null): Promise<string[]> {
    const slot = layer?.['decorations']
    const store = ioc<StoreLike>('@hypercomb.social/Store')
    if (!Array.isArray(slot) || !store?.getResource) return []
    const kinds = await Promise.all(slot.map(String).filter(sig => SIG.test(sig)).map(async sig => {
      try {
        const blob = await store.getResource!(sig)
        const kind = blob ? (JSON.parse(await blob.text()) as { kind?: unknown })?.kind : undefined
        return typeof kind === 'string' ? kind : ''
      } catch { return '' }
    }))
    return kinds.filter(Boolean)
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-inspect{position:fixed;z-index:99999;display:flex;flex-direction:column;gap:0.5rem;
  right:calc(var(--hc-controls-right, 0px) + 1rem);top:4rem;bottom:1rem;width:min(56rem,calc(100vw - 2rem));
  padding:0.75rem 0.85rem;box-sizing:border-box;
  background:rgba(6,9,14,0.97);border:1px solid rgba(${STEEL},0.35);border-radius:var(--hc-radius-floating, 4px);}
.hc-inspect-head{display:flex;align-items:center;gap:0.5rem;flex:0 0 auto;}
.hc-inspect-title{flex:1 1 auto;font-family:var(--hc-mono,monospace);font-size:0.76rem;font-weight:600;
  letter-spacing:0.1em;text-transform:uppercase;color:rgba(${STEEL},0.95);}
.hc-inspect-back,.hc-inspect-close{width:2rem;height:2rem;border:none;background:none;color:rgba(245,245,245,0.45);
  font-size:1.3rem;line-height:1;cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-inspect-back:hover,.hc-inspect-close:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-inspect-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:0.15rem 0.35rem;flex:0 0 auto;font-size:0.76rem;}
.hc-inspect-crumb{border:0;background:none;padding:0.1rem 0;font:inherit;color:rgba(${STEEL},0.8);cursor:pointer;
  font-family:var(--hc-mono,monospace);max-width:22rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-inspect-crumb:hover:not(:disabled){color:whitesmoke;}
.hc-inspect-here{color:rgba(238,244,250,0.92);cursor:default;}
.hc-inspect-sep{color:rgba(216,230,238,0.35);}
.hc-inspect-body{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:0.55rem;
  font-size:0.82rem;color:rgba(238,244,250,0.9);}
.hc-inspect-lead,.hc-inspect-note{font-size:0.78rem;line-height:1.45;color:rgba(216,230,238,0.62);}
.hc-inspect-block{display:flex;flex-direction:column;gap:0.1rem;}
.hc-inspect-blockhead,.hc-inspect-links,.hc-inspect-meta{display:flex;flex-wrap:wrap;align-items:center;gap:0.25rem 0.55rem;}
.hc-inspect-why{font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;color:rgba(216,230,238,0.45);}
.hc-inspect-count{font-family:var(--hc-mono,monospace);font-size:0.7rem;color:rgba(216,230,238,0.45);}
.hc-inspect-none{margin-left:1rem;font-size:0.74rem;color:rgba(216,230,238,0.4);}
.hc-inspect-word{border:0;background:none;padding:0.1rem 0;font-family:var(--hc-mono,monospace);font-size:0.78rem;
  color:rgb(${STEEL});cursor:pointer;text-align:left;word-break:break-all;}
.hc-inspect-word:hover{color:whitesmoke;text-decoration:underline;}
.hc-inspect-modname{font-weight:600;}
.hc-inspect-sig,.hc-inspect-say{font-family:var(--hc-mono,monospace);font-size:0.7rem;color:rgba(216,230,238,0.45);}
.hc-inspect-say{user-select:all;word-break:break-all;}
.hc-inspect-hit,.hc-inspect-file{display:grid;grid-template-columns:5.5rem minmax(8rem,16rem) 1fr;gap:0.5rem;align-items:baseline;
  margin-left:1rem;padding:0.2rem 0.35rem;border:0;background:none;text-align:left;font:inherit;color:inherit;cursor:pointer;
  border-radius:var(--hc-radius-control, 2px);}
.hc-inspect-file{grid-template-columns:1fr auto;margin-left:0;}
.hc-inspect-hit:hover,.hc-inspect-file:hover{background:rgba(255,255,255,0.05);}
.hc-inspect-use{font-size:0.66rem;letter-spacing:0.05em;text-transform:uppercase;color:rgba(216,230,238,0.5);}
.hc-inspect-use-emits{color:rgba(${AMBER},0.95);}
.hc-inspect-use-listens{color:rgba(${STEEL},0.95);}
.hc-inspect-use-provides{color:rgba(150,210,150,0.95);}
.hc-inspect-where{font-size:0.72rem;color:rgba(216,230,238,0.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-inspect-text,.hc-inspect-src{font-family:var(--hc-mono,monospace);font-size:0.74rem;white-space:pre;overflow:hidden;text-overflow:ellipsis;}
.hc-inspect-files{display:flex;flex-direction:column;}
.hc-inspect-code{flex:0 0 auto;overflow-x:auto;padding:0.4rem 0;background:rgba(255,255,255,0.025);
  border:1px solid rgba(${STEEL},0.15);border-radius:var(--hc-radius-control, 2px);}
.hc-inspect-line{display:flex;gap:0.75rem;min-width:max-content;padding:0 0.6rem;}
.hc-inspect-line .hc-inspect-src{overflow:visible;color:rgba(238,244,250,0.86);}
.hc-inspect-num{flex:0 0 3rem;text-align:right;font-family:var(--hc-mono,monospace);font-size:0.7rem;color:rgba(216,230,238,0.3);user-select:none;}
.hc-inspect-mark{background:rgba(${AMBER},0.16);}
`
    document.head.appendChild(style)
  }
}

