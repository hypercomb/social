import { Component, OnDestroy, computed, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { TranslatePipe } from '../../core/i18n.pipe'
import {
  hideFeature,
  hiddenKey,
  loadHidden,
  restoreFeature,
  type HiddenFeature,
} from '../features-viewer/feature-hidden'

type ViewDescriptor = {
  view: string
  slashCommand: string
  toggleIcon?: string
  iconName: string
  decorationKind: string
  slot?: string
  queenKey?: string
  behavior?: 'render' | 'navigation'
  attachable?: boolean
  sourceScopes?: readonly SourceScope[]
  labelKey?: string
  descriptionKey?: string
  opensOnTileClick?: boolean
  scope?: 'node' | 'branch'
  cascades?: boolean
}
type Registry = EventTarget & { all(): ViewDescriptor[] }
type Decorations = {
  list<T>(opts: { kind: string; segments: readonly string[] }): Promise<Array<{ sig: string; record: { payload?: T } }>>
}
type Lineage = EventTarget & { explorerSegments?: () => readonly string[] }
type Mode = EventTarget & { mode?: string; setMode(next: string): void }
type Queen = { invoke(args: string): Promise<void> | void }
type History = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}

type SourceScope = 'layer' | 'hierarchy'
type ViewRow = ViewDescriptor & {
  attached: boolean
  enabled: boolean
  hiddenRecord: HiddenFeature | null
  active: boolean
  sourceScope: SourceScope
}

const REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const DECORATIONS_KEY = '@diamondcoreprocessor.com/DecorationService'
const MODE_KEY = '@hypercomb.social/ViewMode'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const ioc = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const FRIENDLY: Record<string, { name: string; description: string; icon: string }> = {
  'living-brief': {
    name: 'Living Brief', icon: 'description',
    description: 'A polished report with contents, sections, tags, and question-and-answer callouts.',
  },
  'evidence-atlas': {
    name: 'Evidence Atlas', icon: 'hub',
    description: 'Sort questions, evidence, answers, decisions, and risks into analytical lanes.',
  },
  'knowledge-studio': {
    name: 'Knowledge Studio', icon: 'view_carousel',
    description: 'Turn categories into a guided sequence of editorial scenes.',
  },
}
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
  readonly attachedCount = computed(() => this.rows().filter(row => row.enabled).length)
  readonly defaultView = signal('')

  #registry: Registry | null = null
  #lineage: Lineage | null = null
  #mode: Mode | null = null
  #openOff: (() => void) | null = null
  #closeOff: (() => void) | null = null
  #changedOff: (() => void) | null = null
  #hiddenOff: (() => void) | null = null
  #restoredOff: (() => void) | null = null
  #settledOff: (() => void) | null = null
  #refreshToken = 0
  #mutationDepth = 0
  readonly #pendingViews = new Set<string>()
  readonly #changed = (): void => {
    if (this.visible() && this.#mutationDepth === 0) void this.refresh()
  }

  constructor() {
    this.#openOff = EffectBus.on('views:open', () => this.open())
    this.#closeOff = EffectBus.on('views:close', () => this.close())
    this.#changedOff = EffectBus.on('decorations:changed', this.#changed)
    this.#hiddenOff = EffectBus.on<{
      featKind?: string; view?: string; segments?: readonly string[]
    }>('feature:hidden', payload => this.#activationChanged(true, payload))
    this.#restoredOff = EffectBus.on<{
      featKind?: string; view?: string; segments?: readonly string[]
    }>('feature:restored', payload => this.#activationChanged(false, payload))
    this.#settledOff = EffectBus.on('feature:activation-settled', this.#changed)
    window.addEventListener('keydown', this.#key, true)
    this.#bind()
  }

  ngOnDestroy(): void {
    this.#openOff?.(); this.#closeOff?.(); this.#changedOff?.()
    this.#hiddenOff?.(); this.#restoredOff?.(); this.#settledOff?.()
    this.#registry?.removeEventListener('change', this.#changed)
    this.#lineage?.removeEventListener('change', this.#changed)
    this.#mode?.removeEventListener('change', this.#changed)
    window.removeEventListener('keydown', this.#key, true)
  }

  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.visible()) return
    event.preventDefault(); event.stopImmediatePropagation(); this.close()
  }

  #activationChanged(
    hidden: boolean,
    payload: { featKind?: string; view?: string; segments?: readonly string[] } | undefined,
  ): void {
    const target = (payload?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const here = [...(this.#lineage?.explorerSegments?.() ?? [])]
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const exact = this.#locationKey(target) === this.#locationKey(here)
    this.rows.update(rows => rows.map(row => {
      if (row.decorationKind !== payload?.featKind && row.view !== payload?.view) return row
      const inherited = (row.scope === 'branch' || !!row.cascades) &&
        target.length <= here.length && target.every((segment, i) => here[i] === segment)
      if (!exact && !inherited) return row
      return { ...row, enabled: hidden ? false : row.attached, active: hidden ? false : row.active }
    }))
    if (hidden && this.defaultView() === payload?.view) {
      this.#writeDefault(here, '')
      this.defaultView.set('')
    }
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
    EffectBus.emit('views:state', { open: true })
    void this.refresh()
  }
  close(): void {
    this.visible.set(false)
    EffectBus.emit('views:state', { open: false })
  }

  async refresh(): Promise<void> {
    const token = ++this.#refreshToken
    this.loading.set(true)
    const segments = [...(this.#lineage?.explorerSegments?.() ?? [])]
    this.subject.set(segments.at(-1) || 'Hive root')
    const decorations = ioc<Decorations>(DECORATIONS_KEY)
    const mode = this.#mode?.mode ?? 'hexagons'
    const hidden = await loadHidden()
    const history = ioc<History>(HISTORY_KEY)
    const locationSig = history
      ? await history.sign({ explorerSegments: () => segments })
      : ''
    const layer = history && locationSig
      ? await history.currentLayerAt(locationSig)
      : null
    const descriptors = (this.#registry?.all() ?? [])
      .filter(view => view.behavior !== 'navigation' && !!view.decorationKind)
    const rows = await Promise.all(descriptors.map(async view => {
      const records = decorations
        ? await decorations.list<{ sourceScope?: SourceScope }>({
          kind: view.decorationKind,
          segments,
        })
        : []
      const slotValue = view.slot && layer ? layer[view.slot] : undefined
      const slotPresent = Array.isArray(slotValue) && slotValue.length > 0
      const attached = records.length > 0 || slotPresent
      const hiddenRecord = this.#hiddenRecord(view, segments, hidden)
      const enabled = attached && !hiddenRecord
      return {
        ...view,
        attached,
        enabled,
        hiddenRecord,
        active: enabled && mode === view.view,
        sourceScope: records.at(-1)?.record.payload?.sourceScope === 'hierarchy'
          ? 'hierarchy' as const
          : 'layer' as const,
      }
    }))
    if (token !== this.#refreshToken) return
    rows.sort((a, b) => {
      const ai = Object.keys(FRIENDLY).indexOf(a.view)
      const bi = Object.keys(FRIENDLY).indexOf(b.view)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || this.name(a).localeCompare(this.name(b))
    })
    this.rows.set(rows)
    const attachedDefaults = rows.filter(row => row.enabled && row.opensOnTileClick)
    const storedDefault = this.#storedDefault(segments)
    const selected = attachedDefaults.find(row => row.view === storedDefault)
    this.defaultView.set(selected?.view ?? '')
    this.loading.set(false)
  }

  #hiddenRecord(
    view: ViewDescriptor,
    segments: readonly string[],
    hidden: readonly HiddenFeature[],
  ): HiddenFeature | null {
    const at = (target: readonly string[]): HiddenFeature | undefined =>
      hidden.find(record =>
        hiddenKey(record.featKind, record.appliesTo) === hiddenKey(view.decorationKind, target))
    const exact = at(segments)
    if (exact) return exact
    if (view.scope !== 'branch' && !view.cascades) return null
    for (let depth = segments.length - 1; depth >= 1; depth--) {
      const inherited = at(segments.slice(0, depth))
      if (inherited) return inherited
    }
    return null
  }

  #locationKey(segments: readonly string[]): string {
    return segments.map(s => String(s ?? '').trim()).filter(Boolean).join('\u0000')
  }

  #storedDefault(segments: readonly string[]): string {
    try {
      const prefs = JSON.parse(localStorage.getItem('hc:view-defaults') ?? '{}') as Record<string, unknown>
      return String(prefs?.[this.#locationKey(segments)] ?? '')
    } catch { return '' }
  }

  #writeDefault(segments: readonly string[], view: string): void {
    let prefs: Record<string, string> = {}
    try { prefs = JSON.parse(localStorage.getItem('hc:view-defaults') ?? '{}') as Record<string, string> }
    catch { /* replace malformed preferences */ }
    const key = this.#locationKey(segments)
    if (view) prefs[key] = view
    else delete prefs[key]
    localStorage.setItem('hc:view-defaults', JSON.stringify(prefs))
  }

  setDefault(event: Event, row: ViewRow): void {
    event.preventDefault()
    event.stopPropagation()
    if (!row.enabled || !row.opensOnTileClick) return
    const segments = [...(this.#lineage?.explorerSegments?.() ?? [])]
    this.#writeDefault(segments, row.view)
    this.defaultView.set(row.view)
  }

  name(row: ViewDescriptor): string {
    return FRIENDLY[row.view]?.name ?? row.view.split(/[-_]/).map(x => x[0]?.toUpperCase() + x.slice(1)).join(' ')
  }
  description(row: ViewDescriptor): string {
    return FRIENDLY[row.view]?.description ?? `A different way to view this category using ${row.slashCommand}.`
  }
  icon(row: ViewDescriptor): string { return FRIENDLY[row.view]?.icon ?? row.toggleIcon ?? row.iconName ?? 'dashboard' }
  hasSourceScopes(row: ViewDescriptor): boolean {
    return row.sourceScopes?.includes('layer') === true &&
      row.sourceScopes.includes('hierarchy')
  }

  async toggleAttached(row: ViewRow): Promise<void> {
    if ((!row.attached && !row.queenKey) || this.#pendingViews.has(row.view)) return
    this.#pendingViews.add(row.view)
    this.#mutationDepth++
    const segments = [...(this.#lineage?.explorerSegments?.() ?? [])]
    if (row.enabled) this.#mode?.setMode('hexagons')
    if (row.enabled && this.defaultView() === row.view) {
      this.#writeDefault([...(this.#lineage?.explorerSegments?.() ?? [])], '')
      this.defaultView.set('')
    }
    const nextEnabled = !row.enabled
    this.rows.update(rows => rows.map(candidate =>
      candidate.view === row.view
        ? {
          ...candidate,
          attached: row.attached || nextEnabled,
          enabled: nextEnabled,
          hiddenRecord: nextEnabled ? null : candidate.hiddenRecord,
          active: false,
        }
        : candidate))
    try {
      if (!row.attached) {
        await ioc<Queen>(row.queenKey!)?.invoke('here')
        if (row.hiddenRecord) {
          await restoreFeature(row.hiddenRecord.recordSig, {
            featKind: row.decorationKind,
            view: row.view,
            segments: row.hiddenRecord.appliesTo,
          })
        }
      } else if (row.enabled) {
        await hideFeature({
          featKind: row.decorationKind,
          view: row.view,
          label: this.name(row),
          segments,
        })
      } else if (row.hiddenRecord) {
        await restoreFeature(row.hiddenRecord.recordSig, {
          featKind: row.decorationKind,
          view: row.view,
          segments: row.hiddenRecord.appliesTo,
        })
      }
    } finally {
      this.#mutationDepth--
      this.#pendingViews.delete(row.view)
      // Reconcile only after the durable hidden/declaration write.
      await this.refresh()
    }
  }

  async activate(row: ViewRow): Promise<void> {
    if (!row.attached && (!row.attachable || !row.queenKey)) return
    await this.toggleAttached(row)
  }

  async setSourceScope(event: Event, row: ViewRow, scope: SourceScope): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    if (!row.queenKey || !this.hasSourceScopes(row)) return
    if (row.attached && row.sourceScope === scope) return
    await ioc<Queen>(row.queenKey)?.invoke(`scope ${scope}`)
    this.rows.update(rows => rows.map(candidate =>
      candidate.view === row.view
        ? { ...candidate, attached: true, sourceScope: scope }
        : candidate))
  }

  openView(row: ViewRow): void {
    if (!row.enabled) return
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
