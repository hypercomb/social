// diamondcoreprocessor.com/assistant/changes.ts
//
// THE CHANGES REPOSITORY — every act that touches a group of tiles leaves one
// record, addressed by the same id its products are stamped with.
//
// The creation id says "these tiles came from one act". It does not say WHAT
// the act was, WHERE it ran, what else it touched, or whether it finished. So
// the stamp could identify wreckage but nothing could enumerate it: when an
// organize half-applied this afternoon, the eight stranded tiles had to be
// found by hand and deleted by hand. There was no list to consult and nothing
// to revert against.
//
// This is that list. One append-only record per act, in the
// `sign('changes:log')` pool:
//
//   • what act, at what scope, when, and how it ended
//   • every path it touched, and what it did there
//   • the change it compensates, when it is an undo
//
// REVERT IS A COMPENSATING CHANGE, NEVER AN ERASURE. History here does not
// branch; undoing change X mints change Y that reverses it and points at X.
// Both stay visible, undoing an undo is just another entry, and a PARTIAL
// revert is expressible — compensate three tiles of eight and the record says
// exactly that. A log you can rewrite is not a log.
//
// The pool meaning carries a COLON on purpose. Lineage bags share the flat
// root namespace and a bag is named sha256 of its location key, so a bare word
// like `changes` would collide with any tile whose slug is "changes" — and
// `/flatten` on a colliding address has already hard-deleted a whole pool
// once. `lineageKey` folds every non-alphanumeric to `-`, so a colon can never
// be produced by a location.
import { mintCreationId } from './creation.js'
import { changeChannelId } from './change-channel.js'

/** Pool of meaning holding the log. Colon-scoped — see the note above. */
export const CHANGES_POOL = 'changes:log'

/** What an act did at one path. */
export type ChangeOp = 'created' | 'moved' | 'edited' | 'removed'

export interface ChangeTouch {
  /** Full path of the tile, from the hive root. */
  readonly path: readonly string[]
  readonly op: ChangeOp
  /** What the tile WAS in the act — 'group', 'part', 'member'. Free-form;
   *  the acts know their own vocabulary. */
  readonly role: string
}

/** How an act ended. `partial` is not a failure state — it is the honest
 *  answer when some of the work landed, and the one a revert must read to
 *  know what there is to undo. */
export type ChangeStatus = 'requested' | 'applied' | 'partial' | 'declined' | 'failed' | 'compensated'

export interface ChangeRecord {
  readonly kind: 'change'
  /** The channel this change is addressed to. Present on EVERY record,
   *  including locally-made ones — a local change is not a special case, it
   *  is a change on this hive's own private channel. */
  readonly channel: string
  /** Same signature the act's products are stamped with. */
  readonly id: string
  readonly task: string
  readonly scope: readonly string[]
  readonly at: number
  readonly status: ChangeStatus
  readonly touched: readonly ChangeTouch[]
  /** Set when this change exists to reverse another. */
  readonly compensates?: string
  readonly note?: string
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
}

const encode = (record: ChangeRecord): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer

/**
 * An act in progress. Accumulates what it touched, then commits ONE record.
 *
 * Deliberately not written incrementally: a half-written change record is
 * indistinguishable from a change that half-happened, and the whole point of
 * this log is telling those apart. The record lands once, with a status.
 */
export class ChangeSet {
  readonly id: string
  readonly task: string
  readonly scope: readonly string[]
  readonly at: number

  readonly #touched: ChangeTouch[] = []
  #compensates: string | undefined
  #committed = false

  constructor(id: string, task: string, scope: readonly string[], at: number) {
    this.id = id
    this.task = task
    this.scope = [...scope]
    this.at = at
  }

  /** Record a path this act touched. Called as the work happens, so the record
   *  reflects what ACTUALLY landed rather than what was planned. */
  touched(path: readonly string[], op: ChangeOp, role = ''): void {
    this.#touched.push({ path: [...path], op, role })
  }

  /** Mark this change as the undo of another. */
  compensating(changeId: string): void {
    this.#compensates = changeId
  }

  /** Write the record. Returns the id, or null when the pool is unavailable —
   *  a log that cannot be written must not abort the work it describes, but
   *  the caller should say so rather than reporting a clean run. */
  async commit(status: ChangeStatus, note?: string): Promise<string | null> {
    if (this.#committed) {
      console.warn(`[changes] ${this.id.slice(0, 12)}… already committed`)
      return this.id
    }
    this.#committed = true

    const record: ChangeRecord = {
      kind: 'change',
      channel: await changeChannelId(),
      id: this.id,
      task: this.task,
      scope: this.scope,
      at: this.at,
      status,
      touched: this.#touched,
      ...(this.#compensates ? { compensates: this.#compensates } : {}),
      ...(note ? { note } : {}),
    }

    const store = get<StoreLike>('@hypercomb.social/Store')
    const pool = await store?.getPool?.(CHANGES_POOL)
    if (!pool) {
      console.warn('[changes] pool unavailable — change not recorded:', record.id.slice(0, 12))
      return null
    }

    try {
      const bytes = encode(record)
      // APPEND, never replace: one sig-named file per change. `putPoolDoc`
      // would be wrong here — it keeps a single current member and drops the
      // rest, which for a log means every entry erases its history.
      const name = await signBytes(bytes)
      const handle = await pool.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Blob([bytes as BlobPart])) } finally { await writable.close() }
      console.log(`[changes] ${this.task} ${status} — ${this.#touched.length} touched [${record.id.slice(0, 12)}…]`)
      return record.id
    } catch (err) {
      console.warn('[changes] could not write the record:', err)
      return null
    }
  }
}

/** Signature of the record bytes — its filename in the pool. Distinct from
 *  the change id: two changes can share nothing but still both be logged, and
 *  a compensating record must not overwrite the one it compensates. */
const signBytes = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Open a change. The id is the same signature the act stamps on its
 *  products, so a tile and its change record find each other. */
export const openChange = async (
  task: string,
  scope: readonly string[],
  at: number = Date.now(),
): Promise<ChangeSet> => {
  const id = await mintCreationId(task, scope, at)
  return new ChangeSet(id, task, scope, at)
}

/** Every change on record, newest first. */
export const listChanges = async (): Promise<ChangeRecord[]> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(CHANGES_POOL)
  if (!pool) return []

  const mine = await changeChannelId()
  const out: ChangeRecord[] = []
  try {
    const entries = (pool as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
    for await (const [, handle] of entries) {
      if (handle.kind !== 'file') continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const rec = JSON.parse(await file.text()) as ChangeRecord
        if (rec?.kind !== 'change' || !rec.id) continue
        // A pool may hold records addressed elsewhere once a transport exists;
        // never surface another hive's changes as if they were ours.
        if (rec.channel && rec.channel !== mine) continue
        out.push(rec)
      } catch { /* one unreadable record must not hide the rest */ }
    }
  } catch (err) {
    console.warn('[changes] could not list:', err)
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Every record carrying this change id. More than one is normal and correct:
 *  an act that was requested and later applied has both, and the sequence IS
 *  the story of the act. */
export const changesFor = async (id: string): Promise<ChangeRecord[]> =>
  (await listChanges()).filter(c => c.id === id).sort((a, b) => a.at - b.at)

/** The changes that compensate this one — empty when it still stands. */
export const compensationsOf = async (id: string): Promise<ChangeRecord[]> =>
  (await listChanges()).filter(c => c.compensates === id)
