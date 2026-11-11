// hypercomb-shim/src/bootstrap/showcase-lanes.ts
//
// THE PHONE'S SHOWCASE IN LANES (jwize 2026-11-05: "we do lanes and fixed scrolling like lanes is normal on desktop
// now"; "we want the lanes look for the showcase"; "landing grid would be cool as well for the available space").
// On a phone the open row's hexagons stop scrolling with the page. They sit in a fixed block of lanes, sized to the
// space the row has (the landing grid), and that block never moves: slot `s` is always the same place on the screen.
// A drag up or down moves the WINDOW, not the camera, so slot `s` shows tile `s + offset`. The tiles follow the
// finger while the drag is clear, and snap to whole steps when it ends.
//
// THE LOCK (jwize: "you can show the tiles moving but then lock into place if the touch becomes confusing"): a second
// finger, or a drag that is not clearly up or down, puts the tiles straight back in their slots and keeps them there
// until every finger has lifted. A press that never travels is a tap, and nothing under it ever moved.
//
// The slots are the hive's own axial matrix, pointy-top or flat-top (`laneAxial`), the same lattice the images wall
// and the hive's lanes lay tiles on. Everything here is pure: no DOM except the orientation kept in the store.
// The hive's own lanes geometry (essentials rail-window.ts) cannot be imported by a host page, so this is the page's
// copy of the same contract, restricted to the one strip the page has: a column running down.

const SQRT3 = Math.sqrt(3)

/** The narrowest a tile may be drawn, in CSS px, before a lane is given up for room. */
export const LANE_MIN_TILE = 88
/** The most lanes a phone's width is split into. */
export const LANE_MAX = 4
/** How far a press travels before it is anything but a tap. */
export const LANE_SLOP = 10

export type LaneLayout = {
  readonly flat: boolean
  /** How many tiles across. */
  readonly lanes: number
  /** How many lines of tiles fit down the space. */
  readonly rows: number
  /** Lines one step moves: two for pointy-top, whose lines alternate their half-tile shift; one for flat-top. */
  readonly stepRows: number
  /** Slots the block holds: lanes × rows. */
  readonly capacity: number
  /** A tile's drawn box. */
  readonly tileWidth: number
  readonly tileHeight: number
  /** The distance down one step moves, in px. */
  readonly stepPx: number
  /** Where the block starts, so it sits in the middle of the space. */
  readonly originX: number
  readonly originY: number
  /** Centre-to-centre between neighbours. */
  readonly spacing: number
}

/** The landing grid: as many lanes as the width holds at a readable size, as many lines as the height holds. */
export const laneLayout = (width: number, height: number, flat: boolean, gap = 6, minTile = LANE_MIN_TILE): LaneLayout => {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  // A tile's width for n lanes, solved from the block's width.
  const tileFor = (n: number): number => flat
    // flat-top: columns 1.5R + gap·√3/2 apart, tile 2R wide
    ? 2 * Math.max(0, (w - (n - 1) * gap * SQRT3 / 2) / (1.5 * (n - 1) + 2))
    // pointy-top: neighbours (tile + gap) apart, alternate lines shifted half of that
    : n === 1 ? w : Math.max(0, (w - gap * (n - 0.5)) / (n + 0.5))
  let lanes = 1
  for (let n = LANE_MAX; n >= 1; n--) if (tileFor(n) >= minTile) { lanes = n; break }
  // A single lane never grows past what a line of two tall tiles needs; it stays a tile, not a wall.
  const tileWidth = Math.min(tileFor(lanes), lanes === 1 ? Math.min(w, h / 1.4) : Infinity)
  const radius = flat ? tileWidth / 2 : tileWidth / SQRT3
  const tileHeight = flat ? SQRT3 * radius : 2 * radius
  const spacing = (flat ? SQRT3 * radius : tileWidth) + gap
  const pitchX = flat ? spacing * SQRT3 / 2 : spacing
  const pitchY = flat ? spacing : spacing * SQRT3 / 2
  const tuck = flat && lanes > 1 ? spacing / 2 : 0
  const rows = Math.max(1, Math.floor((h - tileHeight - tuck) / pitchY) + 1)
  const stepRows = flat ? 1 : 2
  const usedW = flat ? pitchX * (lanes - 1) + tileWidth : pitchX * (lanes - 1) + (lanes > 1 && rows > 1 ? spacing / 2 : 0) + tileWidth
  const usedH = pitchY * (rows - 1) + tuck + tileHeight
  return {
    flat, lanes, rows, stepRows, capacity: lanes * rows, tileWidth, tileHeight, spacing,
    stepPx: pitchY * stepRows,
    originX: Math.max(0, (w - usedW) / 2),
    originY: Math.max(0, (h - usedH) / 2),
  }
}

