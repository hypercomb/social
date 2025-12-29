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

  // todo: replace with action registry / manifest lookup
  private hasActions = false

  private initState: InitState = 'locked'

  private static readonly INIT_LINE = '# Press Enter to open the Portal'

  private readonly onActionsAvailable = (): void => {
    // once at least one action exists, normal behavior starts
    this.hasActions = true
    this.initState = 'unlocked'
    this.clear()
  }

  public ngAfterViewInit(): void {
    if (this.hasActions) this.initState = 'unlocked'

    window.addEventListener('actions:available', this.onActionsAvailable)

    this.input.nativeElement.focus()
    this.updatePlaceholder()
  }

  public ngOnDestroy(): void {
    window.removeEventListener('actions:available', this.onActionsAvailable)
  }

  public onKeyDown = (e: KeyboardEvent): void => {

    // unlocked → normal behavior (future: hash triggers intellisense)
    if (this.initState === 'unlocked') {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.commit().catch(console.error)
      }

      // todo: if (this.isHashKey(e)) { start intellisense }
      return
    }

    // locked/armed gate: prevent all typing
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
        window.dispatchEvent(new CustomEvent('portal:open'))
        this.resetInit()
        return
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.resetInit()
        return
      }

      // keep caret pinned at the end
      this.placeCaretAtEnd()
    }
  }

  private commit = async (): Promise<void> => {
    const v = this.input.nativeElement.value.trim()
    if (!v) return

    await this.act(v)
    this.input.nativeElement.value = ''
  }

  private resetInit = (): void => {
    this.initState = 'locked'
    this.clear()
  }

  private clear = (): void => {
    this.input.nativeElement.value = ''
    this.input.nativeElement.classList.remove('armed')
    this.updatePlaceholder()
  }

  private updatePlaceholder = (): void => {
    // placeholder is only visible when value is empty
    this.input.nativeElement.placeholder = 'Type # and press Enter to open the Portal'
  }

  private placeCaretAtEnd = (): void => {
    const el = this.input.nativeElement
    const n = el.value.length
    queueMicrotask(() => el.setSelectionRange(n, n))
  }

  private isHashKey = (e: KeyboardEvent): boolean => {
    if (e.key === '#' || e.key === '＃') return true
    if (e.shiftKey && (e.key === '3' || e.code === 'Digit3')) return true
    return false
  }
}
