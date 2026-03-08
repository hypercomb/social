// hypercomb-shared/ui/search-bar/search-bar.component.ts

import { AfterViewInit, Component, computed, ElementRef, signal, viewChild, type OnDestroy } from '@angular/core'
import type { Lineage } from '../../core/lineage'
import type { MovementService } from '../../core/movement.service'
import type { Navigation } from '../../core/navigation'
import type { ScriptPreloader } from '../../core/script-preloader'
import type { CompletionUtility, CompletionContext } from '@hypercomb/shared/core/completion-utility'
import { fromRuntime } from '../../core/from-runtime'
import { EffectBus } from '@hypercomb/core'

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent implements AfterViewInit, OnDestroy {

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input')

  // Resolve via IoC container (not Angular DI) — these are shared services
  // registered at module load time, available globally via get()
  private get completions(): CompletionUtility { return get('@hypercomb.social/CompletionUtility') as CompletionUtility }
  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  private get movement(): MovementService { return get('@hypercomb.social/MovementService') as MovementService }
  private get navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }
  private get preloader(): ScriptPreloader { return get('@hypercomb.social/ScriptPreloader') as ScriptPreloader }

  private readonly value = signal('')
  private readonly activeIndex = signal(0)
  private readonly suppressed = signal(false)

  // Bridge EventTarget-based services to Angular Signals for reactivity
  private readonly resourceCount$ = fromRuntime(
    get('@hypercomb.social/ScriptPreloader') as EventTarget,
    () => this.preloader.resourceCount
  )
  private readonly actionNames$ = fromRuntime(
    get('@hypercomb.social/ScriptPreloader') as EventTarget,
    () => this.preloader.actionNames
  )

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
    return this.locked()
      ? 'press enter'
      : 'search actions...'
  })

  public constructor() {
    console.log('[search-bar] initialized with url segments:', this.navigation.segments())
  }

  // -------------------------------------------------
  // completion context
  // -------------------------------------------------

  private readonly context = computed<CompletionContext>(() => {
    const v = this.value()
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

    const all = this.actionNames$()
    if (!ctx.normalized) return all

    return all.filter((n: any) => n.startsWith(ctx.normalized))
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

    if (!best.startsWith(ctx.normalized)) return ''

    const rendered = this.completions.render(best, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)

    let suffix = rendered.slice(prefix.length)
    if (!suffix) return ''

    const current = this.value()
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
    this.input().nativeElement.focus()
    this.syncSignalsFromDom()
  }

  public ngOnDestroy(): void { }

  // -------------------------------------------------
  // template helpers (required)
  // -------------------------------------------------

  public getActiveIndex = (): number => this.activeIndex()

  public typedPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return ''

    const rendered = this.completions.render(s, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)
    return rendered.slice(0, Math.min(prefix.length, rendered.length))
  }

  public restPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return s

    const rendered = this.completions.render(s, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)
    return rendered.slice(Math.min(prefix.length, rendered.length))
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
  }

  public onKeyDown = (e: KeyboardEvent): void => {
    const el = this.input().nativeElement
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

    if (e.key === 'Enter') {
      e.preventDefault()

      if (e.shiftKey) {
        void this.commitNavigate()
        return
      }

      void this.commitCreateSeedInPlace()
      return
    }
  }

  // -------------------------------------------------
  // create seed in place
  // -------------------------------------------------

  private readonly commitCreateSeedInPlace = async (): Promise<void> => {
    const rawInput = this.input().nativeElement.value.trim()
    if (!rawInput) return

    if (rawInput.includes('#')) {
      await this.commitLegacy()
      return
    }

    const navigateAfterCreate = rawInput.startsWith('/')
    const raw = navigateAfterCreate ? rawInput.replace(/^\/+/, '').trim() : rawInput

    // support nested seed creation: "hello/world" → create hello, then hello/world
    const parts = raw.split('/').map(s => this.completions.normalize(s.trim())).filter(Boolean)
    if (parts.length === 0) {
      this.clear()
      return
    }

    const baseSegments = this.navigation.segments()
    const target = [...baseSegments, ...parts]

    // ensure() is idempotent — creates the full directory hierarchy as needed
    await this.lineage.ensure(target)

    // emit seed:added for the top-level seed (the one visible in the current layer)
    EffectBus.emit('seed:added', { seed: parts[0] })
    this.requestSynchronize()

    if (navigateAfterCreate) {
      await this.movement.move(parts[0])
    }

    this.clear()
  }

  private readonly commitLegacy = async (): Promise<void> => {
    const raw = this.input().nativeElement.value.trim()
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

  private readonly commitNavigate = async (): Promise<void> => {
    const raw = this.input().nativeElement.value.trim()
    if (!raw) return

    if (this.locked()) {
      this.clear()
      return
    }

    const parsed = this.parseInput(raw)
    if (!parsed.seedName) {
      this.clear()
      return
    }

    const baseSegments = this.navigation.segments()
    const target = [...baseSegments, parsed.seedName]

    const exists = await this.lineage.tryResolve(target)
    if (!exists) {
      this.clear()
      return
    }

    await this.movement.move(parsed.seedName)
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

    const rendered = this.completions.render(best, ctx.style)

    this.input().nativeElement.value =
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
    const baseSegments = this.navigation.segments()
    const target = [...baseSegments, seedName]

    // ensure() is idempotent — creates the seed directory if needed.
    await this.lineage.ensure(target)

    // reactive: notify the system a seed was added
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
    this.input().nativeElement.value = ''
    this.syncSignalsFromDom()
  }

  private readonly placeCaretAtEnd = (): void => {
    const el = this.input().nativeElement
    queueMicrotask(() => el.setSelectionRange(el.value.length, el.value.length))
  }

  private readonly syncSignalsFromDom = (): void => {
    this.value.set(this.input().nativeElement.value)
  }

  private readonly requestSynchronize = (): void => {
    window.dispatchEvent(new Event('synchronize'))
  }
}