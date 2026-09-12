/** Save v3 — one pure, signature-agnostic module that turns whatever JSON a
 *  save slot holds (today's overlay v1, today's overlay v2, or the new v3
 *  shape this file introduces) into one `AdventureRestorePlan` the shell
 *  (`labyrinth-overlay.ts`, Phase 3) applies, and turns a live session back
 *  into a v3 payload to write. No DOM, no storage, no mutation of anything
 *  it is handed — every function here is a pure transform of `unknown` JSON.
 *
 *  final-spec.md §3.7 gives this file's exact, final export list and only
 *  two imports: `place.js` (types only) and `chamber.js` (type only). That
 *  is deliberate, not an oversight: `story.ts`/`places.ts`/`chamber-places.ts`
 *  are this same phase's siblings (owners `story`/`content`) and carry real
 *  content this file must stay ignorant of. Two literal place ids appear
 *  below (`'island'`, `'labyrinth'`) — they mirror `ROOT_PLACE` (story.ts)
 *  and `LABYRINTH_PLACE.id` (places.ts), which this file cannot import
 *  without crossing into content it has no business reading. Both are
 *  foundational, permanent identities (§3.3/§3.1), not reshuffle surfaces.
 *
 *  `journey` is opaque here, on purpose (M6/M15): never inspected beyond
 *  "is it an object" (the v2 path) or "is it present" (the v3 path). The
 *  labyrinth's `kit`/`weapon`/`spell` combat fields already ride inside
 *  `JourneySnapshot.stats` — zero lines here change for combat.
 *
 *  Migration ground truth (v1/v2 overlay shapes, dungeon-v1 shapes) was
 *  read directly out of today's `labyrinth-overlay.ts` (`#restoreSlot`,
 *  `#snapshot`, `#getDungeon`'s `onKnowledge`/`onComplete` wiring) and
 *  `scroll-dungeon.ts` (`ScrollDungeonModel.exportState`/`restoreState`,
 *  its `discovered` keying) on 2026-09-12, and cross-checked against the
 *  real fixtures `adventure-save.spec.ts`'s Phase-0 section captured from
 *  those same classes. See that file's own header for exact line refs. */

import type { PlaceStep, StorySeat } from './place.js'
import type { ChamberSnapshot } from './chamber.js'

export interface CarriedEntry { readonly from: string; readonly value: unknown }

export interface AdventureSnapshotV3 {
  version: 3
  journey: unknown
  knowledge: [id: string, text: string][]
  path: PlaceStep[]
  places: [place: string, facts: unknown][]
  carried: CarriedEntry[]
  revealed: string[]
  found: string[]
  [extra: string]: unknown
}

export interface AdventureRestorePlan {
  readonly source: 1 | 2 | 3
  readonly progress: unknown
  readonly journey: unknown | null
  readonly knowledge: readonly (readonly [string, string])[]
  readonly path: unknown
  readonly places: ReadonlyMap<string, unknown>
  readonly carried: readonly CarriedEntry[]
  readonly extra: readonly (readonly [string, unknown])[]
  readonly revealed: readonly string[] | null
  readonly found: readonly string[]
}

export const ADVENTURE_BOUNDS = {
  pathSteps: 16, places: 64, placeBytes: 16384,
  knowledge: 256, knowledgeText: 4000,
  carried: 8, carriedBytes: 32768,
  extraFields: 8, extraBytes: 32768,
  revealed: 512, found: 128, factId: 96,
} as const

// ---------------------------------------------------------------------------
// Frozen local identities. See the file header: these mirror story.ts's
// ROOT_PLACE and places.ts's LABYRINTH_PLACE.id without importing either.
// ---------------------------------------------------------------------------
const ISLAND = 'island'
const LABYRINTH = 'labyrinth'

