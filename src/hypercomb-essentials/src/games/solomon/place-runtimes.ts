// THE EXTENSION-POINT LAYER. One `PlaceRuntime` per kind of place (island,
// labyrinth, chamber) behind one `RuntimeShell` the session builds once. The
// shell (`labyrinth-overlay.ts`) never switches on place kind — it only ever
// calls through `PlaceRuntime`'s own contract — and a `PlaceRuntime` never
// reaches back into the shell's own DOM or fields, only through `RuntimeShell`.
//
// `LabyrinthRuntime` is where every combat behaviour lands (M5): its own
// `interact()`/`key()` route strike/cast/cycle-weapon/cycle-spell at the
// room's own `Engine`, and its own one-shot flash-diff fields turn the
// Hush's flash counters into `shell.sound()` calls — the ONE dispatch point
// (M8) — exactly like the door tones and `shell.recordRelic()` already fire
// from here today.

import { BRICK, CRACKED, SIM_DT, SKILL_NAMES, WALL, type CombatSkillId, type Engine } from './engine.js'
import { ROOMS, type LabyrinthJourney, type RoomDef } from './labyrinth.js'
import { LabyrinthRoomView, doorHue } from './labyrinth-view.js'
import type { SolomonTileSurface, LoadedTileRoom } from './tile-surface.js'
import { RpgOverworldView, SEVENFOLD_VALLEY, type WorldDefinition, type WorldGainRequest } from './rpg-overworld.js'
import type { MoveInput, ChamberDefinition } from './chamber.js'
import { ChamberView, type ChamberGainRequest, type ChamberInstruments, type ChamberSound } from './chamber-view.js'
import type { StorySeat, PlaceSeed } from './place.js'
import { LABYRINTH_PLACE, type SeatLabel } from './places.js'
import { PlaceVeil, type VeilDirection, type VeilLeg } from './place-veil.js'
import type { GainRequest } from './gain-screen.js'
// The one reveal/progress registry (M2): a stele/chest's title, words and art
// always come from content by id here, never a second, hand-written table
// (M2/M22/M23's rule) — `attainmentById` for the labyrinth's own `skill:<id>`
// rows, `storyRefs` to resolve a chamber's `<chamber>/chest:<id>` ref back to
// the row whose `when: { done: ref }` names it (the same grammar `ADVENTURE.md`
// and this file's own `done()` refs, below, both use).
import { ATTAINMENTS, attainmentById, type AttainmentDef } from './attainments.js'
import { storyHolds, storyRefs, type StoryFacts } from './story-when.js'

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Every arrival a `PlaceRuntime` can be shown with: seated down from a
 *  parent place, surfaced back up from a child, or resumed from a save. */
export type RuntimeArrival =
  | { readonly from: 'above'; readonly seat: StorySeat; readonly arrive: string }
  | { readonly from: 'below'; readonly via: string; readonly exit?: string }
  | { readonly from: 'save' }

/** The renderer contract for one kind of place. The shell never switches on place kind. */
export interface PlaceRuntime {
  readonly place: string
  readonly host: HTMLElement
  prepare(seat: StorySeat, cancelled: () => boolean): true | string | Promise<true | string>
  canResume(): boolean
  show(arrival: RuntimeArrival): void
  hide(): void
  update(dt: number, input: MoveInput): void
  interact(): void
  cast(): void
  /** Extra keys (labyrinth: jump/fire/retry, AND NOW strike/cast/cycle-weapon/cycle-spell); true when used. */
  key(key: string, down: boolean, repeat: boolean): boolean
  readonly isDialogOpen: boolean
  closeDialog(): void
  exportFacts(): unknown
  restoreFacts(raw: unknown): void
  leaveLeg(direction: VeilDirection, at?: { readonly x: number; readonly y: number }): VeilLeg | null
  arriveLeg(direction: VeilDirection): VeilLeg | null
  /** (2) A2.6 — a coarse picture of the place as it stands, for the veil and for entrance seeds. */
  seed(): PlaceSeed
  /** (2) A2.6 — where a portal sits on this runtime's host, as fractions 0..1 of the host box; null when unknown. */
  anchor(feature: string): { readonly x: number; readonly y: number } | null
  /** Where the story's next step happens, for a place that can point at it. */
  guide?(target: string | null): void
  dispose(): void
}

