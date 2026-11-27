// pools/pool-node.ts
//
// A NODE IS WHERE ENTRIES COME FROM. A domain you follow, or a participant in
// the room you joined: the two are one thing to a reader, the FROM of a query
// (T5 selection, T9). Nothing downstream asks which kind a node is, except to
// say its name.
//
// On the shelf a node is a small chip: initials when it has a name to take
// them from, and the whole name on hover and to a screen reader (jwize,
// 2026-11-24: "if they have a username the initials can be used ... but if
// hovered it should be the domain.com or participant full name").
//
// Pure: no DOM, no storage, nothing registered.

export type PoolNodeKind = 'domain' | 'participant'

export interface PoolNode {
  readonly kind: PoolNodeKind
  /** A domain's zone (`jwize.com`), or a participant's public key (64 hex). */
  readonly id: string
  /** What a participant calls themselves in the room. A domain has none: its zone is its name. */
  readonly name?: string
  /** True for the reader's own host or own key. */
  readonly you?: boolean
}

/** The key a node is switched on and off by, and de-duplicated by: its kind and its id. */
export const poolNodeKey = (node: Pick<PoolNode, 'kind' | 'id'>): string => `${node.kind}:${node.id}`

const letters = (word: string, count: number): string => Array.from(word).slice(0, count).join('')
const upper = (text: string): string => text.toLocaleUpperCase()

/** Words of a name: runs of letters and digits in any script. */
const wordsOf = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * The two characters a chip shows.
 *  - a participant with a name: the first letters of its first and last words
 *    ("Ana Maria Lopez" is AL), or the first two letters of a single word;
 *  - a domain: the same rule over its labels without the last one, so the
 *    ending does not crowd out the name ("jwize.com" is JW, "my-kitchen.org"
 *    is MK, "meetups.jwize.com" is MJ);
 *  - a participant with no name: the first two characters of its key, which is
 *    all there is to tell it by.
 */
export function poolNodeInitials(node: PoolNode): string {
  if (node.kind === 'domain') {
    const labels = node.id.split('.').filter(Boolean)
    const named = labels.length > 1 ? labels.slice(0, -1) : labels
    const words = wordsOf(named.join(' '))
    return initialsOf(words) || upper(letters(node.id, 2))
  }
  const words = wordsOf(node.name ?? '')
  return initialsOf(words) || upper(letters(node.id, 2))
}

function initialsOf(words: readonly string[]): string {
  if (!words.length) return ''
  if (words.length === 1) return upper(letters(words[0] as string, 2))
  return upper(letters(words[0] as string, 1) + letters(words[words.length - 1] as string, 1))
}

/**
 * The whole name: what hovering a chip says, and what a list prints. A domain
 * is its zone. A participant is the name they gave; without one, a short form
 * of their key, since a key is the only thing known about them.
 */
export function poolNodeTitle(node: PoolNode): string {
  if (node.kind === 'domain') return node.id
  const name = (node.name ?? '').trim()
  return name || `${node.id.slice(0, 8)}…`
}

/** Nodes once each, in the order given: the first mention of a node keeps its place and gains a later name. */
export function uniquePoolNodes(nodes: readonly PoolNode[]): PoolNode[] {
  const byKey = new Map<string, PoolNode>()
  for (const node of nodes) {
    const key = poolNodeKey(node)
    const held = byKey.get(key)
    if (!held) { byKey.set(key, node); continue }
    if (!held.name && node.name) byKey.set(key, { ...held, name: node.name })
    if (!held.you && node.you) byKey.set(key, { ...(byKey.get(key) as PoolNode), you: true })
  }
  return [...byKey.values()]
}
