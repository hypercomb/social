import { Component, OnDestroy, computed, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { TranslatePipe } from '../../core/i18n.pipe'

type ViewDescriptor = {
  view: string
  slashCommand: string
  toggleIcon?: string
  iconName: string
  decorationKind: string
  queenKey?: string
  behavior?: 'render' | 'navigation'
  attachable?: boolean
  labelKey?: string
  descriptionKey?: string
}
type Registry = EventTarget & { all(): ViewDescriptor[] }
type Decorations = {
  list<T>(opts: { kind: string; segments: readonly string[] }): Promise<Array<{ sig: string; record: { payload?: T } }>>
}
type Lineage = EventTarget & { explorerSegments?: () => readonly string[] }
type Mode = EventTarget & { mode?: string; setMode(next: string): void }
type Queen = { invoke(args: string): Promise<void> | void }

type ViewRow = ViewDescriptor & { attached: boolean; active: boolean }

const REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const DECORATIONS_KEY = '@diamondcoreprocessor.com/DecorationService'
const MODE_KEY = '@hypercomb.social/ViewMode'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const ioc = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const FRIENDLY: Record<string, { name: string; description: string; icon: string }> = {
  'living-brief': {
    name: 'Living Brief', icon: 'description',
    description: 'A polished report with contents, sections, tags, and question-and-answer callouts.',
  },
  'evidence-atlas': {
    name: 'Evidence Atlas', icon: 'account_tree',
    description: 'Sort questions, evidence, answers, decisions, and risks into analytical lanes.',
  },
  'knowledge-studio': {
    name: 'Knowledge Studio', icon: 'view_carousel',
    description: 'Turn categories into a guided sequence of editorial scenes.',
  },
}
const LIBRARY_VIEWS = new Set(Object.keys(FRIENDLY))

@Component({
  selector: 'hc-views-viewer',
  standalone: true,
  imports: [DockInsetDirective, HcDockedPanelDirective, TranslatePipe],
  templateUrl: './views-viewer.component.html',
  styleUrls: ['./views-viewer.component.scss'],
})
export class ViewsViewerComponent implements OnDestroy {
  readonly visible = signal(false)
  readonly loading = signal(false)
  readonly rows = signal<readonly ViewRow[]>([])
  readonly subject = signal('Current category')
  readonly attachedCount = computed(() => this.rows().filter(row => row.attached).length)

  #registry: Registry | null = null
  #lineage: Lineage | null = null
  #mode: Mode | null = null
  #openOff: (() => void) | null = null
  #closeOff: (() => void) | null = null
  #changedOff: (() => void) | null = null
  #refreshToken = 0
  readonly #changed = (): void => { if (this.visible()) void this.refresh() }

  constructor() {
    this.#openOff = EffectBus.on('views:open', () => this.open())
    this.#closeOff = EffectBus.on('views:close', () => this.close())
    this.#changedOff = EffectBus.on('decorations:changed', this.#changed)
    window.addEventListener('keydown', this.#key, true)
    this.#bind()
  }

  ngOnDestroy(): void {
    this.#openOff?.(); this.#closeOff?.(); this.#changedOff?.()
    this.#registry?.removeEventListener('change', this.#changed)
    this.#lineage?.removeEventListener('change', this.#changed)
    this.#mode?.removeEventListener('change', this.#changed)
    window.removeEventListener('keydown', this.#key, true)
  }

  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.visible()) return
    event.preventDefault(); event.stopImmediatePropagation(); this.close()
  }

  #bind(): void {
    this.#registry = ioc<Registry>(REGISTRY_KEY) ?? null
    this.#lineage = ioc<Lineage>(LINEAGE_KEY) ?? null
    this.#mode = ioc<Mode>(MODE_KEY) ?? null
    this.#registry?.addEventListener('change', this.#changed)
    this.#lineage?.addEventListener('change', this.#changed)
    this.#mode?.addEventListener('change', this.#changed)
  }

  open(): void {
    if (!this.#registry || !this.#lineage || !this.#mode) this.#bind()
    this.visible.set(true)
    void this.refresh()
  }
  close(): void { this.visible.set(false) }

  async refresh(): Promise<void> {
    const token = ++this.#refreshToken
    this.loading.set(true)
    const segments = [...(this.#lineage?.explorerSegments?.() ?? [])]
    this.subject.set(segments.at(-1) || 'Hive root')
    const decorations = ioc<Decorations>(DECORATIONS_KEY)
    const mode = this.#mode?.mode ?? 'hexagons'
    const descriptors = (this.#registry?.all() ?? [])
      .filter(view => view.behavior !== 'navigation' && !!view.decorationKind)
    const rows = await Promise.all(descriptors.map(async view => ({
      ...view,
      attached: !!(decorations && (await decorations.list({ kind: view.decorationKind, segments })).length),
      active: mode === view.view,
    })))
    if (token !== this.#refreshToken) return
    rows.sort((a, b) => {
      const ai = Object.keys(FRIENDLY).indexOf(a.view)
      const bi = Object.keys(FRIENDLY).indexOf(b.view)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || this.name(a).localeCompare(this.name(b))
    })
    this.rows.set(rows)
    this.loading.set(false)
  }

  name(row: ViewDescriptor): string {
    return FRIENDLY[row.view]?.name ?? row.view.split(/[-_]/).map(x => x[0]?.toUpperCase() + x.slice(1)).join(' ')
  }
  description(row: ViewDescriptor): string {
    return FRIENDLY[row.view]?.description ?? `A different way to view this category using ${row.slashCommand}.`
  }
  icon(row: ViewDescriptor): string { return FRIENDLY[row.view]?.icon ?? row.toggleIcon ?? row.iconName ?? 'dashboard' }

  async toggleAttached(row: ViewRow): Promise<void> {
    if (!row.queenKey) return
    if (row.active && row.attached) this.#mode?.setMode('hexagons')
    await ioc<Queen>(row.queenKey)?.invoke('here')
    // The decoration commit cascades asynchronously. Reflect the participant's
    // completed gesture immediately; decorations:changed refreshes this again
    // once the layer head settles.
    this.rows.update(rows => rows.map(candidate =>
      candidate.view === row.view
        ? { ...candidate, attached: !row.attached, active: false }
        : (!row.attached && LIBRARY_VIEWS.has(row.view) && LIBRARY_VIEWS.has(candidate.view))
          ? { ...candidate, attached: false, active: false }
          : candidate))
    await this.refresh()
  }

  async activate(row: ViewRow): Promise<void> {
    if (!row.attachable || !row.queenKey) return
    await this.toggleAttached(row)
  }

  openView(row: ViewRow): void {
    if (!row.attached) return
    this.#mode?.setMode(row.view)
    this.close()
  }

  closeView(row: ViewRow): void {
    if (!row.active) return
    this.#mode?.setMode('hexagons')
    void this.refresh()
  }
}

registerShellSurface({
  name: 'hc-views-viewer',
  owner: '@hypercomb.shared/ViewsViewerComponent',
  component: ViewsViewerComponent,
  order: 67,
})
