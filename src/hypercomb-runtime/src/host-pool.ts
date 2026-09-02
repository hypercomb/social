// hypercomb-runtime/src/host-pool.ts
//
// DISCOVERY IS A POOL OF MEANING. No document, no catalogue, no filename two
// parties had to agree on.
//
// A client works out WHERE to ask the same way it works out every other pool
// address: `sign(<meaning>)`. Nothing is published saying "the list is over
// here" — the address falls out of the meaning, identically for every client
// and every host, and a host that holds nothing simply answers 404.
//
// WHAT THE POOL HOLDS. One package signature per entry, at an 8-digit index,
// appended in the order the host shipped them. The MAX INDEX IS THE HEAD —
// the same rule a lineage sigbag already uses (documentation/history-sigbag-as-root.md).
// There is no counter to sort by, no `previous` to chase and no catalogue to
// corrupt: an interrupted ship costs one entry, never the list.
//
// AND THAT IS ALL A CLIENT NEEDS. Measured across the whole published chain:
// a package's layers, bees and dependencies derive from its sealed root, its
// beeDeps derive from the bees and deps themselves, and the import-map bag is
// each dependency's own first line paired with its file name. One signature
// expands into everything (documentation/host-packages-pool.md).
//
// WHY PROBING, AND NOT AN INDEX THE HOST RENDERS. HTTP has no directory
// listing, so a walk is unavoidable — but serving `/<pool>/00000007` is
// serving a file, which a bucket, a Pages deployment and a relay all do
// identically. The moment a host has to COMPUTE a listing it stops being a
// pile of bytes, and half the things that can host a hive stop qualifying.
// Doubling-then-bisecting costs ~2·log2(n) requests: sixteen for a host that
// has shipped a hundred and seventy-six times.

/** The meaning whose signature addresses a host's published packages. It
 *  carries a COLON by the collision rule: `lineageKey` folds every
 *  non-alphanumeric to `-`, so no location can ever mint this address. */
export const HOST_PACKAGES_MEANING = 'host:packages'

/** Entry filenames are fixed-width so they sort lexically as they sort
 *  numerically — the width builds already emit for sigbag markers. */
export const poolEntryName = (index: number): string => String(index).padStart(8, '0')

/** No pool has an entry at this index; it exists to stop a broken host that
 *  answers 200 to everything from spinning the probe forever. */
const PROBE_CEILING = 1 << 20

/**
 * The highest index present, or -1 for a pool with nothing in it.
 *
 * Entries are APPEND-ONLY and therefore gapless, which is what makes the
 * bisect sound: `has(i)` is monotonically decreasing in `i`, so the boundary
 * between present and absent is the head. A host that deletes from the middle
 * breaks that promise — and would break a sigbag the same way, which is why
 * neither is ever rewritten in place.
 *
 * Doubling first, because the walk must not assume a size: a host that has
 * shipped twice should cost two probes, not a search over a range someone
 * guessed.
 */
export const headIndex = async (has: (index: number) => Promise<boolean>): Promise<number> => {
  if (!(await has(0))) return -1

  let present = 0
  let absent = 1
  while (await has(absent)) {
    present = absent
    absent *= 2
    if (absent > PROBE_CEILING) return present
  }

  // `present` is held, `absent` is not; the head is the last index before the
  // boundary.
  while (absent - present > 1) {
    const middle = Math.floor((present + absent) / 2)
    if (await has(middle)) present = middle
    else absent = middle
  }
  return present
}

const SIG_RE = /^[a-f0-9]{64}$/

/**
 * The head package a host publishes, or null when it publishes none.
 *
 * `read` answers an entry's text or null; a malformed entry is treated as
 * absent rather than trusted, so a host cannot point a client at something
 * that is not a signature. It could still point at a signature it has no
 * bytes for — which costs a hole at admission, not a wrong install.
 */
export const headPackageSig = async (
  read: (index: number) => Promise<string | null>,
): Promise<string | null> => {
  const index = await headIndex(async i => (await read(i)) !== null)
  if (index < 0) return null
  const text = (await read(index))?.trim().toLowerCase() ?? ''
  return SIG_RE.test(text) ? text : null
}
