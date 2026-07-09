// diamondcoreprocessor.com/history/manifest-optimizer.drone.ts
//
// First implementation of the processor's optimize phase (derived-cache
// contract — see Bee.optimize in @hypercomb/core). Children manifests
// were historically written inline by commitLayer on a microtask,
// coupling a pure derived cache to the commit path. Now commitLayer
// just emits 'content:wrote' (kind 'layer') as it always has; this bee
// queues the sig and, when the processor reaches the idle optimize
// phase, derives the manifest — every child sig resolved to its layer,
// the array written into the sign('manifests') pool keyed by the
// PARENT LAYER SIG.
//
// The key choice is the addressing direction: the manifest is keyed BY
// the layer sig it derives from, so invalidation is automatic — a
// changed children set is a NEW layer sig with no manifest yet, and the
// stale record is simply never consulted again. Old manifests keyed by
// old layer sigs stay valid for rewind/time-travel and are GC-safe.
//
// Complete-or-absent: a partial manifest fails the reader's length
// check on every future load, forcing the slow per-child path that
// drops not-yet-cached children — the two-stage render bug. A missing
// manifest is fine: resolveChildNames backfills a complete one once all
// children are warm. Nothing here is ever load-bearing.

import { Drone } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'

type ManifestEntry = { sig: string; layer: { name?: string; [k: string]: unknown } }
type ManifestStore = {
  writeChildrenManifest?: (parentSig: string, manifest: ManifestEntry[]) => Promise<void>
}

export class ManifestOptimizerDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'derives children manifests for committed layers during the optimize phase'

  protected override listens = ['content:wrote']

  // parent layer sig → child sigs, queued at commit, drained on optimize
  #pending = new Map<string, string[]>()

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string; bytes: ArrayBuffer }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig || !e.bytes) return
      try {
        const layer = JSON.parse(new TextDecoder().decode(e.bytes)) as { children?: unknown }
        const children = Array.isArray(layer.children)
          ? layer.children.filter((c): c is string => typeof c === 'string')
          : []
        if (children.length > 0) this.#pending.set(e.sig, children)
      } catch { /* non-JSON layer bytes — nothing to derive */ }
    })
  }

  public override optimize = async (): Promise<void> => {
    if (this.#pending.size === 0) return
    const store = get('@hypercomb.social/Store') as ManifestStore | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    if (!store?.writeChildrenManifest || !history) return

    const batch = [...this.#pending.entries()]
    this.#pending.clear()

    for (const [parentSig, childSigs] of batch) {
      const manifest: ManifestEntry[] = []
      for (const sig of childSigs) {
        const child = await history.getLayerBySig(sig)
        if (!child) break
        manifest.push({ sig, layer: child })
      }
      if (manifest.length === childSigs.length) {
        await store.writeChildrenManifest(parentSig, manifest)
      }
    }
  }
}

const _manifestOptimizer = new ManifestOptimizerDrone()
window.ioc.register('@diamondcoreprocessor.com/ManifestOptimizerDrone', _manifestOptimizer)
