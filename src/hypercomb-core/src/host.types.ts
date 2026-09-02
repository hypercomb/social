// core/host.types.ts
//
// WHAT CONSUMES A DOMAIN. The contract, in core, where everything can reach it.
//
// Asking a domain what it publishes is not a feature of one shell. It is the
// first question a cold client asks and the standing question of every warm
// one, so the SHAPE of the answer belongs with the other universal primitives
// — beside I18nProvider, and for the same reason: a module must be able to use
// it without importing whoever implements it.
//
// CORE DOES NO IO, AND THIS FILE KEEPS IT THAT WAY. There is not one `fetch`
// in this package, which is precisely what lets core load in a worker, in
// node, in the native shell and in the shim. A network reader here would end
// that, so what lives here is the interface and the key; the implementation
// lives in runtime, which owns the io, and registers itself under that key.
//
// The direction this buys: essentials imports core and nothing else (doctrine),
// so a drone could never call runtime directly. Through this port it can —
// `get(HOST_IOC_KEY)` — and acquisition stops being something only a shell can
// do.
//
// A DOMAIN'S OWN VOICE IS ONE MUTABLE POINTER, because that is what a domain
// IS. Everything it names is content-addressed and verified on admission, so a
// hostile host can offer a different tree but never wrong bytes.
//
// WHAT IT NO LONGER SAYS: the inventory. A package's layers, bees and
// dependencies are DERIVED from its sealed root at admission — measured
// identical to the arrays hosts used to assert, across the whole published
// chain — so nothing a domain says can decide which modules run
// (documentation/host-packages-pool.md). The fields below survive only for the
// drain window, while hosts that have not shipped since are still read through
// their manifest.

/** IoC key for the host reader. Implemented in runtime, resolved anywhere. */
export const HOST_IOC_KEY = '@hypercomb.social/HostPackages'

/** One package a domain publishes. */
export interface HostPackageInfo {
  /** The domain that offered it. */
  zone: string
  /** The base its manifest answered on — atoms hang off this one. */
  base: string
  packageSig: string
  label: string
  at: string
  /** The counter a manifest stamps; null from the projection, which states its
   *  order instead of a number to sort by. */
  generation: number | null
  /** Inventory, and ONLY from a manifest — the projection carries none and
   *  admission derives its own. Empty is the normal, correct answer. */
  layers: string[]
  bees: string[]
  dependencies: string[]
  /** Display-only sizes. A count cannot widen or narrow what installs. */
  layerCount?: number
  beeCount?: number
  /** NOT derivable: a bag signature is minted from the bag's own entries, so a
   *  client cannot know it before fetching the bag it names. Without these the
   *  import map has no aliases. */
  beesBag?: string
  dependenciesBag?: string
}

/**
 * Reads what a domain publishes. One implementation, registered by runtime.
 *
 * `listPackages` answers newest-first, and answers with an EMPTY LIST for a
 * domain that publishes nothing, cannot be reached, or is not a host at all.
 * Those three are deliberately one outcome: a caller offering a choice has the
 * same thing to show in each case, and telling them apart is the host check's
 * job, which says which rule an origin misses and what to change.
 */
export interface HostProvider {
  listPackages(zone: string): Promise<HostPackageInfo[]>
  /** Every URL base worth asking for a zone, in order. */
  bases(zone: string): string[]
}
