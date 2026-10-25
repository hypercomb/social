// history/tile-order.ts
//
// WHERE A TILE SITS IS ITS PAGE'S CLAIM, NOT THE TILE'S.
//
// A tile's seat on a page used to be `properties.index` inside the tile's OWN
// layer. So every move re-minted the tile to carry its landing seat, every
// drag wrote one props resource and one marker per tile, and the signature
// that travelled was never the one that was listed. The doctrine had already
// decided it (hypergraph-molecule-lineage.md, "Ordering"; "slot rides the
// envelope"): order is the PARENT's claim about its members, never a fact
// inside a member.
//
// So a page carries one slot, `order`, holding ONE signature: a JSON resource
// `{ "<child name>": <seat>, … }` with sorted keys. Keyed by NAME, because the
// name is the tile's identity and its signature changes with every edit. A
// tile that moves, is pasted, or is dragged keeps its signature; the page it
// sits on gains a marker that says where.
//
// Old tiles keep their `properties.index`. It is READ as a fallback for a tile
// the page's order does not name, and never rewritten — data does not heal, it
// moves forward.
//
// WRITES go through ONE door: LayerCommitter applies an `OrderChanges` to the
// page's head inside its commit queue (`nextOrderSig`), in the same marker as
// whatever else that act commits. Nothing here writes.

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

export const ORDER_SLOT = 'order'

/** Seats to set (name → seat) and names to drop, applied together. */
export type OrderChanges = {
  readonly set?: Readonly<Record<string, number>>
  readonly remove?: readonly string[]
}

type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  putResource(blob: Blob): Promise<string>
}

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string, stats?: { cold?: boolean }): Promise<Record<string, unknown> | null>
}

const isSeat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Is there anything in `changes` to apply? */
export const hasOrderChanges = (changes: OrderChanges | undefined): changes is OrderChanges =>
  !!changes && (Object.keys(changes.set ?? {}).length > 0 || (changes.remove?.length ?? 0) > 0)

/** The seats a decoded order record names, or null when it is not an order.
 *  Entries that are not a whole non-negative seat are dropped. */
export const seatsFrom = (raw: unknown): Map<string, number> | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const seats = new Map<string, number>()
  for (const [name, seat] of Object.entries(raw as Record<string, unknown>)) {
    if (name && isSeat(seat)) seats.set(name, seat)
  }
  return seats
}

/** The seats an order resource's bytes name, or null when they are not an order. */
export const parseOrder = (text: string): Map<string, number> | null => {
  try { return seatsFrom(JSON.parse(text)) } catch { return null }
}

/** Canonical bytes: sorted keys, so the same seats are the same signature. */
export const serializeOrder = (seats: ReadonlyMap<string, number>): string => {
  const out: Record<string, number> = {}
  for (const name of [...seats.keys()].sort()) out[name] = seats.get(name)!
  return JSON.stringify(out)
}

/** Removes first, then sets — so one act can move a seat to a new name. */
export const applyOrderChanges = (
  seats: ReadonlyMap<string, number>,
  changes: OrderChanges,
): Map<string, number> => {
  const next = new Map(seats)
  for (const name of changes.remove ?? []) next.delete(name)
  for (const [name, seat] of Object.entries(changes.set ?? {})) {
    if (name && isSeat(seat)) next.set(name, seat)
  }
  return next
}

/** The page's next order signature after `changes`, for the committer:
 *  a signature to set, `null` when no seat is left (drop the slot), or
 *  `undefined` when the CURRENT order could not be read. Undefined means skip
 *  — never rebuild from nothing, which would unseat every tile on the page. */
export const nextOrderSig = async (
  currentRef: string | undefined,
  changes: OrderChanges,
  store: StoreLike,
): Promise<string | null | undefined> => {
  let seats = new Map<string, number>()
  if (currentRef) {
    const blob = await store.getResource(currentRef).catch(() => null)
    if (!blob) return undefined
    const parsed = parseOrder(await blob.text())
    if (!parsed) return undefined
    seats = parsed
  }
  const next = applyOrderChanges(seats, changes)
  if (next.size === 0) return null
  return store.putResource(new Blob([serializeOrder(next)], { type: 'application/json' }))
}

// ── read ────────────────────────────────────────────────────────────────

/** Order resources are immutable — a signature parses to the same seats
 *  forever, so each is parsed once. */
const parsedBySig = new Map<string, ReadonlyMap<string, number>>()
const EMPTY: ReadonlyMap<string, number> = new Map()

/** The seats the page at `parentSegments` claims, from its live head.
 *
 *  `stats.cold` comes back true when the answer is TRANSIENT — services
 *  booting, the head or the resource not readable yet — as opposed to an
 *  authoritative "this page names no seats". A caller that places tiles from
 *  it must treat cold as unknown and retry, the same contract as
 *  `readOwnTilePropertiesAt`. */
export const readOrderAt = async (
  parentSegments: readonly string[],
  stats?: { cold?: boolean },
): Promise<ReadonlyMap<string, number>> => {
  const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!history?.sign || !history.currentLayerAt || !store?.getResource) {
    if (stats) stats.cold = true
    return EMPTY
  }
  const locSig = await history.sign({ explorerSegments: () => [...parentSegments] }).catch(() => '')
  if (!locSig) {
    if (stats) stats.cold = true
    return EMPTY
  }
  const layer = await history.currentLayerAt(locSig, stats).catch(() => null)
  const slot = layer?.[ORDER_SLOT]
  const ref = Array.isArray(slot) && typeof slot[0] === 'string' ? slot[0] : ''
  if (!ref) return EMPTY
  const known = parsedBySig.get(ref)
  if (known) return known
  const blob = await store.getResource(ref).catch(() => null)
  if (!blob) {
    if (stats) stats.cold = true
    return EMPTY
  }
  const seats = parseOrder(await blob.text())
  if (!seats) {
    console.warn('[tile-order] the order resource is not an order; seats fall back to the tiles', ref)
    return EMPTY
  }
  parsedBySig.set(ref, seats)
  return seats
}

// ── the seat of a tile about to be linked ───────────────────────────────
//
// A new tile is ONE undo step: the link that adds it to its page and the seat
// it takes there land in the same marker. The renderer is what knows the free
// seats on the page it is showing, so it registers a chooser; the committer
// asks it when it links a new name into a page. The chooser remembers what it
// chose, so the renderer's own placement of that tile agrees with the marker
// whichever of the two asks first. A page the renderer is not showing gets no
// seat — the tile is seated when that page is next drawn, as before.

/** The seat a tile should take on the page at `parentSegments`, or undefined
 *  when the chooser cannot say (that page is not on screen). */
export type SeatChooser = (parentSegments: readonly string[], name: string) => number | undefined

let chooser: SeatChooser | null = null

export const registerSeatChooser = (fn: SeatChooser | null): void => { chooser = fn }

export const seatFor = (parentSegments: readonly string[], name: string): number | undefined => {
  if (!chooser || !name) return undefined
  try {
    const seat = chooser(parentSegments, name)
    return isSeat(seat) ? seat : undefined
  } catch { return undefined }
}
