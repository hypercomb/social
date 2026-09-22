// assistant/llm-context.drone.ts
//
// The minting half of the LLM context cache: the optimize-phase bee that
// keeps `sign('llm:context')` warm so a `/read` node result can carry a
// compact projection instead of raw slot arrays (llm-context.ts).
//
// A PASS WITH NOTHING PENDING COSTS NOTHING — there is no backfill, and no
// root walk. A tile nobody has committed or asked about simply has no
// record; `LlmContextService.project()` derives it in memory on demand,
// which is what makes leaving it unminted correct rather than merely cheap.
//
// Two doors feed the queue:
//   1. `content:wrote` (kind `layer`) — a tile was just committed, so its
//      new head sig is worth pre-minting before anything asks for it.
//   2. `enqueue(sig)` — anything that asked cold (`project()` deriving in
//      memory, or `inflate()`'s lens missing) says so, and the next pass
//      mints it so the SAME sig is warm next time.
//
// Contract compliance (documentation/optimize-phase.md):
//   1. keyed by the SOURCE LAYER SIGNATURE — invalidation is automatic;
//      `if (await readRecord) continue` is a skip, never a refresh.
//   2. lives in a derived-cache pool of meaning — recomputable, wipe-safe.
//   3. never load-bearing — `LlmContextService.project()` gives the
//      identical text with the pool absent, only slower (in-memory derive).
//   4. mints no truth — no layers, no markers, no lineage writes.
//   5. COMPLETE-OR-ABSENT — `derive()` returns null (never a partial
//      projection) and a null is never written.
//
// THE MINTER IS NOT THE REGISTERED SERVICE. This drone constructs its own
// `LlmContextService`; IoC carries the read half only (`@diamondcoreprocessor.
// com/LlmContext`). Minting is unreachable from a render or keystroke path
// by construction, not by convention.

import { Drone } from '@hypercomb/core'
import { LlmContextService } from './llm-context.js'
import { DoctrineQueenBee } from './doctrine.queen.js'

const SIG_RE = /^[0-9a-f]{64}$/i

/** Layers whose records get minted in one pass. The rest wait — nothing is
 *  lost, because a sig's record can never go stale and the queue simply
 *  carries it into the next pass. */
const LAYERS_PER_PASS = 12

export class LlmContextDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'derives token-compact tile projections during the optimize phase'

  protected override listens = ['content:wrote']

  /** Layer sigs waiting for the next pass. The handler does NO work. */
  #pending = new Set<string>()

  /** The minter. Not registered anywhere — see the header. */
  #service = new LlmContextService()

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig) return
      this.#pending.add(e.sig)
    })
  }

  /** THE ONE DOOR for anything that learned a sig is worth projecting
   *  without waiting for it to be re-committed — a cold `project()`, or
   *  `inflate()`'s lens missing. Idempotent: re-queuing a pending sig is a
   *  no-op, and a sig already recorded is skipped by `optimize()` itself. */
  public readonly enqueue = (sig: unknown): void => {
    const clean = typeof sig === 'string' ? sig.trim().toLowerCase() : ''
    if (!SIG_RE.test(clean)) return
    this.#pending.add(clean)
  }

  /** How many sigs are waiting for the next pass — for a test, or a status line. */
  public get pendingCount(): number { return this.#pending.size }

  public override optimize = async (): Promise<void> => {
    if (this.#pending.size === 0) return

    const batch = [...this.#pending].slice(0, LAYERS_PER_PASS)
    for (const sig of batch) this.#pending.delete(sig)

    for (const sig of batch) {
      // A sig's record can never go stale, so this is a skip rather than a
      // refresh — there is no update path to get wrong.
      if (await this.#service.readRecord(sig)) continue
      const record = await this.#service.derive(sig).catch(() => null)
      if (record) await this.#service.writeRecord(sig, record)
    }
  }
}

window.ioc.register('@diamondcoreprocessor.com/LlmContextDrone', new LlmContextDrone())

// THE BEE WIRES (atomic-modules-plan.md): the doctrine words are the context
// feature's — the doctrine is what every model is sent first — so this bee
// registers them; doctrine.queen.ts is a dependency and registers nothing.
window.ioc.register('@diamondcoreprocessor.com/DoctrineQueenBee', new DoctrineQueenBee())
