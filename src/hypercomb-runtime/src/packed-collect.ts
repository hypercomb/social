// hypercomb-shared/core/packed-collect.ts
//
// COLLECTION — reclaim content no committed layer ever referenced.
//
// The web port of `hypercomb-client/crates/store/src/lib.rs::gc`.
//
// ## What this touches, and what it must never touch
//
// Reachability starts from **every marker in every bag**, not from the heads.
// Every layer any revision ever pointed at therefore stays, and undo, time
// travel and old revisions are all preserved. The history graph is complete
// by construction — this cannot collect history, because history is a root.
//
// What it reclaims is content that **no committed layer ever referenced**:
// bytes written to obtain a signature and then abandoned. Paste an image, hit
// escape — those bytes are in the store, reachable from nothing. They are not
// history, they are litter from an abandoned gesture, and they are typically
// the large ones.
//
// ## The bias is deliberate
//
// The scan OVER-APPROXIMATES: any 64-hex string found anywhere in any record,
// at any depth, in a KEY or a value, counts as a reference. A false keep
// wastes disk. A false sweep destroys a user's data. Only one of those is
// recoverable, so the bias stays, and anyone tempted to tighten it should
// read that sentence again.
//
// ## Where it may run
//
// NEVER on a write path. This is a manual or idle-time operation: it walks
// every marker and every pool member, which is the one thing the packed store
// was built to stop doing on boot.
//
// ## THE INSTALL WINDOW — read before scheduling this
//
// "Orphan" means "no marker references it", and freshly INSTALLED content
// satisfies that definition until a commit puts it in the tree. Measured on a
// scratch origin: boot installed 27 content records, collection swept all 27
// as unreachable, the next boot reinstalled them, and a second collection
// swept them again — a stable, pointless churn that would be a disaster if it
// ever raced an install mid-flight.
//
// So: do not collect between an install and the first commit, and do not put
// this on a timer that could fire during one. The reference implementation
// has the same property ("never call this on a write path"); this note exists
// because the web shell reinstalls on every boot, which makes the window far
// easier to hit here than it is natively.

import { isSigName } from './packed-store-engine'
import type { PackedStoreEngine } from './packed-store-engine'

/** What a collection reclaimed. Mirrors the Rust `Collected`. */
export interface Collected {
  /** Content reachable from some marker, and therefore kept. */
  reachable: number
  /** Orphans swept. */
  swept: number
  /** Bytes freed. */
  bytes: number
}

const SIG = /^[0-9a-f]{64}$/i

/**
 * Every signature-shaped string anywhere in a JSON record — values, array
 * elements, nested objects, and KEYS.
 *
 * Keys matter: a children manifest is keyed by content signature, so a
 * key-blind scan would sweep every layer such a manifest points at. That was
 * worth an explicit comment in the Rust original and is worth one here.
 *
 * Records that are not JSON contribute nothing rather than failing — a blob
 * is not a reference holder, and refusing to collect because one record is
 * opaque would make the whole operation unusable.
 */
export const collectSignaturesIn = (bytes: Uint8Array, into: Set<string>): void => {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return
  }
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (SIG.test(node)) into.add(node.toLowerCase())
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        if (SIG.test(key)) into.add(key.toLowerCase())
        walk(item)
      }
    }
  }
  walk(value)
}

/**
 * Reclaim orphaned content.
 *
 * `sizeOfBlob` reports the size of loose (>=64KiB) content the engine does
 * not itself hold, and `sweepBlob` unlinks it — the packed engine only knows
 * about records inside its own file, and blobs live beside it as sig-named
 * files. Both are optional: omit them and only packed content is collected.
 */
