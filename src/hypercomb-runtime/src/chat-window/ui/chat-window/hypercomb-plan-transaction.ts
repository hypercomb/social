// ui/chat-window/hypercomb-plan-transaction.ts
//
// THE UNIT OF AUTHORIZATION IS THE UNIT OF ATOMICITY
// (documentation/natural-language-surface-audit.md, item 13).
//
// The participant runs a model's plan as ONE thing — one row in Execution,
// one Run. It used to land as many: when line three failed, lines one and two
// stayed done, and the receipt named them. Now a plan that stops on a failure
// puts back every page it moved, so what the participant authorized either
// happened whole or not at all.
//
// HOW. Every version a page gains is announced as `history:marker-wrote`,
// emitted before the head moves — so at that moment history still answers
// what the page held (`warmHeadSigFor`). The first write to a page during the
// plan records that earlier version; when the head was not yet known (a page
// inside a freshly pasted subtree, whose state was virtual), the first marker
// the plan wrote IS that state, because history materializes it before the
// change. Rolling back promotes each page's earlier version to head again.
//
// DATA NEVER HEALS. The roll back is a forward commit: one new marker per
// page, nothing deleted, the plan's own versions kept in history — undo walks
// through both. Parents are pages too, so the cascade comes back with them
// and the merkle root is the one the plan started from.
//
// WHAT IT DOES NOT TOUCH. A page something else moved after the plan wrote it
// is left as it is and counted, never overwritten. A plan that left the hive
// rewound cannot be rolled back (the hive takes no writes there). And what a
// line wrote outside the pages — a registry row, a pool, a signed event — is
// not a page; the receipt names those lines instead of claiming them undone.

/** As much of the history service as a roll back needs. */
export type PlanHistory = {
  /** The page's current version, from memory only; null when unknown. */
  warmHeadSigFor(lineageSig: string): string | null
  /** A forward commit of an earlier version as the page's head. */
  promoteToHead(lineageSig: string, layerSig: string): Promise<string | null>
}

/** As much of the effect bus as recording needs (core EffectBus). */
export type PlanBus = {
  on<T>(effect: string, handler: (payload: T) => void): () => void
}

export type PlanRollback = {
  /** Pages put back to what they held before the plan. */
  readonly restored: number
  /** Pages something else moved after the plan wrote them — left as they are. */
  readonly kept: number
  /** Pages whose earlier version could not be put back. */
  readonly failed: number
  /** Set when nothing could be rolled back, and why. */
  readonly refused?: string
}

type MarkerWrote = { readonly lineageSig?: unknown; readonly bytes?: unknown }

const SIG = /^[0-9a-f]{64}$/

/** The layer a marker points at: `{"layer":"<sig>"}`. */
const layerOfMarker = (bytes: unknown): string | null => {
  // By tag, not `instanceof`: bytes from another realm are bytes all the same.
  if (Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]' && !ArrayBuffer.isView(bytes)) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes as ArrayBuffer)) as { layer?: unknown }
    const sig = String(parsed?.layer ?? '').toLowerCase()
    return SIG.test(sig) ? sig : null
  } catch { return null }
}

export class PlanTransaction {
  /** Page → the version it held before the plan first wrote it. */
  readonly #before = new Map<string, string>()
  /** Page → the last version the plan wrote. */
  readonly #after = new Map<string, string>()
  #stop: (() => void) | undefined

  constructor(readonly history: PlanHistory) {}

  /** Start recording. The bus replays its last event to a new subscriber —
   *  a write from BEFORE the plan, which must not be taken for one of its own. */
  begin(bus: PlanBus): void {
    if (this.#stop) return
    let live = false
    this.#stop = bus.on<MarkerWrote>('history:marker-wrote', written => {
      if (!live) return
      const lineage = String(written?.lineageSig ?? '').toLowerCase()
      const layer = layerOfMarker(written?.bytes)
      if (!SIG.test(lineage) || !layer) return
      if (!this.#before.has(lineage)) this.#before.set(lineage, this.history.warmHeadSigFor(lineage) ?? layer)
      this.#after.set(lineage, layer)
    })
    live = true
  }

  /** Stop recording. Safe to call more than once. */
  end(): void {
    this.#stop?.()
    this.#stop = undefined
  }

  /** How many pages the plan moved so far. */
  get touched(): number {
    let moved = 0
    for (const [lineage, before] of this.#before) if (this.#after.get(lineage) !== before) moved++
    return moved
  }

  /** Put back every page the plan moved, as forward commits. Recording stops
   *  first, so the roll back's own writes are never taken for the plan's. */
  async rollback(options: { readonly rewound?: boolean } = {}): Promise<PlanRollback> {
    this.end()
    if (options.rewound) {
      return { restored: 0, kept: 0, failed: 0, refused: 'the hive is stepped back in history and takes no writes; /redo returns it to now' }
    }
    let restored = 0
    let kept = 0
    let failed = 0
    for (const [lineage, before] of this.#before) {
      const now = this.history.warmHeadSigFor(lineage)
      if (now === before) continue
      if (now !== this.#after.get(lineage)) { kept++; continue }
      try {
        if (await this.history.promoteToHead(lineage, before)) restored++
        else failed++
      } catch { failed++ }
    }
    return { restored, kept, failed }
  }
}