/** Built once per session in #mountSession as an object of arrow functions. */
export interface RuntimeShell {
  journey(): LabyrinthJourney
  release(): void
  save(): void
  enter(from: string, entrance: string, arrive?: string): void
  leave(from: string, exit?: string): void
  surface(from: string): void
  seat(from: string, entrance: string): SeatLabel | null
  upName(place: string): string
  surfaceName(place: string): string
  instruments(place: string): ChamberInstruments
  learn(id: string, text: string): void
  knows(id: string): boolean
  message(text: string): void
  /** (M5) — the ONE sound dispatch point, extended for combat. */
  sound(kind: ChamberSound | 'door-in' | 'door-out' | 'door-locked'
    | 'hush' | 'duel' | 'strike' | 'stagger' | 'parry' | 'ward' | 'ember' | 'bat' | 'clang' | 'catch'): void
  /** (2) A5.4 — the ONE reveal dialog; replaces both (1)'s no-such-thing and (3)'s deleted #openGotIt. */
  gain(request: GainRequest): void
  /** (2) A2.6 — the seated place's seed (live runtime, else built from dormant facts, else authored). */
  seatSeed(from: string, entrance: string): PlaceSeed | null
  /** (2) A9 — records `${from}/${entrance}` in the found set. */
  found(from: string, entrance: string): void
  /** (2) A6.4 — replaces openJournal. */
  openItems(): void
  recordRelic(): void
  /** What the traveller has held, known and done — the one fact source every
   *  story condition is checked against. */
  facts(): StoryFacts
}

// ── the ONE reveal/progress bridge every runtime shares ────────────────────
//
// A runtime never invents a title, subtitle, or icon for a reveal (M2/M22/
// M23's "text always comes from content by id"). It hands the shell a
// complete `GainRequest`, built here from the one `ATTAINMENTS` registry, so
// `RuntimeShell.gain()` (and the `GainScreen` behind it) stays a pure
// presenter with no per-substrate lookup of its own.

/** Eyebrow text per `AttainmentKind` — every kind but the labyrinth's own
 *  skill rows (M2's fixed 'A COMBAT SKILL', spelled out at its one call site
 *  below, §3.8.2's table) is a best-effort, plain-English label: the exact
 *  copy for these lives in (2) A5.4's own text, not reproduced verbatim in
 *  this contract, so a later pass may retune the words without touching the
 *  mechanism. */
function eyebrowFor(def: AttainmentDef): string {
  switch (def.kind) {
    case 'weapon': case 'spell': return 'A COMBAT SKILL'
    case 'piece': return 'A SIGIL PIECE'
    case 'item': return 'AN ITEM'
    case 'knowledge': return 'A DISCOVERY'
    case 'place': return 'A PLACE FOUND'
    case 'task': return 'A TASK COMPLETE'
    case 'contribution': return 'A CONTRIBUTION'
    case 'ability': return 'AN ABILITY'
    default: return ''
  }
}
function gainRequestFromDef(def: AttainmentDef, fresh: boolean): GainRequest {
  return {
    id: def.id, eyebrow: eyebrowFor(def), title: def.title, words: def.words, art: def.art, fresh,
    ...(def.slot ? { slot: def.slot } : {}),
  }
}
/** Resolves a `<place>/chest:<id>` / `<place>/artifact:<id>` ref (the
 *  `done()` grammar §3.2/`ADVENTURE.md` share) back to the ATTAINMENTS row
 *  whose `when: { done: ref }` names it — never `attainmentById(ref)`, since
 *  a row's own id (`item:hollow-grove-pool-chest`) and its `done` ref
 *  (`hollow-grove/chest:pool-chest`) are deliberately different strings
 *  (M2's naming-vs-fact-key split, §1's attainments.ts header). */
