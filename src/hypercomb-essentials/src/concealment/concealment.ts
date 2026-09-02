// concealment/concealment.ts
//
// HIDE FIRST, DELETE SECOND — the one way anything leaves a list.
//
// Deleting is the only act in this system that cannot be answered by pressing
// something again, so it is never the act a list offers. A list offers HIDE:
// the row goes away, it stops being offered, and nothing is gone. What was
// hidden collects in a DELETE AREA — the one place where deleting is on the
// table at all — and only there, on a row you went looking for, can it be
// deleted for good.
//
// Two consequences worth stating, because they are the point:
//
//   · A hidden thing cannot be picked by accident. That is the whole reason a
//     participant reaches for this: a host ledger lists every build it ever
//     published and an old one is a DOWNGRADE, so the builds you never want to
//     apply should not be sitting next to the one you do.
//   · NOT EVERYTHING HIDDEN IS DELETABLE. A hidden row carries whether it may
//     be deleted at all; the delete area shows the rest as hidden-only, with no
//     delete on offer. "You can put it away" and "you can destroy it" are two
//     different permissions and this never collapses them into one.
//
// WHAT DELETE MEANS HERE. It is a LOCAL forget: the thing stops being listed,
// permanently, and never comes back when the source is read again. It does not
// reach across the network. A build deleted here is still on the host that
// published it, still valid, still fetchable by signature by anybody who names
// it — that is what content addressing means and no local act can change it.
// Saying "deleted" while meaning "hidden forever, here" is the honest reading
// and the UI must not promise more.
//
// THE RECORD. One artifact per concealed thing in the `hidden:items` pool,
// named by its own content, exactly like a community host. Nothing holds a
// list: the pool IS the set, so a half-written conceal is one row still
// showing, never an index that disagrees with its members.
//
// The `state` rides IN the record, so hiding and deleting mint different
// signatures and a state change is a remove-then-write rather than an edit.
// Members are found by their payload's `sig` rather than by recomputing a
// name, so a caller that passes a different label later can never strand a
// duplicate.

import { SignatureService } from '@hypercomb/core'
import { artifactKindFor } from '../pheromones/enrollment.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

const STORE_KEY = '@hypercomb.social/Store'

/** The artifact family. `visual:hidden:artifact` names one. */
export const HIDDEN_FAMILY = 'hidden'

/** The naming kind for a concealment record. */
export const HIDDEN_ARTIFACT_KIND = artifactKindFor(HIDDEN_FAMILY)

/** The pool of meaning that holds what you have put away. The colon is
 *  required of every new pool meaning: `lineageKey` folds non-alphanumerics to
 *  `-`, so a colon-bearing meaning can never collide with a lineage sigbag. */
export const HIDDEN_ITEMS_POOL = 'hidden:items'

/** Hidden is reversible and shows in the delete area. Deleted is not, and
 *  shows nowhere — it exists only so the thing never lists again. */
export type ConcealState = 'hidden' | 'deleted'

/**
 * What a surface hands over when it puts something away.
 *
 * `scope` is the surface's own word for the kind of thing (`host-build`,
 * `publish-version`) and is what the delete area groups by. `deletable` is the
 * surface's answer to "may this ever be destroyed" — false means the row can
 * be put away and taken back and nothing more.
 */
export interface ConcealedItem {
  /** The signature of the thing itself — a build, a version, a record. */
  sig: string
  scope: string
  /** What to call it in the delete area. Falls back to a short signature. */
  label: string
  /** Where it came from, in the surface's own words (a zone, a branch). */
  from: string
  deletable: boolean
  state: ConcealState
}

const SIG_RE = /^[a-f0-9]{64}$/

/** The meaning for one concealed signature — scoped by family, so it can never
 *  collide with a bag or another artifact type. */
export const hiddenMeaning = (sig: unknown): string => {
  const text = String(sig ?? '').trim().toLowerCase()
  return SIG_RE.test(text) ? `${HIDDEN_FAMILY}:${text}` : ''
}

/** The record for one concealed thing. Canonical — sorted keys, no wall clock
 *  — so the same conceal always mints the same member. */
export const hiddenRecord = (item: ConcealedItem): Record<string, unknown> => ({
  kind: HIDDEN_ARTIFACT_KIND,
  meaning: hiddenMeaning(item.sig),
  payload: {
    deletable: !!item.deletable,
    from: String(item.from ?? ''),
    label: String(item.label ?? ''),
    scope: String(item.scope ?? ''),
    sig: String(item.sig ?? '').toLowerCase(),
    state: item.state,
  },
})

const encodeRecord = (item: ConcealedItem): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(hiddenRecord(item))).buffer as ArrayBuffer

/** The pool member name for one concealment — the signature of its own bytes. */
export const hiddenRecordSig = (item: ConcealedItem): Promise<string> =>
  SignatureService.sign(encodeRecord(item))

type PoolStore = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
}

const hiddenPool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const store = get<PoolStore>(STORE_KEY)
  if (!store?.getPool) return null
  try { return await store.getPool(HIDDEN_ITEMS_POOL) } catch { return null }
}

