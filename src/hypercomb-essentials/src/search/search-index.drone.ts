// search/search-index.drone.ts
//
// The minting half of search: the optimize-phase bee that keeps
// sign('search:index') warm so a search is a read and never a walk.
//
// It mints exactly two things per idle pass:
//
//   1. a record for every layer committed since the last pass — the changed
//      spine, which is what makes the branch reach ([term]) a single read;
//   2. a record for the ROOT layer, pre-warmed, which is what makes the hive
//      reach (@term) a single read.
//
// Pre-warming the root sounds expensive and is not, for the reason the whole
// design rests on: the root record is COMPOSED from its children's records,
// and an unchanged child has an unchanged sig, so its record is still exactly
// true and gets spliced in whole. A commit deep in one branch costs a
// re-derivation of that spine and nothing else. The merkle tree does the
// invalidation; there is no update path to get wrong.
//
// Derived-cache contract (documentation/optimize-phase.md), honoured:
//   - keyed by the SOURCE SIGNATURE, so invalidation is automatic
//   - lives in a pool of meaning, recomputable and wipe-safe
//   - never load-bearing: with the pool empty every search still answers,
//     from the manifests, just less far
//   - complete-or-absent: a budget-cut record carries `truncated`
//   - mints no truth: no layers, no markers, no lineage writes

import { Drone } from '@hypercomb/core'
import type { HiveSearchService } from './hive-search.service.js'

/** Manifest reads per idle pass, for the committed spine. A pass that runs
 *  out stops cleanly and the next one picks up — every branch it did finish
 *  is a cache hit by then, so the work strictly shrinks. */
const NODES_PER_PASS = 600

/** Reads reserved for the ROOT record, never shared with the spine above.
 *  The root is the hive's VOCABULARY — the set of places that can be
 *  reached by saying their name — so it cannot be the thing that gets
 *  dropped when a pass is busy. It is composed from records the spine pass
 *  just warmed, so in the settled case it spends almost none of this. */
const ROOT_NODES_PER_PASS = 400

/** Layers whose records get minted in one pass. The rest wait; nothing is
 *  lost, because the queue is keyed by sig and a sig is never in a hurry. */
const LAYERS_PER_PASS = 12

export class SearchIndexDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'derives hive search records during the optimize phase'

  protected override listens = ['content:wrote']

  /** Layer sigs committed since the last pass. */
  #pending = new Set<string>()

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig) return
      this.#pending.add(e.sig)
    })
  }

  public override optimize = async (): Promise<void> => {
    const search = window.ioc?.get<HiveSearchService>('@diamondcoreprocessor.com/HiveSearchService')
    if (!search) return

    const batch = [...this.#pending].slice(-LAYERS_PER_PASS)
    this.#pending.clear()

    const budget = { nodes: NODES_PER_PASS }

    for (const sig of batch) {
      if (budget.nodes <= 0) break
      // Already recorded — a sig's record can never go stale, so this is a
      // no-op rather than a refresh.
      if (await search.readRecord(sig)) continue
      const record = await search.derive(sig, budget)
      if (record) await search.writeRecord(sig, record)
    }

    // The root LAST and ALWAYS. Last because it composes from whatever the
    // loop above just warmed, which is what makes it cheap; always because
    // it is the vocabulary — voice can only reach a place whose name is
    // known, so a pass that skipped the root would leave parts of the hive
    // unsayable until some later pass happened to get to it.
    await this.#warmRoot(search, { nodes: ROOT_NODES_PER_PASS })
  }

  async #warmRoot(search: HiveSearchService, budget: { nodes: number }): Promise<void> {
    const history = window.ioc?.get<{
      sign(l: { explorerSegments: () => readonly string[] }): Promise<string>
      headLayer(locationSig: string): Promise<{ layerSig: string } | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return
    try {
      const rootLocation = await history.sign({ explorerSegments: () => [] })
      const rootSig = (await history.headLayer(rootLocation))?.layerSig
      if (!rootSig) return
      if (await search.readRecord(rootSig)) return
      const record = await search.derive(rootSig, budget)
      if (record) await search.writeRecord(rootSig, record)
    } catch { /* the root is warmed next pass — nothing depends on it */ }
  }
}

window.ioc.register('@diamondcoreprocessor.com/SearchIndexDrone', new SearchIndexDrone())
