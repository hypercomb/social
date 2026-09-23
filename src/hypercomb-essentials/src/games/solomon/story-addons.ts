// A story add-on: places a participant made — worlds, overhead chambers,
// side-view caverns — and the seats that plug them into the story ("place
// P sits in entrance E"). It arrives as data (a tile under the game's
// `stories` layer, or a file handed in), is read and refused WHOLE when
// anything in it is wrong, and is seated when the game opens. Once seated,
// its places stand like any other: crumbs, saves, entrances-as-marks, all
// of it. Pure: no DOM, no storage.
import { buildChamber, ChamberModel, CHAMBER_MAP_CHARS, type ChamberDefinition } from './chamber.js'
import { registerChamber } from './chamber-places.js'
import { MOSSBACK_STORY } from './mossback.story.js'
import { splitEntranceKey, seatAt, validateStory, type PlaceCatalog, type PlaceDefinition, type StorySeat } from './place.js'
import { PLACES, chamberPlace, registerPlace, sideCavernPlace, worldPlace } from './places.js'
import type { WorldDefinition } from './rpg-overworld.js'
import { drawCavern, registerSideCavern, type CavernPlan, type SideCavernDefinition } from './side-cavern.js'
import { ROOT_PLACE, STORY, registerSeats } from './story.js'
import { registerWorld, sanitizeWorld } from './worlds.js'

export const STORY_BUNDLE_VERSION = 1
/** The most a bundle may weigh, serialized. */
export const STORY_BUNDLE_BYTES = 256 * 1024

export interface StoryBundle {
  readonly version: typeof STORY_BUNDLE_VERSION
  /** /^[a-z0-9-]{1,64}$/ — the add-on's own name, and its tile's. */
  readonly id: string
  readonly name: string
  readonly worlds: readonly WorldDefinition[]
  readonly chambers: readonly ChamberDefinition[]
  readonly caverns: readonly SideCavernDefinition[]
  readonly seats: readonly StorySeat[]
}

export type StoryInstall =
  | { readonly ok: true; readonly id: string; readonly places: readonly string[]; readonly seats: number; readonly already: boolean }
  | { readonly ok: false; readonly id: string; readonly problem: string }

/** What the game seeds into its `stories` layer the first time it opens —
 *  one worked example a participant can copy: a tile, holding a bundle. */
export interface StorySeedTile { readonly id: string; readonly bundle: unknown }
export const STORY_SEEDS: readonly StorySeedTile[] = [{ id: 'mossback', bundle: MOSSBACK_STORY }]

// ── reading ──────────────────────────────────────────────────────────────

const ID = /^[a-z0-9-]{1,64}$/
const LOOKS: ReadonlySet<string> = new Set(['cavern', 'cellar', 'house', 'wood'])
const CHAMBER_LISTS = [
  'exits', 'entrances', 'tablets', 'gates', 'chests', 'doors', 'shutters', 'plates', 'blocks',
  'levers', 'lamps', 'lampSets', 'sigils', 'alcoves', 'residents', 'furniture', 'effects', 'foes',
] as const

type Raw = Record<string, unknown>
const record = (value: unknown): Raw | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : null
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.length <= max ? value : null
const whole = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
function list<T>(value: unknown, max: number, each: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null
  const out: T[] = []
  for (const item of value) { const read = each(item); if (read === null) return null; out.push(read) }
  return out
}

/** Data and nothing else: strings kept short, numbers finite, shallow. */
function plain(value: unknown, depth = 0): boolean {
  if (depth > 6) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return value.length <= 600
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 64 && value.every(item => plain(item, depth + 1))
  const fields = record(value)
  return !!fields && Object.keys(fields).length <= 32 && Object.values(fields).every(item => plain(item, depth + 1))
}

/** Reads a chamber a participant made. Its shape is checked here, its
 *  geometry by the same build every authored chamber goes through — and a
 *  chamber that cannot be built and arrived in is refused. */
export function sanitizeChamber(raw: unknown): ChamberDefinition | null {
  const fields = record(raw)
  if (!fields || !plain(fields)) return null
  const id = text(fields['id'], 64), name = text(fields['name'], 80), subtitle = text(fields['subtitle'], 160)
  const look = text(fields['look'], 16), torch = fields['torch'], sconces = fields['sconces']
  if (!id || !ID.test(id) || name === null || subtitle === null || !look || !LOOKS.has(look)) return null
  if (typeof torch !== 'number' || !(torch >= 1 && torch <= 12) || typeof sconces !== 'boolean') return null
  const map = list(fields['map'], 64, line => typeof line === 'string' && line.length >= 4 && line.length <= 96 && [...line].every(ch => CHAMBER_MAP_CHARS.has(ch)) ? line : null)
  if (!map || map.length < 4 || map.some(line => line.length !== map[0]!.length)) return null
  const cols = map[0]!.length, rows = map.length
  const placed = (value: unknown): boolean => {
    const thing = record(value)
    if (!thing) return false
    if ('col' in thing && whole(thing['col'], 0, cols - 1) === null) return false
    if ('row' in thing && whole(thing['row'], 0, rows - 1) === null) return false
    return true
  }
  const lists: Partial<Record<(typeof CHAMBER_LISTS)[number], unknown[]>> = {}
  for (const field of CHAMBER_LISTS) {
    const items = list(fields[field] ?? [], 64, item => placed(item) ? item : null)
    if (!items) return null
    lists[field] = items
  }
  for (const field of ['artifact', 'risingLight', 'finale'] as const) if (fields[field] !== undefined && !placed(fields[field])) return null
  const definition = { ...fields, ...lists, id, name, subtitle, look, torch, sconces, map } as unknown as ChamberDefinition
  if (!definition.exits.length) return null
  try {
    buildChamber(definition)
    new ChamberModel(definition).arrive()
  } catch { return null }
  return definition
}

