// diamondcoreprocessor.com/core/history-recorder.drone.ts
import { EffectBus, hypercomb } from '@hypercomb/core'
import type { HistoryService, HistoryOpType } from './history.service.js'

export class HistoryRecorder {

  #queue: Promise<void> = Promise.resolve()

  constructor() {
    EffectBus.on<{ seed: string }>('seed:added', (payload) => {
      if (payload?.seed) this.#enqueue('add', payload.seed)
    })

    EffectBus.on<{ seed: string }>('seed:removed', (payload) => {
      if (payload?.seed) this.#enqueue('remove', payload.seed)
    })
  }

  #enqueue(op: HistoryOpType, seed: string): void {
    this.#queue = this.#queue
      .then(() => this.#recordOp(op, seed))
      .then(() => void new hypercomb().act())
      .catch(() => { })
  }

  async #recordOp(op: HistoryOpType, seed: string): Promise<void> {
    const lineage = get<any>('@hypercomb.social/Lineage')
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !historyService) return

    const sig = await historyService.sign(lineage)
    await historyService.record(sig, { op, seed, at: Date.now() })
  }
}

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
