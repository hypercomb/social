import { Component, signal, computed, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { AggregateItem } from '../aggregate-index/aggregate-source'

type Scope = 'local' | 'global'
type FilterConfiguration = {
  name: string
  scope: Scope
  branch: string
  places: AggregateItem[]
}

const STORAGE_KEY = 'hc:tile-filter-configurations'
const DRAG_THRESHOLD = 5

@Component({
  selector: 'hc-filter-configurations',
  standalone: true,
  imports: [DockInsetDirective, HcDockedPanelDirective, TranslatePipe],
  templateUrl: './filter-configurations.component.html',
  styleUrls: ['./filter-configurations.component.scss'],
})
export class FilterConfigurationsComponent implements OnDestroy {
  readonly visible = signal(false)

  /** Put away while the hive is covered. No `filter:view` — that would clear
   *  the filter the canvas is drawn through, and hiding the window must not
   *  change what the hive shows; the draft is still here on return. */
  readonly session = signalSession(this.visible, undefined, { close: () => this.close() })

  readonly scope = signal<Scope>('local')
  readonly name = signal('')
  readonly draft = signal<AggregateItem[]>([])
  readonly configurations = signal<FilterConfiguration[]>(this.#load())
  readonly dragging = signal<FilterConfiguration | null>(null)
  readonly dragPos = signal({ x: 0, y: 0 })
  readonly dirty = computed(() => this.draft().length > 0 || !!this.name().trim())

  #activeName = ''
  #pending: { config: FilterConfiguration; x: number; y: number } | null = null
  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(
      EffectBus.on('swarm:filter-view-open', () => this.openNew()),
      // The close counterpart. Every sibling tool window has one
      // (`tags:view-close`, `files:viewer-close`, `sequence:view-close`,
      // `aggregate:view-close`, `features:viewer-close`, `rewind:close`,
      // `context:window-close`); this one was the only window openable by
      // effect and closable only by its own button — so nothing that opened it
      // could put it away again.
      EffectBus.on('swarm:filter-view-close', () => { if (this.visible()) this.close() }),
      EffectBus.on<{ item?: AggregateItem }>('filter-config:place-drop', ({ item }) => {
        if (!this.visible() || !item) return
        if (this.draft().some(p => p.key === item.key)) return
        this.draft.update(items => [...items, item])
        this.#emitDraft()
      }),
    )
  }

  openNew(): void {
    this.visible.set(true)
    this.#activeName = ''
    this.name.set('')
    this.draft.set([])
    this.#emitDraft()
  }

  close(): void {
    this.visible.set(false)
    this.name.set('')
    this.draft.set([])
    this.#activeName = ''
    EffectBus.emit('filter:view', { active: false, labels: [] })
  }

  setScope(scope: Scope): void { this.scope.set(scope) }
  onName(event: Event): void { this.name.set((event.target as HTMLInputElement).value) }

  select(config: FilterConfiguration): void {
    this.visible.set(true)
    this.#activeName = config.name
    this.name.set(config.name)
    this.scope.set(config.scope)
    this.draft.set(config.places.map(p => ({ ...p, segments: [...p.segments], tags: p.tags ? [...p.tags] : undefined })))
    this.#emitDraft()
  }

  removePlace(key: string): void {
    this.draft.update(items => items.filter(p => p.key !== key))
    this.#emitDraft()
  }

  save(): void {
    const clean = this.name().trim().slice(0, 64)
    if (!clean) return
    const config: FilterConfiguration = {
      name: clean,
      scope: this.scope(),
      branch: this.scope() === 'local' ? this.#branch() : '',
      places: this.draft().map(p => ({ ...p })),
    }
    const next = this.configurations().filter(c => c.name !== clean)
    next.push(config)
    next.sort((a, b) => a.name.localeCompare(b.name))
    this.configurations.set(next)
    this.#activeName = clean
    this.#persist(next)
  }

  delete(config: FilterConfiguration, event: Event): void {
    event.stopPropagation()
    const next = this.configurations().filter(c => c.name !== config.name)
    this.configurations.set(next)
    this.#persist(next)
    if (this.#activeName === config.name) this.openNew()
  }

  onConfigPointerDown(event: PointerEvent, config: FilterConfiguration): void {
    if (event.button !== 0) return
    this.#pending = { config, x: event.clientX, y: event.clientY }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragMove = (event: PointerEvent): void => {
    const pending = this.#pending
    if (!pending) return
    if (!this.dragging() && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= DRAG_THRESHOLD) {
      this.dragging.set(pending.config)
      EffectBus.emit('drop:dragging', { active: true, groupOnly: true })
    }
    if (this.dragging()) this.dragPos.set({ x: event.clientX, y: event.clientY })
  }

  #onDragUp = (event: PointerEvent): void => {
    const pending = this.#pending
    const dragged = !!this.dragging()
    this.#finishDrag()
    if (!pending || !dragged) return
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (el?.closest('hc-filter-configurations')) return
    // A configuration is a group-level canvas view. It deliberately never
    // resolves or selects the tile under the pointer.
    this.select(pending.config)
    EffectBus.emit('filter:group-drop', { configuration: pending.config })
  }

  #onDragCancel = (): void => this.#finishDrag()

  #finishDrag(): void {
    this.#pending = null
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
    if (this.dragging()) EffectBus.emit('drop:dragging', { active: false, groupOnly: true })
    this.dragging.set(null)
  }

  #emitDraft(): void {
    EffectBus.emit('filter:view', {
      active: true,
      labels: this.draft().map(p => p.label),
      places: this.draft(),
      scope: this.scope(),
    })
  }

  #branch(): string {
    return location.pathname.replace(/^\/+|\/+$/g, '')
  }

  #load(): FilterConfiguration[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }

  #persist(configs: FilterConfiguration[]): void {
    try {
      if (configs.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* best effort */ }
  }

  ngOnDestroy(): void {
    this.#finishDrag()
    for (const cleanup of this.#cleanups) cleanup()
  }
}

registerShellSurface({
  name: 'hc-filter-configurations',
  owner: '@hypercomb.shared/FilterConfigurationsComponent',
  component: FilterConfigurationsComponent,
  order: 235,
})
