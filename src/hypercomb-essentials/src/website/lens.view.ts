// website/lens.view.ts
//
// <hc-lens> — ONE WEBSITE TILE, PIECE BY PIECE (jwize, 2026-11-18: "this
// should be done tile by tile because every tile is its own unit"; "host
// containers with styles so we can view the actual render on each individual
// piece").
//
// A card for the tile you stand on, and a card for every tile that fills a
// trait its page states (and the traits those state, a few deep). Each card
// says its piece in the order a piece is built:
//
//   template   its page in the binding syntax (lens.model.ts readPage)
//   style      the sheets it links by signature and the CSS written inside it
//   host       its page running ALONE, in a sealed frame, with only its own look
//
// A piece is drawn alone on purpose: a part stands alone and carries its own
// appearance (website-artifact-paradigm.md), so a part that draws wrong here
// leans on a look it does not carry. The card says so, and warns each class no
// rule of its own names.
//
// ONE WAY. The lens reads; it never writes a byte, a mark or a layer.
//
// Every host runs sealed (page-run-gate.ts sealedWrapper), exactly as the
// revision viewer runs a version: an opaque origin, no network, nothing of the
// hive in reach. So a piece someone else made never runs as you here either.
//
// A dependency: it exports the element and registers nothing. The `lens` word
// (lens.queen.ts) defines it, adds it to the ShellSurfaceRegistry and opens it.

import {
  EffectBus, I18N_IOC_KEY, SITE_VIEW_IOC_KEY, TRAITS_IOC_KEY, traitFiller,
  type I18nProvider, type TraitProvider, type TraitResolution,
} from '@hypercomb/core'
import { sealedPageWindow, sealedWrapper } from '../presentation/tiles/page-run-gate.js'
import { FRAME_MAX_ONE, pageFrame, pageOfLayer, type FrameLayer, type FrameReader } from '../history/revision-viewer.model.js'
import { linkTargets, readPage, ruleCount, selectorClasses, unownedClasses, type LensLine, type LensRead, type LensSpan } from './lens.model.js'
import { readPanel, sourceText, type PanelRead, type SourceText } from './lens.panel.js'
import { traceRender, type Site, type Trace } from './lens.trace.js'

export const LENS_SURFACE = 'hc-lens'
export const LENS_OWNER = '@diamondcoreprocessor.com/Lens'
const STYLE_ID = 'hc-lens-style'

/** Traits followed this many tiles down from the one you stand on. */
const MAX_DEPTH = 3
/** Pieces drawn at most, so a page of many parts never builds forever. */
const MAX_PIECES = 40
/** How wide a host draws in the phone width. */
const PHONE_PX = 390
/** Code read back for a panel only up to this size, per file. */
const MAX_SOURCE_CHARS = 24 * 1024 * 1024
/** A panel's own drawing gets this long to settle after it is asked to draw. */
const SETTLE_MS = 120

/** What a panel element may answer to: the brood's open, refresh and close. */
type PanelElement = HTMLElement & { open?: () => unknown; refresh?: () => unknown; close?: () => unknown }

/** One panel, traced while it drew and read back to its code. */
interface PanelPiece {
  readonly tag: string
  readonly root: Element
  readonly read: PanelRead
  readonly styles: ReadonlyArray<{ id: string; css: string; rules: number }>
  /** The files its code was read from, by the name the stack gave them. */
  readonly files: readonly string[]
}

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<FrameLayer | null>
  getLayerBySig(layerSig: string): Promise<FrameLayer | null>
}
type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}
type PageResolver = { resolvePageSig?: (segments: readonly string[]) => Promise<string | null> }
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[]; explorerReplace?: (segments: readonly string[]) => void }
type Ioc = { get?: <T>(key: string) => T | undefined }

const ioc = (): Ioc | undefined => (window as { ioc?: Ioc }).ioc
const history = (): HistoryLike | undefined => ioc()?.get?.<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
const store = (): StoreLike | undefined => ioc()?.get?.<StoreLike>('@hypercomb.social/Store')
const lineage = (): LineageLike | undefined => ioc()?.get?.<LineageLike>('@hypercomb.social/Lineage')
/** Where the hive stands now. */
const standing = (): string[] => [...(lineage()?.explorerSegments?.() ?? [])].map(s => String(s ?? '').trim()).filter(Boolean)
/** A new secret for the frames of one opening: a link handed up without it is never followed. */
const freshToken = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')

const SIG = /^[0-9a-f]{64}$/

/** A word in the person's language, or the English one where a catalog has none yet. */
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const said = ioc()?.get?.<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    if (typeof said === 'string' && said && said !== key) return said
  } catch { /* the fallback below */ }
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

/** A counted phrase: the `.one` or `.other` form of a key, by the count. */
const counted = (key: string, one: string, other: string, n: number, params: Record<string, string | number> = {}): string =>
  n === 1 ? t(`${key}.one`, one, { ...params, n }) : t(`${key}.other`, other, { ...params, n })

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const route = (segments: readonly string[]): string => `/${segments.join('/')}`
const short = (sig: string): string => `${sig.slice(0, 8)}…`

