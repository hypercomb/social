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
import { ownHiveRoot, setHiveRoot } from './hive-pointer.js'
import { showcaseHome } from './showcase-record.js'

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

export type CommunityPromotion = { readonly ok: true; readonly promoted: boolean } | { readonly ok: false; readonly reason: string }

/**
 * TURNING IT LIVE IN YOUR COMMUNITY IS THE PROMOTE (jwize 2026-11-13: "publish
 * from the host, promote from the available published to the community (this
 * would start the minification)"; "toggle from domain, toggle from off items in
 * community to live, no other interface").
 *
 * The toggle itself optimizes: the head this key published on `zone` for
 * `lineage` is minified and its arrival plan sent, exactly as promoteBranch
 * does, unless a promotion for that very head is already named. Nobody is
 * asked to minify anything. The readable layers stay on the host beside the
 * derivation (`derivedFrom`), so the files are always there to read.
 */
export async function promoteForCommunity(zone: string, lineage: string, deps: {
  readonly root?: (host: string, key: string) => Promise<string | null>
  readonly record?: (host: string, sig: string) => Promise<string | null>
  readonly promote?: typeof promoteBranch
  /** Where the zone's visitors read this key's index (showcase-record.ts showcaseHome). */
  readonly home?: (zone: string) => Promise<string | null>
} = {}): Promise<CommunityPromotion> {
  const root = deps.root ?? ((host: string, key: string) => ownHiveRoot(host, key))
  // READ AND PROMOTED WHERE THE VISITORS READ (2026-11-15): jwize.com's apex is the owner's relay, which answers with a
  // stray index of its own; the head and the promotion live in the index at the zone's showcase home, the store its
  // sites read. Asked at the bare zone, an own creation going live from the desktop failed as "not published yet".
  const host = (await (deps.home ?? showcaseHome)(zone).catch(() => null)) ?? zone
  const head = await root(host, lineage).catch(() => null)
  if (!head) return { ok: false, reason: `${lineage} is not published on ${host} yet` }
  const pointer = await root(host, promotedPointer(lineage)).catch(() => null)
  if (pointer) {
    const text = await (deps.record ?? readPromotionRecord)(host, pointer).catch(() => null)
    if (text && promotesHead(text, head)) return { ok: true, promoted: false }
  }
  const segments = lineage.split('/').map(part => part.trim()).filter(Boolean)
  const result = await (deps.promote ?? promoteBranch)({ host, lineage, segments, head, plan: null })
    .catch((error: unknown): PromoteResult => ({ ok: false, reason: error instanceof Error ? error.message : 'failed' }))
  return result.ok ? { ok: true, promoted: true } : { ok: false, reason: result.reason }
}

/** One re-promote at a time: a batch publish of five live items is five minifications in turn, never at once. */
let repromoting: Promise<unknown> = Promise.resolve()
/** The longest one re-promote holds the queue: a host that never answers must not stop every later one. */
export const REPROMOTE_HOLD_MS = 5 * 60_000
/** How long a re-promote waits for the zone's visitors to be handed the new head before it gives up and says so. */
const VISIBLE_TRIES = 8
const VISIBLE_STEP_MS = 3_000

/** Every zone a creation of this key's can be live in: the branch's own marks, the community's domains, and the
 *  public host the participant named (the Publish window's community is `showcase:<that host>`, fed from every domain). */
