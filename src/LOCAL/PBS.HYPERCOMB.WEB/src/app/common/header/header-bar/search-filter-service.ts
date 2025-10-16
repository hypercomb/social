import { computed, Injectable, signal } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class SearchFilterService {
  private readonly _searchValue = signal<string>('')

  public readonly value = this._searchValue.asReadonly()
  public readonly hasValue = computed(() => this._searchValue().trim().length > 0)

  public clear() {
    this._searchValue.set('')
  }

  public refresh() {
    // re-emit the same value (forces dependent computeds/effects to re-run)
    this._searchValue.update(v => v)
  }

  public set(value: string) {
    this._searchValue.set(value)
  }
}


