// core/stay-awake.ts
//
// A TURN STAYS AWAKE WITH ITS TAB IN THE BACKGROUND. A browser slows a
// hidden tab down and may freeze it outright: timers fire late, a streamed
// answer stops being read, and a turn that takes seconds takes minutes or
// never ends. Long work runs for hours and nobody watches a tab for hours
// (jwize's drive session, 2026-09-30: with the hive tab behind another one,
// a round sat for 250 seconds; holding a lock, the same rounds took three to
// six seconds each).
//
// A page that holds a Web Lock is one the browser does not freeze, so the
// loop holds one for the length of a turn and lets it go in its `finally`.
// The lock is SHARED: it excludes nothing — two conversations, or two tabs,
// hold it at once — it only says "work is in flight here". Where the Locks
// API is missing the turn runs exactly as it did.

type LocksLike = {
  request(name: string, options: { mode: 'shared' }, held: () => Promise<void>): Promise<unknown>
}

export const AWAKE_LOCK = 'hypercomb:agent-turn'

/** Hold the page awake until the returned function is called. Calling it
 *  twice is harmless. */
export const holdAwake = (
  name: string = AWAKE_LOCK,
  locks: LocksLike | undefined = (globalThis as { navigator?: { locks?: LocksLike } }).navigator?.locks,
): (() => void) => {
  if (!locks?.request) return () => { /* nothing held */ }
  let release: () => void = () => { /* set below */ }
  const held = new Promise<void>(resolve => { release = resolve })
  try {
    void Promise.resolve(locks.request(name, { mode: 'shared' }, () => held)).catch(() => { /* a refused lock costs nothing */ })
  } catch { /* a throwing API costs nothing either */ }
  return () => release()
}
