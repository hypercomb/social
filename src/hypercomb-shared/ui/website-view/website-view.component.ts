// hypercomb-shared/ui/website-view/website-view.component.ts
//
// Website surface — when ViewMode is 'website', the layer tree is
// rendered as HTML instead of Pixi hexagons. The cell tree IS the page
// outline: top-level cells become sections, their children become
// subsections, notes attached to each cell become its prose.
//
// Per-node worker model: the renderer asks each cell for its content
// (currently via NotesService). Adding richer per-cell rendering
// later = adding a dedicated `website` participant slot with HTML
// blocks, same HiveParticipant pattern notes use today. The composition
// — root → children → notes → grandchildren — is the website.
//
// Pure presentation: NO commits, NO mutations. Reads run through the
// same async hydrators NotesService uses, so on a fresh boot the page
// fills in as data resolves.

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

type Section = {
  segments: string[]
  name: string
  childNames: string[]
  notes: readonly Note[]
}

@Component({
  selector: 'hc-website-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active()) {
      <div class="website-shell">
        <header class="website-header">
          <h1 class="website-title">{{ rootName() || 'website' }}</h1>
          <button class="website-exit" type="button" (click)="exit()" title="Back to hexagons">
            <span aria-hidden="true">⬡</span>
            <span class="visually-hidden">Switch to hexagons</span>
          </button>
        </header>

        <main class="website-main">
          @if (sections().length === 0) {
            <p class="website-empty">No content yet — add notes to cells in hexagon mode and come back.</p>
          } @else {
            @for (section of sections(); track section.segments.join('/')) {
              <section class="website-section">
                <h2 class="website-section-title">{{ section.name }}</h2>
                @for (note of section.notes; track note.id) {
                  <p class="website-note">{{ note.text }}</p>
                }
                @if (section.childNames.length > 0) {
                  <nav class="website-nav" aria-label="subsections">
                    @for (child of section.childNames; track child) {
                      <a class="website-nav-link" (click)="$event.preventDefault()" href="#">{{ child }}</a>
                    }
                  </nav>
                }
              </section>
            }
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
  readonly #rootChildren = signal<readonly string[]>([])
  readonly #rootName = signal<string>('')
  readonly #notesByCell = signal<ReadonlyMap<string, readonly Note[]>>(new Map())
  readonly #notesServiceReady = signal<boolean>(false)
  readonly #historyServiceReady = signal<boolean>(false)

  readonly active = computed(() => this.#mode() === 'website')
  readonly rootName = computed(() => this.#rootName())

  readonly sections = computed<readonly Section[]>(() => {
    const children = this.#rootChildren()
    const notesMap = this.#notesByCell()
    return children.map(cell => ({
      segments: [cell],
      name: cell,
      childNames: [],
      notes: notesMap.get(cell) ?? [],
    }))
  })

  #cleanups: (() => void)[] = []

  constructor() {
    // ViewMode bridge — same fromRuntime-style listener inline so we
    // don't add a dependency on the helper here.
    const wireMode = (svc: ViewModeServiceShape): void => {
      this.#mode.set(svc.mode)
      const onChange = (): void => this.#mode.set(svc.mode)
      svc.addEventListener('change', onChange)
      this.#cleanups.push(() => svc.removeEventListener('change', onChange))
    }
    const modeNow = get<ViewModeServiceShape>('@hypercomb.social/ViewMode')
    if (modeNow) {
      wireMode(modeNow)
    } else {
      window.ioc.whenReady<ViewModeServiceShape>('@hypercomb.social/ViewMode', wireMode)
    }

    // Lineage change → re-resolve root layer + clear cached notes.
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    if (lineage?.addEventListener) {
      const onLineage = (): void => {
        this.#notesByCell.set(new Map())
        this.#version.update(v => v + 1)
      }
      lineage.addEventListener('change', onLineage)
      this.#cleanups.push(() => lineage.removeEventListener('change', onLineage))
    }

    // Track service readiness so the load effect re-runs the moment the
    // bee bundles register — same pattern that fixed the notes-strip race.
    if (get('@diamondcoreprocessor.com/NotesService')) this.#notesServiceReady.set(true)
    else window.ioc.whenReady('@diamondcoreprocessor.com/NotesService', () => this.#notesServiceReady.set(true))
    if (get('@diamondcoreprocessor.com/HistoryService')) this.#historyServiceReady.set(true)
    else window.ioc.whenReady('@diamondcoreprocessor.com/HistoryService', () => this.#historyServiceReady.set(true))

    // Refresh on any cell-tree mutation so the website surface reflects
    // bridge / user writes immediately.
    this.#cleanups.push(EffectBus.on('layer:committed', () => this.#version.update(v => v + 1)))
    this.#cleanups.push(EffectBus.on('cell:added', () => this.#version.update(v => v + 1)))
    this.#cleanups.push(EffectBus.on('cell:removed', () => this.#version.update(v => v + 1)))
    this.#cleanups.push(EffectBus.on('notes:changed', () => this.#version.update(v => v + 1)))

    // Load effect: only does work when the website mode is active and
    // services are ready. Reads root children, then fans out a getNotes
    // per child so each section's prose hydrates independently.
    effect(() => {
      this.#version()
      if (!this.active()) return
      if (!this.#historyServiceReady() || !this.#notesServiceReady()) return

      const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
      const notes = get<NotesService>('@diamondcoreprocessor.com/NotesService')
      if (!history || !notes) return

      void this.#loadRoot(history, notes)
    })
  }

  exit(): void {
    const mode = get<ViewModeServiceShape>('@hypercomb.social/ViewMode')
    mode?.setMode('hexagons')
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  async #loadRoot(history: HistoryService, notes: NotesService): Promise<void> {
    try {
      const lineage = get<Lineage>('@hypercomb.social/Lineage')
      const segs = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      const locSig = await history.sign({ explorerSegments: () => segs })
      const root = await history.currentLayerAt(locSig)
      if (!root) {
        this.#rootName.set('')
        this.#rootChildren.set([])
        return
      }
      this.#rootName.set(typeof root.name === 'string' ? root.name : '')
      // children slot may carry layer sigs (committed via update) or
      // names (legacy). Resolve sigs to names by reading each layer.
      const children = Array.isArray(root.children) ? root.children.slice() : []
      const names: string[] = []
      for (const entry of children) {
        const s = String(entry ?? '').trim()
        if (!s) continue
        if (/^[a-f0-9]{64}$/.test(s)) {
          const layer = await history.getLayerBySig(s)
          const n = layer?.name
          if (typeof n === 'string' && n) names.push(n)
        } else {
          names.push(s)
        }
      }
      this.#rootChildren.set(names)

      // Fan out notes loads. Each completion updates #notesByCell
      // independently so the page progressively fills in.
      for (const name of names) {
        notes.getNotes(name).then(items => {
          this.#notesByCell.update(prev => {
            const next = new Map(prev)
            next.set(name, items.slice())
            return next
          })
        }).catch(() => { /* best-effort per cell */ })
      }
    } catch (err) {
      console.error('[website-view] load failed', err)
    }
  }
}
