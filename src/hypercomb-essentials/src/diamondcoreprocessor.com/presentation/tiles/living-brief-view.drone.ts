// Living Brief — a trusted, text-only document projection of a tile hierarchy.
// It executes no participant content and creates no second content store.

import { Drone } from '@hypercomb/core'
import {
  ensureDecorationsIndexed,
  tagsForSegments,
  titleForLabel,
  titleForSegments,
} from '../../commands/decoration-kind-index.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import { LIVING_BRIEF_KIND, LIVING_BRIEF_VIEW } from '../../commands/brief.queen.js'
import {
  viewSourceConfigAt,
  writeViewSourceSelection,
  type ViewSourceConfig,
  type ViewSourceScope,
} from '../../commands/view-source-scope.js'
import {
  documentViewPathKey,
  filterDocumentViewItems,
  readDocumentViewItems,
  type DocumentViewItem,
} from './document-view-source.js'
import { openDocumentViewCurator } from './document-view-curator.js'
import { bindDocumentLinks, jumpEntry } from './document-view-links.js'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(locationSig: string, layer: Record<string, unknown>): Promise<string>
}
type NotesShape = { getNotesAtSegments(segments: readonly string[]): Promise<Note[]> }
type Note = import('../../notes/notes.drone.js').Note
type Section = DocumentViewItem

