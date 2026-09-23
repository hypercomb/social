// THE ADVENTURE SHELL. One dispatcher for every navigation, dialog and key —
// push-to-enter, beside-prompts, E-toggle, and the Hush's own input surface
// all resolve through it with no special-casing by place kind (§0.3's must-
// avoid, "no switching on place kind throughout the shell", holds for combat
// too). The `#mode`/`#door()`/`#worldHost`/`#roomHost`/`#dungeonHost` switch
// this file used to carry is gone for good: a `PlacePath` (place.ts) is the
// one stack of where the traveller has descended, and a `PlaceRuntime` per
// place kind (place-runtimes.ts) is the one contract every place — island,
// chamber, labyrinth — is driven through. Every combat behaviour (Stand-
// gating, the Hush, weapons/spells, barriers) already routes through those
// same runtime contracts (M5); this file only ever calls `PlaceRuntime`'s
// own methods and never reaches into a labyrinth-specific concept directly.

import { LabyrinthJourney } from './labyrinth.js'
import type { CombatSkillId, Engine } from './engine.js'
import { LABYRINTH_ROOM_CSS } from './labyrinth-view.js'
import { createSolomonTileSurface, type SolomonTileSurface, type LoadedTileRoom } from './tile-surface.js'
import { PlaceVeil, PLACE_VEIL_CSS, type VeilLeg } from './place-veil.js'
import { SolomonOverlay } from './overlay.js'
import { GameAudio } from '../audio.js'
import { SaveSlotStore } from './save-slots.js'
import { PlacePath, entranceKey, seatAt, seatsOf, splitEntranceKey, MAX_PATH_DEPTH } from './place.js'
import { ROOT_PLACE, STORY, STORY_BOARDS, type GuideStep } from './story.js'
import { PLACES, LABYRINTH_PLACE, placeName, seatLabel, crumbLabel, floorLabel, groupOfPlace } from './places.js'
import { CHAMBERS } from './chamber-places.js'
import { WORLDS } from './worlds.js'
import { chamberInstruments, type ChamberInstruments, type ChamberSound } from './chamber-view.js'
import { IslandRuntime, ChamberRuntime, LabyrinthRuntime, type PlaceRuntime, type RuntimeShell } from './place-runtimes.js'
import { readAdventureSave, writeAdventureSave, type CarriedEntry } from './adventure-save.js'
import { attainmentById, guideStep, heldAttainments, itemsBoards, useAttainment, type UseContext } from './attainments.js'
import { DEFAULT_MENU, GAME_MENU_CSS, GameMenu, type MenuOption } from './game-menu.js'
import type { StoryFacts } from './story-when.js'
import { GainScreen, GAIN_CSS, type GainRequest } from './gain-screen.js'
import { ItemsTable, ITEMS_CSS, type ItemsTab } from './items-table.js'

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const arrayHas = (value: unknown, id: string): boolean => Array.isArray(value) && value.includes(id)

const KEYS = new Set([
  'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', ' ',
  'z', 'j', 'x', 'k', 'r', 'c', 'v', 'n', 'b', 'e', 'enter', 'm', 'i', 'escape',
])
const element = (tag: string, className = '', text = ''): HTMLElement => {
  const result = document.createElement(tag)
  result.className = className
  result.textContent = text
  return result
}

/** Every place ref a chamber's own facts are checked under (§3.2's `done()`
 *  grammar), keyed by the ref's own word to the `ChamberSnapshot` array it
 *  reads. */
const CHAMBER_FACT_KEY: Readonly<Record<string, string>> = {
  tablet: 'read', gate: 'attuned', chest: 'opened', door: 'unlocked',
  shutter: 'latched', lever: 'pulled', lamp: 'lit', alcove: 'memories',
}

/** One navigation request. `#request` is the ONE gateway every place-path
 *  move goes through — a header button, a crumb, a keyboard Escape/M, or a
 *  `RuntimeShell` hook a runtime calls on the traveller's behalf. */
type Intent =
  | { readonly kind: 'enter'; readonly from: string; readonly entrance: string; readonly arrive?: string }
  | { readonly kind: 'leave'; readonly from?: string; readonly exit?: string }
  | { readonly kind: 'home' }
  | { readonly kind: 'crumb'; readonly index: number }
  | { readonly kind: 'surface'; readonly from: string }
  | { readonly kind: 'design' }

/** A ticket for one in-flight, cancellable piece of work — a restore, or a
 *  place's own async `prepare()`. While one is open every navigation request
 *  but `home` is refused outright, except it is remembered on `intent` and
 *  replayed the instant the ticket closes (mirroring how a pending continue
 *  used to remember "open World" / "open the designer" once it landed). */
interface Busy { readonly kind: 'restore' | 'enter'; cancelled: boolean; intent: Intent | null }

/** Adventure shell. The island, every chamber and the labyrinth share one
 *  knowledge ledger and one save, with a separate `PlaceRuntime` simulating
 *  each. */
export class SolomonLabyrinthOverlay {
  journey = new LabyrinthJourney()
  #path = PlacePath.root(ROOT_PLACE)
  readonly #runtimes = new Map<string, PlaceRuntime>()
  #dormant = new Map<string, unknown>()
  #carried: CarriedEntry[] = []
  #extra: (readonly [string, unknown])[] = []
  #busy: Busy | null = null
  #restoreFailed = false
  readonly #loaded = new Map<string, LoadedTileRoom>()
  readonly #knowledge = new Map<string, string>()
  #revealed = new Set<string>()
  #found = new Set<string>()
  #crumbs: HTMLElement | null = null
  #card: HTMLElement | null = null
  #veil: PlaceVeil | null = null
  #gain: GainScreen | null = null
  #items: ItemsTable | null = null

  readonly #shell: RuntimeShell = this.#buildShell()
  readonly #audio = new GameAudio()
  readonly #input = { up: false, down: false, left: false, right: false }
  #surface: SolomonTileSurface | null = null
  #root: HTMLElement | null = null
  #content: HTMLElement | null = null
  #messageEl: HTMLElement | null = null
  #inventory: HTMLElement | null = null
  #designer: SolomonOverlay | null = null
  #slots: SaveSlotStore<unknown> | null = null
  #slotPanel: HTMLElement | null = null
  #saveStatus: HTMLElement | null = null
  #lastSaved = ''
  #lastRelic = ''
  #inventoryKey = ''
  #dirty = false
  #raf = 0
  #lastTs = 0
  #time = 0
  #saveAt = 0
  #oldFocus: HTMLElement | null = null
  #menu: GameMenu | null = null
  #menuAsked = false
  #guide: GuideStep | null = null
  #guideAt = 0
  /** The open panel was entered from the menu, so backing out returns there. */
  #fromMenu = false
  #backOff: (() => void) | null = null

