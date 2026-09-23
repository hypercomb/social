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
  groupsOf?(page: readonly string[]): Promise<string[][]>
  setTarget?(group: readonly string[], page: readonly string[], on: boolean): Promise<void>
  attach?(page: readonly string[], group: readonly string[]): Promise<boolean>
  link?(page: readonly string[], group: readonly string[]): Promise<{ ok: boolean; reason?: string }>
  resolveRoute?(name: string, here: readonly string[]): Promise<string[] | null>
  feed?(group: readonly string[], names: readonly string[]): Promise<string[][]>
  review?(page: readonly string[]): Promise<OwnReview | null>
  gatherOwn?(page: readonly string[], names: readonly string[]): Promise<string[]>
}
/** Mirrors essentials `OwnReview` (references/gather) — shared never imports a module. */
type OwnTile = { name: string; inGroup: boolean; differs: readonly string[] }
type OwnReview = { group: readonly string[]; tiles: readonly OwnTile[] }
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
  /** Why the typed page could not be added — the words, not just "no". */
  readonly targetReason = signal('')
  #targetGeneration = 0

  /** MANAGE — the right half of the Portals/References pair (`/references`):
   *  the page you stand on, the groups it gathers from, the targets it feeds.
   *  Follows you as you navigate; null while the window composes or is shut. */
  readonly managePage = signal<readonly string[] | null>(null)
  readonly manageFrom = signal<readonly (readonly string[])[]>([])
  /** Tiles selected on the managed page — what "Add to targets" sends. */
  readonly manageSelected = signal<readonly string[]>([])
  readonly feedingOn = computed(() => this.targets().filter(t => t.on))
  readonly feedingNames = computed(() => this.feedingOn().map(t => t.label).join(', '))
  /** REVIEW — the page's own tiles read against its group, and which are
   *  ticked to gather. Ticked from the start only where nothing is lost. */
  readonly review = signal<OwnReview | null>(null)
  readonly ticked = signal<ReadonlySet<string>>(new Set())
  readonly gathering = signal(false)
  readonly reviewGroupName = computed(() => { const g = this.review()?.group; return g ? String(g[g.length - 1] ?? '') : '' })
  readonly managePageName = computed(() => { const p = this.managePage(); return p ? String(p[p.length - 1] ?? '') : '' })
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
      if (!c) { if (this.managePage()) this.manageSelected.set([...selected]); return }
      this.selected.set(selected.map(label => ({ label, segments: [...c.portal.segments, label] })))
    }))
    this.#cleanups.push(EffectBus.on('references:manage', () => this.#openManage()))
    // The pair follows you: a new page means new links, new targets.
    this.#cleanups.push(EffectBus.on<{ page?: readonly string[]; from?: readonly (readonly string[])[] }>(
      'gather:page-links', (p) => {
        const current = this.managePage()
        if (!current || !p?.page || this.composition()) return
        const moved = current.join('/') !== p.page.join('/')
        this.manageFrom.set(p.from ?? [])
        void this.#loadReview()
        if (!moved) return
        this.managePage.set([...p.page])
        this.manageSelected.set([])
        EffectBus.emit('references:managing', { page: [...p.page] })
        void this.#loadTargets()
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
      void this.#loadTargets()
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
    void this.#loadTargets()
    this.beginSelection()
  }

  /** Switch one target: ON means what is saved here is also gathered there. */
  /** The group whose targets are shown: the portal being composed from, or —
   *  managing — the page itself (a group feeds the pages switched on here). */
  #group(): readonly string[] | null {
    return this.composition()?.portal.segments ?? this.managePage()
  }

  async toggleTarget(target: TargetChip): Promise<void> {
    const group = this.#group()
    if (!group) return
    await gatherLink()?.setTarget?.(group, target.segments, !target.on)
    this.targets.update(list => list.map(t => t.key === target.key ? { ...t, on: !t.on } : t))
  }

  /** A typed page becomes a target of the group in hand — attached (it now
   *  gathers from the group) and switched on. */
  async addTarget(raw: string): Promise<void> {
    const group = this.#group()
    const link = gatherLink()
    const name = raw.trim()
    if (!group || !name || !link?.resolveRoute || !link.attach) return
    const here = (ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined)?.segmentsRaw?.() ?? []
    const page = await link.resolveRoute(name, here)
    const outcome = page
      ? (link.link ? await link.link(page, group) : { ok: await link.attach(page, group) })
      : { ok: false }
    if (!page || !outcome.ok) {
      this.targetReason.set(('reason' in outcome && outcome.reason) ? String(outcome.reason) : '')
      this.targetMiss.set(true)
      return
    }
    await link.setTarget?.(group, page, true)
    this.targetQuery.set('')
    this.targetMiss.set(false)
    this.targetReason.set('')
    await this.#loadTargets()
  }

  /** Stop the managed page gathering from `group` — said in a toast. */
  async unlinkGroup(group: readonly string[]): Promise<void> {
    const page = this.managePage()
    const link = gatherLink() as (GatherLinkLike & { detach?(p: readonly string[], g: readonly string[]): Promise<boolean> }) | undefined
    if (!page || !link?.detach) return
    await link.detach(page, group)
    EffectBus.emit('toast:show', {
      type: 'success',
      message: `"${page[page.length - 1]}" no longer gathers from ${group[group.length - 1]}`,
    })
  }

  /** Send the tiles selected here to every target that is on — the subset you
   *  chose, never every page by itself. */
  async feedSelected(): Promise<void> {
    const page = this.managePage()
    const names = this.manageSelected()
    if (!page || names.length === 0) return
    const fed = await gatherLink()?.feed?.(page, names).catch(() => [] as string[][]) ?? []
    EffectBus.emit('toast:show', fed.length
      ? { type: 'success', message: `${names.join(', ')} → ${fed.map(p => p[p.length - 1]).join(', ')}` }
      : { type: 'info', message: 'Nothing new to add — the targets already have them' })
    withSelectionService(s => s.clear())
  }

  #openManage(): void {
    if (this.composition()) return
    const here = [...((ioc()?.get('@hypercomb.social/Lineage') as { explorerSegments?(): readonly string[] } | undefined)?.explorerSegments?.() ?? [])]
    if (here.length === 0) {
      EffectBus.emit('toast:show', { type: 'info', message: 'Stand on a page first — the hive itself gathers from nothing' })
      return
    }
    this.managePage.set(here)
    this.manageSelected.set([])
    this.targetQuery.set(''); this.targetMiss.set(false); this.targetReason.set('')
    this.visible.set(true)
    // The pair opens together: Portals on the left is where a group is picked.
    // `managing` FIRST — it is what makes Portals a companion, and the
    // one-window rule reads that the moment either window registers.
    EffectBus.emit('references:managing', { page: here })
    EffectBus.emit('aggregate:view-open', { id: 'collections' })
    void gatherLink()?.groupsOf?.(here).then(from => { if (this.managePage() === here) this.manageFrom.set(from ?? []) })
    void this.#loadTargets()
    void this.#loadReview()
  }

  #reviewGeneration = 0
  async #loadReview(): Promise<void> {
    const generation = ++this.#reviewGeneration
    const page = this.managePage()
    const review = page ? await gatherLink()?.review?.(page).catch(() => null) ?? null : null
    if (generation !== this.#reviewGeneration) return
    this.review.set(review)
    this.ticked.set(new Set((review?.tiles ?? []).filter(t => t.inGroup && t.differs.length === 0).map(t => t.name)))
  }

  toggleOwn(name: string): void {
    this.ticked.update(set => {
      const next = new Set(set)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  /** Gather what is ticked: the group's tile takes each one's place as a
   *  reference; one the group lacks moves there first. Said in a toast. */
  async gatherOwn(): Promise<void> {
    const page = this.managePage()
    const names = [...this.ticked()]
    if (!page || names.length === 0 || this.gathering()) return
    this.gathering.set(true)
    try {
      const done = await gatherLink()?.gatherOwn?.(page, names).catch(() => [] as string[]) ?? []
      const group = this.reviewGroupName()
      EffectBus.emit('toast:show', done.length
        ? { type: 'success', message: `${done.join(', ')} → ${group} — "${page[page.length - 1]}" now shows ${done.length === 1 ? 'it' : 'them'} as references` }
        : { type: 'warning', message: 'Nothing was gathered — try again in a moment' })
    } finally {
      this.gathering.set(false)
      await this.#loadReview()
    }
  }

  async #loadTargets(): Promise<void> {
    const generation = ++this.#targetGeneration
    const group = this.#group()
    if (!group) { this.targets.set([]); return }
    const found = await gatherLink()?.targetsOf?.(group).catch(() => []) ?? []
    if (generation !== this.#targetGeneration) return
    // The page being composed is where things land anyway — not a target of itself.
    const holder = this.composition()?.parentSegments.join('/') ?? ''
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
    if (this.managePage()) {
      // The pair closes together, as it opened.
      this.managePage.set(null); this.manageFrom.set([]); this.manageSelected.set([])
      this.#reviewGeneration++; this.review.set(null); this.ticked.set(new Set())
      EffectBus.emit('references:managing', { page: null })
      EffectBus.emit('aggregate:view-close', {})
    }
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
