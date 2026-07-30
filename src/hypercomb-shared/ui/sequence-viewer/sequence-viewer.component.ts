import { Component, OnDestroy, computed, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { TranslatePipe } from '../../core/i18n.pipe'

type SequenceSet = { name: string; indexes: number[] }
type SequenceService = EventTarget & { list(): string[]; get(name: string): SequenceSet | null }
type Row = { id: string; name: string; detail: string; builtIn: boolean }
const ioc = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

@Component({
  selector: 'hc-sequence-viewer',
  standalone: true,
  imports: [DockInsetDirective, HcDockedPanelDirective, TranslatePipe],
  templateUrl: './sequence-viewer.component.html',
  styleUrls: ['./sequence-viewer.component.scss'],
})
export class SequenceViewerComponent implements OnDestroy {
  readonly visible = signal(false)
  readonly active = signal('')
  readonly rows = signal<readonly Row[]>([])
  readonly savedCount = computed(() => this.rows().filter(r => !r.builtIn).length)
  #service: SequenceService | null = null
  #offs: Array<() => void> = []
  readonly #changed = (): void => this.refresh()

  constructor() {
    this.#offs.push(
      EffectBus.on('sequence:view-open', () => this.open()),
      EffectBus.on('sequence:view-close', () => this.close()),
      EffectBus.on<{ id?: string }>('sequence:selected', ({ id }) => { if (id) this.active.set(id) }),
    )
    window.addEventListener('keydown', this.#key, true)
    this.#bind()
  }
  ngOnDestroy(): void {
    this.#offs.forEach(off => off())
    this.#service?.removeEventListener('change', this.#changed)
    window.removeEventListener('keydown', this.#key, true)
  }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.visible()) return
    event.preventDefault(); event.stopImmediatePropagation(); this.close()
  }
  #bind(): void {
    this.#service?.removeEventListener('change', this.#changed)
    this.#service = ioc<SequenceService>('@diamondcoreprocessor.com/SequenceService') ?? null
    this.#service?.addEventListener('change', this.#changed)
  }
  open(): void { this.#bind(); this.refresh(); this.visible.set(true) }
  close(): void { this.visible.set(false) }
  refresh(): void {
    const builtIns: Row[] = [
      { id: 'three-lanes', name: 'Three lanes', detail: 'A readable three-lane scrolling strip.', builtIn: true },
      { id: 'rectangle', name: 'Rectangle', detail: 'A compact, balanced block.', builtIn: true },
      { id: 'flower', name: 'Flowers', detail: 'Clusters of seven around a centre tile.', builtIn: true },
    ]
    const saved = (this.#service?.list() ?? []).map(name => ({
      id: name, name,
      detail: `${this.#service?.get(name)?.indexes.length ?? 0} ordered drop targets`,
      builtIn: false,
    }))
    this.rows.set([...builtIns, ...saved])
  }
  select(row: Row): void { EffectBus.emit('sequence:select', { id: row.id }) }
  create(): void { this.close(); EffectBus.emit('sequence:edit', { name: 'default' }) }
  edit(row: Row): void {
    if (row.builtIn) return
    this.close(); EffectBus.emit('sequence:edit', { name: row.id })
  }
}

registerShellSurface({
  name: 'hc-sequence-viewer',
  owner: '@hypercomb.shared/SequenceViewerComponent',
  component: SequenceViewerComponent,
  order: 68,
})
