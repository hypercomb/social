// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WALL } from './engine.js'
import { type RoomDef } from './labyrinth.js'
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
  room.level.tiles[2 * room.level.cols + 4] = WALL
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
function walk(value: string, frames: number): void {
  key('keydown', value)
  for (let i = 0; i < frames; i++) frame()
  key('keyup', value)
}
function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const result = [...root.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent?.trim() === label)
  expect(result, `button ${label}`).toBeTruthy()
  return result!
}
function marker(name: string): HTMLButtonElement {
  const result = document.querySelector<HTMLButtonElement>(`.sol-rpg-place[aria-label^="${name},"]`)
  expect(result).toBeTruthy()
  return result!
}
function mount(): SolomonLabyrinthOverlay {
  let overlay: SolomonLabyrinthOverlay
  overlay = new SolomonLabyrinthOverlay(() => overlay.unmount())
  overlays.add(overlay)
  overlay.mount()
  frame()
  return overlay
}
function solveMira(): void {
  marker('Mira').click()
  expect(document.querySelector('.sol-rpg-clue')?.textContent).toContain('sunrise')
  button('East, toward sunrise').click()
  key('keydown', 'e')
  key('keyup', 'e')
}
function walkToDawn(): void {
  // The lake blocks the direct western route. Follow the map's clear path.
  walk('ArrowRight', 19)
  walk('ArrowUp', 38)
}
function fillDawn(): void {
  marker('Dawn Shrine').click()
  const socket = document.querySelector<HTMLButtonElement>('.sol-rpg-socket')!
  expect(socket.disabled).toBe(false)
  socket.click()
  expect(document.querySelector('.sol-rpg-dialog')).toBeNull()
}
function enter(): void {
  key('keydown', 'Enter')
  key('keyup', 'Enter')
}
async function settle(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve() }
function stored(): { location: { mode: string }, world: { player: unknown } } {
  return JSON.parse(localStorage.getItem(SAVE_SLOTS_KEY)!).slots[1].payload
}
/** Saves inside the Dawn Shrine, then reopens with the continue's first native
 *  room still hydrating. `finish` lets that room load. */
