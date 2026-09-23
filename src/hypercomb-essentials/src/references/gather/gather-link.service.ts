// references/gather/gather-link.service.ts
//
// The one door for the page ↔ group link (gather-link.ts says what it is).
// A dependency: it exports; gather-link.drone.ts (the bee) registers it.
//
//   attach / detach   — the page wears, or stops wearing, `gathers: <group>`
//   groupsOf(page)    — the groups a page gathers from, in the order attached
//   targetsOf(group)  — every page attached to the group, each on or off
//   setTarget         — switch one target (participant-local, sticky)
//   feed(group, names)— place references to those members on every target
//                       that is ON — never on all of them by itself
//
// The group side needs no list of its own: attaching drops a nomination into
// the `gathers:pages` pool under the group's molecule, and a nomination only
// counts while the page still wears the mark. Detach removes the mark; the
// nomination stays (nothing is deleted) and simply stops counting.

import {
  CANONICAL_REFERENCE_SERVICE_KEY,
  EffectBus,
  moleculeAddress,
  type CanonicalReferenceService,
} from '@hypercomb/core'
import { childNamesOf, resolveLayerAt, type PlacementHistory } from '../../history/layer-placement.js'
import { listDecorations, removeDecorationAndWait, writeDecoration } from '../../commands/decoration-manifest.js'
import { ensureDecorationsIndexed, referenceTargetAt } from '../../commands/decoration-kind-index.js'
import {
  GATHERS_KIND,
  GATHERS_POOL_MEANING,
  GATHER_TARGETS_STORAGE_KEY,
  buildGathersPayload,
  buildPoolRecord,
  cleanRoute,
  groupOfRecord,
  pageOfPoolRecord,
  readTargetState,
  routeKey,
  sameRoute,
  withTarget,
  type GatherTarget,
  type GathersPayload,
  type TargetState,
} from './gather-link.js'

export const GATHER_LINK_SERVICE_KEY = '@diamondcoreprocessor.com/GatherLinkService'

/** The Portals inventory — its rows are references to the groups themselves. */
const PORTALS = 'sets'

