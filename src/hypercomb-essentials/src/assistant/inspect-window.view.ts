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
// WHAT THE TILE HOLDS, TOO (jwize, 2026-11-16: "we should be able to drill
// down to the files and resources … and see the code for the behaviour on
// that tile as well"). The tile step opens with the tiles inside it, its
// files, the resources its records name and the platform's own sources, each
// pressable: a tile opens as a tile, and a file or a resource opens as what
// it is — text with line numbers, a picture, or its size (tile-holds.ts).
//
// TWO PLACES. Over the hive as a panel (`inspect`), and INSIDE THE CHAT as
// the main pane's other view ("the code should be in the main pane as a
// different view to the chat, so a different view of the chat's target"):
// `mount(host, frame)` draws the same steps into an element the chat window
// lends, and `unmount()` hands it back.
//
// READ ONLY, AND NEVER RUN. Modules are read as bytes by signature through the
// hive reader (hive-tree-reader.ts) — the same reads `/read <sig> <section>`
// makes — and code is drawn as text, never as markup. A cold panel: DOM
// singleton, no Angular, the shape of the doctrine viewer.

import { I18N_IOC_KEY, sectionIndex, type I18nProvider } from '@hypercomb/core'
import { isTypescriptAtomText } from './package-typescript.js'
import { HIVE_TREE_READER_IOC_KEY, type CodeHit } from './hive-tree-reader.js'
import { codeLinks, lineAt, quoteUse, tileHandles, type QuoteUse, type TileHandle } from './tile-code.js'
import { platformSources, readable, recordResources, shownAs, signaturesIn, sizeWords } from './tile-holds.js'
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
/** Tiles, files and named resources one tile step lists. */
const HELD_ROWS = 80
/** Characters of one resource drawn as text; a longer one says how much more. */
const RESOURCE_CHARS = 400_000

