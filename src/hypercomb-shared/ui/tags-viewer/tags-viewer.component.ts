// hypercomb-shared/ui/tags-viewer/tags-viewer.component.ts
//
// Right-docked "Tags" panel — the management view for the tag system. Opened
// by the `/tags` command (`tags:view-open`). Lists every tag the participant
// knows (the global TagRegistry ∪ whatever is on the current page), each with:
//   • a colour swatch that doubles as a recolour control,
//   • the count of currently-visible tiles carrying it,
//   • a filter toggle (drives the same cross-page tag flatten as the
//     controls-bar pills, via `tags:filter`),
//   • a remove control (drops it from the master registry).
//
// Shell UI, so it must NOT import essentials — it reads the TagRegistry and
// emits tag effects over IoC / EffectBus, exactly like the controls bar. Tag
// names come from `tags:registry` (the registry's broadcast) and counts from
// `render:tags` (show-cell's per-page aggregation); both are sticky on the bus
// so a freshly-opened panel hydrates immediately.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'

interface TagRow {
  name: string
  color: string
  count: number
}

type TagEntry = { color?: string; enabled?: boolean; accent?: string }
type TagRegistryLike = {
  ensureLoaded(): Promise<void>
  all: Record<string, TagEntry>
  color(name: string): string
  add(name: string, color?: string): Promise<void>
  remove(name: string): Promise<void>
}

@Component({
  selector: 'hc-tags-viewer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './tags-viewer.component.html',
  styleUrls: ['./tags-viewer.component.scss'],
})
export class TagsViewerComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Per-page tag counts, last value from `render:tags`. */
  readonly #counts = signal<Map<string, number>>(new Map())
  /** Registry version bump — forces `rows` to re-read the registry. */
  readonly #registryVersion = signal(0)
  /** Active tag filters (mirrors `tags:filter` so the panel and the
   *  controls-bar pills agree on what's filtered). */
  readonly #active = signal<Set<string>>(new Set())

  /** Sorted tag rows: every registry tag plus any page tag not yet registered,
   *  each with its colour and current visible count. */
  readonly rows = computed<TagRow[]>(() => {
    this.#registryVersion()
    const counts = this.#counts()
    const registry = this.#registry()
    const names = new Set<string>()
    if (registry) for (const n of Object.keys(registry.all)) names.add(n)
    for (const n of counts.keys()) names.add(n)
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name, color: this.#colorOf(name, registry), count: counts.get(name) ?? 0 }))
  })

  readonly totalTags = computed(() => this.rows().length)

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on('tags:view-open', () => {
      void this.#registry()?.ensureLoaded().then(() => this.#registryVersion.update(v => v + 1))
      this.#registryVersion.update(v => v + 1)
      this.visible.set(true)
    }))
    this.#cleanups.push(EffectBus.on('tags:view-close', () => this.close()))

    // Sticky: last per-page counts replay on subscribe.
    this.#cleanups.push(EffectBus.on<{ tags: { name: string; count: number }[] }>('render:tags', (p) => {
      const map = new Map<string, number>()
      for (const t of p?.tags ?? []) if (t?.name) map.set(t.name, t.count ?? 0)
      this.#counts.set(map)
    }))

    // Registry changed (add / recolor / remove) → re-read.
    this.#cleanups.push(EffectBus.on('tags:registry', () => this.#registryVersion.update(v => v + 1)))

    // Mirror the active filter set (sticky) so the toggles reflect whatever
    // the controls-bar pills set, and vice-versa.
    this.#cleanups.push(EffectBus.on<{ active: string[] }>('tags:filter', (p) => {
      this.#active.set(new Set(Array.isArray(p?.active) ? p.active : []))
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  #registry(): TagRegistryLike | undefined {
    return get('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
  }

  #colorOf(name: string, registry: TagRegistryLike | undefined): string {
    const c = registry?.color(name)
    if (c) return c
    try {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      if (stored[name]) return stored[name]
    } catch { /* fall through */ }
    return '#7eb6d6'
  }

  isFiltered(name: string): boolean {
    return this.#active().has(name)
  }

  /** Toggle a tag in the active filter set and broadcast it — same effect the
   *  controls-bar pills emit, so the cross-page flatten reacts identically. */
  toggleFilter(name: string): void {
    const next = new Set(this.#active())
    if (next.has(name)) next.delete(name); else next.add(name)
    this.#active.set(next)
    EffectBus.emit('tags:filter', { active: [...next] })
  }

  /** Recolour a tag from the native colour input. Writing through the registry
   *  re-broadcasts `tags:registry`, which repaints the pills + on-tile badges. */
  recolor(name: string, event: Event): void {
    const color = (event.target as HTMLInputElement | null)?.value
    if (!color) return
    void this.#registry()?.add(name, color)
  }

  /** Remove a tag from the master registry (global GC). Tag decorations already
   *  on cells stay until removed per-cell via `~cell:tag`; this clears the tag
   *  from the registry-driven UI (pills, this view) and the active filter. */
  remove(name: string): void {
    void this.#registry()?.remove(name)
    if (this.#active().has(name)) {
      const next = new Set(this.#active())
      next.delete(name)
      this.#active.set(next)
      EffectBus.emit('tags:filter', { active: [...next] })
    }
  }

  close(): void {
    this.visible.set(false)
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    this.close()
  }
}
