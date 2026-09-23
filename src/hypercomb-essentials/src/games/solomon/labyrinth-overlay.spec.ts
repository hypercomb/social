// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { roomId, type RoomDef } from './labyrinth.js'
import { SolomonLabyrinthOverlay } from './labyrinth-overlay.js'
import { SAVE_SLOTS_KEY } from './save-slots.js'
import { type LoadedTileRoom } from './tile-surface.js'

const native = vi.hoisted(() => ({ ensure: vi.fn(), create: vi.fn() }))
vi.mock('./tile-surface.js', async importOriginal => {
  const real = await importOriginal<typeof import('./tile-surface.js')>()
  return { ...real, createSolomonTileSurface: native.create }
})
vi.mock('../audio.js', () => ({
  GameAudio: class {
    muted = true
    unlock(): void {}
    tone(): void {}
    noise(): void {}
    duck(): void {}
    toggleMuted(): boolean { return this.muted = !this.muted }
    startAmbience(): void {}
    stopAmbience(): void {}
    dispose(): void {}
  },
}))

function hydrate(definition: RoomDef): LoadedTileRoom {
  const room = structuredClone(definition)
  room.level.name = `Native ${definition.level.name}`
  const roomSegments = ['solomon-maze-v1', room.id]
  return {
    room, level: room.level, roomSegments,
    tiles: room.level.tiles.map((code, index) => {
      const col = index % room.level.cols, row = Math.floor(index / room.level.cols)
      const name = `cell-${String(col).padStart(2, '0')}-${String(row).padStart(2, '0')}`
      return { col, row, name, code, segments: [...roomSegments, name], layer: { name, solomonTile: { code } } }
    }),
  }
}

let time = 0, nextFrame = 0
const pendingFrames = new Map<number, FrameRequestCallback>()
const overlays = new Set<SolomonLabyrinthOverlay>()

function frame(): void {
  time += 50
  const callbacks = [...pendingFrames.values()]
  pendingFrames.clear()
  for (const callback of callbacks) callback(time)
}
function key(type: 'keydown' | 'keyup', value: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true }))
}
function tap(value: string): void { key('keydown', value); key('keyup', value) }
function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const result = [...root.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent?.trim() === label)
  expect(result, `button ${label}`).toBeTruthy()
  return result!
}
function marker(name: string): HTMLButtonElement {
  const result = document.querySelector<HTMLButtonElement>(`.sol-rpg-place[aria-label^="${name},"]`)
  expect(result, `marker ${name}`).toBeTruthy()
  return result!
}
function crumbs(): string[] {
  return [...document.querySelectorAll('.sol-crumb, .sol-crumb-here')].map(node => node.textContent ?? '')
}
/** Opens the game's menu from its corner icon and hands back one of its tiles. */
function menuTile(name: string): HTMLButtonElement {
  document.querySelector<HTMLButtonElement>('.sol-menu-open')!.click()
  const tile = [...document.querySelectorAll<HTMLButtonElement>('.sol-menu-tile')].find(candidate => candidate.dataset['name'] === name)
  expect(tile, `menu tile ${name}`).toBeTruthy()
  return tile!
}
function mount(): SolomonLabyrinthOverlay {
  let overlay: SolomonLabyrinthOverlay
  overlay = new SolomonLabyrinthOverlay(() => overlay.unmount())
  overlays.add(overlay)
  overlay.mount()
  frame()
  return overlay
}
/** A gain screen fires automatically for Mira's own reward (rpg-overworld.ts
 *  already calls `hooks.gain(...)` for a person's reward, unchanged from
 *  Phase 1) — closed here so the world's own dialog is the next thing E
 *  reaches, exactly like a player clicking the card's own × would do. */
