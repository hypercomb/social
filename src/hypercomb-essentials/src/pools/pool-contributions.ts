// pools/pool-contributions.ts
//
// WHO LEAVES WHAT IN WHICH POOL. Pools mode knows which tiles are lit and how a
// pool is left on a host; it does not know what a recipe template is, nor a
// mail template, nor anything a later feature offers. A feature that has rows
// to offer says so with a CONTRIBUTION: the pool's meaning, the words for a
// count of its members, and how to read the members out of the lit routes.
// Publish asks every contribution and leaves each pool on the participant's
// own root domain (documentation/pools-as-relational-database.md, T9).
//
// A pool is a name (N1, P4), and which rows belong to it is the feature's to
// say, never this file's: adding a pool is one more contribution, no edit
// here. A contribution's members are an offer (T5, T8): nothing is sent until
// the participant publishes, the preview only counts, and a pool whose lit
// members are now none is withdrawn, never deleted (H4, M3).
//
// A TILE THAT COULD NOT BE READ IS NOT A TILE THAT HOLDS NOTHING. What it
// carries may be in a pool now, and a list made without it would take that
// row back on the word of a failed read. So a publish first asks whether
// every lit tile could be read (a head known but not readable yet, a child of
// a lit branch that cannot be named yet), and when one could not, nothing is
// asked, sent or cleared: what is published stays as it is, and the result
// says which tile. A contribution that finds a tile unreadable in its own
// reading says so by throwing from `membersOf`, and its pool is left the same
// way. A contribution that knows nothing of this is safe: the first check is
// made here, before it is asked.
//
// This file registers nothing in the hive and never calls its own register: a
// behaviour file hands its contribution in.

import { I18N_IOC_KEY, get, normalizeCell, type I18nProvider } from '@hypercomb/core'
import { childNamesOfStrict, type PlacementHistory, type PlacementLayer } from '../history/layer-placement.js'
import { mapBounded } from '../sharing/bounded-fetch.js'
import { isPublishNode, zoneDoor } from '../sharing/zone-door.js'
import type { LightsPublished, LightsPublishedPool } from './lights-contract.js'
import { litTileRoutes, litTiles, liveChildrenOf, type LitTile } from './lit-tiles.js'
import { OFFERED_MAX_MEMBERS, publishOfferedPool, type OfferedPublishResult } from './offered-pool.js'

const SIG = /^[a-f0-9]{64}$/
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
/** Lit tiles asked at once whether they could be read. */
const TILES_AT_ONCE = 8

/** One feature's rows in one pool. */
export interface PoolContribution {
  /** The pool's meaning, `family:name`. */
  readonly meaning: string
  /** The i18n key base and the English words for a count: `<key>.one`, `<key>.other` with `{count}`. */
  readonly label: { readonly key: string; readonly one: string; readonly other: string }
  /**
   * The member signatures the lit routes carry for this pool. A tile that
   * holds nothing to offer is left out. A tile that could not be READ is never
   * left out as if it held nothing: the contribution throws, and the pool is
   * left as it is published.
   */
  membersOf(routes: readonly (readonly string[])[]): Promise<readonly string[]>
  /** Every other atom those members name, which a reader needs beside them. */
  closureOf?(members: readonly string[]): Promise<readonly string[]>
}

// Pinned on globalThis like EffectBus: a feature and the bar that publishes are
// built into separate bundles, and two copies of this table would be no table.
const contributions: Map<string, PoolContribution> =
  ((globalThis as { __hypercombPoolContributions?: Map<string, PoolContribution> }).__hypercombPoolContributions ??= new Map())

/** Hand in a contribution. A later one for the same meaning takes its place. */
export function registerPoolContribution(contribution: PoolContribution): void {
  contributions.set(contribution.meaning, contribution)
}

/** Every contribution handed in, in the order their meanings first arrived. */
export const poolContributions = (): PoolContribution[] => [...contributions.values()]

/** The history, as far as telling a tile that could not be read from one that holds nothing. */
interface LitHistory extends PlacementHistory {
  /** `stats.cold` set beside a null: the layer could not be read just now, which is not a tile with no layer. */
  currentLayerAt(locationSig: string, stats?: { cold?: boolean }): Promise<PlacementLayer | null>
}

