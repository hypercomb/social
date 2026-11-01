// chat-runs.ts
//
// The thread as the eye reads it. Participant messages that follow one another
// are ONE RUN, drawn as one block. Derived from the turns on every render and
// stored nowhere, so a conversation from any era groups the same way.

export interface ChatRunRow {
  readonly key: string
  readonly index: number
  readonly turn: { readonly role: string }
}

export interface ChatRun<T extends ChatRunRow> {
  readonly key: string
  readonly user: boolean
  readonly entries: readonly T[]
}

/** Each participant run is one group and each reply stands alone. A row that
 *  opens a step starts a new group: its rule is drawn between the two, so they
 *  are not contiguous on the page. */
export const groupRuns = <T extends ChatRunRow>(
  rows: readonly T[],
  opensStep: (index: number) => boolean,
): ChatRun<T>[] => {
  const runs: { key: string; user: boolean; entries: T[] }[] = []
  for (const row of rows) {
    const user = row.turn.role === 'user'
    const open = runs[runs.length - 1]
    if (user && open?.user && !opensStep(row.index)) open.entries.push(row)
    else runs.push({ key: row.key, user, entries: [row] })
  }
  return runs
}