function closeGainIfOpen(): void {
  const card = document.querySelector<HTMLElement>('.sol-gain')
  if (card && !card.hidden) card.querySelector<HTMLButtonElement>('.sol-gain-close')!.click()
}
function solveMira(): void {
  marker('Mira').click()
  expect(document.querySelector('.sol-rpg-clue')?.textContent).toContain('sunrise')
  button('East, toward sunrise').click()
  closeGainIfOpen()
  tap('e')
}
function walk(value: string, frames: number): void {
  key('keydown', value)
  for (let i = 0; i < frames; i++) frame()
  key('keyup', value)
}
/** The lake blocks the direct western route; follow the map's clear path. */
function walkToDawn(): void {
  walk('ArrowRight', 19)
  walk('ArrowUp', 38)
}
function fillDawn(): void {
  walkToDawn()
  marker('Dawn Shrine').click()
  const socket = document.querySelector<HTMLButtonElement>('.sol-rpg-socket')!
  expect(socket.disabled).toBe(false)
  socket.click()
  expect(document.querySelector('.sol-rpg-dialog')).toBeNull()
}
/** Once Dawn Shrine is open it is a portal (D1: E/Enter never enter a
 *  push-entrance — only a completed push or a click on its marker does), so
 *  entering it from the tests means clicking its marker again. */
function enterDawnShrine(): void { marker('Dawn Shrine').click() }
async function settle(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve() }
async function enterSunseed(): Promise<void> {
  solveMira()
  fillDawn()
  enterDawnShrine()
  await settle()
  frame()
}
/** The grove is walked into (an area has no marker): east along the valley floor, then north into its trees. */
async function enterGrove(): Promise<void> {
  walk('ArrowRight', 46)
  walk('ArrowUp', 52)
  await settle()
  frame()
}
function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(SAVE_SLOTS_KEY)!).slots[1].payload
}