/** One piece, read and ready to draw. */
interface Piece {
  readonly segments: readonly string[]
  /** The trait this piece fills in the piece above it; '' for the tile you stand on. */
  readonly fills: string
  readonly depth: number
  readonly pageSig: string
  readonly read: LensRead
  readonly sheets: ReadonlyArray<{ sig: string; file: string; rules: number | null }>
  readonly inlineRules: number
  readonly unowned: readonly string[]
  /** The sealed document its host runs, or null when its bytes are not here. */
  readonly doc: string | null
  /** Card id of the piece filling each trait word it states. */
  readonly fillers: ReadonlyMap<string, string>
}

export class LensElement extends HTMLElement {
  #open = false
  #ticket = 0
  #segments: string[] = []
  #root: HTMLDivElement | null = null
  #path: HTMLSpanElement | null = null
  #body: HTMLDivElement | null = null
  #off: Array<() => void> = []
  #bytes = new Map<string, Uint8Array>()
  #missing = new Set<string>()
  #pieces: Piece[] = []

  #panel: PanelPiece | null = null
  /** Tile mode follows the hive and the links pressed in its hosts; panel mode stays on its panel. */
  #mode: 'tile' | 'panel' = 'tile'
  /** Where the site was entered: a link never climbs above it. */
  #entry: string[] = []
  /** Where the hive stood when the lens last opened, so only a real move is followed. */
  #standing: string[] = []
  #token = ''
  /** Each host frame and the piece it draws, for the links it hands up. */
  readonly #frames = new Map<HTMLIFrameElement, Piece>()
  #followTimer: ReturnType<typeof setTimeout> | null = null

