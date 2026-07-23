// hypercomb-shared/ui/tags-viewer/tags-viewer.component.ts
//
// Right-docked "Tags" panel — the management view for the tag system. Opened
// by the `/tags` command (`tags:view-open`). Lists every tag the participant
// knows (the global TagRegistry ∪ whatever is on the current page), each with:
//   • a colour swatch that doubles as a recolour control,
//   • the count of currently-visible tiles carrying it,
//   • a filter toggle (drives the same cross-page tag flatten as the
//     controls-bar pills, via `tags:filter`),
//   • a remove control, which ARMS a staged removal rather than acting at once
//     (see below).
//
// ── Staged removal ────────────────────────────────────────────────────────
// Removing a keyword used to be one-way and invisible: the × dropped the tag
// from the master registry while every tile kept its decoration, and there was
// no UI path to take a keyword back off the tiles. Now the × arms a removal:
// the hive filters to that keyword (so every tile carrying it is on screen),
// clicking a tile stages it — the tile paints struck-through and the panel's
// list grows — and only then does Remove commit. Cancel throws it away; the
// hive was never written to.
//
// This panel owns the review surface (the list + the two buttons); the staging
// itself lives in TagRemovalDrone (essentials), which resolves each staged
// tile's location and splices the decoration on commit. `tags:removal-pending`
// is the shared truth between the two, and the renderer marks the same set.
//
// Shell UI, so it must NOT import essentials — it reads the TagRegistry and
// emits tag effects over IoC / EffectBus, exactly like the controls bar. Tag
// names come from `tags:registry` (the registry's broadcast) and counts from
// `render:tags` (show-cell's per-page aggregation); both are sticky on the bus
// so a freshly-opened panel hydrates immediately.

import { registerShellSurface } from '../../core/shell-surface-registry'
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

/** How wide a pheromone filter reaches. Mirrors the controls-bar / show-cell
 *  vocabulary exactly — this is the same value that rides `tags:filter`. */
