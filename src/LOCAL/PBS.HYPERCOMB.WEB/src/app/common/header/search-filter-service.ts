import { computed, Injectable, signal } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class SearchFilterService {
  private readonly _value = signal<string>('')

  // delayed version
  private readonly _delay = signal<string>('')
  private delayHandle: any = null

  public readonly value = this._value.asReadonly()
  public readonly delayValue = this._delay.asReadonly()

  public set(text: string) {
    const v = text.toLowerCase()

    // immediate update for tiles
    this._value.set(v)

    // delayed update for menus
    clearTimeout(this.delayHandle)
    this.delayHandle = setTimeout(() => {
      this._delay.set(v)
    }, 125)  // ← ideal delay for your UI
  }

  public clear() {
    this.set('')
  }
}