export class LivingBriefViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Professional document projection of categories, pheromones, and notes.'

  #host: HTMLElement | null = null
  #curator: HTMLElement | null = null
  #targetSegments: string[] | null = null
  // Where the reader has descended FROM, oldest first, never including the
  // scope being read. A brief that reads a hierarchy is itself a hierarchy of
  // briefs: opening a section reads that tile as its own document, and this
  // is the way back up. It is reading position, not hive state — no lineage
  // move, no history entry, no URL.
  #trail: string[][] = []
  #bound = false
  #active = false
  #busy = false
  #again = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      window.addEventListener('contextmenu', this.#context, true)
      this.onEffect('notes:changed', this.#refresh)
      this.onEffect('decorations:changed', this.#refresh)
      this.onEffect('cell:added', this.#refresh)
      this.onEffect('cell:removed', this.#refresh)
      this.onEffect('feature:hidden', this.#refresh)
      this.onEffect('feature:restored', this.#refresh)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== LIVING_BRIEF_VIEW) return
        this.#trail = []
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(LIVING_BRIEF_VIEW)
        void this.#reconcile()
      })
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.removeEventListener('keydown', this.#key, true)
    window.removeEventListener('contextmenu', this.#context, true)
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #refresh = (): void => { if (this.#vm()?.mode === LIVING_BRIEF_VIEW) void this.#reconcile() }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== LIVING_BRIEF_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (this.#curator) {
      this.#curator.remove()
      this.#curator = null
      return
    }
    // Escape peels one level of reading depth before it leaves the document —
    // the same cascade the rest of the shell uses.
    if (this.#trail.length) { this.#ascendTo(this.#trail.length - 1); return }
    this.#vm()?.setMode('hexagons')
  }
  readonly #context = (event: MouseEvent): void => {
    if (this.#vm()?.mode !== LIVING_BRIEF_VIEW) return
    event.preventDefault()
    // Right-click is the BACK gesture — one rule for every view: an
    // arrival face navigates back, a participant-opened brief peels.
    const gesture = window.ioc?.get<{ backOutOfView?(peel: () => void): void }>('@diamondcoreprocessor.com/BackGesture')
    const peel = (): void => this.#vm()?.setMode('hexagons')
    if (gesture?.backOutOfView) gesture.backOutOfView(peel)
    else peel()
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  async #reconcile(): Promise<void> {
    if (this.#busy) { this.#again = true; return }
    this.#busy = true
    try {
      if (this.#vm()?.mode !== LIVING_BRIEF_VIEW) {
        this.#targetSegments = null
        this.#trail = []
        this.#teardown()
        return
      }
      const lineage = window.ioc?.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
      const segments = this.#targetSegments
        ? [...this.#targetSegments]
        : [...(lineage?.explorerSegments?.() ?? [])]
      if (await isFeatureHidden(this.#trail[0] ?? segments, LIVING_BRIEF_KIND)) {
        // OFF means the ordinary hive owns the surface. Merely removing the
        // document host while leaving ViewMode on `living-brief` produces a
        // blank takeover and carries that non-tile mode through navigation.
        this.#targetSegments = null
        this.#teardown()
        this.#vm()?.setMode('hexagons')
        return
      }
      const config = await viewSourceConfigAt(LIVING_BRIEF_KIND, segments)
      const allSections = await this.#sections(segments, config.scope)
      const sections = config.scope === 'hierarchy'
        ? filterDocumentViewItems(allSections, segments, config.includedPaths)
        : allSections
      if (this.#vm()?.mode !== LIVING_BRIEF_VIEW) return
      this.#render(segments, sections, allSections, config)
    } finally {
      this.#busy = false
      if (this.#again) { this.#again = false; void this.#reconcile() }
    }
  }

  async #sections(segments: readonly string[], scope: ViewSourceScope): Promise<Section[]> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const notes = window.ioc?.get<NotesShape>('@diamondcoreprocessor.com/NotesService')
    if (!history || !notes) return []
    return readDocumentViewItems({
      history,
      notes,
      segments,
      scope,
      locale: navigator.language,
      ensureMetadata: ensureDecorationsIndexed,
      titleForSegments,
      tagsForSegments,
    })
  }

  #render(
    segments: readonly string[],
    sections: readonly Section[],
    allSections: readonly Section[],
    config: ViewSourceConfig,
  ): void {
    this.#teardown()
    const host = document.createElement('section')
    host.className = 'hc-living-brief'
    const title = this.#label(segments, 'Living Brief')
    host.innerHTML = `<style>${CSS}</style>`

    const chrome = document.createElement('header')
    chrome.className = 'brief-chrome'
    const brand = document.createElement('span')
    brand.className = 'brief-trail'
    if (!this.#trail.length) brand.textContent = 'LIVING BRIEF'
    else {
      // Ancestry, not history: each step is a document you were reading, and
      // clicking one re-reads it. Nothing here moves the hive.
      this.#trail.forEach((step, index) => {
        const crumb = document.createElement('button')
        crumb.type = 'button'
        crumb.className = 'brief-crumb'
        crumb.textContent = this.#label(step, 'LIVING BRIEF')
        crumb.onclick = () => this.#ascendTo(index)
        brand.append(crumb, this.#el('span', 'brief-crumb-sep', '›'))
      })
      brand.append(this.#el('span', 'brief-crumb-here', this.#label(segments, 'Living Brief')))
    }
    const reach = document.createElement('span')
    reach.className = 'brief-reach'
    reach.textContent = config.scope === 'hierarchy' ? 'WHOLE HIERARCHY' : 'CURRENT LAYER'
    const viewActions = document.createElement('div')
    viewActions.className = 'brief-view-actions'
    viewActions.append(reach)
    if (config.scope === 'hierarchy') {
      const curate = document.createElement('button')
      curate.type = 'button'
      curate.className = 'brief-curate'
      curate.textContent = 'Choose contents'
      curate.onclick = () => this.#openCurator(host, segments, allSections, config)
      viewActions.append(curate)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.setAttribute('aria-label', 'Return to hexagons')
    close.textContent = '×'
    close.onclick = () => this.#vm()?.setMode('hexagons')
    chrome.append(brand, viewActions, close)

    const paper = document.createElement('article')
    paper.className = 'brief-paper'
    const mast = document.createElement('header')
    mast.className = 'brief-mast'
    mast.append(this.#el('p', 'brief-kicker', 'Hypercom document'))
    mast.append(this.#el('h1', '', title))
    mast.append(this.#el(
      'p',
      'brief-deck',
      `${sections.length} ${sections.length === 1 ? 'category' : 'categories'} · ${config.scope === 'hierarchy' ? 'curated hierarchy' : 'current layer'} · composed live from the hive`,
    ))
    paper.append(mast)

    const contents = document.createElement('nav')
    contents.className = 'brief-contents'
    contents.setAttribute('aria-label', 'Contents')
    contents.append(this.#el('strong', '', 'Contents'))
    sections.forEach((section, index) => {
      // A jump inside the page, NOT an href — see document-view-links.ts:
      // an anchor here would write the shell's URL hash, which this shell
      // reads back as a tile selection.
      const link = jumpEntry(
        `${String(index + 1).padStart(2, '0')}  ${section.source}`,
        `brief-${index}`,
        host,
      )
      link.style.paddingLeft = `${Math.min(section.depth, 5) * 14}px`
      contents.append(link)
    })
    if (sections.length) paper.append(contents)

    if (!sections.length) {
      const empty = this.#el('div', 'brief-empty', 'This brief is ready. Add category tiles and notes; the document will compose itself.')
      paper.append(empty)
    }
    sections.forEach((section, index) => paper.append(this.#section(section, index)))
    // Notes carry links this view did not write. External ones reach the OS,
    // in-hive ones open as their own brief, and neither touches the document.
    bindDocumentLinks(host, href => {
      const path = href.replace(/^[./]+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
      if (!path.length) return
      this.#descend(href.startsWith('/') ? path : [...segments, ...path])
    })
    host.append(chrome, paper)
    document.body.appendChild(host)
    this.#host = host
    this.#setActive(true)
  }

  #section(section: Section, index: number): HTMLElement {
    const el = document.createElement('section')
    el.className = 'brief-section'
    el.id = `brief-${index}`
    el.style.setProperty('--section-depth', String(Math.min(section.depth, 5)))
    const number = this.#el('span', 'brief-number', String(index + 1).padStart(2, '0'))
    const heading = this.#el('h2', '', section.title)
    const head = document.createElement('header')
    // A section that has children is itself a document. Opening it reads it
    // as one — the brief goes deeper instead of the shell going anywhere.
    if (section.childCount > 0) {
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'brief-open'
      open.title = `Read "${section.title}" as its own brief`
      open.append(heading, this.#el('span', 'brief-open-cue', `${section.childCount} inside ›`))
      open.onclick = () => this.#descend(section.segments)
      head.append(number, open)
    } else {
      head.append(number, heading)
    }
    if (section.depth > 0) {
      const source = this.#el('p', 'brief-source', section.source)
      head.append(source)
    }
    if (section.tags.length) {
      const tags = document.createElement('div')
      tags.className = 'brief-tags'
      section.tags.forEach(tag => tags.append(this.#el('span', '', tag)))
      head.append(tags)
    }
    el.append(head)
    if (!section.notes.length) el.append(this.#el('p', 'brief-muted', 'No notes yet.'))
    else section.notes.forEach(note => el.append(this.#note(note, 0, section.tags)))
    return el
  }

  #note(note: Note, depth: number, tags: readonly string[]): HTMLElement {
    const role = this.#role(note, tags)
    const el = document.createElement(role === 'question' ? 'aside' : 'div')
    el.className = `brief-note brief-${role}`
    if (role !== 'body') el.append(this.#el('span', 'brief-note-label', role))
    const text = this.#el(role === 'question' ? 'h3' : 'p', '', note.text)
    el.append(text)
    if (note.children.length) {
      const children = document.createElement('div')
      children.className = 'brief-note-children'
      note.children.forEach(child => children.append(this.#note(child, depth + 1, tags)))
      el.append(children)
    }
    if (depth) el.style.setProperty('--note-depth', String(depth))
    return el
  }

  #role(note: Note, tags: readonly string[]): 'body' | 'question' | 'answer' | 'decision' | 'callout' {
    const signals = [note.mark, ...tags].map(v => String(v ?? '').toLowerCase())
    if (signals.some(v => v === 'question' || v === 'help' || v.includes('question'))) return 'question'
    if (signals.some(v => v === 'answer' || v === 'response' || v.includes('answer'))) return 'answer'
    if (signals.some(v => v === 'decision' || v === 'gavel' || v.includes('decision'))) return 'decision'
    return note.mark || note.shape ? 'callout' : 'body'
  }

  #openCurator(
    host: HTMLElement,
    segments: readonly string[],
    allSections: readonly Section[],
    config: ViewSourceConfig,
  ): void {
    if (this.#curator) return
    const rootLabel = titleForLabel(segments.at(-1) ?? '', navigator.language) ||
      segments.at(-1) || 'Document'
    this.#curator = openDocumentViewCurator({
      host,
      rootLabel,
      rootSegments: segments,
      items: allSections,
      includedPaths: config.includedPaths,
      onCancel: () => { this.#curator = null },
      onDone: async includedPaths => {
        await writeViewSourceSelection({
          kind: LIVING_BRIEF_KIND,
          segments,
          includedPaths,
          defaults: { version: 1, layout: 'editorial' },
        })
        this.#curator = null
        void this.#reconcile()
      },
    })
  }

  /** Descend into a sub-document. Reading position only — no lineage move, no
   *  history entry, no URL write, and the drone/host stay exactly where they
   *  are, so nothing reloads. */
  #descend(segments: readonly string[]): void {
    const next = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (!next.length) return
    const here = this.#currentSegments()
    if (documentViewPathKey(next) === documentViewPathKey(here)) return
    this.#trail = [...this.#trail, here]
    this.#targetSegments = next
    void this.#reconcile()
  }

  /** Return to the ancestor at `index`, dropping everything below it. */
  #ascendTo(index: number): void {
    const step = this.#trail[index]
    if (!step) return
    this.#trail = this.#trail.slice(0, index)
    this.#targetSegments = [...step]
    void this.#reconcile()
  }

  #currentSegments(): string[] {
    if (this.#targetSegments) return [...this.#targetSegments]
    const lineage = window.ioc?.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    return [...(lineage?.explorerSegments?.() ?? [])]
  }

  #label(segments: readonly string[], fallback: string): string {
    const last = segments.at(-1)
    return last ? titleForLabel(last, navigator.language) || last : fallback
  }

  #el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag)
    if (className) el.className = className
    el.textContent = text
    return el
  }

  #teardown(): void {
    this.#host?.remove()
    this.#host = null
    this.#curator = null
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'living-brief-view')
    else modes?.exit('view:active', 'living-brief-view')
  }
}

const CSS = `
.hc-living-brief{position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:150;background:#e9e7e1;color:#202322;overflow:auto;font:16px/1.65 Inter,ui-sans-serif,system-ui,sans-serif}
.brief-chrome{position:sticky;top:0;z-index:2;height:52px;padding:0 24px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;background:rgba(27,32,31,.94);color:#dce5e1;letter-spacing:.18em;font-size:11px}.brief-view-actions{display:flex;align-items:center;gap:10px}.brief-reach{color:#90ada3;font-size:9px}.brief-curate{padding:5px 8px!important;border:1px solid #607b71!important;border-radius:var(--hc-radius-floating, 4px);background:#263c34!important;color:#dce9e4!important;font:700 10px/1 Inter,sans-serif!important;letter-spacing:0!important}.brief-chrome button{justify-self:end}
.brief-chrome button{border:0;background:transparent;color:inherit;font:30px/1 serif;cursor:pointer}
.brief-paper{box-sizing:border-box;width:min(880px,calc(100% - 32px));min-height:calc(100vh - 92px);margin:40px auto 80px;padding:clamp(42px,8vw,96px);background:#fff;box-shadow:0 16px 60px rgba(28,31,30,.13)}
.brief-mast{padding-bottom:46px;border-bottom:1px solid #c9ceca}.brief-kicker{margin:0;color:#57756c;text-transform:uppercase;letter-spacing:.19em;font-size:11px;font-weight:700}
.brief-mast h1{max-width:700px;margin:14px 0;font:600 clamp(40px,7vw,72px)/.98 Georgia,serif;letter-spacing:-.045em}.brief-deck{color:#69706d}
.brief-contents{display:grid;grid-template-columns:120px 1fr;gap:6px 22px;margin:42px 0 70px;padding:22px 0;border-block:1px solid #e1e4e1}.brief-contents strong{grid-row:1/99;text-transform:uppercase;letter-spacing:.14em;font-size:11px}.brief-contents .view-jump{border:0;background:none;color:#35423e;font:inherit;text-align:left;cursor:pointer}.brief-contents .view-jump:hover{color:#0f6f56}
.brief-trail{display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;white-space:nowrap}.brief-crumb{padding:0;border:0;background:none;color:#8fb3a7;font:inherit;letter-spacing:inherit;cursor:pointer}.brief-crumb:hover{color:#e6f2ed}.brief-crumb-sep{color:#5b7168}.brief-crumb-here{color:#dce5e1;overflow:hidden;text-overflow:ellipsis}
.brief-open{display:block;width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}.brief-open h2{transition:color .12s}.brief-open:hover h2{color:#0f6f56}.brief-open-cue{display:block;margin-top:4px;color:#668277;font-size:11px;letter-spacing:.04em}
.brief-section{scroll-margin-top:70px;margin:0 0 72px;padding-left:calc(var(--section-depth,0) * 14px)}.brief-section>header{display:grid;grid-template-columns:44px 1fr;align-items:start;border-top:3px solid #252c29;padding-top:14px}.brief-number{color:#668277;font-size:12px;font-weight:700}.brief-section h2{margin:0;font:600 32px/1.15 Georgia,serif}.brief-source{grid-column:2;margin:7px 0 0;color:#718078;font-size:11px}
.brief-tags{grid-column:2;display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}.brief-tags span{padding:3px 9px;border:1px solid #bdcbc5;border-radius:999px;color:#4f6b61;font-size:11px}
.brief-note{margin:24px 0 0 44px}.brief-note p{margin:0;white-space:pre-wrap}.brief-note-label{display:block;margin-bottom:5px;color:#527066;text-transform:uppercase;letter-spacing:.15em;font-size:10px;font-weight:800}
.brief-question{padding:22px 24px;background:#eef4f1;border-left:4px solid #63897c}.brief-question h3{margin:0;font:600 22px/1.35 Georgia,serif}.brief-answer,.brief-decision,.brief-callout{padding-left:18px;border-left:2px solid #b9c8c2}.brief-decision{border-left-color:#9b754b}.brief-note-children{margin-left:18px}.brief-muted,.brief-empty{color:#777f7b;font-style:italic}.brief-empty{padding:60px 0;text-align:center}
@media(max-width:640px){.brief-paper{width:100%;margin:0;padding:40px 24px;box-shadow:none}.brief-reach{display:none}.brief-contents{grid-template-columns:1fr}.brief-contents strong{grid-row:auto}.brief-note{margin-left:0}.brief-section{padding-left:0}.brief-section>header{grid-template-columns:34px 1fr}}
@media print{.hc-living-brief{position:static;background:#fff;overflow:visible}.brief-chrome{display:none}.brief-paper{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.brief-section{break-inside:avoid}}
`

const _livingBrief = new LivingBriefViewDrone()
window.ioc.register('@diamondcoreprocessor.com/LivingBriefViewDrone', _livingBrief)
