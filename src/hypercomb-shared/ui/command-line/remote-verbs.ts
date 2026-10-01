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

/** THE HEAD OF A SLASH LINE: after the slash, trimmed, up to the first
 *  whitespace, `(` or `[` — the union of what `#executeSlashBehaviour` (space,
 *  paren) and `SlashBehaviourBehavior` (space, bracket) split on — folded as
 *  the registry folds it. The canonical reading is kept beside it, folded, so
 *  nothing this door refused before is admitted now (`/remove.drafts` names
 *  `remove` to one reading and nothing the registry holds to the other). */
export const slashVerbsOf = (line: string): readonly string[] => {
  const folded = line.trimStart().toLowerCase()
  if (!folded.startsWith('/')) return []
  const dispatched = folded.slice(1).trim().split(/[\s(\[]/, 1)[0]
  return [...new Set([canonicalVerbOf(folded), dispatched])].filter(Boolean)
}

/** `~label:tag` takes a TAG off and touches no tile: the tag extractor's own
 *  shape for it, consumed whole before any routing. A line carrying `@` is not
 *  trusted to be one — a behaviour call skips the extractor. */
const TAG_REMOVAL_RE = /^~([^:]+):([^(]+)(?:\(([^)]+)\))?$/
const takesTagOff = (item: string): boolean => {
  const match = item.includes('@') ? null : item.match(TAG_REMOVAL_RE)
  return !!match && !!normalizeCell(match[1]) && !!match[2].trim()
}

/** THE OP AFTER A LEADING BRACKET, and any `~item` inside it. The op is found
 *  as `#executeSelectCommand` finds it — legacy `/select[…]` normalised, the
 *  first `]`, then `/word` — and a `~item` is the per-item remove that
 *  `#applyBracketItemOps` (and `CutPasteBehavior`) carry out. The dispatch
 *  stops the word at a hyphen (`\w+`); the hyphenated word is judged as well,
 *  so the day it reads `[x]/break-apart` whole the door already does. */
const bracketVerbsOf = (line: string): readonly string[] => {
  const v = normalizeSelectInput(line.trim())
  const close = v.indexOf(']')
  if (!v.startsWith('[') || close < 0) return []
  const tail = v.slice(close + 1).toLowerCase()
  const ops = [tail.match(/^\/(\w+)/)?.[1], tail.match(/^\/([\w-]+)/)?.[1]]
  const removes = v.slice(1, close).split(',').map(item => item.trim())
    .some(item => item.startsWith('~') && !takesTagOff(item))
  return [...ops, ...(removes ? ['remove'] : [])].filter((verb): verb is string => !!verb)
}

/** A LEADING `~` IS `remove` (jwize, 2026-10-01) — `~drafts`, `~[a, b]` — in
 *  all but two readings, neither of which takes a tile away: a tag coming off
 *  (`~label:tag`), and a view coming off a tile (`~tile@view`), which only the
 *  live view registry can tell apart from a tile's name, so the door is asked. */
const tildeVerbsOf = (line: string, detachesView: (line: string) => boolean): readonly string[] => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('~') || takesTagOff(trimmed) || detachesView(line)) return []
  return ['remove']
}

/** Every verb the legacy pipeline will act on in a line the reader matched
 *  nothing in. Empty for plain prose, which names no behaviour at all. */
export const dispatchedVerbsOf = (
  line: string,
  detachesView: (line: string) => boolean = () => false,
): readonly string[] => [...new Set([
  ...slashVerbsOf(line),
  ...bracketVerbsOf(line),
  ...tildeVerbsOf(line, detachesView),
])]
