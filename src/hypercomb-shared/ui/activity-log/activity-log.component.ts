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
import { EffectBus } from '@hypercomb/core'
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

  readonly entries = this.#entries.asReadonly()
  readonly hasEntries = computed(() => this.#entries().length > 0)

  constructor() {
    this.#unsubs.push(
      EffectBus.on<{ seed: string }>('seed:added', p => {
        if (!this.#ready || !p?.seed || HIDDEN.has('seed:added')) return
        if (this.#reverting) { this.#addEntry('+', `added "${p.seed}"`); return }
        this.#addEntry('+', `added "${p.seed}"`, () => this.#revertAdd(p.seed))
      }),
      EffectBus.on<{ seed: string }>('seed:removed', p => {
        if (!this.#ready || !p?.seed || HIDDEN.has('seed:removed')) return
        if (this.#reverting) { this.#addEntry('\u2212', `removed "${p.seed}"`); return }
        this.#addEntry('\u2212', `removed "${p.seed}"`, () => this.#revertRemove(p.seed))
      }),
      EffectBus.on<{ count: number; op: string }>('clipboard:paste-done', p => {
        if (!this.#ready || !p || HIDDEN.has('clipboard:paste-done')) return
        this.#addEntry('\u2398', `pasted ${p.count} tile${p.count === 1 ? '' : 's'}`)
      }),
      EffectBus.on('move:committed', () => {
        if (!this.#ready || HIDDEN.has('move:committed')) return
        this.#addEntry('\u2194', 'tile moved')
      }),
      EffectBus.on<{ public: boolean }>('mesh:public-changed', p => {
        if (!this.#ready || !p || HIDDEN.has('mesh:public-changed')) return
        this.#addEntry('\u25C6', p.public ? 'mesh \u2192 public' : 'mesh \u2192 private')
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

  /** Revert an add — remove the seed directory and emit seed:removed. */
  async #revertAdd(seed: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as Lineage
    const dir = await lineage.explorerDir()
    if (!dir) return
    try {
      await dir.removeEntry(seed, { recursive: true })
      this.#reverting = true
      EffectBus.emit('seed:removed', { seed })
      this.#reverting = false
      window.dispatchEvent(new Event('synchronize'))
    } catch { /* entry doesn't exist — nothing to undo */ }
  }

  /** Revert a remove — re-create the seed directory and emit seed:added. */
  async #revertRemove(seed: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as Lineage
    const dir = await lineage.explorerDir()
    if (!dir) return
    try {
      await dir.getDirectoryHandle(seed, { create: true })
      this.#reverting = true
      EffectBus.emit('seed:added', { seed })
      this.#reverting = false
      window.dispatchEvent(new Event('synchronize'))
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
