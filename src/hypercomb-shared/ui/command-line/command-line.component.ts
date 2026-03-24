// hypercomb-shared/ui/command-line/command-line.component.ts

import { AfterViewInit, Component, computed, ElementRef, signal, ViewChild, type OnDestroy } from '@angular/core'
import type { Lineage } from '../../core/lineage'
import type { MovementService } from '../../core/movement.service'
import type { Navigation } from '../../core/navigation'
import type { ScriptPreloader } from '../../core/script-preloader'
import type { SeedSuggestionProvider } from '../../core/seed-suggestion.provider'
import type { CompletionUtility, CompletionContext } from '@hypercomb/shared/core/completion-utility'
import { fromRuntime } from '../../core/from-runtime'
import { EffectBus, hypercomb } from '@hypercomb/core'
import type { CommandLineBehavior, CommandLineBehaviorMeta, CommandLineOperation } from './command-line-behavior'
import { ShiftEnterNavigateBehavior } from './shift-enter-navigate.behavior'
import { BatchCreateBehavior } from './batch-create.behavior'
import { DeleteCellBehavior } from './delete-cell.behavior'
import { GoParentBehavior } from './go-parent.behavior'
import { CutPasteBehavior } from './cut-paste.behavior'
import { HashMarkerBehavior } from './hash-marker.behavior'
import { SlashCommandBehavior } from './slash-command.behavior'

const BUILTIN_SLASH: { command: { name: string; description: string }; provider: null }[] = [
  { command: { name: 'select', description: 'select tiles for cut/copy/move' }, provider: null },
]

const MOVE_ARROW_OFFSETS: Record<string, { dq: number; dr: number }> = {
  ArrowLeft:  { dq: -1, dr:  0 },
  ArrowRight: { dq:  1, dr:  0 },
  ArrowUp:    { dq:  0, dr: -1 },
  ArrowDown:  { dq:  0, dr:  1 },
}

@Component({
  selector: 'hc-command-line',
  standalone: true,
  templateUrl: './command-line.component.html',
  styleUrls: ['./command-line.component.scss']
})
export class CommandLineComponent implements AfterViewInit, OnDestroy {

  @ViewChild('input', { read: ElementRef })
  private inputRef?: ElementRef<HTMLInputElement>

  private get input(): ElementRef<HTMLInputElement> {
    if (!this.inputRef) {
      throw new Error('CommandLineComponent input is not available before view init')
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

  // slash command matches — queries the drone via IoC when in slash mode
  // includes built-in commands (select) alongside queen bee commands
  readonly #slashMatches = computed(() => {
    const ctx = this.context()
    if (!ctx.active || ctx.mode !== 'slash') return []
    const drone = get('@diamondcoreprocessor.com/SlashCommandDrone') as any
    const droneMatches = drone?.match ? drone.match(ctx.normalized) as { command: { name: string; description: string }; provider: unknown }[] : []
    const builtinMatches = BUILTIN_SLASH.filter(b =>
      !ctx.normalized || b.command.name.startsWith(ctx.normalized)
    )
    return [...builtinMatches, ...droneMatches]
  })

