import { Component, OnDestroy, computed, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
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

  /** Put away while the hive is covered; back on the same sequence. */
  readonly session = signalSession(this.visible, undefined, { close: () => this.close() })

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
    this.#bind()
  }
  ngOnDestroy(): void {
    this.#offs.forEach(off => off())
    this.#service?.removeEventListener('change', this.#changed)
  }
  // Escape's window-CAPTURE listener is gone from here — see the note in
  // features-viewer. Closing now hangs off the session and runs only when the
  // focus is inside this window.
  #bind(): void {
    this.#service?.removeEventListener('change', this.#changed)
    this.#service = ioc<SequenceService>('@diamondcoreprocessor.com/SequenceService') ?? null
    this.#service?.addEventListener('change', this.#changed)
  }
  open(): void { this.#bind(); this.refresh(); this.visible.set(true) }
  close(): void { this.visible.set(false) }
  refresh(): void {
    const builtIns: Row[] = [
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