type Reader = {
  codeQuoting?(word: string, options?: { max?: number }): Promise<{ hits: readonly CodeHit[]; more: boolean }>
  moduleText?(sig: string): Promise<{ name: string; text: string } | undefined>
  readNode?(segments: readonly string[], options?: { withContent?: boolean }): Promise<{
    readonly ok: boolean
    readonly children?: readonly { readonly name: string }[]
    readonly files?: readonly { readonly name: string; readonly sig: string; readonly size: number }[]
  }>
  listCode?(query: string): Promise<{ readonly ok: boolean; readonly entries?: readonly { readonly name: string; readonly sig: string }[] }>
  /** The atom holding a section's TypeScript, from layers held here: no
   *  request. A reader without it, or a package that names none, shows no
   *  button. */
  typescriptFor?(moduleSig: string, section: string): Promise<{ readonly atom: string; readonly section: string } | undefined>
  /** Is this signature a source atom the running package names (`atom`), and
   *  could the reader tell (`known`)? Asked before any read of a signature
   *  through the store, which would fetch an atom and write it to the device. */
  typescriptAtom?(sig: string): Promise<{ readonly atom: boolean; readonly known: boolean }>
  /** One file's TypeScript. This is the read that asks a host. */
  typescriptText?(atom: string, section: string, options?: { signal?: AbortSignal }): Promise<
    { readonly ok: true; readonly text: string; readonly host: string } | { readonly ok: false; readonly code: string }>
}
type HistoryLike = {
  sign?(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt?(locationSig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = { getResource?(sig: string): Promise<Blob | null> }
/** The door a file on a tile is written through (files/tile-files.drone.ts). */
type TileFilesLike = {
  write?(target: { route: readonly string[]; kind: 'file'; name: string }, text: string): Promise<
    { ok: true; sig: string; created?: boolean; unchanged?: boolean } | { ok: false; error: string }>
}
/** What the site's page did after a write, in plain lines (sharing/site-manage.drone.ts). */
type RunWatchLike = { say?(): Promise<readonly string[]> }
const TILE_FILES_KEY = '@diamondcoreprocessor.com/TileFilesDrone'
const RUN_WATCH_KEY = '@diamondcoreprocessor.com/SiteRunWatch'

/** One step of the drill-down. */
export type InspectFrame =
  | { readonly kind: 'tile'; readonly segments: readonly string[] }
  | { readonly kind: 'word'; readonly word: string }
  | { readonly kind: 'section'; readonly sig: string; readonly section?: string; readonly at?: number; readonly name?: string }
  /** A file or a resource by signature: text, a picture, or its size. `file`
   *  says it is a file on a tile, which is what makes it one that can be
   *  edited here and saved back. */
  | { readonly kind: 'resource'; readonly sig: string; readonly name?: string; readonly file?: TileFileRef }

/** A file on a tile: the tile's route and the file's name. */
export type TileFileRef = { readonly route: readonly string[]; readonly name: string }

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
  /** The file being edited, by the signature it was opened at; and what the
   *  last save said (saved, and what the page then did). */
  #editing: string | null = null
  #saved: string[] = []
  /** The step whose TypeScript was asked for by a press (owner, 2026-11-16:
   *  "fetched only when a file is opened"). It is the step itself, not a
   *  flag, so no other step, however it is reached, can ask a host. */
  #typescript: InspectFrame | null = null
  /** The read the step on screen is making; ended when the step changes. */
  #reading: AbortController | null = null
  /** Bumped on every step, so a slow read never draws over a newer one. */
  #turn = 0
  /** True while it is drawn inside an element another surface lent. */
  #embedded = false
  /** Pictures on screen: object URLs, let go when the step changes. */
  #pictures: string[] = []

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#panel) return
    // Inside another surface, Escape climbs a step and no further: at the
    // first step the key is that surface's, not this view's.
    if (this.#embedded && this.#stack.length <= 1) return
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
    if (this.#embedded) this.close()
    if (!this.#panel) this.#build()
    this.#stack = [frame]
    this.#leaveEdit()
    void this.#render()
  }

  /** Draw inside `host`, as another surface's own view: no frame of its own,
   *  no close, and it fills what it was given. */
  mount(host: HTMLElement, frame: InspectFrame): void {
    if (this.#panel && (!this.#embedded || this.#panel.parentElement !== host)) this.close()
    if (!this.#panel) this.#build(host)
    this.#stack = [frame]
    this.#leaveEdit()
    void this.#render()
  }

  /** Hand the lent element back. A panel over the hive is left alone. */
  unmount(): void {
    if (this.#embedded) this.close()
  }

  get isEmbedded(): boolean { return this.#embedded }

  /** Another step is another file: an edit in hand, and what the last save
   *  said, belong to the step they were made on. */
  #leaveEdit(): void {
    this.#editing = null
    this.#saved = []
    // Every new step opens as shipped and asks nothing.
    this.#typescript = null
  }

  /** One step deeper. */
  push(frame: InspectFrame): void {
    this.#leaveEdit()
    this.#stack.push(frame)
    void this.#render()
  }

  /** One step back; past the first, the panel closes. */
  back(): void {
    if (this.#stack.length <= 1) { if (!this.#embedded) this.close(); return }
    this.#leaveEdit()
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
    this.#embedded = false
    this.#typescript = null
    this.#reading?.abort()
    this.#reading = null
    this.#dropPictures()
    this.#turn++
  }

  #dropPictures(): void {
    for (const url of this.#pictures.splice(0)) { try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
  }

  #build(host?: HTMLElement): void {
    this.#ensureStyles()
    this.#embedded = !!host
    const panel = el('div', host ? 'hc-inspect hc-inspect-embedded' : 'hc-inspect')
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
    head.append(back, title)
    if (!host) head.append(close)
    const crumbs = el('div', 'hc-inspect-crumbs')
    const body = el('div', 'hc-inspect-body')
    panel.append(head, crumbs, body)
    ;(host ?? document.body).appendChild(panel)
    this.#panel = panel
    this.#body = body
    this.#crumbs = crumbs
    document.addEventListener('keydown', this.#onKey, true)
  }

  #frameLabel(frame: InspectFrame): string {
    if (frame.kind === 'tile') return frame.segments.length ? `/${frame.segments.join('/')}` : this.#t('inspect.hive', 'the hive')
    if (frame.kind === 'word') return `'${frame.word}'`
    if (frame.kind === 'resource') return frame.name ?? frame.sig.slice(0, 12)
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
    // A read the step before was waiting on is ended, not left to finish.
    this.#reading?.abort()
    this.#reading = new AbortController()
    this.#drawCrumbs()
    body.replaceChildren(el('div', 'hc-inspect-note', this.#t('inspect.reading', 'Reading the running code…')))
    body.scrollTop = 0
    const reader = ioc<Reader>(HIVE_TREE_READER_IOC_KEY)
    if (frame.kind !== 'resource' && (!reader?.codeQuoting || !reader.moduleText)) {
      body.replaceChildren(el('div', 'hc-inspect-note', this.#t('inspect.unavailable', 'The hive reader is not loaded yet, so the code cannot be read.')))
      return
    }
    try {
      const pictures: string[] = []
      const drawn = frame.kind === 'resource' ? await this.#resource(frame, reader, pictures)
        : frame.kind === 'tile' ? await this.#tile(frame.segments, reader!)
          : frame.kind === 'word' ? await this.#word(frame.word, reader!)
            : await this.#section(frame, reader!)
      if (turn !== this.#turn) { for (const url of pictures) URL.revokeObjectURL(url); return }
      this.#dropPictures()
      this.#pictures.push(...pictures)
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
    const records = await this.#decorationRecords(layer)
    const decorationKinds = records.map(record => (record as { kind?: unknown })?.kind).filter((kind): kind is string => typeof kind === 'string' && !!kind)
    const held = await this.#holds(segments, records, reader)
    const here = behaviorPath(segments)
    const boundKinds = Object.entries(allBindings())
      .filter(([, list]) => list.some(binding => binding.path === here))
      .map(([kind]) => kind)
    const handles = tileHandles({ name, layer, decorationKinds, boundKinds })
    if (!handles.length) return [...held, el('div', 'hc-inspect-note', this.#t('inspect.nothing', 'This tile carries nothing running code keys on: it is drawn by the grid alone.'))]

    const out: Node[] = [...held]
    if (held.length) out.push(el('div', 'hc-inspect-part', this.#t('inspect.part-code', 'The code that runs it')))
    out.push(el('div', 'hc-inspect-lead', this.#t('inspect.tile-lead',
      'The words this tile carries that code keys on, and the running code that quotes each. Press a line to open its file; press a word to see every line.')))
    let found = 0
    for (const handle of handles) {
      const { hits, more } = await reader.codeQuoting!(handle.word, { max: HITS_PER_HANDLE })
      found += hits.length
      out.push(this.#handleBlock(handle, hits, more))
    }
    if (!found) out.push(el('div', 'hc-inspect-note', this.#t('inspect.unclaimed', 'No running code quotes any of these words: nothing beyond the grid runs this tile.')))
    return out
  }

  // ── what the tile holds ───────────────────────────────────────────────

  /** The tiles inside, the files, the resources its records name, and the
   *  platform's sources: each a list of rows that open what they name. */
  async #holds(segments: readonly string[], records: readonly unknown[], reader: Reader): Promise<Node[]> {
    const out: Node[] = []
    const part = (label: string, rows: HTMLElement[], more: number): void => {
      if (!rows.length) return
      out.push(el('div', 'hc-inspect-part', label))
      const list = el('div', 'hc-inspect-files')
      list.append(...rows)
      if (more > 0) list.append(el('div', 'hc-inspect-none', this.#t('inspect.more-rows', '{count} more are not listed.', { count: more })))
      out.push(list)
    }
    let node: Awaited<ReturnType<NonNullable<Reader['readNode']>>> | null = null
    try { node = await reader.readNode?.(segments, { withContent: true }) ?? null } catch { node = null }
    const children = node?.ok ? node.children ?? [] : []
    const files = node?.ok ? node.files ?? [] : []

    part(this.#t('inspect.part-tiles', 'Tiles inside'),
      children.slice(0, HELD_ROWS).map(child => this.#row('folder', child.name, '', () => this.push({ kind: 'tile', segments: [...segments, child.name] }))),
      children.length - HELD_ROWS)

    part(this.#t('inspect.part-files', 'Files'),
      files.slice(0, HELD_ROWS).map(file => this.#row('description', file.name, sizeWords(file.size),
        () => this.push({ kind: 'resource', sig: file.sig, name: file.name, file: { route: [...segments], name: file.name } }))),
      files.length - HELD_ROWS)

    const named = records.flatMap(record => {
      const read = recordResources(record)
      return read ? read.named.map(resource => ({ kind: read.kind, ...resource })) : []
    })
    part(this.#t('inspect.part-resources', 'Resources its records name'),
      named.slice(0, HELD_ROWS).map(resource => this.#row('data_object', `${resource.kind} · ${resource.label}`, resource.sig.slice(0, 12),
        () => this.push({ kind: 'resource', sig: resource.sig, name: `${resource.kind} ${resource.label}` }))),
      named.length - HELD_ROWS)

    // THE PLATFORM BENEATH (jwize, same day: "the framework resources that are
    // used for the behaviour, so you can potentially author upgrades for them
    // as well"): the core, the shell, the host and the documents, as written.
    let sources: readonly { readonly name: string; readonly sig: string }[] = []
    try { const listed = await reader.listCode?.('source'); sources = listed?.ok ? platformSources(listed.entries ?? []) : [] } catch { sources = [] }
    part(this.#t('inspect.part-platform', 'The platform it runs on'),
      sources.slice(0, HELD_ROWS).map(source => this.#row('code', source.name, source.sig.slice(0, 12), () => this.push({ kind: 'section', sig: source.sig, name: source.name }))),
      sources.length - HELD_ROWS)
    return out
  }

  /** One pressable row: a glyph, a name, and a quiet word at the end. */
  #row(glyph: string, name: string, tail: string, press: () => void): HTMLElement {
    const button = el('button', 'hc-inspect-file hc-inspect-row')
    button.type = 'button'
    const icon = el('span', 'mat-sym hc-inspect-glyph', glyph)
    icon.setAttribute('aria-hidden', 'true')
    button.append(icon, el('span', 'hc-inspect-src', name), el('span', 'hc-inspect-count', tail))
    button.addEventListener('click', press)
    return button
  }

  // ── a file or a resource ──────────────────────────────────────────────

  async #resource(frame: Extract<InspectFrame, { kind: 'resource' }>, reader: Reader | undefined, pictures: string[]): Promise<Node[]> {
    if (!SIG.test(frame.sig)) return [el('div', 'hc-inspect-note', this.#t('inspect.bad-resource', 'That is not a signature.'))]
    // THE PACKAGE'S TYPESCRIPT IS NEVER READ THROUGH THE STORE (owner,
    // 2026-11-16: "Host the package's TypeScript without installing it,
    // fetched only when a file is opened"). The store fetches a signature it
    // does not hold and writes what answers to the device. A layer's JSON
    // shows its `typescript` signature, so a step can arrive here carrying
    // one; the reader says so, and the step then asks nobody. The TypeScript
    // is read by the button on a file, into memory.
    const atomNote = (): Node[] => [el('div', 'hc-inspect-note', this.#t('inspect.typescript-atom',
      'This is the TypeScript of one folder of the package. It is hosted with the package and not kept on this device: open one of its files in the code and press TypeScript.'))]
    const named = await reader?.typescriptAtom?.(frame.sig).catch(() => undefined)
    if (named?.atom) return atomNote()
    const store = ioc<StoreLike>('@hypercomb.social/Store')
    const blob = await store?.getResource?.(frame.sig).catch(() => null) ?? null
    if (!blob) {
      // A signature a record names may be code, not a resource: open it as code.
      if (reader?.moduleText && await reader.moduleText(frame.sig).catch(() => undefined)) {
        return this.#section({ kind: 'section', sig: frame.sig, ...(frame.name ? { name: frame.name } : {}) }, reader)
      }
      return [el('div', 'hc-inspect-note', this.#t('inspect.resource-absent', 'Its bytes are not on this device.'))]
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    // Where the reader could not say (no reader, or no selection to read),
    // an atom is known only by its first line, and is not drawn as a
    // resource of this hive.
    if (!named?.known && isTypescriptAtomText(new TextDecoder().decode(bytes.subarray(0, 64)))) return atomNote()
    const out: Node[] = []
    const meta = el('div', 'hc-inspect-meta')
    meta.append(
      el('span', 'hc-inspect-modname', frame.name ?? frame.sig.slice(0, 12)),
      el('span', 'hc-inspect-sig', sizeWords(bytes.byteLength)),
      el('span', 'hc-inspect-say', `read ${frame.sig}`),
    )
    out.push(meta)

    const shown = shownAs(bytes)
    if (shown.as === 'picture') {
      const url = URL.createObjectURL(new Blob([bytes], { type: shown.mime }))
      pictures.push(url)
      const picture = el('img', 'hc-inspect-picture')
      picture.src = url
      picture.alt = frame.name ?? ''
      out.push(picture)
      return out
    }
    if (shown.as === 'bytes') {
      out.push(el('div', 'hc-inspect-note', this.#t('inspect.resource-bytes', 'Not text and not a picture: only its size can be shown.')))
      return out
    }
    // What it names, to follow: a record names a page, a page names its parts.
    const names = signaturesIn(shown.text).filter(sig => sig !== frame.sig)
    if (names.length) {
      const row = el('div', 'hc-inspect-links')
      row.append(el('span', 'hc-inspect-why', this.#t('inspect.names', 'names')))
      for (const sig of names) {
        const button = el('button', 'hc-inspect-word', sig.slice(0, 12))
        button.type = 'button'
        button.title = sig
        button.addEventListener('click', () => this.push({ kind: 'resource', sig }))
        row.append(button)
      }
      out.push(row)
    }
    // A FILE ON A TILE CAN BE EDITED HERE (jwize, 2026-11-16: "so you can
    // potentially author upgrades"). The participant's own hand, so it is
    // written at once through the same door the chat's writes use, and the
    // file it replaces stays in the tile's history.
    const editable = !!frame.file && shown.text.length <= RESOURCE_CHARS && typeof ioc<TileFilesLike>(TILE_FILES_KEY)?.write === 'function'
    if (editable && this.#editing === frame.sig) {
      out.push(...this.#editor(frame as Extract<InspectFrame, { kind: 'resource' }> & { file: TileFileRef }, shown.text))
      return out
    }
    if (editable) {
      const edit = el('button', 'hc-inspect-act', this.#t('inspect.edit', 'Edit'))
      edit.type = 'button'
      edit.addEventListener('click', () => { this.#editing = frame.sig; this.#saved = []; void this.#render() })
      meta.append(edit)
    }
    if (this.#saved.length && frame.file) {
      const saved = el('div', 'hc-inspect-saved')
      for (const line of this.#saved) saved.append(el('div', undefined, line))
      out.push(saved)
    }
    const text = readable(shown.text)
    out.push(this.#code(text.slice(0, RESOURCE_CHARS), 0))
    if (text.length > RESOURCE_CHARS) {
      out.push(el('div', 'hc-inspect-note', this.#t('inspect.more-chars', '{count} more characters: read it with the command above.', { count: text.length - RESOURCE_CHARS })))
    }
    return out
  }

  /** The file as text to change, with Save and Cancel. The text is the
   *  file's own, never the indented copy the reading view shows. */
  #editor(frame: Extract<InspectFrame, { kind: 'resource' }> & { file: TileFileRef }, text: string): Node[] {
    const area = el('textarea', 'hc-inspect-edit')
    area.value = text
    area.spellcheck = false
    area.setAttribute('aria-label', frame.file.name)
    // Escape here leaves the edit, never the window round it.
    area.setAttribute('data-escape-local', '')
    const said = el('span', 'hc-inspect-edit-said')
    said.setAttribute('role', 'status')
    const save = el('button', 'hc-inspect-act hc-inspect-act-go', this.#t('inspect.save', 'Save'))
    save.type = 'button'
    const cancel = el('button', 'hc-inspect-act', this.#t('inspect.cancel', 'Cancel'))
    cancel.type = 'button'
    const leave = (): void => { this.#editing = null; void this.#render() }
    cancel.addEventListener('click', leave)
    area.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); leave(); return }
      // Tab is two spaces in a file, not the next button.
      if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        const at = area.selectionStart
        area.setRangeText('  ', at, area.selectionEnd, 'end')
      }
      if (event.key === 's' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save.click() }
    })
    save.addEventListener('click', () => {
      if (save.disabled) return
      save.disabled = true
      cancel.disabled = true
      said.textContent = this.#t('inspect.saving', 'Saving…')
      void this.#saveFile(frame, area.value).then(error => {
        if (!error) return
        save.disabled = false
        cancel.disabled = false
        said.textContent = this.#t('inspect.save-failed', 'It was not saved: {error}', { error })
      })
    })
    const acts = el('div', 'hc-inspect-acts')
    acts.append(save, cancel, said)
    queueMicrotask(() => area.focus())
    return [acts, area]
  }

  /** Write the file back, then show it as saved: its new signature, and on a
   *  managed site door what the page did when it ran with it. Resolves with
   *  why it was not saved, or '' when it was. */
  async #saveFile(frame: Extract<InspectFrame, { kind: 'resource' }> & { file: TileFileRef }, text: string): Promise<string> {
    const files = ioc<TileFilesLike>(TILE_FILES_KEY)
    if (typeof files?.write !== 'function') return this.#t('inspect.save-nowhere', 'files cannot be written here')
    let outcome: Awaited<ReturnType<NonNullable<TileFilesLike['write']>>>
    try { outcome = await files.write({ route: frame.file.route, kind: 'file', name: frame.file.name }, text) }
    catch (error) { return error instanceof Error ? error.message : String(error) }
    if (!outcome.ok) return outcome.error
    this.#saved = [outcome.unchanged
      ? this.#t('inspect.saved-same', 'Nothing changed: the file already held exactly this.')
      : this.#t('inspect.saved', 'Saved {name}.', { name: frame.file.name })]
    if (!outcome.unchanged) {
      try { this.#saved.push(...(await ioc<RunWatchLike>(RUN_WATCH_KEY)?.say?.() ?? [])) } catch { /* no card to ask */ }
    }
    this.#editing = null
    // The step now shows the file as it was saved.
    const top = this.#stack.length - 1
    if (this.#stack[top] === frame) this.#stack[top] = { ...frame, sig: outcome.sig }
    void this.#render()
    return ''
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
    // A module that ships one source file IS that file: it is read at once,
    // never listed as a list of one (the code tree opens modules by name).
    const section = frame.section
      ? sections.find(entry => entry.path === frame.section)
      : sections.length === 1 ? sections[0] : undefined
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

    let text = section ? module.text.slice(section.from, section.to) : module.text
    let mark = frame.at !== undefined ? lineAt(text, frame.at) : 0

    // THE FILE'S TYPESCRIPT, ON A PRESS (owner, 2026-11-16: "Host the
    // package's TypeScript without installing it, fetched only when a file
    // is opened"). What runs is compiled JavaScript. Where the package's own
    // layer names the atom holding this file as written, a button offers it.
    // Knowing that reads layers held here and asks no host; only the press
    // does. A package that names none, and a reader before this, draw no
    // button.
    const source = section ? await reader.typescriptFor?.(frame.sig, section.path).catch(() => undefined) : undefined
    if (source && reader.typescriptText) {
      const asked = this.#typescript === frame
      const toggle = el('button', 'hc-inspect-act', asked ? this.#t('inspect.compiled', 'As shipped') : this.#t('inspect.typescript', 'TypeScript'))
      toggle.type = 'button'
      toggle.addEventListener('click', () => { this.#typescript = asked ? null : frame; void this.#render() })
      meta.append(toggle)
      if (asked) {
        const read = await reader.typescriptText(source.atom, source.section, { signal: this.#reading?.signal })
          .catch(() => ({ ok: false as const, code: 'not-hosted' }))
        if (read.ok) {
          text = read.text
          // An offset into the compiled text is not a place in the TypeScript.
          mark = 0
          out.push(el('div', 'hc-inspect-lead', this.#t('inspect.typescript-lead',
            'TypeScript as published, read from {host}. A change made in this hive is not in it.', { host: read.host })))
        } else {
          out.push(el('div', 'hc-inspect-note', read.code === 'not-hosted'
            ? this.#t('inspect.typescript-not-hosted', 'The TypeScript of this package is not on the hosts this hive reads it from.')
            : this.#t('inspect.typescript-no-file', 'No TypeScript is hosted for this file.')))
        }
      }
    }

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

  /** Every decoration record on the tile, parsed; one that cannot be read is left out. */
  async #decorationRecords(layer: Record<string, unknown> | null): Promise<unknown[]> {
    const slot = layer?.['decorations']
    const store = ioc<StoreLike>('@hypercomb.social/Store')
    if (!Array.isArray(slot) || !store?.getResource) return []
    const records = await Promise.all(slot.map(String).filter(sig => SIG.test(sig)).map(async sig => {
      try {
        const blob = await store.getResource!(sig)
        return blob ? JSON.parse(await blob.text()) as unknown : null
      } catch { return null }
    }))
    return records.filter(record => record !== null)
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
.hc-inspect-act{border:1px solid rgba(${STEEL},0.35);background:rgba(${STEEL},0.06);color:inherit;cursor:pointer;
  padding:0.15rem 0.6rem;border-radius:var(--hc-radius-control, 2px);font-family:var(--hc-mono,monospace);font-size:0.72rem;}
.hc-inspect-act:hover:not(:disabled){background:rgba(${STEEL},0.16);}
.hc-inspect-act:disabled{opacity:0.55;cursor:progress;}
.hc-inspect-act-go{border-color:rgba(${AMBER},0.6);}
.hc-inspect-acts{display:flex;align-items:center;gap:0.5rem;flex:0 0 auto;}
.hc-inspect-edit-said{font-family:var(--hc-mono,monospace);font-size:0.72rem;color:rgba(${AMBER},0.9);}
.hc-inspect-edit{flex:1 1 auto;min-height:24rem;width:100%;box-sizing:border-box;resize:vertical;padding:0.5rem 0.6rem;
  border:1px solid rgba(${STEEL},0.3);border-radius:var(--hc-radius-control, 2px);background:rgba(255,255,255,0.03);color:inherit;
  font-family:var(--hc-code, var(--hc-mono, monospace));font-size:0.76rem;line-height:1.45;tab-size:2;white-space:pre;}
.hc-inspect-edit:focus{outline:none;border-color:rgba(${AMBER},0.7);}
.hc-inspect-saved{flex:0 0 auto;padding:0.35rem 0.5rem;border-left:2px solid rgba(${AMBER},0.6);
  font-family:var(--hc-mono,monospace);font-size:0.72rem;line-height:1.5;color:rgba(216,230,238,0.85);}
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
.hc-inspect-embedded{position:static;z-index:auto;inset:auto;width:auto;flex:1 1 auto;min-width:0;min-height:0;
  border:0;border-radius:0;background:none;padding:0.6rem 0.85rem;}
/* IN THE CHAT'S MAIN PANE (chat-code.ts): the lent element fills the pane and
   the conversation beside it steps aside while it is on. */
.chat-code-host{display:none;}
.chat-code-host.on{display:flex;flex:1 1 auto;min-width:0;min-height:0;}
.chat-code-host.on ~ .chat-reading{display:none;}
.hc-inspect-part{margin-top:0.35rem;font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;color:rgba(${STEEL},0.85);}
.hc-inspect-row{grid-template-columns:1.25rem 1fr auto;}
.hc-inspect-glyph{font-size:1rem;line-height:1;color:rgba(216,230,238,0.5);}
.hc-inspect-picture{align-self:flex-start;max-width:100%;max-height:60vh;object-fit:contain;
  border:1px solid rgba(${STEEL},0.15);border-radius:var(--hc-radius-control, 2px);background:rgba(255,255,255,0.03);}
`
    document.head.appendChild(style)
  }
}

/** THE VIEW, made on first use and kept. A dependency exports and never
 *  registers (doctrine: registration is the bee's act), so this is the
 *  module's own: the word's panel and the chat's code view share it wherever
 *  one bundle carries them both. */
let shared: InspectWindowView | null = null
export const inspectWindow = (): InspectWindowView => (shared ??= new InspectWindowView())