function attainmentForRef(ref: string): AttainmentDef | null {
  return ATTAINMENTS.find(def => storyRefs(def.when).done.includes(ref)) ?? null
}
function chamberGainRequest(request: ChamberGainRequest): GainRequest {
  const def = attainmentForRef(request.ref)
  if (!def) return { id: request.ref, eyebrow: '', title: request.ref, words: '', art: { kind: 'glyph', glyph: '?' }, fresh: request.fresh }
  return gainRequestFromDef(def, request.fresh)
}
/** The island's own reveal hook is not called by anything in `rpg-overworld.ts`
 *  today (verified: no `hooks.gain(` call site exists yet — its own doc calls
 *  it "a forward-looking notification only"), but is wired properly here so a
 *  future island reveal (a shrine piece, say) needs no change to this file. */
function worldGainRequest(request: WorldGainRequest): GainRequest {
  const def = attainmentById(request.id)
  return {
    id: request.id,
    eyebrow: def ? eyebrowFor(def) : request.subtitle,
    title: request.title,
    words: request.words,
    art: def?.art ?? { kind: 'glyph', glyph: '✦' },
    ...(request.items ? { items: request.items.map((item, index) => ({ id: `${request.id}:${index}`, name: item.name, kind: item.kind })) } : {}),
    fresh: request.fresh,
    ...(def?.slot ? { slot: def.slot } : {}),
  }
}

// ── island ──────────────────────────────────────────────────────────────

/** A world walked on foot — the island, or any world inside it. */
export class IslandRuntime implements PlaceRuntime {
  readonly place: string
  readonly host: HTMLElement
  readonly view: RpgOverworldView
  readonly #shell: RuntimeShell

  constructor(host: HTMLElement, shell: RuntimeShell, world: WorldDefinition = SEVENFOLD_VALLEY) {
    this.place = world.id
    this.host = host
    this.#shell = shell
    this.view = new RpgOverworldView({
      has: requirement => shell.journey().has(requirement),
      grantRelic: relic => shell.journey().grantRelic(relic),
      seat: id => shell.seat(this.place, id) !== null,
      onEntrance: id => shell.enter(this.place, id),
      onItems: () => shell.openItems(),
      onMessage: message => shell.message(message),
      gain: request => shell.gain(worldGainRequest(request)),
      found: id => shell.found(this.place, id),
      seatSeed: id => shell.seatSeed(this.place, id),
      holds: when => storyHolds(when, shell.facts()),
    }, world)
    this.view.mount(host)
  }

  prepare(_seat: StorySeat, _cancelled: () => boolean): true { return true }
  canResume(): boolean { return true }
  /** Coming down into a world, you stand where it starts; coming back up,
   *  you stand where you went in. */
  show(arrival: RuntimeArrival): void {
    if (arrival.from === 'above') this.view.model.enterAtStart()
    this.host.hidden = false
  }
  hide(): void { this.host.hidden = true }
  update(dt: number, input: MoveInput): void { this.view.update(dt, input) }
  interact(): void { this.view.interact() }
  cast(): void { this.view.cast() }
  key(_key: string, _down: boolean, _repeat: boolean): boolean { return false }
  get isDialogOpen(): boolean { return this.view.isDialogOpen || this.view.isSpeaking }
  closeDialog(): void { if (this.view.isDialogOpen) this.view.closeDialog(); else this.view.dismiss() }
  exportFacts(): unknown { return this.view.exportState() }
  restoreFacts(raw: unknown): void { this.view.restoreState(raw) }
  leaveLeg(direction: VeilDirection, at?: { readonly x: number; readonly y: number }): VeilLeg | null {
    return this.view.leaveLeg(at ?? this.view.model.player, direction)
  }
  arriveLeg(direction: VeilDirection): VeilLeg | null {
    return this.view.arriveLeg(this.view.model.player, direction)
  }
  seed(): PlaceSeed { return this.view.model.seed() }
  guide(target: string | null): void { this.view.setGuide(target) }
  anchor(_feature: string): { readonly x: number; readonly y: number } | null {
    // The island scrolls continuously beneath a fixed viewport, and
    // `RpgOverworldView` keeps its camera and marker geometry private (unlike
    // a chamber's or labyrinth room's static board) — there is no stable
    // host-fraction to report without new surface on that file, which is
    // island role, Phase 1, already built, and out of this file's scope.
    // Honestly null rather than guessed.
    return null
  }
  dispose(): void { this.view.dispose() }
}

// ── chambers (caverns, the interior chain, the Hollow Grove) ────────────