/** `PlaceDefinition.id`'s own pattern (place.ts). */
const PLACE_ID_PATTERN = /^[a-z0-9-]{1,64}$/
/** §3.7's `revealed`/`found` entry pattern — a `skill:<id>` fits it unmodified (M19). */
const FACT_ID_PATTERN = /^[a-z0-9:#./-]{1,96}$/

const KNOWN_V3_FIELDS: ReadonlySet<string> = new Set([
  'version', 'journey', 'knowledge', 'path', 'places', 'carried', 'revealed', 'found',
])

// ---------------------------------------------------------------------------
// Generic, content-agnostic validation helpers. Every one is defensive by
// construction: a malformed PIECE is dropped, never the whole plan.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** JSON byte-size estimate used for every "…Bytes" bound. Never throws. */
function byteSize(value: unknown): number {
  try { return JSON.stringify(value)?.length ?? 0 } catch { return Number.POSITIVE_INFINITY }
}

/** Keeps items, in order, until either `maxCount` is reached or the next
 *  item would push the running byte total past `maxBytes` — never reorders,
 *  never partially includes an item. */
function limitByBudget<T>(items: readonly T[], maxCount: number, sizeOf: (item: T) => number, maxBytes: number): T[] {
  const out: T[] = []
  let total = 0
  for (const item of items) {
    if (out.length >= maxCount) break
    const size = sizeOf(item)
    if (total + size > maxBytes) break
    out.push(item)
    total += size
  }
  return out
}

/** Validates an array of `[string, string]` pairs, dropping any pair whose
 *  shape is wrong or whose text exceeds `knowledgeText` — the exact
 *  tolerance `labyrinth-overlay.ts`'s own `#readKnowledge` already applies
 *  to this same shape today. No count cap here (see `boundedKnowledge`). */
function pairsFrom(value: unknown): [string, string][] {
  if (!Array.isArray(value)) return []
  const out: [string, string][] = []
  for (const pair of value) {
    if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string'
      && pair[1].length <= ADVENTURE_BOUNDS.knowledgeText) out.push([pair[0], pair[1]])
  }
  return out
}

/** Dedupes by id (first wins) and caps at `ADVENTURE_BOUNDS.knowledge`. */
function boundedKnowledge(pairs: readonly (readonly [string, string])[]): [string, string][] {
  const out: [string, string][] = []
  const seen = new Set<string>()
  for (const [id, text] of pairs) {
    if (out.length >= ADVENTURE_BOUNDS.knowledge) break
    if (seen.has(id)) continue
    seen.add(id)
    out.push([id, text])
  }
  return out
}

/** `[gate, sequence][]` — identical shape to a `ScrollDungeonSnapshot.progress`
 *  entry and to `ChamberSnapshot.runes`; only the field name changes. */
function runesFrom(value: unknown): [string, string[]][] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: [string, string[]][] = []
  for (const item of value) {
    if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && isStringArray(item[1])) out.push([item[0], [...item[1]]])
  }
  return out
}

/** Validates an array of `[string, unknown]` tuples (a place/facts row, an
 *  extra-field row, …) — shape only, the value itself stays opaque. */
function tuplesFrom(value: unknown): [string, unknown][] {
  if (!Array.isArray(value)) return []
  const out: [string, unknown][] = []
  for (const item of value) if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string') out.push([item[0], item[1]])
  return out
}

/** Caps a places collection at `ADVENTURE_BOUNDS.places` entries, dropping
 *  (never refusing the whole plan for) any single entry whose facts alone
 *  exceed `placeBytes`. */
function boundedPlaces(entries: Iterable<readonly [string, unknown]>): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [id, facts] of entries) {
    if (out.size >= ADVENTURE_BOUNDS.places) break
    if (typeof id !== 'string' || id.length === 0) continue
    if (byteSize(facts) > ADVENTURE_BOUNDS.placeBytes) continue
    out.set(id, facts)
  }
  return out
}

function carriedFrom(value: unknown): CarriedEntry[] {
  if (!Array.isArray(value)) return []
  const out: CarriedEntry[] = []
  for (const item of value) if (isRecord(item) && typeof item['from'] === 'string') out.push({ from: item['from'], value: item['value'] })
  return out
}

function boundedCarried(entries: readonly CarriedEntry[]): CarriedEntry[] {
  return limitByBudget(entries, ADVENTURE_BOUNDS.carried, entry => entry.from.length + byteSize(entry.value), ADVENTURE_BOUNDS.carriedBytes)
}

/** `revealed`/`found` share one entry grammar (`factId`): lowercase id
 *  characters, sorted, deduped, capped at `max`. A `skill:<id>` fits
 *  unmodified (M19). */
function factIdList(values: Iterable<unknown>, max: number): string[] {
  const out = new Set<string>()
  for (const value of values) if (typeof value === 'string' && FACT_ID_PATTERN.test(value)) out.add(value)
  return [...out].sort().slice(0, max)
}

