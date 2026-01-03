// src/app/common/header/search-bar/search-bar.component.ts

import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core'
import { hypercomb } from '@hypercomb/core'
import { OpfsStore } from '../../../core/opfs.store'
import { InitState } from '../../../core/model'
import { ResourceCompletionService } from './resource-completion.service'

type CompletionStyle = 'space' | 'dot'

type CompletionContext =
  | { active: false }
  | {
      active: true
      head: string          // everything up to and including "#"+spaces
      raw: string           // raw token text after "#"
      normalized: string    // normalized for matching
      style: CompletionStyle
    }

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent
  extends hypercomb
  implements AfterViewInit, OnDestroy {

  @ViewChild('input', { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  private readonly opfs = inject(OpfsStore)
  private readonly resources = inject(ResourceCompletionService)

  private initState: InitState = 'locked'
  private static readonly INIT_LINE = '# Press Enter to open the Portal'

  private readonly value = signal('')
  private readonly activeIndex = signal(0)
  private readonly suppressed = signal(false)

  // -------------------------------------------------
  // completion context (ANY #, last one wins)
  // -------------------------------------------------

  private readonly context = computed<CompletionContext>(() => {
    const v = this.value()

    const hashIndex = v.lastIndexOf('#')
    if (hashIndex === -1) return { active: false }

    const afterHash = v.slice(hashIndex + 1)

    const leadingWs = afterHash.match(/^\s*/)?.[0] ?? ''
    const raw = afterHash.slice(leadingWs.length)

    const head = v.slice(0, hashIndex + 1) + leadingWs

    const style: CompletionStyle =
      raw.includes('.') ? 'dot' : 'space'

    const normalized = this.normalize(raw)

    return {
      active: true,
      head,
      raw,
      normalized,
      style
    }
  })

  // -------------------------------------------------
  // suggestions
  // -------------------------------------------------

  public readonly suggestions = computed<readonly string[]>(() => {
    if (this.suppressed()) return []

    const ctx = this.context()
    if (!ctx.active) return []

    const prefix = ctx.normalized
    const all = this.resources.names()

    if (!prefix) return all
    return all.filter(n => n.startsWith(prefix))
  })

  public readonly showCompletions = computed<boolean>(() => {
    return this.suggestions().length > 0
  })

  // -------------------------------------------------
  // ghost text (mirrored input behind real input)
  // -------------------------------------------------

  public readonly ghostValue = computed<string>(() => {
    if (!this.showCompletions()) return ''

    const ctx = this.context()
    if (!ctx.active) return ''

    const list = this.suggestions()
    const best = list[this.activeIndex()] ?? list[0]
    if (!best) return ''

    if (!best.startsWith(ctx.normalized)) return ''
    if (best.length === ctx.normalized.length) return ''

    const renderedBest = this.render(best, ctx.style)
    const renderedPrefix = this.render(ctx.normalized, ctx.style)

    let suffix = renderedBest.slice(renderedPrefix.length)
    if (!suffix) return ''

    const current = this.value()
    const last = current.slice(-1)

    if ((last === '.' || /\s/.test(last)) &&
        (suffix.startsWith('.') || suffix.startsWith(' '))) {
      suffix = suffix.slice(1)
    }

    if (!suffix) return ''
    return current + suffix
  })

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public ngAfterViewInit(): void {
    if (this.opfs.actionsReady()) {
      this.initState = 'unlocked'
    }

    void this.resources.initialize()

    this.input.nativeElement.focus()
    this.syncSignalsFromDom()
    this.updatePlaceholder()
  }

  public ngOnDestroy(): void {}

  // -------------------------------------------------
  // template helpers
  // -------------------------------------------------

  public getActiveIndex = (): number => {
    return this.activeIndex()
  }

  public typedPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return ''

    const rendered = this.render(s, ctx.style)
    const prefix = this.render(ctx.normalized, ctx.style)
    return rendered.slice(0, Math.min(prefix.length, rendered.length))
  }

  public restPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return s

    const rendered = this.render(s, ctx.style)
    const prefix = this.render(ctx.normalized, ctx.style)
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

    // actions exist → normal typing + intellisense
    if (this.opfs.actionsReady()) {
      if (this.initState !== 'unlocked') {
        this.initState = 'unlocked'
        this.clear()
      }

      if (this.handleCompletionKeys(e)) return

      if (e.key === 'Enter') {
        e.preventDefault()
        void this.commit()
      }
      return
    }

    // no actions → portal gate
    e.preventDefault()

    if (this.initState === 'locked') {
      if (this.isHashKey(e)) {
        this.initState = 'armed'
        this.input.nativeElement.value = SearchBarComponent.INIT_LINE
        this.input.nativeElement.classList.add('armed')
        this.updatePlaceholder()
        this.placeCaretAtEnd()
        this.syncSignalsFromDom()
      }
      return
    }

    if (this.initState === 'armed') {
      if (e.key === 'Enter') {
        window.dispatchEvent(new CustomEvent('portal:open'))
        this.resetInit()
        return
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.resetInit()
        return
      }

      this.placeCaretAtEnd()
      this.syncSignalsFromDom()
    }
  }

  // -------------------------------------------------
  // commit
  // -------------------------------------------------

  private readonly commit = async (): Promise<void> => {
    const v = this.input.nativeElement.value.trim()
    if (!v) return

    await this.act(v)

    this.input.nativeElement.value = ''
    this.syncSignalsFromDom()
  }

  // -------------------------------------------------
  // completion keys
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
      this.activeIndex.update(v => Math.min(v + 1, list.length - 1))
      return true
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.activeIndex.update(v => Math.max(v - 1, 0))
      return true
    }

    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault()
      this.acceptCompletion()
      return true
    }

    if (e.key === 'Enter') {
      const ctx = this.context()
      if (!ctx.active) return false

      const s = list[this.activeIndex()] ?? list[0]
      if (!s) return false

      if (s !== ctx.normalized) {
        e.preventDefault()
        this.acceptCompletion(s)
        return true
      }
    }

    return false
  }

  private readonly acceptCompletion = (forced?: string): void => {
    const ctx = this.context()
    if (!ctx.active) return

    const list = this.suggestions()
    const s = forced ?? list[this.activeIndex()] ?? list[0]
    if (!s) return

    const el = this.input.nativeElement
    const rendered = this.render(s, ctx.style)

    el.value = ctx.head + rendered + ' '
    this.suppressed.set(true)

    this.placeCaretAtEnd()
    this.syncSignalsFromDom()
  }

  private readonly clampActiveIndex = (): void => {
    const list = this.suggestions()
    if (!list.length) {
      this.activeIndex.set(0)
      return
    }

    const max = list.length - 1
    this.activeIndex.update(v => (v > max ? 0 : v))
  }

  // -------------------------------------------------
  // ui helpers
  // -------------------------------------------------

  private readonly resetInit = (): void => {
    this.initState = 'locked'
    this.clear()
  }

  private readonly clear = (): void => {
    this.input.nativeElement.value = ''
    this.input.nativeElement.classList.remove('armed')
    this.updatePlaceholder()
    this.syncSignalsFromDom()
  }

  private readonly updatePlaceholder = (): void => {
    this.input.nativeElement.placeholder =
      this.opfs.actionsReady()
        ? 'Type a command…'
        : 'Type # and press Enter to open the Portal'
  }

  private readonly placeCaretAtEnd = (): void => {
    const el = this.input.nativeElement
    const n = el.value.length
    queueMicrotask(() => el.setSelectionRange(n, n))
  }

  private readonly isHashKey = (e: KeyboardEvent): boolean => {
    if (e.key === '#' || e.key === '＃') return true
    if (e.shiftKey && (e.key === '3' || e.code === 'Digit3')) return true
    return false
  }

  private readonly syncSignalsFromDom = (): void => {
    this.value.set(this.input.nativeElement.value)
  }

  // -------------------------------------------------
  // utils
  // -------------------------------------------------

  private readonly normalize = (s: string): string => {
    return s.replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  private readonly render = (s: string, style: CompletionStyle): string => {
    return style === 'dot'
      ? s.replace(/\s+/g, '.')
      : s
  }
}
