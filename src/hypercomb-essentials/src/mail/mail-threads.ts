// mail/mail-threads.ts
//
// WHAT A LIST SHOWS, AND IN WHAT ORDER. Pure: rows in, an order, a filter and
// conversations out. No DOM, no network, no storage.
//
// ── ONE ORDER, FROM THE FIRST ROW TO THE LAST ───────────────────────────────
//
// The service opens a page's rows a few at a time and tells the window about
// each as it opens, in no particular order; then it hands back the whole page
// sorted newest first. If the window drew rows in arrival order and re-sorted
// at the end, the list would jump the moment it finished. So the window places
// each row where the finished page will have it, by the SAME order the service
// sorts by (the sealed `at`, else the arrival time; ties by signature), and the
// finished page lands without moving anything.
//
// ── A CONVERSATION IS WHAT ITS MESSAGES NAME ────────────────────────────────
//
// Messages are grouped by the ids they carry: their own Message-ID, the one
// they reply to, and the References they keep (the host keeps the last three).
// Two messages that name a common id are one conversation, however the chain
// between them was cut. A conversation keeps the key it was first drawn under
// (`keep`), so a reply arriving later joins the row that is already on screen
// rather than replacing it.

export interface ThreadItem {
  readonly sig: string
  readonly at: number
  readonly meta: {
    readonly at?: number
    readonly messageId?: string
    readonly inReplyTo?: string
    readonly references?: readonly string[]
  } | null
  readonly marks?: { readonly read?: boolean; readonly hidden?: boolean; readonly flagged?: boolean } | null
}

export interface Thread<T extends ThreadItem> {
  /** Stable while the conversation is on screen (see `keep`). */
  readonly key: string
  /** Newest first. */
  readonly items: readonly T[]
  readonly newest: T
  readonly count: number
  /** Members never marked read and not hidden. */
  readonly unread: number
  readonly flagged: boolean
}

/** When a row happened: the sealed time, else the time it arrived at the host. */
export const timeOf = (item: Pick<ThreadItem, 'at' | 'meta'>): number => item.meta?.at ?? item.at

/** The service's own order: newest first, ties by signature. */
export const newestFirst = (a: Pick<ThreadItem, 'sig' | 'at' | 'meta'>, b: Pick<ThreadItem, 'sig' | 'at' | 'meta'>): number =>
  timeOf(b) - timeOf(a) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0)

/**
 * `list` with `item` in the place the sorted page will give it. A row already
 * held (same signature) is replaced where it stood, so a refresh re-reporting
 * it moves nothing. Returns a new array; `list` must already be in this order.
 */
export function placeNewestFirst<T extends Pick<ThreadItem, 'sig' | 'at' | 'meta'>>(list: readonly T[], item: T): T[] {
  const out = list.filter(held => held.sig !== item.sig)
  let low = 0
  let high = out.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (newestFirst(out[mid]!, item) <= 0) low = mid + 1
    else high = mid
  }
  out.splice(low, 0, item)
  return out
}

const ID = /<[^<>\s]{1,200}>/g

const idsOf = (meta: ThreadItem['meta']): string[] => {
  if (!meta) return []
  const said = [meta.messageId, meta.inReplyTo, ...(Array.isArray(meta.references) ? meta.references : [])]
  const out: string[] = []
  for (const value of said) for (const id of String(value ?? '').match(ID) ?? []) out.push(id.toLowerCase())
  return out
}

/**
 * The conversations in `items`, newest conversation first. `keep` maps a
 * member's signature to the key its conversation was drawn under before; a
 * conversation takes the key of its oldest member that has one, unless another
 * conversation (newer, or one that split) already took it.
 */
export function threadsOf<T extends ThreadItem>(items: readonly T[], keep?: ReadonlyMap<string, string>): Thread<T>[] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]! }
    return i
  }
  const seen = new Map<string, number>()
  items.forEach((item, i) => {
    for (const id of idsOf(item.meta)) {
      const other = seen.get(id)
      if (other === undefined) { seen.set(id, i); continue }
      const a = find(i)
      const b = find(other)
      if (a !== b) parent[a] = b
    }
  })

  const groups = new Map<number, T[]>()
  items.forEach((item, i) => {
    const root = find(i)
    const group = groups.get(root)
    if (group) group.push(item); else groups.set(root, [item])
  })

  const ordered = [...groups.values()].map(group => [...group].sort(newestFirst)).sort((a, b) => newestFirst(a[0]!, b[0]!))
  const used = new Set<string>()
  return ordered.map(members => {
    const oldestFirst = [...members].reverse()
    const kept = oldestFirst.map(m => keep?.get(m.sig)).find(k => !!k && !used.has(k))
    let key = kept ?? oldestFirst.map(m => m.sig).find(sig => !used.has(sig))
    if (!key) {
      // A conversation that split can find its every member's key taken by the other half.
      const base = oldestFirst[0]!.sig
      let n = 2
      while (used.has(`${base}:${n}`)) n++
      key = `${base}:${n}`
    }
    used.add(key)
    return {
      key,
      items: members,
      newest: members[0]!,
      count: members.length,
      unread: members.filter(m => !m.marks?.read && !m.marks?.hidden).length,
      flagged: members.some(m => !!m.marks?.flagged),
    }
  })
}

/** What the participant typed into the search box, as words to find. */
export const searchWords = (query: string): string[] =>
  String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)

/** Every word appears somewhere in the fields (case aside). No words matches everything. */
export const matchesWords = (fields: readonly (string | null | undefined)[], words: readonly string[]): boolean => {
  if (!words.length) return true
  const hay = fields.filter(Boolean).join('\n').toLowerCase()
  return words.every(word => hay.includes(word))
}
