// link/deadline.ts
// Every network read in the drop path answers by a deadline, or not at all.

/**
 * A request that HANGS is worse than one that fails: a failure has a `catch`
 * and the gesture carries on, while a stall leaves the whole drop parked
 * forever — no title, no picture, and no tile. Browsers stall these requests
 * routinely (tracking protection, a blackholed host, a captive network), and
 * `fetch` has no timeout of its own.
 *
 * Resolves with `fallback` when the deadline passes, and aborts the request so
 * nothing keeps running behind a gesture that has already moved on.
 */
export async function byDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const expiry = new Promise<T>(resolve => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(fallback)
    }, ms)
  })

  try {
    return await Promise.race([
      run(controller.signal).catch(() => fallback),
      expiry,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** How long a dropped link may spend looking up what it is. */
export const CARD_DEADLINE_MS = 3_500
/** How long its picture may take to arrive. */
export const PICTURE_DEADLINE_MS = 5_000
/** How long the safety verdict may take before the drop proceeds without it. */
export const SAFETY_DEADLINE_MS = 5_000
