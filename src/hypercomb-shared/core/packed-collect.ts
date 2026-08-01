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
  for (const pool of engine.pools()) {
    for (const member of engine.poolMembers(pool)) {
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