type StoreLike = {
  putResource(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type LineageLike = { readonly domain?: unknown }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

const molecule = async (route: readonly string[]): Promise<string | null> => {
  const leaf = route[route.length - 1]
  if (!leaf) return null
  try { return await moleculeAddress(leaf) } catch { return null }
}

export class GatherLinkService {
  /** The groups `page` gathers from, first attached first. */
  async groupsOf(page: readonly string[]): Promise<string[][]> {
    const route = cleanRoute(page)
    if (route.length === 0) return []
    const rows = await listDecorations<GathersPayload>({ kind: GATHERS_KIND, segments: route }).catch(() => [])
    const groups: string[][] = []
    for (const row of rows) {
      const group = groupOfRecord(row.record)
      if (group && !groups.some(g => sameRoute(g, group))) groups.push(group)
    }
    return groups
  }

  /** `page` gathers from `group` from now on. True when it does (or already did). */
  async attach(page: readonly string[], group: readonly string[]): Promise<boolean> {
    const pageRoute = cleanRoute(page)
    const groupRoute = cleanRoute(group)
    if (pageRoute.length === 0 || groupRoute.length === 0 || sameRoute(pageRoute, groupRoute)) return false
    // A doorway is not a holder, and a pointer is not a group: both ends must
    // be the real tiles, never a reference standing in for one.
    if (await this.#targetAt(pageRoute) !== null || await this.#targetAt(groupRoute) !== null) return false
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history) return false
    if (!await resolveLayerAt(history, lineage?.domain, pageRoute)) return false
    if (!await resolveLayerAt(history, lineage?.domain, groupRoute)) return false

    if (!(await this.groupsOf(pageRoute)).some(g => sameRoute(g, groupRoute))) {
      await writeDecoration({
        kind: GATHERS_KIND,
        appliesTo: [],
        payload: buildGathersPayload(groupRoute),
        segments: pageRoute,
      })
    }
    await this.#nominate(groupRoute, pageRoute)
    EffectBus.emit('gather:links-changed', { page: pageRoute, group: groupRoute })
    return true
  }

  /** `page` stops gathering from `group`. True when a link was removed. */
  async detach(page: readonly string[], group: readonly string[]): Promise<boolean> {
    const pageRoute = cleanRoute(page)
    const groupRoute = cleanRoute(group)
    if (pageRoute.length === 0) return false
    const rows = await listDecorations<GathersPayload>({ kind: GATHERS_KIND, segments: pageRoute }).catch(() => [])
    const hits = rows.filter(row => {
      const linked = groupOfRecord(row.record)
      return linked !== null && sameRoute(linked, groupRoute)
    })
    for (const row of hits) await removeDecorationAndWait({ sig: row.sig, segments: pageRoute })
    if (hits.length) EffectBus.emit('gather:links-changed', { page: pageRoute, group: groupRoute })
    return hits.length > 0
  }

  /** Every page that gathers from `group` (by molecule — `people` anywhere is
   *  one group), each with whether it is switched on. */
  async targetsOf(group: readonly string[]): Promise<GatherTarget[]> {
    const groupRoute = cleanRoute(group)
    const groupSig = await molecule(groupRoute)
    if (!groupSig) return []
    const on = new Set(this.#state()[groupSig] ?? [])
    const targets: GatherTarget[] = []
    for (const page of await this.#nominees(groupSig)) {
      if (sameRoute(page, groupRoute) || targets.some(t => sameRoute(t.segments, page))) continue
      const linked = await this.groupsOf(page)
      let wears = false
      for (const g of linked) if (await molecule(g) === groupSig) { wears = true; break }
      if (wears) targets.push({ segments: page, on: on.has(routeKey(page)) })
    }
    return targets
  }

  async setTarget(group: readonly string[], page: readonly string[], on: boolean): Promise<void> {
    const groupSig = await molecule(cleanRoute(group))
    const pageRoute = cleanRoute(page)
    if (!groupSig || pageRoute.length === 0) return
    const next = withTarget(this.#state(), groupSig, routeKey(pageRoute), on)
    try { localStorage.setItem(GATHER_TARGETS_STORAGE_KEY, JSON.stringify(next)) } catch { /* private window: this session only */ }
    this.#memory = next
    EffectBus.emit('gather:targets-changed', { group: cleanRoute(group), page: pageRoute, on })
  }

  /** Reference `names` (members of `group`) on every target that is ON.
   *  Returns the pages that gained at least one. */
  async feed(group: readonly string[], names: readonly string[]): Promise<string[][]> {
    const groupRoute = cleanRoute(group)
    const members = names.map(n => String(n ?? '').trim()).filter(Boolean)
    if (groupRoute.length === 0 || members.length === 0) return []
    const refs = get<CanonicalReferenceService>(CANONICAL_REFERENCE_SERVICE_KEY)
    if (!refs) return []
    const fed: string[][] = []
    for (const target of await this.targetsOf(groupRoute)) {
      if (!target.on) continue
      let gained = false
      for (const name of members) {
        const placed = await refs.place({
          name, sourceSegments: [...groupRoute, name], parentSegments: target.segments,
        }).catch(() => null)
        if (placed) gained = true
      }
      if (gained) fed.push([...target.segments])
    }
    return fed
  }

  /** A typed name → a route: a tile on this page (followed through if it is a
   *  doorway), else one at the top of the hive, else a portal in Portals. */
  async resolveRoute(name: string, here: readonly string[]): Promise<string[] | null> {
    const wanted = String(name ?? '').trim().toLowerCase()
    if (!wanted) return null
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history) return null
    const find = async (page: readonly string[]): Promise<string | null> => {
      const names = await childNamesOf(history, await resolveLayerAt(history, lineage?.domain, page))
      return names.find(n => n.toLowerCase() === wanted) ?? null
    }
    const hereRoute = cleanRoute(here)
    const local = await find(hereRoute)
    if (local) {
      const route = [...hereRoute, local]
      return [...(await this.#targetAt(route) ?? route)]
    }
    const top = await find([])
    if (top) return [top]
    const portal = await find([PORTALS])
    if (portal) {
      const target = await this.#targetAt([PORTALS, portal])
      if (target && target.length) return [...target]
    }
    return null
  }

  #memory: TargetState | null = null

  #state(): TargetState {
    if (this.#memory) return this.#memory
    let raw: string | null = null
    try { raw = localStorage.getItem(GATHER_TARGETS_STORAGE_KEY) } catch { raw = null }
    this.#memory = readTargetState(raw)
    return this.#memory
  }

  async #targetAt(route: readonly string[]): Promise<readonly string[] | null> {
    const label = route[route.length - 1]
    if (!label) return null
    await ensureDecorationsIndexed([label], route.slice(0, -1))
    return referenceTargetAt(route)
  }

  async #bucket(groupSig: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    const pool = await store?.getPool?.(GATHERS_POOL_MEANING).catch(() => null)
    if (!pool) return null
    return pool.getDirectoryHandle(groupSig, { create }).catch(() => null)
  }

  async #nominate(group: readonly string[], page: readonly string[]): Promise<void> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    const groupSig = await molecule(group)
    if (!store || !groupSig) return
    const bytes = new TextEncoder().encode(JSON.stringify(buildPoolRecord(page)))
    const recordSig = await store.putResource(new Blob([bytes], { type: 'application/json' }), { emit: false })
    const bucket = await this.#bucket(groupSig, true)
    if (!bucket) return
    const handle = await bucket.getFileHandle(recordSig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  }

  async #nominees(groupSig: string): Promise<string[][]> {
    const bucket = await this.#bucket(groupSig, false)
    if (!bucket) return []
    const pages: string[][] = []
    try {
      for await (const [, handle] of (bucket as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file') continue
        try {
          const page = pageOfPoolRecord(JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()))
          if (page) pages.push(page)
        } catch { /* a record that does not parse nominates nothing */ }
      }
    } catch { return pages }
    return pages
  }
}

