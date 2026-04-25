// diamondcoreprocessor.com/history/history-recorder.drone.ts
//
// Side-effect imports trigger HistoryService and HistoryCursorService
// self-registration. Every other import in the codebase is `import
// type { ... }`, which TypeScript erases — without these bare imports
// the services never run their `window.ioc.register(...)` calls.
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
// This drone is kept as a side-effect anchor only.
import './history.service.js'
import './history-cursor.service.js'

export class HistoryRecorder {
  // No subscriptions, no writes. The bag's per-event timeline is the
  // marker series the committer mints; nothing else writes here.
}

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
