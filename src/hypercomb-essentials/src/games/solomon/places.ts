/** Labels and lookups over the place graph: `PLACES` (the catalog every
 *  `PlaceDefinition` lives in), the group/floor machinery caverns and the
 *  interior chain share, and the three frozen legacy identity tables a v1/v2
 *  save's migration reads (never placement — a reshuffle never edits these).
 *  Pure; no DOM, no storage. */

import type { PlaceCatalog, PlaceDefinition, PlaceStep, StorySeat } from './place.js'
import { levelsBelow, seatAt } from './place.js'
import type { GroupRecord } from './chamber-places.js'
import { CHAMBERS, GROUPS } from './chamber-places.js'
import { WORLD_AREAS, WORLD_DOORS, WORLD_DUNGEONS, WORLD_PLOTS, WORLD_SHRINES } from './rpg-overworld.js'
import { STORY } from './story.js'

export interface SeatLabel { readonly name: string; readonly subtitle: string; readonly levels: number }

/** The island: never seated (it is `ROOT_PLACE`), so `arrivals` is never
 *  actually read at runtime — one default entry keeps the type honest. Its
 *  entrances are every island encounter that can host a place below it:
 *  the three shrines, the two cave mouths, the one house door, the one
 *  area, and the four still-empty plots. */
export const ISLAND_PLACE: PlaceDefinition = {
  id: 'island', name: 'The Sevenfold Valley', subtitle: 'A walking island of shrines, caves and roads', kind: 'island',
  entrances: [...WORLD_SHRINES, ...WORLD_DUNGEONS, ...WORLD_DOORS, ...WORLD_AREAS, ...WORLD_PLOTS].map(p => p.id),
  arrivals: [{ id: 'valley', name: 'The Sevenfold Valley' }],
}

/** One place, reached through three different shrine doors, each landing at
 *  a different arrival — `entrances: []` because nothing is hosted below a
 *  labyrinth room; a door leads to another room of the same place, never to
 *  a child place. */
export const LABYRINTH_PLACE: PlaceDefinition = {
  id: 'labyrinth', name: 'A labyrinth', subtitle: 'Sealed rooms below a shrine', kind: 'labyrinth',
  entrances: [],
  arrivals: [
    { id: 'sunseed', name: 'Sunseed' },
    { id: 'tideglass', name: 'Tideglass' },
    { id: 'starbloom', name: 'Pyramid of Accord' },
  ],
}

/** A chamber's own map declares exactly one spawn point (`arrive()` always
 *  lands on `exits[0]`, and no seat in `STORY` ever names a non-default
 *  `arrive` for a chamber) — one arrival, uniformly, is the true shape. */
function chamberPlace(definition: (typeof CHAMBERS)[number]): PlaceDefinition {
  return {
    id: definition.id, name: definition.name, subtitle: definition.subtitle, kind: 'chamber',
    entrances: definition.entrances.map(entrance => entrance.id),
    arrivals: [{ id: 'default', name: definition.name }],
    group: definition.group, heart: definition.heart,
  }
}

/** Insertion order: island, labyrinth, then every chamber in `CHAMBERS`'
 *  own order (the caverns' three floors each, the interior chain, the
 *  Hollow Grove last). */
export const PLACES: PlaceCatalog = new Map<string, PlaceDefinition>([
  [ISLAND_PLACE.id, ISLAND_PLACE],
  [LABYRINTH_PLACE.id, LABYRINTH_PLACE],
  ...CHAMBERS.map((definition): [string, PlaceDefinition] => [definition.id, chamberPlace(definition)]),
])

export function placeName(place: string): string {
  return PLACES.get(place)?.name ?? place
}

export function groupOfPlace(place: string): GroupRecord | null {
  const group = PLACES.get(place)?.group
  if (!group) return null
  return GROUPS.find(record => record.id === group) ?? null
}

/** The entrance key that seats a group's topmost floor — the one seat whose
 *  place wears this group's mark and whose own entrance is hosted by the
 *  island, never by another chamber. */
export function groupEntry(group: string, story: readonly StorySeat[] = STORY): string | null {
  for (const seat of story) {
    if (!seat.entrance.startsWith('island/')) continue
    if (PLACES.get(seat.place)?.group === group) return seat.entrance
  }
  return null
}

/** Every place wearing `group`'s mark, breadth-first from the group's entry
 *  floor down through whichever of its own entrances seat another floor of
 *  the same group. */
