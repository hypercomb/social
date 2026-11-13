// history/revision-viewer.view.ts
//
// <hc-revision-viewer> — THE REVISIONS OF ONE WEBSITE TILE, flipped through
// above the website itself (jwize, 2026-11-12: "a revision viewer that comes up
// above the webs creation", "so when the business card is showing I can narrow
// it down", "this is a per tile not group like history").
//
// It lists the tile's own versions (its lineage's markers, oldest to newest)
// on a slider, shows each version's page running in a sandboxed frame over the
// live site, groups the versions into runs that show the same page, and
// narrows a range down: mark one version that looks right and one that looks
// wrong, and it shows the version in the middle until the two are side by
// side. A version written while it is open joins the list.
//
// A dependency: it exports the element and registers nothing. The `revisions`
// word (revisions.queen.ts) defines it, adds it to the ShellSurfaceRegistry and
// opens it. What a version is and how its frame is built is the model's
// (revision-viewer.model.ts); this file only reads the hive and draws.
//
// KEYS. The slider holds focus while the viewer is open: the arrow keys move it
// natively, and the hive's keymap leaves keys alone while an input has focus,
// so flipping never moves the hive's selection behind. A page's own keys stay
// in its frame; the frame hands Escape and Alt+Left/Right up to the viewer.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  changedAt, FRAME_MAX_ONE, judge, leftBetween, NARROWING_START, nextToLook, pageOfLayer, runsOf, versionFrame,
  type FrameReader, type LayerLike, type Narrowing, type PageRun, type Version,
} from './revision-viewer.model.js'

export const REVISION_VIEWER_SURFACE = 'hc-revision-viewer'
export const REVISION_VIEWER_OWNER = '@diamondcoreprocessor.com/RevisionViewer'
const STYLE_ID = 'hc-revision-viewer-style'

/** Bytes kept across versions (records are immutable, so a read serves every version). */
const MAX_KEPT_BYTES = 64 * 1024 * 1024
/** Built frames kept, so flipping back and forth does not read the hive again. */
const KEPT_FRAMES = 6
/** The hive says a version was written a moment before its list holds it: read the list after this. */
const RELIST_MS = 300

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  listLayers(locationSig: string): Promise<Array<{ layerSig: string; at: number; index: number }>>
  getLayerBySig(layerSig: string): Promise<LayerLike | null>
}
type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}
type Ioc = { get?: <T>(key: string) => T | undefined }

const ioc = (): Ioc | undefined => (window as { ioc?: Ioc }).ioc
const history = (): HistoryLike | undefined => ioc()?.get?.<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
const store = (): StoreLike | undefined => ioc()?.get?.<StoreLike>('@hypercomb.social/Store')
const i18n = (): (I18nProvider & Partial<EventTarget>) | undefined => ioc()?.get?.<I18nProvider & Partial<EventTarget>>(I18N_IOC_KEY)

/** A word in the person's language, or the English one where a catalog has none yet. */
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const value = i18n()?.t?.(key, params)
    if (typeof value === 'string' && value && value !== key) return value
  } catch { /* the fallback below */ }
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

