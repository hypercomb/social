// diamondcoreprocessor.com/presentation/tiles/thumbnail-optimizer.drone.ts
//
// Mints hex thumbnails during the processor's optimize phase — the only
// sanctioned place to write a derived cache (see Bee.optimize and
// documentation/optimize-phase.md).
//
// Demand-driven rather than eager: nothing walks the hive looking for
// pictures to shrink. A reader that wanted a thumbnail and had to fall back
// to full-resolution bytes emits `thumbnail:wanted` with the SOURCE IMAGE
// SIG; this bee queues it and derives on the next idle pass. So the cost is
// paid once per picture actually looked at, never for the rest.
//
// Contract compliance:
//   - keyed by the source image signature — invalidation is automatic
//   - lives in the sign('thumbnails:hex') derived-cache pool
//   - never load-bearing: the cold path renders the full image instead
//   - complete-or-absent: a failed derive writes nothing at all
//   - mints no truth: no layers, no markers, no props

import { Drone } from '@hypercomb/core'
import {
  readThumbnail, writeThumbnail, deriveThumbnail, type ThumbnailStore,
} from './thumbnails.js'

const SIG = /^[0-9a-f]{64}$/
/** Derives per idle pass. Decoding is the expensive part, so keep each pass
 *  short and let the next one pick up the rest. */
const PER_PASS = 6

export class ThumbnailOptimizerDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'derives hex thumbnails for demanded tile images during the optimize phase'

  protected override listens = ['thumbnail:wanted']

  #pending = new Set<string>()
  /** Sigs already attempted this session — a picture that cannot be
   *  downscaled must not be retried on every pass forever. */
  #attempted = new Set<string>()

  constructor() {
    super()
    this.onEffect<{ sig?: string }>('thumbnail:wanted', (event) => {
      const sig = event?.sig
      if (typeof sig !== 'string' || !SIG.test(sig)) return
      if (this.#attempted.has(sig)) return
      this.#pending.add(sig)
    })
  }

  public override optimize = async (): Promise<void> => {
    if (this.#pending.size === 0) return
    const store = window.ioc?.get<ThumbnailStore>('@hypercomb.social/Store')
    if (!store?.getPool || !store?.getResource) return

    const batch = [...this.#pending].slice(0, PER_PASS)
    for (const sig of batch) {
      this.#pending.delete(sig)
      this.#attempted.add(sig)
      try {
        // Another pass (or another client's sync) may already have it.
        if (await readThumbnail(store, sig)) continue
        const source = await store.getResource(sig)
        if (!source) continue
        const bytes = await deriveThumbnail(source)
        if (!bytes) continue   // too small to bother, or undecodable
        await writeThumbnail(store, sig, bytes)
      } catch {
        // Pure cache — a failure here changes nothing a reader depends on.
      }
    }
  }
}

const _thumbnailOptimizer = new ThumbnailOptimizerDrone()
window.ioc.register('@diamondcoreprocessor.com/ThumbnailOptimizerDrone', _thumbnailOptimizer)