/** The top-left of the tile in lane `lane`, line `row` (any line, above or below the block, for the ones sliding in). */
export const lanePosition = (layout: LaneLayout, lane: number, row: number): { readonly x: number; readonly y: number } => {
  const { flat, spacing, originX, originY } = layout
  const odd = (n: number): boolean => ((n % 2) + 2) % 2 === 1
  return flat
    ? { x: originX + lane * spacing * SQRT3 / 2, y: originY + row * spacing + (odd(lane) && layout.lanes > 1 ? spacing / 2 : 0) }
    : { x: originX + lane * spacing + (odd(row) && layout.lanes > 1 ? spacing / 2 : 0), y: originY + row * spacing * SQRT3 / 2 }
}

/** The axial address of a slot: pointy-top lines are odd-r offset rows, flat-top lanes are odd-q offset columns. */
export const laneAxial = (flat: boolean, lane: number, row: number): { readonly q: number; readonly r: number } => flat
  ? { q: lane, r: row - (lane - (lane & 1)) / 2 }
  : { q: lane - (row - (row & 1)) / 2, r: row }

/** How many steps the window can travel for `count` tiles. */
export const laneMaxShift = (layout: LaneLayout, count: number): number => {
  const perStep = layout.lanes * layout.stepRows
  return Math.max(0, Math.ceil((count - layout.capacity) / perStep))
}

/** The tile a slot shows at a shift: -1 when there is none. */
export const laneTileAt = (layout: LaneLayout, shift: number, lane: number, row: number, count: number): number => {
  const index = (shift * layout.stepRows + row) * layout.lanes + lane
  return index >= 0 && index < count ? index : -1
}

/** Where a drag that travelled `dy` px settles: whole steps, a quarter step is enough to take one, never past the ends. */
export const laneSnap = (dy: number, stepPx: number, shift: number, maxShift: number): number => {
  const travel = -dy / Math.max(1, stepPx)
  const steps = Math.abs(travel) < 0.25 ? 0 : Math.sign(travel) * Math.max(1, Math.round(Math.abs(travel)))
  return Math.min(maxShift, Math.max(0, shift + steps))
}

/** How far the tiles follow the finger: freely between the ends, a short stretch past them. */
export const laneDrift = (dy: number, stepPx: number, shift: number, maxShift: number): number => {
  const atTop = shift <= 0 && dy > 0
  const atEnd = shift >= maxShift && dy < 0
  return atTop || atEnd ? Math.sign(dy) * Math.min(Math.abs(dy) * 0.3, stepPx * 0.3) : dy
}

export type LaneMode = 'idle' | 'press' | 'drift' | 'locked'

/** THE LOCK, as a state machine over pointers. A press stays a press inside the slop; clearly up or down is a drift;
 *  a second finger, or a press that leaves the slop any other way, is locked until every finger is up. */
export class LaneTouch {
  #mode: LaneMode = 'idle'
  #start = { x: 0, y: 0 }
  #first = -1
  #down = new Set<number>()
  #dy = 0

