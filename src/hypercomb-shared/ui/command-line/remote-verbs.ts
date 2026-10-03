// hypercomb-shared/ui/command-line/remote-verbs.ts
//
// THE VERBS A REMOTE LINE WILL BE DISPATCHED ON — read the way the dispatchers
// read them, not the way a machine is supposed to write them.
//
// The remote door (command-line.component.ts, the REMOTE_SUBMIT listener)
// judged a slash line by core's `canonicalVerbOf`, which is the MODEL
// CHANNEL's shape: lowercase, the word hard against the slash. The dispatch
// behind the door is looser, and every place it is looser was a way round:
//
//   `/Remove drafts`   the registry folds the name (`SlashBehaviourDrone.has`
//                      and `.execute` lowercase it; `QueenBee.matches` too)
//   `/ remove drafts`  the executor trims after the slash before it splits
//   `[drafts]/remove`  the op after a bracket runs in `#executeSelectCommand`,
//                      which hands any registered word to the registry
//   `~drafts`          the sigil removes with no verb word at all
//   `meetup@postit`    a view that is not attachable runs its own word
//
// Each read as NO VERB at the door, so the gate was never asked, and each ran.
// Found by reading 2026-09-30, confirmed by running the registry and the
// reader on the lines the door had passed.
//
// So the door asks about what the dispatch will resolve. This is NOT a second
// admission rule — core's `machine-admission` still decides — and it leans on
// the dispatch's own pieces wherever one can be shared (`normalizeSelectInput`,
// `normalizeCell`); the splits it has to restate are pinned to the source by
// remote-verbs.spec.ts. Where the two could differ it reads WIDE: a line
// judged that would not have run is a refusal a caller can read, and the
// other direction is the defect.
//
// A pure module, apart from the component, so the reading can be RUN by a
// spec rather than only read as source.

import { canonicalVerbOf, normalizeCell } from '@hypercomb/core'
import { normalizeSelectInput } from './select-ops'

/** ONE VERB A LINE WILL BE DISPATCHED ON — and, where its behaviour is handed
 *  its own argument language, exactly the arguments it will be handed, so the
 *  door can run the behaviour's own `refuse` on them as the model channel
 *  does. `args` is absent where the verb acts on something else — a bracket's
 *  selection, a `~` sigil, a reading the registry will not run — and then the
 *  verb is judged for reach and scope alone. */
export type SpokenCall = { readonly verb: string; readonly args?: string }

/** The name and arguments `#executeSlashBehaviour` splits a slash line into:
 *  after the slash, trimmed, cut at the first space or `(` — the args start
 *  AT a paren and AFTER a space — exactly as typed. */
const executorCall = (raw: string): { name: string; args: string } => {
  const spaceIdx = raw.indexOf(' ')
  const parenIdx = raw.indexOf('(')
  const delimIdx = spaceIdx >= 0 && (parenIdx < 0 || spaceIdx < parenIdx) ? spaceIdx
    : parenIdx >= 0 ? parenIdx
    : -1
  return delimIdx === -1
    ? { name: raw, args: '' }
    : { name: raw.slice(0, delimIdx), args: raw.slice(delimIdx === parenIdx ? delimIdx : delimIdx + 1).trim() }
}

/** THE HEAD OF A SLASH LINE: after the slash, trimmed, up to the first
 *  whitespace, `(` or `[` — the union of what `#executeSlashBehaviour` (space,
 *  paren) and `SlashBehaviourBehavior` (space, bracket) split on — folded as
 *  the registry folds it. It carries the executor's args when the executor
 *  would ask the registry for that same word. The canonical reading is kept
 *  beside it, folded, so nothing this door refused before is admitted now
 *  (`/remove.drafts` names `remove` to one reading and nothing the registry
 *  holds to the other). */