/** Reads a side-view cavern a participant drew: an ASCII plan, drawn the
 *  same way the game's own are. */
export function sanitizeCavern(raw: unknown): SideCavernDefinition | null {
  const fields = record(raw)
  if (!fields || !plain(fields)) return null
  const id = text(fields['id'], 64), name = text(fields['name'], 80), subtitle = text(fields['subtitle'], 160)
  const theme = text(fields['theme'], 32), meters = whole(fields['meters'], 1, 8)
  if (!id || !ID.test(id) || name === null || subtitle === null || theme === null || meters === null) return null
  const line = (value: unknown): string | null => typeof value === 'string' && value.length >= 8 && value.length <= 96 && /^[ -~]+$/.test(value) ? value : null
  const art = list(fields['art'], 64, line), finds = list(fields['finds'] ?? [], 64, line)
  if (!art || art.length < 6 || art.some(row => row.length !== art[0]!.length) || !finds) return null
  if (art.join('').split('<').length !== 2) return null
  const plan: CavernPlan = { id, name, subtitle, theme, meters, art, finds }
  try { return drawCavern(plan) } catch { return null }
}

/** Reads a bundle. Anything wrong anywhere refuses the whole add-on: null. */
export function readStoryBundle(raw: unknown): StoryBundle | null {
  const fields = record(raw)
  if (!fields || fields['version'] !== STORY_BUNDLE_VERSION) return null
  let weight = 0
  try { weight = JSON.stringify(raw).length } catch { return null }
  if (weight > STORY_BUNDLE_BYTES) return null
  const id = text(fields['id'], 64), name = text(fields['name'], 80)
  if (!id || !ID.test(id) || name === null) return null
  const worlds = list(fields['worlds'] ?? [], 8, sanitizeWorld)
  const chambers = list(fields['chambers'] ?? [], 16, sanitizeChamber)
  const caverns = list(fields['caverns'] ?? [], 8, sanitizeCavern)
  const seats = list(fields['seats'] ?? [], 64, value => {
    const seat = record(value), entrance = text(seat?.['entrance'], 160), place = text(seat?.['place'], 64)
    const arrive = seat?.['arrive'] === undefined ? undefined : text(seat['arrive'], 64)
    if (!entrance || !splitEntranceKey(entrance) || !place || !ID.test(place) || arrive === null) return null
    return arrive === undefined ? { entrance, place } : { entrance, place, arrive }
  })
  if (!worlds || !chambers || !caverns || !seats) return null
  return { version: STORY_BUNDLE_VERSION, id, name, worlds, chambers, caverns, seats }
}

// ── seating ──────────────────────────────────────────────────────────────

const installed = new Map<string, Extract<StoryInstall, { ok: true }>>()

/** The add-ons seated so far this session, in order. */
export function installedStories(): readonly string[] { return [...installed.keys()] }

/** Seats a bundle into the story, or refuses it whole and says why. A new
 *  place must be a new name; a seat must name an entrance its host really
 *  has, that nothing is seated behind yet; and the story with the new seats
 *  in it must still be a story — no place inside itself. */
export function installStory(bundle: StoryBundle): StoryInstall {
  const already = installed.get(bundle.id)
  if (already) return { ...already, already: true }
  const refuse = (problem: string): StoryInstall => ({ ok: false, id: bundle.id, problem })
  const fresh: PlaceDefinition[] = [...bundle.worlds.map(worldPlace), ...bundle.chambers.map(chamberPlace), ...bundle.caverns.map(sideCavernPlace)]
  const names = new Set<string>()
  for (const place of fresh) {
    if (PLACES.has(place.id) || names.has(place.id)) return refuse(`a place named "${place.id}" already stands`)
    names.add(place.id)
  }
  const catalog: PlaceCatalog = new Map([...PLACES, ...fresh.map((place): [string, PlaceDefinition] => [place.id, place])])
  for (const seat of bundle.seats) {
    if (seatAt(STORY, seat.entrance)) return refuse(`"${seat.entrance}" already has a place seated behind it`)
    const split = splitEntranceKey(seat.entrance)!
    const host = catalog.get(split.place)
    if (!host) return refuse(`"${split.place}" is not a place`)
    if (!host.entrances.includes(split.entrance)) return refuse(`"${split.place}" has nothing called "${split.entrance}"`)
    const seated = catalog.get(seat.place)
    if (!seated) return refuse(`"${seat.place}" is not a place this story or the game knows`)
    if (seat.arrive !== undefined && !seated.arrivals.some(arrival => arrival.id === seat.arrive)) return refuse(`"${seat.place}" has no arrival called "${seat.arrive}"`)
  }
  const problems = validateStory([...STORY, ...bundle.seats], catalog, ROOT_PLACE)
  if (problems.length) return refuse(problems[0]!)
  for (const world of bundle.worlds) registerWorld(world)
  for (const chamber of bundle.chambers) registerChamber(chamber)
  for (const cavern of bundle.caverns) registerSideCavern(cavern)
  for (const place of fresh) registerPlace(place)
  registerSeats(bundle.seats)
  const result = { ok: true as const, id: bundle.id, places: fresh.map(place => place.id), seats: bundle.seats.length, already: false }
  installed.set(bundle.id, result)
  return result
}
