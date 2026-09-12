import { SIM_DT, type Engine } from './engine.js'
import { LabyrinthJourney, ROOMS, describeRequirement } from './labyrinth.js'
import { LabyrinthRoomView, LABYRINTH_ROOM_CSS } from './labyrinth-view.js'
import { createSolomonTileSurface, type SolomonTileSurface, type LoadedTileRoom } from './tile-surface.js'
import { RpgOverworldView, RELIC_LORE, WORLD_DUNGEONS, WORLD_PEOPLE, WORLD_SHRINES } from './rpg-overworld.js'
import { PlaceVeil, PLACE_VEIL_CSS, type VeilLeg } from './place-veil.js'
import { ScrollDungeonView } from './scroll-dungeon.js'
import { SolomonOverlay } from './overlay.js'
import { GameAudio } from '../audio.js'
import { SaveSlotStore } from './save-slots.js'

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', ' ', 'z', 'x', 'j', 'k', 'e', 'enter', 'm', 'r', 'escape'])
const element = (tag: string, className = '', text = ''): HTMLElement => {
  const result = document.createElement(tag)
  result.className = className
  result.textContent = text
  return result
}

/** Adventure shell. The world, room puzzles and scrolling expeditions share
 *  knowledge and permanent abilities, with a separate simulation for each. */
export class SolomonLabyrinthOverlay {
  journey = new LabyrinthJourney()
  readonly #loaded = new Map<string, LoadedTileRoom>()
  readonly #knowledge = new Map<string, string>()
  readonly #dungeons = new Map<number, ScrollDungeonView>()
  readonly #audio = new GameAudio()
  readonly #input = { up: false, down: false, left: false, right: false }
  #surface: SolomonTileSurface | null = null
  #root: HTMLElement | null = null
  #content: HTMLElement | null = null
  #worldHost: HTMLElement | null = null
  #roomHost: HTMLElement | null = null
  #dungeonHost: HTMLElement | null = null
  #message: HTMLElement | null = null
  #inventory: HTMLElement | null = null
  #world: RpgOverworldView | null = null
  #roomView: LabyrinthRoomView | null = null
  #dungeon: ScrollDungeonView | null = null
  #designer: SolomonOverlay | null = null
  #veil: PlaceVeil | null = null
  #journal: HTMLElement | null = null
  #slots: SaveSlotStore<unknown> | null = null
  #slotPanel: HTMLElement | null = null
  #slotButton: HTMLButtonElement | null = null
  #saveStatus: HTMLElement | null = null
  #lastSaved = ''
  #restoreFailed = false
  #restoring = false
  #afterRestore: 'world' | 'design' | null = null
  #mode: 'world' | 'room' | 'dungeon' | 'loading' | 'design' = 'world'
  #raf = 0
  #lastTs = 0
  #time = 0
  #acc = 0
  #generation = 0
  #lastRelic = ''
  #inventoryKey = ''
  #dirty = false
  #saveAt = 0
  #oldFocus: HTMLElement | null = null

