// hypercomb-shared/ui/website-view/website-view.component.ts
//
// Website surface — when ViewMode is 'website', the same merkle layer
// tree is rendered as a navigable site. ONE PAGE PER CELL. Navigation
// mirrors the hierarchy: click a child link → drill into that cell's
// page. Click parent in breadcrumb → back up. Same model as Hypercomb's
// hex navigation, just different rendering of each "level."
//
// The page for a cell shows:
//   - breadcrumb back to root
//   - the cell's name as h1
//   - its notes as paragraphs (with inline links auto-detected to other
//     cells anywhere in the tree — links cross-cut the hierarchy
//     creatively, you can jump from a leaf to a sibling subtree)
//   - its children as a navigation grid (each card → that child's page)
//
// Preloader: at mode entry the entire subtree is walked + every cell's
// notes fetched in parallel. Subsequent in-page nav clicks just swap
// which cell the renderer reads from the in-memory map — instant.
//
// URL hash reflects the path: #/architecture/layer. Browser back/forward
// works. Reload preserves position.

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

/** A node in the cached tree — one per cell, addressable by its segments. */
type Node = {
  segments: readonly string[]   // absolute path from website root
  name: string                  // display name (last segment, or root name)
  childNames: readonly string[]
  notes: readonly Note[]
}

const SIG_REGEX = /^[a-f0-9]{64}$/

