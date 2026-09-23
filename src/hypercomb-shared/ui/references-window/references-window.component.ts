import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { onSelection, withSelectionService } from '../../core/selection-context'
import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { dropReferenceTile, safeCellName } from '../aggregate-index/aggregate-drop'
import type { AggregateItem, StagedEntry } from '../aggregate-index/aggregate-source'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import { gatheredFrom } from './gathered-from'

type Composition = {
  portal: AggregateItem
  parentSegments: readonly string[]
  originSegments: readonly string[]
  createTile: boolean
  targetIndex?: number
  targetQ?: number
  targetR?: number
  existingLabels?: readonly string[]
}
type NavigationLike = { goRaw?(segments: readonly string[]): void; segmentsRaw?(): readonly string[] }
type SelectModeLike = { arm?(): void; disarm?(): void }
type LayerCommitterLike = {
  importTree?(updates: Array<{
    segments: readonly string[]
    layer: { name?: string; properties?: readonly string[] }
  }>): Promise<void>
}
type StoreLike = { putResource?(blob: Blob): Promise<string> }
/** The page ↔ group link door (essentials references/gather/gather-link.service.ts). */
type GatherLinkLike = {
  targetsOf?(group: readonly string[]): Promise<Array<{ segments: readonly string[]; on: boolean }>>
  setTarget?(group: readonly string[], page: readonly string[], on: boolean): Promise<void>
  attach?(page: readonly string[], group: readonly string[]): Promise<boolean>
  resolveRoute?(name: string, here: readonly string[]): Promise<string[] | null>
  feed?(group: readonly string[], names: readonly string[]): Promise<string[][]>
}
type TargetChip = { key: string; label: string; segments: readonly string[]; on: boolean }
const ioc = (): { get(k: string): unknown } | undefined => (globalThis as { ioc?: { get(k: string): unknown } }).ioc
const gatherLink = (): GatherLinkLike | undefined =>
  ioc()?.get('@diamondcoreprocessor.com/GatherLinkService') as GatherLinkLike | undefined

@Component({ selector: 'hc-references-window', standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './references-window.component.html', styleUrls: ['./references-window.component.scss'] })
export class ReferencesWindowComponent implements OnDestroy {
  readonly visible = signal(false)
  readonly composition = signal<Composition | null>(null)
  readonly name = signal('')
  readonly selected = signal<readonly StagedEntry[]>([])
  readonly choosing = signal(false)
  readonly saving = signal(false)
  /** Where the holder's existing references came from — derived (see
   *  `gatheredFrom`), shown as the way back to choose more. Null while there is
   *  nothing gathered yet or the holder is being minted. */
  readonly group = signal<{ label: string; segments: readonly string[] } | null>(null)
  /** The pages the group in hand feeds — ON ones also gather what is saved.
   *  Empty until a page is attached: no list until there is something in it. */
  readonly targets = signal<readonly TargetChip[]>([])
  readonly targetQuery = signal('')
  readonly targetMiss = signal(false)
  #targetGeneration = 0
  readonly targetName = computed(() => safeCellName(this.name()))
  readonly nameTaken = computed(() => {
    const target = this.targetName()
    return !!target && (this.composition()?.existingLabels ?? []).includes(target)
  })
  readonly session = signalSession(this.visible, undefined, { close: () => this.cancel() })
  readonly #cleanups: Array<() => void> = []
  #selectionArrivalCleanup: (() => void) | null = null
  #branchArrivalCleanup: (() => void) | null = null

