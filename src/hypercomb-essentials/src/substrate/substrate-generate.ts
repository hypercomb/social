// substrate/substrate-generate.ts
//
// Bridges ComfyUI generation to a custom set's Gen tab. Neither comfy.service
// nor substrate.service knows the other exists — comfy generates pictures,
// substrate manages sets — so this is the one file that connects them, kept
// deliberately thin: it owns no state of its own, just the sequencing.
//
// SEQUENTIAL ON PURPOSE. ComfyUI's own `batch` seam (EmptyLatentImage's
// batch_size) COULD make N images in one queued run, but batch memory scales
// with N — a batch of 19 at 832x960 would multiply the ~5GB an SDXL run
// already takes on an 8GB card and risk an out-of-memory failure partway
// through, losing the whole batch. One `comfyService.run()` call per picture
// costs more wall-clock time (~20-30s each) but each is independently proven
// to fit, and a failure loses one candidate, not nineteen.

import { EffectBus } from '@hypercomb/core'
import { comfyService, type ComfyRunRequest } from '../comfy/comfy.service.js'

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

type SubstrateLike = {
  addCandidate(setId: string, signature: string): Promise<void>
}

const substrate = (): SubstrateLike | undefined =>
  ioc<SubstrateLike>('@diamondcoreprocessor.com/SubstrateService')

/** A count nobody would type on purpose is a mistake, not a request — cap it
 *  rather than queue an hour of GPU time from a stray extra digit. */
const MAX_BATCH = 25

export interface GenerateProgress {
  setId: string
  done: number
  total: number
  state: 'running' | 'done' | 'error'
  message?: string
}

/**
 * Queue `count` ComfyUI generations for `setId`'s Gen tab. Each picture that
 * lands becomes a CANDIDATE (never a member — the participant decides in
 * the Gen tab), via the exact same content-addressed store door `run()`
 * already uses for a single prompt. Returns how many actually landed.
 */
export async function generateSetCandidates(
  setId: string,
  request: ComfyRunRequest,
  count: number,
): Promise<number> {
  const total = Math.max(1, Math.min(Math.trunc(count) || 1, MAX_BATCH))
  const svc = substrate()
  let done = 0

  const emit = (state: GenerateProgress['state'], message?: string): void => {
    EffectBus.emit('substrate:generate-progress', { setId, done, total, state, message } as GenerateProgress)
  }

  emit('running')
  for (let i = 0; i < total; i++) {
    try {
      // No seed passed through — a fixed seed would make every picture in
      // the batch identical. Leaving it unset makes comfyService.run() mint
      // a fresh one per call, which is the whole point of asking for N.
      const results = await comfyService.run({ ...request, seed: undefined, attach: false })
      const result = results[0]
      if (result && svc) await svc.addCandidate(setId, result.largeSig)
    } catch (err) {
      // One failed picture does not abort the batch — the participant asked
      // for up to `total`, not exactly `total`.
      console.warn('[substrate-generate] one candidate failed', err)
    }
    done++
    emit('running')
  }
  emit('done')
  return done
}
