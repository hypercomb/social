// bridge-pending.cjs — an op the hive tab never finished is answered, not left.
//
// The broker forwards a client's op to the renderer and remembers who asked in
// `pending` (op id -> { client, via }). When the renderer's socket drops — the
// dev build reloads the tab, Edge freezes it — nothing ever answered those
// ops, and the clients sat on their own timers: a manager's `find` waited
// 75 s for a reply that could not come (harness pass, 2026-10-18). Now each
// client still waiting on a socket that closed is told so at once, and can ask
// again.
//
// Only reads are safe to repeat, so the broker says what happened and leaves
// the choice to the caller.

const DROPPED = 'the hive tab dropped before it answered; ask again'
const OPEN = 1

/** Answer every client still waiting on `socket`, and forget them. Returns how
 *  many were answered. `pending` is the broker's own map. */
function failPendingVia(pending, socket) {
  let failed = 0
  for (const [id, entry] of [...pending]) {
    if (entry.via !== socket) continue
    pending.delete(id)
    try {
      if (entry.client && entry.client.readyState === OPEN) entry.client.send(JSON.stringify({ id, ok: false, error: DROPPED }))
    } catch { /* the asker went too */ }
    failed++
  }
  return failed
}

module.exports = { failPendingVia, DROPPED }
