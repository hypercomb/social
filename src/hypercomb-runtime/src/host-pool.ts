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
 * ONE MEMBER OF THE POOL.
 *
 * Line one is the package signature and is the only line that matters — a
 * reader that wants nothing else stops there, and always could, whatever a
 * later ship decides to write underneath.
 *
 * Line two, when present, is the MARK the package wears: the branch it was
 * shipped from. It is not identity and it cannot decide what installs; it is
 * what lets a picker say `main` and `development` instead of showing a
 * hundred and seventy-nine indistinguishable signatures. Keeping it HERE,
 * with the member, is the whole difference from a manifest: nothing lists
 * everything, so there is no catalogue to keep in agreement and an interrupted
 * ship still costs exactly one entry.
 *
 * The same two-line idiom the dependency bag already uses (`@alias` then the
 * signature) — an indexed pool entry carrying a pair.
 */
export type PoolMember = {
  packageSig: string
  /** The branch mark, or '' for an entry that wears none. */
  label: string
}

/** Parse one entry. Anything that is not a signature on line one is treated as
 *  absent rather than trusted: a host cannot point a client at a thing that is
 *  not content-addressed. It CAN name a signature it has no bytes for — which
 *  costs a hole at admission, never a wrong install. */
export const parseMember = (text: string | null): PoolMember | null => {
  if (text === null) return null
  const [first = '', second = ''] = text.split('\n')
  const packageSig = first.trim().toLowerCase()
  if (!SIG_RE.test(packageSig)) return null
  return { packageSig, label: second.trim().slice(0, 64) }
}

/** Serialise one entry. Sig alone when it wears no mark, so the common case
 *  stays exactly the 64 bytes it was. */
export const formatMember = (packageSig: string, label = ''): string =>
  label.trim() ? `${packageSig}\n${label.trim()}` : packageSig

/** The head package a host publishes, or null when it publishes none. */
export const headPackageSig = async (
  read: (index: number) => Promise<string | null>,
): Promise<string | null> => {
  const index = await headIndex(async i => (await read(i)) !== null)
  if (index < 0) return null
  return parseMember(await read(index))?.packageSig ?? null
}
