// history/history-recorder.drone.ts
//
// It owns the order projection (atomic-modules-plan.md). The history service
// and its cursor are registered by history.boot.drone.ts, in the boot lane.
//
// Historically this drone wrote a parallel "ops log" via
// `historyService.record()` on every cell lifecycle / tag / layout
// event. That log is no longer read by anything (cursor reads the
// layer markers; renderer reads the cell directories), and its writes
// raced with the layer-committer's marker writes — both allocated
// numeric NNNNNNNN filenames in the same bag, the recorder's later
// write overwriting the committer's marker → marker silently became
// op-JSON content → listLayers' marker filter dropped it → "the add
// doesn't add a record." All `historyService.record()` calls are
// removed. The committer (layer-committer.drone) is now the sole
// writer in the bag's numeric namespace.
//
import { OrderProjection } from './order-projection.js'

export class HistoryRecorder {
  // No subscriptions, no writes. The bag's per-event timeline is the
  // marker series the committer mints; nothing else writes here.
}

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register('@diamondcoreprocessor.com/OrderProjection', new OrderProjection())

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
