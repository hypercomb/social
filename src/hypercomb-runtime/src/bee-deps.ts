// hypercomb-runtime/src/bee-deps.ts
//
// WHICH DEPENDENCY BELONGS TO WHICH BEE — worked out from the bytes, not
// taken from a host.
//
// `beeDeps` is the map the dependency loader uses to leave a bee's own
// dependencies out of the eager boot pass (dependency-loader.ts): deps claimed
// by a bee are lazy-loaded by the preloader when that bee is actually
// instantiated. It is a HINT and nothing more — with no map at all every
// dependency loads eagerly and the hive is exactly as correct, just heavier at
// boot (measured on the live chain: 11 of 55 deps, 0.96 MB of 4.66 MB).
//
// It used to ride in the host's manifest, which made it the last piece of
// inventory a domain asserted about a package. It is derivable instead, and
// this is the derivation — the same two patterns build-module.ts applies at
// build time, run over bytes that have already hashed to their own names
// (documentation/host-packages-pool.md).
//
// WHY AT ADMISSION, not in the optimize phase. Everything here is already in
// hand and already verified at the moment a package is admitted, so the
// derivation costs one pass over local bytes and the answer is ready for the
// FIRST boot. Deferring it to an idle pass would buy nothing and cost the
// participant one heavy boot per install.
//
// IT IS A DERIVATION OVER BUNDLER OUTPUT, so it is allowed to come back empty:
// a build that emits a different shape yields fewer matches and no error. That
// is survivable precisely because the map is a hint — a miss costs eager
// loading, never a wrong install. Nothing may make it load-bearing.

/** Classes a dependency bundle defines. esbuild emits both spellings. */
const CLASS_RE = /(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))/g

/** A bee's declared `deps = { … }` block, and the `@scope/Class` names in it. */
const DEPS_BLOCK_RE = /deps\s*=\s*\{([^}]+)\}/
const DEP_NAME_RE = /@[^"'/]+\/(\w+)/g

const text = (bytes: Uint8Array): string | null => {
  const decoded = new TextDecoder().decode(bytes)
  return decoded.includes('�') ? null : decoded
}

/**
 * Map each bee signature to the dependency signatures it claims.
 *
 * `read` resolves a signature to its admitted bytes; a signature it cannot
 * answer for is skipped rather than failing the derivation — a partial map is
 * a partial optimization, which is the correct degradation for a hint.
 *
 * Bees claiming nothing are omitted entirely, so an empty result and "no bee
 * claims anything" are the same value, as they should be.
 */
export const deriveBeeDeps = async (
  bees: readonly string[],
  dependencies: readonly string[],
  read: (signature: string) => Promise<Uint8Array | null>,
): Promise<Record<string, string[]>> => {
  const classToDep = new Map<string, string>()
  for (const dependency of dependencies) {
    const bytes = await read(dependency)
    const source = bytes && text(bytes)
    if (!source) continue
    for (const match of source.matchAll(CLASS_RE)) {
      const name = match[1] || match[2]
      if (name) classToDep.set(name, dependency)
    }
  }
  if (!classToDep.size) return {}

  const beeDeps: Record<string, string[]> = {}
  for (const bee of bees) {
    const bytes = await read(bee)
    const source = bytes && text(bytes)
    if (!source) continue
    const block = source.match(DEPS_BLOCK_RE)
    if (!block?.[1]) continue
    const claimed = new Set<string>()
    for (const match of block[1].matchAll(DEP_NAME_RE)) {
      const dependency = match[1] && classToDep.get(match[1])
      if (dependency) claimed.add(dependency)
    }
    if (claimed.size) beeDeps[bee] = [...claimed].sort()
  }
  return beeDeps
}