  readonly #onClose: () => void
  constructor(onClose: () => void) { this.#onClose = onClose }

  get engine(): Engine | null { return this.journey.engine }
  isMounted(): boolean { return !!this.#root }

  mount(): void {
    if (this.#root) return
    let storage: Pick<Storage, 'getItem' | 'setItem'>
    try { storage = window.localStorage } catch {
      storage = { getItem: () => { throw new Error('Browser storage is unavailable.') }, setItem: () => { throw new Error('Browser storage is unavailable.') } }
    }
    this.#slots = new SaveSlotStore(storage)
    this.#oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.#oldFocus?.blur()
    const root = element('div', 'sol-adventure')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', "Solomon's Key adventure")
    root.setAttribute('aria-modal', 'true')
    root.tabIndex = -1
    const style = element('style')
    style.textContent = ADVENTURE_CSS + LABYRINTH_ROOM_CSS + PLACE_VEIL_CSS + GAIN_CSS + ITEMS_CSS + GAME_MENU_CSS
    root.append(style)
    // NOTHING OUTSIDE THE LAND (Jaime, 2026-09-13): the place fills the window;
    // everything else lives in the game's own menu, opened from the corner.
    this.#content = element('main', 'sol-adventure-content')
    this.#veil = new PlaceVeil(this.#content)
    this.#card = element('div', 'sol-card')
    this.#content.append(this.#card)
    this.#messageEl = element('div', 'sol-adventure-message', 'Explore the world, and see who you can help.')
    this.#messageEl.setAttribute('role', 'status')
    this.#messageEl.setAttribute('aria-live', 'polite')
    const menuOpen = this.#button('', () => this.#openMenu())
    menuOpen.className = 'sol-menu-open'
    menuOpen.title = 'Menu (Esc)'
    menuOpen.setAttribute('aria-label', 'Menu')
    this.#inventory = element('span', 'sol-adventure-inventory')
    this.#saveStatus = element('span', 'sol-save-status')
    this.#saveStatus.setAttribute('role', 'status')
    this.#crumbs = element('nav', 'sol-crumbs')
    this.#crumbs.setAttribute('aria-label', 'Path travelled')
    root.append(this.#content, this.#messageEl, this.#touchControls(), menuOpen)
    this.#menu = new GameMenu(root, {
      choose: option => this.#chooseMenu(option),
      detail: option => this.#menuDetail(option),
      back: () => this.#back(),
    }, [this.#inventory, this.#saveStatus, this.#crumbs])
    document.body.append(root)
    this.#root = root
    this.#backOff = this.#answerRightClick(root)
    this.#path = PlacePath.root(ROOT_PLACE)
    this.#here.show({ from: 'save' })
    this.#updatePathUI()
    this.#updateInventory()
    void this.#restoreSlot()
    window.addEventListener('keydown', this.#keyDown, true)
    window.addEventListener('keyup', this.#keyUp, true)
    window.addEventListener('blur', this.#release)
    document.addEventListener('visibilitychange', this.#visibility)
    window.addEventListener('pagehide', this.#save)
    this.#lastTs = 0
    root.focus({ preventScroll: true })
    this.#raf = requestAnimationFrame(this.#loop)
  }

  // -- the path shell -------------------------------------------------------

  get #here(): PlaceRuntime { return this.#runtime(this.#path.here.place) }

  /** Builds (once, lazily; cached forever after) the one `PlaceRuntime` for
   *  `place`, and folds in whatever facts a restore left waiting for it in
   *  `#dormant` — a place never has to know whether it is being shown fresh
   *  or resumed. */
  #runtime(place: string): PlaceRuntime {
    const existing = this.#runtimes.get(place)
    if (existing) return existing
    const host = element('div', 'sol-adventure-place')
    host.hidden = true
    this.#content!.append(host)
    let runtime: PlaceRuntime
    const world = WORLDS.get(place)
    if (world) runtime = new IslandRuntime(host, this.#shell, world)
    else if (place === LABYRINTH_PLACE.id) runtime = new LabyrinthRuntime(host, this.#shell, () => this.#tileSurface(), this.#loaded)
    else {
      const definition = CHAMBERS.find(chamber => chamber.id === place)
      if (!definition) throw new Error(`labyrinth-overlay.ts: no chamber definition for "${place}"`)
      runtime = new ChamberRuntime(host, definition, this.#shell)
    }
    this.#runtimes.set(place, runtime)
    runtime.guide?.(this.#guide?.target ?? null)
    const facts = this.#dormant.get(place)
    if (facts !== undefined) { runtime.restoreFacts(facts); this.#dormant.delete(place) }
    return runtime
  }

  #tileSurface(): SolomonTileSurface { return this.#surface ??= createSolomonTileSurface([]) }

  /** The ONE navigation gateway (§4.3). `home` always wins, cancelling
   *  whatever busy ticket is open; every other intent is refused while one
   *  is open, remembered on it, and replayed the instant it closes. */
  #request = (intent: Intent): void => {
    if (intent.kind === 'home') {
      if (this.#busy) { this.#busy.cancelled = true; this.#busy = null; this.#root?.removeAttribute('aria-busy') }
      this.#warpTo(0)
      return
    }
    if (this.#busy) { this.#busy.intent = intent; return }
    if (intent.kind === 'enter') this.#enter(intent.from, intent.entrance, intent.arrive)
    else if (intent.kind === 'leave') this.#leaveTo(intent.from, intent.exit)
    else if (intent.kind === 'crumb') this.#crumbTo(intent.index)
    else if (intent.kind === 'surface') this.#surfaceTo(intent.from)
    else this.#openDesigner()
  }

  /** Every place-path move but a fresh descent ends up here: hop back to
   *  `targetIndex` on the current path, veiling the swap. */
  #warpTo(targetIndex: number, exit?: string): void {
    if (targetIndex < 0 || targetIndex >= this.#path.depth) return
    if (targetIndex === this.#path.depth - 1) return
    const leaving = this.#here
    this.#gain?.close()
    this.#items?.close()
    leaving.closeDialog()
    const viaBack = this.#path.steps[targetIndex + 1]?.via ?? ''
    const arriving = this.#runtime(this.#path.steps[targetIndex].place)
    this.#warp(leaving.leaveLeg('out'), arriving.arriveLeg('out'), () => {
      this.#path.leaveTo(targetIndex)
      leaving.hide()
      arriving.show({ from: 'below', via: viaBack, exit })
      this.#updatePathUI()
    })
    this.#save()
  }

  #leaveTo(from?: string, exit?: string): void {
    if (from !== undefined && from !== this.#path.here.place) return
    if (this.#path.depth <= 1) return
    this.#warpTo(this.#path.depth - 2, exit)
  }

  #surfaceTo(from: string): void {
    if (from !== this.#path.here.place) return
    this.#warpTo(0)
  }

  #crumbTo(index: number): void { this.#warpTo(index) }

  /** A fresh descent into `entrance`, seated per `STORY` — the labyrinth's
   *  own async room hydration (or a chamber's trivial synchronous one) rides
   *  on a busy ticket exactly like a restore does, so a stale reply from a
   *  since-cancelled attempt can never resurrect a place the traveller has
   *  already left. */
  #enter(from: string, entrance: string, arrive?: string): void {
    if (from !== this.#path.here.place) return
    const key = entranceKey(from, entrance)
    this.#found.add(key)
    this.#dirty = true
    const seat = seatAt(STORY, key)
    if (!seat) { this.#message('Nothing has been built here yet.'); return }
    if (this.#path.includes(seat.place) || this.#path.depth >= MAX_PATH_DEPTH) return
    const leaving = this.#here
    this.#gain?.close()
    this.#items?.close()
    leaving.closeDialog()
    const runtime = this.#runtime(seat.place)
    const busy: Busy = { kind: 'enter', cancelled: false, intent: null }
    this.#busy = busy
    this.#root?.setAttribute('aria-busy', 'true')
    const arriveId = arrive ?? seat.arrive ?? ''
    const proceed = (ok: true | string): void => {
      if (busy.cancelled || !this.#root) return
      this.#busy = null
      this.#root.removeAttribute('aria-busy')
      if (ok !== true) { this.#message(ok); this.#save(); return }
      this.#warp(leaving.leaveLeg('in'), runtime.arriveLeg('in'), () => {
        this.#path.enter(key, seat.place)
        leaving.hide()
        runtime.show({ from: 'above', seat, arrive: arriveId })
        this.#updatePathUI()
      })
      this.#save()
      const next = busy.intent
      if (next) this.#request(next)
    }
    // A prepare that throws must still release the busy ticket and say why,
    // or every later intent queues behind a ticket that never closes.
    const refused = (error: unknown): void => proceed(error instanceof Error ? error.message : 'This place could not open. Try it again.')
    let result: true | string | Promise<true | string>
    try { result = runtime.prepare(seat, () => busy.cancelled) } catch (error) { result = Promise.reject(error) }
    if (result instanceof Promise) result.then(proceed, refused)
    else proceed(result)
  }

  /** Every warp goes through the veil: the place on show zooms into (or
   *  shrinks back into) the entrance, and the next place resolves at the
   *  swap. Without a picture to leave from, or without a veil, it simply
   *  happens. */
  #warp(leave: VeilLeg | null, arrive: VeilLeg | null, swap: () => void): void {
    if (!this.#veil || !leave || !this.#content) { swap(); return }
    this.#veil.play({ leave, arrive: arrive ?? { element: this.#content, picture: null, origin: [0.5, 0.5], scale: 1 }, onSwap: swap })
  }

  showDesigner(): void { this.#request({ kind: 'design' }) }

  #openDesigner(): void {
    if (!this.#root || this.#designer) return
    this.#release()
    this.#veil?.cancel()
    this.#save()
    this.#closeSlots()
    this.#gain?.close()
    this.#items?.close()
    this.#root.hidden = true
    this.#designer = new SolomonOverlay(() => {
      this.#designer?.unmount()
      this.#designer = null
      if (this.#root) { this.#root.hidden = false; this.#save() }
    })
    this.#designer.mount()
    this.#designer.showDesigner()
  }

  #updatePathUI(): void {
    if (!this.#crumbs || !this.#card) return
    this.#crumbs.replaceChildren()
    const steps = this.#path.steps
    steps.forEach((step, index) => {
      if (index > 0) this.#crumbs!.append(element('span', 'sol-crumb-sep', '›'))
      const label = crumbLabel(steps, index, STORY)
      if (index === steps.length - 1) { this.#crumbs!.append(element('span', 'sol-crumb-here', label)); return }
      const crumb = this.#button(label, () => this.#request({ kind: 'crumb', index }))
      crumb.className = 'sol-crumb'
      this.#crumbs!.append(crumb)
    })
    const here = this.#path.here.place
    const definition = PLACES.get(here)
    this.#card.replaceChildren()
    this.#card.append(element('strong', '', definition?.name ?? here))
    if (definition?.subtitle) this.#card.append(element('span', '', definition.subtitle))
    const floor = floorLabel(here, STORY)
    if (floor) this.#card.append(element('span', 'sol-card-floor', floor))
    if (this.#path.depth > 1) this.#card.append(element('span', 'sol-card-up', `↑ ${this.#shell.upName(here)}`))
    if (this.#path.depth > 2) this.#card.append(element('span', 'sol-card-surface', `⤒ Surface to ${this.#shell.surfaceName(here)}`))
    this.#paintGuide()
  }

  /** The story's next step, re-read twice a second: one line on the place
   *  card, and the island's pointer aimed at where it happens. */
  #updateGuide(): void {
    const step = guideStep(this.#storyFacts())
    if (step === this.#guide) return
    this.#guide = step
    this.#paintGuide()
    for (const runtime of this.#runtimes.values()) runtime.guide?.(step?.target ?? null)
  }

  #paintGuide(): void {
    if (!this.#card) return
    this.#card.querySelector('.sol-card-next')?.remove()
    if (this.#guide) this.#card.append(element('span', 'sol-card-next', `Next · ${this.#guide.text}`))
  }

  // -- the ONE reveal / progress / use mechanism -----------------------------

  #storyFacts(): StoryFacts {
    return {
      has: requirement => this.journey.has(requirement),
      knows: id => this.#knowledge.has(id),
      done: ref => this.#done(ref),
    }
  }

  /** A live runtime's own current facts, else whatever a restore is still
   *  holding for a place that has not been shown yet this session, else
   *  null — never a third, separate store. */
  #factsRecord(place: string): Record<string, unknown> | null {
    const live = this.#runtimes.get(place)
    return record(live ? live.exportFacts() : this.#dormant.get(place))
  }

  /** §3.2's `done()` grammar, plus the one new row M2 adds
   *  (`labyrinth/skill:<id>`, read off `journey.kit`, never a dead
   *  `exportProgress()` path — M22). */
  #done(ref: string): boolean {
    if (ref === ROOT_PLACE) return true
    if (ref === LABYRINTH_PLACE.id) return this.journey.visited.size > 0
    if (PLACES.has(ref)) return this.#runtimes.has(ref) || this.#dormant.has(ref)

    const skill = /^labyrinth\/skill:(.+)$/.exec(ref)
    if (skill) return this.journey.kit.includes(skill[1] as CombatSkillId)

    const labyrinthFact = /^labyrinth\/(relic|arrival|room):(.+)$/.exec(ref)
    if (labyrinthFact) {
      const [, kind, id] = labyrinthFact
      if (kind === 'relic') return this.journey.collected(id)
      if (kind === 'arrival') return this.journey.completed.has(id)
      return this.journey.visited.has(id)
    }

    const found = /^island\/found:(.+)$/.exec(ref)
    if (found) return this.#found.has(`island/${found[1]}`)

    const socket = /^island\/socket:([a-z0-9-]+):(\d+)$/.exec(ref)
    if (socket) return arrayHas(this.#factsRecord(ROOT_PLACE)?.['filledSockets'], `${socket[1]}:${socket[2]}`)

    const islandFact = /^island\/(cache|person|met):(.+)$/.exec(ref)
    if (islandFact) {
      const [, kind, id] = islandFact
      const facts = this.#factsRecord(ROOT_PLACE)
      if (!facts) return false
      if (kind === 'cache') return arrayHas(facts['opened'], id)
      if (kind === 'person') return arrayHas(facts['solved'], id)
      return arrayHas(facts['met'], id)
    }

    const setRef = /^([a-z0-9-]+)\/set:(.+)$/.exec(ref)
    if (setRef) {
      const [, place, setId] = setRef
      const definition = CHAMBERS.find(chamber => chamber.id === place)
      const set = definition?.lampSets.find(candidate => candidate.id === setId)
      const facts = this.#factsRecord(place)
      if (!set || !facts) return false
      const lit = Array.isArray(facts['lit']) ? facts['lit'] as string[] : []
      return set.lamps.every(lampId => lit.includes(lampId))
    }

    const artifact = /^([a-z0-9-]+)\/artifact:(.+)$/.exec(ref)
    if (artifact) return this.#factsRecord(artifact[1])?.['claimed'] === true

    const chamberFact = /^([a-z0-9-]+)\/(tablet|gate|chest|door|shutter|lever|lamp|alcove):(.+)$/.exec(ref)
    if (chamberFact) {
      const [, place, kind, id] = chamberFact
      const key = CHAMBER_FACT_KEY[kind]
      return !!key && arrayHas(this.#factsRecord(place)?.[key], id)
    }

    return false
  }

  #useContext(): UseContext {
    const place = this.#path.here.place
    return {
      place, group: groupOfPlace(place)?.id ?? null, shrine: null, needle: null,
      weapon: this.journey.weapon, spell: this.journey.spell,
    }
  }

  #useAttainmentAction(id: string): void {
    const def = attainmentById(id)
    const result = useAttainment(id, this.#storyFacts(), this.#useContext())
    switch (result.kind) {
      case 'read': this.#message(result.text); break
      case 'map': this.#message(def ? `The ${def.title} points the way.` : 'A map, unfolded.'); break
      case 'needle': this.#message(result.text); break
      case 'shrine': this.#message(def ? `Bring the ${def.title} to a shrine that still needs it.` : 'Bring it to a shrine.'); break
      case 'words': this.#message(result.text); break
      case 'equip': {
        const ok = this.journey.equip(result.id)
        if (ok) {
          this.#message(`${def?.title ?? result.id} equipped.`)
          this.#items?.refresh()
          this.#dirty = true
          this.#save()
        }
        break
      }
      case 'none': break
    }
  }

  #showGain(request: GainRequest): void {
    this.#gain ??= new GainScreen(this.#root!, {
      seen: id => this.#revealed.has(id),
      markSeen: ids => { for (const id of ids) this.#revealed.add(id); this.#dirty = true; this.#save() },
      board: boardId => {
        const board = itemsBoards(this.#storyFacts(), STORY_BOARDS).find(candidate => candidate.id === boardId)
        return board ? { title: board.title, slots: board.slots.map(slot => ({ id: slot.id, filled: slot.filled })) } : null
      },
      closed: () => { this.#items?.refresh(); this.#save() },
    })
    this.#gain.show(request)
  }

  #openItems(section?: ItemsTab): void {
    if (!this.#root || this.#busy) return
    this.#release()
    this.#fromMenu = false
    this.#items ??= new ItemsTable(this.#root, {
      facts: () => this.#storyFacts(),
      context: () => this.#useContext(),
      use: id => this.#useAttainmentAction(id),
      closed: () => this.#save(),
    })
    this.#items.show(section)
  }

  // -- shell services for runtimes (§4.10) -----------------------------------

  #buildShell(): RuntimeShell {
    return {
      journey: () => this.journey,
      release: () => this.#release(),
      save: () => { this.#save() },
      enter: (from, entrance, arrive) => this.#request({ kind: 'enter', from, entrance, arrive }),
      leave: (from, exit) => this.#request({ kind: 'leave', from, exit }),
      surface: from => this.#request({ kind: 'surface', from }),
      seat: (from, entrance) => seatLabel(entranceKey(from, entrance), STORY),
      upName: place => {
        const seat = seatsOf(STORY, place)[0]
        const split = seat ? splitEntranceKey(seat.entrance) : null
        return placeName(split?.place ?? ROOT_PLACE)
      },
      surfaceName: () => placeName(ROOT_PLACE),
      instruments: place => this.#instruments(place),
      learn: (id, text) => { if (!this.#knowledge.has(id)) { this.#knowledge.set(id, text); this.#dirty = true } },
      knows: id => this.#knowledge.has(id),
      message: text => this.#message(text),
      sound: kind => this.#sound(kind),
      gain: request => this.#showGain(request),
      seatSeed: (from, entrance) => {
        const seat = seatAt(STORY, entranceKey(from, entrance))
        return seat ? this.#runtimes.get(seat.place)?.seed() ?? null : null
      },
      found: (from, entrance) => { this.#found.add(entranceKey(from, entrance)); this.#dirty = true },
      openItems: () => this.#openItems(),
      recordRelic: () => this.#recordRelic(),
      facts: () => this.#storyFacts(),
    }
  }

  #instruments(place: string): ChamberInstruments {
    const definition = CHAMBERS.find(chamber => chamber.id === place)
    return definition ? chamberInstruments(definition) : { look: 'cavern', torch: 1, sconces: false }
  }

  /** A touch-picked relic (a sigil piece, gathered mid-room rather than
   *  through `interact()`) is a reveal like any other (2) A5.5's own row for
   *  "relic pieces" — routed through the same one `GainScreen`, never a
   *  bespoke dialog. */
  #recordRelic(): void {
    const relic = this.journey.lastRelic
    if (!relic || relic.id === this.#lastRelic) return
    this.#lastRelic = relic.id
    if (relic.lore) this.#knowledge.set(relic.id, relic.lore)
    this.#dirty = true
    this.#updateInventory()
    const id = relic.kind === 'triangle' ? `piece:triangle:${relic.point}` : relic.kind === 'hexagon' ? 'piece:hexagon' : 'piece:star'
    const def = attainmentById(id)
    if (def) this.#showGain({ id: def.id, eyebrow: 'A SIGIL PIECE', title: def.title, words: relic.lore ?? def.words, art: def.art, fresh: true, ...(def.slot ? { slot: def.slot } : {}) })
    else this.#message(relic.lore ?? 'A new piece joins your star.')
    if (this.journey.completed.has('starbloom')) this.#message('The Pyramid of Accord is open. You found its heart! Return to the world to revisit your discoveries.')
  }

  /** The one sound dispatch point (M5/M8): short blips through the shared
   *  `GameAudio` helpers. Exact tones are a combat-role implementation
   *  choice, not pinned by any source beyond "short combat blips" (§1 M5). */
  #sound(kind: ChamberSound | 'door-in' | 'door-out' | 'door-locked'
    | 'hush' | 'duel' | 'strike' | 'stagger' | 'parry' | 'ward' | 'ember' | 'bat' | 'clang' | 'catch'): void {
    const TONE: Readonly<Record<string, { freq: number; endFreq: number; dur: number; vol: number }>> = {
      'door-in': { freq: 440, endFreq: 880, dur: 0.22, vol: 0.07 },
      'door-out': { freq: 660, endFreq: 880, dur: 0.22, vol: 0.07 },
      'door-locked': { freq: 220, endFreq: 180, dur: 0.14, vol: 0.05 },
      push: { freq: 300, endFreq: 260, dur: 0.08, vol: 0.05 },
      latch: { freq: 520, endFreq: 640, dur: 0.12, vol: 0.05 },
      read: { freq: 700, endFreq: 700, dur: 0.08, vol: 0.04 },
      lit: { freq: 880, endFreq: 1040, dur: 0.14, vol: 0.05 },
      complete: { freq: 660, endFreq: 990, dur: 0.3, vol: 0.07 },
      unlock: { freq: 500, endFreq: 760, dur: 0.18, vol: 0.06 },
      pull: { freq: 340, endFreq: 300, dur: 0.1, vol: 0.05 },
      wand: { freq: 600, endFreq: 500, dur: 0.1, vol: 0.05 },
      seal: { freq: 400, endFreq: 400, dur: 0.3, vol: 0.06 },
      settle: { freq: 460, endFreq: 460, dur: 0.12, vol: 0.05 },
      open: { freq: 620, endFreq: 780, dur: 0.16, vol: 0.06 },
      claim: { freq: 660, endFreq: 990, dur: 0.24, vol: 0.06 },
      finale: { freq: 500, endFreq: 1000, dur: 0.6, vol: 0.08 },
      hush: { freq: 220, endFreq: 160, dur: 0.3, vol: 0.05 },
      duel: { freq: 500, endFreq: 700, dur: 0.2, vol: 0.06 },
      strike: { freq: 700, endFreq: 500, dur: 0.06, vol: 0.05 },
      stagger: { freq: 300, endFreq: 200, dur: 0.14, vol: 0.05 },
      parry: { freq: 900, endFreq: 700, dur: 0.06, vol: 0.05 },
      ward: { freq: 800, endFreq: 1000, dur: 0.1, vol: 0.05 },
      ember: { freq: 600, endFreq: 300, dur: 0.2, vol: 0.06 },
      bat: { freq: 500, endFreq: 400, dur: 0.06, vol: 0.04 },
      clang: { freq: 250, endFreq: 200, dur: 0.08, vol: 0.05 },
      catch: { freq: 800, endFreq: 800, dur: 0.05, vol: 0.04 },
    }
    const tone = TONE[kind]
    if (tone) this.#audio.tone(tone)
  }

  // -- key / touch input ------------------------------------------------------

  #button(label: string, action: () => void): HTMLButtonElement {
    const button = element('button', '', label) as HTMLButtonElement
    button.type = 'button'
    button.onclick = () => { this.#audio.unlock(); action() }
    return button
  }

  #touchControls(): HTMLElement {
    const bar = element('div', 'sol-adventure-touch')
    for (const [label, key] of [
      ['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight'],
      ['Jump', ' '], ['Wand', 'z'], ['Use', 'e'], ['Strike', 'c'], ['Cast', 'v'],
    ]) {
      const button = this.#button(label, () => {})
      button.setAttribute('aria-label', label === 'Use' ? 'Interact or use passage' : label)
      button.onpointerdown = event => {
        if (event.button !== 0) return
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        this.#keyDown(new KeyboardEvent('keydown', { key }))
      }
      const release = (): void => this.#keyUp(new KeyboardEvent('keyup', { key }))
      button.onpointerup = release
      button.onpointercancel = release
      button.onlostpointercapture = release
      bar.append(button)
    }
    return bar
  }

  /** The browser's own full screen, on or off. The land already fills the
   *  window. Menu only — the bare F key sat one key right of D on the walk
   *  cluster and fired by accident (jwize, 2026-09-21). */
  #toggleFullScreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => {})
    else void document.documentElement.requestFullscreen?.()?.catch(() => {})
  }

  #openMenu(): void {
    if (!this.#menu || this.#designer) return
    this.#release()
    this.#here.closeDialog()
    this.#gain?.close(); this.#items?.close(); this.#closeSlots()
    this.#askMenu()
    this.#menu.open()
  }

  #closeMenu(): void {
    if (!this.#menu?.isOpen) return
    this.#menu.close()
    this.#root?.focus({ preventScroll: true })
  }

  /** Come back out one step. Escape and the right button both ask it, and a
   *  panel entered from the menu comes back out to the menu, as in a hive. */
  #back(): void {
    if (!this.#root || this.#designer) return
    if (this.#slotPanel) { this.#closeSlots(); this.#backToMenu(); return }
    if (this.#items?.isOpen) { this.#items.close(); this.#backToMenu(); return }
    if (this.#gain?.isOpen) { this.#gain.close(); return }
    if (this.#here.isDialogOpen) { this.#here.closeDialog(); return }
    if (this.#menu?.isOpen) { this.#closeMenu(); return }
    if (this.#busy || this.#path.depth > 1) { this.#request({ kind: 'leave' }); return }
    this.#openMenu()
  }

  #backToMenu(): void {
    if (!this.#fromMenu) return
    this.#fromMenu = false
    this.#openMenu()
  }

  /** RIGHT-CLICK COMES BACK OUT, as everywhere in the hive. Inside the hive
   *  the gesture is the shell's: one entry scoped to the game, so it never
   *  falls through to the lineage and walks the hive out from under the land.
   *  A page with no shell (the stand-alone harness) answers from the root. */
  #answerRightClick(root: HTMLElement): () => void {
    const gesture = (window as unknown as { ioc?: { get<T>(key: string): T | undefined } }).ioc
      ?.get<{ register(entry: { owner: string; back: () => void; within?: () => Element | null }): () => void }>('@diamondcoreprocessor.com/BackGesture')
    if (gesture) return gesture.register({ owner: 'solomon-key', within: () => this.#root, back: () => this.#back() })
    const answer = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return
      event.preventDefault()
      this.#back()
    }
    root.addEventListener('contextmenu', answer)
    return () => root.removeEventListener('contextmenu', answer)
  }

  /** The options are a standard layer — one tile per option, beside the
   *  rooms — seeded once and read back after. Asked on the first open; until
   *  it answers, or with no hive at all, the defaults stand in. */
  #askMenu(): void {
    if (this.#menuAsked) return
    this.#menuAsked = true
    void Promise.resolve()
      .then(() => this.#tileSurface().ensureMenu(DEFAULT_MENU))
      .then(options => { if (options.length) this.#menu?.setOptions(options) })
      .catch(() => { /* no hive yet: the defaults stand in */ })
  }

  #chooseMenu(option: MenuOption): void {
    switch (option.action) {
      case 'continue': this.#closeMenu(); break
      case 'items': this.#closeMenu(); this.#openItems(); this.#fromMenu = true; break
      case 'island': this.#closeMenu(); this.#request({ kind: 'home' }); break
      case 'saves': this.#closeMenu(); this.#openSlots(); this.#fromMenu = true; break
      case 'sound': this.#audio.unlock(); this.#audio.toggleMuted(); this.#menu?.refresh(); break
      case 'fullscreen': this.#toggleFullScreen(); break
      case 'designer': this.#closeMenu(); this.showDesigner(); break
      case 'close': this.#onClose(); break
      default: break
    }
  }

  #menuDetail(option: MenuOption): string {
    if (option.action === 'sound') return this.#audio.muted ? 'off' : 'on'
    if (option.action === 'saves') return `slot ${this.#slots?.activeSlot ?? 1}`
    return ''
  }

  #release = (): void => {
    this.#input.up = this.#input.down = this.#input.left = this.#input.right = false
  }

  #visibility = (): void => { this.#release(); if (document.hidden) this.#save() }

  /** §4.6's one input model, with combat's C/V/N/B folded straight in
   *  (M5) — a runtime's own `key()` decides what any of them do; the shell
   *  never asks which kind of place is listening. */
  #keyDown = (event: KeyboardEvent): void => {
    if (!this.#root || this.#designer || event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'escape') {
      event.preventDefault(); event.stopPropagation()
      this.#back()
      return
    }
    if (this.#menu?.isOpen) {
      if (this.#menu.key(key)) event.preventDefault()
      event.stopPropagation()
      return
    }
    const dialogOpen = !!this.#slotPanel || !!this.#items?.isOpen || !!this.#gain?.isOpen || this.#here.isDialogOpen
    if (dialogOpen) {
      if (key === 'e' && !event.repeat && !this.#slotPanel) {
        event.preventDefault(); event.stopPropagation()
        if (this.#items?.isOpen) this.#items.close()
        else if (this.#gain?.isOpen) this.#gain.close()
        else this.#here.closeDialog()
        return
      }
      const dialog = this.#root.querySelector<HTMLElement>('[role="dialog"]:not([hidden])')
      if (dialog) {
        const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const target = document.activeElement
        if ((key === 'enter' || key === ' ') && target instanceof HTMLButtonElement && dialog.contains(target)) {
          event.preventDefault()
          target.click()
        } else if (key === 'tab') {
          const first = buttons[0], last = buttons.at(-1)
          if (event.shiftKey && (target === first || !buttons.includes(target as HTMLButtonElement))) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (target === last || !buttons.includes(target as HTMLButtonElement))) { event.preventDefault(); first?.focus() }
        } else if (KEYS.has(key)) event.preventDefault()
      }
      event.stopPropagation()
      return
    }
    if (!KEYS.has(key)) return
    if ((key === 'enter' || key === ' ') && event.target instanceof HTMLButtonElement) return
    event.preventDefault(); event.stopPropagation()
    this.#audio.unlock()
    if (this.#busy) { if (key === 'm') this.#request({ kind: 'home' }); return }
    if (key === 'm') { this.#request({ kind: 'home' }); return }
    if (key === 'i' && !event.repeat) { this.#openItems(); return }
    if ((key === 'e' || key === 'enter') && !event.repeat) { this.#release(); this.#here.interact(); return }
    const left = key === 'arrowleft' || key === 'a', right = key === 'arrowright' || key === 'd'
    const up = key === 'arrowup' || key === 'w', down = key === 'arrowdown' || key === 's'
    if (left) this.#input.left = true
    if (right) this.#input.right = true
    if (up) this.#input.up = true
    if (down) this.#input.down = true
    if (!event.repeat && (key === 'z' || key === 'j')) { this.#here.cast(); return }
    this.#here.key(key, true, event.repeat)
  }

  #keyUp = (event: KeyboardEvent): void => {
    if (!this.#root || this.#designer) return
    const key = event.key.toLowerCase()
    if (key === 'arrowleft' || key === 'a') this.#input.left = false
    if (key === 'arrowright' || key === 'd') this.#input.right = false
    if (key === 'arrowup' || key === 'w' || key === ' ') this.#input.up = false
    if (key === 'arrowdown' || key === 's') this.#input.down = false
    this.#here.key(key, false, false)
    if (KEYS.has(key)) event.stopPropagation()
  }

  #loop = (ts: number): void => {
    if (!this.#root) return
    const dt = this.#lastTs ? Math.min((ts - this.#lastTs) / 1000, 0.05) : 0
    this.#lastTs = ts
    this.#time += dt
    if (!document.hidden && !this.#slotPanel && !this.#items?.isOpen && !this.#gain?.isOpen && !this.#menu?.isOpen && !this.#busy && !this.#designer && !this.#veil?.playing) {
      this.#here.update(dt, this.#input)
    }
    this.#updateInventory()
    if (this.#time >= this.#guideAt) { this.#guideAt = this.#time + 0.5; this.#updateGuide() }
    if (this.#time >= this.#saveAt) { this.#saveAt = this.#time + 1; this.#save() }
    this.#raf = requestAnimationFrame(this.#loop)
  }

  #message(text: string): void { if (this.#messageEl) this.#messageEl.textContent = text }

  #updateInventory(): void {
    const inventory = this.journey.inventory
    const text = `▲ ${inventory.triangles.size}/6 · ⬡ ${inventory.hexagon ? '1' : '0'}/1 · ✡ ${inventory.star ? 'Complete' : 'Gathering'}`
    if (text === this.#inventoryKey) return
    this.#inventoryKey = text
    if (this.#inventory) { this.#inventory.textContent = text; this.#inventory.setAttribute('aria-label', `${inventory.triangles.size} of six triangles, ${inventory.hexagon ? 'central hexagon found' : 'central hexagon missing'}, star ${inventory.star ? 'complete' : 'incomplete'}`) }
  }

  // -- saves (§4.9) -----------------------------------------------------------

  #snapshot(): unknown {
    const places = new Map<string, unknown>()
    for (const [place, facts] of this.#dormant) places.set(place, facts)
    for (const [place, runtime] of this.#runtimes) if (place !== LABYRINTH_PLACE.id) places.set(place, runtime.exportFacts())
    return writeAdventureSave({
      journey: this.journey.exportState(),
      knowledge: this.#knowledge,
      path: this.#path.toJSON(),
      places,
      carried: this.#carried,
      extra: this.#extra,
      revealed: this.#revealed,
      found: this.#found,
    })
  }

  #save = (): boolean => {
    if (!this.#slots || this.#restoreFailed || this.#busy) return false
    try {
      const snapshot = this.#snapshot(), serialized = JSON.stringify(snapshot)
      if (serialized === this.#lastSaved && !this.#slots.error) return true
      if (!this.#slots.save(snapshot)) { this.#updateSaveStatus(); return false }
      this.#lastSaved = serialized
      this.#dirty = false
      this.#updateSaveStatus()
      return true
    } catch {
      if (this.#saveStatus) this.#saveStatus.textContent = 'Autosave unavailable'
      return false
    }
  }

  #readKnowledge(pairs: Iterable<readonly [string, string]>): void {
    for (const [id, text] of pairs) this.#knowledge.set(id, text)
  }

  async #restoreSlot(): Promise<void> {
    if (!this.#slots || !this.#root) return
    const raw = this.#slots.read()
    this.#restoreFailed = false
    this.#lastSaved = ''
    const plan = readAdventureSave(raw, STORY)
    if (!plan) {
      if (raw !== null) { this.#restoreFailed = true; this.#message('This slot could not be read. Its saved adventure has been kept.') }
      this.#save()
      this.#updateSaveStatus()
      return
    }
    const busy: Busy = { kind: 'restore', cancelled: false, intent: null }
    this.#busy = busy
    this.#root.setAttribute('aria-busy', 'true')
    this.#message(`Continuing Slot ${this.#slots.activeSlot}…`)
    try {
      // Rule 1 — synchronous, before any hydration: permanent discoveries only.
      this.journey.restoreProgress(plan.progress)
      this.#carried = [...plan.carried]
      this.#extra = [...plan.extra]
      this.#readKnowledge(plan.knowledge)
      for (const [place, facts] of plan.places) this.#dormant.set(place, facts)
      this.#updateInventory()

      // Rule 2, the labyrinth's own share: hydrate whatever rooms its
      // journey touched, regardless of whether it sits on the restored
      // path — a visited room's live state survives even when play
      // currently continues elsewhere (§4.9/M15).
      const labyrinth = this.#runtime(LABYRINTH_PLACE.id) as LabyrinthRuntime
      const hydrated = await Promise.resolve(labyrinth.hydrateFor(plan.journey, () => busy.cancelled))
      if (busy.cancelled || !this.#root) return
      if (hydrated) labyrinth.restoreFacts(plan.journey)

      // Walk the saved path, hydrating each step in turn; the first place
      // that cannot resume (or a cancelled attempt) ends the walk there.
      const resumable = new Set<string>([ROOT_PLACE])
      this.#runtime(ROOT_PLACE)
      const steps: unknown = plan.path
      let host = ROOT_PLACE
      for (let i = 1; i < (Array.isArray(steps) ? steps.length : 0); i++) {
        const step = record((steps as unknown[])[i])
        const via = step?.['via'], place = step?.['place']
        if (typeof via !== 'string' || typeof place !== 'string') break
        const split = splitEntranceKey(via)
        if (!split || split.place !== host || resumable.has(place) || !PLACES.has(place)) break
        const seat = seatAt(STORY, via)
        if (!seat || seat.place !== place) break
        if (place === LABYRINTH_PLACE.id) { if (labyrinth.canResume()) resumable.add(place); break }
        const runtime = this.#runtime(place)
        const ok = await Promise.resolve(runtime.prepare(seat, () => busy.cancelled))
        if (busy.cancelled || !this.#root) return
        if (ok !== true) break
        resumable.add(place)
        host = place
      }
      this.#path = PlacePath.restore(plan.path, STORY, PLACES, ROOT_PLACE, place => resumable.has(place))
      this.#revealed = new Set(plan.revealed ?? heldAttainments(this.#storyFacts()).map(def => def.id))
      this.#found = new Set(plan.found)
      for (const step of this.#path.steps) if (step.via) this.#found.add(step.via)
      for (const [place, runtime] of this.#runtimes) if (place !== this.#path.here.place) runtime.hide()
      this.#here.show({ from: 'save' })
      this.#updatePathUI()
      this.#updateInventory()
      this.#lastSaved = JSON.stringify(this.#snapshot())
      this.#message(`Slot ${this.#slots.activeSlot} continued. Your progress saves automatically.`)
    } catch (error) {
      if (busy.cancelled || !this.#root) return
      this.#restoreFailed = true
      this.#path = PlacePath.root(ROOT_PLACE)
      this.#message(`Could not continue this slot. ${error instanceof Error ? error.message : 'Try again from Saves.'} Your saved adventure has been kept.`)
    } finally {
      if (!busy.cancelled) {
        this.#busy = null
        this.#root?.removeAttribute('aria-busy')
        this.#updateSaveStatus()
        const next = busy.intent
        if (next) this.#request(next)
      }
    }
  }

  #updateSaveStatus(): void {
    this.#menu?.refresh()
    if (this.#saveStatus) {
      this.#saveStatus.textContent = this.#restoreFailed ? 'Continue unavailable' : this.#slots?.error ? 'Autosave unavailable' : 'Autosaved'
      this.#saveStatus.title = this.#slots?.error ?? 'Progress saves automatically in this browser.'
    }
  }

  #closeSlots(): void {
    if (!this.#slotPanel) return
    this.#slotPanel.remove(); this.#slotPanel = null
    this.#release()
    this.#root?.focus({ preventScroll: true })
  }

  #openSlots(confirmReset?: number): void {
    if (!this.#root || !this.#slots || this.#busy) return
    this.#release()
    this.#here.closeDialog()
    this.#gain?.close(); this.#items?.close()
    this.#save()
    this.#closeSlots()
    const backdrop = element('div', 'sol-save-backdrop')
    const dialog = element('section', 'sol-save-panel')
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Adventure save slots')
    dialog.append(element('h2', '', 'Your adventures'), element('p', '', 'The active slot saves automatically as you play.'))
    for (const slot of this.#slots.list()) {
      const row = element('div', 'sol-save-slot')
      row.dataset['slot'] = String(slot.id)
      row.setAttribute('aria-label', `Slot ${slot.id}`)
      const active = slot.id === this.#slots.activeSlot
      const info = element('div', 'sol-save-info')
      info.append(element('strong', '', `Slot ${slot.id}${active ? ' · Playing' : ''}`))
      const plan = readAdventureSave(this.#slots.read(slot.id), STORY)
      const relicIds = record(plan?.progress)?.['relicIds']
      const pieces = Array.isArray(relicIds) ? relicIds.length : 0
      info.append(element('small', '', slot.occupied ? `${pieces} discoveries · ${slot.updatedAt ? new Date(slot.updatedAt).toLocaleString() : 'Saved adventure'}` : 'New adventure'))
      row.append(info)
      if (confirmReset === slot.id) {
        row.append(element('p', 'sol-save-reset-note', `Start Slot ${slot.id} again? Its progress will be cleared.`))
        row.append(this.#button('Cancel', () => this.#openSlots()), this.#button(`Reset Slot ${slot.id}`, () => { void this.#resetSlot(slot.id) }))
      } else {
        if (!active) row.append(this.#button(slot.occupied ? 'Continue' : 'Start', () => { void this.#switchSlot(slot.id) }))
        if (slot.occupied) row.append(this.#button('Reset', () => this.#openSlots(slot.id)))
      }
      dialog.append(row)
    }
    if (this.#slots.error || this.#restoreFailed) {
      dialog.append(element('p', 'sol-save-error', this.#slots.error ?? 'The saved rooms could not load. Your save has been kept.'))
      dialog.append(this.#button('Try again', () => {
        if (this.#restoreFailed) { this.#closeSlots(); this.#freshSession(); void this.#restoreSlot() }
        else { this.#save(); this.#openSlots() }
      }))
    }
    const back = this.#button('Back to game', () => this.#closeSlots())
    dialog.append(back); backdrop.append(dialog); this.#root.append(backdrop); this.#slotPanel = backdrop
    back.focus({ preventScroll: true })
  }

  #freshSession(): void {
    if (this.#busy) this.#busy.cancelled = true
    this.#busy = null
    this.#release()
    this.#veil?.cancel()
    this.#gain?.close(); this.#items?.close()
    for (const runtime of this.#runtimes.values()) { runtime.dispose(); runtime.host.remove() }
    this.#runtimes.clear()
    this.#loaded.clear()
    this.#knowledge.clear()
    this.#dormant.clear()
    this.#carried = []
    this.#extra = []
    this.#revealed = new Set()
    this.#found = new Set()
    this.#lastRelic = ''
    this.journey = new LabyrinthJourney()
    this.#path = PlacePath.root(ROOT_PLACE)
    this.#here.show({ from: 'save' })
    this.#updatePathUI()
    this.#updateInventory()
    this.#root?.removeAttribute('aria-busy')
    this.#lastSaved = ''
  }

  async #switchSlot(id: number): Promise<void> {
    if (!this.#slots || id === this.#slots.activeSlot) return
    if ((!this.#restoreFailed && !this.#save()) || !this.#slots.select(id)) { this.#openSlots(); return }
    this.#closeSlots()
    this.#freshSession()
    await this.#restoreSlot()
  }

  async #resetSlot(id: number): Promise<void> {
    if (!this.#slots) return
    if (!this.#slots.reset(id)) { this.#openSlots(); return }
    if (id !== this.#slots.activeSlot) { this.#openSlots(); return }
    this.#closeSlots()
    this.#freshSession()
    await this.#restoreSlot()
    this.#message(`Slot ${id} reset. Your new adventure saves automatically.`)
  }

  unmount(): void {
    if (this.#busy) this.#busy.cancelled = true
    this.#save()
    this.#release()
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    window.removeEventListener('keydown', this.#keyDown, true)
    window.removeEventListener('keyup', this.#keyUp, true)
    window.removeEventListener('blur', this.#release)
    document.removeEventListener('visibilitychange', this.#visibility)
    window.removeEventListener('pagehide', this.#save)
    this.#backOff?.()
    this.#backOff = null
    this.#menu?.dispose()
    this.#menu = null
    this.#designer?.unmount()
    this.#designer = null
    this.#veil?.dispose()
    this.#veil = null
    this.#gain?.dispose()
    this.#gain = null
    this.#items?.dispose()
    this.#items = null
    for (const runtime of this.#runtimes.values()) runtime.dispose()
    this.#runtimes.clear()
    this.#audio.dispose()
    this.#root?.remove()
    this.#root = null
    this.#oldFocus?.focus({ preventScroll: true })
  }
}

const ADVENTURE_CSS = `
.sol-adventure{position:fixed;inset:0;z-index:2147483000;background:radial-gradient(ellipse at 65% 15%,#30496a,#15273f 70%);color:#f0f2f7;display:flex;flex-direction:column;font:14px system-ui,sans-serif;overflow:hidden;color-scheme:dark}
.sol-adventure [hidden],.sol-adventure[hidden]{display:none!important}.sol-adventure *{box-sizing:border-box}.sol-adventure button{font:inherit;color:inherit;cursor:pointer}
.sol-adventure button:focus-visible{outline:2px solid #ffdc96;outline-offset:3px}
.sol-adventure-touch button{border:1px solid #9ab2d24d;background:#0f1e30b3;padding:7px 11px;border-radius:7px;font-size:12px}
.sol-adventure-inventory{white-space:nowrap;font-size:13px;color:#edce95;font-variant-numeric:tabular-nums}
.sol-save-status{font-size:10px;color:#afc6b9}.sol-save-backdrop{position:absolute;inset:0;z-index:30;display:grid;place-items:center;background:#071624a8;padding:14px}.sol-save-panel{width:min(100%,520px);max-height:100%;overflow:auto;border:1px solid #a9bdbb66;border-radius:14px;padding:22px;background:#1b303e;box-shadow:0 20px 70px #0006}.sol-save-panel h2{font-size:20px;margin:0 0 6px}.sol-save-panel>p{font-size:12px;color:#b9ccc6;line-height:1.5}.sol-save-panel button{border:1px solid #879d9755;border-radius:7px;padding:7px 11px;background:#36564e;font-size:12px}.sol-save-slot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;border:1px solid #819f963d;border-radius:9px;padding:12px;margin:12px 0}.sol-save-info{flex:1;min-width:180px}.sol-save-info strong,.sol-save-info small{display:block}.sol-save-info small{font-size:11px;color:#b5c9c2;margin-top:5px}.sol-save-reset-note{flex-basis:100%;margin:3px 0;font-size:12px;color:#f2cb93}.sol-save-error{color:#f2cb93!important}
.sol-crumbs{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px;font-size:12px;color:#c3d3e6}
.sol-crumb{background:none;border:0;padding:2px 4px;color:#cfe0f2;text-decoration:underline;font-size:11px}.sol-crumb-sep{opacity:.5}.sol-crumb-here{color:#ffdc96;font-weight:600}
.sol-adventure-content{position:relative;flex:1;min-height:0;padding:0;overflow:hidden}.sol-adventure-place{height:100%;min-height:0}
.sol-card{position:absolute;left:12px;top:10px;z-index:15;display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-radius:10px;background:#0f1e30cc;border:1px solid #a3bedb22;pointer-events:none;max-width:60%}
.sol-card strong{font-size:13px}.sol-card span{font-size:10.5px;color:#c3d3e6}.sol-card-up,.sol-card-surface{color:#ffdc96}
.sol-card .sol-card-next{margin-top:5px;padding-top:5px;border-top:1px solid #a3bedb33;color:#ffe3a3;font-size:11px;line-height:1.4}
.sol-adventure .sol-rpg-world-heading{display:none}
.sol-adventure-message{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:20;width:max-content;max-width:min(92vw,760px);padding:6px 14px;border:1px solid #a3bedb33;border-radius:10px;text-align:center;font-size:12px;line-height:1.5;color:#dfd9bd;background:#0f1e30cc;pointer-events:none}
.sol-adventure-message:empty{display:none}
.sol-adventure[aria-busy=true] .sol-adventure-content{opacity:.65;pointer-events:none}.sol-adventure-touch{display:none;position:absolute;left:0;right:0;bottom:0;z-index:21;justify-content:center;gap:8px;padding:8px;touch-action:none;flex-wrap:wrap}
@media(pointer:coarse){.sol-adventure-touch{display:flex}.sol-adventure-message{bottom:72px}}@media(max-width:700px){.sol-adventure-inventory{font-size:11px}.sol-adventure-message{font-size:11px;padding:6px 12px}.sol-card{max-width:75%}.sol-adventure-touch{gap:5px}.sol-adventure-touch button{padding:8px}}
.sol-menu-open{position:absolute;top:10px;right:12px;z-index:25;width:38px;height:44px;border:0;padding:0;cursor:pointer;background:linear-gradient(160deg,#f0cf7a,#8f6f27);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);opacity:.85;transition:opacity .15s,filter .15s}
.sol-menu-open::before{content:'';position:absolute;inset:2px;clip-path:inherit;background:radial-gradient(ellipse at 50% 30%,#2e4270,#162241 70%)}
.sol-menu-open::after{content:'';position:absolute;left:50%;top:50%;width:14px;height:10px;transform:translate(-50%,-50%);border-top:2px solid #f2d38a;border-bottom:2px solid #f2d38a;background:linear-gradient(#f2d38a,#f2d38a) center/100% 2px no-repeat}
.sol-menu-open:hover,.sol-menu-open:focus-visible{opacity:1;filter:brightness(1.15)}
.sol-adventure .sol-rpg-world{padding:0}.sol-adventure .sol-rpg-world-controls,.sol-adventure .sol-rpg-world .sol-rpg-status{display:none}.sol-adventure .sol-rpg-map{border:0;border-radius:0;box-shadow:none}
.sol-adventure .sol-chamber-view{position:relative;gap:0;justify-content:center;container-type:size}.sol-adventure .sol-chamber-heading,.sol-adventure .sol-chamber-controls{display:none}
.sol-adventure .sol-chamber-map{width:min(100cqw,calc(100cqh * var(--cols) / var(--rows)));margin:auto;border-radius:0}
.sol-adventure .sol-chamber-status{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:6;width:max-content;max-width:70%;padding:4px 12px;border-radius:8px;background:#0f1e30b3;pointer-events:none}.sol-adventure .sol-chamber-status:empty{display:none}
.sol-adventure .sol-native-room{position:relative;gap:0}.sol-adventure .sol-room-heading,.sol-adventure .sol-room-hint{display:none}.sol-adventure .sol-room-viewport{padding:6px}
.sol-adventure .sol-room-status{position:absolute;left:12px;bottom:10px;z-index:6;max-width:45%;gap:10px;padding:4px 10px;border-radius:8px;background:#0f1e30b3;pointer-events:none}.sol-adventure .sol-room-status progress{width:90px}
`
