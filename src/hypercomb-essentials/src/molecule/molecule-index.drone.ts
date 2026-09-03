// molecule/molecule-index.drone.ts
//
// The minting half of the molecule index: the optimize-phase bee that keeps
// `sign('molecule:index')` warm so "can this hive say that word?" is a read.
//
// A PASS WITH NOTHING COMMITTED COSTS NOTHING. This is the first line of
// `optimize()` and it is the whole shape of the bee: the phase is scheduled
// from `hypercomb.act()`'s finally with a 2s idle TIMEOUT, so it fires during
// boot whether the browser is idle or not, and the processor awaits every
// bee's `optimize()` serially with no deadline. An unconditional root warm
// here was a whole-hive walk — one manifest read and one pool write per node —
// landing while first paint was still reading tiles out of the same OPFS, and
// it re-created the "navigation funds a whole-hive walk" regression the tree
// epoch was built to kill. THERE IS NO BACKFILL. A hive nobody has edited
// simply has no record, and the cold path answers it correctly.
//
// It mints exactly two things per idle pass:
//
//   1. a record for every layer committed since the last pass — the changed
//      spine. A root commit puts the ROOT sig in that batch, so the vocabulary
//      is minted by editing, never by booting;
//   2. a REPAIR, and only ever a repair: a root record that already exists and
//      admits it is `truncated` is re-derived once per session with a reserved
//      budget. An ABSENT record is left absent — that is a cold pool, not a
//      damaged one, and walking it is the boot cost above.
//
// Re-deriving is cheap for the reason the whole design rests on: it COMPOSES
// from its children's records, and an unchanged child has an unchanged sig, so
// its word set is still exactly true and is spliced in whole.
//
// Contract compliance (documentation/optimize-phase.md):
//   1. keyed by the SOURCE LAYER SIGNATURE — invalidation is automatic, and
//      there is no refresh, only derive-on-miss (`if (await read) continue`).
//   2. lives in a derived-cache pool of meaning — recomputable, wipe-safe.
//   3. never load-bearing — with the pool empty `fallbackVocabulary()` gives
//      the identical answer, proved in molecule-index.cold-path.spec.ts.
//   4. mints no truth — no layers, no markers, no lineage writes, and nothing
//      is ever placed AT a molecule address. A host may DECLARE what it holds;
//      placement is a publish act and does not happen here.
//   5. COMPLETE-OR-ABSENT — a record that came back `truncated` is never
//      written. There is no refresh path (a sig's record cannot go stale), so
//      a partial record persisted once would be wrong for the life of that
//      content, and `holds(word)` would answer a bare `false` for a word the
//      hive says.
//
// THE MINTER IS NOT THE REGISTERED SERVICE. The bee constructs its own
// `MoleculeIndexService`; IoC carries the READ half only. Minting is therefore
// unreachable from a render or keystroke path by construction, not by
// convention.

import { Drone } from '@hypercomb/core'
import { MoleculeIndexService } from './molecule-index.service.js'

/** Manifest reads per idle pass, for the committed spine. A pass that runs out
 *  stops cleanly; the next one picks up, and every branch it did finish is a
 *  cache hit by then, so the work strictly shrinks. */
const NODES_PER_PASS = 400

/** Reads RESERVED for the root record, never shared with the spine. */
const ROOT_NODES_PER_PASS = 300

/** Layers whose records get minted in one pass. The rest wait; nothing is lost,
 *  because the queue is keyed by sig and a sig is never in a hurry. */
const LAYERS_PER_PASS = 12

export class MoleculeIndexDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'derives the hive vocabulary — name → molecule address — during the optimize phase'

  protected override listens = ['content:wrote']

  /** Layer sigs committed since the last pass. The handler does NO work. */
  #pending = new Set<string>()

  /** The minter. Not registered anywhere — see the header. */
  #index = new MoleculeIndexService()

  /** Root sigs a repair has already been attempted for this session. A root
   *  too big to finish inside the reserved budget must not re-attempt on every
   *  act(); one try, then the cold path answers. */
  #repaired = new Set<string>()

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig) return
      this.#pending.add(e.sig)
    })
  }

  public override optimize = async (): Promise<void> => {
    const index = this.#index

    if (this.#pending.size === 0) {
      // Nothing was committed. The ONLY work a settled hive may fund is
      // repairing a record that already exists and says it is incomplete —
      // never deriving one that is merely absent.
      await this.#repairRoot(index)
      return
    }

    const batch = [...this.#pending].slice(-LAYERS_PER_PASS)
    this.#pending.clear()

    const budget = { nodes: NODES_PER_PASS }
    for (const sig of batch) {
      if (budget.nodes <= 0) break
      // Already recorded — a sig's record can never go stale, so this is a
      // skip rather than a refresh. There is no update path to get wrong. A
      // record that admits it is truncated is the one exception: it is not a
      // stale record, it is an incomplete one, and it may be replaced.
      const held = await index.readRecord(sig).catch(() => null)
      if (held && held.truncated !== true) continue
      const record = await index.derive(sig, budget).catch(() => null)
      if (record && record.truncated !== true) await index.writeRecord(sig, record)
    }

    await this.#repairRoot(index)
  }

  /** Re-derive a root record that EXISTS and admits it is incomplete. An
   *  absent record is left absent: deriving one from nothing is the whole-hive
   *  boot walk this bee refuses to fund. */
  async #repairRoot(index: MoleculeIndexService): Promise<void> {
    try {
      const rootSig = await index.rootSig()
      if (!rootSig || this.#repaired.has(rootSig)) return
      const held = await index.readRecord(rootSig)
      if (!held || held.truncated !== true) return
      this.#repaired.add(rootSig)
      const record = await index.derive(rootSig, { nodes: ROOT_NODES_PER_PASS })
      if (record && record.truncated !== true) await index.writeRecord(rootSig, record)
    } catch { /* derived cache — the cold path is the answer until it lands */ }
  }
}

window.ioc.register('@diamondcoreprocessor.com/MoleculeIndexDrone', new MoleculeIndexDrone())