/** `null` means the field was absent — the caller seeds it fresh (§3.7's
 *  M2 seeding block); an array, however oversized or partly malformed,
 *  keeps its first `revealed` valid entries rather than refusing the plan. */
function boundedRevealed(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return factIdList(value, ADVENTURE_BOUNDS.revealed)
}

/** `[]` when absent — unlike `revealed`, an empty ledger needs no seeding. */
function boundedFound(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return factIdList(value, ADVENTURE_BOUNDS.found)
}

/** Every top-level key of `raw` that isn't one of v3's own named fields,
 *  budget-capped — round-tripped verbatim by `writeAdventureSave` so a
 *  newer client's fields survive an older reader untouched. */
function extraFrom(raw: Record<string, unknown>): [string, unknown][] {
  const entries: [string, unknown][] = []
  for (const key of Object.keys(raw)) if (!KNOWN_V3_FIELDS.has(key)) entries.push([key, raw[key]])
  return limitByBudget(entries, ADVENTURE_BOUNDS.extraFields, ([, value]) => byteSize(value), ADVENTURE_BOUNDS.extraBytes)
}

// ---------------------------------------------------------------------------
// migrateDungeonV1 — the legacy ScrollDungeonModel → ChamberSnapshot bridge.
// ---------------------------------------------------------------------------

interface ParsedDungeonV1 {
  /** The raw pair's own first element (today always 0 or 2) — kept only so
   *  `legacyPath` can resolve a v2 `location.dungeon` index back to the
   *  content-keyed id below; never used as an identity itself. */
  readonly index: unknown
  /** Content-keyed identity (M-quality: trust the content's own id, never
   *  the array position) — `record.dungeonId`, exactly as `ScrollDungeonModel
   *  .exportState()` writes it today. */
  readonly id: string
  readonly chamber: Partial<ChamberSnapshot>
  readonly discovered: readonly (readonly [string, string])[]
}

/** Parses whatever an overlay v2's `dungeons` field holds today —
 *  `[index, ScrollDungeonSnapshot][]` — into one content-keyed record per
 *  well-formed entry. A malformed entry (wrong shape, no `dungeonId`, a
 *  `dungeonId` outside `PLACE_ID_PATTERN`) is skipped, never thrown on;
 *  every other field is copied field-by-field, defensively, never trusting
 *  the shape as a whole. */
function parseDungeonsV1(raw: unknown): ParsedDungeonV1[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedDungeonV1[] = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [index, record] = entry
    if (!isRecord(record)) continue
    const id = record['dungeonId']
    if (typeof id !== 'string' || !PLACE_ID_PATTERN.test(id)) continue

    // `place`/`version` are required by `ChamberModel.restoreState` (it
    // no-ops on any mismatch) — the migrated snapshot must claim the same
    // identity chamber-places.ts will give this cavern, and the same
    // ChamberSnapshot version scroll-dungeon.ts already happens to share.
    const chamber: Partial<ChamberSnapshot> = { version: 1, place: id }
    if (isStringArray(record['readClues'])) chamber.read = [...record['readClues']]
    if (isStringArray(record['openGates'])) chamber.attuned = [...record['openGates']]
    const runes = runesFrom(record['progress'])
    if (runes) chamber.runes = runes
    if (typeof record['complete'] === 'boolean') chamber.claimed = record['complete']

    out.push({ index, id, chamber, discovered: pairsFrom(record['discovered']) })
  }
  return out
}

/** Structural migration only: readClues→read, openGates→attuned,
 *  progress→runes (same tuple shape, renamed), complete→claimed. Every
 *  field a `ChamberModel` invented that `ScrollDungeonModel` never had
 *  (`unlocked`/`latched`/`pulled`/`lit`/`wand`/`blocks`/`memories`/
 *  `explored`/`player`) is left unset by design — this is a `Partial`,
 *  and inventing chamber-specific feature ids (an alcove's real `id`, a
 *  lamp set's members, …) is content this file has no way to know and no
 *  business guessing at (content lives in `chamber-places.ts`, the
 *  `content` role's file, never imported here). `ChamberModel.restoreState`
 *  already treats every absent field as "never happened", which is exactly
 *  right for mechanics a legacy save never had a concept of. */
