// sharing/publish-lane.ts
//
// ONE PUBLISH AT A TIME, WHATEVER STARTED IT. Every act in publish-branch.ts
// that publishes or re-signs this hive's index — publish, withdraw, doors, an
// own address, an entrance, secure delete — runs in this one lane, one after
// another: the Publish panel's press, its picked apps, a publish group from
// the strip, the `publish` and `host` words alike.
//
// Why one lane and not the index write's own (hive-pointer.ts inWriteLane):
// that lane is per HOST NAME and covers only the final signed write. A
// publish does more around it — it advances the local stage lists
// (stage-succession.ts advanceStage, an unlocked read-modify-write), and two
// zone names that front one index are two write lanes. Two publishes side by
// side could drop a stage member, or seal one branch twice and race its own
// index write. A panel press and a strip group publish did exactly that until
// this lane (found by review, 2026-10-24).
//
// Pinned on globalThis like the write lanes, so a module loaded twice (dev
// imports beside the runtime bundle) still has ONE lane. An act never calls
// another queued act from inside the lane — that would wait on itself; the
// acts call each other's unqueued bodies (publish-branch.ts `…Now`).

interface Lane { tail: Promise<void>; waiting: number }

const lane: Lane = ((globalThis as { __hypercombPublishLane?: Lane }).__hypercombPublishLane ??= {
  tail: Promise.resolve(),
  waiting: 0,
})

/** Run `act` after every act already in the lane. `onQueued` is told, once,
 *  when it has to wait — so a caller can say "waiting for another publish"
 *  rather than look stuck. A failed act never stops the ones after it. */
export function inPublishLane<T>(act: () => Promise<T>, onQueued?: () => void): Promise<T> {
  if (lane.waiting > 0) {
    try { onQueued?.() } catch { /* the caller's problem */ }
  }
  lane.waiting++
  const run = lane.tail.then(act)
  lane.tail = run.then(() => undefined, () => undefined).finally(() => { lane.waiting-- })
  return run
}

/** How many acts are in the lane, running or waiting. */
export const publishLaneLength = (): number => lane.waiting
