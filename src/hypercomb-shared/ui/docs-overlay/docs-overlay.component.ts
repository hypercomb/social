// hypercomb-shared/ui/docs-overlay/docs-overlay.component.ts
//
// Full-viewport documentation browser. Fetches markdown from /documentation/,
// renders to HTML with a lightweight parser, and displays in a clean overlay.
// Activated via `/docs` slash behaviour (listens to EffectBus 'docs:open').

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, ElementRef, inject, signal, computed, effect, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe.js'
import { TextScaleComponent, surfaceScale } from '../text-scale/text-scale.component'
import { DOCS_BASE, renderMarkdown, resolveDocLink } from './docs-markdown'
import { DOC_INDEX, DOCTRINE_PAGE, type DocEntry } from './docs-index'

// Owner token for the InputGate lock held while the docs browser is open.
// Owner-scoped so it composes with locks held by the editor / other overlays.
const DOCS_OVERLAY_LOCK_OWNER = 'docs-overlay'

/** Structural type for the InputGate — the shared tile-input lock. Resolved
 *  at runtime via window.ioc (shared must never import from modules). */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

/** The text-size gear's window id: the docs browser's own setting. */
const DOCS_TEXT_WINDOW = 'docs'
const ANATOMY_KEY = '@hypercomb.social/Anatomy'
type AnatomyLike = { doctrine?: { markdown?(): Promise<string> } }

@Component({
  selector: 'hc-docs-overlay',
  standalone: true,
  imports: [TranslatePipe, TextScaleComponent],
  templateUrl: './docs-overlay.component.html',
  styleUrls: ['./docs-overlay.component.scss'],
})
export class DocsOverlayComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly sidebarOpen = signal(true)
  readonly activePage = signal<string | null>(null)
  readonly renderedHtml = signal('')
  readonly loading = signal(false)
  readonly filterText = signal('')

  /** The gear's text size: the same setting, storage and `--hc-panel-scale`
   *  contract every tool window's gear uses, under this window's id. */
  readonly textWindow = DOCS_TEXT_WINDOW
  readonly textScale = signal(surfaceScale(DOCS_TEXT_WINDOW))

  readonly categories = computed(() => {
    const filter = this.filterText().toLowerCase()
    const groups: { category: string; entries: DocEntry[] }[] = []
    let current: { category: string; entries: DocEntry[] } | null = null
    for (const entry of DOC_INDEX) {
      if (filter && !entry.title.toLowerCase().includes(filter) && !entry.category.toLowerCase().includes(filter)) continue
      if (!current || current.category !== entry.category) {
        current = { category: entry.category, entries: [] }
        groups.push(current)
      }
      current.entries.push(entry)
    }
    return groups
  })

  #cleanupOpen: (() => void) | undefined
  #cleanupClose: (() => void) | undefined

  constructor() {
    this.#cleanupOpen = EffectBus.on('docs:open', (payload: { page?: string }) => {
      this.visible.set(true)
      if (payload?.page) {
        const match = DOC_INDEX.find(e =>
          e.file === payload.page ||
          e.file === payload.page + '.md' ||
          e.title.toLowerCase() === payload.page!.toLowerCase()
        )
        if (match) this.loadPage(match.file)
      }
    })

    this.#cleanupClose = EffectBus.on('docs:close', () => {
      this.visible.set(false)
    })

    // Freeze tile navigation while the docs browser is open — it's a full-
    // viewport overlay, so per the "modals lock tiles while showing" rule no
    // pan/pinch/wheel-zoom/drag-select may bleed through to the canvas. The
    // gate is resolved lazily (its bee may register after this component
    // constructs on hypercomb-web); the [data-consumes-wheel] overlay keeps
    // the sidebar/article scrollable.
    effect(() => {
      const gate = this.#gate()
      if (!gate) return
      if (this.visible()) gate.lock(DOCS_OVERLAY_LOCK_OWNER)
      else gate.unlock(DOCS_OVERLAY_LOCK_OWNER)
    })
  }

  ngOnDestroy(): void {
    this.#cleanupOpen?.()
    this.#cleanupClose?.()
    // Release on teardown — the visibility effect won't run a final unlock
    // once destroyed, so an overlay torn down while open would leave the
    // hexes locked.
    this.#gate()?.unlock(DOCS_OVERLAY_LOCK_OWNER)
  }

  /** InputGate — the shared tile-input lock. Resolved at runtime (shared
   *  must never import from modules); undefined until its bee registers. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get<InputGateLike>('@diamondcoreprocessor.com/InputGate')
  }

  close(): void {
    this.visible.set(false)
    this.activePage.set(null)
    this.renderedHtml.set('')
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v)
  }

  onFilter(event: Event): void {
    this.filterText.set((event.target as HTMLInputElement).value)
  }

  async loadPage(file: string, hash = ''): Promise<void> {
    this.activePage.set(file)
    this.loading.set(true)

    // on mobile, auto-close sidebar when a doc is selected
    if (window.innerWidth <= 600) {
      this.sidebarOpen.set(false)
    }

    try {
      if (file === DOCTRINE_PAGE) {
        const markdown = await window.ioc?.get<AnatomyLike>(ANATOMY_KEY)?.doctrine?.markdown?.()
        this.renderedHtml.set(markdown ? `<div class="doctrine-page">${renderMarkdown(markdown, '')}</div>` : '<p class="doc-error">The doctrine is not available here.</p>')
        return
      }
      const response = await fetch(`${DOCS_BASE}${file}`)
      // The dev server answers a missing file with the app's own page, so a
      // document is only what came back as something other than HTML.
      if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) {
        this.renderedHtml.set(`<p class="doc-error">Failed to load: ${file}</p>`)
        return
      }
      const markdown = await response.text()
      this.renderedHtml.set(renderMarkdown(markdown, file))
    } catch {
      this.renderedHtml.set(`<p class="doc-error">Failed to load: ${file}</p>`)
    } finally {
      this.loading.set(false)
      this.#scrollTo(hash)
    }
  }

  /** A click inside the page. No link leaves the hive's tab (docs-markdown.ts):
   *  a document opens here, an anchor scrolls, a web link opens a new tab. */
  follow(event: MouseEvent): void {
    const anchor = (event.target as Element | null)?.closest?.('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return
    event.preventDefault()
    const to = resolveDocLink(href, this.activePage() === DOCTRINE_PAGE ? '' : this.activePage() ?? '')
    if (to.kind === 'doc') {
      if (to.file === this.activePage()) this.#scrollTo(to.hash)
      else void this.loadPage(to.file, to.hash)
    } else if (to.kind === 'anchor') this.#scrollTo(to.hash)
    else if (to.kind === 'external') window.open(to.href, '_blank', 'noopener,noreferrer')
  }

  readonly #host = inject(ElementRef<HTMLElement>)

  /** Scroll the page to the heading with this id, once the page is drawn;
   *  no id means the top. */
  #scrollTo(hash: string): void {
    // Two frames: the first lets the new page be drawn into the article.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const article = (this.#host.nativeElement as HTMLElement).querySelector<HTMLElement>('.docs-article')
      if (!article) return
      const target = hash ? article.querySelector<HTMLElement>(`[id="${CSS.escape(hash)}"]`) : null
      if (target) target.scrollIntoView({ block: 'start' })
      else article.scrollTop = 0
    }))
  }

  backToIndex(): void {
    this.activePage.set(null)
    this.renderedHtml.set('')
    this.sidebarOpen.set(true)
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-docs-overlay',
  owner: '@hypercomb.shared/DocsOverlayComponent',
  component: DocsOverlayComponent,
  order: 290,
})
