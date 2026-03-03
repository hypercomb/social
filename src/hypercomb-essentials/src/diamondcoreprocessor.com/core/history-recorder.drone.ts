// hypercomb-essentials/src/diamondcoreprocessor.com/core/history-recorder.drone.ts
// Central history recorder: listens on the EffectBus for `history:op` effects
// and records each operation into the append-only OPFS history bag for the
// current lineage location.
//
// Any drone or UI component can emit `history:op` with a HistoryEffectPayload
// instead of calling HistoryService directly. This decouples producers from the
// persistence mechanism.

import { EffectBus } from '@hypercomb/core'
import type { HistoryService, HistoryEffectPayload } from './history.service.js'

export class HistoryRecorder {

  private readonly processed = new Set<string>()

  constructor() {
    EffectBus.on<HistoryEffectPayload>('history:op', (payload) => {
      if (!payload?.id || !payload?.op || !payload?.seed) return

      // deduplicate: EffectBus replays last value on subscribe
      if (this.processed.has(payload.id)) return
      this.processed.add(payload.id)

      void this.recordOp(payload)
    })
  }

  private readonly recordOp = async (payload: HistoryEffectPayload): Promise<void> => {
    const lineage = get<any>('@hypercomb.social/Lineage')
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !historyService) return

    const sig = await historyService.sign(lineage)
    await historyService.record(sig, {
      op: payload.op,
      seed: payload.seed,
      at: Date.now(),
    })
  }
}

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
