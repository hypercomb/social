// history/recents-census.drone.ts
//
// The minting half of the recents census: the optimize-phase bee that keeps
// `sign('recents:census')` warm so "every atom this hive made, by date" is a
// read (documentation/recents-and-the-quick-tray.md, codex H7).
//
// A PASS WITH NOTHING OWED COSTS NOTHING — the same first line the molecule
// index has, for the same reason: the phase fires during boot whether the
// browser is idle or not, and an unconditional root derivation is a whole-hive
// walk plus a bag listing per node. THERE IS NO BOOT BACKFILL. The root is owed
// when a commit moved it or when someone asks (`recents:wanted`).
//
// THE PHASE ONLY RUNS AFTER AN ACT. A commit brings its own, but a read-only
// open brings none, so an ask starts one, and a pass that was cut short while
// someone is waiting starts the next. Every complete child written persists,
// so each pass strictly shrinks the work. Without an ask, a cut-short pass
// simply waits for the next ordinary act.
//
// Compliance (documentation/optimize-phase.md): keyed by the root layer sig,
// derived on miss; lives in a derived-cache pool declared `index`; never
// load-bearing (the reader answers null, the view waits); mints no truth;
// COMPLETE-OR-ABSENT — a truncated root is never written. The bag census that
// follows the root is session memory and writes nothing.

import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import { RECENTS_CENSUS_KEY, RecentsCensusService, recentsCensusReader } from './recents-census.service.js'

/** Nodes visited per idle pass — one manifest read and one bag listing each. */
const NODES_PER_PASS = 300

/** Bags judged per idle pass — one bag listing and one layer read each. */
const BAGS_PER_PASS = 300

/** Passes spent continuing cut-short work before giving up until the next
 *  commit or ask. A hive too big for this is not walked forever. */
const MAX_CONTINUATIONS = 20

export class RecentsCensusDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'derives the recents census — every atom this hive made, by first marker — during the optimize phase'

  protected override listens = ['content:wrote', 'recents:wanted']
  protected override emits = ['recents:census-changed']

  /** The one service: the phase mints on it and IoC reads the same memory, so
   *  the session-only bag census reaches the reader. Only the read half is
   *  registered (see the service header). */
  #census = new RecentsCensusService()
  readonly reader = recentsCensusReader(this.#census)

  /** Work is owed: a commit moved the root, or someone asked. */
  #owed = false
  /** Someone is waiting, so a cut-short pass starts the next one itself. */
  #asked = false
  #continuations = 0

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig) return
      this.#owed = true
      this.#continuations = 0
    })
    EffectBus.on('recents:wanted', () => {
      this.#owed = true
      this.#asked = true
      this.#continuations = 0
      void new hypercomb().act()
    })
  }

  public override optimize = async (): Promise<void> => {
    if (!this.#owed) return
    const census = this.#census
    try {
      const rootSig = await census.rootSig()
      if (!rootSig) return
      let record = await census.readRecord(rootSig)
      if (!record) {
        const derived = await census.derive(rootSig, [], { nodes: NODES_PER_PASS })
        if (!derived || derived.truncated) { this.#carryOn(); return }
        await census.writeRecord(rootSig, derived)
        record = derived
      }
      const judged = await census.unlistedPass(rootSig, record, { nodes: BAGS_PER_PASS })
      this.emitEffect('recents:census-changed', { sig: rootSig, count: record.entries.length })
      if (judged) { this.#owed = false; this.#asked = false }
      else this.#carryOn()
    } catch { /* derived cache — absent is the answer until it lands */ }
  }

  /** Cut short: what completed is kept. Come back, up to the cap. */
  #carryOn(): void {
    if (++this.#continuations >= MAX_CONTINUATIONS) { this.#owed = false; this.#asked = false; return }
    if (this.#asked) void new hypercomb().act()
  }
}

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
const _recentsCensus = new RecentsCensusDrone()
window.ioc.register(RECENTS_CENSUS_KEY, _recentsCensus.reader)
window.ioc.register('@diamondcoreprocessor.com/RecentsCensusDrone', _recentsCensus)