type Scope = 'local' | 'children' | 'global'

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
  /** How wide a filter reaches. This panel is the control surface for it — the
   *  controls-bar glyph used to cycle it blind. Mirrors `tags:filter`, so bar
   *  and panel can never disagree. Non-sticky, same as the bar. */
  readonly #scope = signal<Scope>('local')

  /** The keyword whose removal is armed, or null. Mirrors
   *  `tags:removal-pending` so the panel can never disagree with the renderer
   *  about what is staged. */
  readonly #removalTag = signal<string | null>(null)
  /** Tiles staged to lose that keyword — the list that grows as you click. */
  readonly #removalCells = signal<string[]>([])

  readonly scope = this.#scope.asReadonly()
  readonly removalTag = this.#removalTag.asReadonly()
  readonly removalCells = this.#removalCells.asReadonly()
  readonly removalCount = computed(() => this.#removalCells().length)
  readonly activeNames = computed(() => [...this.#active()].sort((a, b) => a.localeCompare(b)))
  readonly hasFilter = computed(() => this.#active().size > 0)

  /** The three reaches, each named and explained. The whole point of the panel:
   *  a reach you can read instead of a glyph you have to decode. */
  readonly scopeOptions: readonly { id: Scope; icon: string }[] = [
    { id: 'local', icon: 'center_focus_strong' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]

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
      // Broadcast open-state (last-value replayed) so the header toggle lights.
      EffectBus.emit('tags:view-state', { open: true })
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

    // Mirror the active filter set AND the reach (sticky) so the toggles
    // reflect whatever the controls-bar pills set, and vice-versa.
    this.#cleanups.push(EffectBus.on<{ active: string[]; scope?: Scope }>('tags:filter', (p) => {
      this.#active.set(new Set(Array.isArray(p?.active) ? p.active : []))
      if (p?.scope) this.#scope.set(p.scope)
    }))

    // Staging state (sticky): the drone is the owner, this panel renders it.
    this.#cleanups.push(EffectBus.on<{ tag: string | null; cells: string[]; active: boolean }>(
      'tags:removal-pending', (p) => {
        this.#removalTag.set(p?.active ? (p.tag ?? null) : null)
        this.#removalCells.set(Array.isArray(p?.cells) ? [...p.cells] : [])
      },
    ))
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
   *  controls-bar pills emit, so the cross-page flatten reacts identically.
   *  Always carries `scope`: emitting without it made show-cell fall back to
   *  'local', so filtering from this panel silently reset the reach to
   *  page-only however wide the participant had just set it. */
  toggleFilter(name: string): void {
    const next = new Set(this.#active())
    if (next.has(name)) next.delete(name); else next.add(name)
    this.#active.set(next)
    this.#emitFilter(next)
  }

  isScope(id: Scope): boolean {
    return this.#scope() === id
  }

  /** Pick a reach. Re-broadcasts immediately so a live filter re-scans at the
   *  new width; with nothing filtered it still emits, which is what keeps the
   *  controls-bar glyph in step. */
  setScope(id: Scope): void {
    if (this.#scope() === id) return
    this.#scope.set(id)
    this.#emitFilter(this.#active())
  }

  /** Drop every active filter and return to the unfiltered view. */
  clearFilter(): void {
    if (this.#active().size === 0) return
    this.#active.set(new Set())
    this.#emitFilter(new Set())
  }

  #emitFilter(active: ReadonlySet<string>): void {
    EffectBus.emit('tags:filter', { active: [...active], scope: this.#scope() })
  }

  /** Recolour a tag from the native colour input. Writing through the registry
   *  re-broadcasts `tags:registry`, which repaints the pills + on-tile badges. */
  recolor(name: string, event: Event): void {
    const color = (event.target as HTMLInputElement | null)?.value
    if (!color) return
    void this.#registry()?.add(name, color)
  }

  isStaging(name: string): boolean {
    return this.#removalTag() === name
  }

  /** Arm a removal: filter the hive to this keyword — so every tile carrying it
   *  is on screen at the current reach — and hand the staging to the drone.
   *  Nothing is written; clicking tiles builds the list, Remove commits it. */
  beginRemoval(name: string): void {
    if (this.#removalTag() === name) { this.commitRemoval(); return }
    const only = new Set([name])
    this.#active.set(only)
    this.#emitFilter(only)
    EffectBus.emit('tags:removal-begin', { tag: name })
  }

  /** Stage every tile currently on screen — the "all of them" shortcut for a
   *  keyword that was applied by mistake. */
  stageAllShown(): void {
    EffectBus.emit('tags:removal-select-all', {})
  }

  /** Apply the staged removals. The drone splices each tile's decoration and
   *  re-runs the filter, so the committed tiles drop out of view. */
  commitRemoval(): void {
    if (this.removalCount() === 0) { this.cancelRemoval(); return }
    EffectBus.emit('tags:removal-commit', {})
  }

  cancelRemoval(): void {
    EffectBus.emit('tags:removal-cancel', {})
  }

  /** Forget the keyword itself — drop it from the master registry so it stops
   *  appearing in this list and the controls-bar pills. Tiles keep whatever
   *  decorations they carry; use the staged removal above to take it off them.
   *  Only offered while a removal is armed, so it can't be hit by accident. */
  forgetTag(name: string): void {
    this.cancelRemoval()
    void this.#registry()?.remove(name)
    if (this.#active().has(name)) {
      const next = new Set(this.#active())
      next.delete(name)
      this.#active.set(next)
      this.#emitFilter(next)
    }
  }

  /** Closing the panel disarms any staged removal — the review surface is
   *  gone, so leaving tile clicks hijacked would strand the participant. */
  close(): void {
    if (this.#removalTag()) this.cancelRemoval()
    this.visible.set(false)
    EffectBus.emit('tags:view-state', { open: false })
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Escape steps back one level: out of the armed removal first, out of the
    // panel only once nothing is staged.
    if (this.#removalTag()) { this.cancelRemoval(); return }
    this.close()
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-tags-viewer',
  owner: '@hypercomb.shared/TagsViewerComponent',
  component: TagsViewerComponent,
  order: 130,
})
