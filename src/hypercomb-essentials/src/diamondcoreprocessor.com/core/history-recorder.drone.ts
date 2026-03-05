// hypercomb-essentials/src/diamondcoreprocessor.com/core/history-recorder.drone.ts
// Central history recorder: listens on `synchronize` window events for mutations
// that carry a `historyOp` field, and records each operation into the append-only
// OPFS history bag for the current lineage location.
//
// Sits at the processor level alongside ShowHoneycombWorker — history recording is
// a first-class reaction to the canonical mutation event, not a parallel channel.

import type { HistoryService, HistoryOpType } from './history.service.js'

export class HistoryRecorder {

  constructor() {
    window.addEventListener('synchronize', (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.historyOp) return

      // prevent infinite loop: historyService.record() dispatches synchronize
      // with source 'history:record' — we must not re-record that
      if (detail.source === 'history:record') return

      void this.recordOp(detail.historyOp)
    })
  }

  private readonly recordOp = async (historyOp: { op: HistoryOpType, seed: string }): Promise<void> => {
    const lineage = get<any>('@hypercomb.social/Lineage')
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !historyService) return

    const sig = await historyService.sign(lineage)
    await historyService.record(sig, {
      op: historyOp.op,
      seed: historyOp.seed,
      at: Date.now(),
    })
  }
}

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
