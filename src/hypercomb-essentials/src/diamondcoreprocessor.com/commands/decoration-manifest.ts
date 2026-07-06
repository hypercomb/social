// diamondcoreprocessor.com/commands/decoration-manifest.ts
//
// `decorations` layer slot + write helpers.
//
// The slot holds an array of decoration signatures. Each entry points to
// a content-addressed JSON record — a sig file at the flat OPFS root
// (legacy `__resources__/` is a read-fallback drain source); see
// `Store.putResource` / `Store.getResource` in
// hypercomb-shared/core/store.ts — of the shape:
//
//   {
//     kind: string,            // e.g. 'visual:website:page'
//     appliesTo: string[],     // cell lineage segments
//     payload: unknown,        // bee-specific data (e.g. { htmlSig })
//     mark?: 'persistent',
//   }
//
// ── Why a slot, and why the RESOURCE store (not the optimization pool) ─
//
// VISUAL-BEE decorations are SHAREABLE: a peer's website page should be
// fetchable by an adopter through the same content pipeline that already
// handles HTML, images, and other resources. Storing decoration JSON as
// a content resource (root sig file) means it rides existing
// replication/sync without a new substrate. The cell's `decorations` slot
// still references the JSON by sig — peer publishes layer → slot sigs ride
// the merkle tree → adopter fetches each sig via the resource pipeline lazily.
//
// The sign('optimization') pool remains the substrate for PERSONAL
// decorations (Q&A, comms) that shouldn't leak across peers. Those have
// their own bridge ops (`optimization-add` / `optimization-list`) and are
// NOT referenced from the `decorations` slot. See the layer-purity memory
// for the broader split: canonical primitives in the layer, public
// decoration content in the resource store (root sig files), personal
// decoration content in the sign('optimization') pool.
//
// Path (i) in the visual-bee design: layer holds the sig-array, content
// is external. Per-feature opt-in adoption is then trivial — the adopter
// reads the manifest, filters by decoration kind via the
// VisualBeeRegistry, and copies the sigs they want.
//
// ── Triggers (vs. passive registration) ───────────────────────────────
//
// Registered with active trigger `decorations:changed`. Visual bees just
// emit the event after writing a decoration JSON; LayerCommitter's
// onTrigger subscription cascades the sig into the manifest slot. No
// committer-internals knowledge required at the call site.
//
// Compare with `context` slot in claude-bridge.worker.ts (registered
// passive, bridge drives cascade directly) — that pattern is right when
// the writer wants atomic multi-slot updates. For decorations, single
// slot + single sig per write, declarative trigger is cleaner.

import { EffectBus } from '@hypercomb/core'
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
import { collectSigsDeep } from '../sharing/decoration-closure.js'

/**
 * Slot name on the layer JSON. Constant so consumers don't repeat the
 * string and can grep for cross-references.
 */
export const DECORATIONS_SLOT = 'decorations'

/**
 * EffectBus trigger fired when a decoration is added or removed from a
 * cell's manifest. LayerCommitter subscribes to this trigger via the
 * LayerSlotRegistry and cascades the slot mutation up to root.
 */
export const DECORATIONS_TRIGGER = 'decorations:changed'

/**
 * Decoration record shape stored as a content resource (root sig file).
 * Generic over the payload so visual bees can declare their own payload type.
 */
export interface DecorationRecord<TPayload = unknown> {
  readonly kind: string
  readonly appliesTo: readonly string[]
  readonly payload: TPayload
  readonly mark?: 'persistent'
  /** Flat closure of every resource sig this decoration depends on — the
   *  forward path `decorationClosureSigs` reads so host-sync / adopt carry the
   *  decoration's bytes (a file attachment's blob, a sequence set, an invite
   *  bundle) and a fresh adopter doesn't 404 on them. Auto-derived from the
   *  payload at write time (see `writeDecoration`). Omitted when the payload
   *  references no resources (dropbox, contact-enabled markers). Website pages
   *  set `refs` themselves (htmlSig + embedded assets) via the bridge path. */
  readonly refs?: readonly string[]
}

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(signature: string): Promise<Blob | null>
}

