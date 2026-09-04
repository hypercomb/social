import { EffectBus } from '@hypercomb/core'

// The renderer owns startup. Every background behaviour — the whole installed
// behaviour graph in dev, the per-segment bee walk in web, the Claude bridge
// among them — waits behind the first SETTLED tile frame for the location
// being restored, so a cold OPFS walk cannot steal the main thread from first
// paint.
//
// That barrier is a promise NOTHING ELSE RESOLVES. If the matching frame never
// arrives, background work never starts, for the life of the page, with no
// error and no sign that anything is waiting. Observed 2026-09-04: the boot
// log read `dev render-first bees pulsed (3)` and then nothing — the bridge
// never dialled, and it looked like a broker fault for an hour.
//
// A barrier that can hang is worse than a barrier that opens early: the cost
// of opening early is a slower first paint, and the cost of hanging is every
// background behaviour silently dead. So this one always opens. Two ways it
// can fail, two guards:
//
//   1. THE FRAME NEVER COMES — wrong locationKey, a render pass that faulted,
//      a settled verdict emitted before we subscribed on a bus we don't share.
//      Guarded by a give-up valve. NOT a wall clock: a cold profile can take
//      seconds to paint and deserves the wait. It gives up on SILENCE — any
//      `render:cell-count`, for any location, is proof the renderer is alive
//      and still working, and re-arms it. A hard ceiling bounds the case where
//      the renderer keeps talking about somewhere else forever, so the promise
//      settles within a known time no matter what the page does.
//
//   2. THE FRAME COMES AND THE HANDOFF NEVER RUNS — the release is deferred to
//      the next animation frame so the renderer's buffer push completes before
//      bee pulses begin, and a HIDDEN TAB NEVER RUNS AN ANIMATION FRAME.
//      Browsers do not service requestAnimationFrame for a backgrounded page,
//      so a boot that happens off-screen would wait on a frame that is not
//      coming. Guarded by a short timer racing the frame: in a visible tab the
//      frame wins by ~16ms and behaviour is exactly as before.

/** Renderer silence, in ms, after which the barrier stops waiting. */
export const FIRST_TILE_PAINT_SILENCE_MS = 10_000

/** Absolute bound on the barrier, in ms, however noisy the renderer is. */
export const FIRST_TILE_PAINT_CEILING_MS = 60_000

/** How long the settled frame's handoff may wait for an animation frame. */
export const FIRST_TILE_PAINT_FRAME_MS = 250

export interface FirstTilePaintOptions {
  silenceMs?: number
  ceilingMs?: number
  frameMs?: number
}

/**
 * Resolves when the renderer publishes its final geometry/empty verdict for
 * `targetLocationKey` — or, failing that, when waiting any longer would just
 * be a hang. Never rejects, and never fails to settle.
 */
export const awaitFirstTilePaint = (
  targetLocationKey: string,
  options: FirstTilePaintOptions = {},
): Promise<void> => new Promise<void>(resolve => {
  const silenceMs = options.silenceMs ?? FIRST_TILE_PAINT_SILENCE_MS
  const ceilingMs = options.ceilingMs ?? FIRST_TILE_PAINT_CEILING_MS
  const frameMs = options.frameMs ?? FIRST_TILE_PAINT_FRAME_MS
  const startedAt = Date.now()

  let off: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let released = false
  let settling = false

  const drop = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    try { off?.() } catch { /* already released */ }
    off = undefined
  }

  const release = (): void => {
    if (released) return
    released = true
    drop()
    resolve()
  }

  const giveUp = (): void => {
    if (released || settling) return
    console.warn(
      `[hypercomb] first tile paint never settled for "${targetLocationKey}" ` +
      `after ${Date.now() - startedAt}ms — starting background behaviours anyway`,
    )
    release()
  }

  const arm = (): void => {
    if (released || settling) return
    if (timer !== undefined) clearTimeout(timer)
    const left = Math.max(0, ceilingMs - (Date.now() - startedAt))
    timer = setTimeout(giveUp, Math.min(silenceMs, left))
  }

  const settle = (): void => {
    if (released || settling) return
    settling = true
    drop()
    // Let the renderer's buffer push complete before bee pulses begin. The
    // timer is the backstop for a hidden tab, where no frame ever arrives.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => release())
      setTimeout(release, frameMs)
    } else {
      queueMicrotask(release)
    }
  }

  const maybeOff = EffectBus.on<{ settled?: boolean; locationKey?: string }>('render:cell-count', payload => {
    // Proof of life first: the renderer spoke, so it is working, whatever it
    // said and wherever it said it about.
    arm()
    // Only the renderer's final geometry/empty verdict for the location we are
    // actually restoring releases background work. Earlier cell-count
    // notifications intentionally omit `settled`; accepting undefined here
    // released the OPFS-wide script-preloader walk while the current layer was
    // still resolving and starved first paint.
    if (payload?.settled !== true || payload?.locationKey !== targetLocationKey) return
    settle()
  })

  // EffectBus replays the last value INSIDE `on`, so the handler may already
  // have run — before `off` existed to be called.
  off = typeof maybeOff === 'function' ? maybeOff : undefined
  if (released || settling) drop()
  else arm()
})