/** A version's time, in the language the page is set to. */
const when = (at: number | null): string => {
  if (!at) return ''
  const lang = (typeof document !== 'undefined' && document.documentElement.lang) || undefined
  return new Date(at).toLocaleString(lang, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** What one version shows: its page, and the document its frame runs, or why it cannot. */
type Built = { readonly page: string | null; readonly doc: string | null; readonly problem: 'cold' | 'no-page' | null }

/** A labelled part: redrawn in the current language every time the viewer opens. */
type Labelled = { node: HTMLElement; apply: () => void }

// A host with no DOM (a CLI, a build, a test world without one) can import this module.
const ElementBase: typeof HTMLElement = typeof HTMLElement === 'undefined'
  ? (class {} as unknown as typeof HTMLElement)
  : HTMLElement

export class RevisionViewerElement extends ElementBase {
  #segments: string[] = []
  #location = ''
  #versions: Version[] = []
  /** The page each version shows, once read (index -> sig or null). */
  #pages = new Map<number, string | null>()
  #at = -1
  #narrowing: Narrowing = NARROWING_START
  #open = false
  #ticket = 0
  #scan = 0
  #relist: ReturnType<typeof setTimeout> | null = null
  #frames = new Map<string, Built>()
  /** Bytes already read, by signature, in reading order (the oldest leave first). */
  #bytes = new Map<string, Uint8Array>()
  #keptBytes = 0
  /** Signatures asked for and not found, until the next open or retry. */
  #missing = new Set<string>()
  #off: (() => void)[] = []
  #built = false
  #labels: Labelled[] = []

  // the parts
  #root: HTMLDivElement | null = null
  #path: HTMLSpanElement | null = null
  #slider: HTMLInputElement | null = null
  #position: HTMLSpanElement | null = null
  #runs: HTMLDivElement | null = null
  #narrow: HTMLDivElement | null = null
  #frame: HTMLIFrameElement | null = null
  #note: HTMLDivElement | null = null
  #retry: HTMLButtonElement | null = null

  get isOpen(): boolean { return this.#open }
  get position(): number { return this.#at }
  get versions(): readonly Version[] { return this.#versions }
  get narrowing(): Narrowing { return this.#narrowing }

  connectedCallback(): void { ensureStyles() }

  disconnectedCallback(): void {
    queueMicrotask(() => { if (!this.isConnected) this.close() })
  }

  /** Open over the tile at `segments`, at its newest version. */
  async open(segments: readonly string[]): Promise<void> {
    ensureStyles()
    this.#build()
    this.#segments = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    this.#narrowing = NARROWING_START
    this.#versions = []
    this.#at = -1
    this.#pages.clear()
    this.#frames.clear()
    this.#missing.clear()
    this.#scan++
    this.#ticket++
    if (this.#frame) this.#frame.srcdoc = ''
    for (const label of this.#labels) label.apply()
    this.#open = true
    this.#root!.hidden = false
    this.#path!.textContent = '/' + this.#segments.join('/')
    this.#listen()
    this.#draw()
    const h = history()
    const location = h ? await h.sign({ explorerSegments: () => this.#segments }).catch(() => '') : ''
    if (!this.#open) return
    this.#location = location
    await this.#readVersions(true)
    this.#slider?.focus()
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    this.#ticket++
    this.#scan++
    if (this.#relist) { clearTimeout(this.#relist); this.#relist = null }
    for (const off of this.#off.splice(0)) off()
    if (this.#root) this.#root.hidden = true
    if (this.#frame) this.#frame.srcdoc = ''
    this.#frames.clear()
    this.#bytes.clear()
    this.#keptBytes = 0
    this.#missing.clear()
  }

  /** Show the version at `index` (a position in the list, oldest first). */
  show(index: number): void {
    if (!this.#versions.length) return
    const at = Math.max(0, Math.min(this.#versions.length - 1, Math.round(index)))
    this.#at = at
    this.#draw()
    void this.#load(at)
  }

  older(): void { this.show(this.#at - 1) }
  newer(): void { this.show(this.#at + 1) }

  /** The version on screen looks right (or wrong); move to the middle of what is left. */
  mark(right: boolean): void {
    if (this.#at < 0) return
    this.#narrowing = judge(this.#narrowing, this.#at, right)
    const next = nextToLook(this.#narrowing)
    if (next !== null) this.show(next)
    else this.#draw()
  }

  startOver(): void {
    this.#narrowing = NARROWING_START
    this.#draw()
  }

  // ── reading the hive ───────────────────────────────────────────────

  async #readVersions(toNewest: boolean): Promise<void> {
    const h = history()
    const listed = h && this.#location ? await h.listLayers(this.#location).catch(() => []) : []
    if (!this.#open) return
    this.#versions = listed.map((entry, index) => ({ index, layerSig: entry.layerSig, at: entry.at > 0 ? entry.at : null }))
    if (!this.#versions.length) {
      this.#at = -1
      if (this.#frame) this.#frame.srcdoc = ''
      this.#draw()
      this.#say(t('revisions.none', 'This tile has no versions.'))
      return
    }
    this.show(toNewest || this.#at < 0 ? this.#versions.length - 1 : this.#at)
    void this.#scanPages()
  }

  /** Read which page every version shows, newest first, so the runs strip says
   *  at once where the page changed. One version at a time, behind the one on screen. */
  async #scanPages(): Promise<void> {
    const scan = ++this.#scan
    for (let i = this.#versions.length - 1; i >= 0; i--) {
      if (scan !== this.#scan || !this.#open) return
      if (this.#pages.has(i)) continue
      const version = this.#versions[i]!
      const layer = await history()?.getLayerBySig(version.layerSig).catch(() => null)
      if (!layer || scan !== this.#scan) continue
      const read = await this.#pageOf(layer)
      if (!read.missed) this.#pages.set(i, read.page)
      if (i % 8 === 0) this.#drawRuns()
    }
    if (scan === this.#scan) this.#drawRuns()
  }

  #listen(): void {
    for (const off of this.#off.splice(0)) off()
    // A new version of this tile joins the list. The hive says a marker was
    // written a moment before the list it serves holds it, so the list is read
    // after a pause, and once more if it has not grown yet.
    this.#off.push(EffectBus.on<{ lineageSig?: string }>('history:marker-wrote', payload => {
      if (!this.#open || !this.#location || payload?.lineageSig !== this.#location) return
      const atNewest = this.#at === this.#versions.length - 1
      const had = this.#versions.length
      if (this.#relist) clearTimeout(this.#relist)
      this.#relist = setTimeout(async () => {
        this.#relist = null
        await this.#readVersions(atNewest)
        if (this.#open && this.#versions.length === had) {
          this.#relist = setTimeout(() => { this.#relist = null; void this.#readVersions(atNewest) }, RELIST_MS * 4)
        }
      }, RELIST_MS)
    }))
    this.#off.push(EffectBus.on<{ cmd?: string }>('keymap:invoke', payload => {
      if (payload?.cmd === 'global.escape' && this.#open) this.close()
    }))
    // The frame's keys, handed up by its stand-in.
    const fromFrame = (event: MessageEvent): void => {
      if (!this.#open || !this.#frame || event.source !== this.#frame.contentWindow) return
      const key = (event.data as { hcRevisionKey?: unknown } | null)?.hcRevisionKey
      if (key === 'Escape') this.close()
      else if (key === 'ArrowLeft') { this.older(); this.#slider?.focus() }
      else if (key === 'ArrowRight') { this.newer(); this.#slider?.focus() }
    }
    window.addEventListener('message', fromFrame)
    this.#off.push(() => window.removeEventListener('message', fromFrame))
    // New words when the language changes.
    const words = i18n()
    if (words?.addEventListener) {
      const relabel = (): void => { for (const label of this.#labels) label.apply(); this.#draw() }
      words.addEventListener('change', relabel)
      this.#off.push(() => words.removeEventListener?.('change', relabel))
    }
  }

  /** One file's bytes: kept once read, never one larger than a frame can carry. */
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
    this.#keptBytes += bytes.length
    for (const [old, oldBytes] of this.#bytes) {
      if (this.#keptBytes <= MAX_KEPT_BYTES) break
      this.#bytes.delete(old)
      this.#keptBytes -= oldBytes.length
    }
    return bytes
  }

  /** How the shared frame builder reads this viewer's bytes. */
  readonly #reader: FrameReader = {
    bytes: (sig, localOnly) => this.#bytesOf(sig, localOnly),
    missing: sig => this.#missing.has('any:' + sig),
  }

  /** The page a version shows, and whether a record it needed was missing (then it may simply not be here yet). */
  #pageOf(layer: LayerLike): Promise<{ page: string | null; missed: boolean }> {
    return pageOfLayer(layer, this.#reader)
  }

  /** Everything one version's frame needs, read from the hive once and kept (revision-viewer.model.ts versionFrame). */
  async #frameOf(version: Version): Promise<Built> {
    const kept = this.#frames.get(version.layerSig)
    if (kept) return kept
    const layer = await history()?.getLayerBySig(version.layerSig).catch(() => null)
    if (!layer) return { page: null, doc: null, problem: 'cold' }
    const framed = await versionFrame(layer, this.#segments, this.#reader)
    if (framed.settled) this.#pages.set(version.index, framed.page)
    const built: Built = { page: framed.page, doc: framed.doc, problem: framed.problem }
    // Only an answer that will not change is kept: a cold one is asked again.
    return framed.problem === 'cold' ? built : this.#keep(version.layerSig, built)
  }

  #keep(layerSig: string, built: Built): Built {
    this.#frames.set(layerSig, built)
    while (this.#frames.size > KEPT_FRAMES) this.#frames.delete(this.#frames.keys().next().value as string)
    return built
  }

  async #load(index: number): Promise<void> {
    const version = this.#versions[index]
    if (!version || !this.#frame) return
    const ticket = ++this.#ticket
    this.#say(t('revisions.loading', 'Loading this version…'))
    const built = await this.#frameOf(version).catch((): Built => ({ page: null, doc: null, problem: 'cold' }))
    if (ticket !== this.#ticket || !this.#open) return
    this.#drawRuns()
    if (built.problem === 'cold') { this.#say(t('revisions.cold', 'This version is not on this device yet.'), true); this.#frame.srcdoc = ''; return }
    if (built.problem === 'no-page') { this.#say(t('revisions.no-page', 'This version has no page.')); this.#frame.srcdoc = ''; return }
    this.#say('')
    this.#frame.srcdoc = built.doc ?? ''
  }

  // ── drawing ────────────────────────────────────────────────────────

  /** A button whose words come from the catalog, redrawn on open and on a language change. */
  #button(className: string, glyph: string | null, key: string, fallback: string, act: () => void): HTMLButtonElement {
    const button = el('button', className)
    button.type = 'button'
    this.#labels.push({
      node: button,
      apply: () => {
        const words = t(key, fallback)
        if (glyph === null) button.textContent = words
        else { button.textContent = glyph; button.setAttribute('aria-label', words); button.title = words }
      },
    })
    // After any button, focus goes back to the slider: the arrows keep flipping
    // and never reach the hive's keymap.
    button.addEventListener('click', () => { act(); this.#slider?.focus() })
    return button
  }

  #build(): void {
    if (this.#built) return
    this.#built = true
    const root = this.#root = el('div', 'rv')
    root.hidden = true
    root.tabIndex = -1
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    this.#labels.push({ node: root, apply: () => root.setAttribute('aria-label', t('revisions.title', 'Revisions')) })
    // Escape and the wheel are this panel's while it is open, not the site's or the hive's.
    root.setAttribute('data-escape-local', '')
    root.setAttribute('data-consumes-wheel', '')
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); this.close() }
    })

    const bar = el('header', 'rv-bar')
    const title = el('span', 'rv-title')
    const name = el('strong')
    this.#labels.push({ node: name, apply: () => { name.textContent = t('revisions.title', 'Revisions') } })
    const path = this.#path = el('span', 'rv-path')
    title.append(name, path)

    const older = this.#button('rv-btn', '‹', 'revisions.older', 'Older version', () => this.older())
    const slider = this.#slider = el('input', 'rv-slider')
    slider.type = 'range'
    slider.min = '0'
    slider.step = '1'
    this.#labels.push({ node: slider, apply: () => slider.setAttribute('aria-label', t('revisions.slider', 'Versions, oldest to newest')) })
    slider.addEventListener('input', () => this.show(Number(slider.value)))
    const newer = this.#button('rv-btn', '›', 'revisions.newer', 'Newer version', () => this.newer())
    const position = this.#position = el('span', 'rv-position')

    const right = this.#button('rv-btn rv-right', null, 'revisions.right', 'Looks right', () => this.mark(true))
    const wrong = this.#button('rv-btn rv-wrong', null, 'revisions.wrong', 'Looks wrong', () => this.mark(false))
    const over = this.#button('rv-btn', null, 'revisions.reset', 'Start over', () => this.startOver())
    const close = this.#button('rv-btn rv-close', '×', 'revisions.close', 'Close', () => this.close())

    bar.append(title, older, slider, newer, position, right, wrong, over, close)
    const runs = this.#runs = el('div', 'rv-runs')
    const narrow = this.#narrow = el('div', 'rv-narrow')
    narrow.setAttribute('aria-live', 'polite')

    const stage = el('div', 'rv-stage')
    const frame = this.#frame = el('iframe', 'rv-frame')
    // The version's page runs with scripts only: an opaque origin, no storage,
    // no way to the parent or the hive (and no network: the model's policy).
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    this.#labels.push({ node: frame, apply: () => frame.setAttribute('title', t('revisions.title', 'Revisions')) })
    const note = this.#note = el('div', 'rv-note')
    note.setAttribute('role', 'status')
    const retry = this.#retry = this.#button('rv-btn', null, 'revisions.retry', 'Try again', () => {
      const version = this.#versions[this.#at]
      if (!version) return
      this.#frames.delete(version.layerSig)
      this.#missing.clear()
      void this.#load(this.#at)
    })
    retry.hidden = true
    note.append(el('span'), retry)
    stage.append(frame, note)

    root.append(bar, runs, narrow, stage)
    this.replaceChildren(root)
  }

  #say(text: string, offerRetry = false): void {
    if (!this.#note) return
    ;(this.#note.firstChild as HTMLElement).textContent = text
    this.#note.hidden = !text
    if (this.#retry) this.#retry.hidden = !offerRetry
  }

  #draw(): void {
    if (!this.#root) return
    const count = this.#versions.length
    if (this.#slider) {
      this.#slider.max = String(Math.max(0, count - 1))
      this.#slider.value = String(Math.max(0, this.#at))
      this.#slider.disabled = count < 2
    }
    const version = this.#versions[this.#at]
    if (this.#position) {
      this.#position.textContent = version
        ? `${t('revisions.position', 'Version {n} of {count}', { n: this.#at + 1, count })}${version.at ? ' · ' + when(version.at) : ''}`
        : ''
    }
    this.#drawRuns()
    this.#drawNarrowing()
  }

  /** The runs of versions that show the same page, as far as they are read. */
  #drawRuns(): void {
    if (!this.#runs) return
    const count = this.#versions.length
    // UNREAD is a version not read yet (no run drawn), '' one read with no page.
    const pages = Array.from({ length: count }, (_, i) => this.#pages.has(i) ? (this.#pages.get(i) ?? '') : UNREAD)
    const runs: PageRun[] = runsOf(pages)
    const strip: HTMLElement[] = []
    for (const run of runs) {
      if (run.page === UNREAD) continue
      const cell = el('button', 'rv-run')
      cell.type = 'button'
      cell.style.left = `${(run.from / Math.max(1, count)) * 100}%`
      cell.style.width = `${Math.max(0.6, ((run.to - run.from + 1) / Math.max(1, count)) * 100)}%`
      cell.style.setProperty('--rv-hue', String(hueOf(run.page)))
      const label = run.page
        ? t('revisions.page-run', 'Page {page} · versions {from}–{to}', { page: run.page.slice(0, 8), from: run.from + 1, to: run.to + 1 })
        : t('revisions.no-page', 'This version has no page.')
      cell.title = label
      cell.setAttribute('aria-label', label)
      cell.addEventListener('click', () => { this.show(run.to); this.#slider?.focus() })
      if (this.#at >= run.from && this.#at <= run.to) cell.classList.add('here')
      strip.push(cell)
    }
    const { right, wrong } = this.#narrowing
    for (const [index, kind] of [[right, 'right'], [wrong, 'wrong']] as const) {
      if (index === null) continue
      const pin = el('span', `rv-pin ${kind}`)
      pin.style.left = `${((index + 0.5) / Math.max(1, count)) * 100}%`
      strip.push(pin)
    }
    this.#runs.replaceChildren(...strip)
  }

  #drawNarrowing(): void {
    if (!this.#narrow) return
    const found = changedAt(this.#narrowing)
    const next = nextToLook(this.#narrowing)
    const left = leftBetween(this.#narrowing)
    let text: string
    if (found !== null) {
      const version = this.#versions[found]
      text = t('revisions.narrow-found', 'It changed at version {n}.', { n: found + 1 }) + (version?.at ? ' · ' + when(version.at) : '')
    } else if (next !== null && left !== null) {
      text = t('revisions.narrow-next', '{left} versions between them. Next: version {n}.', { left, n: next + 1 })
    } else {
      text = t('revisions.narrow-hint', 'Mark one version that looks right and one that looks wrong.')
    }
    this.#narrow.textContent = text
  }
}

const UNREAD = '?'

/** A steady hue per page, so a run reads as the same page wherever it appears. */
const hueOf = (page: string | null): number => (page ? parseInt(page.slice(0, 6), 16) % 360 : 0)

// The look: a dark bar over a frame that fills the screen, above the website
// (whose host is 59988), its exit button (2147483600) and its menu (2147483601):
// while the viewer is open it is the one way out, by its own close or Escape.
function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const T = REVISION_VIEWER_SURFACE
  style.textContent = `
${T} { display: contents; }
${T} [hidden] { display: none !important; }
${T} .rv {
  position: fixed; inset: 0; z-index: 2147483602; display: flex; flex-direction: column;
  background: rgb(var(--hc-panel-pane, 12, 14, 18)); color: var(--hc-window-ink-loud, #e8e8ea);
  font-family: var(--hc-mono, ui-monospace, monospace); font-size: 0.72rem; outline: none;
}
${T} .rv-bar {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--hc-window-line, rgba(255, 255, 255, 0.12));
}
${T} .rv-title { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; flex-shrink: 1; overflow: hidden; }
${T} .rv-title strong { font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.66rem; color: var(--hc-window-accent, #c8975a); }
${T} .rv-path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--hc-window-ink-plain, #c9c9cd); }
${T} .rv-slider { flex: 1 1 12rem; min-width: 6rem; accent-color: var(--hc-window-accent, #c8975a); }
${T} .rv-position { white-space: nowrap; color: var(--hc-window-ink-quiet, #9a9aa0); min-width: 9rem; }
${T} .rv-btn {
  flex-shrink: 0; padding: 0.25rem 0.6rem; border-radius: 4px; cursor: pointer; font: inherit;
  background: var(--hc-window-tint, rgba(255, 255, 255, 0.06)); color: var(--hc-window-ink-plain, #c9c9cd);
  border: 1px solid var(--hc-window-line, rgba(255, 255, 255, 0.12));
}
${T} .rv-btn:hover { background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.12)); color: var(--hc-window-ink-loud, #fff); }
${T} .rv-right { border-color: color-mix(in srgb, #34d399 45%, transparent); }
${T} .rv-wrong { border-color: color-mix(in srgb, #f87171 45%, transparent); }
${T} .rv-close { font-size: 0.95rem; line-height: 1; padding: 0.2rem 0.5rem; }
${T} .rv-runs { position: relative; height: 0.75rem; margin: 0.35rem 0.75rem 0; }
${T} .rv-run {
  position: absolute; top: 0; height: 100%; min-width: 0.5rem; padding: 0; border: 0; border-radius: 2px; cursor: pointer;
  background: hsl(var(--rv-hue, 0) 55% 45% / 0.55);
}
${T} .rv-run.here { outline: 1px solid var(--hc-window-ink-loud, #fff); }
${T} .rv-pin { position: absolute; top: -0.2rem; width: 2px; height: calc(100% + 0.4rem); transform: translateX(-1px); pointer-events: none; }
${T} .rv-pin.right { background: #34d399; }
${T} .rv-pin.wrong { background: #f87171; }
${T} .rv-narrow { padding: 0.3rem 0.75rem 0.45rem; color: var(--hc-window-ink-quiet, #9a9aa0); }
${T} .rv-stage { position: relative; flex: 1; min-height: 0; border-top: 1px solid var(--hc-window-line, rgba(255, 255, 255, 0.12)); }
${T} .rv-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #050505; }
${T} .rv-note {
  position: absolute; left: 50%; top: 1rem; transform: translateX(-50%); display: flex; align-items: center; gap: 0.6rem;
  padding: 0.4rem 0.75rem; border-radius: 4px; background: rgba(0, 0, 0, 0.75); color: var(--hc-window-ink-plain, #ddd);
}
@media (max-width: 599px) {
  ${T} .rv-bar { flex-wrap: wrap; }
  ${T} .rv-slider { order: 9; flex-basis: 100%; }
  ${T} .rv-position { min-width: 0; }
  ${T} .rv-runs { height: 1.6rem; }
  ${T} .rv-run { min-width: 1.6rem; }
}
`
  document.head.appendChild(style)
}
