// hypercomb-essentials/src/diamondcoreprocessor.com/core/history-recorder.drone.ts
// Central history recorder: listens for seed lifecycle effects (seed:added,
// seed:removed) via the EffectBus and records each operation into the
// append-only OPFS history bag for the current lineage location.

import { EffectBus } from '@hypercomb/core'
import type { HistoryService, HistoryOpType } from './history.service.js'

export class HistoryRecorder {

  constructor() {
    EffectBus.on<{ seed: string }>('seed:added', (payload) => {
      if (payload?.seed) void this.recordOp('add', payload.seed)
    })

    EffectBus.on<{ seed: string }>('seed:removed', (payload) => {
      if (payload?.seed) void this.recordOp('remove', payload.seed)
    })
  }

  private readonly recordOp = async (op: HistoryOpType, seed: string): Promise<void> => {
    const lineage = get<any>('@hypercomb.social/Lineage')
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !historyService) return

    const sig = await historyService.sign(lineage)
    await historyService.record(sig, { op, seed, at: Date.now() })
  }
}

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