const communityZones = async (segments: readonly string[]): Promise<string[]> => {
  const hosts = await import('./community-hosts.js')
  const ioc = (window as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc
  const named = ioc?.get?.<{ publicHostDomain?: () => string }>(HOST_SYNC_KEY)?.publicHostDomain?.() ?? ''
  const { zoneDoor } = await import('./zone-door.js')
  return [
    ...await hosts.hostsOfBranch(segments).catch(() => [] as string[]),
    ...await hosts.listCommunityHosts().catch(() => [] as string[]),
    zoneDoor(named),
  ]
}

/**
 * A REPUBLISH OPTIMIZES ITSELF (jwize 2026-11-13: "there is no minify or optimizations choices when you deploy these
 * things are done automatically"). A promotion names the head it was made for, so publishing a creation that is live
 * in your community again left it unoptimized there until someone turned it off and on (2026-11-16: games and
 * camelflage, republished, read as not promoted). After a publish of `head`, every zone whose live showcase names this
 * key's `lineage` (communityZones) has the new head promoted, exactly as going live does — once that zone's visitors
 * are handed it: promoted earlier, the old head is read, its promotion matches, and nothing is done. Staged items are
 * not touched: publishing the staged list promotes them. Never throws; answers what each zone said.
 */
export function repromoteInCommunity(lineage: string, segments: readonly string[], head: string, deps: {
  readonly zones?: (segments: readonly string[]) => Promise<readonly string[]>
  readonly pubkey?: () => Promise<string>
  readonly showcase?: (zone: string) => Promise<{ readonly items: readonly { readonly pubkey: string; readonly lineage: string }[] } | null>
  /** The head the zone's visitors are handed for `lineage` now. */
  readonly visible?: (zone: string, lineage: string) => Promise<string | null>
  readonly promote?: (zone: string, lineage: string) => Promise<CommunityPromotion>
  readonly sleep?: (ms: number) => Promise<void>
  readonly holdMs?: number
} = {}): Promise<{ zone: string; result: CommunityPromotion }[]> {
  const want = String(head ?? '').toLowerCase()
  const run = repromoting.then(async () => {
    const done: { zone: string; result: CommunityPromotion }[] = []
    try {
      const zonesOf = deps.zones ?? communityZones
      const keyOf = deps.pubkey ?? (async () => (await import('./key-list.client.js')).publisherKeyHex())
      const showcaseOf = deps.showcase ?? (async (zone: string) => (await import('./showcase-record.js')).readSignedShowcase(zone))
      const visibleOf = deps.visible ?? (async (zone: string, key: string) => ownHiveRoot((await showcaseHome(zone).catch(() => null)) ?? zone, key))
      const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
      const own = String(await keyOf().catch(() => '')).toLowerCase()
      if (!SIG_RE.test(own) || !lineage || !SIG_RE.test(want)) return done
      const zones = [...new Set((await zonesOf(segments).catch(() => [] as string[])).map(zone => String(zone ?? '').trim().toLowerCase()).filter(Boolean))]
      for (const zone of zones) {
        const showcase = await showcaseOf(zone).catch(() => null)
        if (!showcase?.items.some(item => String(item.pubkey).toLowerCase() === own && item.lineage === lineage)) continue
        let seen = false
        for (let tries = 0; tries < VISIBLE_TRIES && !seen; tries++) {
          seen = String(await visibleOf(zone, lineage).catch(() => null) ?? '').toLowerCase() === want
          if (!seen && tries < VISIBLE_TRIES - 1) await sleep(VISIBLE_STEP_MS * (tries + 1))
        }
        const result: CommunityPromotion = !seen
          ? { ok: false, reason: `${zone} does not hand visitors the new ${lineage} yet` }
          : await (deps.promote ?? promoteForCommunity)(zone, lineage)
            .catch((error: unknown): CommunityPromotion => ({ ok: false, reason: error instanceof Error ? error.message : 'failed' }))
        done.push({ zone, result })
      }
    } catch { /* a courtesy after the publish, never a failure of it */ }
    return done
  })
  // The queue moves on when the run ends or its hold runs out, whichever is first: the run itself is not cancelled.
  let timer: ReturnType<typeof setTimeout> | undefined
  const held = new Promise<void>(resolve => { timer = setTimeout(resolve, deps.holdMs ?? REPROMOTE_HOLD_MS) })
  repromoting = Promise.race([run.catch(() => undefined), held]).finally(() => clearTimeout(timer))
  return run
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