  get isOpen(): boolean { return this.#open }
  get pieces(): readonly Piece[] { return this.#pieces }
  get panel(): PanelPiece | null { return this.#panel }

  connectedCallback(): void { ensureStyles() }

  disconnectedCallback(): void {
    queueMicrotask(() => { if (!this.isConnected) this.close() })
  }

  /**
   * Open on the tile at `segments`: a card for it and for every tile filling
   * its traits. While it is open it FOLLOWS the hive: a link pressed in one of
   * its hosts walks the hive there (as the website view walks it), and
   * wherever the hive goes, by a link, the back gesture or a word, the lens
   * shows that location's pieces. `following` keeps the site's entry.
   */
  async open(segments: readonly string[], following = false): Promise<void> {
    ensureStyles()
    this.#build()
    const ticket = ++this.#ticket
    this.#segments = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (!following) this.#entry = [...this.#segments]
    this.#mode = 'tile'
    this.#standing = standing()
    this.#token = freshToken()
    this.#frames.clear()
    this.#pieces = []
    this.#open = true
    this.#root!.hidden = false
    this.#path!.textContent = route(this.#segments)
    this.#listen()
    this.#say(t('lens.reading', 'Reading the pieces…'))
    this.#root!.focus()

    const pieces: Piece[] = []
    const seen = new Set<string>()
    const walk = async (at: readonly string[], fills: string, depth: number, known: { pageSig?: string; layer?: FrameLayer | null }): Promise<void> => {
      if (ticket !== this.#ticket || pieces.length >= MAX_PIECES) return
      const key = route(at) + '|' + fills
      if (seen.has(key)) return
      seen.add(key)
      const layer = known.layer !== undefined ? known.layer : await this.#layerAt(at)
      const pageSig = known.pageSig ?? await this.#pageSigAt(at, layer)
      // A tile that wears no page is no piece; the lens says so when it is the one you stand on.
      if (!pageSig) return
      const fillers = new Map<string, { segments: readonly string[]; pageSig: string; layer: FrameLayer | null }>()
      if (depth < MAX_DEPTH) {
        for (const resolution of await this.#traitsAt(at)) {
          const filler = await this.#fillerOf(resolution)
          if (filler) fillers.set(resolution.word, filler)
        }
      }
      const piece = await this.#readPiece(at, fills, depth, pageSig, layer, fillers)
      if (ticket !== this.#ticket) return
      pieces.push(piece)
      for (const [word, filler] of fillers) await walk(filler.segments, word, depth + 1, { pageSig: filler.pageSig, layer: filler.layer })
    }
    await walk(this.#segments, '', 0, {})
    if (ticket !== this.#ticket) return
    this.#pieces = pieces
    if (pieces.length === 0) {
      this.#say(t('lens.no-page', '{where} wears no page. The lens reads website tiles: stand on one, or name one (lens /cafe-society).', { where: route(this.#segments) }))
      return
    }
    this.#draw()
  }

  /**
   * Open on a panel the code draws (`hc-brood`, or `brood`): it is drawn again
   * while the DOM is watched, and what it drew is said as a template beside a
   * copy of it. The panel is left as it was found: open if it was, closed if not.
   */
  async openPanel(name: string): Promise<void> {
    ensureStyles()
    this.#build()
    const ticket = ++this.#ticket
    const tag = panelTag(name)
    this.#mode = 'panel'
    this.#frames.clear()
    this.#pieces = []
    this.#panel = null
    this.#open = true
    this.#root!.hidden = false
    this.#path!.textContent = `<${tag}>`
    this.#listen()
    this.#say(t('lens.tracing', 'Watching <{tag}> draw…', { tag }))
    this.#root!.focus()

    const panel = document.querySelector(tag) as PanelElement | null
    if (!panel) {
      this.#say(t('lens.no-panel', 'No panel <{tag}> is in the shell. Open it once, then say lens again.', { tag }))
      return
    }
    const wasOpen = panel.childElementCount > 0
    let trace: Trace
    try {
      trace = await traceRender(async () => {
        panel.close?.()
        panel.open?.()
        if (typeof panel.refresh === 'function') await panel.refresh()
        await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
      })
    } catch (error) {
      this.#say(t('lens.trace-failed', '<{tag}> did not draw while watched ({reason}).', { tag, reason: String((error as Error)?.message ?? error) }))
      return
    }
    if (ticket !== this.#ticket) return

    const sources = await readSources(trace, panel)
    if (ticket !== this.#ticket) return
    const read = readPanel(panel, trace, url => sources.get(url))
    const styles = Array.from(document.querySelectorAll('style'))
      .filter(style => (style.textContent ?? '').includes(tag))
      .map(style => ({ id: style.id, css: style.textContent ?? '', rules: ruleCount(style.textContent ?? '') }))
    const piece: PanelPiece = { tag, root: panel, read, styles, files: [...sources.keys()].map(url => url.replace(/^.*\//, '')) }
    // The copy is taken before the panel is put back as it was found.
    const card = this.#panelCard(piece)
    if (!wasOpen) panel.close?.()
    this.#panel = piece
    this.#body?.replaceChildren(card)
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    this.#ticket++
    for (const off of this.#off.splice(0)) off()
    if (this.#root) this.#root.hidden = true
    if (this.#body) this.#body.replaceChildren()
    if (this.#followTimer) { clearTimeout(this.#followTimer); this.#followTimer = null }
    this.#frames.clear()
    this.#bytes.clear()
    this.#missing.clear()
    this.#pieces = []
    this.#panel = null
  }

  // ── reading the hive ───────────────────────────────────────────────

  async #bytesOf(sig: string, localOnly = false): Promise<Uint8Array | null> {
    const kept = this.#bytes.get(sig)
    if (kept) return kept
    const asked = (localOnly ? 'here:' : 'any:') + sig
    if (this.#missing.has(asked)) return null
    const s = store()
    const blob = await (localOnly && s?.getResourceResolvedLocal ? s.getResourceResolvedLocal(sig) : s?.getResource(sig))?.catch(() => null)
    if (!blob) { this.#missing.add(asked); return null }
    if (blob.size > FRAME_MAX_ONE) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    this.#bytes.set(sig, bytes)
    return bytes
  }

  readonly #reader: FrameReader = {
    bytes: (sig, localOnly) => this.#bytesOf(sig, localOnly),
    missing: sig => this.#missing.has('any:' + sig),
  }

  async #text(sig: string): Promise<string | null> {
    const bytes = await this.#bytesOf(sig)
    return bytes ? new TextDecoder().decode(bytes) : null
  }

  async #layerAt(segments: readonly string[]): Promise<FrameLayer | null> {
    const h = history()
    if (!h) return null
    const location = await h.sign({ explorerSegments: () => segments }).catch(() => '')
    return location ? await h.currentLayerAt(location).catch(() => null) : null
  }

  /** The page a tile wears: through the site view's one cascade, else read off its layer. */
  async #pageSigAt(segments: readonly string[], layer: FrameLayer | null): Promise<string | null> {
    const viaSite = await ioc()?.get?.<PageResolver>(SITE_VIEW_IOC_KEY)?.resolvePageSig?.(segments).catch(() => null)
    if (viaSite && SIG.test(viaSite)) return viaSite
    if (!layer) return null
    const { page } = await pageOfLayer(layer, this.#reader).catch(() => ({ page: null }))
    return page && SIG.test(page) ? page : null
  }

  async #traitsAt(segments: readonly string[]): Promise<readonly TraitResolution[]> {
    const traits = ioc()?.get?.<TraitProvider>(TRAITS_IOC_KEY)
    return traits?.resolveAt ? await traits.resolveAt(segments).catch(() => []) : []
  }

  /** The tile filling a trait, and the page it wears; null when nothing fills it with a page. */
  async #fillerOf(resolution: TraitResolution): Promise<{ segments: readonly string[]; pageSig: string; layer: FrameLayer | null } | null> {
    const sig = traitFiller(resolution)
    if (!sig) return null
    const at = 'route' in resolution ? resolution.route : []
    const layer = at.length ? await this.#layerAt(at) : await history()?.getLayerBySig(sig).catch(() => null) ?? null
    const pageSig = at.length ? await this.#pageSigAt(at, layer) : layer ? (await pageOfLayer(layer, this.#reader).catch(() => ({ page: null }))).page : null
    if (!pageSig || !SIG.test(pageSig)) return null
    return { segments: at.length ? at : [resolution.word], pageSig, layer }
  }

  async #readPiece(
    segments: readonly string[], fills: string, depth: number, pageSig: string, layer: FrameLayer | null,
    fillers: ReadonlyMap<string, { segments: readonly string[] }>,
  ): Promise<Piece> {
    const html = await this.#text(pageSig) ?? ''
    // First reading: what it links and writes. Then its own look is known, so
    // the second reading can warn the classes that look never names.
    const first = readPage(html)
    const sheets: Array<{ sig: string; file: string; rules: number | null }> = []
    let css = first.inlineCss
    for (const sheet of first.sheets) {
      const text = await this.#text(sheet.sig)
      sheets.push({ ...sheet, rules: text === null ? null : ruleCount(text) })
      if (text !== null) css += '\n' + text
    }
    const owned = selectorClasses(css)
    const read = readPage(html, { filled: word => fillers.has(word), owned: cls => owned.has(cls) })
    let doc: string | null = null
    if (html) {
      try {
        doc = sealedWrapper(await pageFrame(html, pageSig, layer ?? {}, segments, this.#reader, { depth: 2, links: true, token: this.#token }))
      } catch { doc = null }
    }
    const ids = new Map<string, string>()
    for (const [word, filler] of fillers) ids.set(word, cardId(filler.segments))
    return {
      segments, fills, depth, pageSig, read, sheets,
      inlineRules: ruleCount(first.inlineCss),
      unowned: unownedClasses(read.classes, css),
      doc, fillers: ids,
    }
  }

  // ── drawing ────────────────────────────────────────────────────────

  #build(): void {
    if (this.#root) return
    const root = this.#root = el('div', 'ln')
    root.tabIndex = -1
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', t('lens.title', 'Lens'))
    root.hidden = true
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); this.close() }
    })
    const bar = el('div', 'ln-bar')
    const title = el('div', 'ln-title')
    title.append(el('strong', '', t('lens.title', 'Lens')), this.#path = el('span', 'ln-path'))
    const hint = el('span', 'ln-hint', t('lens.hint', 'one way: the page as it binds, each piece drawn alone'))
    const close = el('button', 'ln-btn ln-close', '×')
    close.type = 'button'
    close.title = t('lens.close', 'Close')
    close.addEventListener('click', () => this.close())
    bar.append(title, hint, close)
    this.#body = el('div', 'ln-body')
    root.append(bar, this.#body)
    this.appendChild(root)
  }

  #listen(): void {
    for (const off of this.#off.splice(0)) off()
    this.#off.push(EffectBus.on<{ cmd?: string }>('keymap:invoke', payload => {
      if (payload?.cmd === 'global.escape' && this.#open) this.close()
    }))

    // A host's page hands up what it would have done itself. Only its own
    // window is heard, and a link counts only when the reader pressed it: it
    // carries this opening's secret and the press is still live, so a page's
    // own scripts can never walk the hive (the website view's rule).
    const fromFrame = (event: MessageEvent): void => {
      if (!this.#open || !event.source) return
      let piece: Piece | undefined
      for (const [frame, held] of this.#frames) if (sealedPageWindow(frame) === event.source) { piece = held; break }
      if (!piece) return
      const data = event.data as { hcFrameLink?: unknown; hcToken?: unknown; hcRevisionKey?: unknown } | null
      if (!data || typeof data !== 'object') return
      if (data.hcRevisionKey === 'Escape') { this.close(); return }
      const href = typeof data.hcFrameLink === 'string' ? data.hcFrameLink.trim() : ''
      if (!href || data.hcToken !== this.#token) return
      if (!(navigator as { userActivation?: { isActive?: boolean } }).userActivation?.isActive) return
      void this.#followLink(href, piece.segments)
    }
    window.addEventListener('message', fromFrame)
    this.#off.push(() => window.removeEventListener('message', fromFrame))

    // Wherever the hive goes, the lens goes: the pieces are per location.
    const line = lineage()
    if (line?.addEventListener) {
      const moved = (): void => {
        if (!this.#open || this.#mode !== 'tile') return
        if (this.#followTimer) clearTimeout(this.#followTimer)
        this.#followTimer = setTimeout(() => {
          this.#followTimer = null
          const here = standing()
          if (!here.length || here.join('/') === this.#standing.join('/')) return
          this.#standing = here
          if (here.join('/') !== this.#segments.join('/')) void this.open(here, true)
        }, 150)
      }
      line.addEventListener('change', moved)
      this.#off.push(() => line.removeEventListener('change', moved))
    }
  }

  /**
   * A link pressed in a host: read it the way the website view reads it, then
   * walk the hive there. The lens follows the hive, so it comes to that
   * location's pieces. A link that leaves the hive is said, not followed.
   */
  async #followLink(href: string, at: readonly string[]): Promise<void> {
    const targets = linkTargets(href, at, this.#entry)
    if (!targets.length) {
      EffectBus.emit('toast:show', { type: 'info', message: t('lens.link-out', '{href} leads out of the hive; the lens stays here.', { href }) })
      return
    }
    let chosen = targets[0]
    for (const target of targets) {
      if (await this.#pageSigAt(target, await this.#layerAt(target))) { chosen = target; break }
    }
    const line = lineage()
    if (typeof line?.explorerReplace === 'function') line.explorerReplace(chosen)
    else await this.open(chosen, true)
  }

  #say(text: string): void {
    this.#body?.replaceChildren(el('p', 'ln-note', text))
  }

  #draw(): void {
    const body = this.#body
    if (!body) return
    body.replaceChildren(...this.#pieces.map(piece => this.#card(piece)))
  }

  #card(piece: Piece): HTMLElement {
    const card = el('article', 'ln-card')
    card.id = cardId(piece.segments)
    card.style.setProperty('--ln-depth', String(piece.depth))

    const head = el('header', 'ln-card-head')
    const role = el('span', 'ln-role', piece.fills
      ? t('lens.fills', 'fills *trait="{word}"', { word: piece.fills })
      : t('lens.the-tile', 'the tile'))
    const where = el('span', 'ln-where', route(piece.segments))
    const sig = el('span', 'ln-sig', short(piece.pageSig))
    sig.title = piece.pageSig
    head.append(role, where, sig)

    const verdict = el('p', `ln-verdict ${verdictTone(piece)}`, verdictText(piece))

    const facts = el('p', 'ln-facts', [
      counted('lens.traits', '{n} trait', '{n} traits', piece.read.traits.length),
      counted('lens.sheets', '{n} linked sheet', '{n} linked sheets', piece.sheets.length),
      counted('lens.inline', '{n} inline rule', '{n} inline rules', piece.inlineRules),
      counted('lens.pictures', '{n} picture', '{n} pictures', piece.read.pictures),
      piece.read.behaviours.length ? t('lens.behaviours', 'behaviours: {list}', { list: piece.read.behaviours.join(', ') }) : '',
    ].filter(Boolean).join(' · '))

    const grid = el('div', 'ln-grid')
    grid.append(this.#template(piece), this.#host(piece))
    card.append(head, verdict, facts, grid, this.#style(piece))
    return card
  }

  #template(piece: Piece): HTMLElement {
    const box = el('section', 'ln-col')
    box.append(el('h3', 'ln-col-head', t('lens.template', 'template')))
    const pre = el('pre', 'ln-template')
    for (const line of piece.read.lines) {
      const row = el('div', 'ln-line')
      row.style.paddingLeft = `${line.depth * 1.1}rem`
      for (const span of line.spans) row.appendChild(this.#span(span, piece))
      pre.appendChild(row)
    }
    box.appendChild(pre)
    return box
  }

  #span(span: LensSpan, piece: Piece): HTMLElement {
    const node = el('span', `ln-t-${span.tone}`, span.text)
    if (span.note) node.title = span.note
    const target = span.trait ? piece.fillers.get(span.trait) : undefined
    if (target) {
      node.classList.add('ln-link')
      node.title = t('lens.go-filler', 'Go to the tile filling "{word}"', { word: span.trait! })
      node.addEventListener('click', () => this.querySelector(`#${CSS.escape(target)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
    return node
  }

  #host(piece: Piece): HTMLElement {
    const box = el('section', 'ln-col')
    const head = el('h3', 'ln-col-head', t('lens.host', 'host'))
    const widths = el('span', 'ln-widths')
    const stage = el('div', 'ln-stage')
    const frame = el('iframe', 'ln-frame')
    // Scripts only: an opaque origin, no storage, no way to the parent or the hive.
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.title = t('lens.host-of', 'The piece {where}, drawn alone', { where: route(piece.segments) })
    if (piece.doc) frame.srcdoc = piece.doc
    this.#frames.set(frame, piece)
    const width = (label: string, px: number | null): HTMLButtonElement => {
      const button = el('button', 'ln-btn ln-width', label)
      button.type = 'button'
      button.addEventListener('click', () => {
        frame.style.width = px ? `${px}px` : '100%'
        for (const other of Array.from(widths.children)) other.classList.toggle('on', other === button)
      })
      return button
    }
    const full = width(t('lens.width-full', 'full'), null)
    full.classList.add('on')
    widths.append(full, width(t('lens.width-phone', 'phone'), PHONE_PX))
    head.appendChild(widths)
    if (piece.doc) stage.appendChild(frame)
    else stage.appendChild(el('p', 'ln-note', t('lens.cold', 'This piece\'s page is not on this device yet.')))
    box.append(head, stage)
    return box
  }

  #style(piece: Piece): HTMLElement {
    const box = el('section', 'ln-style')
    box.appendChild(el('h3', 'ln-col-head', t('lens.style', 'style')))
    const list = el('ul', 'ln-sheets')
    for (const sheet of piece.sheets) {
      const item = el('li')
      const name = el('span', 'ln-t-binding', `[sheet]`)
      const sig = el('span', 'ln-t-value', ` "resource ${short(sheet.sig)}${sheet.file ? ` ${sheet.file}` : ''}"`)
      sig.title = sheet.sig
      const rules = el('span', sheet.rules === null ? 'ln-t-warn' : 'ln-t-muted',
        sheet.rules === null ? `  ${t('lens.sheet-missing', 'not on this device')}` : `  ${counted('lens.rules', '{n} rule', '{n} rules', sheet.rules)}`)
      item.append(name, sig, rules)
      list.appendChild(item)
    }
    if (piece.inlineRules > 0) {
      const item = el('li')
      item.append(el('span', 'ln-t-tag', '<style>'), el('span', 'ln-t-muted', `  ${counted('lens.rules', '{n} rule', '{n} rules', piece.inlineRules)} ${t('lens.written-inside', 'written inside the page')}`))
      list.appendChild(item)
    }
    if (!list.children.length) list.appendChild(el('li', 'ln-t-muted', t('lens.no-style', 'no look of its own')))
    box.appendChild(list)
    return box
  }

  // ── a panel the code draws ─────────────────────────────────────────

  #panelCard(piece: PanelPiece): HTMLElement {
    const { read } = piece
    const card = el('article', 'ln-card')
    const head = el('header', 'ln-card-head')
    head.append(el('span', 'ln-role', t('lens.panel', 'panel')), el('span', 'ln-where', `<${piece.tag}>`))

    const f = read.facts
    const drawn = [
      counted('lens.elements', '{n} element', '{n} elements', f.elements),
      counted('lens.bindings', '{n} binding', '{n} bindings', f.bindings),
      counted('lens.listeners', '{n} listener', '{n} listeners', f.listeners),
      counted('lens.loops', '{n} loop', '{n} loops', f.loops),
      counted('lens.conditions', '{n} condition', '{n} conditions', f.conditions),
    ].join(' · ')
    const verdict = el('p', `ln-verdict ${f.unread > 0 ? 'warn' : 'ok'}`, f.unread > 0
      ? counted('lens.panel-unread', 'Drawn by code. {n} thing it did could not be read back to its code; it is said by what it produced.', 'Drawn by code. {n} things it did could not be read back to their code; they are said by what they produced.', f.unread)
      : t('lens.panel-read', 'Drawn by code, every line read back to the code that made it. Point at a binding to see that code.'))
    const facts = el('p', 'ln-facts', `${drawn}${piece.files.length ? ` · ${t('lens.read-from', 'read from {files}', { files: piece.files.join(', ') })}` : ''}`)

    // The copy: the panel as it stands, in a root of its own, with only its own styles.
    const { host, map } = panelCopy(piece)
    const lineOf = new Map<Node, number>()
    read.nodes.forEach((node, index) => { if (node && !lineOf.has(node)) lineOf.set(node, index) })
    const copyLine = new Map<Node, number>()
    for (const [original, copy] of map) { const line = lineOf.get(original); if (line !== undefined) copyLine.set(copy, line) }

    const rows: HTMLElement[] = []
    let lit: Element | null = null
    const light = (copy: Element | null): void => {
      lit?.classList.remove('ln-hl')
      lit = copy
      lit?.classList.add('ln-hl')
    }

    const templateBox = el('section', 'ln-col')
    templateBox.append(el('h3', 'ln-col-head', t('lens.template', 'template')))
    const pre = el('pre', 'ln-template')
    read.lines.forEach((line: LensLine, index) => {
      const row = el('div', 'ln-line')
      row.style.paddingLeft = `${line.depth * 1.1}rem`
      for (const span of line.spans) {
        const node = el('span', `ln-t-${span.tone}`, span.text)
        if (span.note) node.title = span.note
        row.appendChild(node)
      }
      const node = read.nodes[index]
      const copy = node ? map.get(node) : undefined
      if (copy instanceof Element) {
        row.addEventListener('mouseenter', () => light(copy))
        row.addEventListener('mouseleave', () => light(null))
      }
      rows.push(row)
      pre.appendChild(row)
    })
    templateBox.appendChild(pre)

    const hostBox = el('section', 'ln-col')
    hostBox.append(el('h3', 'ln-col-head', t('lens.copy', 'as drawn')))
    const stage = el('div', 'ln-stage ln-stage-panel')
    stage.appendChild(host)
    hostBox.appendChild(stage)
    let rowLit: HTMLElement | null = null
    host.shadowRoot?.addEventListener('mouseover', event => {
      let target = event.target as Node | null
      while (target && !copyLine.has(target)) target = target.parentNode
      const row = target ? rows[copyLine.get(target)!] : undefined
      rowLit?.classList.remove('ln-line-hl')
      rowLit = row ?? null
      if (row) {
        row.classList.add('ln-line-hl')
        row.scrollIntoView({ block: 'nearest' })
        light(target as Element)
      }
    })
    host.shadowRoot?.addEventListener('mouseleave', () => { rowLit?.classList.remove('ln-line-hl'); rowLit = null; light(null) })

    const grid = el('div', 'ln-grid')
    grid.append(templateBox, hostBox)

    const style = el('section', 'ln-style')
    style.appendChild(el('h3', 'ln-col-head', t('lens.style', 'style')))
    const list = el('ul', 'ln-sheets')
    for (const sheet of piece.styles) {
      const item = el('li')
      item.append(el('span', 'ln-t-tag', `<style${sheet.id ? ` id="${sheet.id}"` : ''}>`), el('span', 'ln-t-muted', `  ${counted('lens.rules', '{n} rule', '{n} rules', sheet.rules)}`))
      list.appendChild(item)
    }
    if (!list.children.length) list.appendChild(el('li', 'ln-t-muted', t('lens.no-style', 'no look of its own')))
    style.appendChild(list)

    card.append(head, verdict, facts, grid, style)
    return card
  }
}

/** A panel's tag from what was said: `brood` or `hc-brood`. */
export const panelTag = (name: string): string => {
  const word = String(name ?? '').trim().toLowerCase().replace(/^<|>$/g, '')
  return word.includes('-') ? word : `hc-${word}`
}

/** The code the panel's traced sites name, read once per file (a file the page cannot read is left out). */
async function readSources(trace: Trace, root: Node): Promise<Map<string, SourceText>> {
  const urls = new Set<string>()
  const add = (site: Site | null | undefined): void => { if (site?.url) urls.add(site.url) }
  const inside = (node: Node): boolean => node === root || root.contains(node)
  for (const [node, ops] of trace.ops) if (inside(node)) for (const op of ops) add(op.site)
  for (const [node, site] of trace.placed) if (inside(node)) add(site)
  const sources = new Map<string, SourceText>()
  await Promise.all([...urls].map(async url => {
    try {
      const response = await fetch(url, { cache: 'force-cache' })
      if (!response.ok) return
      const text = await response.text()
      if (text.length <= MAX_SOURCE_CHARS) sources.set(url, sourceText(text))
    } catch { /* this file's lines are said by what they produced */ }
  }))
  return sources
}

/**
 * A copy of the panel as it stands, in a shadow root of its own with only the
 * styles that name its tag. The copy never runs: no listeners come with a
 * clone, and the panel's own element is not copied (it would wake again), only
 * what it holds, under a class standing in for its tag. Answers the host and
 * which copy stands for which node.
 */
function panelCopy(piece: PanelPiece): { host: HTMLElement; map: Map<Node, Node> } {
  const host = el('div', 'ln-copy')
  const shadow = host.attachShadow({ mode: 'open' })
  const stand = `ln-root-${piece.tag}`
  const tagRe = new RegExp(`(^|[^\\w.#-])${piece.tag.replace(/[-]/g, '\\-')}(?![\\w-])`, 'g')
  const style = document.createElement('style')
  style.textContent = `:host { display: block; position: relative; height: 100%; overflow: auto; transform: translateZ(0); contain: layout paint; }
.ln-hl { outline: 2px solid #a855f7 !important; outline-offset: 1px; }
${piece.styles.map(sheet => sheet.css.replace(tagRe, `$1.${stand}`)).join('\n')}`
  const wrap = document.createElement('div')
  wrap.className = stand
  const map = new Map<Node, Node>([[piece.root, wrap]])
  const pair = (original: Node, copy: Node): void => {
    map.set(original, copy)
    original.childNodes.forEach((child, index) => { const twin = copy.childNodes[index]; if (twin) pair(child, twin) })
  }
  for (const child of Array.from(piece.root.childNodes)) {
    const copy = child.cloneNode(true)
    wrap.appendChild(copy)
    pair(child, copy)
  }
  shadow.append(style, wrap)
  return { host, map }
}

/** A card's id, from its route: a filler's card is found by the route of the tile filling the trait. */
const cardId = (segments: readonly string[]): string =>
  'ln-' + segments.map(s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join('--')

const verdictTone = (piece: Piece): string => {
  if (piece.sheets.some(sheet => sheet.rules === null)) return 'warn'
  if (piece.unowned.length > 0) return 'warn'
  if (piece.read.classes.length === 0 && piece.inlineRules === 0 && piece.sheets.length === 0) return 'quiet'
  return 'ok'
}

const verdictText = (piece: Piece): string => {
  const missing = piece.sheets.filter(sheet => sheet.rules === null).length
  if (missing > 0) return counted('lens.verdict-missing', '{n} of its sheets is not on this device, so it cannot be judged alone yet.', '{n} of its sheets are not on this device, so it cannot be judged alone yet.', missing)
  if (piece.unowned.length > 0) {
    const shown = piece.unowned.slice(0, 6).join(', ') + (piece.unowned.length > 6 ? ', …' : '')
    return counted('lens.verdict-leans', 'Leans on a look it does not carry: {n} class no rule of its own names ({list}).', 'Leans on a look it does not carry: {n} classes no rule of its own names ({list}).', piece.unowned.length, { list: shown })
  }
  if (piece.read.classes.length === 0 && piece.inlineRules === 0 && piece.sheets.length === 0) {
    return t('lens.verdict-plain', 'Carries no look of its own: it draws with the browser\'s defaults.')
  }
  return t('lens.verdict-alone', 'Stands alone: every class it uses has a rule it carries.')
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const T = LENS_SURFACE
  style.textContent = `
${T} { display: contents; }
${T} [hidden] { display: none !important; }
${T} .ln {
  position: fixed; inset: 0; z-index: 2147483602; display: flex; flex-direction: column;
  background: rgb(var(--hc-panel-pane, 12, 14, 18)); color: var(--hc-window-ink-loud, #e8e8ea);
  font-family: var(--hc-mono, ui-monospace, monospace); font-size: 0.75rem; outline: none;
}
${T} .ln-bar {
  display: flex; align-items: center; gap: 0.75rem; padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--hc-window-line, rgba(255, 255, 255, 0.12));
}
${T} .ln-title { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; overflow: hidden; }
${T} .ln-title strong { font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.68rem; color: var(--hc-window-accent, #c8975a); }
${T} .ln-path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--hc-window-ink-plain, #c9c9cd); }
${T} .ln-hint { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--hc-window-ink-quiet, #9a9aa0); }
${T} .ln-btn {
  flex-shrink: 0; padding: 0.2rem 0.55rem; border-radius: 2px; cursor: pointer; font: inherit;
  background: var(--hc-window-tint, rgba(255, 255, 255, 0.06)); color: var(--hc-window-ink-plain, #c9c9cd);
  border: 1px solid var(--hc-window-line, rgba(255, 255, 255, 0.12));
}
${T} .ln-btn:hover, ${T} .ln-btn.on { background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.12)); color: var(--hc-window-ink-loud, #fff); }
${T} .ln-close { font-size: 1rem; line-height: 1; padding: 0.15rem 0.5rem; }
${T} .ln-body { flex: 1; overflow: auto; padding: 0.75rem; display: flex; flex-direction: column; gap: 1rem; }
${T} .ln-note { color: var(--hc-window-ink-quiet, #9a9aa0); margin: 1rem; }
${T} .ln-card {
  border: 1px solid var(--hc-window-line, rgba(255, 255, 255, 0.12)); border-radius: 3px; padding: 0.6rem 0.75rem;
  margin-left: calc(var(--ln-depth, 0) * 1.25rem); scroll-margin-top: 0.75rem;
}
${T} .ln-card-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
${T} .ln-role { color: #a855f7; }
${T} .ln-where { color: var(--hc-window-ink-loud, #fff); font-weight: 600; }
${T} .ln-sig { color: var(--hc-window-ink-quiet, #9a9aa0); }
${T} .ln-verdict { margin: 0.4rem 0 0.2rem; }
${T} .ln-verdict.ok { color: #10b981; }
${T} .ln-verdict.warn { color: #d97706; }
${T} .ln-verdict.quiet { color: var(--hc-window-ink-quiet, #9a9aa0); }
${T} .ln-facts { margin: 0 0 0.5rem; color: var(--hc-window-ink-quiet, #9a9aa0); }
${T} .ln-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.75rem; }
@media (max-width: 900px) { ${T} .ln-grid { grid-template-columns: minmax(0, 1fr); } }
${T} .ln-col { min-width: 0; display: flex; flex-direction: column; }
${T} .ln-col-head {
  display: flex; align-items: center; justify-content: space-between; margin: 0 0 0.3rem;
  font-size: 0.65rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--hc-window-ink-quiet, #9a9aa0);
}
${T} .ln-widths { display: flex; gap: 0.3rem; text-transform: none; letter-spacing: 0; font-weight: 400; }
/* The code boxes keep one dark ground in every theme, so the binding colours always read. */
${T} .ln-template, ${T} .ln-sheets { background: #15171c; color: #e8e8ea; border-radius: 3px; font-variant-ligatures: none; }
${T} .ln-template {
  margin: 0; padding: 0.5rem; max-height: 28rem; overflow: auto; line-height: 1.5; white-space: pre; font: inherit;
}
${T} .ln-stage {
  height: 28rem; resize: vertical; overflow: hidden; border-radius: 3px; display: flex; justify-content: center;
  background: repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px;
}
${T} .ln-frame { width: 100%; height: 100%; border: 0; background: #fff; transition: width 0.2s ease; }
${T} .ln-style { margin-top: 0.6rem; }
${T} .ln-sheets { list-style: none; margin: 0; padding: 0.4rem 0.5rem; display: flex; flex-direction: column; gap: 0.15rem; }
${T} .ln-t-punct { color: #8b8f98; }
${T} .ln-t-tag { color: #7dd3fc; }
${T} .ln-t-attr { color: #a5b4fc; }
${T} .ln-t-value { color: #fca5a5; }
${T} .ln-t-binding { color: #fde68a; }
${T} .ln-t-trait { color: #c792ea; font-weight: 600; }
${T} .ln-t-text { color: #e8e8ea; }
${T} .ln-t-behaviour { color: #5eead4; font-style: italic; }
${T} .ln-t-warn { color: #fbbf24; text-decoration: underline wavy rgba(251, 191, 36, 0.7); }
${T} .ln-t-muted { color: #8b8f98; font-style: italic; }
${T} .ln-link { cursor: pointer; text-decoration: underline dotted; }
${T} .ln-link:hover { color: #e9d5ff; }
${T} .ln-t-flow { color: #f0abfc; font-weight: 600; }
${T} .ln-line { border-radius: 2px; }
${T} .ln-line:hover, ${T} .ln-line.ln-line-hl { background: rgba(168, 85, 247, 0.22); }
${T} .ln-stage-panel { display: block; }
${T} .ln-copy { width: 100%; height: 100%; }
`
  document.head.appendChild(style)
}
