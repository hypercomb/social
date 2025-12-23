import { Component, OnInit, inject, signal } from '@angular/core'
import { HistoryService, HistoryState } from '../history-service'

@Component({
  selector: 'app-history',
  templateUrl: './history.html'
})
export class HistoryComponent implements OnInit {
  private readonly history = inject(HistoryService)

  historyStack = this.history.historyStack
  count = this.history.count

  private readonly idPool = signal<string[]>([])

  private generateIds = (n: number): string[] =>
    Array.from({ length: n }, () =>
      Math.random().toString(36).slice(2, 10)
    )

  ngOnInit(): void {
    this.idPool.set(this.generateIds(64))
  }

  private takeId = (): string => {
    const pool = this.idPool()
    if (!pool.length) {
      this.idPool.set(this.generateIds(32))
      return this.takeId()
    }
    const id = pool[pool.length - 1]
    this.idPool.update(p => p.slice(0, -1))
    return id
  }

  public addState = async (): Promise<void> => {
    const state: HistoryState = {
      hiveId: this.takeId(),
      title: `state ${this.count() + 1}`,
      data: `state ${this.count() + 1}`
    }
    await this.history.addState(state)
  }

  public replaceState = async (): Promise<void> => {
    const last = this.historyStack().at(-1)
    if (!last) return
    const state: HistoryState = {
      hiveId: last.hiveId,
      title: `replaced ${this.count()}`,
      data: `replaced ${this.count()}`
    }
    await this.history.replaceState(state)
  }

  public removeLast = (): void => {
    this.history.goBack()
  }
}