const readItem = (text: string): ConcealedItem | null => {
  try {
    const record = JSON.parse(text) as { kind?: unknown; payload?: Record<string, unknown> }
    if (record?.kind !== HIDDEN_ARTIFACT_KIND) return null
    // Indexed access throughout: the payload is a bag of unknowns off disk,
    // and the shell's tsconfig refuses dotted reads on an index signature.
    const payload = record.payload ?? {}
    const sig = String(payload['sig'] ?? '').toLowerCase()
    if (!SIG_RE.test(sig)) return null
    const state: ConcealState = payload['state'] === 'deleted' ? 'deleted' : 'hidden'
    return {
      sig,
      scope: String(payload['scope'] ?? ''),
      label: String(payload['label'] ?? ''),
      from: String(payload['from'] ?? ''),
      deletable: !!payload['deletable'],
      state,
    }
  } catch { return null }
}

/**
 * Everything you have put away, and everything you have deleted.
 *
 * Both come back from one read because a surface needs both for one job: the
 * hidden ones to render in its delete area, the deleted ones to keep filtering
 * out. A member that will not parse is not an entry.
 */
export async function listConcealed(): Promise<ConcealedItem[]> {
  const pool = await hiddenPool()
  if (!pool) return []
  const items = new Map<string, ConcealedItem>()
  try {
    for await (const [, handle] of (pool as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    }).entries()) {
      if (handle.kind !== 'file') continue
      try {
        const item = readItem(await (await (handle as FileSystemFileHandle).getFile()).text())
        if (!item) continue
        // Deleted outranks hidden if both records somehow exist: the stronger
        // statement is the one the participant made last, and the weaker one
        // would put a deleted thing back on offer.
        const seen = items.get(item.sig)
        if (!seen || (seen.state === 'hidden' && item.state === 'deleted')) items.set(item.sig, item)
      } catch { /* a member that will not parse is not an entry */ }
    }
  } catch { return [] }
  return [...items.values()].sort((a, b) =>
    a.scope === b.scope ? a.label.localeCompare(b.label) : a.scope.localeCompare(b.scope))
}

/** Drop every member naming this signature, whatever state it was in. Returns
 *  how many went, so a caller can tell a real reveal from a no-op. */
async function dropMembers(pool: FileSystemDirectoryHandle, sig: string): Promise<number> {
  const names: string[] = []
  try {
    for await (const [name, handle] of (pool as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    }).entries()) {
      if (handle.kind !== 'file') continue
      try {
        const item = readItem(await (await (handle as FileSystemFileHandle).getFile()).text())
        if (item?.sig === sig) names.push(name)
      } catch { /* unreadable member — leave it, it names nothing */ }
    }
  } catch { return 0 }
  let gone = 0
  for (const name of names) {
    try { await pool.removeEntry(name); gone++ } catch { /* already gone */ }
  }
  return gone
}

/**
 * Put something away, or move it from hidden to deleted.
 *
 * One door for both, because they are the same write with a different state,
 * and having one door is what makes "you cannot delete what you did not first
 * hide" enforceable — see `deleteConcealed`, which refuses anything else.
 */
async function writeState(item: ConcealedItem): Promise<boolean> {
  if (!hiddenMeaning(item.sig)) return false
  const pool = await hiddenPool()
  if (!pool) return false
  await dropMembers(pool, item.sig.toLowerCase())
  try {
    const name = await hiddenRecordSig(item)
    const handle = await pool.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([encodeRecord(item)])) } finally { await writable.close() }
    return true
  } catch { return false }
}

/** Hide one thing. Reversible, and the only way into the delete area. */
export const conceal = (item: Omit<ConcealedItem, 'state'>): Promise<boolean> =>
  writeState({ ...item, sig: String(item.sig ?? '').toLowerCase(), state: 'hidden' })

/** Take one thing back out of hiding. It returns to whatever list it came
 *  from — nothing was ever removed from that list, only filtered out of it. */
export async function reveal(sig: unknown): Promise<boolean> {
  const text = String(sig ?? '').trim().toLowerCase()
  if (!hiddenMeaning(text)) return false
  const pool = await hiddenPool()
  if (!pool) return false
  return (await dropMembers(pool, text)) > 0
}

/**
 * Delete for good — LOCALLY.
 *
 * TWO GATES, both refusals rather than confirmations:
 *
 *   · It must already be hidden. You cannot delete straight off a list, which
 *     is the doctrine this module exists to make structural rather than a
 *     convention that the next surface forgets.
 *   · It must have been marked deletable when it was hidden. Some things are
 *     put away and never destroyed, and the surface that owns them is the only
 *     thing that knows which.
 */
export async function deleteConcealed(sig: unknown): Promise<boolean> {
  const text = String(sig ?? '').trim().toLowerCase()
  if (!hiddenMeaning(text)) return false
  const current = (await listConcealed()).find(i => i.sig === text)
  if (!current || current.state !== 'hidden' || !current.deletable) return false
  return writeState({ ...current, state: 'deleted' })
}
