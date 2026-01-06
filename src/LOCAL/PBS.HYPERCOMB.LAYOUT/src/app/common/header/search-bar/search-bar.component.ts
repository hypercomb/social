// src/app/common/header/search-bar/search-bar.component.ts
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core'
import { hypercomb } from '@hypercomb/core'
import { OpfsStore } from '../../../core/opfs.store'
import { InitState } from '../../../core/model'
import { ResourceCompletionService } from './resource-completion.service'

type CompletionStyle = 'space' | 'dot'
type CompletionMode = 'action' | 'marker'

type CompletionContext =
  | { active: false }
  | {
    active: true
    mode: CompletionMode
    head: string
    raw: string
    normalized: string
    style: CompletionStyle
  }

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent extends hypercomb implements AfterViewInit, OnDestroy {

  @ViewChild('input', { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  private readonly opfs = inject(OpfsStore)
  private readonly resources = inject(ResourceCompletionService)

  private initState: InitState = 'locked'
  private static readonly INIT_LINE = '# Press Enter to open the Portal'

  private readonly value = signal('')
  private readonly activeIndex = signal(0)
  private readonly suppressed = signal(false)

  private readonly markerVerbs = new Set<string>(['add', 'tag', 'mark', 'attach'])

  // -------------------------------------------------
  // completion context
  // - if there is a #, we complete the marker segment (after the last #)
  // - otherwise, we complete the command itself
  // -------------------------------------------------

  private readonly context = computed<CompletionContext>(() => {
    const v = this.value()
    const lastHash = v.lastIndexOf('#')

    // marker mode (last # wins)
    if (lastHash !== -1) {
      const after = v.slice(lastHash + 1)
      const leadingWs = after.match(/^\s*/)?.[0] ?? ''
      const raw = after.slice(leadingWs.length)

      return {
        active: true,
        mode: 'marker',
        head: v.slice(0, lastHash + 1) + leadingWs,
        raw,
        normalized: this.normalize(raw),
        style: raw.includes('.') ? 'dot' : 'space'
      }
    }

    // action mode (only when the user has started typing)
    if (!v.trim()) return { active: false }

    return {
      active: true,
      mode: 'action',
      head: '',
      raw: v,
      normalized: this.normalize(v),
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

    const all = this.resources.names()
    if (!ctx.normalized) return all

    return all.filter(n => n.startsWith(ctx.normalized))
  })

  public readonly showCompletions = computed<boolean>(() => {
    return this.suggestions().length > 0
  })

  // -------------------------------------------------
  // ghost mirror
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

    const rendered = this.render(best, ctx.style)
    const prefix = this.render(ctx.normalized, ctx.style)

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
    if (this.opfs.actionsReady()) {
      this.initState = 'unlocked'
    }

    this.input.nativeElement.focus()
    this.syncSignalsFromDom()
    this.updatePlaceholder()
  }

  public ngOnDestroy(): void { }

  // -------------------------------------------------
  // template-required helpers
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

    // portal gate
    if (!this.opfs.actionsReady()) {
      e.preventDefault()

      if (this.initState === 'locked' && this.isHashKey(e)) {
        this.initState = 'armed'
        this.input.nativeElement.value = SearchBarComponent.INIT_LINE
        this.input.nativeElement.classList.add('armed')
        this.placeCaretAtEnd()
        this.syncSignalsFromDom()
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
        return
      }

      return
    }

    // actions ready
    if (this.initState !== 'unlocked') {
      this.initState = 'unlocked'
      this.clear()
    }

    if (this.handleCompletionKeys(e)) return

    if (e.key === 'Enter') {
      e.preventDefault()
      void this.commit()
    }
  }

  // -------------------------------------------------
  // commit
  // -------------------------------------------------

  private readonly commit = async (): Promise<void> => {
    const raw = this.input.nativeElement.value.trim()
    if (!raw) return

    const firstHash = raw.indexOf('#')

    // no marker → just act
    if (firstHash === -1) {
      await this.act(raw)
      this.clear()
      return
    }

    // single marker: cmd#marker
    const cmd = raw.slice(0, firstHash).trim()
    const markerRaw = raw.slice(firstHash + 1).trim()

    if (cmd) {
      await this.act(cmd)
    }

    const marker = this.normalize(markerRaw)
    
    if (marker) {
      try {
        await this.opfs.attach(marker)
      } catch { }
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

    return false
  }

  private readonly acceptCompletion = (forced?: string): void => {
    const ctx = this.context()
    if (!ctx.active) return

    const list = this.suggestions()
    const best = forced ?? list[this.activeIndex()] ?? list[0]
    if (!best) return

    const rendered = this.render(best, ctx.style)

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
    this.activeIndex.update(v => Math.max(0, Math.min(v, max)))
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
    queueMicrotask(() => el.setSelectionRange(el.value.length, el.value.length))
  }

  private readonly isHashKey = (e: KeyboardEvent): boolean => {
    return e.key === '#' || e.key === '＃' || (e.shiftKey && (e.key === '3' || e.code === 'Digit3'))
  }

  private readonly syncSignalsFromDom = (): void => {
    this.value.set(this.input.nativeElement.value)
  }

  // -------------------------------------------------
  // utils
  // -------------------------------------------------

  private readonly normalize = (s: string): string =>
    s.replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

  private readonly render = (s: string, style: CompletionStyle): string =>
    style === 'dot' ? s.replace(/\s+/g, '.') : s
}
