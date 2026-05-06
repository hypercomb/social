// hypercomb-shared/ui/website-view/website-view.component.ts
//
// Website surface — when ViewMode is 'website', the layer tree is
// rendered as HTML instead of Pixi hexagons. The cell tree IS the page
// outline, walked recursively to leaves. Every note becomes its own
// addressable subsection. Cross-references between notes that mention
// other cell names become inline links — fast in-page navigation.
//
// Per-node worker model (v1 — uses notes for content): each cell asks
// NotesService for its notes, the renderer composes them into nested
// sections. Adding richer per-cell rendering later = a dedicated
// `website` participant slot (HiveParticipant pattern, like notes).
//
// Preload strategy: when the user enters website mode, the renderer
// walks the entire subtree in parallel and fetches every cell's notes
// concurrently — Promise.all with bounded concurrency. By the time the
// user clicks any anchor, every page-section is already in the DOM.
// No spinners on link click. Toggle back to hexagons preserves the
// preload cache so re-entry is instant.

import { ChangeDetectionStrategy, Component, computed, signal, effect, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

type Note = {
  id: string
  text: string
  createdAt: number
  updatedAt?: number
  tags?: string[]
}

type NotesService = {
  getNotes(cellLabel: string): Promise<Note[]>
  getNotesAtSegments(segments: readonly string[]): Promise<Note[]>
}

type Lineage = EventTarget & {
  explorerSegments?: () => readonly string[]
}

type ViewModeServiceShape = EventTarget & {
  mode: string
  is(name: string): boolean
  setMode(next: string): void
}

type HistoryService = {
  currentLayerAt(locationSig: string): Promise<{ name?: string; children?: readonly string[]; [k: string]: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: string; children?: readonly string[]; [k: string]: unknown } | null>
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
}

/** A page is one cell, with its notes and recursive children. The tree
 *  flattens to a list of these for rendering. */
type Page = {
  segments: readonly string[]   // full path from root, e.g. ['architecture', 'layer']
  name: string                  // cell name (last segment)
  depth: number                 // 0 = root, 1 = top-level child, etc.
  notes: readonly Note[]
  childNames: readonly string[]
  parentName: string | null
}

const SIG_REGEX = /^[a-f0-9]{64}$/

@Component({
  selector: 'hc-website-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active()) {
      <div class="website-shell">
        <header class="website-header">
          <h1 class="website-title">{{ rootTitle() }}</h1>
          <button class="website-exit" type="button" (click)="exit()" title="Back to hexagons">
            <span aria-hidden="true">⬡</span>
            <span class="visually-hidden">Switch to hexagons</span>
          </button>
        </header>

        @if (loading()) {
          <p class="website-loading">Loading…</p>
        }

        <main class="website-main">
          @if (pages().length === 0 && !loading()) {
            <p class="website-empty">No content yet.</p>
          }
          @for (page of pages(); track page.segments.join('/')) {
            <section class="website-section" [attr.id]="anchorOf(page)" [attr.data-depth]="page.depth">
              <h2 class="website-section-title" [class]="'depth-' + page.depth">
                {{ page.name }}
              </h2>

              @if (page.parentName && page.depth > 1) {
                <p class="website-breadcrumb">
                  <a (click)="goTo(page.parentName!, $event)" [attr.href]="'#' + anchorOfName(page.parentName!)">↑ {{ page.parentName }}</a>
                </p>
              }

              @for (note of page.notes; track note.id) {
                <p class="website-note" [attr.id]="anchorOfNote(page, note)" [innerHTML]="linkified(note.text)"></p>
              }

              @if (page.childNames.length > 0) {
                <nav class="website-nav" aria-label="children of {{ page.name }}">
                  @for (child of page.childNames; track child) {
                    <a class="website-nav-link" (click)="goTo(child, $event)" [attr.href]="'#' + anchorOfName(child)">{{ child }} →</a>
                  }
                </nav>
              }
            </section>
          }
        </main>
      </div>
    }
  `,
  styleUrl: './website-view.component.scss',
})
export class WebsiteViewComponent implements OnDestroy {
  readonly #mode = signal<string>('hexagons')
  readonly #version = signal(0)
  readonly #pages = signal<readonly Page[]>([])
  readonly #rootName = signal<string>('')
  readonly #loading = signal<boolean>(false)
  readonly #notesServiceReady = signal<boolean>(false)
  readonly #historyServiceReady = signal<boolean>(false)
  /** Set of cell names that exist in the loaded tree — used by the
   *  link-detector to decide which words in note text become anchors. */
  readonly #knownNames = signal<ReadonlySet<string>>(new Set())

  readonly active = computed(() => this.#mode() === 'website')
  readonly pages = computed<readonly Page[]>(() => this.#pages())
  readonly loading = computed<boolean>(() => this.#loading())
  readonly rootTitle = computed<string>(() => this.#rootName() || '/')

  #cleanups: (() => void)[] = []

  constructor() {
    // ViewMode bridge.
    const wireMode = (svc: ViewModeServiceShape): void => {
      this.#mode.set(svc.mode)
      const onChange = (): void => this.#mode.set(svc.mode)
      svc.addEventListener('change', onChange)
      this.#cleanups.push(() => svc.removeEventListener('change', onChange))
    }
    const modeNow = get<ViewModeServiceShape>('@hypercomb.social/ViewMode')
    if (modeNow) wireMode(modeNow)
    else window.ioc.whenReady<ViewModeServiceShape>('@hypercomb.social/ViewMode', wireMode)

    // Lineage change → reload tree from the new root.
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    if (lineage?.addEventListener) {
      const onLineage = (): void => this.#version.update(v => v + 1)
      lineage.addEventListener('change', onLineage)
      this.#cleanups.push(() => lineage.removeEventListener('change', onLineage))
    }

    // Service readiness.
    if (get('@diamondcoreprocessor.com/NotesService')) this.#notesServiceReady.set(true)
    else window.ioc.whenReady('@diamondcoreprocessor.com/NotesService', () => this.#notesServiceReady.set(true))
    if (get('@diamondcoreprocessor.com/HistoryService')) this.#historyServiceReady.set(true)
    else window.ioc.whenReady('@diamondcoreprocessor.com/HistoryService', () => this.#historyServiceReady.set(true))

    // Refresh on tree mutations.
    this.#cleanups.push(EffectBus.on('layer:committed', () => this.#version.update(v => v + 1)))
    this.#cleanups.push(EffectBus.on('cell:added', () => this.#version.update(v => v + 1)))
    this.#cleanups.push(EffectBus.on('cell:removed', () => this.#version.update(v => v + 1)))
    this.#cleanups.push(EffectBus.on('notes:changed', () => this.#version.update(v => v + 1)))

    // The preloader — only runs when website mode is on. Walks the tree
    // recursively and fetches every cell's notes in parallel. Bounded
    // concurrency keeps OPFS read pressure manageable on deep trees.
    effect(() => {
      this.#version()
      if (!this.active()) return
      if (!this.#historyServiceReady() || !this.#notesServiceReady()) return

      const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
      const notes = get<NotesService>('@diamondcoreprocessor.com/NotesService')
      if (!history || !notes) return

      void this.#preloadTree(history, notes)
    })
  }

  exit(): void {
    const mode = get<ViewModeServiceShape>('@hypercomb.social/ViewMode')
    mode?.setMode('hexagons')
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  // ── render helpers ────────────────────────────────────

  /** DOM-safe anchor id for a page (one section per cell). */
  anchorOf(page: Page): string {
    return 'cell-' + this.#sanitize(page.segments.join('-'))
  }

  /** Anchor for a name-only reference (cross-link). Resolves to whichever
   *  page in the loaded set has that name — used when a note mentions a
   *  cell by name. */
  anchorOfName(name: string): string {
    const page = this.#pages().find(p => p.name === name)
    return page ? this.anchorOf(page) : 'cell-' + this.#sanitize(name)
  }

  /** Per-note anchor — one URL per note for deep-linking. */
  anchorOfNote(page: Page, note: Note): string {
    return this.anchorOf(page) + '__note-' + this.#sanitize(note.id.slice(0, 8))
  }

  /** Smooth-scroll to a cell by name, intercepting the link click. */
  goTo(name: string, event: MouseEvent): void {
    event.preventDefault()
    const id = this.anchorOfName(name)
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      history.replaceState(null, '', '#' + id)
    }
  }

  /** Wraps any occurrence of a known cell name in note text with a
   *  link that scrolls to that cell. Whole-word match, case-insensitive,
   *  punctuation-tolerant. */
  linkified(text: string): string {
    const escaped = this.#escapeHtml(text)
    const names = [...this.#knownNames()].sort((a, b) => b.length - a.length)
    if (names.length === 0) return escaped
    let out = escaped
    for (const name of names) {
      const re = new RegExp(`\\b(${this.#escapeRegex(name)})\\b`, 'gi')
      out = out.replace(re, `<a class="website-inline-link" href="#${this.anchorOfName(name)}" data-cell="${name}">$1</a>`)
    }
    return out
  }

  // ── preloader: walk tree + fetch notes in parallel ────

  async #preloadTree(history: HistoryService, notes: NotesService): Promise<void> {
    if (this.#loading()) return
    this.#loading.set(true)
    try {
      const lineage = get<Lineage>('@hypercomb.social/Lineage')
      const segs = (lineage?.explorerSegments?.() ?? [])
        .map(s => String(s ?? '').trim()).filter(Boolean)

      const rootSig = await history.sign({ explorerSegments: () => segs })
      const root = await history.currentLayerAt(rootSig)
      if (!root) {
        this.#pages.set([])
        this.#rootName.set('')
        return
      }

      this.#rootName.set(typeof root.name === 'string' ? root.name : '/')

      // Recursive walk → flat list of pages in DFS order.
      const pages: Page[] = []
      const knownNames = new Set<string>()

      // Root page (depth 0).
      const rootChildren = await this.#resolveChildNames(history, root)
      const rootName = (typeof root.name === 'string' && root.name) ? root.name : '/'
      pages.push({
        segments: [],
        name: rootName,
        depth: 0,
        notes: [],   // root notes filled in below
        childNames: rootChildren,
        parentName: null,
      })
      knownNames.add(rootName)
      for (const c of rootChildren) knownNames.add(c)

      // Recurse into each child.
      for (const childName of rootChildren) {
        await this.#walk(history, childName, [childName], 1, rootName, pages, knownNames)
      }

      // Parallel notes fetch — preloader pattern. Bounded to 8 concurrent
      // reads to avoid swamping OPFS on deep trees.
      this.#knownNames.set(knownNames)
      this.#pages.set(pages)   // first paint with structure; notes hydrate next
      await this.#hydrateAllNotes(notes, pages)
    } catch (err) {
      console.error('[website-view] preload failed', err)
    } finally {
      this.#loading.set(false)
    }
  }

  async #walk(
    history: HistoryService,
    name: string,
    segments: readonly string[],
    depth: number,
    parentName: string,
    out: Page[],
    knownNames: Set<string>,
  ): Promise<void> {
    const locSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locSig)
    const childNames = layer ? await this.#resolveChildNames(history, layer) : []
    knownNames.add(name)
    for (const c of childNames) knownNames.add(c)
    out.push({
      segments: [...segments],
      name,
      depth,
      notes: [],
      childNames,
      parentName,
    })
    for (const childName of childNames) {
      await this.#walk(history, childName, [...segments, childName], depth + 1, name, out, knownNames)
    }
  }

  async #resolveChildNames(
    history: HistoryService,
    layer: { children?: readonly string[]; [k: string]: unknown },
  ): Promise<string[]> {
    const children = Array.isArray(layer.children) ? layer.children.slice() : []
    const names: string[] = []
    for (const entry of children) {
      const s = String(entry ?? '').trim()
      if (!s) continue
      if (SIG_REGEX.test(s)) {
        const child = await history.getLayerBySig(s)
        const n = child?.name
        if (typeof n === 'string' && n) names.push(n)
      } else {
        names.push(s)
      }
    }
    return names
  }

  /** Fetch notes for every page in parallel with a small concurrency cap.
   *  Each completion updates the page in-place via signal swap so the
   *  user sees content fill in progressively. Uses getNotesAtSegments so
   *  arbitrary depths work — the website surface walks the FULL tree,
   *  not just direct children of the current lineage. */
  async #hydrateAllNotes(notes: NotesService, pages: Page[]): Promise<void> {
    const POOL = 8
    let cursor = 0
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const baseSegs = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)

    const next = async (): Promise<void> => {
      while (cursor < pages.length) {
        const i = cursor++
        const page = pages[i]
        if (page.depth === 0) continue   // root has no notes slot at this version

        try {
          // Every page: read notes at its absolute path (basesegs + page).
          const fullSegments = [...baseSegs, ...page.segments]
          const items = await notes.getNotesAtSegments(fullSegments)
          if (items.length > 0) {
            const updated = { ...page, notes: items.slice() }
            this.#pages.update(prev => prev.map((p, idx) => idx === i ? updated : p))
          }
        } catch (err) {
          console.warn('[website-view] notes fetch failed for', page.name, err)
        }
      }
    }

    await Promise.all(Array.from({ length: POOL }, next))
  }

  // ── micro helpers ─────────────────────────────────────

  #escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  #escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  #sanitize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  }
}
