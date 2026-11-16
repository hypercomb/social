// sharing/community-switch.ts
//
// LIVE IN YOUR COMMUNITY, OR NOT (jwize 2026-11-16: "you should have your own domain and the community
// separate since you are feeding the community from all domains including yourself … for anything you click
// the item turns on for the domain but is gray in the community … all items go in the community; if there
// are multiple versions you should be able to drill down into the children and click the one of them. This
// makes only two things you can do in the app here: add to community through domains, and publish live").
//
// The Publish window's second act. A creation switched on in a domain stands in the community gray —
// staged. A press here puts it live: it goes into the owners' signed showcase for their own domain
// (`showcase:<zone>`, what every visitor reads), and one of this key's own creations is optimized first
// (promote.ts promoteForCommunity — going live is the promote). A press on a live one takes it out: it is
// in its domains still, gray again. One version of a name is live at a time: picking one takes the other
// versions of that name out in the same write.
//
// The front door keeps a staged list of its own (`staged:<zone>`, what its Publish will sign). When one is
// signed, the same difference is applied to it, so a phone that publishes what is staged does not undo
// what was done here.

import { ROOT_MOVED } from './hive-pointer.js'
import { publisherKeyHex } from './key-list.client.js'
import { promoteForCommunity, type CommunityPromotion } from './promote.js'
import { readSignedAt, showcaseKey, signShowcase, stagedKey, type Showcase, type ShowcaseItem } from './showcase-record.js'

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/
const LINEAGE_OK = (lineage: string): boolean => lineage.length >= 1 && lineage.length <= 200 && !/[\s\x00-\x1f\x7f]/.test(lineage)

export type CommunitySwitch = {
  readonly zone: string
  readonly item: ShowcaseItem
  readonly on: boolean
  /** The other versions of the same name, taken out when this one goes live. */
  readonly others?: readonly ShowcaseItem[]
}

export type CommunitySwitchResult =
  | { readonly ok: true; readonly changed: boolean; readonly items: readonly ShowcaseItem[] }
  | { readonly ok: false; readonly reason: string }

export type CommunitySwitchDeps = {
  readonly own?: () => Promise<string>
  readonly readAt?: typeof readSignedAt
  readonly sign?: typeof signShowcase
  readonly promote?: (zone: string, lineage: string) => Promise<CommunityPromotion>
  /** Wait before reading again after another device moved the record (tests pass 0). */
  readonly backoff?: (tries: number) => number
}

const same = (a: ShowcaseItem, b: ShowcaseItem): boolean => a.pubkey === b.pubkey && a.lineage === b.lineage
const MOVED_TRIES = 6

/** The items after the switch: the others and (going out) the item itself removed, the item added going in. */
export const switchedItems = (base: readonly ShowcaseItem[], request: CommunitySwitch): ShowcaseItem[] => {
  const out = [request.item, ...(request.on ? request.others ?? [] : [])]
  const kept = base.filter(row => !out.some(gone => same(gone, row)))
  return request.on ? [...kept, request.item] : kept
}

/** A record with its items replaced; a community losing what left keeps the rest. */
const withItems = (record: Showcase, items: readonly ShowcaseItem[]): Showcase => {
  const kept = (row: ShowcaseItem): boolean => items.some(item => same(item, row))
  return {
    ...record,
    items: [...items],
    ...(record.communities ? { communities: record.communities.map(community => ({ ...community, items: community.items.filter(kept) })) } : {}),
  }
}

/** Read `key`, apply the switch, sign expecting what was read; again on what is there when another device moved it.
 *  `create` says whether a zone with no record yet gets one (the showcase does; a staged list that was never
 *  started is left unstarted). */
const settle = async (
  zone: string, key: string, request: CommunitySwitch, create: boolean, deps: CommunitySwitchDeps,
): Promise<CommunitySwitchResult> => {
  const readAt = deps.readAt ?? readSignedAt
  const sign = deps.sign ?? signShowcase
  for (let tries = 0; tries < MOVED_TRIES; tries++) {
    if (tries) await new Promise(wait => setTimeout(wait, deps.backoff ? deps.backoff(tries) : 150 * tries + Math.floor(Math.random() * 150)))
    let read: { sig: string | null; record: Showcase | null }
    try { read = await readAt(zone, key) } catch { return { ok: false, reason: 'could not read your community' } }
    if (!read.record && !create) return { ok: true, changed: false, items: [] }
    const record = read.record ?? { zone, items: [], domains: [] }
    const items = switchedItems(record.items, request)
    const moved = items.length !== record.items.length || items.some(item => !record.items.some(row => same(row, item)))
    if (!moved) return { ok: true, changed: false, items }
    const signed = await sign(withItems(record, items), key, read.sig)
    if (signed.ok) return { ok: true, changed: true, items }
    if (signed.reason !== ROOT_MOVED) return { ok: false, reason: signed.reason }
  }
  return { ok: false, reason: 'your other devices kept changing it; try again' }
}

/** Put one version live in the community of `zone`, or take it out. Idempotent. */
export async function switchInCommunity(request: CommunitySwitch, deps: CommunitySwitchDeps = {}): Promise<CommunitySwitchResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  const item = { pubkey: String(request.item?.pubkey ?? '').toLowerCase(), lineage: String(request.item?.lineage ?? '') }
  if (!ZONE.test(zone) || !SIG.test(item.pubkey) || !LINEAGE_OK(item.lineage)) return { ok: false, reason: 'bad request' }
  const own = String(await (deps.own ?? (() => publisherKeyHex({ known: true })))().catch(() => '') ?? '').toLowerCase()
  if (!SIG.test(own)) return { ok: false, reason: 'no key on this device' }
  const switched: CommunitySwitch = { zone, item, on: request.on === true, others: (request.others ?? []).filter(other => !same(other, item)) }
  // GOING LIVE IS THE PROMOTE, AND IT OPTIMIZES BY ITSELF (jwize 2026-11-13). Another key's creation is its author's.
  if (switched.on && item.pubkey === own) {
    const done = await (deps.promote ?? promoteForCommunity)(zone, item.lineage)
      .catch((): CommunityPromotion => ({ ok: false, reason: `${item.lineage} could not be optimized` }))
    if (!done.ok) return { ok: false, reason: done.reason }
  }
  const live = await settle(zone, showcaseKey(zone), switched, true, deps)
  if (!live.ok || !live.changed) return live
  // The front door's staged list follows, when it has one. Its failure never undoes what went live.
  await settle(zone, stagedKey(zone), switched, false, deps).catch(() => null)
  return live
}