  readonly #slashDescriptionMap = computed(() => {
    const map = new Map<string, string>()
    for (const m of this.#slashMatches()) {
      map.set(m.command.name, m.command.description)
    }
    return map
  })

  public slashDescription = (name: string): string => {
    const ctx = this.context()
    if (!ctx.active || ctx.mode !== 'slash') return ''
    return this.#slashDescriptionMap().get(name) ?? ''
  }

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
  #behaviors: CommandLineBehavior[] = this.#validateBehaviors([
    new GoParentBehavior(),
    new SlashCommandBehavior(),
    new DeleteCellBehavior(),
    new CutPasteBehavior(),
    new HashMarkerBehavior(),
    new BatchCreateBehavior(),
    new ShiftEnterNavigateBehavior()
  ])

  // built-in behaviors that are hardcoded in onKeyDown (not pluggable yet)
  static readonly builtinBehaviors: readonly CommandLineBehaviorMeta[] = [
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
  ]

  /** All behavior metadata — pluggable + built-in */
  public get behaviorReference(): readonly CommandLineBehaviorMeta[] {
    return [
      ...this.#behaviors,
      ...CommandLineComponent.builtinBehaviors
    ]
  }

  /** All operations across all behaviors, flat */
  public get allOperations(): readonly CommandLineOperation[] {
    return this.behaviorReference.flatMap(b => b.operations)
  }

  /**
   * Validate that no two behaviors claim overlapping trigger+pattern space.
   * Uses each operation's examples as probes — if two behaviors both match
   * the same example input under the same trigger, that's a conflict.
   */
  #validateBehaviors(behaviors: CommandLineBehavior[]): CommandLineBehavior[] {
    const claimed = new Map<string, { behavior: string; pattern: RegExp }>()

    for (const b of behaviors) {
      for (const op of b.operations) {
        for (const ex of op.examples) {
          const key = `${op.trigger}::${ex.input}`
          const existing = claimed.get(key)
          if (existing) {
            console.warn(
              `[command-line] overlap: "${b.name}" and "${existing.behavior}" both claim ` +
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
    if (ctx.active && ctx.mode === 'slash') return 'type a command...'
    return 'share intent...'
  })

  public constructor() {
    console.log('[command-line] initialized with url segments:', this.navigation.segments())
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

    // /select[...] command mode — must be checked before general slash mode
    const selectMatch = v.match(/^\/select\[/)
    if (selectMatch) {
      return this.#parseSelectContext(v)
    }

    // '/' prefix enters slash command mode
    if (v.startsWith('/')) {
      const raw = v.slice(1)
      return {
        active: true,
        mode: 'slash',
        head: '/',
        raw,
        normalized: raw.toLowerCase().trim(),
        style: 'space'
      }
    }

    // ! prefix enters delete mode — show seeds as intellisense
    // supports: !name, ![a,b,c] (intellisense on the current segment)
    if (v.startsWith('!')) {
      const body = v.slice(1)
      // find the current segment: after last ',' or '[', or the whole body
      const lastSep = Math.max(body.lastIndexOf(','), body.lastIndexOf('['))
      const raw = lastSep === -1 ? body : body.slice(lastSep + 1)
      const head = v.slice(0, v.length - raw.length)
      const normalized = this.completions.normalize(raw)
      return {
        active: true,
        mode: 'delete',
        head,
        raw,
        normalized,
        style: raw.includes('.') ? 'dot' : 'space'
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
    if (ctx.mode === 'slash') return this.#slashMatches().map(m => m.command.name)

    // select mode: suggestions depend on the current phase
    if (ctx.mode === 'select') {
      const phase = this.#selectPhase()

      // selection phase: show tile names, exclude already-selected
      if (phase === 'selection') {
        let seeds = this.seedNames$()
        const excluded = this.#selectExcluded()
        if (excluded.size) seeds = seeds.filter(n => !excluded.has(n))
        if (!ctx.normalized) return seeds
        return seeds.filter(n => n.startsWith(ctx.normalized))
      }

      // operation phase: suggest operation keywords with / prefix
      if (phase === 'operation') {
        const ops = ['/cut', '/copy']
        if (!ctx.normalized) return ops
        return ops.filter(o => o.startsWith('/' + ctx.normalized) || o.slice(1).startsWith(ctx.normalized))
      }

      // move-path phase: suggest child directories at the current navigation depth
      if (phase === 'move-path') {
        const seeds = this.seedNames$()
        if (!ctx.normalized) return seeds
        return seeds.filter(n => n.startsWith(ctx.normalized))
      }

      // move-target-swap phase: suggest tile names at target directory
      if (phase === 'move-target-swap') {
        const seeds = this.seedNames$()
        if (!ctx.normalized) return seeds
        return seeds.filter(n => n.startsWith(ctx.normalized))
      }

      // move-target-index: no suggestions (numeric input)
      return []
    }

    // delete mode: show only seeds (tiles) that can be deleted
    // exclude items already chosen in bracket syntax ![a,b,...]
    if (ctx.mode === 'delete') {
      const already = new Set<string>()
      const bracketMatch = ctx.head.match(/\[(.+)/)
      if (bracketMatch) {
        for (const item of bracketMatch[1].split(',')) {
          const n = this.completions.normalize(item)
          if (n) already.add(n)
        }
      }
      let seeds = this.seedNames$()
      if (already.size) seeds = seeds.filter(n => !already.has(n))
      if (!ctx.normalized) return seeds
      return seeds.filter(n => n.startsWith(ctx.normalized))
    }

    const bracketPhase = this.#bracketPhase()
    const subPath = this.seedSubPath()
    const leaf = this.seedLeaf()
    const seeds = this.seedNames$()
    const actions = this.actionNames$()

    // bracket mode: filter by seedLeaf instead of ctx.normalized
    if (bracketPhase === 'items' || bracketPhase === 'path') {
      if (subPath.length > 0) {
        if (!leaf) return seeds
        return seeds.filter(n => n.startsWith(leaf))
      }
      // current level seeds only (no actions in bracket mode)
      if (!leaf) return seeds
      return seeds.filter(n => n.startsWith(leaf))
    }

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
    if (!this.suggestions().length) return false
    // inside bracket delete syntax: ghost text only, no dropdown
    const ctx = this.context()
    if (ctx.active && ctx.mode === 'delete' && ctx.head.includes(',')) return false
    return true
  })

  // -------------------------------------------------
  // ghost mirror (second input layer)
  // -------------------------------------------------

  public readonly ghostValue = computed<string>(() => {
    if (!this.suggestions().length) return ''

    const ctx = this.context()
    if (!ctx.active) return ''

    const list = this.suggestions()
    const best = list[this.activeIndex()] ?? list[0]
    if (!best) return ''

    const subPath = this.seedSubPath()
    const leaf = this.seedLeaf()
    const current = this.value()
    const bracketPhase = this.#bracketPhase()

    // select mode: ghost text for operation/path/swap suggestions
    if (ctx.mode === 'select') {
      const phase = this.#selectPhase()
      if (phase === 'operation') {
        // operation suggestions include '/' prefix — build ghost from head + suggestion
        const bracketClose = current.indexOf(']')
        if (bracketClose >= 0) {
          const prefix = current.slice(0, bracketClose + 1)
          const op = best.startsWith('/') ? best : '/' + best
          return prefix + op
        }
      }
      // selection/path/swap: use head + raw suffix
      if (!best.startsWith(ctx.normalized) && ctx.normalized) return ''
      const suffix = best.slice(ctx.normalized.length)
      if (!suffix) return ''
      return current + suffix
    }

    // bracket mode: ghost shows the completion suffix for the active fragment
    if (bracketPhase === 'items' || bracketPhase === 'path') {
      if (!best.startsWith(leaf)) return ''
      const suffix = best.slice(leaf.length)
      if (!suffix) return ''
      return current + suffix
    }

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

    window.addEventListener('navigate', this.#onNavigate)
    window.addEventListener('popstate', this.#onNavigate)
    this.#commandLineToggleUnsub = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd !== 'ui.commandLineToggle') return
      if (document.activeElement === this.input.nativeElement) {
        this.input.nativeElement.blur()
      } else {
        this.input.nativeElement.focus()
      }
    })
    this.input.nativeElement.addEventListener('focus', this.#onInputFocus)

    this.#prefillUnsub = EffectBus.on<{ value: string }>('search:prefill', ({ value }) => {
      this.input.nativeElement.value = value
      this.input.nativeElement.focus()
      this.placeCaretAtEnd()
      this.suppressed.set(false)
      this.syncSignalsFromDom()
    })

    this.#touchDraggingUnsub = EffectBus.on<{ active: boolean }>('touch:dragging', ({ active }) => {
      this.touchDragging.set(active)
      if (active) {
        this.input.nativeElement.blur()
        this.suppressed.set(true)
      }
    })

    // Bi-directional sync: external selection changes → update command line
    this.#selectionSyncUnsub = EffectBus.on<{ selected: string[]; active: string | null }>('selection:changed', (payload) => {
      if (this.#syncDirection === 'command') return // prevent feedback loop
      if (!payload?.selected) return

      const selected = payload.selected
      if (selected.length === 0) {
        // Selection cleared externally — clear select mode if we're in it
        if (this.#selectPhase() !== 'none') {
          this.clear()
        }
        return
      }

      // Only sync if bar is empty or already in select mode
      const ctx = this.context()
      if (!ctx.active || ctx.mode === 'select' || this.input.nativeElement.value === '') {
        this.#syncDirection = 'visual'
        this.input.nativeElement.value = this.#buildSelectValue(selected, this.#shouldTruncate(selected))
        this.suppressed.set(true)
        this.placeCaretAtEnd()
        this.syncSignalsFromDom()
        this.#syncDirection = 'idle'
      }
    })
  }

  readonly touchDragging = signal(false)
  #prefillUnsub?: () => void
  #commandLineToggleUnsub?: () => void
  #touchDraggingUnsub?: () => void
  #selectionSyncUnsub?: () => void
  readonly #onNavigate = (): void => { this.clear() }

  /** On focus: expand truncated /select[...] back to full names */
  readonly #onInputFocus = (): void => {
    const v = this.input.nativeElement.value
    if (!v.match(/^\/select\[/)) return
    const selection = get('@diamondcoreprocessor.com/SelectionService') as any
    if (!selection || selection.count === 0) return
    const full = Array.from(selection.selected as Set<string>)
    this.#syncDirection = 'visual'
    this.input.nativeElement.value = '/select[' + full.join(',') + ']'
    this.placeCaretAtEnd()
    this.syncSignalsFromDom()
    this.#syncDirection = 'idle'
  }

  public ngOnDestroy(): void {
    this.#prefillUnsub?.()
    this.#commandLineToggleUnsub?.()
    this.#touchDraggingUnsub?.()
    this.#selectionSyncUnsub?.()
    window.removeEventListener('navigate', this.#onNavigate)
    window.removeEventListener('popstate', this.#onNavigate)
    this.input.nativeElement.removeEventListener('focus', this.#onInputFocus)
  }

  // -------------------------------------------------
  // template helpers (required)
  // -------------------------------------------------

  public getActiveIndex = (): number => this.activeIndex()

  public typedPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return ''

    // bracket mode: highlight the leaf prefix within the suggestion
    const bracketPhase = this.#bracketPhase()
    if (bracketPhase === 'items' || bracketPhase === 'path') {
      const leaf = this.seedLeaf()
      return s.slice(0, Math.min(leaf.length, s.length))
    }

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

    // bracket mode: rest is everything after the leaf prefix
    const bracketPhase = this.#bracketPhase()
    if (bracketPhase === 'items' || bracketPhase === 'path') {
      const leaf = this.seedLeaf()
      return s.slice(Math.min(leaf.length, s.length))
    }

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
    // Strip leading spaces — they break ghost text alignment
    const el = this.input.nativeElement
    if (el.value !== el.value.trimStart()) {
      el.value = el.value.trimStart()
    }
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

    // select mode side-effects: index overlay, move preview, real-time navigation
    if (ctx.active && ctx.mode === 'select') {
      this.#handleSelectInputEffects()
    } else if (this.#lastSelectMode) {
      // Exited select mode — clear selection
      this.#syncDirection = 'command'
      const selection = get('@diamondcoreprocessor.com/SelectionService') as any
      if (selection?.count > 0) selection.clear()
      this.#syncDirection = 'idle'
      EffectBus.emit('move:index-overlay', { show: false })
    }
    this.#lastSelectMode = ctx.active && ctx.mode === 'select'

    // update seed sub-path query when input contains '/'
    this.updateSeedSubPath()
  }

  private lastFilterKeyword = ''

  public onKeyDown = (e: KeyboardEvent): void => {
    const el = this.input.nativeElement
    const v = el.value

    // Escape in select mode: collapse back to /select[tiles] or clear (before completion keys)
    if (e.key === 'Escape' && this.#selectPhase() !== 'none') {
      e.preventDefault()
      this.#cancelSelectOperation()
      return
    }

    // Ctrl+Arrow in move-target-index: scrub target index using hex offsets
    if ((e.ctrlKey || e.metaKey) && this.#selectPhase() === 'move-target-index' && this.#handleMoveScrub(e)) {
      return
    }

    if (this.handleCompletionKeys(e)) return

    // /select[...] command execution — intercept before general slash handler
    if (e.key === 'Enter' && !e.shiftKey && v.match(/^\/select\[/)) {
      e.preventDefault()
      void this.#executeSelectCommand()
      return
    }

    // slash command execution
    if (e.key === 'Enter' && !e.shiftKey && v.startsWith('/')) {
      e.preventDefault()
      void this.#executeSlashCommand()
      return
    }

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

  // -------------------------------------------------
  // slash command execution
  // -------------------------------------------------

  readonly #executeSlashCommand = async (): Promise<void> => {
    const raw = this.input.nativeElement.value.slice(1).trim()
    if (!raw) { this.clear(); return }

    const spaceIdx = raw.indexOf(' ')
    const commandName = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)
    const args = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1).trim()

    const drone = get('@diamondcoreprocessor.com/SlashCommandDrone') as any
    if (drone?.execute) {
      await drone.execute(commandName, args)
    }
    this.clear()
  }

  // -------------------------------------------------
  // /select[...] command execution
  // -------------------------------------------------

  readonly #executeSelectCommand = async (): Promise<void> => {
    const v = this.input.nativeElement.value.trim()
    const bracketClose = v.indexOf(']')
    if (bracketClose < 0) { return } // brackets not closed yet, no-op

    const inner = v.slice(v.indexOf('[') + 1, bracketClose)
    const labels = inner.split(',').map(s => this.completions.normalize(s.trim())).filter(Boolean)
    if (labels.length === 0) { this.clear(); return }

    const afterBracket = v.slice(bracketClose + 1)

    // Parse operation: /cut, /copy, /move...
    const opMatch = afterBracket.match(/^\/(\w+)/)
    const op = opMatch ? opMatch[1].toLowerCase() : ''

    const selection = get('@diamondcoreprocessor.com/SelectionService') as any
    if (!selection) { this.clear(); return }

    // Always select the tiles first
    selection.clear()
    for (const label of labels) {
      selection.add(label)
    }

    if (op === 'cut') {
      // Use existing ClipboardWorker via controls:action effect
      EffectBus.emit('controls:action', { action: 'cut' })
      this.clear()
      return
    }

    if (op === 'copy') {
      EffectBus.emit('controls:action', { action: 'copy' })
      this.#collapseToSelect(labels)
      return
    }

    if (op === 'move') {
      // Parse target: (index) or [swapTile]
      const afterOp = afterBracket.slice(opMatch![0].length)

      // Check for (index)
      const indexMatch = afterOp.match(/.*\((\d+)\)/)
      if (indexMatch) {
        const targetIndex = parseInt(indexMatch[1], 10)
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          moveDrone.beginCommandMove(labels)
          await moveDrone.commitCommandMoveAt(targetIndex)
        }
        EffectBus.emit('move:index-overlay', { show: false })
        this.#collapseToSelect(labels)
        return
      }

      // Check for [swapTile]
      const swapMatch = afterOp.match(/.*\[([^\]]+)\]$/)
      if (swapMatch) {
        const swapLabel = this.completions.normalize(swapMatch[1])
        // Resolve swap tile's index
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          moveDrone.beginCommandMove(labels)
          await moveDrone.commitCommandMoveToLabel(swapLabel)
        }
        EffectBus.emit('move:index-overlay', { show: false })
        this.#collapseToSelect(labels)
        return
      }

      // Just /move with no target — stay in move mode (don't clear)
      return
    }

    // No operation — just /select[tiles] → select and show in bar
    this.#collapseToSelect(labels)
  }

  /** After an operation completes, collapse the command line to /select[remaining-tiles] */
  /** Build /select[...] string, truncating names when unfocused and list exceeds thresholds */
  #buildSelectValue(labels: readonly string[], truncate: boolean): string {
    if (!truncate) return '/select[' + labels.join(',') + ']'
    const mapped = labels.map(l => l.length <= 4 ? l : l.slice(0, 3) + '.')
    return '/select[' + mapped.join(',') + ']'
  }

  /** Whether to truncate: 4+ items or bracket content > 64 chars, and input is unfocused */
  #shouldTruncate(labels: readonly string[]): boolean {
    if (document.activeElement === this.input.nativeElement) return false
    if (labels.length >= 4) return true
    return labels.join(',').length > 64
  }

  // ── Ctrl+Arrow move index scrub ──────────────────────────────

  /** Scrub the move target index with Ctrl+Arrow. Returns true if handled. */
  #handleMoveScrub(e: KeyboardEvent): boolean {
    const offset = MOVE_ARROW_OFFSETS[e.key]
    if (!offset) return false

    e.preventDefault()

    const v = this.input.nativeElement.value
    const parenIdx = v.lastIndexOf('(')
    if (parenIdx < 0) return true

    const currentIndex = parseInt(v.slice(parenIdx + 1).replace(/\)$/, ''), 10)
    if (isNaN(currentIndex)) return true

    const axialSvc = get('@diamondcoreprocessor.com/AxialService') as any
    if (!axialSvc?.items) return true

    const coord = axialSvc.items.get(currentIndex)
    if (!coord) return true

    // Apply hex offset
    const newQ = coord.q + offset.dq
    const newR = coord.r + offset.dr

    // Find the index at the new axial position
    let newIndex = -1
    for (const [idx, item] of axialSvc.items) {
      if (item.q === newQ && item.r === newR) { newIndex = idx; break }
    }
    if (newIndex < 0) return true // out of bounds

    // Update the input value with the new index
    this.input.nativeElement.value = v.slice(0, parenIdx + 1) + newIndex
    this.syncSignalsFromDom()
    return true
  }

  #collapseToSelect(labels: readonly string[]): void {
    const selection = get('@diamondcoreprocessor.com/SelectionService') as any
    const remaining = selection ? Array.from(selection.selected as Set<string>) : labels
    if (remaining.length > 0) {
      const focused = document.activeElement === this.input.nativeElement
      this.input.nativeElement.value = this.#buildSelectValue(remaining, this.#shouldTruncate(remaining))
      this.suppressed.set(true)
      this.placeCaretAtEnd()
      this.syncSignalsFromDom()
    } else {
      this.clear()
    }
  }

  /** Cancel select operation — collapse back to /select[tiles] or clear */
  #cancelSelectOperation(): void {
    const phase = this.#selectPhase()
    const labels = this.#selectLabels()
    EffectBus.emit('move:index-overlay', { show: false })
    EffectBus.emit('move:preview', null)

    // Restore navigation if we navigated away
    if (this.#selectOriginalSegments) {
      this.navigation.replaceRaw(this.#selectOriginalSegments)
      this.#selectOriginalSegments = null
    }

    // If there's an operation after ] (e.g. /select[tiles]/cut), collapse to /select[tiles]
    // Otherwise (selection phase or bare /select[tiles]), clear everything
    const v = this.input.nativeElement.value
    const bracketClose = v.indexOf(']')
    const hasOperation = bracketClose >= 0 && v.slice(bracketClose + 1).startsWith('/')
    if (hasOperation && labels.length > 0) {
      this.#collapseToSelect(labels)
    } else {
      this.clear()
    }
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

    // slash mode: fill command name with trailing space (or [ for select)
    if (ctx.mode === 'slash') {
      if (best === 'select') {
        this.input.nativeElement.value = '/select['
        this.suppressed.set(false)
      } else {
        this.input.nativeElement.value = '/' + best + ' '
        this.suppressed.set(true)
      }
      this.placeCaretAtEnd()
      this.syncSignalsFromDom()
      return
    }

    // select mode: completion depends on phase
    if (ctx.mode === 'select') {
      const phase = this.#selectPhase()
      const raw = this.input.nativeElement.value

      // selection phase: insert name (user adds comma or ] themselves)
      if (phase === 'selection') {
        const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('['))
        const before = raw.slice(0, lastSep + 1)
        const spacer = raw.lastIndexOf(',') >= 0 ? ' ' : ''
        this.input.nativeElement.value = before + spacer + best
        this.suppressed.set(false)
        this.placeCaretAtEnd()
        this.syncSignalsFromDom()
        return
      }

      // operation phase: complete the operation keyword (suggestions include / prefix)
      if (phase === 'operation') {
        const bracketClose = raw.indexOf(']')
        const prefix = raw.slice(0, bracketClose + 1)
        const op = best.startsWith('/') ? best : '/' + best
        this.input.nativeElement.value = prefix + op
        this.suppressed.set(true)
        this.placeCaretAtEnd()
        this.syncSignalsFromDom()
        return
      }

      // move-path phase: complete directory name and append /
      if (phase === 'move-path') {
        this.input.nativeElement.value = ctx.head + best + '/'
        this.suppressed.set(false)
        this.placeCaretAtEnd()
        this.syncSignalsFromDom()
        return
      }

      // move-target-swap: complete tile name
      if (phase === 'move-target-swap') {
        this.input.nativeElement.value = ctx.head + best + ']'
        this.suppressed.set(true)
        this.placeCaretAtEnd()
        this.syncSignalsFromDom()
        return
      }

      return
    }

    const bracketPhase = this.#bracketPhase()
    const subPath = this.seedSubPath()
    const raw = this.input.nativeElement.value

    // bracket-items mode: insert name after last comma (or after [)
    if (bracketPhase === 'items') {
      const lastComma = raw.lastIndexOf(',')
      const insertAt = lastComma >= 0 ? lastComma + 1 : raw.indexOf('[') + 1
      const before = raw.slice(0, insertAt)
      // add a space after comma for readability, then the name and a comma for the next item
      const spacer = lastComma >= 0 ? ' ' : ''
      this.input.nativeElement.value = before + spacer + best + ','
      this.suppressed.set(false)
      this.placeCaretAtEnd()
      this.syncSignalsFromDom()
      this.updateSeedSubPath()
      return
    }

    // bracket-path mode: rebuild bracket prefix + path with accepted child
    if (bracketPhase === 'path') {
      const bracketClose = raw.indexOf(']')
      const bracketPrefix = raw.slice(0, bracketClose + 2) // [items]/
      if (subPath.length > 0) {
        this.input.nativeElement.value = bracketPrefix + subPath.join('/') + '/' + best + '/'
      } else {
        this.input.nativeElement.value = bracketPrefix + best + '/'
      }
      this.suppressed.set(false)
      this.placeCaretAtEnd()
      this.syncSignalsFromDom()
      this.updateSeedSubPath()
      return
    }

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
      (ctx.mode === 'marker' || ctx.mode === 'delete')
        ? ctx.head + rendered
        : rendered

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
    // Clear selection when exiting select mode
    if (this.#lastSelectMode) {
      this.#syncDirection = 'command'
      const selection = get('@diamondcoreprocessor.com/SelectionService') as any
      if (selection?.count > 0) selection.clear()
      this.#syncDirection = 'idle'
      this.#lastSelectMode = false
    }
    EffectBus.emit('move:index-overlay', { show: false })
    // Reset select state (phase/labels/excluded are computed from value, auto-reset)
    if (this.#selectOriginalSegments) {
      this.navigation.replaceRaw(this.#selectOriginalSegments)
      this.#selectOriginalSegments = null
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
    void new hypercomb().act()
  }

  // -------------------------------------------------
  // /select[...] context parsing
  // -------------------------------------------------

  /** Original navigation segments stored before real-time navigation (for rollback) */
  #selectOriginalSegments: string[] | null = null

  /** Phase derived from value — computed, no signal writes */
  #selectPhase = computed<'none' | 'selection' | 'operation' | 'move-path' | 'move-target-index' | 'move-target-swap'>(() => {
    const v = this.value()
    if (!v.match(/^\/select\[/)) return 'none'
    return this.#deriveSelectPhase(v)
  })

  /** Labels derived from value — computed. Includes committed labels during selection phase. */
  #selectLabels = computed<readonly string[]>(() => {
    const v = this.value()
    if (!v.match(/^\/select\[/)) return []
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')
    // Bracket closed — parse full list
    if (bracketClose >= 0) {
      const inner = v.slice(bracketOpen + 1, bracketClose)
      return inner.split(',').map(s => this.completions.normalize(s.trim())).filter(Boolean)
    }
    // Bracket still open (selection phase) — include committed labels (before last comma)
    // and the current partial if it matches an existing seed name exactly
    const body = v.slice(bracketOpen + 1)
    const parts = body.split(',').map(s => this.completions.normalize(s.trim())).filter(Boolean)
    return parts
  })

  /** Excluded items derived from value — computed */
  #selectExcluded = computed<ReadonlySet<string>>(() => {
    const v = this.value()
    if (!v.match(/^\/select\[/)) return new Set<string>()
    const bracketClose = v.indexOf(']')
    if (bracketClose >= 0) return new Set<string>() // brackets closed, no exclusion needed
    const body = v.slice(v.indexOf('[') + 1)
    const lastComma = body.lastIndexOf(',')
    if (lastComma < 0) return new Set<string>()
    const already = new Set<string>()
    for (const item of body.slice(0, lastComma).split(',')) {
      const n = this.completions.normalize(item.trim())
      if (n) already.add(n)
    }
    return already
  })

  /** Derive the select phase from the input string (pure, no side effects) */
  #deriveSelectPhase(v: string): 'selection' | 'operation' | 'move-path' | 'move-target-index' | 'move-target-swap' {
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')

    if (bracketClose < 0) return 'selection'

    const afterBracket = v.slice(bracketClose + 1)
    if (!afterBracket || afterBracket === '/') return 'operation'

    if (afterBracket.startsWith('/')) {
      const opAndRest = afterBracket.slice(1)
      const nextSlash = opAndRest.indexOf('/')
      const opKeyword = nextSlash === -1 ? opAndRest : opAndRest.slice(0, nextSlash)
      const opLower = opKeyword.toLowerCase().trim()

      if (opLower === 'cut' || opLower === 'copy') return 'operation'

      if (opLower === 'move' || opLower.startsWith('move')) {
        // Check for (index) — note: the first [ is at bracketOpen
        const parenIdx = v.lastIndexOf('(')
        if (parenIdx > bracketClose) return 'move-target-index'

        const lastBracketOpen = v.lastIndexOf('[')
        if (lastBracketOpen > bracketClose) return 'move-target-swap'

        const afterMove = nextSlash === -1 ? '' : opAndRest.slice(nextSlash)
        if (afterMove) return 'move-path'

        return 'operation'
      }

      return 'operation'
    }

    return 'operation'
  }

  /**
   * Parse the /select[...]/operation syntax into a CompletionContext (pure function).
   */
  #parseSelectContext(v: string): import('@hypercomb/shared/core/completion-utility').CompletionContext {
    const bracketOpen = v.indexOf('[')
    const bracketClose = v.indexOf(']')
    const phase = this.#deriveSelectPhase(v)

    // Phase: selection — inside the first bracket pair
    if (phase === 'selection') {
      const body = v.slice(bracketOpen + 1)
      const lastSep = Math.max(body.lastIndexOf(','), -1)
      const raw = lastSep === -1 ? body : body.slice(lastSep + 1).trimStart()
      const head = v.slice(0, v.length - raw.length)
      const normalized = this.completions.normalize(raw)

      return {
        active: true,
        mode: 'select',
        head,
        raw,
        normalized,
        style: 'space'
      }
    }

    const afterBracket = v.slice(bracketClose + 1)

    // Phase: operation keyword
    if (phase === 'operation') {
      if (!afterBracket || afterBracket === '/') {
        const raw = afterBracket.startsWith('/') ? afterBracket.slice(1) : ''
        return {
          active: true,
          mode: 'select',
          head: v.slice(0, v.length - raw.length),
          raw,
          normalized: raw.toLowerCase().trim(),
          style: 'space'
        }
      }
      if (afterBracket.startsWith('/')) {
        const opAndRest = afterBracket.slice(1)
        const nextSlash = opAndRest.indexOf('/')
        const opKeyword = nextSlash === -1 ? opAndRest : opAndRest.slice(0, nextSlash)
        const opLower = opKeyword.toLowerCase().trim()

        if (opLower === 'cut' || opLower === 'copy' || opLower === 'move') {
          return { active: true, mode: 'select', head: v, raw: '', normalized: opLower, style: 'space' }
        }
        return {
          active: true, mode: 'select',
          head: v.slice(0, bracketClose + 2),
          raw: opKeyword, normalized: opLower, style: 'space'
        }
      }
      return { active: true, mode: 'select', head: v, raw: '', normalized: '', style: 'space' }
    }

    // Phase: move-target-index
    if (phase === 'move-target-index') {
      const parenStart = v.lastIndexOf('(')
      const raw = v.slice(parenStart + 1).replace(/\)$/, '')
      return { active: true, mode: 'select', head: v.slice(0, parenStart + 1), raw, normalized: raw.trim(), style: 'space' }
    }

    // Phase: move-target-swap
    if (phase === 'move-target-swap') {
      const lastBracketOpen = v.lastIndexOf('[')
      const raw = v.slice(lastBracketOpen + 1).replace(/\]$/, '')
      return { active: true, mode: 'select', head: v.slice(0, lastBracketOpen + 1), raw, normalized: this.completions.normalize(raw), style: 'space' }
    }

    // Phase: move-path
    if (phase === 'move-path') {
      const opAndRest = afterBracket.slice(1)
      const nextSlash = opAndRest.indexOf('/')
      const afterMove = nextSlash === -1 ? '' : opAndRest.slice(nextSlash)
      const pathPart = afterMove.slice(1)
      const pathSlash = pathPart.lastIndexOf('/')
      const raw = pathSlash === -1 ? pathPart : pathPart.slice(pathSlash + 1)
      return { active: true, mode: 'select', head: v.slice(0, v.length - raw.length), raw, normalized: this.completions.normalize(raw), style: 'space' }
    }

    return { active: true, mode: 'select', head: v, raw: '', normalized: '', style: 'space' }
  }

  /** Sync direction flag to prevent feedback loops in bi-directional sync */
  #syncDirection: 'command' | 'visual' | 'idle' = 'idle'
  /** Tracks whether we were in select mode last input — used to detect exit and clear selection */
  #lastSelectMode = false

  /**
   * Handle side effects when typing in /select[...] mode:
   * - Show/hide index overlay when entering/leaving move phases
   * - Emit move preview when target index changes
   * - Navigate in real-time when path changes
   */
  #handleSelectInputEffects(): void {
    const phase = this.#selectPhase()
    const labels = this.#selectLabels()

    // Select tiles visually as labels are typed — bidirectional sync
    this.#syncDirection = 'command'
    const selection = get('@diamondcoreprocessor.com/SelectionService') as any
    if (selection) {
      const current = selection.selected as ReadonlySet<string>
      const target = new Set(labels)
      // Only update if different
      if (current.size !== target.size || ![...target].every(l => current.has(l))) {
        selection.clear()
        for (const label of labels) selection.add(label)
      }
    }
    this.#syncDirection = 'idle'

    // Show index overlay when in move phases
    const showOverlay = phase === 'move-path' || phase === 'move-target-index' || phase === 'move-target-swap'
    EffectBus.emit('move:index-overlay', { show: showOverlay })

    // Live preview when target index is being typed
    if (phase === 'move-target-index') {
      const v = this.input.nativeElement.value
      const parenStart = v.lastIndexOf('(')
      const rawIndex = v.slice(parenStart + 1).replace(/\)$/, '')
      const targetIndex = parseInt(rawIndex, 10)
      if (!isNaN(targetIndex) && labels.length > 0) {
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          if (!moveDrone.moveCommandActive) moveDrone.beginCommandMove(labels)
          moveDrone.updateCommandMove(targetIndex)
        }
      }
    } else {
      // Clear preview when not in target-index phase
      const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
      if (moveDrone?.moveCommandActive) {
        moveDrone.cancelCommandMove()
      }
    }

    // Real-time navigation when in move-path phase
    if (phase === 'move-path') {
      const v = this.input.nativeElement.value
      const moveStart = v.indexOf('/move')
      if (moveStart >= 0) {
        const afterMove = v.slice(moveStart + 5) // after /move
        if (afterMove.startsWith('/')) {
          const pathPart = afterMove.slice(1).replace(/\/$/, '')
          if (pathPart) {
            const segments = pathPart.split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean)
            // Store original navigation state for rollback
            if (!this.#selectOriginalSegments) {
              this.#selectOriginalSegments = [...this.navigation.segmentsRaw()]
            }
            // Navigate to target directory
            const target = [...this.#selectOriginalSegments, ...segments]
            this.navigation.replaceRaw(target)
            // Update seed suggestion provider for autocomplete at target
            this.seedProvider.query(segments)
          }
        }
      }
    }
  }

  // -------------------------------------------------
  // seed sub-path tracking
  // -------------------------------------------------

  // bracket mode: 'none' | 'items' (inside []) | 'path' (after ]/)
  #bracketPhase = signal<'none' | 'items' | 'path'>('none')

  private readonly updateSeedSubPath = (): void => {
    const raw = this.input.nativeElement.value.trim()

    // detect bracket mode: [items]/path
    const bracketOpen = raw.indexOf('[')
    const bracketClose = raw.indexOf(']')

    if (bracketOpen === 0 && bracketClose < 0) {
      // inside brackets — suggest current surface tiles
      this.#bracketPhase.set('items')
      const inner = raw.slice(1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = lastComma >= 0 ? inner.slice(lastComma + 1).trim() : inner.trim()
      const leaf = this.completions.normalize(fragment)
      this.seedSubPath.set([])
      this.seedLeaf.set(leaf)
      this.seedProvider.query([])
      return
    }

    if (bracketOpen === 0 && bracketClose > 0 && bracketClose < raw.length - 1 && raw[bracketClose + 1] === '/') {
      // after bracket-path — suggest relative subfolders
      this.#bracketPhase.set('path')
      const pathPart = raw.slice(bracketClose + 2) // after ]/
      const clean = pathPart.replace(/\/+$/, '')
      if (!clean.includes('/')) {
        // single level: leaf is the typed fragment, query at current level
        const leaf = this.completions.normalize(clean)
        this.seedSubPath.set([])
        this.seedLeaf.set(leaf)
        this.seedProvider.query([])
        return
      }
      const parts = clean.split('/')
      const leaf = this.completions.normalize((parts.pop() ?? '').trim())
      const subPath = parts.map(p => this.completions.normalize(p.trim())).filter(Boolean)
      this.seedSubPath.set(subPath)
      this.seedLeaf.set(leaf)
      this.seedProvider.query(subPath)
      return
    }

    // default: no bracket mode
    this.#bracketPhase.set('none')

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