const slashCallsOf = (line: string): readonly SpokenCall[] => {
  const trimmed = line.trimStart()
  if (!trimmed.startsWith('/')) return []
  const raw = trimmed.slice(1).trim()
  const head = raw.toLowerCase().split(/[\s(\[]/, 1)[0]
  const handed = executorCall(raw)
  const canonical = canonicalVerbOf(trimmed.toLowerCase())
  return [
    ...(head ? [handed.name.toLowerCase().trim() === head ? { verb: head, args: handed.args } : { verb: head }] : []),
    ...(canonical && canonical !== head ? [{ verb: canonical }] : []),
  ]
}

/** The verbs alone, for a reader that needs no arguments. */
export const slashVerbsOf = (line: string): readonly string[] =>
  [...new Set(slashCallsOf(line).map(call => call.verb))]

/** `~label:tag` takes a TAG off and touches no tile: the tag extractor's own
 *  shape for it, consumed whole before any routing. A line carrying `@` is not
 *  trusted to be one — a behaviour call skips the extractor. */
const TAG_REMOVAL_RE = /^~([^:]+):([^(]+)(?:\(([^)]+)\))?$/
const takesTagOff = (item: string): boolean => {
  const match = item.includes('@') ? null : item.match(TAG_REMOVAL_RE)
  return !!match && !!normalizeCell(match[1]) && !!match[2].trim()
}

/** The ops `#executeSelectCommand` carries out itself, on the bracket's
 *  names as a selection, before it hands any other word to the registry. Such
 *  an op is handed no argument language of its own — its targets are the
 *  names the bracket already gives — so it is judged for reach and scope only.
 *  Mirrors that method's branches; remote-verbs.spec.ts holds the two together. */
export const SELECT_BUILTIN_OPS: ReadonlySet<string> = new Set([
  'cut', 'copy', 'move', 'keyword', 'kw', 'tag', 'remove', 'rm', 'delete', 'del',
  'format', 'fmt', 'fp', 'opus', 'sonnet', 'haiku', 'o', 's', 'h',
])

/** THE OP AFTER A LEADING BRACKET, and any `~item` inside it. The op is found
 *  as `#executeSelectCommand` finds it — legacy `/select[…]` normalised, the
 *  first `]`, then `/word` — and a `~item` is the per-item remove that
 *  `#applyBracketItemOps` (and `CutPasteBehavior`) carry out. Any other op is
 *  handed to the registry with the words after it, so it carries them. The
 *  dispatch stops the word at a hyphen (`\w+`); the hyphenated word is judged
 *  as well, so the day it reads `[x]/break-apart` whole the door already does. */
const bracketCallsOf = (line: string): readonly SpokenCall[] => {
  const v = normalizeSelectInput(line.trim())
  const close = v.indexOf(']')
  if (!v.startsWith('[') || close < 0) return []
  const tail = v.slice(close + 1)
  const word = tail.match(/^\/(\w+)/)
  const op = word?.[1].toLowerCase()
  const hyphenated = tail.toLowerCase().match(/^\/([\w-]+)/)?.[1]
  const removes = v.slice(1, close).split(',').map(item => item.trim())
    .some(item => item.startsWith('~') && !takesTagOff(item))
  return [
    ...(op && word ? [SELECT_BUILTIN_OPS.has(op) ? { verb: op } : { verb: op, args: tail.slice(word[0].length).trim() }] : []),
    ...(hyphenated && hyphenated !== op ? [{ verb: hyphenated }] : []),
    ...(removes ? [{ verb: 'remove' }] : []),
  ]
}

/** What a `tile@view` line will do, as far as admission cares: take a view
 *  off a tile, or run a word. Only the live view registry can say, so the
 *  door reads it (`#featureOf` in the component) and hands it in. */
export type FeatureReading = { readonly remove: boolean; readonly command: string }

/** THE WORD A `tile@view` LINE RUNS beyond the `feature:apply` it emits —
 *  the view's own slash command, handed to the registry — or `''` when the
 *  emit is the whole of it. ONE ANSWER, asked by `#applyFeatureOps` before it
 *  runs the word and by the remote door before it lets the line through, so
 *  the word judged is the word run.
 *
 *  Nothing runs after the emit for:
 *   - a REMOVE: `feature:apply` takes the view off, and that is all;
 *   - a CALLED behaviour, which has been handed its content by the emit.
 *     Falling through to its bare slash command would toggle a view rather
 *     than author anything — the same trap `attachable` already dodges;
 *   - an ATTACHABLE behaviour, fully installed by the emit (its decoration
 *     written at the target). Running its slash command would be actively
 *     wrong: a view bee's bare command TOGGLES the view, so `diagram@slides`
 *     flipped the cell you're standing on into slides instead of making
 *     `diagram` a deck. The slash fallback is only for behaviours that still
 *     need their own authoring pass. */
export const viewCommandOf = (
  op: { readonly remove: boolean; readonly called?: boolean },
  bee: { readonly slashCommand?: string; readonly attachable?: boolean } | undefined,
): string => {
  if (!bee || op.remove || op.called || bee.attachable) return ''
  return (bee.slashCommand ?? '').replace(/^\//, '')
}

/** A LEADING `~` IS `remove` (jwize, 2026-10-01) — `~drafts`, `~[a, b]` — in
 *  all but two readings, neither of which takes a tile away: a tag coming off
 *  (`~label:tag`), and a view coming off a tile (`~tile@view`). */
const tildeCallsOf = (line: string, feature: FeatureReading | null): readonly SpokenCall[] => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('~') || takesTagOff(trimmed) || feature?.remove) return []
  return [{ verb: 'remove' }]
}

/** `tile@view` RUNS THE VIEW'S WORD, and that word is judged like any other —
 *  folded, as the registry folds it, and handed nothing (`#applyFeatureOps`
 *  runs it with no arguments). */
const viewCallsOf = (feature: FeatureReading | null): readonly SpokenCall[] => {
  const word = feature && !feature.remove ? feature.command.trim().toLowerCase() : ''
  return word ? [{ verb: word, args: '' }] : []
}

/** Every call the legacy pipeline will make in a line the reader matched
 *  nothing in. Empty for plain prose, which names no behaviour at all. The
 *  feature reading is asked once, and only of a line that could be a call.
 *  The same verb said two ways is judged both ways; an exact repeat once. */
export const dispatchedCallsOf = (
  line: string,
  featureOf: (line: string) => FeatureReading | null = () => null,
): readonly SpokenCall[] => {
  const feature = line.includes('@') ? featureOf(line) : null
  const calls = [...slashCallsOf(line), ...bracketCallsOf(line), ...tildeCallsOf(line, feature), ...viewCallsOf(feature)]
  const seen = new Set<string>()
  return calls.filter(call => {
    const key = call.args === undefined ? call.verb : call.verb + ' ' + JSON.stringify(call.args)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The verbs alone, for a reader that needs no arguments. */
export const dispatchedVerbsOf = (
  line: string,
  featureOf: (line: string) => FeatureReading | null = () => null,
): readonly string[] => [...new Set(dispatchedCallsOf(line, featureOf).map(call => call.verb))]