/** What the preview and the publish do their work with. Injectable, so a spec needs no hive. */
export interface LitPoolsDeps {
  /** The participant's named host, '' for none. */
  host?: () => string
  lit?: () => Promise<readonly LitTile[]>
  childrenOf?: (segments: readonly string[]) => Promise<readonly string[]>
  contributions?: () => readonly PoolContribution[]
  publish?: (host: string, meaning: string, members: readonly string[], options?: { closure?: readonly string[] }) => Promise<OfferedPublishResult>
  /** Where a publish asks whether each lit tile could be read. With none to ask, no tile is known to be unread. */
  history?: LitHistory
  now?: () => number
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const sigsOf = (values: readonly string[]): string[] =>
  [...new Set(values.map(value => String(value ?? '').trim().toLowerCase()).filter(sig => SIG.test(sig)))]

/** The lit marks, and every lit route they cover, expanded once. */
const litNow = async (deps: LitPoolsDeps): Promise<{ tiles: readonly LitTile[]; routes: string[][] }> => {
  const tiles = await (deps.lit ?? litTiles)()
  return { tiles, routes: await litTileRoutes(tiles, deps.childrenOf ?? liveChildrenOf()) }
}

/**
 * The lit routes that could not be READ just now: a tile whose layer is known
 * but not readable yet, a tile under a lit branch with a child that cannot be
 * named yet (the walk under it saw fewer tiles than there are), and a tile the
 * history failed to answer for. Never a tile with no layer at all: that one
 * holds nothing, and says so.
 */
const unreadRoutes = async (deps: LitPoolsDeps, tiles: readonly LitTile[], routes: readonly (readonly string[])[]): Promise<string[][]> => {
  let history: LitHistory | undefined
  try { history = deps.history ?? get<LitHistory>(HISTORY_KEY) } catch { history = undefined }
  if (!history?.sign || !history.currentLayerAt) return []
  const asked = history
  const fold = (segments: readonly string[]): string[] => segments.map(part => normalizeCell(part) || part)
  const branches = tiles.filter(tile => tile.branch).map(tile => fold(tile.segments))
  const walked = (route: readonly string[]): boolean => {
    const at = fold(route)
    return branches.some(root => root.length <= at.length && root.every((part, index) => part === at[index]))
  }
  const read = await mapBounded(routes, TILES_AT_ONCE, async (route): Promise<boolean> => {
    const stats: { cold?: boolean } = {}
    const layer = await asked.currentLayerAt(await asked.sign({ explorerSegments: () => route }), stats)
    if (!layer) return stats.cold !== true
    return !walked(route) || !(await childNamesOfStrict(asked, layer)).coldMiss
  })
  return routes.filter((_, index) => read[index] !== true).map(route => [...route])
}

/** The members one contribution would leave: signatures only, once each, at most what one host offers. */
const membersFor = async (contribution: PoolContribution, routes: readonly (readonly string[])[]): Promise<string[]> =>
  sigsOf(await contribution.membersOf(routes)).slice(0, OFFERED_MAX_MEMBERS)

/**
 * What Publish would leave: how many tiles are lit (a lit branch counted with
 * everything under it) and how many members each pool would hold. Counts only:
 * nothing is sent and nothing is written. Never throws.
 */
export async function litPoolPreview(deps: LitPoolsDeps = {}): Promise<{ lit: number; pools: { meaning: string; count: number; label: PoolContribution['label'] }[] }> {
  let routes: string[][] = []
  try { routes = (await litNow(deps)).routes } catch { routes = [] }
  const pools: { meaning: string; count: number; label: PoolContribution['label'] }[] = []
  for (const contribution of (deps.contributions ?? poolContributions)()) {
    let count = 0
    try { count = (await membersFor(contribution, routes)).length } catch { count = 0 }
    pools.push({ meaning: contribution.meaning, count, label: contribution.label })
  }
  return { lit: routes.length, pools }
}

/**
 * Leave what the lit tiles carry in the pools at the participant's own root
 * domain: every contribution is asked once for its members and what they
 * name, and each pool is published, or withdrawn when its lit members are now
 * none. When a lit tile could not be read, no pool is published or withdrawn:
 * what the host holds is left as it is. `ok` only when every pool succeeded;
 * `reason` is the first failure's words. Emits nothing: the caller announces
 * the result. Never throws.
 */
export async function publishLitPools(deps: LitPoolsDeps = {}): Promise<LightsPublished> {
  const now = deps.now ?? Date.now
  const pools: LightsPublishedPool[] = []
  let host = ''
  try {
    // The public host when one is named, else the home domain the hosts window
    // names (jwize 2026-11-17: "that domain is included"). Never a default.
    const named = (): string => {
      const sync = get<{ publicHostDomain?(): string; ownHostDomain?(): string }>(HOST_SYNC_KEY)
      return sync?.publicHostDomain?.() || sync?.ownHostDomain?.() || ''
    }
    host = zoneDoor((deps.host ?? named)())
  } catch { host = '' }
  if (!host || !isPublishNode(host)) {
    return { at: now(), ok: false, host: '', pools, reason: t('offered.publish.noHost', 'Name your home domain first, in the hosts window. That is where your pools are left.') }
  }
  let reason: string | undefined
  try {
    const { tiles, routes } = await litNow(deps)
    const unread = await unreadRoutes(deps, tiles, routes)
    if (unread[0]) {
      // What that tile carries may be in a pool now: no contribution is asked, and nothing is sent or cleared.
      reason = t('offered.publish.unreadTile', '"{tile}" could not be read just now, so what {host} holds was left as it is. Publish again in a moment.', { tile: unread[0].join('/'), host })
    }
    const publish = deps.publish ?? publishOfferedPool
    const asked = unread.length ? [] : (deps.contributions ?? poolContributions)()
    for (const contribution of asked) {
      let done: OfferedPublishResult
      try {
        const members = await membersFor(contribution, routes)
        const closure = members.length && contribution.closureOf ? sigsOf(await contribution.closureOf(members)) : []
        done = await publish(host, contribution.meaning, members, { closure })
      } catch {
        // The contribution could not read what a lit tile carries: its pool is never published as a shorter one.
        done = { ok: false, reason: t('offered.publish.unread', 'What the lit tiles carry for {meaning} could not be read, so it was left as it is on {host}.', { meaning: contribution.meaning, host }) }
      }
      if (done.ok) pools.push({ meaning: contribution.meaning, count: done.count })
      else reason ??= done.reason
    }
  } catch {
    reason ??= t('offered.publish.failed', 'The lit tiles could not be read.')
  }
  return { at: now(), ok: reason === undefined, host, pools, ...(reason !== undefined ? { reason } : {}) }
}
