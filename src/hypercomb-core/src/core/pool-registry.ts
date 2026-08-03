// core/pool-registry.ts
//
// THE POOL ADDRESS REGISTRY — which root directories are pools of meaning
// rather than lineage sigbags.
//
// WHY THIS EXISTS. Pools and lineage sigbags share ONE flat OPFS root
// namespace, and the root is an UNTAGGED UNION of the two:
//
//   pool address = sign(meaning)                = sha256(meaning)
//   bag address  = sign(lineageKey(segments))   = sha256(<slug>) for a
//                                                 single-segment location
//
// `lineageKey` preserves letters and digits, so for a BARE-WORD meaning the
// two preimages are byte-identical and the addresses ARE the same directory.
// Nothing on disk distinguishes them. Any code that walks the root and
// assumes "sig-named dir = lineage bag" will treat a pool as a bag, and any
// code that prunes a bag will destroy the pool's members.
//
// WHY A DENYLIST CANNOT WORK ALONE. A fixed list of meanings goes stale the
// moment any module mints a new pool — and modules are the whole point of
// the architecture. So this registry is BOTH:
//
//   1. SEEDED with the complete census of meanings live in the tree today
//      (so it is correct on the very first call, before any pool is opened),
//      and
//   2. SELF-EXTENDING — every `poolSignature(meaning)` derivation anywhere
//      registers its meaning here, so a pool minted by a module that this
//      file has never heard of still identifies itself the first time it is
//      addressed.
//
// COLLISION RULE FOR NEW MEANINGS: give the meaning a COLON (`websites:menu`,
// `usage:dwell`). `lineageKey` folds every non-letter/number to `-`, so a
// location can never produce a colon and a colon-carrying meaning is
// collision-proof by construction. The doctrine ratchet in `doctrine.spec.ts`
// freezes the bare-word set below — it may only shrink, never grow.

import { SignatureService } from './signature.service.js'

/**
 * BARE-WORD pool meanings — the ones that DO collide with a same-named
 * root tile. Frozen: this set may only shrink (as meanings are migrated to
 * colon-carrying spellings with a drain plan), never grow.
 *
 * Renaming one is not a code change but a DATA MIGRATION — sign() of a new
 * spelling mints a different address forever, so an unplanned rename strands
 * every existing member.
 */
export const BARE_WORD_POOL_MEANINGS: readonly string[] = Object.freeze([
  'authored',
  'bees',
  'clipboard',
  'computation',
  'dependencies',
  'host-push',
  'host-receipts',
  'manifests',
  'optimization',
  'overrides',
  'patches',
  'push',
  'receipts',
  'registry',
  'roots',
  'structure',
  // 'substrate' RETIRED — migrated to the colon-scoped `places:*` spellings
  // below. The old address stays a READ-FALLBACK drain source in
  // substrate.service.ts (see LEGACY_SUBSTRATE_POOL there); nothing writes
  // it. Do not re-add: this list may only shrink.
  'temporary',
  'threads',
  'translations',
  'viewport',
  'visual-optimization',
])

/** Collision-proof meanings — a colon can never appear in a lineage key.
 *
 *  An entry here RESERVES a spelling; it does not assert that the pool has
 *  members or even exists on disk. `pheromones:deposits` is reserved ahead of
 *  its build (see `documentation/pheromones.md`) precisely because the spelling
 *  is the expensive half: `sign()` of a typo mints a different address forever,
 *  so a later correction is a data migration, not an edit. */
export const SCOPED_POOL_MEANINGS: readonly string[] = Object.freeze([
  'pheromones:deposits',
  // 'places:references' / 'places:sources' — SHORT-LIVED, never shipped. The
  // substrate surface was briefly renamed Places before that name went to the
  // collections index instead. Both are drain sources in substrate.service.ts
  // (a dev build did write a registry record to `places:sources`) and neither
  // may be reserved here again.
  //
  // The substrate surface, re-spelled off its bare word. `:sources` holds the
  // registry record + per-location override records. `:references` holds one
  // file per copied reference, NAMED BY THE IMAGE SIGNATURE — the pool listing
  // IS the collection, so copying a reference in is the whole write and the
  // same image copied twice lands on one filename.
  // The packed store's own directory — it holds `hive.pack`, the INTERNAL
  // representation (conformance.md §7: internal form is not the protocol).
  // Reserved here so every root walker knows the address is a pool and never
  // mistakes it for a lineage bag, in packed mode or out of it.
  'store:packed',
  // The changes repository — one append-only record per act that touched a
  // group of tiles (see assistant/changes.ts). Colon-scoped so it can never
  // collide with a tile slugged 'changes'.
  'changes:log',
  'substrate:references',
  'substrate:sources',
  'tutorial:artifacts',
  'usage:dwell',
  'websites:menu',
])

/** Every meaning known at build time. */
const SEED_MEANINGS: readonly string[] = Object.freeze([
  ...BARE_WORD_POOL_MEANINGS,
  ...SCOPED_POOL_MEANINGS,
])

/** meaning → sign(meaning), populated lazily and never evicted. */
const addressByMeaning = new Map<string, string>()
/** The inverse — the set consulted by `isPoolAddress`. */
const meaningByAddress = new Map<string, string>()

let seeded: Promise<void> | null = null

const derive = async (meaning: string): Promise<string> => {
  const known = addressByMeaning.get(meaning)
  if (known) return known
  const sig = await SignatureService.sign(
    new TextEncoder().encode(meaning).buffer as ArrayBuffer,
  )
  addressByMeaning.set(meaning, sig)
  meaningByAddress.set(sig, meaning)
  return sig
}

/**
 * Record `meaning` as a pool address. Called from every `poolSignature`
 * derivation — the registration IS the side effect of addressing a pool, so
 * no module has to remember to opt in.
 */
export const registerPoolMeaning = async (meaning: string): Promise<string> =>
  await derive(meaning)

/** Resolve the seed census once. */
const ensureSeeded = async (): Promise<void> =>
  seeded ??= (async () => { for (const m of SEED_MEANINGS) await derive(m) })()

/**
 * Is `signature` the address of a pool of meaning? True for every seeded
 * meaning and for every pool addressed at runtime.
 *
 * A `true` answer means the directory is NOT (only) a lineage bag — callers
 * that prune, enumerate, or rewrite bags must leave it alone.
 */
export const isPoolAddress = async (signature: string): Promise<boolean> => {
  await ensureSeeded()
  return meaningByAddress.has(signature)
}

/** The meaning behind a pool address, for diagnostics. */
export const poolMeaningOf = async (signature: string): Promise<string | undefined> => {
  await ensureSeeded()
  return meaningByAddress.get(signature)
}

/** Every known pool address. Snapshot — callers must not mutate. */
export const poolAddresses = async (): Promise<ReadonlySet<string>> => {
  await ensureSeeded()
  return new Set(meaningByAddress.keys())
}

/** sign(meaning) → meaning for every known pool, for labelling a root
 *  listing. Snapshot — callers must not mutate. */
export const poolMeanings = async (): Promise<ReadonlyMap<string, string>> => {
  await ensureSeeded()
  return new Map(meaningByAddress)
}
