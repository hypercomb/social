// src/app/common/header/search-bar/search-bar.component.ts

import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core'
import { hypercomb } from '@hypercomb/core'
import { OpfsStore } from '../../../core/opfs.store'
import { InitState } from '../../../core/model'

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

  private initState: InitState = 'locked'

  private static readonly INIT_LINE = '# Press Enter to open the Portal'

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public ngAfterViewInit(): void {
    if (this.opfs.actionsReady()) {
      this.initState = 'unlocked'
    }

    this.input.nativeElement.focus()
    this.updatePlaceholder()
  }

  public ngOnDestroy(): void {}

  // -------------------------------------------------
  // input handling
  // -------------------------------------------------

  public onKeyDown = (e: KeyboardEvent): void => {

    // -------------------------------------------------
    // actions exist → always allow typing
    // -------------------------------------------------

    if (this.opfs.actionsReady()) {
      if (this.initState !== 'unlocked') {
        this.initState = 'unlocked'
        this.clear()
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        void this.commit()
      }

      return
    }

    // -------------------------------------------------
    // no actions → portal gate
    // -------------------------------------------------

    e.preventDefault()

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
    }
  }

  // -------------------------------------------------
  // commit
  // -------------------------------------------------

  private commit = async (): Promise<void> => {
    const v = this.input.nativeElement.value.trim()
    if (!v) return

    await this.act(v)
    this.input.nativeElement.value = ''
  }

  // -------------------------------------------------
  // ui helpers
  // -------------------------------------------------

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
    this.input.nativeElement.placeholder =
      this.opfs.actionsReady()
        ? 'Type a command…'
        : 'Type # and press Enter to open the Portal'
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
