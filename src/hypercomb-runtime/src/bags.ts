// hypercomb-runtime/src/bags.ts
//
// THE IMPORT-MAP BAGS, COMPUTED RATHER THAN FETCHED.
//
// A bag is the index the import map is assembled from: one entry per member,
// pairing a dependency's alias with its signature. The build emits two —
// dependencies and bees — and until now a client learned their addresses from
// the host's manifest and then downloaded them.
//
// It never had to. A bag entry is `<alias>\n<sig>\n`, the alias is the first
// line of the dependency's own compiled bytes (`// @hypercomb/essentials/editor`),
// and a bee's entry carries no alias at all. The bag SIGNATURE is the sha256
// of the entries sorted by signature and joined with NUL — every input of
// which a client already holds the moment admission completes.
//
// Verified against the six most recent published packages: both bag
// signatures recompute exactly, with nothing fetched.
//
// WHY THAT MATTERS BEYOND ONE ROUND TRIP. `beesBag` and `dependenciesBag` were
// the last two fields anyone could argue a host had to assert, and the
// argument was always "a bag signature is minted from the bag's own entries,
// so a client cannot know it before fetching the bag it names". True, and
// beside the point: the client does not need to know the signature, it needs
// the bag, and it can build one. With these gone the wire carries a package
// signature and nothing else, and a host's retention set becomes derivable
// from the signed tree alone (documentation/host-packages-pool.md).
//
// The shape here must stay byte-identical to `writeBag` in
// hypercomb-essentials/scripts/build-module.ts. It is content-addressed, so a
// stray character does not produce a slightly-wrong bag — it produces a
// different signature, and a bag nobody else has.

import { SignatureService } from '@hypercomb/core'

/** One member of a bag: what it is named by, and the bytes it holds. */
export type BagEntry = { sig: string; content: string }

/** Marker filename width — the conformance contract's, and the one the build
 *  emits. The bag signature comes from entry CONTENT, so the width never
 *  changes the address; it only decides what a reader finds on disk. */
export const bagEntryName = (index: number): string => String(index).padStart(8, '0')

/**
 * A dependency's alias, read out of its own first line.
 *
 * The build writes `// @scope/name` at the head of every compiled dependency
 * — the same line `resolveImportMap` has always used to name a module. An
 * unreadable or unmarked dependency yields '' and still takes its place in the
 * bag, exactly as the build would emit it.
 */
export const aliasOf = (bytes: Uint8Array | null): string => {
  if (!bytes) return ''
  const first = new TextDecoder().decode(bytes.slice(0, 512)).split('\n')[0] ?? ''
  return first.startsWith('// ') ? first.slice(3).trim() : ''
}

/** Dependency entries: alias line, signature line. */
export const dependencyEntries = (
  dependencies: readonly string[],
  aliasFor: (sig: string) => string,
): BagEntry[] => dependencies.map(sig => ({ sig, content: `${aliasFor(sig)}\n${sig}\n` }))

/** Bee entries: the same layout with an empty alias line. A bee is not
 *  imported by name, so it has none — the blank line is the build's, kept
 *  because the signature is over these bytes. */
export const beeEntries = (bees: readonly string[]): BagEntry[] =>
  bees.map(sig => ({ sig, content: `\n${sig}\n` }))

/**
 * A bag's signature: entries sorted by their own signature, contents joined
 * with NUL, sha256 of the result. Sorting by signature rather than by alias is
 * what makes the address independent of naming.
 */
export const bagSignature = async (entries: readonly BagEntry[]): Promise<string> => {
  const canonical = [...entries]
    .sort((a, b) => a.sig.localeCompare(b.sig))
    .map(entry => entry.content)
    .join('\0')
  return SignatureService.sign(new TextEncoder().encode(canonical).buffer as ArrayBuffer)
}

/** The entries in the order they are written — sorted by signature, so index
 *  i means the same member to everyone who builds this bag. */
export const orderedEntries = (entries: readonly BagEntry[]): BagEntry[] =>
  [...entries].sort((a, b) => a.sig.localeCompare(b.sig))
