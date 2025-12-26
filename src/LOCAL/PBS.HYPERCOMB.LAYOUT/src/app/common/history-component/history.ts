// src/app/history-component/history.ts

import { Component } from '@angular/core'
import { hypercomb } from '@hypercomb/core'


@Component({
  selector: 'hc-history',
  styleUrls: ['./history.scss'],
  templateUrl: './history.html'
})
export class HistoryComponent extends hypercomb {
  public readonly length = (): number => window.history.length
  public readonly current = (): number => ((window.history.state as any)?.i ?? 0)
  public back(): void { window.history.back() }
  public forward(): void { window.history.forward() }
}