async function pendingContinue(): Promise<{ overlay: SolomonLabyrinthOverlay, finish: () => Promise<void> }> {
  const first = mount()
  solveMira()
  walkToDawn()
  fillDawn()
  enter()
  await settle()
  first.engine!.arrive(first.journey.room!.relics[0])
  frame()
  first.unmount()
  let resolve!: (value: LoadedTileRoom) => void
  let requested!: RoomDef
  native.ensure.mockImplementationOnce((room: RoomDef) => {
    requested = room
    return new Promise<LoadedTileRoom>(done => { resolve = done })
  })
  const overlay = mount()
  expect(document.querySelector('.sol-adventure')?.getAttribute('aria-busy')).toBe('true')
  return { overlay, finish: async () => { resolve(hydrate(requested)); await settle() } }
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

describe('the Solomon adventure shell with real journey and world models', () => {
  it('solves an NPC clue, fills a shrine, hydrates native rooms and warps between fixed 192-tile surfaces', async () => {
    const overlay = mount()
    solveMira()
    expect(overlay.journey.collected('mira-dawn-triangle')).toBe(true)
    walkToDawn()
    fillDawn()
    expect(overlay.journey.inventory.triangles.has(0)).toBe(true)
    enter()
    await settle()
    frame()
    expect(native.ensure).toHaveBeenCalledTimes(4)
    expect(overlay.journey.room?.id).toBe('sunseed-porch')
    expect(overlay.engine?.tileAt(4, 2)).toBe(WALL)
    expect(document.querySelector('.sol-room-caption')?.textContent).toContain('Native The Sun Porch')
    let cells = [...document.querySelectorAll<HTMLElement>('.sol-game-tile')]
    expect(cells).toHaveLength(192)
    expect(new Set(cells.map(cell => cell.dataset.cell)).size).toBe(192)
    expect(cells.every(cell => cell.dataset.cell?.startsWith('solomon-maze-v1/sunseed-porch/'))).toBe(true)
    expect((document.querySelector('.sol-adventure-world') as HTMLElement).hidden).toBe(true)
    overlay.engine!.arrive(overlay.journey.room!.relics[0])
    frame()
    expect(overlay.journey.inventory.triangles.has(1)).toBe(true)
    overlay.engine!.arrive(overlay.journey.room!.doors.find(door => door.id === 'deeper')!)
    key('keydown', 'e')
    key('keyup', 'e')
    frame()
    expect(overlay.journey.room?.id).toBe('sunseed-steps')
    cells = [...document.querySelectorAll<HTMLElement>('.sol-game-tile')]
    expect(cells).toHaveLength(192)
    expect(cells.every(cell => cell.dataset.cell?.startsWith('solomon-maze-v1/sunseed-steps/'))).toBe(true)
    expect(document.querySelector('.sol-room-board')?.getAttribute('data-depth')).toBe('1')
    expect(native.ensure).toHaveBeenCalledTimes(4)
  })

  it('keeps NPC knowledge, filled shrine sockets and permanent relic rewards after close and reopen', async () => {
    const first = mount()
    solveMira()
    walkToDawn()
    fillDawn()
    enter()
    await settle()
    first.engine!.arrive(first.journey.room!.relics[0])
    frame()
    const score = first.engine!.score
    first.unmount()
    expect(pendingFrames.size).toBe(0)
    const second = mount()
    expect(second.journey.inventory.triangles.has(0)).toBe(true)
    expect(second.journey.inventory.triangles.has(1)).toBe(true)
    expect(marker('Dawn Shrine').dataset.state).toBe('open')
    marker('Mira').click()
    expect(document.querySelector('.sol-rpg-choices')).toBeNull()
    key('keydown', 'e')
    key('keyup', 'e')
    expect(document.querySelector('.sol-rpg-dialog')).toBeNull()
    walkToDawn()
    expect(second.engine).toBeNull()
    marker('Dawn Shrine').click()
    expect(document.querySelector('.sol-rpg-dialog')).toBeNull()
    await settle()
    second.engine!.arrive(second.journey.room!.relics[0])
    frame()
    expect(second.engine!.score).toBe(score)
    expect(second.journey.collected('mira-dawn-triangle')).toBe(true)
    expect(document.querySelector('.sol-adventure-inventory')?.textContent).toContain('2/6')
  })

  it('does not revive a closed overlay when an in-flight native room finishes loading', async () => {
    let resolve!: (value: LoadedTileRoom) => void
    let requested!: RoomDef
    native.ensure.mockImplementationOnce((room: RoomDef) => {
      requested = room
      return new Promise<LoadedTileRoom>(done => { resolve = done })
    })
    const overlay = mount()
    solveMira()
    walkToDawn()
    fillDawn()
    enter()
    expect(document.querySelector('.sol-adventure')?.getAttribute('aria-busy')).toBe('true')
    overlay.unmount()
    resolve(hydrate(requested))
    await settle()
    expect(document.querySelector('.sol-adventure')).toBeNull()
    expect(overlay.engine).toBeNull()
    expect(native.ensure).toHaveBeenCalledTimes(1)
    expect(pendingFrames.size).toBe(0)
  })

  it.each([
    ['Escape', () => key('keydown', 'Escape')],
    ['the World button', () => button('World').click()],
  ])('lets a pending continue finish before %s shows the world, so the adventure keeps saving', async (_, gesture) => {
    const { overlay, finish } = await pendingContinue()
    gesture()
    await settle()
    expect(overlay.isMounted()).toBe(true)
    expect(document.querySelector('.sol-adventure')?.getAttribute('aria-busy')).toBe('true')
    await finish()
    expect(document.querySelector('.sol-adventure')?.hasAttribute('aria-busy')).toBe(false)
    expect((document.querySelector('.sol-adventure-world') as HTMLElement).hidden).toBe(false)
    expect((document.querySelector('.sol-adventure-rooms') as HTMLElement).hidden).toBe(true)
    expect(overlay.engine).toBeNull()
    expect(overlay.journey.engines.has('sunseed-porch')).toBe(true)
    expect(document.querySelector('.sol-save-status')?.textContent).toBe('Autosaved')
    expect(stored().location.mode).toBe('world')
    const player = stored().world.player
    walk('ArrowDown', 30)
    for (let i = 0; i < 40; i++) frame()
    expect(stored().world.player).not.toEqual(player)
  })

  it('opens the designer once a pending continue finishes, and saves again when it closes', async () => {
    const { overlay, finish } = await pendingContinue()
    overlay.showDesigner()
    expect(document.querySelector('.sol-name')).toBeNull()
    await finish()
    expect(document.querySelector('.sol-name')).not.toBeNull()
    expect((document.querySelector('.sol-adventure') as HTMLElement).hidden).toBe(true)
    expect(overlay.journey.engines.has('sunseed-porch')).toBe(true)
    key('keydown', 'Escape')
    expect(document.querySelector('.sol-name')).toBeNull()
    expect((document.querySelector('.sol-adventure') as HTMLElement).hidden).toBe(false)
    expect(stored().location.mode).toBe('world')
  })

  it('dispatches an overworld cavern to its separate scrolling knowledge dungeon', () => {
    const overlay = mount()
    walk('ArrowRight', 24)
    expect((document.querySelector('.sol-adventure-world') as HTMLElement).hidden).toBe(false)
    expect(document.querySelector('.sol-rpg-dialog')).toBeNull()
    expect(document.querySelector('.sol-rpg-world-prompt')?.textContent).toContain('Wayfarer Cavern')
    marker('Wayfarer Cavern').click()
    frame()
    expect((document.querySelector('.sol-adventure-dungeon') as HTMLElement).hidden).toBe(false)
    expect(document.querySelector('.sol-scroll-dungeon header strong')?.textContent).toBe('Wayfarer Cavern')
    expect(document.querySelectorAll('.sol-scroll-dungeon .sd-feature')).toHaveLength(7)
    expect(overlay.engine).toBeNull()
    expect(native.ensure).not.toHaveBeenCalled()
    button('World').click()
    frame()
    expect((document.querySelector('.sol-adventure-world') as HTMLElement).hidden).toBe(false)
    expect(document.querySelector('.sol-rpg-dialog')).toBeNull()
    enter()
    frame()
    expect((document.querySelector('.sol-adventure-dungeon') as HTMLElement).hidden).toBe(false)
  })
})
