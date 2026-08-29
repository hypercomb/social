// diamondcoreprocessor.com/presentation/tiles/visual-optimizer.drone.ts
//
// Mints cell-sized visuals during the processor's optimize phase — the only
// sanctioned place to write a derived cache (see Bee.optimize and
// documentation/optimize-phase.md).
//
// The hex atlas bakes every tile picture into a 256px cell, but the render
// path decodes whatever the source bytes are — a phone photo pays a full
// multi-megapixel decode for pixels that end up 256 across. The Store already
// knows how to persist the downscale the atlas would do anyway
// (Store.optimizeVisual → a ≤512px webp in the sign('visual-optimization')
// pool, keyed by the SOURCE IMAGE SIG), so the next cold load decodes a small
// image instead of the original.
//
// Demand-driven rather than eager: nothing walks the hive looking for
// pictures to shrink. A render-path load that had to fall back to
// full-resolution source bytes emits `visual:wanted` with the source sig;
// this bee queues it and derives on the next idle pass. So the cost is paid
// once per picture actually painted, never for the rest.
//
// Contract compliance:
//   - keyed by the source image signature — invalidation is automatic
//   - lives in the sign('visual-optimization') derived-cache pool (already
//     in the frozen pool census)
//   - never load-bearing: the cold path decodes the full image instead
//   - complete-or-absent: Store.optimizeVisual writes a whole webp or nothing
//   - mints no truth: no layers, no markers, no props

import { Drone } from '@hypercomb/core'

const SIG = /^[0-9a-f]{64}$/
/** Derives per idle pass. Each derive decodes the FULL source image — the
 *  expensive part — so keep passes short and let the next one continue. */
const PER_PASS = 4

type VisualStore = {
  getResourceLocal(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
  getOptimizedVisual?(sig: string): Promise<Blob | null>
  optimizeVisual?(sig: string, raw: Blob): Promise<void>
}

export class VisualOptimizerDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'derives cell-sized visuals for demanded tile images during the optimize phase'

  protected override listens = ['visual:wanted']

  #pending = new Set<string>()
  /** Sigs already attempted this session — a source at or below the atlas
   *  target derives nothing and must not be retried on every pass forever. */
  #attempted = new Set<string>()

  constructor() {
    super()
    this.onEffect<{ sig?: string }>('visual:wanted', (event) => {
      const sig = event?.sig
      if (typeof sig !== 'string' || !SIG.test(sig)) return
      if (this.#attempted.has(sig)) return
      this.#pending.add(sig)
    })
  }

  public override optimize = async (): Promise<void> => {
    if (this.#pending.size === 0) return
    const store = window.ioc?.get<VisualStore>('@hypercomb.social/Store')
    if (!store?.optimizeVisual || !store.getResourceLocal) return

    const batch = [...this.#pending].slice(0, PER_PASS)
    for (const sig of batch) {
      this.#pending.delete(sig)
      this.#attempted.add(sig)
      try {
        // Another pass may already have minted it.
        if (await store.getOptimizedVisual?.(sig)) continue
        // LOCAL only — a derived cache is minted from bytes already here;
        // fetching would put network traffic on an optimization path.
        const source = await (store.getResourceResolvedLocal?.(sig) ?? store.getResourceLocal(sig))
        if (!source) continue
        await store.optimizeVisual(sig, source)
      } catch {
        // Pure cache — a failure here changes nothing a reader depends on.
      }
    }
  }
}

const _visualOptimizer = new VisualOptimizerDrone()
window.ioc.register('@diamondcoreprocessor.com/VisualOptimizerDrone', _visualOptimizer)
