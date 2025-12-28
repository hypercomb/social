// src/app/common/header/search-bar/search-bar.component.ts
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core'
import { hypercomb } from '@hypercomb/core'
import { InitState } from '../../../core/model'

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent extends hypercomb implements AfterViewInit, OnDestroy {

  @ViewChild('input', { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  // todo: replace with manifest/registry lookup
  public hasActions = false

  private initState: InitState = 'locked'

  private static readonly INIT_LINE = '# Press Enter to open the Portal'

  private readonly onActionsAvailable = (_e: Event): void => {
    // when at least one action exists, unlock normal behavior
    this.hasActions = true
    this.initState = 'unlocked'
    this.clear()
  }

  public ngAfterViewInit(): void {
    // if actions exist, skip the init gate
    if (this.hasActions) this.initState = 'unlocked'

    window.addEventListener('actions:available', this.onActionsAvailable)

    this.input.nativeElement.focus()
    this.updatePlaceholder()
  }

  public ngOnDestroy(): void {
    window.removeEventListener('actions:available', this.onActionsAvailable)
  }

  public onKeyDown = (e: KeyboardEvent): void => {

    // normal mode: let typing happen, but use '#' to start intellisense
    if (this.initState === 'unlocked') {
      if (this.isHashKey(e)) {
        // allow the '#' to appear in the input
        queueMicrotask(() => window.dispatchEvent(new CustomEvent('intellisense:start')))
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        this.commit().catch(console.error)
      }

      return
    }

    // init mode: lock input
    e.preventDefault()

    // locked → only '#'
    if (this.initState === 'locked') {
      if (this.isHashKey(e)) {
        this.initState = 'armed'
        this.input.nativeElement.value = SearchBarComponent.INIT_LINE
        this.input.nativeElement.classList.add('armed')
        this.updatePlaceholder()
        this.placeCaretAtEnd()
      }
      return
    }

    // armed → only enter / backspace / delete
    if (this.initState === 'armed') {
      if (e.key === 'Enter') {
        this.openPortal()
        return
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.resetInit()
        return
      }

      // keep the caret locked at the end
      this.placeCaretAtEnd()
    }
  }

  private commit = async (): Promise<void> => {
    const v = this.input.nativeElement.value.trim()
    if (!v) return

    await this.act(v)
    this.input.nativeElement.value = ''
  }

  private openPortal(): void {
    // do not unlock here. we stay gated until actions:available fires.
    window.dispatchEvent(new CustomEvent('portal:open'))

    // return to the locked start state so the gate remains active
    this.resetInit()
  }

  private resetInit(): void {
    this.initState = 'locked'
    this.clear()
  }

  private clear(): void {
    this.input.nativeElement.value = ''
    this.input.nativeElement.classList.remove('armed')
    this.updatePlaceholder()
  }

  private updatePlaceholder(): void {
    // placeholder only shows when value is empty (locked state)
    this.input.nativeElement.placeholder = 'Type # and press Enter to open the Portal'
  }

  private placeCaretAtEnd(): void {
    const el = this.input.nativeElement
    const n = el.value.length
    queueMicrotask(() => el.setSelectionRange(n, n))
  }

  private isHashKey(e: KeyboardEvent): boolean {
    // direct cases
    if (e.key === '#' || e.key === '＃') return true

    // common physical key combo where keydown can report '3' + shift
    if (e.shiftKey && (e.key === '3' || e.code === 'Digit3')) return true

    return false
  }
}
