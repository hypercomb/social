import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core'
import { HistoryService, HistoryState } from '../history-service'

@Component({
  selector: 'app-history',
  templateUrl: './history.html',
  styleUrls: ['./history.scss']
})
export class HistoryComponent implements OnInit, OnDestroy {
  // services
  private readonly history = inject(HistoryService)

  // expose service signals for template
  historyStack = this.history.historyStack
  count = this.history.count

  // local pool of unique ids managed by the component (stack semantics: push/pop)
  private readonly idPool = signal<string[]>([])

  // simple id generator; replace with crypto.randomUUID() if you want
  private generateIds = (n: number): string[] =>
    Array.from({ length: n }, () => Math.random().toString(36).slice(2, 10))

  // lifecycle
  ngOnInit(): void {
    // seed a pool of ids to consume when adding new states
    this.idPool.set(this.generateIds(64))
    // listen for browser back/forward
    window.addEventListener('popstate', this.history.handlePop)
  }

  ngOnDestroy(): void {
    window.removeEventListener('popstate', this.history.handlePop)
  }

  // helpers
  private takeId = (): string => {
    const pool = this.idPool()
    if (pool.length === 0) {
      // regenerate if exhausted
      this.idPool.set(this.generateIds(32))
      return this.takeId()
    }
    const next = pool[pool.length - 1]
    this.idPool.update(p => p.slice(0, -1))
    return next
  }

  private returnId = (id: string): void => {
    // when removing (going back), push the id back for reuse
    this.idPool.update(p => [...p, id])
  }

  // ui actions
  public addState = (): void => {
    const state: HistoryState = {
      hiveId: this.takeId(),
      title: `state ${this.count() + 1}`,
      data: `this is state #${this.count() + 1}`
    }
    this.history.addState(state)
  }

  public replaceState = (): void => {
    const last = this.historyStack().at(-1)
    if (!last) return
    const state: HistoryState = {
      hiveId: last.hiveId, // keep same id on replace
      title: `replaced ${this.count()}`,
      data: `this replaced state #${this.count()}`
    }
    this.history.replaceState(state)
  }

  public removeLast = (): void => {
    const last = this.historyStack().at(-1)
    if (!last) return
    // pre-capture the id so we can return it to the pool
    this.returnId(last.hiveId)
    this.history.goBack()
  }
}