export function migrateDungeonV1(snapshot: unknown): Map<string, Partial<ChamberSnapshot>> {
  const map = new Map<string, Partial<ChamberSnapshot>>()
  for (const parsed of parseDungeonsV1(snapshot)) map.set(parsed.id, parsed.chamber)
  return map
}

/** Best-effort v1/v2 `path` guess from the legacy `location` field, routed
 *  through the CURRENT `story` seating rather than any fixed entrance name
 *  — so a reshuffle since the save was made still lands correctly. This is
 *  only ever a starting guess: `PlacePath.restore` (place.ts, called later
 *  by the shell) re-validates every step against the live catalog and
 *  drops anything it cannot stand up, falling all the way back to the
 *  bare root if even this first step turns out to be wrong. */
function legacyPath(location: Record<string, unknown> | null, dungeons: readonly ParsedDungeonV1[], story: readonly StorySeat[]): PlaceStep[] {
  const root: PlaceStep = { place: ISLAND, via: null }
  const mode = location?.['mode']
  let target: string | null = null
  if (mode === 'room') target = LABYRINTH
  else if (mode === 'dungeon') target = dungeons.find(d => d.index === location?.['dungeon'])?.id ?? null
  if (!target) return [root]
  const seat = story.find(s => s.place === target)
  if (!seat) return [root]
  return [root, { place: target, via: seat.entrance }]
}

// ---------------------------------------------------------------------------
// readAdventureSave — version dispatch.
// ---------------------------------------------------------------------------

/** The legacy overlay v1 slot: `{ version: 1, progress, sockets, met,
 *  solved, knowledge }` — `labyrinth-overlay.ts`'s `#restoreSlot` version-1
 *  branch, today. Never refused: v1 predates any notion of a malformed
 *  save being turned away, and this reader keeps that promise exactly —
 *  every sub-field is passed through as whatever it is, however malformed,
 *  for the consuming class (`RpgOverworld.restoreState`, `LabyrinthJourney
 *  .restoreProgress`) to make its own defensive sense of, unchanged from
 *  today. Always resumes at the island (v1 never persisted a room or
 *  dungeon location). */
function readV1(raw: Record<string, unknown>): AdventureRestorePlan {
  return {
    source: 1,
    progress: raw['progress'],
    journey: null,
    knowledge: boundedKnowledge(pairsFrom(raw['knowledge'])),
    path: [{ place: ISLAND, via: null }],
    places: boundedPlaces([[ISLAND, { version: 1, filledSockets: raw['sockets'], met: raw['met'], solved: raw['solved'] }]]),
    carried: [],
    extra: [],
    revealed: null,
    found: [],
  }
}

/** The overlay v2 slot: `{ version: 2, journey, world, knowledge, dungeons,
 *  location }` — today's `#snapshot()`. Refused (returns `null`) only when
 *  `journey` or `world` is not itself a record — the one refusal
 *  `#restoreSlot` already applies today (`!record(save['journey']) ||
 *  !record(save['world'])`); every other field degrades gracefully. Each
 *  dungeon's own `discovered` pairs are folded into `knowledge` alongside
 *  the overlay's own top-level knowledge (both already share the exact
 *  same `[id, text]` contract — Phase 0's fixtures prove this), the
 *  overlay's own entries winning any id collision since they were recorded
 *  by the very same live play session. */
function readV2(raw: Record<string, unknown>, story: readonly StorySeat[]): AdventureRestorePlan | null {
  const journey = raw['journey']
  const world = raw['world']
  if (!isRecord(journey) || !isRecord(world)) return null

  const dungeons = parseDungeonsV1(raw['dungeons'])
  const placeEntries: [string, unknown][] = [[ISLAND, world]]
  for (const dungeon of dungeons) placeEntries.push([dungeon.id, dungeon.chamber])

  const knowledgePairs = pairsFrom(raw['knowledge'])
  const seen = new Set(knowledgePairs.map(([id]) => id))
  for (const dungeon of dungeons) for (const pair of dungeon.discovered) if (!seen.has(pair[0])) { knowledgePairs.push([pair[0], pair[1]]); seen.add(pair[0]) }

  const location = isRecord(raw['location']) ? raw['location'] : null
  return {
    source: 2,
    progress: journey['progress'],
    journey,
    knowledge: boundedKnowledge(knowledgePairs),
    path: legacyPath(location, dungeons, story),
    places: boundedPlaces(placeEntries),
    carried: [],
    extra: [],
    revealed: null,
    found: [],
  }
}

