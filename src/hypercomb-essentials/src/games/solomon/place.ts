/** The place graph. A PLACE is one location a traveller can stand inside —
 *  the island, a labyrinth, a chamber. A place names no parent: it only
 *  declares its own entrances (placeholders in its own map) and its own
 *  arrivals (where a traveller can appear when descending into it). The
 *  RELATION "place P sits in entrance E, arriving at A" is a separate mark, a
 *  `StorySeat` — never a field on P itself. The same place may be seated in
 *  more than one entrance (the labyrinth is one place reached from three
 *  shrine doors on the island, each landing at a different arrival).
 *
 *  `PlacePath` is the shell's own stack of where a traveller has descended
 *  through, in order — the concrete route actually taken, distinct from the
 *  STORY graph's abstract possibilities. Pure; no DOM, no storage, no import
 *  from anywhere else in `solomon/`. */

export type PlaceKind = 'island' | 'labyrinth' | 'chamber'

export interface PlaceArrival {
  readonly id: string
  readonly name: string
}

export interface PlaceDefinition {
  /** /^[a-z0-9-]{1,64}$/. Identity and facts key. Never a route, never a position. */
  readonly id: string
  readonly name: string
  readonly subtitle: string
  readonly kind: PlaceKind
  /** Placeholder ids in this place's own map. They name no place. */
  readonly entrances: readonly string[]
  /** Where you can appear when coming down into this place. [0] is the default. */
  readonly arrivals: readonly PlaceArrival[]
  /** The group mark this place wears (a GROUPS id). A mark, never a parent. */
  readonly group?: string
  /** This place holds its group's heart artifact. */
  readonly heart?: boolean
}

export type PlaceCatalog = ReadonlyMap<string, PlaceDefinition>

/** One relation: "place P sits in entrance E, arriving at A". The mark carries position. */
export interface StorySeat {
  /** Entrance key '<host place>/<entrance id>'. */
  readonly entrance: string
  readonly place: string
  /** An arrival id of `place`; absent means arrivals[0]. */
  readonly arrive?: string
}

export interface PlaceStep {
  readonly place: string
  /** The entrance key this step came in through; null only for the root step. */
  readonly via: string | null
}

/** A coarse picture of a place as it stands, for the veil and for entrance seeds.
 *  3 bytes per cell, row-major. Every model that can be a place (ChamberModel,
 *  RpgOverworld, LabyrinthRuntime) implements `seed()`. */
export interface PlaceSeed { readonly cols: number; readonly rows: number; readonly rgb: Uint8ClampedArray }

export const MAX_PATH_DEPTH = 16

export function entranceKey(place: string, entrance: string): string {
  return `${place}/${entrance}`
}

/** Splits at the first '/'. Null when there is no '/', or either side is empty. */
export function splitEntranceKey(key: string): { place: string; entrance: string } | null {
  const i = key.indexOf('/')
  if (i <= 0 || i === key.length - 1) return null
  return { place: key.slice(0, i), entrance: key.slice(i + 1) }
}

/** The seat whose entrance === key, or null. */
export function seatAt(story: readonly StorySeat[], key: string): StorySeat | null {
  return story.find(s => s.entrance === key) ?? null
}

/** Every seat whose place === place, in story order. A place may be seated
 *  more than once (several parents landing at different arrivals). */
export function seatsOf(story: readonly StorySeat[], place: string): readonly StorySeat[] {
  return story.filter(s => s.place === place)
}

/** Every seat hosted BY `place` — its entrance's host segment is `place`, and
 *  the entrance id is one `place`'s own definition actually declares. */
function childrenOf(story: readonly StorySeat[], places: PlaceCatalog, place: string): readonly StorySeat[] {
  const definition = places.get(place)
  if (!definition) return []
  const out: StorySeat[] = []
  for (const seat of story) {
    const split = splitEntranceKey(seat.entrance)
    if (split && split.place === place && definition.entrances.includes(split.entrance)) out.push(seat)
  }
  return out
}

/** How many places lie transitively below `place` (every descendant reached
 *  by following hosted entrances down, each counted once). */