  constructor() {
    this.#cleanups.push(onSelection(({ selected }) => {
      const c = this.composition()
      if (!c) return
      this.selected.set(selected.map(label => ({ label, segments: [...c.portal.segments, label] })))
    }))
    this.#cleanups.push(EffectBus.on<Composition>('references:compose', c => {
      if (!c?.portal) return
      this.composition.set(c)
      // Over a tile the holder already has a name — its address — so it is
      // shown, never offered for change (reference-designer.md, section 2).
      this.name.set(c.createTile
        ? this.#availableName(c.portal.label, c.existingLabels ?? [])
        : String(c.parentSegments[c.parentSegments.length - 1] ?? ''))
      this.selected.set([])
      this.choosing.set(false)
      this.group.set(null)
      this.visible.set(true)
      this.#emitDraft()
      void this.#loadTargets(c)
      if (!c.createTile) {
        const holder = [...c.parentSegments]
        void gatheredFrom(holder).then(segments => {
          // Still the same composition, and the group is not the portal in hand
          // — that one is already the picker's source.
          const current = this.composition()
          if (!segments || current !== c) return
          const samePortal = segments.length === c.portal.segments.length
            && segments.every((s, i) => String(s) === String(c.portal.segments[i]))
          if (samePortal) return
          this.group.set({ label: String(segments[segments.length - 1] ?? ''), segments })
        })
      }
    }))
    this.#cleanups.push(EffectBus.on('references:view-close', () => this.cancel()))
  }
  ngOnDestroy(): void {
    this.#selectionArrivalCleanup?.()
    this.#branchArrivalCleanup?.()
    for (const c of this.#cleanups) c()
  }

  remove(entry: StagedEntry): void {
    this.selected.update(items => items.filter(item => item.label !== entry.label))
    EffectBus.emit('selection:toggle', { label: entry.label })
  }

  updateName(value: string): void {
    this.name.set(value)
    this.#emitDraft()
  }

  /** The way back: pick more from the group the holder already gathers from.
   *  The group becomes the picker's source; the chosen items land under the
   *  same holder. */
  chooseFromGroup(): void {
    const c = this.composition()
    const group = this.group()
    if (!c || !group) return
    this.composition.set({
      ...c,
      portal: { key: group.label, label: group.label, segments: [...group.segments] },
    })
    this.group.set(null)
    this.selected.set([])
    withSelectionService(s => s.clear())
    void this.#loadTargets(this.composition()!)
    this.beginSelection()
  }

  /** Switch one target: ON means what is saved here is also gathered there. */
  async toggleTarget(target: TargetChip): Promise<void> {
    const c = this.composition()
    if (!c) return
    await gatherLink()?.setTarget?.(c.portal.segments, target.segments, !target.on)
    this.targets.update(list => list.map(t => t.key === target.key ? { ...t, on: !t.on } : t))
  }

  /** A typed page becomes a target of the group in hand — attached (it now
   *  gathers from the group) and switched on. */
  async addTarget(raw: string): Promise<void> {
    const c = this.composition()
    const link = gatherLink()
    const name = raw.trim()
    if (!c || !name || !link?.resolveRoute || !link.attach) return
    const here = (ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined)?.segmentsRaw?.() ?? []
    const page = await link.resolveRoute(name, here)
    if (!page || !await link.attach(page, c.portal.segments)) { this.targetMiss.set(true); return }
    await link.setTarget?.(c.portal.segments, page, true)
    this.targetQuery.set('')
    this.targetMiss.set(false)
    await this.#loadTargets(c)
  }

  async #loadTargets(c: Composition): Promise<void> {
    const generation = ++this.#targetGeneration
    const found = await gatherLink()?.targetsOf?.(c.portal.segments).catch(() => []) ?? []
    if (generation !== this.#targetGeneration) return
    // The page being composed is where things land anyway — not a target of itself.
    const holder = c.parentSegments.join('/')
    this.targets.set(found
      .filter(t => t.segments.join('/') !== holder)
      .map(t => ({ key: t.segments.join('/'), label: String(t.segments[t.segments.length - 1] ?? ''), segments: [...t.segments], on: t.on })))
  }

  beginSelection(): void {
    const c = this.composition()
    if (!c) return
    this.choosing.set(true)
    this.#selectionArrivalCleanup?.()
    const navigation = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    const current = navigation?.segmentsRaw?.() ?? []
    const alreadyThere = current.length === c.portal.segments.length
      && current.every((segment, index) => String(segment) === String(c.portal.segments[index]))
    if (alreadyThere) {
      ;(ioc()?.get('@diamondcoreprocessor.com/SelectModeDrone') as SelectModeLike | undefined)?.arm?.()
      return
    }

    // Show-cell starts its navigation guard after the view verdict and
    // SelectMode deliberately disarms at that start. Own the whole guard
    // cycle caused by this goRaw call, then arm after its matching end.
    let listening = false
    let started = false
    let stopStart = (): void => undefined
    let stopEnd = (): void => undefined
    const cleanup = (): void => { stopStart(); stopEnd() }
    stopStart = EffectBus.on('navigation:guard-start', () => {
      // EffectBus replays the most recent payload during registration. Ignore
      // that completed, stale cycle and only accept the one caused by goRaw
      // below, after both cleanup handles exist.
      if (listening) started = true
    })
    stopEnd = EffectBus.on('navigation:guard-end', () => {
      if (!listening || !started) return
      cleanup(); this.#selectionArrivalCleanup = null
      ;(ioc()?.get('@diamondcoreprocessor.com/SelectModeDrone') as SelectModeLike | undefined)?.arm?.()
    })
    listening = true
    this.#selectionArrivalCleanup = cleanup
    navigation?.goRaw?.(c.portal.segments)
  }

  async save(): Promise<void> {
    const c = this.composition()
    const chosen = this.selected()
    if (!c || chosen.length === 0 || this.saving()) return
    const name = this.targetName()
    if (c.createTile && (!name || this.nameTaken())) return
    this.saving.set(true)
    let parent = [...c.parentSegments]
    try {
      const index = this.#targetIndex(c)
      if (c.createTile) {
        parent = [...parent, name]
        const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as LayerCommitterLike | undefined
        const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
        if (!committer?.importTree || !store?.putResource) throw new Error('Reference writer unavailable')

        // The temporary tile and the committed tile share one face and one
        // slot. Put both properties into the target's first layer commit so
        // there is no blank/snap frame and no current-location place-at race
        // while the item picker is showing the Portal source layer.
        const properties: Record<string, unknown> = {}
        if (typeof c.portal.imageSig === 'string' && c.portal.imageSig) properties['imageSig'] = c.portal.imageSig
        if (index >= 0) properties['index'] = index
        const propertiesSig = await store.putResource(new Blob(
          [JSON.stringify(Object.fromEntries(Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))))],
          { type: 'application/json' },
        ))
        await committer.importTree([{
          segments: parent,
          layer: { name, properties: [propertiesSig] },
        }])
      }
      for (const entry of chosen) await dropReferenceTile({ key: entry.label, label: entry.label, segments: entry.segments }, parent)
      // …and into every target of the group that is switched on.
      await gatherLink()?.feed?.(c.portal.segments, chosen.map(entry => entry.label)).catch(() => [])
      await new hypercomb().act()
      this.finish(parent)
    } catch { /* keep the complete composition available for retry */ }
    finally { this.saving.set(false) }
  }

  cancel(): void { this.finish() }
  private finish(savedBranchSegments?: readonly string[]): void {
    const back = this.composition()?.originSegments
    this.#selectionArrivalCleanup?.(); this.#selectionArrivalCleanup = null
    this.#branchArrivalCleanup?.(); this.#branchArrivalCleanup = null
    this.visible.set(false); this.composition.set(null); this.name.set(''); this.selected.set([]); this.choosing.set(false)
    this.#targetGeneration++; this.targets.set([]); this.targetQuery.set(''); this.targetMiss.set(false)
    withSelectionService(s => s.clear())
    EffectBus.emit('reference:draft-preview', null)
    ;(ioc()?.get('@diamondcoreprocessor.com/SelectModeDrone') as SelectModeLike | undefined)?.disarm?.()
    if (!back) return
    const navigation = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    if (savedBranchSegments) {
      // The target gained its first child while the picker was showing another
      // layer. Navigation guard-end can precede the destination's tile-map
      // rebuild, so it is too early to flip that target: the slot is not there
      // yet and the first click falls through to the editor. Wait for the
      // parent render that actually contains the target, then announce the
      // branch proof synchronously while that fresh map is being published.
      let listening = false
      let stop = (): void => undefined
      const target = String(savedBranchSegments[savedBranchSegments.length - 1] ?? '')
      stop = EffectBus.on<{ labels?: readonly string[] }>('render:cell-count', payload => {
        if (!listening || !target || !(payload?.labels ?? []).includes(target)) return
        const current = navigation?.segmentsRaw?.() ?? []
        if (current.length !== back.length
          || current.some((segment, index) => String(segment) !== String(back[index]))) return
        stop(); this.#branchArrivalCleanup = null
        EffectBus.emit('reference:branch-ready', { segments: [...savedBranchSegments] })
      })
      listening = true
      this.#branchArrivalCleanup = stop
    }
    navigation?.goRaw?.(back)
  }

  #targetIndex(c: Composition): number {
    let index = c.targetIndex ?? -1
    if (index >= 0) return index
    if (c.targetQ === undefined || c.targetR === undefined) return -1
    const items = (ioc()?.get('@diamondcoreprocessor.com/AxialService') as
      { items?: Map<number, { q: number; r: number }> } | undefined)?.items
    for (const [candidate, axial] of items ?? []) {
      if (axial.q === c.targetQ && axial.r === c.targetR) return candidate
    }
    return -1
  }

  #emitDraft(): void {
    const c = this.composition()
    if (!c?.createTile) return
    const name = this.targetName() || safeCellName(c.portal.label)
    const index = this.#targetIndex(c)
    EffectBus.emit('reference:draft-preview', name && index >= 0 ? {
      name,
      imageSig: c.portal.imageSig,
      index,
      parentSegments: [...c.parentSegments],
    } : null)
  }

  #availableName(raw: string, existing: readonly string[]): string {
    const base = safeCellName(raw)
    if (!base || !existing.includes(base)) return base
    const stem = safeCellName(`${base}-reference`)
    if (!existing.includes(stem)) return stem
    for (let n = 2; n < 10_000; n++) {
      const candidate = safeCellName(`${stem}-${n}`)
      if (!existing.includes(candidate)) return candidate
    }
    return ''
  }
}

registerShellSurface({ name: 'hc-references-window', owner: '@hypercomb.shared/ReferencesWindowComponent', component: ReferencesWindowComponent, order: 111 })
