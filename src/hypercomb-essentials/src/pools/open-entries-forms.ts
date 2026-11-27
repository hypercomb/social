// pools/open-entries-forms.ts
//
// WHAT AN ENTRY IS, AS A FEATURE SAYS IT (documentation/open-entry-pools.md).
// An open entry pool is one rule for any meaning; what a poster fills in and
// how a posted row is brought home are the feature's. A feature hands in an
// entry form here at load, the way it hands in a pool contribution, and the
// leader's controls (open-entries-leader.ts) ask for it by meaning.
//
// Kept apart from the controls so a feature that registers a form loads only
// this table. Pure: a table, a name and types. It registers nothing itself.

import type { EntryRow } from './open-entries.js'

/** Transient: the word asked for the "Open for posts" form. The pools mode drone opens it once its bar is up. */
export const ENTRY_POSTS_WANTED = 'pools:posts-wanted'

// ── the entry forms features hand in ────────────────────────────────────────

/** A template a poster may fill: its signature, its name, and its bytes, which opening sends to the host. */
export interface EntryFormTemplate {
  readonly sig: string
  readonly name: string
  readonly bytes: Uint8Array
}

/** The pool a set of rows was read from, as a feature needs it to bring them home. */
export interface EntryFormSource {
  /** H. */
  readonly pool: string
  /** The page the pool is read at: where its template is served. */
  readonly page: string
  readonly template: string
  readonly title: string
}

/** What a feature says an entry is: its meaning, what a poster fills, and how its rows come home. */
export interface EntryForm {
  /** What an entry is: `recipe:entry`. */
  readonly meaning: string
  /** The templates the leader may open a pool for, each held in this hive. */
  templates(): Promise<readonly EntryFormTemplate[]>
  /** Bring rows home, each as the feature keeps one: how many came, and the first refusal in words. */
  bring?(rows: readonly EntryRow[], source: EntryFormSource): Promise<{ readonly brought: number; readonly reason?: string }>
}

// Pinned on globalThis like the pool contributions: the feature and the bar
// are built into separate bundles, and two copies of this table would be none.
const forms: Map<string, EntryForm> =
  ((globalThis as { __hypercombEntryForms?: Map<string, EntryForm> }).__hypercombEntryForms ??= new Map())

/** Hand in an entry form. A later one for the same meaning takes its place. */
export function registerEntryForm(form: EntryForm): void {
  forms.set(form.meaning, form)
}

/** Every entry form handed in, in the order their meanings first arrived. */
export const entryForms = (): EntryForm[] => [...forms.values()]
