// src/app/core/substrate/active-item.service.ts

import { Injectable, computed, signal } from '@angular/core'
import { EdgeStore } from './edge-store.service'

@Injectable({ providedIn: 'root' })
export class ActiveItem {

  private readonly _active = signal<string | undefined>(undefined)
  public readonly active = this._active.asReadonly()

  constructor(private readonly edges: EdgeStore) {
    computed(() => {
      const list = [...this.edges.edges()]
      // deterministic collapse: first sorted edge
      this._active.set(list.length ? list.sort()[0] : undefined)
    })
  }
}