export function groupFloors(group: string, story: readonly StorySeat[] = STORY): readonly string[] {
  const entry = groupEntry(group, story)
  if (!entry) return []
  const first = seatAt(story, entry)
  if (!first) return []
  const floors: string[] = []
  const queue: string[] = [first.place]
  const seen = new Set<string>(queue)
  while (queue.length) {
    const place = queue.shift() as string
    floors.push(place)
    const definition = PLACES.get(place)
    if (!definition) continue
    for (const entranceId of definition.entrances) {
      const child = seatAt(story, `${place}/${entranceId}`)
      if (!child || seen.has(child.place) || PLACES.get(child.place)?.group !== group) continue
      seen.add(child.place)
      queue.push(child.place)
    }
  }
  return floors
}

/** null when `place` wears no group. */
export function floorLabel(place: string, story: readonly StorySeat[] = STORY): string | null {
  const group = groupOfPlace(place)
  if (!group) return null
  const floors = groupFloors(group.id, story)
  const index = floors.indexOf(place)
  if (index < 0) return null
  return `Floor ${index + 1} of ${floors.length} · ${group.name}`
}

export function seatLabel(entrance: string, story: readonly StorySeat[] = STORY): SeatLabel | null {
  const seat = seatAt(story, entrance)
  if (!seat) return null
  const definition = PLACES.get(seat.place)
  if (!definition) return null
  return { name: definition.name, subtitle: definition.subtitle, levels: levelsBelow(story, PLACES, seat.place) }
}

export function crumbLabel(steps: readonly PlaceStep[], index: number, story: readonly StorySeat[] = STORY): string {
  const step = steps[index]
  if (!step) return ''
  if (index === 0) return placeName(step.place)
  const label = floorLabel(step.place, story)
  const name = placeName(step.place)
  return label ? `${name} (${label.split(' · ')[0]})` : name
}

/** Every tablet's own or default knowledge id, every chest grant, and every
 *  artifact's knowledge id, scanned once per call — `CHAMBERS` is small and
 *  this is never a hot path (a journal look-up, not a per-frame read). */
function eachKnowledgeId(visit: (id: string, chamber: (typeof CHAMBERS)[number], name: string) => void): void {
  for (const chamber of CHAMBERS) {
    for (const tablet of chamber.tablets) visit(tablet.knowledgeId ?? `${chamber.id}-${tablet.id}`, chamber, tablet.title)
    for (const chest of chamber.chests) for (const grant of chest.grants ?? []) visit(grant.id, chamber, grant.text)
    if (chamber.artifact) visit(chamber.artifact.knowledgeId, chamber, chamber.artifact.name)
  }
}

export function knowledgeGroup(knowledgeId: string): string | null {
  const legacy = LEGACY_KNOWLEDGE_GROUPS[knowledgeId]
  if (legacy) return legacy
  let found: string | null = null
  eachKnowledgeId((id, chamber) => { if (id === knowledgeId) found = chamber.group ?? null })
  return found
}

export function authoredItemName(knowledgeId: string): string | null {
  let found: string | null = null
  eachKnowledgeId((id, _chamber, name) => { if (id === knowledgeId) found = name })
  return found
}

/** The two legacy `ScrollDungeonModel` instances keyed by `levelIndex`
 *  (`createScrollDungeon`'s own `index >= 2` split) to the new entry floor
 *  a v1 dungeon snapshot migrates its progress onto. */
export const LEGACY_DUNGEON_INDEX: Readonly<Record<0 | 2, string>> = { 0: 'wet-steps', 2: 'hall-of-hours' }

/** The legacy dungeon's own id to the knowledge id its one artifact always
 *  granted — unchanged across the refactor (`spring-heart`/`accord-sanctum`
 *  grant the identical ids today), so a v1 `discovered` entry for either
 *  needs no rewriting, only a lookup to know which chamber to mark claimed. */
export const LEGACY_DUNGEON_ARTIFACT: Readonly<Record<string, string>> = {
  'wayfarer-cavern': 'wayfarer-spring',
  'highland-cavern': 'highland-accord',
}

/** Knowledge ids the legacy dungeons minted before any tablet existed to
 *  derive a group from structurally — `knowledgeGroup` checks this first. */
export const LEGACY_KNOWLEDGE_GROUPS: Readonly<Record<string, string>> = {
  'wayfarer-spring': 'wayfarer-cavern',
  'highland-accord': 'highland-cavern',
}
