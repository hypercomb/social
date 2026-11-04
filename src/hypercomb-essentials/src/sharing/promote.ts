// sharing/promote.ts
//
// PROMOTE (jwize 2026-11-01: "promoted means minified / optimized and
// available to your community"). A published branch is promoted when it
// carries BOTH of what makes it light for a reader: its arrival plan (the bees
// its first view needs — arrival-plan-publish.ts) and a minified derivation of
// its head (documentation/derivations.md, the `minify` dialect). The act sends
// both to the host under the participant's key and names a small record in
// their signed index as `promoted:<lineage>` — a reserved root key
// (hive-link.ts isReservedRootKey), so it is a pointer, never a branch, exactly
// as `plan:<lineage>` is.
//
// The record names the head it was made for. A branch published again has a
// new head, so its old promotion stops matching and the branch reads as not
// promoted until it is promoted again — nothing here is ever updated in place.

import {
  SignatureService, deriveMinifiedLayer, minifyModuleBody, ownedMinifyTool,
} from '@hypercomb/core'
import { derivedArrival } from './arrival-derive.js'
import { publishArrivalPlan } from './arrival-plan-publish.js'
import { setHiveRoot } from './hive-pointer.js'

const SIG_RE = /^[a-f0-9]{64}$/
const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'

type Reader = { getFileHandle(name: string): Promise<{ getFile(): Promise<Blob> }> }
type StoreLike = { hypercombRoot?: Reader; bees?: Reader; dependencies?: Reader }
type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

export type PromotionRecord = {
  readonly v: 1
  readonly kind: 'promote'
  /** The head this promotion was made for. */
  readonly head: string
  /** The signature of the arrival plan record that rides with it, or null. */
  readonly arrival: string | null
  /** The derivation record (minify dialect) of the head, or null. */
  readonly derivation: string | null
}

export type PromoteResult =
  | { ok: true; sig: string; arrival: string | null; derivation: string | null }
  | { ok: false; reason: string }

/** PROMOTE ONLY FROM DEVELOPMENT (jwize 2026-11-04): a branch is offered to the
 *  community from the subdomain it was made ready on — live at its current
 *  head, open on an own address (`<label>.<zone>`), not already promoted. A
 *  branch at a domain's root path, or one that has moved on since it went
 *  live, is not ready to be made live for the community. */
export const readyToPromote = (row: {
  state: string
  live: string | null
  promoted: boolean
  busyPhase: string | null
  doors: readonly string[] | null
  ownLabels: Readonly<Record<string, string>>
}): boolean =>
  row.state === 'live' && !!row.live && !row.promoted && !row.busyPhase
  && Object.keys(row.ownLabels).some(zone => !row.doors || row.doors.includes(zone))

/** The signed-index key a branch's promotion is named under. */
export const promotedPointer = (lineage: string): string => `promoted:${lineage}`

/** The record, canonical: fixed field order, so the same promotion is the same bytes. */
export const promotionRecord = (head: string, arrival: string | null, derivation: string | null): string =>
  JSON.stringify({ v: 1, kind: 'promote', head, arrival, derivation } satisfies PromotionRecord)

/** Does this record promote THIS head? A record for an older head promotes nothing. */
export const promotesHead = (text: string, head: string): boolean => {
  try {
    const record = JSON.parse(text) as Partial<PromotionRecord>
    return record?.kind === 'promote' && record.head === head && SIG_RE.test(head)
      && (record.arrival !== null || record.derivation !== null)
  } catch { return false }
}

/** A published promotion record's text from a host, or null. A signature never
 *  changes, so a caller may keep what this returns. */
export async function readPromotionRecord(host: string, sig: string): Promise<string | null> {
  if (!SIG_RE.test(sig)) return null
  const bare = String(host).replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const scheme = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d+)?$/i.test(bare) ? 'http' : 'https'
  try {
    const response = await fetch(`${scheme}://${bare}/${sig}`)
    return response.ok ? await response.text() : null
  } catch { return null }
}

const bytesOf = async (dir: Reader | undefined, names: readonly string[]): Promise<Uint8Array | null> => {
  if (!dir) return null
  for (const name of names) {
    try { return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()) } catch { /* next spelling */ }
  }
  return null
}

/** Promote a published branch: plan + minified derivation to `host`, then the record. */
export async function promoteBranch(args: {
  readonly host: string
  readonly lineage: string
  readonly segments: readonly string[]
  /** The head the index names for this branch. */
  readonly head: string
  /** The plan's IoC keys when the branch already has one published. */
  readonly plan: readonly string[] | null
}): Promise<PromoteResult> {
  const { host, lineage, segments } = args
  const head = String(args.head ?? '').toLowerCase()
  if (!SIG_RE.test(head)) return { ok: false, reason: 'publish the branch first — it has no head to promote' }
  const ioc = (window as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc
  const store = ioc?.get?.<StoreLike>(STORE_KEY)
  const sync = ioc?.get?.<HostSyncLike>(HOST_SYNC_KEY)
  if (!store || !sync?.publishAtoms) return { ok: false, reason: 'the store or host sync is not available here' }

  // 1. THE ARRIVAL — a plan already published stays; otherwise the one the
  //    branch's own view declares.
  let arrival: string | null = null
  const names = args.plan?.length ? [...args.plan] : (await derivedArrival(segments).catch(() => null)) ?? []
  if (names.length) {
    const plan = await publishArrivalPlan(host, lineage, names)
    if (!plan.ok) return { ok: false, reason: `the arrival could not be sent: ${plan.reason}` }
    arrival = plan.sig
  }

  // 2. THE MINIFIED HEAD — read from this store, sent beside the record.
  const read = async (sig: string): Promise<Uint8Array | null> =>
    await bytesOf(store.hypercombRoot, [sig])
    ?? await bytesOf(store.bees, [`${sig}.js`, sig])
    ?? await bytesOf(store.dependencies, [`${sig}.js`, sig])
  let derivation: string | null = null
  let files = new Map<string, Uint8Array>()
  try {
    const tree = await deriveMinifiedLayer(head, read, async body => minifyModuleBody(body), await ownedMinifyTool())
    derivation = tree.derivation.sig
    files = new Map(tree.files)
    files.set(tree.derivation.sig, tree.derivation.bytes)
    files.set(tree.membership.dialect, tree.membership.dialectBytes)
  } catch (error) {
    if (!arrival) return { ok: false, reason: `nothing to optimize: ${error instanceof Error ? error.message : 'the head could not be read'}` }
  }
  if (!arrival && !derivation) return { ok: false, reason: 'nothing to optimize' }

  // 3. THE RECORD — canonical bytes at their own signature, sent with the rest.
  const recordBytes = new TextEncoder().encode(promotionRecord(head, arrival, derivation))
  const recordSig = await SignatureService.sign(recordBytes.buffer as ArrayBuffer)
  files.set(recordSig, recordBytes)
  const sent = await sync.publishAtoms(host, [...files.keys()], async sig => files.get(sig) ?? null)
  if (!sent.ok) return { ok: false, reason: sent.error }
  const named = await setHiveRoot(host, promotedPointer(lineage), recordSig)
  return named.ok
    ? { ok: true, sig: recordSig, arrival, derivation }
    : { ok: false, reason: named.reason ?? 'the index refused it' }
}
