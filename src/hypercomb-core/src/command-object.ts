// command-object.ts — intellisense as objects.
//
// The command line answers one question — WHAT CAN COME NEXT HERE? — and it has
// historically answered it ten different ways, one per parsing mode, with each
// behaviour inventing its own argument grammar out of spaces. The cost is not
// the code, it is that a word's meaning depended on where the parser happened to
// be rather than on what the word IS: in `/canvas indigo dots`, nothing in the
// line said whether `dots` was a pattern, a palette or a flag.
//
// Here everything completable is an OBJECT with MEMBERS. A member may itself be
// an object. You walk in with dots and the completion offers the members of
// whatever you have walked into — the way member completion works in every
// editor anyone has ever used. Position is meaning.
//
// MEMBERSHIP HAS TWO HONEST SOURCES, and an object may be either:
//
//   a code registry — for things that ship with assets and code (the background
//     themes, the behaviours themselves). Their members are known statically.
//
//   a mark or a pool — for things the participant authors (tags, collections,
//     pheromones). Their members ARE the pool's contents or the tiles carrying a
//     mark, so painting a mark on a new tile grows the object with no code.
//
// INVOCATION IS NOT MEMBERSHIP. A pool gives a SET, never an action; it can say
// Ember exists but not what applying it does. So `invoke` stays code — what a
// mark decides is WHICH code, never a per-feature branch in the command line.
//
// `members` is SYNCHRONOUS on purpose. The dropdown is rendered from signals and
// draws now; a promise there would either block the keystroke or arrive after
// the participant has typed past it. An object whose membership is expensive
// caches internally and refreshes on its own event — the same contract every
// other registry in the codebase already keeps.

/** One thing that can come next. */
export interface CommandMember {
  /** The word typed to choose it. */
  name: string
  /** One line for the dropdown's right-hand column. */
  description?: string
  /** Material symbol name, when the member has an icon identity. */
  icon?: string
  /** A CSS `background` value — the chip drawn beside the name. Whole pictures
   *  (a theme swatch) and single colours (a tag) both go here. */
  swatch?: string
  /** Nothing walks below this one; typing a dot after it offers nothing. */
  leaf?: boolean
}

/**
 * Something that can be walked into. `path` is what has been walked SO FAR
 * (empty at the root), so an object decides its own members in context — which
 * is how a refusal is expressed: once a picture is pinned, the reach that
 * cannot apply to it simply stops being a member.
 */
export interface CommandObject {
  members(path: readonly string[]): readonly CommandMember[]
  invoke?(path: readonly string[]): Promise<string | void> | string | void
}

// Roots by name. A plain module-scope map, exactly like the pool registry next
// door: one core instance is shared through the import map at runtime and
// through the path alias at dev time, so there is one table.
const ROOTS = new Map<string, CommandObject>()

/** Contribute a root. Re-registering a name replaces it. */
export const registerCommandRoot = (name: string, object: CommandObject): void => {
  ROOTS.set(name.trim().toLowerCase(), object)
}

export const commandRoot = (name: string): CommandObject | undefined =>
  ROOTS.get(name.trim().toLowerCase())

export const commandRoots = (): readonly string[] => [...ROOTS.keys()]

/** Split an argument string into walked segments. Dots are the separator;
 *  spaces are accepted too, so a sentence that used to work keeps working. */
export const commandPath = (args: string): string[] =>
  args.toLowerCase().split(/[.\s]+/).filter(Boolean)

/**
 * The walk every behaviour used to hand-roll: split the argument string, ask
 * the object what may follow the segments already complete, and filter by the
 * segment still being typed. Returns FULL argument strings (`ember.dots`), which
 * is what the command line substitutes.
 *
 * A trailing separator means the last segment is complete and a fresh one has
 * started — `ember.` offers all of Ember's members, `ember.do` narrows them.
 */
export const completeCommandPath = (root: CommandObject, args: string): string[] => {
  const open = /[.\s]$/.test(args)
  const walked = commandPath(args)
  const head = open ? walked : walked.slice(0, -1)
  const typed = open ? '' : (walked[walked.length - 1] ?? '')
  const options = root.members(head)
  const matched = typed ? options.filter(m => m.name.startsWith(typed)) : options
  return matched.map(m => (head.length ? `${head.join('.')}.${m.name}` : m.name))
}

/** The members offered for an argument string, for callers that need the whole
 *  member (its swatch, its description) rather than just the word. Keyed by the
 *  same full argument strings `completeCommandPath` returns. */
export const commandMembersFor = (root: CommandObject, args: string): Map<string, CommandMember> => {
  const open = /[.\s]$/.test(args)
  const walked = commandPath(args)
  const head = open ? walked : walked.slice(0, -1)
  const out = new Map<string, CommandMember>()
  for (const member of root.members(head)) {
    out.set(head.length ? `${head.join('.')}.${member.name}` : member.name, member)
  }
  return out
}
