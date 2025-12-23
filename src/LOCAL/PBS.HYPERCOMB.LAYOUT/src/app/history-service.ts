import { Injectable, signal, computed, inject } from '@angular/core'
import { Router } from '@angular/router'

export interface HistoryState {
  hiveId: string
  title: string
  data?: string
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly router = inject(Router)

  private readonly _stack = signal<HistoryState[]>([])
  public readonly historyStack = this._stack.asReadonly()
  public readonly count = computed(() => this._stack().length)

  private replaceLast = (next: HistoryState): void => {
    this._stack.update(s => {
      if (!s.length) return s
      const copy = [...s]
      copy[copy.length - 1] = next
      return copy
    })
  }

  public addState = async (state: HistoryState): Promise<void> => {
    await this.router.navigateByUrl(`/hypercomb/${state.hiveId}`)
    this._stack.update(s => [...s, state])
  }

  public replaceState = async (state: HistoryState): Promise<void> => {
    await this.router.navigateByUrl(
      `/hypercomb/${state.hiveId}`,
      { replaceUrl: true }
    )
    this.replaceLast(state)
  }

  public goBack = (): void => {
    window.history.back()
  }
}