beforeEach(() => {
  localStorage.clear()
  time = nextFrame = 0
  pendingFrames.clear()
  native.ensure.mockReset().mockImplementation(async (room: RoomDef) => hydrate(room))
  native.create.mockReset().mockImplementation(() => ({ ensureRoom: native.ensure }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pendingFrames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingFrames.delete(id))
})

afterEach(() => {
  for (const overlay of overlays) if (overlay.isMounted()) overlay.unmount()
  overlays.clear()
  pendingFrames.clear()
  document.body.replaceChildren()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the path shell', () => {
  it('mounts on the island, one breadcrumb deep', () => {
    const overlay = mount()
    expect(crumbs()).toEqual(['The Sevenfold Valley'])
    expect(document.querySelector('.sol-rpg-map')).not.toBeNull()
    expect(overlay.journey.room).toBeNull()
  })

  it('solves Mira, fills the Dawn Shrine, and pushes into its labyrinth — deepening the path and hydrating native rooms', async () => {
    const overlay = mount()
    await enterSunseed()
    expect(overlay.journey.room?.id).toBe(roomId('sunseed', 'porch'))
    expect(native.ensure).toHaveBeenCalledTimes(4)
    expect(crumbs()).toEqual(['The Sevenfold Valley', 'A labyrinth'])
    expect(document.querySelector('.sol-room-caption')?.textContent).toContain('Native The Sun Porch')
  })

  it('says why a shrine cannot open while the hive’s tiles are not ready, and the next push tries again', async () => {
    // Once for the story add-ons the opening reads, once for the push.
    const notReady = (): never => { throw new Error('Hypercomb tiles are not ready yet; reopen Solomon’s Key when the hive has loaded') }
    native.create.mockImplementationOnce(notReady).mockImplementationOnce(notReady)
    const overlay = mount()
    await enterSunseed()
    expect(overlay.journey.room).toBeNull()
    expect(document.querySelector('.sol-adventure')?.hasAttribute('aria-busy')).toBe(false)
    expect(document.querySelector('.sol-adventure')?.textContent).toContain('Hypercomb tiles are not ready yet')
    enterDawnShrine()
    await settle()
    frame()
    expect(overlay.journey.room?.id).toBe(roomId('sunseed', 'porch'))
  })

  it('shows the story’s next step on the place card, and moves it on as the story does', () => {
    mount()
    const next = (): string => document.querySelector('.sol-card-next')?.textContent ?? ''
    for (let i = 0; i < 12; i++) frame()
    expect(next()).toMatch(/Mira/)
    solveMira()
    for (let i = 0; i < 12; i++) frame()
    expect(next()).toMatch(/Dawn Shrine/)
  })

  it('keeps nothing outside the land, and opens its menu — a locked hive of tiles — from the corner or Escape', () => {
    const overlay = mount()
    const menu = (): HTMLElement => document.querySelector<HTMLElement>('.sol-menu')!
    expect(document.querySelector('.sol-adventure-bar')).toBeNull()
    expect(menu().hidden).toBe(true)
    tap('Escape')
    expect(menu().hidden).toBe(false)
    expect([...document.querySelectorAll<HTMLButtonElement>('.sol-menu-tile')].map(tile => tile.dataset['name']))
      .toEqual(['Continue', 'Items', 'Island', 'Saves', 'Sound', 'Full screen', 'Designer', 'Close'])
    expect(menu().querySelector('.sol-crumbs')).not.toBeNull()
    tap('Escape')
    expect(menu().hidden).toBe(true)
    menuTile('Continue').click()
    expect(menu().hidden).toBe(true)
    menuTile('Close').click()
    expect(overlay.isMounted()).toBe(false)
  })

  it('comes back out with the right button, as in a hive, and a panel entered from the menu backs out to the menu', async () => {
    mount()
    await settle()
    const menu = (): HTMLElement => document.querySelector<HTMLElement>('.sol-menu')!
    const items = (): HTMLElement => document.querySelector<HTMLElement>('.sol-items')!
    const rightClick = (target: Element): boolean =>
      !target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    expect(rightClick(document.querySelector('.sol-adventure-content')!)).toBe(true)
    expect(menu().hidden).toBe(false)
    menu().click()
    expect(menu().hidden).toBe(true)
    menuTile('Items').click()
    expect(items().hidden).toBe(false)
    expect(menu().hidden).toBe(true)
    rightClick(items())
    expect(items().hidden).toBe(true)
    expect(menu().hidden).toBe(false)
    rightClick(menu())
    expect(menu().hidden).toBe(true)
    tap('i')
    expect(items().hidden).toBe(false)
    rightClick(items())
    expect(items().hidden).toBe(true)
    expect(menu().hidden).toBe(true)
  })

  it('answers the right button through the hive’s one BackGesture, scoped to the game, never a second listener', async () => {
    type Entry = { owner: string; back: () => void; within?: () => Element | null }
    let entry: Entry | undefined
    const off = vi.fn()
    vi.stubGlobal('ioc', {
      get: (key: string) => key === '@diamondcoreprocessor.com/BackGesture'
        ? { register: (registered: Entry) => { entry = registered; return off } }
        : undefined,
    })
    const overlay = mount()
    await settle()
    const root = document.querySelector('.sol-adventure')!
    expect(entry?.within?.()).toBe(root)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    root.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.querySelector<HTMLElement>('.sol-menu')!.hidden).toBe(true)
    entry!.back()
    expect(document.querySelector<HTMLElement>('.sol-menu')!.hidden).toBe(false)
    overlay.unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('crosses a door by touching it, and the menu’s Island tile surfaces straight back to the island mid-labyrinth', async () => {
    const overlay = mount()
    await enterSunseed()
    overlay.engine!.arrive(overlay.journey.room!.relics[0])
    frame()
    closeGainIfOpen() // the touch-picked sigil piece is a reveal too (M2/A5.5) — the loop pauses under it
    const deeper = overlay.journey.room!.doors.find(door => door.id === 'deeper')!
    // The sigil is held, but the way on waits for the room's key: touching
    // the door says so and stays a door.
    overlay.engine!.arrive(deeper)
    frame()
    expect(overlay.journey.room?.id).toBe(roomId('sunseed', 'porch'))
    expect(overlay.journey.canPass(deeper)).toBe(false)
    overlay.engine!.arrive(overlay.engine!.items.find(item => item.kind === 'key')!)
    frame()
    overlay.engine!.arrive(deeper)
    frame()
    expect(overlay.journey.room?.id).toBe(roomId('sunseed', 'steps'))
    menuTile('Island').click()
    frame()
    expect(crumbs()).toEqual(['The Sevenfold Valley'])
    expect(document.querySelector('.sol-rpg-map')).not.toBeNull()
  })

  it('lets a patch of open air in the Sun Porch lead into another place: it shows where, and stepping in goes there', async () => {
    const overlay = mount()
    await enterSunseed()
    // The story seats the Hollow Grove behind the porch's top-right corner:
    // the square wears a window onto it before anyone steps in.
    expect(document.querySelectorAll('.sol-passage.sol-seated').length).toBe(2)
    overlay.engine!.arrive({ col: 14, row: 2 })
    frame()
    frame()
    expect(crumbs().length).toBe(3)
    expect(crumbs()[2]).toContain('Hollow Grove')
  })

  it('pushes into a cavern chamber from the island, and a crumb click returns to the island', () => {
    mount()
    walk('ArrowRight', 24)
    marker('Wayfarer Cavern').click()
    frame()
    expect(crumbs().length).toBe(2)
    expect(crumbs()[0]).toBe('The Sevenfold Valley')
    expect(crumbs()[1]).toContain('Wet Steps')
    button(crumbs()[0]).click()
    frame()
    expect(crumbs()).toEqual(['The Sevenfold Valley'])
  })
})

describe('combat skills reach the shell through the one GainScreen and ItemsTable (M2/M3/M4)', () => {
  it('reveals a fresh stele through the GainScreen, and Escape closes it without leaving the room (M3)', async () => {
    const overlay = mount()
    await enterSunseed()
    overlay.engine!.arrive({ col: 3, row: 10 }) // the Stele of the Stand, one tile from spawn
    frame()
    tap('e')
    expect(document.querySelector<HTMLElement>('.sol-gain')?.hidden).toBe(false)
    expect(document.querySelector('.sol-gain-eyebrow')?.textContent).toBe('A COMBAT SKILL')
    expect(document.querySelector('.sol-gain-title')?.textContent).toBe('The Stand')
    expect(overlay.journey.kit.includes('stand')).toBe(true)
    key('keydown', 'Escape')
    expect(document.querySelector<HTMLElement>('.sol-gain')?.hidden).toBe(true)
    expect(overlay.journey.room?.id, 'Escape closed the card, not the room (M3)').toBe(roomId('sunseed', 'porch'))
  })

  it('reading an already-learned stele again prints its words to the status line instead of reopening the card', async () => {
    const overlay = mount()
    await enterSunseed()
    overlay.engine!.arrive({ col: 3, row: 10 })
    frame()
    tap('e')
    key('keydown', 'Escape')
    tap('e')
    expect(document.querySelector<HTMLElement>('.sol-gain')?.hidden).toBe(true)
    expect(document.querySelector('.sol-adventure-message')?.textContent).toContain('Meet what')
  })

  it('closes an open GainScreen on every navigation path, including the menu’s Island tile (M25)', async () => {
    const overlay = mount()
    await enterSunseed()
    overlay.engine!.arrive({ col: 3, row: 10 })
    frame()
    tap('e')
    expect(document.querySelector<HTMLElement>('.sol-gain')?.hidden).toBe(false)
    menuTile('Island').click()
    frame()
    expect(document.querySelector<HTMLElement>('.sol-gain')?.hidden).toBe(true)
    expect(crumbs()).toEqual(['The Sevenfold Valley'])
    expect(overlay.journey.kit.includes('stand')).toBe(true)
  })

  it('closes an open GainScreen on the breadcrumb path too (M25)', async () => {
    const overlay = mount()
    await enterSunseed()
    overlay.engine!.arrive({ col: 3, row: 10 })
    frame()
    tap('e')
    expect(document.querySelector<HTMLElement>('.sol-gain')?.hidden).toBe(false)
    button(crumbs()[0]).click() // the island crumb, not a keyboard path
    frame()
    expect(document.querySelector<HTMLElement>('.sol-gain')?.hidden).toBe(true)
    expect(crumbs()).toEqual(['The Sevenfold Valley'])
    expect(overlay.journey.kit.includes('stand')).toBe(true)
  })

  it('opens the Items table with I and closes it with Escape', async () => {
    mount()
    tap('i')
    expect(document.querySelector<HTMLElement>('.sol-items')?.hidden).toBe(false)
    key('keydown', 'Escape')
    expect(document.querySelector<HTMLElement>('.sol-items')?.hidden).toBe(true)
  })

  it('equips a freshly-learned weapon from the Items table, and the shell confirms it in one line (M4)', async () => {
    const overlay = mount()
    await enterSunseed()
    overlay.engine!.arrive(overlay.journey.room!.relics[0])
    frame()
    closeGainIfOpen()
    overlay.engine!.arrive(overlay.engine!.items.find(item => item.kind === 'key')!)
    frame()
    overlay.engine!.arrive(overlay.journey.room!.doors.find(door => door.id === 'deeper')!)
    frame()
    expect(overlay.journey.room?.id).toBe(roomId('sunseed', 'steps'))
    overlay.engine!.arrive({ col: 8, row: 2 }) // the chest that gives the Sickle of the Sun, on the high ledge
    frame()
    tap('e')
    expect(document.querySelector('.sol-gain-title')?.textContent).toBe('Sickle of the Sun')
    key('keydown', 'Escape')
    tap('i')
    const panel = document.querySelector<HTMLElement>('.sol-items-panel')!
    panel.querySelector<HTMLButtonElement>('.sol-items-tab[data-tab="items"]')!.click()
    const row = panel.querySelector<HTMLElement>('li[data-id="skill:sickle"]')!
    const equip = row.querySelector<HTMLButtonElement>('.sol-items-use')!
    expect(equip.textContent).toBe('Equip')
    equip.click()
    expect(overlay.journey.weapon).toBe('sickle')
    expect(document.querySelector('.sol-adventure-message')?.textContent).toBe('Sickle of the Sun equipped.')
    const refreshedRow = panel.querySelector<HTMLElement>('li[data-id="skill:sickle"]')!
    expect(refreshedRow.querySelector('.sol-items-equipped')?.textContent).toBe('Equipped')
    expect(refreshedRow.querySelector('.sol-items-use')).toBeNull()
  })

  it('lists a learned ability under Knowledge once the labyrinth/skill: ref holds (StoryFacts.done)', async () => {
    const overlay = mount()
    await enterSunseed()
    overlay.engine!.arrive({ col: 3, row: 10 })
    frame()
    tap('e')
    key('keydown', 'Escape')
    expect(overlay.journey.kit.includes('stand')).toBe(true)
    tap('i')
    const panel = document.querySelector<HTMLElement>('.sol-items-panel')!
    panel.querySelector<HTMLButtonElement>('.sol-items-tab[data-tab="knowledge"]')!.click()
    const knowledge = panel.querySelector<HTMLElement>('.sol-items-section[data-tab="knowledge"]')!
    expect(knowledge.textContent).toContain('The Stand')
  })
})

describe('saves v3 carry the labyrinth and the path across a reopen', () => {
  it('keeps the restored path, learned skills and equipped weapon after close and reopen', async () => {
    const first = mount()
    await enterSunseed()
    first.engine!.arrive({ col: 3, row: 10 })
    frame()
    tap('e')
    key('keydown', 'Escape')
    first.unmount()
    expect(pendingFrames.size).toBe(0)
    expect(stored()['version']).toBe(3)

    const second = mount()
    await settle()
    frame()
    expect(second.journey.room?.id).toBe(roomId('sunseed', 'porch'))
    expect(second.journey.kit.includes('stand')).toBe(true)
    expect(crumbs()).toEqual(['The Sevenfold Valley', 'A labyrinth'])
  })

  it('reopens on the island with Mira met, the shrine filled and Dana where she stood', async () => {
    const first = mount()
    solveMira()
    fillDawn()
    walk('ArrowDown', 4)
    const stoodAt = document.querySelector<HTMLElement>('.sol-rpg-player')!.style.left
    first.unmount()
    const island = () => (stored()['places'] as [string, Record<string, unknown>][]).find(([place]) => place === 'island')![1]
    const before = island()
    expect(before['met']).toEqual(['mira'])
    expect(before['filledSockets']).toEqual(['dawn-shrine:0'])

    const second = mount()
    await settle()
    frame()
    // She stands where she stood, not at the island's start.
    expect(document.querySelector<HTMLElement>('.sol-rpg-player')!.style.left).toBe(stoodAt)
    // And a step, which saves the live island over the slot, keeps it all.
    walk('ArrowDown', 1)
    second.unmount()
    const after = island()
    expect(after['met']).toEqual(['mira'])
    expect(after['filledSockets']).toEqual(['dawn-shrine:0'])
    expect(after['player']).toEqual(before['player'])
  })

  it('comes out of a labyrinth with Escape and goes back in at the room she left, before and after a reopen', async () => {
    const first = mount()
    await enterSunseed()
    first.engine!.arrive(first.journey.room!.relics[0])
    frame()
    closeGainIfOpen()
    first.engine!.arrive(first.engine!.items.find(item => item.kind === 'key')!)
    frame()
    first.engine!.arrive(first.journey.room!.doors.find(door => door.id === 'deeper')!)
    frame()
    expect(first.journey.room?.id).toBe(roomId('sunseed', 'steps'))
    const relics = [...first.journey.inventory.relicIds]
    key('keydown', 'Escape')
    for (let i = 0; i < 30; i++) frame()
    expect(crumbs()).toEqual(['The Sevenfold Valley'])
    enterDawnShrine()
    await settle()
    frame()
    expect(first.journey.room?.id).toBe(roomId('sunseed', 'steps'))
    expect([...first.journey.inventory.relicIds]).toEqual(relics)
    key('keydown', 'Escape')
    for (let i = 0; i < 30; i++) frame()
    first.unmount()

    const second = mount()
    await settle()
    frame()
    enterDawnShrine()
    await settle()
    frame()
    expect(second.journey.room?.id).toBe(roomId('sunseed', 'steps'))
    expect([...second.journey.inventory.relicIds]).toEqual(relics)
  })

  it('seats the worked story add-on: the Greenwood’s signpost at the gate leads up onto the Mossback', async () => {
    mount()
    await settle()
    await enterGrove()
    // The walk in carries her a little past the signpost at the gate. A seated
    // thing keeps its verb (a sign is read), and is entered by pushing into it:
    // back down beside it, then push west into it.
    walk('ArrowDown', 5)
    walk('ArrowLeft', 14)
    await settle()
    frame()
    expect(crumbs()).toEqual(['The Sevenfold Valley', 'The Greenwood', 'The Mossback'])
  })

  it('reopens inside a world within the world, where she stood', async () => {
    const first = mount()
    await enterGrove()
    expect(crumbs()).toEqual(['The Sevenfold Valley', 'The Greenwood'])
    walk('ArrowRight', 6)
    const stoodAt = document.querySelector<HTMLElement>('.sol-rpg-player')!.style.left
    first.unmount()
    const payload = stored()
    expect((payload['path'] as { place: string }[]).map(step => step.place)).toEqual(['island', 'greenwood'])

    mount()
    await settle()
    frame()
    expect(crumbs()).toEqual(['The Sevenfold Valley', 'The Greenwood'])
    expect(document.querySelector<HTMLElement>('.sol-rpg-player')!.style.left).toBe(stoodAt)
  })

  it('reopens in a labyrinth room deeper than the porch, in that room', async () => {
    const first = mount()
    await enterSunseed()
    first.engine!.arrive(first.journey.room!.relics[0])
    frame()
    closeGainIfOpen()
    first.engine!.arrive(first.engine!.items.find(item => item.kind === 'key')!)
    frame()
    first.engine!.arrive(first.journey.room!.doors.find(door => door.id === 'deeper')!)
    frame()
    expect(first.journey.room?.id).toBe(roomId('sunseed', 'steps'))
    for (let i = 0; i < 10; i++) frame()
    first.unmount()

    const second = mount()
    await settle()
    frame()
    expect(second.journey.room?.id).toBe(roomId('sunseed', 'steps'))
    expect(crumbs()).toEqual(['The Sevenfold Valley', 'A labyrinth'])
  })

  it('enters a participant’s labyrinth — a place of its own — whose rooms hydrate and show like any other', async () => {
    // Seated before the game opens, as an add-on tile would be: a two-room
    // warren behind Mira, the keeper of beginnings — a person is a thing too.
    const { installStory, readStoryBundle } = await import('./story-addons.js')
    const { fromAscii } = await import('./levels.js')
    const level = (name: string) => fromAscii(name, ['############', '#..........#', '#..K....g..#', '#..BBBB....#', '#..........#', '#P........D#', '############'])
    const story = readStoryBundle({
      version: 1, id: 'warren-test', name: 'Warren',
      labyrinths: [{ id: 'warren', name: 'A Warren', rooms: [
        { id: 'porch', level: level('Porch'), doors: [{ id: 'on', col: 10, row: 1, targetRoomId: 'deep', targetDoorId: 'back' }] },
        { id: 'deep', level: level('Deep'), doors: [{ id: 'back', col: 1, row: 1, targetRoomId: 'porch', targetDoorId: 'on' }] },
      ] }],
      seats: [{ entrance: 'island/mira', place: 'warren' }],
    })!
    expect(installStory(story).ok).toBe(true)
    const overlay = mount()
    await settle()
    // Mira stands one square east and one north of the start: a person, a
    // thing — pushed into, the way anything seated is entered.
    walk('ArrowUp', 5)
    walk('ArrowRight', 14)
    await settle()
    frame()
    expect(crumbs()).toEqual(['The Sevenfold Valley', 'A Warren'])
    expect(overlay.journey.room?.id).toBe('warren-porch')
    expect(native.ensure).toHaveBeenCalledWith(expect.objectContaining({ id: 'warren-porch' }))
    // Its door on works like any room's.
    overlay.engine!.arrive(overlay.journey.room!.doors.find(door => door.id === 'on')!)
    frame()
    expect(overlay.journey.room?.id).toBe('warren-deep')
  })

  it('does not revive a closed overlay when an in-flight native room finishes loading', async () => {
    let resolve!: (value: LoadedTileRoom) => void
    let requested!: RoomDef
    native.ensure.mockImplementationOnce((room: RoomDef) => {
      requested = room
      return new Promise<LoadedTileRoom>(done => { resolve = done })
    })
    const overlay = mount()
    marker('Mira').click()
    button('East, toward sunrise').click()
    closeGainIfOpen()
    tap('e')
    walkToDawn()
    marker('Dawn Shrine').click()
    const socket = document.querySelector<HTMLButtonElement>('.sol-rpg-socket')!
    socket.click()
    marker('Dawn Shrine').click()
    expect(document.querySelector('.sol-adventure')?.getAttribute('aria-busy')).toBe('true')
    overlay.unmount()
    resolve(hydrate(requested))
    await settle()
    expect(document.querySelector('.sol-adventure')).toBeNull()
    expect(overlay.journey.room).toBeNull()
    expect(pendingFrames.size).toBe(0)
  })
})