/**
 * Write a decoration JSON as a content resource (root sig file) and append
 * its sig to the cell's `decorations` slot via the active trigger.
 *
 * Returns the decoration sig (the content hash; same sig everywhere the
 * same record is written — natural dedup across the network).
 *
 * Caller responsibility:
 *   - `kind` follows the convention `'visual:<view>:<noun>'`
 *   - `appliesTo` matches the lineage of the cell being decorated
 *   - `segments` is the cell whose manifest should grow (typically same
 *     as `appliesTo`)
 *
 * Idempotency: same payload → same sig → store.putResource dedup →
 * same sig appended to manifest. If the manifest already contains the
 * sig, LayerMachine's append-or-noop keeps the array tidy. So calling
 * this twice with the same record is safe.
 */
export async function writeDecoration<TPayload>(opts: {
  kind: string
  appliesTo: readonly string[]
  payload: TPayload
  segments: readonly string[]
  mark?: 'persistent'
}): Promise<string> {
  const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
  if (!store?.putResource) {
    throw new Error('[decoration-manifest] Store / putResource not available')
  }
  // Auto-declare the payload's resource closure so the push/adopt walk carries
  // the decoration's bytes — every 64-hex sig nested in the payload (a file
  // attachment's blob, a sequence set, an invite bundle). Empty for marker
  // decorations (dropbox accept-list, contact-enabled) → field omitted.
  const refs = collectSigsDeep(opts.payload)
  const record: DecorationRecord<TPayload> = {
    kind: opts.kind,
    appliesTo: opts.appliesTo,
    payload: opts.payload,
    ...(opts.mark ? { mark: opts.mark } : {}),
    ...(refs.length ? { refs } : {}),
  }
  const blob = new Blob([JSON.stringify(record)], { type: 'application/json' })
  const sig = await store.putResource(blob)

  EffectBus.emit(DECORATIONS_TRIGGER, {
    segments: opts.segments,
    op: 'append',
    sig,
  })

  return sig
}

/**
 * Remove a decoration sig from the cell's `decorations` slot. The
 * decoration JSON itself stays in the resource store (root sig file;
 * it's content-addressed and may be referenced by other manifests —
 * same sig for
 * the same content). Garbage-collecting orphaned records is a separate
 * concern handled by a future sweep, not by individual remove calls.
 */
export function removeDecoration(opts: {
  sig: string
  segments: readonly string[]
}): void {
  EffectBus.emit(DECORATIONS_TRIGGER, {
    segments: opts.segments,
    op: 'removeSig',
    sig: opts.sig,
  })
}

/**
 * Read decoration records referenced from a cell's `decorations` slot
 * and filter by `kind`. Returns each matching record paired with its
 * sig.
 *
 * Walks the slot (not the whole resource store) — efficient regardless
 * of fleet size. Caller must supply `segments` for the cell to inspect.
 *
 * For "all decorations of kind X across all cells" use the
 * decoration-kind-index module (kind-by-label) instead — it's an
 * in-memory cache maintained by `decorations:changed` events plus
 * `render:cell-count` hydration.
 */
export async function listDecorations<TPayload>(opts: {
  kind: string
  segments: readonly string[]
}): Promise<Array<{ sig: string; record: DecorationRecord<TPayload> }>> {
  const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
  if (!store?.getResource) return []

  const history = window.ioc.get<{
    sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
    currentLayerAt: (locationSig: string) => Promise<{ decorations?: unknown } | null>
  }>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return []

  const locationSig = await history.sign({ explorerSegments: () => opts.segments })
  const layer = await history.currentLayerAt(locationSig)
  if (!layer) return []
  const slot = (layer as { decorations?: unknown }).decorations
  const sigs: string[] = Array.isArray(slot)
    ? slot.map(s => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s))
    : []

  const out: Array<{ sig: string; record: DecorationRecord<TPayload> }> = []
  for (const sig of sigs) {
    try {
      const blob = await store.getResource(sig)
      if (!blob) continue
      const parsed = JSON.parse(await blob.text()) as DecorationRecord<TPayload>
      if (parsed?.kind !== opts.kind) continue
      out.push({ sig, record: parsed })
    } catch {
      /* malformed record — skip */
    }
  }
  return out
}

// ── Slot registration ────────────────────────────────────────────────
//
// Register the `decorations` slot once LayerSlotRegistry is available.
// Module-load-order independent via `whenReady`. The active trigger
// `decorations:changed` makes the slot self-cascading: visual bees emit
// the event, LayerCommitter picks it up and writes the manifest.

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({
      slot: DECORATIONS_SLOT,
      triggers: [DECORATIONS_TRIGGER],
    })
  },
)
