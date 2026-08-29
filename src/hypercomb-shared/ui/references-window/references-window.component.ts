import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { onSelection, withSelectionService } from '../../core/selection-context'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { dropReferenceTile, safeCellName } from '../aggregate-index/aggregate-drop'
import type { AggregateItem, StagedEntry } from '../aggregate-index/aggregate-source'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

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
const ioc = (): { get(k: string): unknown } | undefined => (globalThis as { ioc?: { get(k: string): unknown } }).ioc

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
      this.name.set(c.createTile ? this.#availableName(c.portal.label, c.existingLabels ?? []) : '')
      this.selected.set([])
      this.choosing.set(false)
      this.visible.set(true)
      this.#emitDraft()
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
