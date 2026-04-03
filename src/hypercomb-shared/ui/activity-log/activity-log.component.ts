// hypercomb-shared/ui/activity-log/activity-log.component.ts
// Minimal activity log — shows recent hive operations as auto-dismissing line items.

import {
  ApplicationRef,
  Component,
  computed,
  inject,
  signal,
  type OnDestroy,
} from '@angular/core'
import { EffectBus, hypercomb, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { Lineage } from '../../core/lineage'

interface ActivityEntry {
  id: number
  icon: string
  message: string
  timer: ReturnType<typeof setTimeout> | null
  fading: boolean
  revert: (() => Promise<void>) | null
}

const TIMEOUT_S = 10

// Effects hidden from the activity log. Add effect names here to suppress them.
const HIDDEN: Set<string> = new Set([
  'mesh:public-changed',
])

@Component({
  selector: 'hc-activity-log',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './activity-log.component.html',
  styleUrls: ['./activity-log.component.scss'],
})
export class ActivityLogComponent implements OnDestroy {

  #appRef = inject(ApplicationRef)
  #entries = signal<ActivityEntry[]>([])
  #nextId = 0
  #ready = false
  #reverting = false
  #unsubs: (() => void)[] = []

  get #i18n(): I18nProvider | undefined {
    return get('@hypercomb.social/I18n') as I18nProvider | undefined
  }

  readonly entries = this.#entries.asReadonly()
  readonly hasEntries = computed(() => this.#entries().length > 0)

  constructor() {
    this.#unsubs.push(
      EffectBus.on<{ cell: string }>('cell:added', p => {
        if (!this.#ready || !p?.cell || HIDDEN.has('cell:added')) return
        const msg = this.#i18n?.t('activity.added', { cell: p.cell }) ?? `added "${p.cell}"`
        if (this.#reverting) { this.#addEntry('+', msg); return }
        this.#addEntry('+', msg, () => this.#revertAdd(p.cell))
      }),
      EffectBus.on<{ cell: string }>('cell:removed', p => {
        if (!this.#ready || !p?.cell || HIDDEN.has('cell:removed')) return
        const msg = this.#i18n?.t('activity.removed', { cell: p.cell }) ?? `removed "${p.cell}"`
        if (this.#reverting) { this.#addEntry('\u2212', msg); return }
        this.#addEntry('\u2212', msg, () => this.#revertRemove(p.cell))
      }),
      EffectBus.on<{ count: number; op: string }>('clipboard:paste-done', p => {
        if (!this.#ready || !p || HIDDEN.has('clipboard:paste-done')) return
        const msg = this.#i18n?.t('activity.pasted', { count: p.count }) ?? `pasted ${p.count} tile${p.count === 1 ? '' : 's'}`
        this.#addEntry('\u2398', msg)
      }),
      EffectBus.on('move:committed', () => {
        if (!this.#ready || HIDDEN.has('move:committed')) return
        this.#addEntry('\u2194', this.#i18n?.t('activity.moved') ?? 'tile moved')
      }),
      EffectBus.on<{ public: boolean }>('mesh:public-changed', p => {
        if (!this.#ready || !p || HIDDEN.has('mesh:public-changed')) return
        const key = p.public ? 'activity.mesh-public' : 'activity.mesh-private'
        this.#addEntry('\u25C6', this.#i18n?.t(key) ?? (p.public ? 'mesh \u2192 public' : 'mesh \u2192 private'))
      }),
      EffectBus.on<{ icon?: string; message: string }>('activity:log', p => {
        if (!this.#ready || !p?.message) return
        this.#addEntry(p.icon ?? '\u2139', p.message)
      }),
    )

    queueMicrotask(() => { this.#ready = true })
  }

  ngOnDestroy(): void {
    for (const unsub of this.#unsubs) unsub()
    for (const entry of this.#entries()) entry.timer != null && clearTimeout(entry.timer)
  }

  #addEntry(icon: string, message: string, revert?: () => Promise<void>): void {
    const id = this.#nextId++
    const timer = setTimeout(() => this.dismiss(id), TIMEOUT_S * 1000)
    const entry: ActivityEntry = { id, icon, message, timer, fading: false, revert: revert ?? null }
    this.#entries.update(list => [entry, ...list].slice(0, 20))
    this.#appRef.tick()
  }

  /** Revert an add — remove the cell directory and emit cell:removed. */
  async #revertAdd(cell: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as Lineage
    const dir = await lineage.explorerDir()
    if (!dir) return
    try {
      await dir.removeEntry(cell, { recursive: true })
      this.#reverting = true
      EffectBus.emit('cell:removed', { cell })
      this.#reverting = false
      await new hypercomb().act()
    } catch { /* entry doesn't exist — nothing to undo */ }
  }

  /** Revert a remove — re-create the cell directory and emit cell:added. */
  async #revertRemove(cell: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as Lineage
    const dir = await lineage.explorerDir()
    if (!dir) return
    try {
      await dir.getDirectoryHandle(cell, { create: true })
      this.#reverting = true
      EffectBus.emit('cell:added', { cell })
      this.#reverting = false
      await new hypercomb().act()
    } catch { /* failed to create — skip */ }
  }

  async revertEntry(id: number): Promise<void> {
    const entry = this.#entries().find(e => e.id === id)
    if (!entry?.revert) return
    await entry.revert()
    this.dismiss(id)
  }

  dismiss(id: number): void {
    const list = this.#entries()
    const entry = list.find(e => e.id === id)
    if (!entry || entry.fading) return

    entry.timer != null && clearTimeout(entry.timer)
    entry.fading = true
    this.#entries.set([...list])
    this.#appRef.tick()

    setTimeout(() => {
      this.#entries.update(l => l.filter(e => e.id !== id))
      this.#appRef.tick()
    }, 200)
  }

  clearAll(): void {
    for (const entry of this.#entries()) entry.timer != null && clearTimeout(entry.timer)
    this.#entries.set([])
    this.#appRef.tick()
  }
}
