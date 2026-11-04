// hypercomb-core/src/core/legacy-dirs.ts
//
// THE RETIRED DIRECTORY NAMES, IN ONE PLACE.
//
// Typed folders are eradicated (CLAUDE.md, "OPFS"): the only directories that
// exist are signature-named — lineage sigbags and `sign(meaning)` pools. The
// names below are what they replaced. A replica that has not yet drained may
// still carry one, so a reader opens it WITHOUT create as a read-fallback and
// a walker must know it is not a tile; nothing ever WRITES to one.
//
// That knowledge was kept as string literals in a dozen files, each with its
// own subset, and each one drifted (a swarm walk that missed `__location__`,
// an archive reader that missed `__optimized__`). This map is the one source:
// callers import a name from here and never type it. `doctrine.spec.ts` holds
// the line — a `__x__` literal outside this file (and the store, which names
// the same constants for its own drains) fails the suite.
//
// Pool QUESTIONS are not answered here, and this file imports nothing (build
// scripts read it too). A bare directory that is a pool meaning (`clipboard`,
// `overrides`, …) is the registry's to judge — `isReservedPoolWord` /
// `isPoolAddress` — and `isSystemDirectoryName` (molecule-address.ts) asks them
// rather than keeping a list.

/** Every retired directory name, keyed by what it held. FROZEN: this map may
 *  only shrink, as the last replica that carried one drains. */
export const LEGACY_DIRECTORIES = Object.freeze({
  // the content roots
  hive: '__hive__',
  hypercombIo: 'hypercomb.io',
  // build content
  layers: '__layers__',
  bees: '__bees__',
  dependencies: '__dependencies__',
  resources: '__resources__',
  optimized: '__optimized__',
  optimization: '__optimization__',
  // records
  history: '__history__',
  temporary: '__temporary__',
  location: '__location__',
  clipboard: '__clipboard__',
  threads: '__threads__',
  computation: '__computation__',
  manifests: '__manifests__',
  // the pre-colon i18n dirs (not underscore-typed: bare pool words)
  overrides: 'overrides',
  translations: 'translations',
} as const)

export type LegacyDirectory = keyof typeof LEGACY_DIRECTORIES

/** The build-content dirs a delivery target may still carry. */
export const LEGACY_BUILD_DIRECTORIES: readonly string[] = Object.freeze([
  LEGACY_DIRECTORIES.layers,
  LEGACY_DIRECTORIES.bees,
  LEGACY_DIRECTORIES.dependencies,
])

const LEGACY_NAMES: ReadonlySet<string> = new Set(Object.values(LEGACY_DIRECTORIES))

/** Is `name` one of the retired directory names above? */
export const isLegacyDirectoryName = (name: string): boolean => LEGACY_NAMES.has(name)

/** The retired TYPED-folder shape: `__word__`. Recognised by shape, so a typed
 *  name nobody listed is still never a tile. */
export const isTypedFolderName = (name: string): boolean =>
  name.length > 4 && name.startsWith('__') && name.endsWith('__')
