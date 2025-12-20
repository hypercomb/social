import { Injectable, signal } from '@angular/core'
import { FindContentResult } from './find-content.model'

@Injectable({ providedIn: 'root' })
export class FindContentState {
  public readonly last = signal<FindContentResult | null>(null)
}