export function levelsBelow(story: readonly StorySeat[], places: PlaceCatalog, place: string): number {
  const seen = new Set<string>()
  const stack = childrenOf(story, places, place).map(s => s.place)
  while (stack.length) {
    const next = stack.pop() as string
    if (seen.has(next)) continue
    seen.add(next)
    for (const seat of childrenOf(story, places, next)) if (!seen.has(seat.place)) stack.push(seat.place)
  }
  return seen.size
}

const arriveMatches = (candidate: string | undefined, arrive: string | undefined): boolean =>
  arrive !== undefined && candidate === arrive

/** The route DOWN from `from` to `target`, following hosted entrances — never
 *  upward, never across to an unrelated branch. `[0]` is always `{ place:
 *  from, via: null }`, matching every other `PlaceStep[]`'s root-step
 *  convention. When `target` has more than one seat reachable from `from`
 *  (a shared place with several parents), the shallowest route wins; among
 *  routes of equal depth, one whose seat's `arrive` matches the `arrive`
 *  argument wins; ties beyond that keep story order. Null when `target`
 *  cannot be reached going down from `from` (including `from === target`
 *  with either place unknown). */
export function routeTo(story: readonly StorySeat[], places: PlaceCatalog, from: string, target: string, arrive?: string): PlaceStep[] | null {
  if (!places.has(from) || !places.has(target)) return null
  if (from === target) return [{ place: from, via: null }]

  interface Found { readonly path: PlaceStep[]; readonly depth: number; readonly order: number; readonly arrive?: string }
  let best: Found | null = null
  let order = 0
  const visited = new Set<string>([from])
  let frontier: PlaceStep[][] = [[{ place: from, via: null }]]

  while (frontier.length) {
    const next: PlaceStep[][] = []
    for (const path of frontier) {
      const current = path[path.length - 1].place
      for (const seat of childrenOf(story, places, current)) {
        const step: PlaceStep = { place: seat.place, via: seat.entrance }
        if (seat.place === target) {
          const candidate: Found = { path: [...path, step], depth: path.length, order: order++, arrive: seat.arrive }
          if (!best
            || (arriveMatches(candidate.arrive, arrive) && !arriveMatches(best.arrive, arrive))
            || (arriveMatches(candidate.arrive, arrive) === arriveMatches(best.arrive, arrive)
              && (candidate.depth < best.depth || (candidate.depth === best.depth && candidate.order < best.order)))
          ) best = candidate
          continue
        }
        if (visited.has(seat.place)) continue
        visited.add(seat.place)
        next.push([...path, step])
      }
    }
    frontier = next
  }
  return best ? best.path : null
}

/** The single next move from `from` toward `target`: 'here' when you have
 *  arrived, 'up' when `target` does not lie below `from` (so the caller
 *  should leave upward and ask again from the parent), or the entrance to
 *  descend through when it does. */
export function stepToward(story: readonly StorySeat[], places: PlaceCatalog, from: string, target: string): 'here' | 'up' | { entrance: string } {
  if (from === target) return 'here'
  const route = routeTo(story, places, from, target)
  if (!route || route.length < 2) return 'up'
  const via = route[1].via
  return { entrance: via as string }
}

/** Checks the story for five kinds of structural problem, returning one
 *  message per problem found (empty when the story is sound). Never throws.
 *   1. an entrance key that does not name a real placeholder (malformed, an
 *      unknown host, or an id the host does not declare)
 *   2. two seats sharing one entrance (an entrance holds at most one place)
 *   3. a seat naming a place absent from the catalog
 *   4. an `arrive` that is not one of the seated place's declared arrivals
 *   5. a place unreachable from `root`, or reachable only through a cycle
 *      back to itself */
