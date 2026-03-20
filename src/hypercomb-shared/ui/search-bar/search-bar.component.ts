// hypercomb-shared/ui/search-bar/search-bar.component.ts

import { AfterViewInit, Component, computed, ElementRef, signal, ViewChild, type OnDestroy } from '@angular/core'
import type { Lineage } from '../../core/lineage'
import type { MovementService } from '../../core/movement.service'
import type { Navigation } from '../../core/navigation'
import type { ScriptPreloader } from '../../core/script-preloader'
import type { SeedSuggestionProvider } from '../../core/seed-suggestion.provider'
import type { CompletionUtility, CompletionContext } from '@hypercomb/shared/core/completion-utility'
import { fromRuntime } from '../../core/from-runtime'
import { EffectBus } from '@hypercomb/core'
import type { SearchBarBehavior, SearchBarBehaviorMeta, SearchBarOperation } from './search-bar-behavior'
import { ShiftEnterNavigateBehavior } from './shift-enter-navigate.behavior'
import { BatchCreateBehavior } from './batch-create.behavior'
import { DeleteCellBehavior } from './delete-cell.behavior'

@Component({
  selector: 'hc-search-bar',
  standalone: true, 
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent implements AfterViewInit, OnDestroy {

  @ViewChild('input', { read: ElementRef })
  private inputRef?: ElementRef<HTMLInputElement>

  private get input(): ElementRef<HTMLInputElement> {
    if (!this.inputRef) {
      throw new Error('SearchBarComponent input is not available before view init')
    }
    return this.inputRef
  }

  // Resolve via IoC container (not Angular DI) — these are shared services
  // registered at module load time, available globally via get()
  private get completions(): CompletionUtility { return get('@hypercomb.social/CompletionUtility') as CompletionUtility }
  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  private get movement(): MovementService { return get('@hypercomb.social/MovementService') as MovementService }
  private get navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }
  private get preloader(): ScriptPreloader { return get('@hypercomb.social/ScriptPreloader') as ScriptPreloader }
  private get seedProvider(): SeedSuggestionProvider { return get('@hypercomb.social/SeedSuggestionProvider') as SeedSuggestionProvider }

  private readonly value = signal('')
  private readonly activeIndex = signal(0)
  private readonly suppressed = signal(false)
  private readonly seedSubPath = signal<readonly string[]>([])
  private readonly seedLeaf = signal('')

  // Bridge EventTarget-based services to Angular Signals for reactivity
  private readonly resourceCount$ = fromRuntime(
    get('@hypercomb.social/ScriptPreloader') as EventTarget,
    () => this.preloader.resourceCount
  )
  private readonly actionNames$ = fromRuntime(
    get('@hypercomb.social/ScriptPreloader') as EventTarget,
    () => this.preloader.actionNames
  )
  private readonly seedNames$ = fromRuntime(
    get('@hypercomb.social/SeedSuggestionProvider') as EventTarget,
    () => this.seedProvider.suggestions()
  )

  // pluggable behaviors — validated at construction, no overlapping operations
  #behaviors: SearchBarBehavior[] = this.#validateBehaviors([
    new DeleteCellBehavior(),
    new BatchCreateBehavior(),
    new ShiftEnterNavigateBehavior()
  ])

  // built-in behaviors that are hardcoded in onKeyDown (not pluggable yet)
  static readonly builtinBehaviors: readonly SearchBarBehaviorMeta[] = [
    {
      name: 'create',
      operations: [
        {
          trigger: 'Enter',
          pattern: /^[^!\[#/][^/]*$/,
          description: 'Create a new cell (seed) at the current level',
          examples: [
            { input: 'hello', key: 'Enter', result: 'Creates cell "hello" at current level' }
          ]
        },
        {
          trigger: 'Enter',
          pattern: /^[^!\[#].+\/.+[^/]$/,
          description: 'Create nested folders, stay at current level with parent path retained',
          examples: [
            { input: 'a/b/c', key: 'Enter', result: 'Creates a/b/c, retains "a/b/" in the bar' }
          ]
        },
        {
          trigger: 'Enter',
          pattern: /^[^!\[#].+\/$/,
          description: 'Go to a folder, creating it if it doesn\'t exist',
          examples: [
            { input: 'abc/', key: 'Enter', result: 'Creates "abc" if needed, then navigates into it' },
            { input: 'a/b/', key: 'Enter', result: 'Creates a/b if needed, then navigates into a/b' }
          ]
        }
      ]
    },
    {
      name: 'filter',
      operations: [
        {
          trigger: 'type',
          pattern: /^>\?.*/,
          description: 'Live-filter visible tiles by keyword',
          examples: [
            { input: '>?cigar', key: 'type', result: 'Filters tiles to those matching "cigar"' }
          ]
        }
      ]
    },
    {
      name: 'open-dcp',
      operations: [
        {
          trigger: 'Enter',
          pattern: /^#$/,
          description: 'Open the Diamond Core Processor',
          examples: [
            { input: '#', key: 'Enter', result: 'Opens the DCP panel' }
          ]
        }
      ]
    }
  ]

  /** All behavior metadata — pluggable + built-in */
  public get behaviorReference(): readonly SearchBarBehaviorMeta[] {
    return [
      ...this.#behaviors,
      ...SearchBarComponent.builtinBehaviors
    ]
  }

  /** All operations across all behaviors, flat */
  public get allOperations(): readonly SearchBarOperation[] {
    return this.behaviorReference.flatMap(b => b.operations)
  }

  /**
   * Validate that no two behaviors claim overlapping trigger+pattern space.
   * Uses each operation's examples as probes — if two behaviors both match
   * the same example input under the same trigger, that's a conflict.
   */
  #validateBehaviors(behaviors: SearchBarBehavior[]): SearchBarBehavior[] {
    const claimed = new Map<string, { behavior: string; pattern: RegExp }>()

    for (const b of behaviors) {
      for (const op of b.operations) {
        for (const ex of op.examples) {
          const key = `${op.trigger}::${ex.input}`
          const existing = claimed.get(key)
          if (existing) {
            console.warn(
              `[search-bar] overlap: "${b.name}" and "${existing.behavior}" both claim ` +
              `trigger="${op.trigger}" for input "${ex.input}". ` +
              `"${existing.behavior}" wins (registered first).`
            )
          } else {
            claimed.set(key, { behavior: b.name, pattern: op.pattern })
          }
        }
      }
    }

    return behaviors
  }

  // open dcp only once per page load
  private dcpOpened = false

  // -------------------------------------------------
  // readiness / locking
  // -------------------------------------------------

  private readonly hasAnyResources = computed<boolean>(() => this.resourceCount$() > 0)
  private readonly locked = computed<boolean>(() => !this.hasAnyResources())

  // -------------------------------------------------
  // placeholder
  // -------------------------------------------------

  public readonly placeholder = computed<string>(() => {
    if (this.locked()) return 'enter cell name...'
    const ctx = this.context()
    if (ctx.active && ctx.mode === 'filter') return 'filter tiles...'
    return 'search actions...'
  })

  public constructor() {
    console.log('[search-bar] initialized with url segments:', this.navigation.segments())
  }

  // -------------------------------------------------
  // completion context
  // -------------------------------------------------

  private readonly context = computed<CompletionContext>(() => {
    const v = this.value()

    // >? prefix enters filter mode
    if (v.startsWith('>?')) {
      const raw = v.slice(2)
      const keyword = this.completions.normalize(raw)
      return {
        active: true,
        mode: 'filter',
        head: '>?',
        raw,
        normalized: keyword,
        style: 'space'
      }
    }

    const lastHash = v.lastIndexOf('#')

    if (lastHash !== -1) {
      const after = v.slice(lastHash + 1)
      const leadingWs = after.match(/^\s*/)?.[0] ?? ''
      const raw = after.slice(leadingWs.length)

      return {
        active: true,
        mode: 'marker',
        head: v.slice(0, lastHash + 1) + leadingWs,
        raw,
        normalized: this.completions.normalize(raw),
        style: raw.includes('.') ? 'dot' : 'space'
      }
    }

    if (!v.trim()) return { active: false }

    return {
      active: true,
      mode: 'action',
      head: '',
      raw: v,
      normalized: this.completions.normalize(v),
      style: v.includes('.') ? 'dot' : 'space'
    }
  })

  // -------------------------------------------------
  // suggestions
  // -------------------------------------------------

  public readonly suggestions = computed<readonly string[]>(() => {
    if (this.suppressed()) return []

    const ctx = this.context()
    if (!ctx.active) return []
    if (ctx.mode === 'filter') return []

    const subPath = this.seedSubPath()
    const leaf = this.seedLeaf()
    const seeds = this.seedNames$()
    const actions = this.actionNames$()

    // when in a sub-path (e.g. "abc/"), show only seeds at that level
    if (subPath.length > 0) {
      if (!leaf) return seeds
      return seeds.filter(n => n.startsWith(leaf))
    }

    // at root level: merge seeds + actions, deduplicated
    const seen = new Set<string>()
    const merged: string[] = []
    for (const name of seeds) {
      if (seen.has(name)) continue
      seen.add(name)
      merged.push(name)
    }
    for (const name of actions) {
      if (seen.has(name)) continue
      seen.add(name)
      merged.push(name)
    }

    if (!ctx.normalized) return merged

    return merged.filter(n => n.startsWith(ctx.normalized))
  })

  public readonly showCompletions = computed<boolean>(() => {
    return this.suggestions().length > 0
  })

  // -------------------------------------------------
  // ghost mirror (second input layer)
  // -------------------------------------------------

  public readonly ghostValue = computed<string>(() => {
    if (!this.showCompletions()) return ''

    const ctx = this.context()
    if (!ctx.active) return ''

    const list = this.suggestions()
    const best = list[this.activeIndex()] ?? list[0]
    if (!best) return ''

    const subPath = this.seedSubPath()
    const leaf = this.seedLeaf()
    const current = this.value()

    // sub-path mode: suggestion is a child name, leaf is the typed fragment
    if (subPath.length > 0) {
      if (!best.startsWith(leaf)) return ''
      const suffix = best.slice(leaf.length)
      if (!suffix) return ''
      return current + suffix
    }

    if (!best.startsWith(ctx.normalized)) return ''

    const rendered = this.completions.render(best, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)

    let suffix = rendered.slice(prefix.length)
    if (!suffix) return ''

    const last = current.slice(-1)

    if ((last === '.' || /\s/.test(last)) && (suffix.startsWith('.') || suffix.startsWith(' '))) {
      suffix = suffix.slice(1)
    }

    return current + suffix
  })

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public ngAfterViewInit(): void {
    this.input.nativeElement.focus()
    this.syncSignalsFromDom()

    this.#prefillUnsub = EffectBus.on<{ value: string }>('search:prefill', ({ value }) => {
      this.input.nativeElement.value = value
      this.input.nativeElement.focus()
      this.placeCaretAtEnd()
      this.suppressed.set(false)
      this.syncSignalsFromDom()
    })
  }

  #prefillUnsub?: () => void

  public ngOnDestroy(): void {
    this.#prefillUnsub?.()
  }

  // -------------------------------------------------
  // template helpers (required)
  // -------------------------------------------------

  public getActiveIndex = (): number => this.activeIndex()

  public typedPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return ''

    // sub-path mode: highlight the leaf prefix within the child name
    const subPath = this.seedSubPath()
    if (subPath.length > 0) {
      const leaf = this.seedLeaf()
      return s.slice(0, Math.min(leaf.length, s.length))
    }

    const rendered = this.completions.render(s, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)
    return rendered.slice(0, Math.min(prefix.length, rendered.length))
  }

  public restPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return s

    // sub-path mode: rest is everything after the leaf prefix
    const subPath = this.seedSubPath()
    if (subPath.length > 0) {
      const leaf = this.seedLeaf()
      return s.slice(Math.min(leaf.length, s.length))
    }

    const rendered = this.completions.render(s, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)
    return rendered.slice(Math.min(prefix.length, rendered.length))
  }

  public onShellMouseDown = (e: MouseEvent): void => {
    if (e.target === this.input.nativeElement) return
    e.preventDefault()
    this.input.nativeElement.focus()
  }

  public onSuggestionMouseDown = (e: MouseEvent, s: string, i: number): void => {
    e.preventDefault()
    this.activeIndex.set(i)
    this.acceptCompletion(s)
  }

  // -------------------------------------------------
  // input handling
  // -------------------------------------------------

  public onInput = (): void => {
    this.suppressed.set(false)
    this.syncSignalsFromDom()
    this.clampActiveIndex()

    const ctx = this.context()
    if (ctx.active && ctx.mode === 'filter') {
      EffectBus.emit('search:filter', { keyword: ctx.normalized })
    } else if (this.lastFilterKeyword) {
      EffectBus.emit('search:filter', { keyword: '' })
      this.lastFilterKeyword = ''
    }
    if (ctx.active && ctx.mode === 'filter') {
      this.lastFilterKeyword = ctx.normalized
    }

    // update seed sub-path query when input contains '/'
    this.updateSeedSubPath()
  }

  private lastFilterKeyword = ''

  public onKeyDown = (e: KeyboardEvent): void => {
    const el = this.input.nativeElement
    const v = el.value

    // explicit '#' + enter always opens dcp
    if (e.key === 'Enter' && v.trim() === '#') {
      e.preventDefault()
      this.tryOpenDcp()
      this.clear()
      return
    }

    // single-press hotkey: only when locked, only on first '#', and only when starting from empty input
    if (e.key === '#' && !this.dcpOpened && this.locked() && !v.trim()) {
      e.preventDefault()
      this.tryOpenDcp()
      return
    }

    if (this.handleCompletionKeys(e)) return

    // check pluggable behaviors before default handling
    const raw = v.trim()
    for (const behavior of this.#behaviors) {
      if (behavior.match(e, raw)) {
        e.preventDefault()
        void Promise.resolve(behavior.execute(raw)).then(() => this.clear())
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void this.commitCreateSeedInPlace()
      return
    }
  }

  // -------------------------------------------------
  // create seed in place
  // -------------------------------------------------

  private readonly commitCreateSeedInPlace = async (): Promise<void> => {
    const rawInput = this.input.nativeElement.value.trim()
    if (!rawInput) return

    if (rawInput.includes('#')) {
      await this.commitLegacy()
      return
    }

    const navigateAfterCreate = rawInput.startsWith('/') || rawInput.endsWith('/')
    const raw = rawInput.replace(/^\/+|\/+$/g, '').trim()

    // support nested seed creation: "hello/world" → create hello, then hello/world
    const parts = raw.split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean)
    if (parts.length === 0) {
      this.clear()
      return
    }

    // create the seed directory in OPFS so listSeedFolders() can find it
    const dir = await this.lineage.explorerDir()
    if (dir) {
      let parent = dir
      for (const part of parts) {
        parent = await parent.getDirectoryHandle(part, { create: true })
      }
    }

    // emit seed:added — HistoryRecorder will record the op
    EffectBus.emit('seed:added', { seed: parts[0] })
    this.requestSynchronize()

    if (navigateAfterCreate) {
      const baseSegments = this.navigation.segmentsRaw()
      const target = [...baseSegments, ...parts]
      this.navigation.goRaw(target)
      this.clear()
    } else if (parts.length > 1) {
      // retain parent path so user can keep adding children
      // e.g. "interests/cigars" → leaves "interests/" in the bar
      const prefix = parts.slice(0, -1).map(p => this.completions.render(p, 'space')).join('/')
      this.input.nativeElement.value = prefix + '/'
      this.placeCaretAtEnd()
      this.suppressed.set(true)
      this.syncSignalsFromDom()
    } else {
      this.clear()
    }
  }

  private readonly commitLegacy = async (): Promise<void> => {
    const raw = this.input.nativeElement.value.trim()
    if (!raw) return

    if (this.locked()) {
      this.clear()
      return
    }

    const parsed = this.parseInput(raw)

    if (parsed.seedName) {
      await this.ensureSeedInCurrentDirectory(parsed.seedName)
    }

    this.clear()
  }

  // -------------------------------------------------
  // completion logic
  // -------------------------------------------------

  private readonly handleCompletionKeys = (e: KeyboardEvent): boolean => {
    const list = this.suggestions()
    if (!list.length) return false

    if (e.key === 'Escape') {
      e.preventDefault()
      this.suppressed.set(true)
      return true
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.activeIndex.update((v: number) => Math.min(v + 1, list.length - 1))
      return true
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.activeIndex.update((v: number) => Math.max(v - 1, 0))
      return true
    }

    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault()
      this.acceptCompletion()
      return true
    }

    return false
  }

  private readonly acceptCompletion = (forced?: string): void => {
    const ctx = this.context()
    if (!ctx.active) return

    const list = this.suggestions()
    const best = forced ?? list[this.activeIndex()] ?? list[0]
    if (!best) return

    const subPath = this.seedSubPath()

    // sub-path mode: rebuild the full path with the accepted child name
    if (subPath.length > 0) {
      const pathPrefix = subPath.join('/') + '/'
      this.input.nativeElement.value = pathPrefix + best + '/'
      this.suppressed.set(false)
      this.placeCaretAtEnd()
      this.syncSignalsFromDom()
      this.updateSeedSubPath()
      return
    }

    const rendered = this.completions.render(best, ctx.style)

    this.input.nativeElement.value =
      ctx.mode === 'marker'
        ? ctx.head + rendered + ' '
        : rendered + ' '

    this.suppressed.set(true)
    this.placeCaretAtEnd()
    this.syncSignalsFromDom()
  }

  private readonly clampActiveIndex = (): void => {
    const max = this.suggestions().length - 1
    this.activeIndex.update((v: number) => Math.max(0, Math.min(v, max)))
  }

  // -------------------------------------------------
  // parsing / seed creation helpers
  // -------------------------------------------------

  private readonly parseInput = (raw: string): { seedName: string | null; markerName: string | null } => {
    const hashIndex = raw.indexOf('#')

    const rawSeed = hashIndex === -1 ? raw : raw.slice(0, hashIndex).trim()
    const rawMarker = hashIndex === -1 ? null : raw.slice(hashIndex + 1).trim()

    const seedName = rawSeed ? this.completions.normalize(rawSeed.replace(/^\/+/, '').trim()) : null
    const markerName = rawMarker ? this.completions.normalize(rawMarker) : null

    return { seedName, markerName }
  }

  private readonly ensureSeedInCurrentDirectory = async (seedName: string): Promise<void> => {
    // create the seed directory in OPFS so listSeedFolders() can find it
    const dir = await this.lineage.explorerDir()
    if (dir) {
      await dir.getDirectoryHandle(seedName, { create: true })
    }

    // emit seed:added — HistoryRecorder will record the op
    EffectBus.emit('seed:added', { seed: seedName })
    this.requestSynchronize()
  }

  // -------------------------------------------------
  // dcp helpers
  // -------------------------------------------------

  private readonly tryOpenDcp = (): void => {
    if (this.dcpOpened) return
    this.dcpOpened = true
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
  }

  // -------------------------------------------------
  // ui helpers
  // -------------------------------------------------

  private readonly clear = (): void => {
    this.input.nativeElement.value = ''
    this.syncSignalsFromDom()
    this.seedSubPath.set([])
    this.seedLeaf.set('')
    this.seedProvider.query([])
    if (this.lastFilterKeyword) {
      EffectBus.emit('search:filter', { keyword: '' })
      this.lastFilterKeyword = ''
    }
  }

  private readonly placeCaretAtEnd = (): void => {
    const el = this.input.nativeElement
    queueMicrotask(() => el.setSelectionRange(el.value.length, el.value.length))
  }

  private readonly syncSignalsFromDom = (): void => {
    this.value.set(this.input.nativeElement.value)
  }

  private readonly requestSynchronize = (): void => {
    window.dispatchEvent(new Event('synchronize'))
  }

  // -------------------------------------------------
  // seed sub-path tracking
  // -------------------------------------------------

  private readonly updateSeedSubPath = (): void => {
    const raw = this.input.nativeElement.value.trim()

    // strip leading '/' (create-goto prefix)
    const clean = raw.replace(/^\/+/, '')

    // no '/' means we're at the current level
    if (!clean.includes('/')) {
      this.seedSubPath.set([])
      this.seedLeaf.set('')
      this.seedProvider.query([])
      return
    }

    // split on '/' — everything before the last segment is the sub-path,
    // the last segment (possibly empty after trailing '/') is the leaf filter
    const parts = clean.split('/')
    const leaf = this.completions.normalize((parts.pop() ?? '').trim())
    const subPath = parts.map(p => this.completions.normalize(p.trim())).filter(Boolean)

    this.seedSubPath.set(subPath)
    this.seedLeaf.set(leaf)
    this.seedProvider.query(subPath)
  }
}