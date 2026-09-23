// commands/named-target.ts
//
// `<cell> = <tags>` — the named form of /keyword. The word and the slash
// drone's machine gate read it through one reader, and a bee is never
// imported for a value (atomic-modules-plan.md), so it lives here.

/** `<cell> = <tags>` — the named form, or undefined when the line uses none.
 *  One reader for the parser and for the machine gate, so the two can never
 *  disagree about what a line means. */
export const readNamedTarget = (
  args: string,
): { cell: string; tags: string } | { refuse: string } | undefined => {
  const equals = args.indexOf('=')
  if (equals === -1) return undefined
  const cell = args.slice(0, equals).trim()
  const tags = args.slice(equals + 1).trim()
  if (!cell || cell.includes('/') || cell.includes(String.fromCharCode(92))) {
    return { refuse: 'the named form is /keyword <cell> = <tag>, one tile on this page' }
  }
  if (!tags) return { refuse: '/keyword needs at least one tag after =' }
  return { cell, tags }
}