  constructor(private readonly onClose: () => void) {}
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
    style.textContent = ADVENTURE_CSS + LABYRINTH_ROOM_CSS + PLACE_VEIL_CSS
    root.append(style)
    const bar = element('header', 'sol-adventure-bar')
    bar.append(element('strong', '', '✡ Solomon’s Key'))
    this.#inventory = element('span', 'sol-adventure-inventory')
    bar.append(this.#inventory)
    bar.append(this.#button('World', () => this.#showWorld()))
    bar.append(this.#button('Journal', () => this.#openJournal()))
    this.#slotButton = this.#button('Saves', () => this.#openSlots())
    this.#saveStatus = element('span', 'sol-save-status')
    this.#saveStatus.setAttribute('role', 'status')
    bar.append(this.#slotButton, this.#saveStatus)
    bar.append(this.#button('Designer', () => this.showDesigner()))
    const sound = this.#button(this.#audio.muted ? 'Sound off' : 'Sound on', () => {
      this.#audio.unlock()
      sound.textContent = this.#audio.toggleMuted() ? 'Sound off' : 'Sound on'
    })
    bar.append(sound, this.#button('Close', () => this.onClose()))
    this.#content = element('main', 'sol-adventure-content')
    this.#worldHost = element('div', 'sol-adventure-world')
    this.#roomHost = element('div', 'sol-adventure-rooms')
    this.#dungeonHost = element('div', 'sol-adventure-dungeon')
    this.#roomHost.hidden = this.#dungeonHost.hidden = true
    this.#content.append(this.#worldHost, this.#roomHost, this.#dungeonHost)
    this.#veil = new PlaceVeil(this.#content)
    this.#message = element('div', 'sol-adventure-message', 'Talk to Mira by the path. She knows where the first triangle belongs.')
    this.#message.setAttribute('role', 'status')
    this.#message.setAttribute('aria-live', 'polite')
    root.append(bar, this.#content, this.#message, this.#touchControls())
    document.body.append(root)
    this.#root = root
    this.#mountSession()
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

  // (2) A2.2/M9's onEntrance/seat replace onEnter/onDungeon — this bridge maps
  // each entrance's OWN id to today's #enterLabyrinth/#enterDungeon, so the
  // island stays playable before Phase 3's real STORY-seated routing exists.
  // Temporary; deleted with the rest of this bridge in Phase 3.
  static readonly #WORLD_LABYRINTHS: Readonly<Record<string, string>> = { 'dawn-shrine': 'sunseed', 'tide-shrine': 'tideglass', 'pyramid-shrine': 'starbloom' }
  static readonly #WORLD_DUNGEON_INDEX: Readonly<Record<string, number>> = { 'wayfarer-cavern': 0, 'highland-cavern': 2 }
  #mountSession(): void {
    this.#world = new RpgOverworldView({
      has: requirement => this.journey.has(requirement),
      grantRelic: relic => {
        this.journey.grantRelic(relic)
        this.#recordRelic()
      },
      seat: id => id in SolomonLabyrinthOverlay.#WORLD_LABYRINTHS || id in SolomonLabyrinthOverlay.#WORLD_DUNGEON_INDEX,
      onEntrance: id => {
        const labyrinthId = SolomonLabyrinthOverlay.#WORLD_LABYRINTHS[id]
        if (labyrinthId) { void this.#enterLabyrinth(labyrinthId); return }
        const index = SolomonLabyrinthOverlay.#WORLD_DUNGEON_INDEX[id]
        if (index !== undefined) this.#enterDungeon(index)
      },
      onItems: () => this.#openJournal(),
      onMessage: message => { this.#say(message); this.#dirty = true },
      // (2)'s gain→today's-cache-dialog bridge: no GainScreen exists yet, so
      // the words just join every other status message; the view's own
      // dialog still does the actual showing.
      gain: request => { this.#say(request.words); this.#dirty = true },
    })
    this.#world.mount(this.#worldHost!)
    this.#roomView = new LabyrinthRoomView(this.#roomHost!, this.journey, id => this.#door(id))
    this.#inventoryKey = ''
    this.#updateInventory()
    this.#updateSaveStatus()
  }

  #button(label: string, action: () => void): HTMLButtonElement {
    const button = element('button', '', label) as HTMLButtonElement
    button.type = 'button'
    button.onclick = () => { this.#audio.unlock(); action() }
    return button
  }

  #touchControls(): HTMLElement {
    const bar = element('div', 'sol-adventure-touch')
    for (const [label, key] of [['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight'], ['Jump', ' '], ['Wand', 'z'], ['Use', 'e']]) {
      const button = this.#button(label, () => {})
      button.setAttribute('aria-label', label === 'Use' ? 'Interact or use passage' : label)
      button.onpointerdown = event => {
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        this.#keyDown(new KeyboardEvent('keydown', { key }))
      }
      const release = () => this.#keyUp(new KeyboardEvent('keyup', { key }))
      button.onpointerup = release
      button.onpointercancel = release
      button.onlostpointercapture = release
      bar.append(button)
    }
    return bar
  }

  async #enterLabyrinth(id: string): Promise<void> {
    if (!this.#root || this.#mode === 'loading' || !this.journey.canEnterLabyrinth(id)) return
    this.#save()
    this.#release()
    this.#closeJournal()
    this.#world?.closeDialog()
    const generation = ++this.#generation
    this.#mode = 'loading'
    this.#say('Opening the shrine’s chambers…')
    this.#root.setAttribute('aria-busy', 'true')
    try {
      this.#surface ??= createSolomonTileSurface([])
      // A labyrinth's linked destinations hydrate before play; a warp therefore
      // has no async simulation gap and always uses native destination cells.
      for (const definition of ROOMS.filter(room => room.labyrinthId === id)) {
        if (!this.#loaded.has(definition.id)) {
          const loaded = await this.#surface.ensureRoom(definition)
          if (generation !== this.#generation || !this.#root) return
          this.journey.replaceRoom(loaded.room)
          this.#loaded.set(definition.id, loaded)
        }
      }
      if (generation !== this.#generation || !this.#root) return
      if (!this.journey.enterLabyrinth(id) || !this.journey.room) throw new Error('This shrine is still missing a component.')
      this.#mode = 'room'
      const loaded = this.#loaded.get(this.journey.room.id)!
      const shrine = WORLD_SHRINES.find(place => place.labyrinthId === id)
      this.#warp(this.#world!.leaveLeg(shrine ?? this.#world!.model.player, 'in'), this.#roomView!.arriveLeg(loaded, 'in'), () => {
        this.#worldHost!.hidden = true
        this.#roomHost!.hidden = false
        this.#dungeonHost!.hidden = true
        this.#roomView!.show(loaded)
      })
      this.#say('Walk into a door to pass through it. Every door keeps the colour and shape of where it leads, and every room remembers your visit.')
      this.#acc = 0
      this.#dirty = true
      this.#save()
    } catch (error) {
      if (generation !== this.#generation || !this.#root) return
      this.#showWorld()
      this.#say(error instanceof Error ? error.message : 'The shrine could not open. Try it again from the world.')
    } finally {
      if (generation === this.#generation) this.#root?.removeAttribute('aria-busy')
    }
  }

  /** TOUCH TO PASS. Jaime, 2026-09-11: "you just have to touch the door or
   *  portal to go to the next level." Standing in an open door takes you
   *  through it — except the door you just arrived by, until you step off it
   *  and back on (the journey's arrival guard). A door you cannot open yet
   *  says what it needs, once per approach, and stays a door. E still works
   *  for anyone who reaches for it. */
  #lockedSaid = ''
  #passDoor(): void {
    const door = this.journey.nearDoor()
    if (!door) { this.#lockedSaid = ''; return }
    if (door.id === this.journey.arrivalDoor) return
    if (!this.journey.has(door.requires)) {
      if (this.#lockedSaid !== door.id) {
        this.#lockedSaid = door.id
        this.#say(`${describeRequirement(door.requires)} opens this door.`)
        this.#audio.tone({ freq: 220, endFreq: 180, dur: 0.14, vol: 0.05 })
      }
      return
    }
    this.#door(door.id)
  }

  #door(id?: string): void {
    if (this.#mode !== 'room') return
    const oldDepth = this.journey.room?.depth ?? 0
    const result = this.journey.useDoor(id)
    this.#say(result.message)
    if (result.kind !== 'travelled' || !this.journey.room) return
    const loaded = this.#loaded.get(this.journey.room.id)
    if (!loaded) { this.#showWorld(); this.#say('This passage has no loaded destination.'); return }
    const delta = this.journey.room.depth - oldDepth
    if (this.#veil) this.#roomView!.warp(this.#veil, loaded, delta < 0 ? 'out' : delta === 0 ? 'across' : 'in')
    else this.#roomView!.show(loaded)
    this.#release()
    this.#acc = 0
    this.#audio.tone({ freq: delta < 0 ? 660 : 440, endFreq: 880, dur: 0.22, vol: 0.07 })
    this.#dirty = true
    this.#save()
  }

  #enterDungeon(index: number): void {
    if (!this.#dungeonHost || this.#mode === 'loading') return
    this.#world?.closeDialog()
    this.#closeJournal()
    this.#release()
    this.journey.leave()
    const view = this.#getDungeon(index)
    this.#dungeon = view
    this.#mode = 'dungeon'
    const mouth = WORLD_DUNGEONS.find(place => place.levelIndex === index)
    this.#warp(this.#world?.leaveLeg(mouth ?? this.#world.model.player, 'in') ?? null, view.arriveLeg('in'), () => {
      for (const host of Array.from(this.#dungeonHost!.children) as HTMLElement[]) host.hidden = host.dataset['dungeon'] !== String(index)
      this.#worldHost!.hidden = this.#roomHost!.hidden = true
      this.#dungeonHost!.hidden = false
      view.refresh()
    })
    this.#say('Explore the passages. Read inscriptions and use what they teach you to attune the gates.')
    this.#save()
  }

  #getDungeon(index: number): ScrollDungeonView {
    let view = this.#dungeons.get(index)
    if (!view) {
      view = new ScrollDungeonView({
        index,
        has: requirement => this.journey.has(requirement),
        onMessage: message => this.#say(message),
        onKnowledge: (id, text) => { this.#knowledge.set(id, text); this.#dirty = true },
        onComplete: lore => {
          this.#knowledge.set(`dungeon-${index}`, lore)
          this.#showWorld()
          this.#say('Expedition complete. The discovery is recorded in your journal.')
        },
        onExit: () => this.#showWorld(),
      })
      const host = element('div', 'sol-adventure-expedition')
      host.dataset['dungeon'] = String(index)
      this.#dungeonHost!.append(host)
      view.mount(host)
      this.#dungeons.set(index, view)
    }
    return view
  }

  #showWorld(): void {
    if (!this.#root) return
    if (this.#restoring) { this.#afterRestore = 'world'; return }
    ++this.#generation
    this.#root.removeAttribute('aria-busy')
    this.#closeJournal()
    this.#closeSlots()
    this.#release()
    const leave = this.#mode === 'room' ? this.#roomView?.leaveLeg('out') ?? null
      : this.#mode === 'dungeon' ? this.#dungeon?.leaveLeg('out') ?? null : null
    this.journey.leave()
    this.#dungeon?.closeDialog()
    this.#dungeon = null
    this.#mode = 'world'
    this.#warp(leave, this.#world?.arriveLeg(this.#world.model.player, 'out') ?? null, () => {
      this.#worldHost!.hidden = false
      this.#roomHost!.hidden = this.#dungeonHost!.hidden = true
      this.#world?.refresh()
    })
    this.#save()
    this.#say('Explore the world, compare clues, and fill the shrines with the pieces you have found.')
  }

  /** Every change of place goes through the veil: the place on show zooms
   *  into (or shrinks back into) the entrance, and the next place resolves.
   *  Without a picture to leave from, or without a veil, the swap simply
   *  happens. */
  #warp(leave: VeilLeg | null, arrive: VeilLeg | null, swap: () => void): void {
    if (!this.#veil || !leave || !this.#content) { swap(); return }
    this.#veil.play({ leave, arrive: arrive ?? { element: this.#content, picture: null, origin: [0.5, 0.5], scale: 1 }, onSwap: swap })
  }

  showDesigner(): void {
    if (!this.#root || this.#designer) return
    if (this.#restoring) { this.#afterRestore = 'design'; return }
    this.#release()
    this.#veil?.cancel()
    this.#save()
    ++this.#generation
    this.#closeJournal()
    this.#closeSlots()
    this.#mode = 'design'
    this.#root.hidden = true
    this.#designer = new SolomonOverlay(() => {
      this.#designer?.unmount()
      this.#designer = null
      if (this.#root) { this.#root.hidden = false; this.#showWorld() }
    })
    this.#designer.mount()
    this.#designer.showDesigner()
  }

  #recordRelic(): void {
    const relic = this.journey.lastRelic
    if (!relic || relic.id === this.#lastRelic) return
    this.#lastRelic = relic.id
    if (relic.lore) this.#knowledge.set(relic.id, relic.lore)
    this.#say(relic.lore ?? 'A new piece joins your star. Its clue is in the journal.')
    this.#audio.tone({ freq: 660, endFreq: 990, dur: 0.24, vol: 0.06 })
    this.#dirty = true
    this.#updateInventory()
    if (this.journey.completed.has('starbloom')) this.#say('The Pyramid of Accord is open. You found its heart! Return to the world to revisit your discoveries.')
  }

  #updateInventory(): void {
    const inventory = this.journey.inventory
    const text = `▲ ${inventory.triangles.size}/6 · ⬡ ${inventory.hexagon ? '1' : '0'}/1 · ✡ ${inventory.star ? 'Complete' : 'Gathering'}`
    if (text === this.#inventoryKey) return
    this.#inventoryKey = text
    if (this.#inventory) { this.#inventory.textContent = text; this.#inventory.setAttribute('aria-label', `${inventory.triangles.size} of six triangles, ${inventory.hexagon ? 'central hexagon found' : 'central hexagon missing'}, star ${inventory.star ? 'complete' : 'incomplete'}`) }
    this.#world?.refresh()
  }

  #openJournal(): void {
    if (!this.#root || this.#mode === 'loading') return
    this.#release()
    this.#closeSlots()
    this.#world?.closeDialog()
    this.#dungeon?.closeDialog()
    this.#closeJournal()
    const backdrop = element('div', 'sol-adventure-journal')
    const dialog = element('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', 'Knowledge and sigils')
    dialog.tabIndex = -1
    dialog.append(element('h2', '', 'Knowledge & sigils'), element('p', '', 'Every piece is a permanent ability. Its story is a clue, too.'))
    const close = this.#button('Back to exploring', () => this.#closeJournal())
    dialog.append(close)
    for (const [key, lore] of Object.entries(RELIC_LORE)) {
      const owned = key === 'hexagon' ? this.journey.inventory.hexagon : key === 'star' ? this.journey.inventory.star : this.journey.inventory.triangles.has(Number(key.split(':').at(-1)))
      if (owned) dialog.append(element('h3', '', lore.title), element('p', '', lore.text))
    }
    for (const person of WORLD_PEOPLE) if (this.#world?.model.met.has(person.id)) dialog.append(element('h3', '', person.name), element('p', '', person.clue))
    for (const text of this.#knowledge.values()) dialog.append(element('p', 'sol-journal-note', text))
    if (!this.#knowledge.size && !this.journey.inventory.relicIds.size) dialog.append(element('p', '', 'Start by talking to the people you meet. Their observations help you reason out the way forward.'))
    backdrop.append(dialog)
    this.#root.append(backdrop)
    this.#journal = backdrop
    close.focus({ preventScroll: true })
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Tab') { event.preventDefault(); close.focus() }
    })
  }

  #closeJournal(): void { this.#journal?.remove(); this.#journal = null }
  #say(message: string): void { if (this.#message) this.#message.textContent = message }

  #release = (): void => {
    this.#input.up = this.#input.down = this.#input.left = this.#input.right = false
    const engine = this.journey.engine
    if (engine) engine.input.left = engine.input.right = engine.input.down = engine.input.jump = false
  }

  #visibility = (): void => { this.#release(); if (document.hidden) this.#save() }

  #keyDown = (event: KeyboardEvent): void => {
    if (!this.#root || this.#mode === 'design' || event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'escape') {
      event.preventDefault(); event.stopImmediatePropagation()
      if (this.#slotPanel) this.#closeSlots()
      else if (this.#journal) this.#closeJournal()
      else if (this.#world?.isDialogOpen) this.#world.closeDialog()
      else if (this.#dungeon?.isDialogOpen) this.#dungeon.closeDialog()
      else if (this.#world?.dismiss() || this.#dungeon?.dismiss()) { /* a question put away; play goes on */ }
      else if (this.#mode !== 'world') this.#showWorld()
      else this.onClose()
      return
    }
    if (this.#slotPanel || this.#journal || this.#world?.isDialogOpen || this.#dungeon?.isDialogOpen) {
      if (key === 'e' && !event.repeat && !this.#slotPanel) {
        // E opened the conversation, so E puts it away again.
        event.preventDefault(); event.stopImmediatePropagation()
        if (this.#journal) this.#closeJournal()
        else if (this.#world?.isDialogOpen) this.#world.closeDialog()
        else this.#dungeon?.closeDialog()
        return
      }
      // Keep movement and hive shortcuts out of an encounter, while preserving
      // keyboard activation and focus navigation for its real DOM controls.
      const dialog = this.#root.querySelector<HTMLElement>('[role="dialog"]')
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
      event.stopImmediatePropagation()
      return
    }
    if (!KEYS.has(key)) return
    if ((key === 'enter' || key === ' ') && event.target instanceof HTMLButtonElement) return
    event.preventDefault(); event.stopImmediatePropagation()
    this.#audio.unlock()
    if (this.#mode === 'loading') return
    if (key === 'm') { this.#showWorld(); return }
    if (key === 'e' || key === 'enter') {
      if (event.repeat) return
      this.#release()
      if (this.#mode === 'world') this.#world?.interact()
      else if (this.#mode === 'dungeon') this.#dungeon?.interact()
      else this.#door()
      return
    }
    const left = key === 'arrowleft' || key === 'a', right = key === 'arrowright' || key === 'd'
    const up = key === 'arrowup' || key === 'w', down = key === 'arrowdown' || key === 's'
    if (left) this.#input.left = true
    if (right) this.#input.right = true
    if (up) this.#input.up = true
    if (down) this.#input.down = true
    if (this.#mode === 'world' && !event.repeat && (key === 'z' || key === 'j')) { this.#world?.cast(); return }
    const engine = this.journey.engine
    if (this.#mode !== 'room' || !engine) return
    if (left) engine.input.left = true
    if (right) engine.input.right = true
    if (down) engine.input.down = true
    if (up || key === ' ') engine.input.jump = true
    if (!event.repeat && (key === 'z' || key === 'j')) engine.cast()
    if (!event.repeat && (key === 'x' || key === 'k')) engine.fireball()
    if (!event.repeat && key === 'r') this.journey.retryCurrent()
  }

  #keyUp = (event: KeyboardEvent): void => {
    if (this.#mode === 'design') return
    const key = event.key.toLowerCase()
    const engine = this.journey.engine
    if (key === 'arrowleft' || key === 'a') { this.#input.left = false; if (engine) engine.input.left = false }
    if (key === 'arrowright' || key === 'd') { this.#input.right = false; if (engine) engine.input.right = false }
    if (key === 'arrowup' || key === 'w' || key === ' ') { this.#input.up = false; if (engine) engine.input.jump = false }
    if (key === 'arrowdown' || key === 's') { this.#input.down = false; if (engine) engine.input.down = false }
    if (KEYS.has(key)) event.stopPropagation()
  }

  #loop = (ts: number): void => {
    if (!this.#root) return
    const dt = this.#lastTs ? Math.min((ts - this.#lastTs) / 1000, 0.05) : 0
    this.#lastTs = ts
    this.#time += dt
    if (!document.hidden && !this.#journal && !this.#slotPanel) {
      // While the veil plays, the places hold still: nothing moves on a
      // world that is zooming into an entrance.
      const warping = !!this.#veil?.playing
      if (this.#mode === 'world' && !warping) this.#world?.update(dt, this.#input)
      if (this.#mode === 'dungeon' && !warping) this.#dungeon?.update(dt, this.#input)
      if (this.#mode === 'room') {
        if (!warping) {
          this.#acc += dt
          while (this.#acc >= SIM_DT) { this.journey.update(SIM_DT); this.#acc -= SIM_DT }
          this.#recordRelic()
          this.#passDoor()
        }
        this.#roomView?.render(this.#time)
      }
    }
    this.#updateInventory()
    if (this.#time >= this.#saveAt) { this.#saveAt = this.#time + 1; this.#save() }
    this.#raf = requestAnimationFrame(this.#loop)
  }

  #snapshot(): unknown {
    return {
      version: 2, journey: this.journey.exportState(), world: this.#world!.exportState(),
      knowledge: [...this.#knowledge], dungeons: [...this.#dungeons].map(([index, view]) => [index, view.exportState()]),
      location: { mode: this.#mode, dungeon: [...this.#dungeons].find(([, view]) => view === this.#dungeon)?.[0] ?? null },
    }
  }

  #save = (): boolean => {
    if (!this.#world || !this.#slots || this.#restoring || this.#restoreFailed || this.#mode === 'loading' || this.#mode === 'design') return false
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

  #readKnowledge(value: unknown): void {
    if (!Array.isArray(value)) return
    for (const pair of value.slice(0, 256)) {
      if (Array.isArray(pair) && pair.length === 2 && pair.every(item => typeof item === 'string' && item.length <= 4000)) this.#knowledge.set(pair[0], pair[1])
    }
  }

  async #restoreSlot(): Promise<void> {
    if (!this.#slots || !this.#world) return
    const save = record(this.#slots.read())
    this.#restoreFailed = false
    this.#lastSaved = ''
    if (!save) { this.#save(); this.#updateSaveStatus(); return }
    if (save['version'] === 1) {
      this.journey.restoreProgress(save['progress'])
      this.#world.restoreState({ version: 1, filledSockets: save['sockets'], met: save['met'], solved: save['solved'] })
      this.#readKnowledge(save['knowledge'])
      this.#updateInventory()
      this.#save()
      return
    }
    if (save['version'] !== 2 || !record(save['journey']) || !record(save['world'])) {
      this.#restoreFailed = true
      this.#updateSaveStatus()
      this.#say('This slot could not be read. Its saved adventure has been kept.')
      return
    }
    const generation = ++this.#generation
    this.#restoring = true
    this.#mode = 'loading'
    this.#root?.setAttribute('aria-busy', 'true')
    this.#say(`Continuing Slot ${this.#slots.activeSlot}…`)
    try {
      const state = record(save['journey'])!
      // Permanent discoveries need no native room, so they show at once. The
      // full restore below re-applies them once the chambers have hydrated.
      this.journey.restoreProgress(state['progress'])
      this.#world.restoreState(save['world'])
      this.#readKnowledge(save['knowledge'])
      this.#updateInventory()
      const ids = new Set(Array.isArray(state['roomIds']) ? state['roomIds'].filter((id): id is string => typeof id === 'string') : [])
      const labyrinths = new Set(ROOMS.filter(room => ids.has(room.id) || room.id === state['activeRoomId']).map(room => room.labyrinthId))
      for (const definition of ROOMS.filter(room => labyrinths.has(room.labyrinthId))) {
        let loaded = this.#loaded.get(definition.id)
        if (!loaded) {
          this.#surface ??= createSolomonTileSurface([])
          loaded = await this.#surface.ensureRoom(definition)
          if (generation !== this.#generation || !this.#root) return
          this.#loaded.set(definition.id, loaded)
        }
        this.journey.replaceRoom(loaded.room)
      }
      this.journey.restoreState(state)
      this.#world.restoreState(save['world'])
      this.#readKnowledge(save['knowledge'])
      if (Array.isArray(save['dungeons'])) for (const pair of save['dungeons'].slice(0, 2)) {
        if (Array.isArray(pair) && (pair[0] === 0 || pair[0] === 2)) this.#getDungeon(pair[0]).restoreState(pair[1])
      }
      const location = record(save['location'])
      this.#mode = 'world'
      if (location?.['mode'] === 'room' && this.journey.room) {
        const loaded = this.#loaded.get(this.journey.room.id)
        if (loaded) {
          this.#mode = 'room'
          this.#worldHost!.hidden = this.#dungeonHost!.hidden = true
          this.#roomHost!.hidden = false
          this.#roomView!.show(loaded)
        }
      } else if (location?.['mode'] === 'dungeon' && (location['dungeon'] === 0 || location['dungeon'] === 2)) this.#enterDungeon(location['dungeon'])
      else this.journey.leave()
      if (this.#mode === 'world') {
        this.#worldHost!.hidden = false
        this.#roomHost!.hidden = this.#dungeonHost!.hidden = true
      }
      this.#lastRelic = ''
      this.#updateInventory()
      this.#lastSaved = JSON.stringify(this.#snapshot())
      this.#say(`Slot ${this.#slots.activeSlot} continued. Your progress saves automatically.`)
    } catch (error) {
      if (generation !== this.#generation || !this.#root) return
      this.#restoreFailed = true
      this.#mode = 'world'
      this.#say(`Could not continue this slot. ${error instanceof Error ? error.message : 'Try again from Saves.'} Your saved adventure has been kept.`)
    } finally {
      if (generation === this.#generation) {
        this.#restoring = false
        this.#root?.removeAttribute('aria-busy')
        this.#updateSaveStatus()
        // World and Designer wait for a pending continue: interrupting it would
        // strand a half-restored adventure that never saves again.
        const request = this.#afterRestore
        this.#afterRestore = null
        if (request === 'design') this.showDesigner()
        else if (request === 'world' && !this.#restoreFailed) this.#showWorld()
      }
    }
  }

  #updateSaveStatus(): void {
    if (this.#slotButton) this.#slotButton.textContent = `Saves · ${this.#slots?.activeSlot ?? 1}`
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
    if (!this.#root || !this.#slots || this.#mode === 'loading') return
    this.#release()
    this.#world?.closeDialog(); this.#dungeon?.closeDialog(); this.#closeJournal()
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
      const payload = record(this.#slots.read(slot.id)), journey = record(payload?.['journey']), progress = record(journey?.['progress'] ?? payload?.['progress'])
      const pieces = Array.isArray(progress?.['relicIds']) ? progress['relicIds'].length : 0
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
    ++this.#generation
    this.#restoring = this.#restoreFailed = false
    this.#release()
    this.#veil?.cancel()
    this.#world?.dispose(); this.#roomView?.dispose()
    for (const dungeon of this.#dungeons.values()) dungeon.dispose()
    this.#dungeons.clear(); this.#knowledge.clear()
    this.#dungeon = null
    this.#worldHost!.replaceChildren(); this.#roomHost!.replaceChildren(); this.#dungeonHost!.replaceChildren()
    this.journey = new LabyrinthJourney()
    for (const loaded of this.#loaded.values()) this.journey.replaceRoom(loaded.room)
    this.#mode = 'world'
    this.#worldHost!.hidden = false
    this.#roomHost!.hidden = this.#dungeonHost!.hidden = true
    this.#root?.removeAttribute('aria-busy')
    this.#lastRelic = this.#lastSaved = ''
    this.#acc = 0
    this.#mountSession()
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
    this.#say(`Slot ${id} reset. Your new adventure saves automatically.`)
  }

  unmount(): void {
    ++this.#generation
    this.#save()
    this.#release()
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    window.removeEventListener('keydown', this.#keyDown, true)
    window.removeEventListener('keyup', this.#keyUp, true)
    window.removeEventListener('blur', this.#release)
    document.removeEventListener('visibilitychange', this.#visibility)
    window.removeEventListener('pagehide', this.#save)
    this.#designer?.unmount()
    this.#designer = null
    this.#veil?.dispose()
    this.#veil = null
    this.#world?.dispose()
    this.#roomView?.dispose()
    for (const dungeon of this.#dungeons.values()) dungeon.dispose()
    this.#dungeons.clear()
    this.#audio.dispose()
    this.#root?.remove()
    this.#root = null
    this.#oldFocus?.focus({ preventScroll: true })
  }
}

const ADVENTURE_CSS = `
.sol-adventure{position:fixed;inset:0;z-index:2147483000;background:radial-gradient(ellipse at 65% 15%,#30496a,#15273f 70%);color:#f0f2f7;display:flex;flex-direction:column;font:14px system-ui,sans-serif;overflow:hidden;color-scheme:dark}
.sol-adventure [hidden],.sol-adventure[hidden]{display:none!important}.sol-adventure *{box-sizing:border-box}.sol-adventure button{font:inherit;color:inherit;cursor:pointer}
.sol-adventure button:focus-visible{outline:2px solid #ffdc96;outline-offset:3px}.sol-adventure-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid #a3bedb26;background:#12223677}
.sol-adventure-bar strong{font-size:16px;white-space:nowrap}.sol-adventure-bar button,.sol-adventure-touch button{border:1px solid #9ab2d24d;background:#4b658b33;padding:7px 11px;border-radius:7px;font-size:12px}.sol-adventure-bar button:hover{background:#6186aa66}
.sol-adventure-inventory{margin-right:auto;margin-left:15px;white-space:nowrap;font-size:12px;color:#edce95;font-variant-numeric:tabular-nums}
.sol-save-status{font-size:10px;color:#afc6b9}.sol-save-backdrop{position:absolute;inset:0;z-index:30;display:grid;place-items:center;background:#071624a8;padding:14px}.sol-save-panel{width:min(100%,520px);max-height:100%;overflow:auto;border:1px solid #a9bdbb66;border-radius:14px;padding:22px;background:#1b303e;box-shadow:0 20px 70px #0006}.sol-save-panel h2{font-size:20px;margin:0 0 6px}.sol-save-panel>p{font-size:12px;color:#b9ccc6;line-height:1.5}.sol-save-panel button{border:1px solid #879d9755;border-radius:7px;padding:7px 11px;background:#36564e;font-size:12px}.sol-save-slot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;border:1px solid #819f963d;border-radius:9px;padding:12px;margin:12px 0}.sol-save-info{flex:1;min-width:180px}.sol-save-info strong,.sol-save-info small{display:block}.sol-save-info small{font-size:11px;color:#b5c9c2;margin-top:5px}.sol-save-reset-note{flex-basis:100%;margin:3px 0;font-size:12px;color:#f2cb93}.sol-save-error{color:#f2cb93!important}
.sol-adventure-content{position:relative;flex:1;min-height:0;padding:14px 24px;overflow:hidden}.sol-adventure-world,.sol-adventure-rooms,.sol-adventure-dungeon,.sol-adventure-expedition{height:100%;min-height:0}
.sol-adventure-message{min-height:38px;padding:8px 20px;border-top:1px solid #a3bedb22;text-align:center;font-size:12px;line-height:1.5;color:#dfd9bd;background:#14273d99}
.sol-adventure[aria-busy=true] .sol-adventure-content{opacity:.65;pointer-events:none}.sol-adventure-touch{display:none;justify-content:center;gap:8px;padding:8px;touch-action:none;background:#162a42}
.sol-adventure-journal{position:absolute;inset:0;z-index:20;display:grid;place-items:center;background:#071624b8;padding:30px}.sol-adventure-journal section{background:#f6f0df;color:#29394a;border:1px solid #fceac5;border-radius:16px;padding:26px 32px;max-width:660px;max-height:100%;overflow:auto;box-shadow:0 25px 80px #05142588}.sol-adventure-journal h2{margin-top:0}.sol-adventure-journal h3{margin:24px 0 7px;color:#706048;font-size:15px}.sol-adventure-journal p{line-height:1.65}.sol-adventure-journal button{background:#264b60;border:0;border-radius:8px;color:#fff;padding:10px 15px}.sol-journal-note{border-left:3px solid #c7aa63;padding-left:13px}
@media(pointer:coarse){.sol-adventure-touch{display:flex}}@media(max-width:700px){.sol-adventure-bar{gap:6px;padding:9px 12px}.sol-adventure-bar strong{font-size:14px}.sol-adventure-inventory{font-size:10px;margin-left:5px}.sol-adventure-bar button{font-size:10px;padding:6px 8px}.sol-adventure-content{padding:10px}.sol-adventure-message{font-size:11px;padding:7px 12px}.sol-adventure-journal{padding:12px}.sol-adventure-journal section{padding:20px}.sol-adventure-touch{gap:5px}.sol-adventure-touch button{padding:8px}}
`
