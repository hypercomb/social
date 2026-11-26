// sharing/hive-take.ts
//
// HOME, HELD ON THE HIVE (jwize, 2026-11-20: "when the card reaches your hive
// or another of your devices"). A card published from its own page (the
// managed door, hypercomb-shim managed-publish.ts) moves the hive's signed
// index past what the hive holds: the Publish window shows the row as drift,
// published elsewhere (publish-batch.ts driftedElsewhere). "Take it" brings
// that head into the hive at the branch's own route — the same take a card's
// page makes of a newer card (site-replica.ts takePublished), never a second
// one — and the drafts the card carries come home held with it (restoreDrafts,
// run by the take).
//
// THE OWNER CHECK IS THE HIVE'S OWN SIGNED INDEX. The head is taken only when
// this hive's index, read fresh and verified (hive-pointer.ts fetchHiveIndex:
// signed by this hive's key, or by a key its list names, tagged for it), names
// that very head for that very key. Anything unknown is no: nothing is taken,
// and no draft comes home. A head this hive published itself is not "from
// elsewhere" — it is behind here, and is never taken back over what is here.
//
// A dependency: it exports, registers nothing.

import type { HiveIndexResult } from './hive-pointer.js'
import { readReceipt, readState, restoreDrafts, takePublished, type DraftsHome, type ReplicaLayer, type ReplicaServices } from './site-replica.js'

const SIG_RE = /^[0-9a-f]{64}$/

/** The drift row being taken: its index key, its route here, the head its
 *  index names, the door that index was read through and the row's domains. */
export type HiveTakeRow = {
  readonly key: string
  readonly segments: readonly string[]
  readonly live: string | null
  readonly door: string
  readonly zones: readonly string[]
}

export type HiveTakeDeps = {
  /** The hive's own services, from window.ioc. `publish` is supplied here. */
  readonly services: Omit<ReplicaServices, 'publish'>
  /** This hive's publishing key (hex). */
  readonly pubkey: string
  /** A fresh, verified read of the index for `pubkey` at `door`. */
  readonly fetchIndex: (door: string, pubkey: string) => Promise<HiveIndexResult>
  /** Every head this hive's own publish ledger names for `pubkey`, under any
   *  key (publish-batch.ts sealedHere): the ledger keeps one record per sealed
   *  head, so `key` alone would miss one that another branch sealed alike. */
  readonly ownHeads: (pubkey: string, key: string) => Promise<ReadonlySet<string>>
  /** Asked once the head is proved the owner's, before anything is fetched. */
  readonly confirm: () => Promise<boolean>
}

export type HiveTakeOutcome =
  | { readonly kind: 'taken'; readonly drafts?: DraftsHome }
  | { readonly kind: 'declined' }
  /** The hive's own verified index does not name this head for this key now. */
  | { readonly kind: 'not-yours' }
  /** This hive published that head itself: it is behind here, not elsewhere. */
  | { readonly kind: 'ours' }
  /** Not every layer of the head could be fetched; nothing was taken. */
  | { readonly kind: 'cold' }
  /** An edit landed here while the head was fetched; nothing was taken. */
  | { readonly kind: 'edited' }
  | { readonly kind: 'failed'; readonly error: string }

/** Does this hive's own signed index, read now, name `head` for `key`? Fail closed. */
export async function hiveIndexNames(
  fetchIndex: HiveTakeDeps['fetchIndex'], door: string, pubkey: string, key: string, head: string,
): Promise<boolean> {
  try {
    if (!door || !SIG_RE.test(pubkey) || !SIG_RE.test(head) || !key) return false
    const read = await fetchIndex(door, pubkey)
    return read.ok === true && read.manifest.roots[key] === head
  } catch { return false }
}