@Component({
  selector: 'hc-website-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active()) {
      <div class="website-shell" (contextmenu)="onContextMenu($event)">
        <header class="website-header">
          <nav class="website-breadcrumb" aria-label="breadcrumb">
            <a class="website-crumb" (click)="goRoot($event)" href="#/">{{ rootName() || '/' }}</a>
            @for (crumb of breadcrumbs(); track crumb.path.join('/')) {
              <span class="website-crumb-sep" aria-hidden="true">›</span>
              <a class="website-crumb" (click)="goTo(crumb.path, $event)" [href]="hashOf(crumb.path)">{{ crumb.name }}</a>
            }
          </nav>
          <button class="website-exit" type="button" (click)="exit()" title="Back to hexagons">
            <span aria-hidden="true">⬡</span>
            <span class="visually-hidden">Switch to hexagons</span>
          </button>
        </header>

        @if (loading() && !node()) {
          <p class="website-loading">Loading…</p>
        }

        <main class="website-main">
          <!-- Render every page in the tree once; toggle visibility via
               [class.is-current] on the current path. Zero re-render
               cost on nav — just a CSS class flip on already-mounted
               DOM. The static structural parts (header, breadcrumb,
               main wrapper) never re-render at all. -->
          @if (allPages().length === 0 && !loading()) {
            <p class="website-empty">No content here.</p>
          }
          @for (n of allPages(); track n.segments.join('/')) {
            <article class="website-page"
                     [class.is-visible]="isVisible(n.segments)"
                     [class.is-current]="isCurrent(n.segments)"
                     [attr.data-path]="n.segments.join('/')"
                     [attr.data-depth]="n.segments.length">
              <h1 class="website-page-title">{{ n.name }}</h1>

              @if (n.notes.length === 0 && n.segments.length > 0) {
                <p class="website-empty-notes">No notes on this cell yet.</p>
              }

              @for (note of n.notes; track note.id) {
                <p class="website-note" [innerHTML]="linkified(note.text)"></p>
              }

              @if (n.childNames.length > 0) {
                <section class="website-children">
                  <h2 class="website-children-title">{{ n.childNames.length }} {{ n.childNames.length === 1 ? 'subsection' : 'subsections' }}</h2>
                  <div class="website-children-grid">
                    @for (child of childCards(n); track child.name) {
                      <a class="website-child-card" (click)="goTo(child.path, $event)" [href]="hashOf(child.path)">
                        <span class="website-child-name">{{ child.name }}</span>
                        @if (child.preview) {
                          <span class="website-child-preview">{{ child.preview }}</span>
                        }
                        @if (child.childCount > 0) {
                          <span class="website-child-count">{{ child.childCount }} →</span>
                        }
                      </a>
                    }
                  </div>
                </section>
              }
            </article>
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
  /** Map of cell-path → Node, populated by the preloader walk. */
  readonly #tree = signal<ReadonlyMap<string, Node>>(new Map())
  readonly #rootName = signal<string>('')
  readonly #loading = signal<boolean>(false)
  /** Current page within the website — independent of Hypercomb's
   *  lineage navigation. Starts at root, advances via in-page link
   *  clicks. URL hash reflects this. */
  readonly #currentPath = signal<readonly string[]>([])
  readonly #notesServiceReady = signal<boolean>(false)
  readonly #historyServiceReady = signal<boolean>(false)
  readonly #knownNames = signal<ReadonlySet<string>>(new Set())
  /** name → segments map for cross-link resolution. The first node
   *  encountered for a given name wins (closer-to-root preference). */
  readonly #nameIndex = signal<ReadonlyMap<string, readonly string[]>>(new Map())

  readonly active = computed(() => this.#mode() === 'website')
  readonly loading = computed<boolean>(() => this.#loading())
  readonly rootName = computed<string>(() => this.#rootName())

  readonly node = computed<Node | null>(() => {
    const tree = this.#tree()
    const key = this.#currentPath().join('/')
    return tree.get(key) ?? null
  })

  /** Flat list of all loaded pages, sorted by depth then name so the
   *  rendered DOM is in stable, walkable order. The whole tree is
   *  rendered once; navigation flips which one is `is-current`. */
  readonly allPages = computed<readonly Node[]>(() => {
    const tree = this.#tree()
    return [...tree.values()].sort((a, b) => {
      if (a.segments.length !== b.segments.length) return a.segments.length - b.segments.length
      const aKey = a.segments.join('/')
      const bKey = b.segments.join('/')
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
    })
  })

  /** Whether the page at `segments` is on the current ancestry chain
   *  (root → ... → currentPath). All ancestors stay visible; the
   *  deepest is the focus. Children of the current path stay hidden
   *  until you drill into them. Mirrors Hypercomb's hex navigation:
   *  you always see your lineage. */
  isVisible(segments: readonly string[]): boolean {
    const path = this.#currentPath()
    if (segments.length > path.length) return false
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] !== path[i]) return false
    }
    return true
  }

  /** Exact-match check — the deepest visible page, the user's actual
   *  focus. Used for emphasis styling on the current page. */
  isCurrent(segments: readonly string[]): boolean {
    const path = this.#currentPath()
    if (path.length !== segments.length) return false
    for (let i = 0; i < path.length; i++) if (path[i] !== segments[i]) return false
    return true
  }

  readonly breadcrumbs = computed<readonly { name: string; path: readonly string[] }[]>(() => {
    const path = this.#currentPath()
    const out: { name: string; path: readonly string[] }[] = []
    for (let i = 0; i < path.length; i++) {
      const sub = path.slice(0, i + 1)
      out.push({ name: path[i], path: sub })
    }
    return out
  })

  #cleanups: (() => void)[] = []
  #hashListener: (() => void) | null = null

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

    // Lineage change → re-preload from the new root.
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    if (lineage?.addEventListener) {
      const onLineage = (): void => {
        this.#currentPath.set([])
        this.#version.update(v => v + 1)
      }
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

    // URL hash → currentPath sync. Hash format: #/segment1/segment2/...
    const onHash = (): void => {
      if (!this.active()) return
      this.#currentPath.set(this.#parseHash())
    }
    window.addEventListener('hashchange', onHash)
    this.#hashListener = () => window.removeEventListener('hashchange', onHash)

    // Preloader: walks tree + fetches every cell's notes in parallel.
    effect(() => {
      this.#version()
      if (!this.active()) return
      if (!this.#historyServiceReady() || !this.#notesServiceReady()) return

      const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
      const notes = get<NotesService>('@diamondcoreprocessor.com/NotesService')
      if (!history || !notes) return

      void this.#preloadTree(history, notes)
    })

    // When website mode activates, restore path from URL hash.
    // CRITICAL: compare contents before setting — array signals fire on
    // reference inequality, and `[...fromHash]` creates a new array
    // every run. Without the content compare this effect retriggers
    // itself in an infinite loop and the page hangs.
    effect(() => {
      if (!this.active()) return
      const fromHash = this.#parseHash()
      const current = this.#currentPath()
      if (fromHash.length === current.length) {
        let same = true
        for (let i = 0; i < fromHash.length; i++) {
          if (fromHash[i] !== current[i]) { same = false; break }
        }
        if (same) return
      }
      this.#currentPath.set(fromHash)
    })
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#hashListener?.()
  }

  // ── render helpers ────────────────────────────────────

  hashOf(segments: readonly string[]): string {
    return '#/' + segments.map(s => encodeURIComponent(s)).join('/')
  }

  goRoot(event: MouseEvent): void {
    event.preventDefault()
    this.#navigate([])
  }

  goTo(path: readonly string[], event: MouseEvent): void {
    event.preventDefault()
    this.#navigate([...path])
  }

  exit(): void {
    const mode = get<ViewModeServiceShape>('@hypercomb.social/ViewMode')
    mode?.setMode('hexagons')
  }

  /** Right-click anywhere in the website-shell → navigate UP one level
   *  in the ancestry chain. Mirrors Hypercomb's hex back-click. At root,
   *  no-op (don't show the browser context menu either — keep the
   *  navigation surface consistent). */
  onContextMenu(event: MouseEvent): void {
    event.preventDefault()
    const path = this.#currentPath()
    if (path.length === 0) return
    this.#navigate(path.slice(0, -1))
  }

  /** Build child-card data with a preview snippet from each child's
   *  first note (if cached). */
  childCards(n: Node): readonly { name: string; path: readonly string[]; preview: string; childCount: number }[] {
    const tree = this.#tree()
    return n.childNames.map(name => {
      const path = [...n.segments, name]
      const child = tree.get(path.join('/'))
      const firstNote = child?.notes[0]?.text ?? ''
      const preview = firstNote.length > 110 ? firstNote.slice(0, 107) + '…' : firstNote
      const childCount = child?.childNames.length ?? 0
      return { name, path, preview, childCount }
    })
  }

  /** Inline-link any cell-name mention in note text to that cell's page.
   *  Cross-tree links — from any leaf to any other cell — fall out of
   *  the same global name index. */
  linkified(text: string): string {
    const escaped = this.#escapeHtml(text)
    const names = [...this.#knownNames()].sort((a, b) => b.length - a.length)
    if (names.length === 0) return escaped
    const idx = this.#nameIndex()
    let out = escaped
    for (const name of names) {
      const path = idx.get(name)
      if (!path) continue
      const re = new RegExp(`\\b(${this.#escapeRegex(name)})\\b`, 'gi')
      out = out.replace(re, `<a class="website-inline-link" href="${this.hashOf(path)}" data-cell="${name}">$1</a>`)
    }
    return out
  }

  // ── preloader ─────────────────────────────────────────

  async #preloadTree(history: HistoryService, notes: NotesService): Promise<void> {
    if (this.#loading()) return
    this.#loading.set(true)
    try {
      const lineage = get<Lineage>('@hypercomb.social/Lineage')
      const baseSegs = (lineage?.explorerSegments?.() ?? [])
        .map(s => String(s ?? '').trim()).filter(Boolean)

      const rootSig = await history.sign({ explorerSegments: () => baseSegs })
      const root = await history.currentLayerAt(rootSig)
      if (!root) {
        this.#tree.set(new Map())
        this.#rootName.set('')
        return
      }

      const rootName = (typeof root.name === 'string' && root.name) ? root.name : '/'
      this.#rootName.set(rootName)

      // Walk tree → flat node list.
      const nodes: Node[] = []
      const knownNames = new Set<string>()
      const nameIndex = new Map<string, readonly string[]>()

      const rootChildren = await this.#resolveChildNames(history, root)
      nodes.push({ segments: [], name: rootName, childNames: rootChildren, notes: [] })
      knownNames.add(rootName)
      nameIndex.set(rootName, [])

      for (const childName of rootChildren) {
        await this.#walk(history, childName, [childName], nodes, knownNames, nameIndex)
      }

      // Hydrate notes in parallel.
      this.#knownNames.set(knownNames)
      this.#nameIndex.set(nameIndex)
      const tree = new Map<string, Node>()
      for (const n of nodes) tree.set(n.segments.join('/'), n)
      this.#tree.set(tree)

      await this.#hydrateAllNotes(notes, nodes, baseSegs, tree)
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
    out: Node[],
    knownNames: Set<string>,
    nameIndex: Map<string, readonly string[]>,
    visited: Set<string> = new Set(),
  ): Promise<void> {
    // Cycle protection — a malformed tree where a cell appears under
    // itself would otherwise spin forever. Bound depth as well for
    // safety on hostile inputs.
    if (segments.length > 32) return
    const key = segments.join('/')
    if (visited.has(key)) return
    visited.add(key)

    const locSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locSig)
    const childNames = layer ? await this.#resolveChildNames(history, layer) : []
    knownNames.add(name)
    if (!nameIndex.has(name)) nameIndex.set(name, [...segments])
    out.push({ segments: [...segments], name, childNames, notes: [] })
    for (const childName of childNames) {
      await this.#walk(history, childName, [...segments, childName], out, knownNames, nameIndex, visited)
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

  async #hydrateAllNotes(
    notes: NotesService,
    nodes: readonly Node[],
    baseSegs: readonly string[],
    tree: Map<string, Node>,
  ): Promise<void> {
    const POOL = 8
    let cursor = 0

    const next = async (): Promise<void> => {
      while (cursor < nodes.length) {
        const i = cursor++
        const n = nodes[i]
        if (n.segments.length === 0) continue   // root has no notes slot
        try {
          const fullSegments = [...baseSegs, ...n.segments]
          const items = await notes.getNotesAtSegments(fullSegments)
          if (items.length > 0) {
            const updated: Node = { ...n, notes: items.slice() }
            tree.set(n.segments.join('/'), updated)
            this.#tree.set(new Map(tree))
          }
        } catch (err) {
          console.warn('[website-view] notes fetch failed for', n.name, err)
        }
      }
    }

    await Promise.all(Array.from({ length: POOL }, next))
  }

  // ── navigation ────────────────────────────────────────

  #navigate(segments: readonly string[]): void {
    this.#currentPath.set([...segments])
    const hash = this.hashOf(segments)
    if (location.hash !== hash) history.pushState(null, '', hash)
    // Scroll the shell to top on nav.
    queueMicrotask(() => {
      const shell = document.querySelector('.website-shell') as HTMLElement | null
      shell?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }

  #parseHash(): readonly string[] {
    const h = location.hash || ''
    if (!h.startsWith('#/')) return []
    const path = h.slice(2)
    if (!path) return []
    return path.split('/').map(s => decodeURIComponent(s)).filter(Boolean)
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
}