export function validateStory(story: readonly StorySeat[], places: PlaceCatalog, root: string): string[] {
  const problems: string[] = []
  const firstSeatOf = new Map<string, number>()

  story.forEach((seat, index) => {
    const split = splitEntranceKey(seat.entrance)
    const host = split ? places.get(split.place) : undefined
    if (!split || !host || !host.entrances.includes(split.entrance)) {
      problems.push(`seat ${index}: "${seat.entrance}" does not name a real entrance`)
    }

    const first = firstSeatOf.get(seat.entrance)
    if (first === undefined) firstSeatOf.set(seat.entrance, index)
    else problems.push(`seat ${index}: entrance "${seat.entrance}" is already seated by seat ${first}`)

    const place = places.get(seat.place)
    if (!place) problems.push(`seat ${index}: unknown place "${seat.place}"`)
    else if (seat.arrive !== undefined && !place.arrivals.some(a => a.id === seat.arrive)) {
      problems.push(`seat ${index}: "${seat.place}" has no arrival "${seat.arrive}"`)
    }
  })

  if (!places.has(root)) {
    problems.push(`root "${root}" is not a known place`)
    return problems
  }
  const reached = new Set<string>()
  const onStack = new Set<string>()
  const visit = (place: string): void => {
    if (onStack.has(place)) { problems.push(`"${place}" is its own ancestor`); return }
    if (reached.has(place)) return
    reached.add(place)
    onStack.add(place)
    for (const seat of childrenOf(story, places, place)) visit(seat.place)
    onStack.delete(place)
  }
  visit(root)
  for (const place of places.keys()) if (!reached.has(place)) problems.push(`"${place}" is never reached from "${root}"`)

  return problems
}

function isPlaceStepLike(value: unknown): value is { place: string; via: string | null } {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.place === 'string' && (v.via === null || typeof v.via === 'string')
}

export class PlacePath {
  readonly #steps: PlaceStep[]

  private constructor(steps: PlaceStep[]) {
    this.#steps = steps
  }

  static root(place: string): PlacePath {
    return new PlacePath([{ place, via: null }])
  }

  /** Restores the longest valid PREFIX of `raw`: each step in turn must be a
   *  well-formed `{ place, via }` whose `via` is an entrance hosted by the
   *  previous step's place and seated by that exact place, not already in
   *  the path, within `MAX_PATH_DEPTH`, and `canResume(place)`. The first
   *  invalid or unresumable step, and everything after it, is dropped. Falls
   *  back to the bare root when `raw` is not an array or does not open on
   *  `{ place: root, via: null }`. */
  static restore(raw: unknown, story: readonly StorySeat[], places: PlaceCatalog, root: string, canResume: (place: string) => boolean): PlacePath {
    const path = PlacePath.root(root)
    if (!Array.isArray(raw) || raw.length === 0) return path
    const first: unknown = raw[0]
    if (!isPlaceStepLike(first)) return path
    if (first.place !== root || first.via !== null) return path

    for (let i = 1; i < raw.length; i++) {
      const step: unknown = raw[i]
      if (!isPlaceStepLike(step)) break
      const via = step.via
      if (via === null) break
      const split = splitEntranceKey(via)
      if (!split || split.place !== path.here.place) break
      const seat = seatAt(story, via)
      if (!seat || seat.place !== step.place) break
      if (!places.has(step.place)) break
      if (path.includes(step.place)) break
      if (path.depth >= MAX_PATH_DEPTH) break
      if (!canResume(step.place)) break
      path.enter(via, step.place)
    }
    return path
  }

  get steps(): readonly PlaceStep[] { return [...this.#steps] }
  get here(): PlaceStep { return this.#steps[this.#steps.length - 1] }
  get depth(): number { return this.#steps.length }

  includes(place: string): boolean {
    return this.#steps.some(s => s.place === place)
  }

  /** Throws when `place` is already on the path, or the path is already at `MAX_PATH_DEPTH`. */
  enter(via: string, place: string): void {
    if (this.includes(place)) throw new Error(`place.ts: "${place}" is already in the path`)
    if (this.#steps.length >= MAX_PATH_DEPTH) throw new Error(`place.ts: path exceeds ${MAX_PATH_DEPTH} levels`)
    this.#steps.push({ place, via })
  }

  /** Pops back to `index` (inclusive), returning the removed steps in path order. */
  leaveTo(index: number): PlaceStep[] {
    if (index < 0 || index >= this.#steps.length) throw new Error(`place.ts: leaveTo(${index}) out of range`)
    const removed = this.#steps.slice(index + 1)
    this.#steps.length = index + 1
    return removed
  }

  toJSON(): PlaceStep[] {
    return [...this.#steps]
  }
}