export const collect = async (
  engine: PackedStoreEngine,
  options?: {
    looseSigs?: () => Promise<string[]>
    sizeOfBlob?: (sig: string) => Promise<number>
    sweepBlob?: (sig: string) => Promise<boolean>
    /**
     * Pool ADDRESSES (sign(meaning)) whose members are DERIVED CACHES — the
     * `index` kind, wipe-safe by declaration. Their members are named by the
     * very signatures this walk decides about and their bytes enumerate what
     * they were derived from, so crediting them keeps a layer alive purely
     * because an accelerator had been minted for it — and the original image
     * can never be reclaimed once its thumbnail exists. A cache may never
     * change what the collector keeps (optimize-phase.md rule 3), so these
     * pools are skipped WHOLE, name and bytes — the same rule
     * HistoryService.referencesOutside applies on the OPFS side.
     *
     * The bias in the header still holds for everything else: an UNDECLARED
     * pool credits. Only a pool the registry knows to be wipe-safe is skipped,
     * and the caller (the bridge, on the main thread, where the registry
     * lives) says which those are.
     */
    wipeSafePools?: ReadonlySet<string>
  },
): Promise<Collected> => {
  const reachable = new Set<string>()
  const worklist: string[] = []

  // ROOTS: everything every marker points at, in every bag — not the heads.
  for (const bag of engine.bags()) {
    for (const index of engine.markerIndices(bag)) {
      const marker = engine.getMarker(bag, index)
      if (marker) collectSignaturesIn(marker, reachable)
    }
  }
  // Pool members are not layers, but they may REFERENCE content — a clipboard
  // entry naming a copied image, for one. Their referents must survive.
  const wipeSafe = options?.wipeSafePools
  for (const pool of engine.pools()) {
    if (wipeSafe?.has(pool.toLowerCase())) continue   // a derived cache is not a reference
    for (const member of engine.poolMembers(pool)) {
      // The member's NAME is itself a content signature — under the molecule
      // model a member IS an atom's address. Reading only its BYTES left the
      // atom unreferenced, so the sweep below deleted `<root>/<sig>` while
      // the pool still named it.
      //
      // AT ANY DEPTH. Pools nest one level and the packed store keys a
      // sub-bucket member as `<bucket>/<leaf>` (packed-store.worker.ts drains
      // it that way; native-filesystem.ts documents the same shape), so
      // testing the whole key missed every `putPoolDoc(pool, bytes, subKey)`
      // writer — and missed exactly the shape the molecule model puts another
      // participant's data in, `sign(name)/<pubkey>/<claim>`. The LAST segment
      // is the member's own name.
      const leaf = member.slice(member.lastIndexOf('/') + 1)
      if (isSigName(leaf)) reachable.add(leaf.toLowerCase())
      const bytes = engine.getPool(pool, member)
      if (bytes) collectSignaturesIn(bytes, reachable)
    }
  }

  worklist.push(...reachable)

  // Transitive closure. A layer's children are layers; those reference more
  // content; and so on to the leaves.
  while (worklist.length) {
    const sig = worklist.pop()!
    const bytes = engine.getContent(sig)
    if (!bytes) continue
    const found = new Set<string>()
    collectSignaturesIn(bytes, found)
    for (const next of found) {
      if (!reachable.has(next)) { reachable.add(next); worklist.push(next) }
    }
  }

  const collected: Collected = { reachable: reachable.size, swept: 0, bytes: 0 }

  for (const sig of engine.contentSigs()) {
    if (reachable.has(sig.toLowerCase())) continue
    const size = engine.getContent(sig)?.length ?? 0
    if (engine.sweepContent(sig)) {
      collected.swept++
      collected.bytes += size
    }
  }

  // Loose blobs: the same reachability answer, a different unlink.
  if (options?.looseSigs && options.sweepBlob) {
    for (const sig of await options.looseSigs()) {
      if (reachable.has(sig.toLowerCase())) continue
      const size = options.sizeOfBlob ? await options.sizeOfBlob(sig) : 0
      if (await options.sweepBlob(sig)) {
        collected.swept++
        collected.bytes += size
      }
    }
  }

  return collected
}
