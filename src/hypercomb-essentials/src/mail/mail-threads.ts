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
// they reply to, and the References they keep (the host keeps the last three,
// and so does this file, whatever a host sends). Two messages that name a
// common id AND say the same subject, once Re:/Fwd: are taken off, are one
// conversation, however the chain between them was cut. The subject is asked
// because an id is not a secret: a stranger who has seen (or guessed) your
// bank's Message-ID could otherwise name it and stand at the top of the bank's
// conversation as its newest message (R2 #6). Gmail asks the same.
// A conversation keeps the key it was first drawn under (`keep`), so a reply
// arriving later joins the row that is already on screen rather than
// replacing it.

export interface ThreadItem {
  readonly sig: string
  readonly at: number
  readonly meta: {
    readonly at?: number
    readonly subject?: string
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

/**
 * `list` with every row of `arriving` placed where the sorted page will have it, in one pass: the rows
 * held are kept by signature in a Map, so a row re-reported replaces the one held, and the two sorted
 * runs are merged. A page of rows arriving one by one costs one merge per drawn frame, not a copy of
 * the whole list per row (R2 #3: 2,000 rows took 12.9 s that way). Returns a new array; `list` must
 * already be in this order.
 */
export function mergeNewestFirst<T extends Pick<ThreadItem, 'sig' | 'at' | 'meta'>>(list: readonly T[], arriving: Iterable<T>): T[] {
  const fresh = new Map<string, T>()
  for (const item of arriving) fresh.set(item.sig, item)
  if (!fresh.size) return [...list]
  const held = list.filter(item => !fresh.has(item.sig))
  const incoming = [...fresh.values()].sort(newestFirst)
  const out: T[] = []
  let i = 0
  let j = 0
  while (i < held.length && j < incoming.length) out.push(newestFirst(held[i]!, incoming[j]!) <= 0 ? held[i++]! : incoming[j++]!)
  while (i < held.length) out.push(held[i++]!)
  while (j < incoming.length) out.push(incoming[j++]!)
  return out
}

const ID = /<[^<>\s]{1,200}>/g
/** What the Worker keeps of References (mail-plan.md §3): the last three. A host that sends more is cut here too. */
export const REFERENCES_KEPT = 3

const firstId = (value: unknown): string[] => {
  const id = String(value ?? '').match(ID)?.[0]
  return id ? [id.toLowerCase()] : []
}

// Read once per metadata object: a list is drawn again and again, and its rows' ids do not change.
const idsHeld = new WeakMap<object, readonly string[]>()

/**
 * The ids a row names: its own Message-ID, the one it replies to, and the last three References — never
 * more, so a host that sends two thousand references per row cannot make every redraw read them all.
 */
const idsOf = (meta: ThreadItem['meta']): readonly string[] => {
  if (!meta) return []
  const held = idsHeld.get(meta)
  if (held) return held
  const references = Array.isArray(meta.references) ? meta.references.slice(-REFERENCES_KEPT) : []
  const named: string[] = []
  for (const value of references) for (const id of String(value ?? '').match(ID) ?? []) named.push(id.toLowerCase())
  const ids = [...firstId(meta.messageId), ...firstId(meta.inReplyTo), ...named.slice(-REFERENCES_KEPT)]
  idsHeld.set(meta, ids)
  return ids
}

const PREFIX = /^(?:(?:re|fwd?)\s*(?:\[\d+\])?\s*:\s*)+/i

/** A subject as a conversation compares it: Re:/Fwd:/Fw: taken off the front, case and spacing aside. */
export const threadSubject = (subject: unknown): string =>
  String(subject ?? '').replace(/\s+/g, ' ').trim().replace(PREFIX, '').trim().toLowerCase()

/**
 * The conversations in `items`, newest conversation first. `keep` maps a
 * member's signature to the key its conversation was drawn under before; a
 * conversation takes the key of its oldest member that has one, unless another
 * conversation (newer, or one that split) already took it. `subjectOf` reads a
 * row's subject (the window passes the decoded one; the sealed field otherwise).
 */
export function threadsOf<T extends ThreadItem>(
  items: readonly T[],
  keep?: ReadonlyMap<string, string>,
  subjectOf: (item: T) => string = item => String(item.meta?.subject ?? ''),
): Thread<T>[] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]! }
    return i
  }
  // An id joins only rows that also say the same subject: the pair is the meeting point.
  const seen = new Map<string, number>()
  items.forEach((item, i) => {
    const ids = idsOf(item.meta)
    if (!ids.length) return
    const subject = threadSubject(subjectOf(item))
    for (const named of ids) {
      const id = `${named}\n${subject}`
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