/** TAKE IT: the published head into the hive at the row's route, and its drafts home held. */
export async function takeFromElsewhere(deps: HiveTakeDeps, row: HiveTakeRow): Promise<HiveTakeOutcome> {
  const head = row.live ?? ''
  const route = row.segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (!SIG_RE.test(head) || route.length === 0 || route.some(s => s.includes('/'))) return { kind: 'not-yours' }
  try {
    if ((await deps.ownHeads(deps.pubkey, row.key)).has(head)) return { kind: 'ours' }
  } catch { return { kind: 'failed', error: 'the publish ledger could not be read' } }
  // A head this hive took before is behind here too: taking it again would put
  // the older card back over what was made here since.
  if ((await readReceipt(deps.services.store, route.join('/')))?.published === head) return { kind: 'ours' }
  if (!(await hiveIndexNames(deps.fetchIndex, row.door, deps.pubkey, row.key, head))) return { kind: 'not-yours' }
  if (!(await deps.confirm().catch(() => false))) return { kind: 'declined' }

  const site = { lineage: route.join('/'), head }
  // The marker the take is decided on, read before the fetch: an edit that
  // lands while the head is fetched refuses the take (takePublished's guard).
  let marker: string | null
  try { marker = (await readState({ ...deps.services }, site)).marker } catch { return { kind: 'failed', error: 'the branch here could not be read' } }

  const { broker } = deps.services
  const sources = [...new Set([row.door, ...row.zones].map(s => String(s ?? '').trim()).filter(Boolean))]
  broker?.noteDomainsForSig?.(head, sources)
  // Every layer here first: the take re-homes the tree from local layers, and
  // a layer it cannot read would be a tile silently left out of the replace.
  try {
    const walked = await broker?.adopt?.(head, { layersOnly: true, quiet: true }) as { failed?: number; truncated?: number } | undefined
    if (!walked || (walked.failed ?? 1) > 0 || (walked.truncated ?? 0) > 0) return { kind: 'cold' }
  } catch { return { kind: 'cold' } }

  // The owner check, proved above for exactly this head, is the drafts' gate too.
  const services: ReplicaServices = {
    ...deps.services,
    publish: { ownsThisCard: async (_lineage: string, sig: string) => sig === head },
  }
  try {
    const taken = await takePublished(services, site, { host: row.door, sources }, { marker })
    if (taken.ok) return { kind: 'taken', ...(taken.drafts ? { drafts: taken.drafts } : {}) }
    if (taken.error === 'edited') return { kind: 'edited' }
    if (taken.error === 'cold') return { kind: 'cold' }
    return { kind: 'failed', error: taken.error }
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error ?? '') }
  }
}

/**
 * DRAFTS TRIED AGAIN ON THE HIVE. A take writes the receipt before its drafts
 * come home, so one that did not (a part not fetched, a hold that did not
 * land, a gate, a busy path) is left off the receipt — and the row, taken, is
 * no longer drift, so "Take it" is not offered again. This is the hive's
 * retry, as reconcile is the card page's: only for a head this hive took
 * (its receipt says so) that the row's index still names, its decorations
 * read from this device, and only once something is owed is this hive's own
 * signed index read fresh for that very head — the same owner check the take
 * made. Undefined when nothing was tried. Never throws.
 */
export async function retryTakenDrafts(
  deps: Pick<HiveTakeDeps, 'services' | 'pubkey' | 'fetchIndex'>,
  row: HiveTakeRow,
): Promise<DraftsHome | undefined> {
  try {
    const head = row.live ?? ''
    const route = row.segments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (!SIG_RE.test(head) || route.length === 0 || route.some(s => s.includes('/'))) return undefined
    const lineage = route.join('/')
    const receipt = await readReceipt(deps.services.store, lineage)
    if (!receipt || receipt.published !== head) return undefined
    const blob = typeof deps.services.store.getResourceLocal === 'function'
      ? await deps.services.store.getResourceLocal(head)
      : await deps.services.store.getResource(head)
    const parsed = blob ? JSON.parse(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))) as unknown : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const services: ReplicaServices = {
      ...deps.services,
      publish: { ownsThisCard: async (_lineage: string, sig: string) => sig === head && hiveIndexNames(deps.fetchIndex, row.door, deps.pubkey, row.key, head) },
    }
    return await restoreDrafts(services, { lineage, head }, parsed as ReplicaLayer, receipt, { local: true })
  } catch { return undefined }
}

/** The first wait after a retry of a taken card's drafts, and the longest. */
export const DRAFTS_RETRY_FIRST_MS = 60_000
export const DRAFTS_RETRY_LONGEST_MS = 30 * 60_000

/**
 * HOW OFTEN THE HIVE TRIES AGAIN. Every look at the Publish window would
 * otherwise retry every taken row: a draft over an older build never settles
 * and one over another build waits for Update all, so each look would read the
 * index fresh and try them all again, with no end. Per row and head: due at
 * once for a head not tried yet, then after a wait that doubles on every try
 * of that same head, up to the longest; a new head starts over.
 */
export function draftsRetryPace(now: () => number = Date.now): { due(key: string, head: string): boolean; tried(key: string, head: string): void } {
  const rows = new Map<string, { head: string; next: number; wait: number }>()
  return {
    due(key, head) {
      const row = rows.get(key)
      return !row || row.head !== head || now() >= row.next
    },
    tried(key, head) {
      const row = rows.get(key)
      const wait = row && row.head === head ? Math.min(row.wait * 2, DRAFTS_RETRY_LONGEST_MS) : DRAFTS_RETRY_FIRST_MS
      rows.set(key, { head, next: now() + wait, wait })
    },
  }
}