/** The new v3 shape (`AdventureSnapshotV3`). The v3 refusal table has
 *  exactly one row, by design: `journey` absent. `journey` is otherwise
 *  never inspected (M6/M15 — "is it present", not "is it an object", is
 *  the whole check), so `plan.journey` carries whatever is there and
 *  `plan.progress` is only extracted when that happens to be a record.
 *  Every other field — `knowledge`, `path`, `places`, `carried`, `extra`,
 *  `revealed`, `found` — degrades to its own lenient default instead of
 *  refusing the plan, exactly as (2) A11.7 asks specifically for
 *  `revealed`/`found` and as this file generalises for every other
 *  array-shaped field. */
function readV3(raw: Record<string, unknown>): AdventureRestorePlan | null {
  if (raw['journey'] === undefined) return null
  const journey = raw['journey']
  const journeyRecord = isRecord(journey) ? journey : null

  return {
    source: 3,
    progress: journeyRecord ? journeyRecord['progress'] : undefined,
    journey,
    knowledge: boundedKnowledge(pairsFrom(raw['knowledge'])),
    path: Array.isArray(raw['path']) ? raw['path'].slice(0, ADVENTURE_BOUNDS.pathSteps) : [],
    places: boundedPlaces(tuplesFrom(raw['places'])),
    carried: boundedCarried(carriedFrom(raw['carried'])),
    extra: extraFrom(raw),
    revealed: boundedRevealed(raw['revealed']),
    found: boundedFound(raw['found']),
  }
}

/** Reads any save slot payload — v1, v2, or v3 — into one restore plan the
 *  shell applies uniformly. `null` only for a payload with no recognisable
 *  version at all, or a v2/v3 payload missing its one required blob
 *  (`journey`, and for v2 also `world`) — see `readV1`/`readV2`/`readV3`.
 *  `story` is used only to route a v1/v2 `location` guess through the
 *  CURRENT story seating (`legacyPath`) — a v3 payload's own `path` is
 *  already routed and needs no story lookup here. */
export function readAdventureSave(raw: unknown, story: readonly StorySeat[] = []): AdventureRestorePlan | null {
  if (!isRecord(raw)) return null
  const version = raw['version']
  if (version === 1) return readV1(raw)
  if (version === 2) return readV2(raw, story)
  if (version === 3) return readV3(raw)
  return null
}

/** Composes a fresh v3 payload. Known-fields-win: any `extra` entry whose
 *  key collides with one of v3's own named fields cannot happen (`extra`
 *  is always built by filtering those keys out first — see `extraFrom`/
 *  `AdventureRestorePlan.extra`), but the composition order below still
 *  makes that guarantee explicit and structural rather than incidental:
 *  `extra` is spread first, the named fields are spread second, so a named
 *  field always wins even if a caller hands back an unfiltered `extra`. */
export function writeAdventureSave(parts: {
  readonly journey: unknown
  readonly knowledge: Iterable<readonly [string, string]>
  readonly path: readonly PlaceStep[]
  readonly places: ReadonlyMap<string, unknown>
  readonly carried: readonly CarriedEntry[]
  readonly extra: readonly (readonly [string, unknown])[]
  readonly revealed: Iterable<string>
  readonly found: Iterable<string>
}): AdventureSnapshotV3 {
  const extraEntries = limitByBudget(
    parts.extra.filter(([key]) => !KNOWN_V3_FIELDS.has(key)),
    ADVENTURE_BOUNDS.extraFields,
    ([, value]) => byteSize(value),
    ADVENTURE_BOUNDS.extraBytes,
  )
  const extra: Record<string, unknown> = {}
  for (const [key, value] of extraEntries) extra[key] = value

  const known: AdventureSnapshotV3 = {
    version: 3,
    journey: parts.journey,
    knowledge: boundedKnowledge([...parts.knowledge]),
    path: [...parts.path].slice(0, ADVENTURE_BOUNDS.pathSteps),
    places: [...boundedPlaces([...parts.places])],
    carried: boundedCarried([...parts.carried]),
    revealed: factIdList(parts.revealed, ADVENTURE_BOUNDS.revealed),
    found: factIdList(parts.found, ADVENTURE_BOUNDS.found),
  }
  return { ...extra, ...known }
}
