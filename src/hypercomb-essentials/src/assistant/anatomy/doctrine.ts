// assistant/anatomy/doctrine.ts
//
// THE DOCTRINE'S SECTIONS, as the anatomy composes them. The doctrine itself
// is a hierarchy of tiles in the hive (doctrine-tree.ts; jwize, 2026-11-16:
// "The doctrine is a hierarchy of tiles like everything else"); each tier
// becomes one section here, `### <heading>`, a source line, then its rules.
//
// RETIRED 2026-11-16: the `system:doctrine` bag (a record of section
// resources, 8-digit markers, `doctrine back` / `drop` / `seed`, the doctrine
// window). Tiles are the only way to change the doctrine. Nothing was
// deleted: a hive that has the bag keeps it, unread, every record still
// readable by its signature.

/** The heading a section opens with (`### <heading>`), or '' when it opens with none. */
export const headingOf = (section: string): string => {
  const first = section.split('\n', 1)[0] ?? ''
  return first.startsWith('### ') ? first.slice(4).trim() : ''
}

/** Where a section came from: the `(source: …)` line under its heading. */
export const sourceOf = (section: string): string =>
  /^\(source: ([^)]+)\)$/m.exec(section.split('\n').slice(1, 3).join('\n'))?.[1] ?? ''

/** The anatomy as a model reads it: the mechanics (doctrine header included),
 *  then the sections. The same composition build-anatomy.ts writes, so the
 *  build's codex composes to the build's own bytes. */
export const composeAnatomy = (mechanics: string, sections: readonly string[]): string =>
  `${mechanics}\n${sections.join('\n\n')}\n`
