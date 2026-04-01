// diamondcoreprocessor.com/core/history-recorder.drone.ts
import { EffectBus, hypercomb } from '@hypercomb/core'
import type { HistoryService, HistoryOpType } from './history.service.js'
import type { HistoryCursorService } from './history-cursor.service.js'

export class HistoryRecorder {

  #queue: Promise<void> = Promise.resolve()

  constructor() {
    EffectBus.on<{ cell: string }>('cell:added', (payload) => {
      if (payload?.cell) this.#enqueue('add', payload.cell)
    })

    EffectBus.on<{ cell: string; groupId?: string }>('cell:removed', (payload) => {
      if (payload?.cell) this.#enqueue('remove', payload.cell, payload.groupId)
    })
  }

  #enqueue(op: HistoryOpType, cell: string, groupId?: string): void {
    this.#queue = this.#queue
      .then(() => this.#recordOp(op, cell, groupId))
      .then(() => void new hypercomb().act())
      .catch(() => { })
  }

  async #recordOp(op: HistoryOpType, cell: string, groupId?: string): Promise<void> {
    const lineage = get<any>('@hypercomb.social/Lineage')
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !historyService) return

    const sig = await historyService.sign(lineage)
    await historyService.record(sig, { op, cell, at: Date.now(), groupId })

    // Notify cursor service so slider stays in sync
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor) await cursor.onNewOp()
  }
}

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