  get mode(): LaneMode { return this.#mode }
  /** How far the tiles are drawn off their slots now. */
  get dy(): number { return this.#mode === 'drift' ? this.#dy : 0 }

  down(id: number, x: number, y: number): LaneMode {
    this.#down.add(id)
    if (this.#down.size > 1) { this.#mode = 'locked'; return this.#mode }
    this.#first = id
    this.#start = { x, y }
    this.#dy = 0
    this.#mode = 'press'
    return this.#mode
  }

  move(id: number, x: number, y: number): LaneMode {
    if (id !== this.#first || this.#mode === 'locked' || this.#mode === 'idle') return this.#mode
    const dx = x - this.#start.x
    const dy = y - this.#start.y
    if (this.#mode === 'press') {
      if (Math.hypot(dx, dy) < LANE_SLOP) return this.#mode
      // Clearly down the lanes, or nothing: across is the page's own swipe, and between the two is confusing.
      this.#mode = Math.abs(dy) >= 1.4 * Math.abs(dx) ? 'drift' : 'locked'
    }
    if (this.#mode === 'drift') this.#dy = dy
    return this.#mode
  }

  /** A finger lifted or was taken by the browser. Returns what the gesture was, once the last finger is up. */
  up(id: number): { readonly mode: LaneMode; readonly dy: number } | null {
    if (!this.#down.delete(id)) return null
    if (this.#down.size > 0) return null
    const ended = { mode: this.#mode, dy: this.#mode === 'drift' ? this.#dy : 0 }
    this.#mode = 'idle'
    this.#first = -1
    this.#dy = 0
    return ended
  }
}

/** ONE PER SUBDOMAIN, ON ANY DOMAIN (jwize 2026-11-05: "one per subdomain on of any domain"; a bare apex counts as one):
 *  bringing a tile in from a host that already has one in the community takes the earlier one's place. */
export const onePerHost = <T>(picks: readonly T[], next: T, hostOf: (pick: T) => string): T[] => {
  const host = hostOf(next).toLowerCase()
  return [...picks.filter(pick => hostOf(pick).toLowerCase() !== host), next]
}

/** The host a link opens on, or `fallback` when it names none. */
export const hostOf = (href: string, fallback: string): string => {
  try { return new URL(href).hostname.toLowerCase() || fallback } catch { return fallback }
}

// ── the orientation, kept in this browser through the store (one document, never a raw storage write) ──

type PoolStore = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
}
const ORIENTATION_POOL = 'showcase:orientation'
const ORIENTATION_KIND = 'showcase:orientation'
const store = (): PoolStore | undefined => (window as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<PoolStore>('@hypercomb.social/Store')

export const parseOrientation = (raw: unknown): boolean | null => {
  const record = raw as { kind?: unknown; flat?: unknown } | null
  return record && record.kind === ORIENTATION_KIND && typeof record.flat === 'boolean' ? record.flat : null
}

// THE LOOK THIS BROWSER CHOSE (jwize 2026-11-10: swiping left or right while editing changes the view) rides in the same
// document as the orientation — how this browser draws the showcase: the look by page ('' is All). Never signed; what a
// visitor sees is the owners' record.
const KEPT_VIEWS = ['hex', 'launcher', 'iphone', 'list', 'tiles'] as const
type KeptView = (typeof KEPT_VIEWS)[number]
export const parseTriedViews = (raw: unknown): Record<string, KeptView> => {
  const record = raw as { kind?: unknown; views?: unknown } | null
  const out: Record<string, KeptView> = {}
  if (!record || record.kind !== ORIENTATION_KIND || !record.views || typeof record.views !== 'object') return out
  for (const [key, view] of Object.entries(record.views as Record<string, unknown>).slice(0, 64)) {
    if (key.length <= 200 && (KEPT_VIEWS as readonly unknown[]).includes(view)) out[key] = view as KeptView
  }
  return out
}

/** The one document, as last read or written here: a write of one half never drops the other. */
let drawn: { flat: boolean; views: Record<string, KeptView> } | null = null
const readDrawn = async (): Promise<{ flat: boolean; views: Record<string, KeptView> }> => {
  if (drawn) return drawn
  const found = store()
  let raw: unknown = null
  try {
    const dir = found?.getPool ? await found.getPool(ORIENTATION_POOL) : null
    const bytes = dir ? await found!.getPoolDoc(dir) : null
    raw = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
  } catch { raw = null }
  return drawn ??= { flat: parseOrientation(raw) ?? false, views: parseTriedViews(raw) }
}
const keepDrawn = async (next: { flat: boolean; views: Record<string, KeptView> }): Promise<boolean> => {
  const found = store()
  if (!found?.getPool) return false
  try {
    const dir = await found.getPool(ORIENTATION_POOL)
    if (!dir) return false
    drawn = next
    const views = Object.fromEntries(Object.entries(next.views).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: ORIENTATION_KIND, flat: next.flat,
      ...(Object.keys(views).length ? { views } : {}) })).buffer as ArrayBuffer
    return !!(await found.putPoolDoc(dir, bytes, undefined, { keep: 'current' }))
  } catch { return false }
}

/** Flat-top when this browser chose it; pointy-top, the hive's default, otherwise. */
export const readLaneOrientation = async (): Promise<boolean> => (await readDrawn()).flat
export const keepLaneOrientation = async (flat: boolean): Promise<boolean> => keepDrawn({ ...(await readDrawn()), flat })
export const readTriedViews = async (): Promise<Record<string, KeptView>> => (await readDrawn()).views
export const keepTriedViews = async (views: Record<string, string>): Promise<boolean> =>
  keepDrawn({ ...(await readDrawn()), views: parseTriedViews({ kind: ORIENTATION_KIND, views }) })
