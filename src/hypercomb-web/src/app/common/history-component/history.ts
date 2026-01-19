// src/app/common/history-component/history.ts

import { Component, inject } from '@angular/core'
import { Navigation } from '../../core/navigation'

@Component({
  selector: 'hc-history',
  styleUrls: ['./history.scss'],
  templateUrl: './history.html'
})
export class HistoryComponent {
  private readonly navigation = inject(Navigation)

  public readonly length = (): number => window.history.length
  public readonly current = (): number => ((window.history.state as any)?.i ?? 0)

  public readonly path = (): string =>
    window.location.pathname || '/'

  public readonly depth = (): number =>
    this.navigation.segments().length

  public readonly active = (): string =>
    this.navigation.segments().slice(-1)[0] ?? ''

  public back(): void { window.history.back() }
  public forward(): void { window.history.forward() }
}
