import { Injectable, signal, computed } from '@angular/core'

export interface HistoryState {
  hiveId: string
  title: string
  data?: string
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  // single source of truth (readonly exposed below)
  private readonly _stack = signal<HistoryState[]>([])

  // expose readonly signal so components can subscribe without mutating
  public readonly historyStack = this._stack.asReadonly()

  // computed count derived from stack
  public readonly count = computed(() => this._stack().length)

  // helper: replace the last entry in the stack
  private replaceLast = (next: HistoryState): void => {
    this._stack.update(s => {
      if (s.length === 0) return s
      const copy = [...s]
      copy[copy.length - 1] = next
      return copy
    })
  }

  // add: push a new state (no url argument)
  public addState = (state: HistoryState): void => {
    window.history.pushState(state, state.title)
    this._stack.update(s => [...s, state])
    console.log('pushed state:', state)
  }

  // replace: overwrite current entry (no url argument)
  public replaceState = (state: HistoryState): void => {
    window.history.replaceState(state, state.title)
    this.replaceLast(state)
    console.log('replaced state:', state)
  }

  // remove-most-recent by navigating back; popstate will sync stack
  public goBack = (): void => {
    window.history.back()
    // do not mutate _stack here; handlePop will sync on popstate
  }

  // wire this once from the component
  public handlePop = (event: PopStateEvent): void => {
    // if the target entry has a state with hiveId, trim our stack to it
    const targetId = event.state?.hiveId as string | undefined
    if (targetId) {
      const idx = this._stack().findIndex(s => s.hiveId === targetId)
      if (idx >= 0) {
        this._stack.update(s => s.slice(0, idx + 1))
      }
    } else {
      // no associated state; leave stack as-is (nothing to sync)
      // if you prefer, you could clear: this._stack.set([])
    }
    console.log('synced stack from popstate:', this._stack())
  }
}