export class ChamberRuntime implements PlaceRuntime {
  readonly place: string
  readonly host: HTMLElement
  readonly view: ChamberView
  readonly #shell: RuntimeShell

  constructor(host: HTMLElement, definition: ChamberDefinition, shell: RuntimeShell) {
    this.place = definition.id
    this.host = host
    this.#shell = shell
    this.view = new ChamberView(definition, {
      has: requirement => shell.journey().has(requirement),
      knows: id => shell.knows(id),
      learn: (id, text) => shell.learn(id, text),
      gain: request => shell.gain(chamberGainRequest(request)),
      onNavigate: (to, id) => {
        if (to === 'down') shell.enter(this.place, id)
        else if (to === 'up') shell.leave(this.place, id)
        else shell.surface(this.place)
      },
      sound: kind => shell.sound(kind),
      seatSeed: entrance => shell.seatSeed(this.place, entrance),
      found: entrance => shell.found(this.place, entrance),
    })
    this.view.mount(host)
  }

  prepare(_seat: StorySeat, _cancelled: () => boolean): true { return true }
  canResume(): boolean { return true }
  show(arrival: RuntimeArrival): void { this.host.hidden = false; this.view.show(arrival) }
  hide(): void { this.view.hide() }
  update(dt: number, input: MoveInput): void { this.view.update(dt, input) }
  interact(): void { this.view.interact() }
  cast(): void { this.view.cast() }
  key(_key: string, _down: boolean, _repeat: boolean): boolean { return false }
  get isDialogOpen(): boolean { return this.view.isDialogOpen }
  closeDialog(): void { this.view.closeDialog() }
  exportFacts(): unknown { return this.view.exportState() }
  restoreFacts(raw: unknown): void { this.view.restoreState(raw) }
  leaveLeg(direction: VeilDirection, at?: { readonly x: number; readonly y: number }): VeilLeg | null { return this.view.leaveLeg(direction, at) }
  arriveLeg(direction: VeilDirection): VeilLeg | null { return this.view.arriveLeg(direction) }
  seed(): PlaceSeed { return this.view.seed() }
  anchor(feature: string): { readonly x: number; readonly y: number } | null { return this.view.anchor(feature) }
  dispose(): void { this.view.dispose() }
}

// ── the labyrinth — every combat behaviour lands here (M5) ──────────────

/** The room-as-the-veil-sees-it colours, duplicated on purpose: `labyrinth-
 *  view.ts` keeps its own version of this palette private, exactly the
 *  reasoning §3.6 gives for `seed()` below. */
type Rgb = readonly [number, number, number]
const hexRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const AIR = hexRgb('#263b5c'), STONE = hexRgb('#c9d3e6'), CLAY = hexRgb('#e9b56c'), GOLD = hexRgb('#ffe599')
const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

export class LabyrinthRuntime implements PlaceRuntime {
  readonly place = 'labyrinth'
  readonly host: HTMLElement
  readonly view: LabyrinthRoomView
  readonly #shell: RuntimeShell
  readonly #journey: LabyrinthJourney
  readonly #surface: () => SolomonTileSurface
  readonly #loaded: Map<string, LoadedTileRoom>
  /** Door-to-door travel never leaves the labyrinth place, so the shell's own
   *  outer (story-level) veil never plays for it — this runtime keeps a
   *  second, internal `PlaceVeil` purely for that within-place warp, exactly
   *  as today's single shell reused one `#veil` field for both kinds of
   *  transition. `leaveLeg`/`arriveLeg` below are a SEPARATE thing: the
   *  outer veil the shell drives when crossing a story seat (island ↔
   *  labyrinth), never touched here. */
  readonly #veil: PlaceVeil
  #acc = 0
  #time = 0
  #jumpHeld = false
  #lockedSaid = ''
  #lastRelicId = ''
  #prevHush = 0
  #prevDuel = 0
  #prevStrike = 0
  #prevStagger = 0
  #prevParry = 0
  #prevWard = 0
  #prevEmber = 0
  #prevBat = 0
  #prevClang = 0
  #prevCatch = 0

