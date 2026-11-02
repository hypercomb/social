// history/recents-census.drone.ts
//
// The minting half of the recents census: the optimize-phase bee that keeps
// `sign('recents:census')` warm so "every atom this hive made, by date" is a
// read (documentation/recents-and-the-quick-tray.md, codex H7).
//
// A PASS WITH NOTHING COMMITTED COSTS NOTHING — the same first line the
// molecule index has, for the same reason: the phase fires during boot
// whether the browser is idle or not, and an unconditional root derivation
// is a whole-hive walk plus a bag listing per node. THERE IS NO BOOT
// BACKFILL. The root is derived when a commit moved it, and a derivation
// the budget cut short is continued on later passes — every complete child
// written persists, so each pass strictly shrinks the work — until the root
// record lands or the session's attempts run out.
//
// Compliance (documentation/optimize-phase.md): keyed by the root layer sig,
// derived on miss; lives in a derived-cache pool declared `index`; never
// load-bearing (the reader answers null, the view renders empty); mints no
// truth; COMPLETE-OR-ABSENT — a truncated root is never written.

import { Drone } from '@hypercomb/core'
import { RECENTS_CENSUS_KEY, RecentsCensusService, recentsCensusReader } from './recents-census.service.js'

/** Nodes visited per idle pass — one manifest read and one bag listing each. */
const NODES_PER_PASS = 300

/** Passes a session will spend continuing a root derivation the budget cut
 *  short. Children written along the way persist, so the next commit's pass
 *  starts from where this one stopped. */
const MAX_CONTINUATIONS = 20

export class RecentsCensusDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'derives the recents census — every atom under the root, by first marker — during the optimize phase'

  protected override listens = ['content:wrote']
  protected override emits = ['recents:census-changed']

  /** The minter. Not registered anywhere — see the service header. */
  #census = new RecentsCensusService()
  /** A commit moved something: the root record is owed. */
  #dirty = false
  /** Passes spent continuing a cut-short derivation this session. */
  #continuations = 0

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig) return
      this.#dirty = true
      this.#continuations = 0
    })
  }

  public override optimize = async (): Promise<void> => {
    if (!this.#dirty) return
    const census = this.#census
    try {
      const rootSig = await census.rootSig()
      if (!rootSig) return
      const held = await census.readRecord(rootSig)
      if (held) { this.#dirty = false; return }
      const record = await census.derive(rootSig, [], { nodes: NODES_PER_PASS })
      if (record && !record.truncated) {
        await census.writeRecord(rootSig, record)
        this.#dirty = false
        this.emitEffect('recents:census-changed', { sig: rootSig, count: record.entries.length })
        return
      }
      // Cut short: the children that completed are written; come back next pass.
      if (++this.#continuations >= MAX_CONTINUATIONS) this.#dirty = false
    } catch { /* derived cache — absent is the answer until it lands */ }
  }
}

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register(RECENTS_CENSUS_KEY, recentsCensusReader(new RecentsCensusService()))

window.ioc.register('@diamondcoreprocessor.com/RecentsCensusDrone', new RecentsCensusDrone())
