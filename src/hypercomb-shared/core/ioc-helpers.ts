// hypercomb-shared/core/ioc-helpers.ts
//
// Shared helpers for IoC consumers that need to handle the "drone might
// not be in IoC yet" case without silently no-opping.
//
// Background: ~45 call sites across the codebase do `ioc.get(key)?.method?.(...)`.
// When the key is missing — late registration, post-eviction, post-resync —
// the optional chain succeeds and nothing happens, nothing logs. That's
// indistinguishable from "the drone said no" and is the dominant source of
// "drones don't load / late / stop" reports. `getOrWait` makes the absent
// case explicit (returns null) and lets callers either wait or branch on it.

/**
 * Resolve an IoC entry, waiting up to `timeoutMs` for late registration.
 *
 * - If the key is already in IoC, returns the current value synchronously
 *   (still wrapped in a Promise for ergonomics).
 * - Otherwise, awaits `ioc.whenReady(key)` up to the timeout.
 * - Returns `null` on timeout — never throws, never hangs forever.
 *
 * Use this in async paths (drone heartbeat, queen handlers, async UI flows)
 * where it's correct to block on the drone becoming available. For sync paths
 * (Angular click handlers, etc.), use `ioc.get` + an explicit branch instead.
 */
export function getOrWait<T>(key: string, timeoutMs = 5000): Promise<T | null> {
  const ioc = window.ioc
  if (!ioc) return Promise.resolve(null)

  const cached = ioc.get<T>(key)
  if (cached !== undefined) return Promise.resolve(cached as T)

  return new Promise<T | null>(resolve => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      console.warn(`[ioc-helpers] getOrWait("${key}") timed out after ${timeoutMs}ms`)
      resolve(null)
    }, timeoutMs)

    // ioc.whenReady fires the callback once the key registers. If the
    // timeout fires first, our `done` flag makes the late callback a no-op.
    ioc.whenReady<T>(key, (value: T) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    })
  })
}