  constructor(host: HTMLElement, shell: RuntimeShell, surface: () => SolomonTileSurface, loaded: Map<string, LoadedTileRoom>) {
    this.host = host
    this.#shell = shell
    this.#journey = shell.journey()
    this.#surface = surface
    this.#loaded = loaded
    this.view = new LabyrinthRoomView(host, this.#journey, id => this.#door(id))
    this.#veil = new PlaceVeil(host)
  }

  async prepare(seat: StorySeat, cancelled: () => boolean): Promise<true | string> {
    const labyrinthId = seat.arrive ?? LABYRINTH_PLACE.arrivals[0]?.id
    if (!labyrinthId) return 'This shrine leads nowhere yet.'
    const rooms = ROOMS.filter(room => room.labyrinthId === labyrinthId)
    if (!rooms.length) return 'This shrine’s chambers are still missing.'
    const ok = await this.#ensureRooms(rooms, cancelled)
    return ok ? true : 'Opening the shrine’s chambers was interrupted.'
  }

  /** Hydrates every room of every labyrinth a restored save's journey facts
   *  touch (its visited rooms, plus whichever room was active) before
   *  `restoreFacts()` runs — mirroring today's restore flow one-for-one. */
  hydrateFor(journeyFacts: unknown, cancelled: () => boolean): true | Promise<boolean> {
    const state = record(journeyFacts)
    const rawIds = state && Array.isArray(state['roomIds']) ? state['roomIds'] : []
    const ids = new Set(rawIds.filter((id): id is string => typeof id === 'string'))
    const activeId = state && typeof state['activeRoomId'] === 'string' ? state['activeRoomId'] : null
    const labyrinths = new Set(ROOMS.filter(room => ids.has(room.id) || room.id === activeId).map(room => room.labyrinthId))
    const rooms = ROOMS.filter(room => labyrinths.has(room.labyrinthId))
    if (rooms.every(room => this.#loaded.has(room.id))) {
      for (const room of rooms) this.#journey.replaceRoom(this.#loaded.get(room.id)!.room)
      return true
    }
    return this.#ensureRooms(rooms, cancelled)
  }

  async #ensureRooms(rooms: readonly RoomDef[], cancelled: () => boolean): Promise<boolean> {
    const tiles = this.#surface()
    for (const definition of rooms) {
      if (cancelled()) return false
      if (this.#loaded.has(definition.id)) continue
      const loadedRoom = await tiles.ensureRoom(definition)
      if (cancelled()) return false
      this.#loaded.set(definition.id, loadedRoom)
    }
    for (const definition of rooms) {
      const loaded = this.#loaded.get(definition.id)
      if (loaded) this.#journey.replaceRoom(loaded.room)
    }
    return true
  }

  canResume(): boolean { return this.#journey.room !== null }

  show(arrival: RuntimeArrival): void {
    this.host.hidden = false
    if (arrival.from === 'above') {
      const labyrinthId = arrival.arrive ?? LABYRINTH_PLACE.arrivals[0]?.id
      if (labyrinthId) this.#journey.enterLabyrinth(labyrinthId)
    }
    const room = this.#journey.room
    const loaded = room ? this.#loaded.get(room.id) : null
    if (loaded) this.view.show(loaded)
    this.#acc = 0
    if (this.#journey.engine) this.#syncSoundDiff(this.#journey.engine)
  }

  hide(): void { this.host.hidden = true }

  update(dt: number, input: MoveInput): void {
    const engine = this.#journey.engine
    if (engine) {
      engine.input.left = input.left
      engine.input.right = input.right
      engine.input.down = input.down
      engine.input.jump = input.up || this.#jumpHeld
    }
    this.#acc += dt
    while (this.#acc >= SIM_DT) { this.#journey.update(SIM_DT); this.#acc -= SIM_DT }
    this.#recordRelic()
    this.#passDoor()
    if (engine) this.#diffSounds(engine)
    this.#time += dt
    this.view.render(this.#time)
  }

  /** `interact()` (was, in (1), simply `#door()`) — engine.interact() first
   *  (a fresh read/take becomes a GainRequest through the shell's ONE
   *  GainScreen; "again" prints the same attainment's words to the status
   *  line); nothing to read/take there falls through to the door, byte-
   *  identical to (1)'s own spec. */
  interact(): void {
    const got = this.#journey.engine?.interact()
    if (got) {
      if (got.kind === 'again') { this.#shell.message(this.#skillWords(got.id)); return }
      this.#shell.gain(this.#gainRequestFor(got))
      return
    }
    this.#door()
  }

  cast(): void { this.#journey.engine?.cast() }

  key(key: string, down: boolean, repeat: boolean): boolean {
    if (key === ' ') { this.#jumpHeld = down; return true }
    const engine = this.#journey.engine
    if (!engine || !down || repeat) return false
    if (key === 'x' || key === 'k') { engine.fireball(); return true }
    if (key === 'r') { this.#journey.retryCurrent(); return true }
    if (key === 'c' || key === 'l') { engine.strike(); return true }
    if (key === 'v' || key === ';') {
      const r = engine.castSpell()
      if (r === 'no-sand') this.#shell.message(`Not enough sand for the ${engine.spell === 'ember' ? 'Ember Sigil' : 'Hourglass Hold'}.`)
      return true
    }
    if (key === 'n') { engine.nextWeapon(); return true }
    if (key === 'b') { engine.nextSpell(); return true }
    return false
  }

  /** No labyrinth-room dialog exists (rune-choice/alcove scenes are a
   *  chamber-only concept) — the room never swallows a key of its own. */
  get isDialogOpen(): boolean { return false }
  closeDialog(): void { /* no dialog surface of its own */ }

  exportFacts(): unknown { return this.#journey.exportState() }
  restoreFacts(raw: unknown): void { this.#journey.restoreState(raw) }

  leaveLeg(_direction: VeilDirection, _at?: { readonly x: number; readonly y: number }): VeilLeg | null {
    return this.view.leaveLeg(_direction)
  }
  arriveLeg(direction: VeilDirection): VeilLeg | null {
    const room = this.#journey.room
    const loaded = room ? this.#loaded.get(room.id) : null
    return loaded ? this.view.arriveLeg(loaded, direction) : null
  }

  /** The current room's palette (WALL/BRICK/CRACKED/air/doors-by-hue/
   *  uncollected-relics-gold), reused from `labyrinth-view.ts`'s own private
   *  helpers, duplicated on purpose since that file's helpers stay private. */
  seed(): PlaceSeed {
    const room = this.#journey.room
    if (!room) return { cols: 1, rows: 1, rgb: new Uint8ClampedArray(3) }
    const { cols, rows } = room.level
    const grid = this.#journey.engine?.grid ?? room.level.tiles
    const rgb = new Uint8ClampedArray(cols * rows * 3)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col, code = grid[index] ?? 0
        const door = room.doors.find(d => d.col === col && d.row === row)
        const relic = room.relics.find(r => r.col === col && r.row === row && !this.#journey.collected(r.id))
        const color = door ? hslToRgb(doorHue(door.targetRoomId), 0.6, 0.5)
          : relic ? GOLD
          : code === WALL ? STONE
          : code === BRICK || code === CRACKED ? CLAY
          : AIR
        const i = index * 3
        rgb[i] = color[0]; rgb[i + 1] = color[1]; rgb[i + 2] = color[2]
      }
    }
    return { cols, rows, rgb }
  }

  /** Resolved through the room's own door geometry, matching
   *  `ChamberView.anchor()`'s own model-fraction approach rather than a DOM
   *  measurement. */
  anchor(feature: string): { readonly x: number; readonly y: number } | null {
    const room = this.#journey.room
    if (!room) return null
    const door = room.doors.find(d => d.id === feature)
    if (!door) return null
    return { x: (door.col + 0.5) / room.level.cols, y: (door.row + 0.5) / room.level.rows }
  }

  dispose(): void { this.view.dispose(); this.#veil.cancel() }

  // -- internals ----------------------------------------------------------

  /** TOUCH TO PASS. Standing in an open door takes you through it — except
   *  the door just arrived by, until stepping off it and back on (the
   *  journey's own arrival guard). A door that cannot open yet says what it
   *  needs, once per approach, and stays a door. E still works for anyone
   *  who reaches for it (see `interact()`'s fallthrough). */
  #passDoor(): void {
    const door = this.#journey.nearDoor()
    if (!door) { this.#lockedSaid = ''; return }
    if (door.id === this.#journey.arrivalDoor) return
    if (!this.#journey.canPass(door)) {
      if (this.#lockedSaid !== door.id) {
        this.#lockedSaid = door.id
        this.#shell.message(this.#journey.lockMessage(door))
        this.#shell.sound('door-locked')
      }
      return
    }
    this.#door(door.id)
  }

  #door(id?: string): void {
    const oldDepth = this.#journey.room?.depth ?? 0
    const result = this.#journey.useDoor(id)
    this.#shell.message(result.message)
    if (result.kind === 'locked') { this.#shell.sound('door-locked'); return }
    if (result.kind !== 'travelled' || !this.#journey.room) return
    const loaded = this.#loaded.get(this.#journey.room.id)
    if (!loaded) { this.#shell.message('This passage has no loaded destination.'); return }
    const delta = this.#journey.room.depth - oldDepth
    this.view.warp(this.#veil, loaded, delta < 0 ? 'out' : delta === 0 ? 'across' : 'in')
    this.#acc = 0
    if (this.#journey.engine) this.#syncSoundDiff(this.#journey.engine)
    this.#shell.sound(delta < 0 ? 'door-out' : 'door-in')
  }

  #recordRelic(): void {
    const relic = this.#journey.lastRelic
    if (!relic || relic.id === this.#lastRelicId) return
    this.#lastRelicId = relic.id
    this.#shell.recordRelic()
  }

  /** One bump of any of the ten combat flash counters (M5) fires its sound
   *  exactly once, matching the `#prevXFlash`/`e.xFlash > this.#prevXFlash`
   *  pattern already established for every other flash counter — verified
   *  to exist only in the unrelated classic `overlay.ts` today, so this
   *  runtime keeps its own copy rather than a shared one (M8: one dispatch
   *  point, `RuntimeShell.sound()`, but the diffing fields live here). */
  #diffSounds(engine: Engine): void {
    if (engine.hushFlash > this.#prevHush) this.#shell.sound('hush')
    if (engine.duelFlash > this.#prevDuel) this.#shell.sound('duel')
    if (engine.strikeFlash > this.#prevStrike) this.#shell.sound('strike')
    if (engine.staggerFlash > this.#prevStagger) this.#shell.sound('stagger')
    if (engine.parryFlash > this.#prevParry) this.#shell.sound('parry')
    if (engine.wardFlash > this.#prevWard) this.#shell.sound('ward')
    if (engine.emberFlash > this.#prevEmber) this.#shell.sound('ember')
    if (engine.batFlash > this.#prevBat) this.#shell.sound('bat')
    if (engine.clangFlash > this.#prevClang) this.#shell.sound('clang')
    if (engine.catchFlash > this.#prevCatch) this.#shell.sound('catch')
    this.#syncSoundDiff(engine)
  }

  /** Brings the diff fields up to a freshly-shown engine's own current flash
   *  counts, without playing anything — used on `show()`/`#door()` so a new
   *  room's already-nonzero counters (carried over from its own last visit)
   *  never retrigger a sound the instant it appears. */
  #syncSoundDiff(engine: Engine): void {
    this.#prevHush = engine.hushFlash
    this.#prevDuel = engine.duelFlash
    this.#prevStrike = engine.strikeFlash
    this.#prevStagger = engine.staggerFlash
    this.#prevParry = engine.parryFlash
    this.#prevWard = engine.wardFlash
    this.#prevEmber = engine.emberFlash
    this.#prevBat = engine.batFlash
    this.#prevClang = engine.clangFlash
    this.#prevCatch = engine.catchFlash
  }

  #gainRequestFor(got: { readonly kind: 'read' | 'taken' | 'again'; readonly id: CombatSkillId }): GainRequest {
    const def = attainmentById(`skill:${got.id}`)
    return {
      id: `skill:${got.id}`,
      eyebrow: 'A COMBAT SKILL',
      title: SKILL_NAMES[got.id],
      words: def?.words ?? SKILL_NAMES[got.id],
      art: { kind: 'skill', skill: got.id },
      fresh: true,
    }
  }
  #skillWords(id: CombatSkillId): string {
    return attainmentById(`skill:${id}`)?.words ?? SKILL_NAMES[id]
  }
}
