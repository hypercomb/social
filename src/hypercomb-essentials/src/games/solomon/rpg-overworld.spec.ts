import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isWalkableTerrain } from './island.js'
import {
  ISLAND_DEF, RpgOverworld, RpgOverworldView, WORLD_AREAS, WORLD_CACHES, WORLD_DOORS, WORLD_DUNGEONS, WORLD_ENCOUNTERS, WORLD_PEOPLE, WORLD_PLOTS,
  WORLD_PUSH_DELAY, WORLD_RESIDENTS, WORLD_SHRINES, WORLD_SIGNS, WORLD_COLS, WORLD_ROWS, WORLD_START,
  componentKey, shrinePolygon, valleyPoint, worldTerrain,
  type ShrineComponent, type WorldHooks, type WorldRelic,
} from './rpg-overworld.js'

/** Built cells the wand can open: a cracked brick, a rune spring, a seal whose plates are reachable. */
const WAND_OPENS = new Set(['crack', 'spring', 'seal'])

/** Where a place stands on the island. */
function at(id: string): { x: number; y: number } {
  const place = WORLD_ENCOUNTERS.find(candidate => candidate.id === id)!
  return { x: place.x, y: place.y }
}

function journey(initial: ShrineComponent[] = []) {
  const inventory = new Set(initial.map(componentKey))
  const grantRelic = vi.fn((relic: WorldRelic) => { inventory.add(componentKey(relic)); return true })
  const seat = vi.fn(() => true)
  const onEntrance = vi.fn()
  const gain = vi.fn()
  const found = vi.fn()
  const hooks: WorldHooks = { has: piece => inventory.has(componentKey(piece)), grantRelic, seat, onEntrance, gain, found }
  return { model: new RpgOverworld(hooks), hooks, inventory, grantRelic, seat, onEntrance, gain, found }
}

describe('the RPG world and permanent shrine abilities', () => {
  it('begins beside a conversation that supplies the first piece through a retryable knowledge question', () => {
    const run = journey()
    expect(run.model.interact().encounter?.id).toBe('mira')
    expect(run.model.answer('mira', 0).ok).toBe(false)
    expect(run.grantRelic).not.toHaveBeenCalled()
    expect(run.model.answer('mira', 1).ok).toBe(true)
    expect(run.inventory.has('triangle:0')).toBe(true)
    expect(run.model.journal.has('triangle:0')).toBe(true)
    expect(run.gain).toHaveBeenCalledWith(expect.objectContaining({ id: 'triangle:0', fresh: true }))
    expect(run.model.answer('mira', 1).ok).toBe(true)
    expect(run.grantRelic).toHaveBeenCalledTimes(1)
    expect(run.gain).toHaveBeenCalledTimes(1)
  })

  it('requires walking to conversations and entrances, including direct calls from map buttons', () => {
    const run = journey([{ kind: 'star' }])
    const before = { ...run.model.player }
    expect(run.model.interact('pyramid-shrine').ok).toBe(false)
    expect(run.model.answer('sela', 1).ok).toBe(false)
    expect(run.model.fillSocket('pyramid-shrine', 0).ok).toBe(false)
    expect(run.model.enter('pyramid-shrine').ok).toBe(false)
    expect(run.model.enter('highland-cavern').ok).toBe(false)
    expect(run.model.player).toEqual(before)
    expect(run.onEntrance).not.toHaveBeenCalled()
  })

  it('requires actual placement before entering and preserves the piece for later use', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    Object.assign(run.model.player, at('dawn-shrine'))
    expect(run.model.shrineStatus('dawn-shrine')).toBe('ready')
    expect(run.model.enter('dawn-shrine').ok).toBe(false)
    expect(run.model.fillSocket('dawn-shrine', 0).ok).toBe(true)
    expect(run.model.shrineStatus('dawn-shrine')).toBe('open')
    expect(run.model.enter('dawn-shrine').ok).toBe(true)
    expect(run.onEntrance).toHaveBeenCalledWith('dawn-shrine')
    expect(run.inventory.has('triangle:0')).toBe(true)
    expect(run.model.fillSocket('dawn-shrine', 0).ok).toBe(true)
    expect(run.model.filledSockets.size).toBe(1)
    expect(run.grantRelic).not.toHaveBeenCalled()
  })

  it('shows partial assembly and prevents a different triangle from filling a missing socket', () => {
    const run = journey([{ kind: 'triangle', point: 1 }, { kind: 'triangle', point: 3 }, { kind: 'hexagon' }])
    Object.assign(run.model.player, at('tide-shrine'))
    expect(run.model.fillSocket('tide-shrine', 0).ok).toBe(true)
    expect(run.model.fillSocket('tide-shrine', 1).ok).toBe(false)
    expect(run.model.fillSocket('tide-shrine', 2).ok).toBe(true)
    expect(run.model.shrineStatus('tide-shrine')).toBe('missing')
    expect(run.model.enter('tide-shrine').ok).toBe(false)
    run.inventory.add('triangle:2')
    expect(run.model.shrineStatus('tide-shrine')).toBe('ready')
    run.model.fillSocket('tide-shrine', 1)
    expect(run.model.enter('tide-shrine').ok).toBe(true)
    expect(run.onEntrance).toHaveBeenCalledWith('tide-shrine')
    expect(run.inventory.size).toBe(4)
  })

  it.each(['pieces', 'whole-star'])('assembles all seven Pyramid sockets with %s and retains every ability', mode => {
    const pieces: ShrineComponent[] = mode === 'whole-star' ? [{ kind: 'star' }] : [...Array.from({ length: 6 }, (_, point) => ({ kind: 'triangle' as const, point })), { kind: 'hexagon' }]
    const run = journey(pieces)
    Object.assign(run.model.player, at('pyramid-shrine'))
    expect(WORLD_SHRINES[2].components).toHaveLength(7)
    for (let index = 0; index < 6; index++) expect(run.model.fillSocket('pyramid-shrine', index).ok).toBe(true)
    expect(run.model.enter('pyramid-shrine').ok).toBe(false)
    expect(run.model.fillSocket('pyramid-shrine', 6).ok).toBe(true)
    expect(run.model.enter('pyramid-shrine').ok).toBe(true)
    expect(run.onEntrance).toHaveBeenCalledWith('pyramid-shrine')
    expect(run.inventory.size).toBe(pieces.length)
  })

  it('makes optional conversations informational and expeditions accessible without spending pieces', () => {
    const run = journey()
    for (const person of WORLD_PEOPLE.slice(1)) {
      Object.assign(run.model.player, person)
      expect(run.model.answer(person.id, person.correct).ok).toBe(true)
    }
    expect(run.grantRelic).not.toHaveBeenCalled()
    Object.assign(run.model.player, at('wayfarer-cavern'))
    expect(run.model.enter('wayfarer-cavern').ok).toBe(true)
    expect(run.onEntrance).toHaveBeenCalledWith('wayfarer-cavern')
  })

  it('never offers a cave mouth or an open shrine to E — only a not-yet-open shrine stays an E-target (M9/M14)', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    Object.assign(run.model.player, at('wayfarer-cavern'))
    expect(run.model.nearest()).toBeUndefined()
    Object.assign(run.model.player, at('dawn-shrine'))
    expect(run.model.nearest()?.id).toBe('dawn-shrine') // not yet open: still an E-target for its sockets
    run.model.fillSocket('dawn-shrine', 0)
    expect(run.model.shrineStatus('dawn-shrine')).toBe('open')
    expect(run.model.nearest()).toBeUndefined() // open now: a portal, never E's target
  })

  it('pushes into a cave mouth after a sustained approach, then needs distance before it will fire again', () => {
    const run = journey()
    const mouth = at('wayfarer-cavern')
    Object.assign(run.model.player, { x: mouth.x - 1, y: mouth.y })
    for (let frame = 0; frame < 40; frame++) run.model.update(0.05, { right: true })
    expect(run.onEntrance).toHaveBeenCalledWith('wayfarer-cavern')
    expect(run.onEntrance).toHaveBeenCalledTimes(1)
    // Held against it, arrived on the same spot: it never fires a second time.
    for (let frame = 0; frame < 20; frame++) run.model.update(0.05, { right: true })
    expect(run.onEntrance).toHaveBeenCalledTimes(1)
    // Stepping back and pushing again re-arms it (the disarm/rearm rule).
    for (let frame = 0; frame < 20; frame++) run.model.update(0.05, { left: true })
    for (let frame = 0; frame < 40; frame++) run.model.update(0.05, { right: true })
    expect(run.onEntrance).toHaveBeenCalledTimes(2)
  })

  it('brushing past a portal, rather than into it, never fires it', () => {
    const run = journey()
    const mouth = at('wayfarer-cavern')
    Object.assign(run.model.player, { x: mouth.x - 3, y: mouth.y - 1.4 })
    for (let frame = 0; frame < 80; frame++) run.model.update(0.05, { right: true }) // crosses past its column, always clear of the collision radius
    expect(run.onEntrance).not.toHaveBeenCalled()
  })

  it('shows an unseated portal or area as a tag, and pushing it reports the empty line instead of entering', () => {
    const hooks: WorldHooks = { has: () => false, grantRelic: () => undefined, seat: () => false, onEntrance: vi.fn() }
    const model = new RpgOverworld(hooks)
    const door = WORLD_DOORS[0]!
    Object.assign(model.player, { x: door.x, y: door.y })
    expect(model.cue()).toMatchObject({ id: door.id, action: 'tag' })
    Object.assign(model.player, { x: door.x - 1, y: door.y })
    for (let frame = 0; frame < 40; frame++) model.update(0.05, { right: true })
    expect(hooks.onEntrance).not.toHaveBeenCalled()
    const grove = WORLD_AREAS[0]!
    Object.assign(model.player, { x: grove.landings.north.x, y: grove.landings.north.y })
    for (let frame = 0; frame < 40; frame++) model.update(0.05, { down: true })
    expect(hooks.onEntrance).not.toHaveBeenCalled()
  })

  it('pushes into the Hollow Grove from any of its four landings', () => {
    // Standing on a landing itself and pushing the opposite way from its own
    // `facing` (the way you would face RETURNING from inside) walks straight
    // into the footprint — every landing is on open ground (grass), unlike
    // the unrelated tree band that happens to sit further out on some sides.
    const into = { up: 'down', down: 'up', left: 'right', right: 'left' } as const
    for (const side of ['north', 'south', 'west', 'east'] as const) {
      const run = journey()
      const landing = WORLD_AREAS[0]!.landings[side]
      Object.assign(run.model.player, { x: landing.x, y: landing.y })
      const key = into[landing.facing]
      for (let frame = 0; frame < 40; frame++) run.model.update(0.05, { [key]: true })
      expect(run.onEntrance, side).toHaveBeenCalledWith('valley-grove')
    }
  })

  it('lands the traveller back at a portal, facing away and disarmed', () => {
    const run = journey()
    run.model.land('wayfarer-cavern')
    expect(run.model.player).toMatchObject({ ...at('wayfarer-cavern'), facing: 'down' })
    for (let frame = 0; frame < 5; frame++) run.model.update(0.05, {}) // standing still: never fires from merely landing there
    expect(run.onEntrance).not.toHaveBeenCalled()
  })

  it('lands the traveller at the nearest edge of an area, facing the opposite way from its approach', () => {
    const run = journey()
    const grove = WORLD_AREAS[0]!
    Object.assign(run.model.player, { x: grove.landings.south.x, y: grove.landings.south.y + 0.1 })
    run.model.land('valley-grove')
    expect(run.model.player.facing).toBe('up')
  })

  it('keeps every encounter on the island reachable on foot and with the wand from the starting clearing', () => {
    const visited = new Uint8Array(WORLD_COLS * WORLD_ROWS), queue = [WORLD_START.y * WORLD_COLS + WORLD_START.x]
    visited[queue[0]] = 1
    for (let head = 0; head < queue.length; head++) {
      const x = queue[head] % WORLD_COLS, y = (queue[head] - x) / WORLD_COLS
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const next = (y + dy) * WORLD_COLS + x + dx
        const terrain = worldTerrain(x + dx, y + dy)
        if (visited[next] || !(isWalkableTerrain(terrain) || WAND_OPENS.has(terrain))) continue
        visited[next] = 1
        queue.push(next)
      }
    }
    expect(WORLD_RESIDENTS.length).toBeGreaterThan(0)
    expect(WORLD_PLOTS.length).toBeGreaterThan(0)
    expect(WORLD_CACHES.length).toBeGreaterThan(0)
    expect(WORLD_DOORS.length).toBeGreaterThan(0)
    for (const encounter of WORLD_ENCOUNTERS) {
      expect(visited[Math.floor(encounter.y) * WORLD_COLS + Math.floor(encounter.x)], encounter.name).toBe(1)
    }
  })

  it('respects the finite boundaries and lake collision even with long or invalid frames', () => {
    const { model } = journey()
    Object.assign(model.player, valleyPoint(4.5, 7.5))
    for (let i = 0; i < 100; i++) model.update(10, { up: true })
    expect(model.player.y).toBeGreaterThanOrEqual(valleyPoint(0, 7.2).y)
    expect(model.walkable(model.player.x, model.player.y)).toBe(true)
    const before = { ...model.player }
    model.update(NaN, { up: true }); model.update(Infinity, { left: true })
    expect(model.player).toEqual(before)
    for (let i = 0; i < 100; i++) model.update(0.25, { left: true, down: true })
    expect(model.player.x).toBeGreaterThan(0)
    expect(model.player.y).toBeLessThan(WORLD_ROWS)
    expect(model.player.x).toBeLessThan(WORLD_COLS)
  })
})

describe('the moved entrances and new island fixtures (2) A2.2/A4.1', () => {
  it('keeps the two unmoved entrances exactly where they were and moves the other three off the valley roads', () => {
    expect(at('dawn-shrine')).toEqual(valleyPoint(8, 4))
    expect(at('highland-cavern')).toEqual(valleyPoint(20, 4))
    expect(at('tide-shrine')).toEqual(valleyPoint(18, 4))
    expect(at('pyramid-shrine')).toEqual(valleyPoint(22, 10))
    expect(at('wayfarer-cavern')).toEqual(valleyPoint(10, 11))
  })

  it('sits every moved entrance and its footprint on ground the wand or a walk can reach', () => {
    for (const id of ['tide-shrine', 'pyramid-shrine', 'wayfarer-cavern']) {
      const { x, y } = at(id)
      expect(isWalkableTerrain(worldTerrain(Math.floor(x), Math.floor(y))) || WAND_OPENS.has(worldTerrain(Math.floor(x), Math.floor(y))), id).toBe(true)
    }
  })

  it('pins the Hollow Grove footprint as ground already too dense to walk through (old trees) — the four landings are the only doors', () => {
    const grove = WORLD_AREAS[0]!
    expect(grove.cells).toHaveLength(9)
    for (const [col, row] of grove.cells) expect(isWalkableTerrain(worldTerrain(col, row)), `${col},${row}`).toBe(false)
    for (const landing of Object.values(grove.landings)) expect(isWalkableTerrain(worldTerrain(Math.floor(landing.x), Math.floor(landing.y)))).toBe(true)
  })

  it("gives Pell a third line naming the chandler's door, and adds no other new resident line", () => {
    const pell = WORLD_RESIDENTS.find(resident => resident.id === 'pell')!
    expect(pell.lines).toHaveLength(3)
    expect(pell.lines[2]).toMatch(/door/i)
  })

  it('pins WORLD_PUSH_DELAY to the same value chamber.ts will use for its own portals', () => {
    expect(WORLD_PUSH_DELAY).toBe(0.3)
  })

  it('exports shrinePolygon for the gains role to reuse', () => {
    expect(shrinePolygon({ kind: 'hexagon' })).toHaveLength(6)
    expect(shrinePolygon({ kind: 'triangle', point: 0 })).toHaveLength(3)
  })

  it("returns a coarse, terrain-coloured seed() picture around the traveller", () => {
    const { model } = journey()
    const seed = model.seed()
    expect(seed.rgb).toHaveLength(seed.cols * seed.rows * 3)
    Object.assign(model.player, valleyPoint(20, 20))
    expect(model.seed().rgb).not.toEqual(seed.rgb)
  })
})

describe('world conversations and shrine controls', () => {
  // jsdom has no canvas: the island view must work, and stay testable, without one.
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
  afterEach(() => { vi.restoreAllMocks() })

  it('asks in a bubble beside the person, never a dialog: play goes on, a wrong answer can be corrected, walking away puts the question away', () => {
    const { hooks, inventory } = journey()
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(hooks)
    const bubble = (): HTMLElement | null => host.querySelector('.sol-rpg-bubble.is-shown[data-for="mira"]')
    try {
      view.mount(host); view.interact()
      expect(view.isDialogOpen).toBe(false)
      expect(view.isSpeaking).toBe(true)
      expect(host.querySelector('.sol-rpg-dialog')).toBeNull()
      expect(bubble()?.classList.contains('is-live')).toBe(true)
      expect(bubble()?.querySelector('.sol-rpg-clue')?.textContent).toContain('sunrise')
      // Nothing freezes: she can still walk while Mira waits.
      const before = { ...view.model.player }
      view.update(0.1, { right: true })
      expect(view.model.player.x).toBeGreaterThan(before.x)
      let choices = bubble()!.querySelectorAll<HTMLButtonElement>('.sol-rpg-choices button')
      expect(choices).toHaveLength(3)
      choices[0].click()
      expect(bubble()?.textContent).toContain('Try again')
      choices = bubble()!.querySelectorAll<HTMLButtonElement>('.sol-rpg-choices button')
      choices[1].click()
      expect(inventory.has('triangle:0')).toBe(true)
      expect(bubble()?.textContent).toContain('Take the Dawn triangle')
      expect(bubble()?.querySelector('.sol-rpg-choices')).toBeNull()
      // E puts a waiting question away; so does walking off.
      view.interact()
      expect(view.isSpeaking).toBe(false)
      view.interact()
      expect(view.isSpeaking).toBe(true)
      Object.assign(view.model.player, valleyPoint(12, 3)); view.refresh()
      expect(view.isSpeaking).toBe(false)
    } finally { view.dispose(); host.remove() }
  })

  it('closes completed shrine assembly and enters by clicking the shrine, once it opens (M9)', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    const marker = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.sol-rpg-place-shrine[aria-label^="Dawn Shrine,"]')!
    try {
      view.mount(host); Object.assign(view.model.player, at('dawn-shrine')); view.interact('dawn-shrine')
      expect(host.querySelectorAll('.sol-rpg-shrine-pattern svg polygon')).toHaveLength(7)
      expect(host.querySelectorAll('.sol-rpg-socket')).toHaveLength(1)
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-socket')?.style.clipPath).toContain('polygon(')
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-socket')?.getAttribute('aria-label')).toContain('Dawn triangle: Place piece')
      expect(view.isDialogOpen).toBe(false)
      expect(view.isSpeaking).toBe(true)
      expect(run.onEntrance).not.toHaveBeenCalled()
      host.querySelector<HTMLButtonElement>('.sol-rpg-socket')!.click()
      expect(view.isSpeaking).toBe(false)
      expect(host.querySelector('.sol-rpg-bubble.is-shown[data-for="dawn-shrine"]')?.textContent).toContain('walk in')
      expect(run.onEntrance).not.toHaveBeenCalled()
      // Now open, it is a tag (a destination, no key hint) rather than an act.
      expect(view.model.cue()).toMatchObject({ id: 'dawn-shrine', action: 'tag' })
      marker().click()
      expect(run.onEntrance).toHaveBeenCalledWith('dawn-shrine')
      expect(view.isDialogOpen).toBe(false)
      expect(run.inventory.has('triangle:0')).toBe(true)
    } finally { view.dispose(); host.remove() }
    expect(host.childElementCount).toBe(0)
  })

  it('offers a nearby cave mouth as a tag cue and pushes into it directly without a confirmation dialog', () => {
    const run = journey()
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    const mouth = at('wayfarer-cavern')
    try {
      view.mount(host); Object.assign(view.model.player, { x: mouth.x - 1, y: mouth.y })
      view.update(0.1, { right: true })
      expect(view.isDialogOpen).toBe(false)
      expect(run.onEntrance).not.toHaveBeenCalled()
      expect(host.querySelector('.sol-rpg-cue')?.textContent).toContain('Wayfarer Cavern')
      expect(host.querySelector('.sol-rpg-cue')?.getAttribute('data-action')).toBe('tag')
      for (let frame = 0; frame < 40; frame++) view.update(0.05, { right: true })
      expect(run.onEntrance).toHaveBeenCalledWith('wayfarer-cavern')
      expect(view.isDialogOpen).toBe(false)
    } finally { view.dispose(); host.remove() }
  })

  it('opens incomplete shrines for assembly and directly enters completed shrines on a marker click', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    try {
      view.mount(host); Object.assign(view.model.player, at('dawn-shrine'))
      view.interact('dawn-shrine')
      expect(view.isSpeaking).toBe(true)
      expect(run.onEntrance).not.toHaveBeenCalled()
      expect(view.dismiss()).toBe(true); view.model.fillSocket('dawn-shrine', 0)
      view.interact('dawn-shrine')
      expect(run.onEntrance).toHaveBeenCalledWith('dawn-shrine')
      expect(view.isDialogOpen).toBe(false)
    } finally { view.dispose(); host.remove() }
  })

  it('lets residents talk in turn and plots describe the shrine that could stand there, without entering anything', () => {
    const run = journey()
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    try {
      view.mount(host)
      const tamsin = WORLD_RESIDENTS[0]
      expect(view.model.talk(tamsin.id).ok).toBe(false)
      Object.assign(view.model.player, at(tamsin.id))
      const said = (): string | null | undefined => host.querySelector(`.sol-rpg-bubble.is-shown[data-for="${tamsin.id}"]`)?.textContent
      view.interact(tamsin.id)
      expect(view.isDialogOpen).toBe(false)
      expect(said()).toBe(tamsin.lines[0])
      view.interact(tamsin.id)
      expect(said()).toBe(tamsin.lines[1])
      const plot = WORLD_PLOTS[0]
      Object.assign(view.model.player, at(plot.id)); view.refresh()
      expect(host.querySelector('.sol-rpg-cue')?.textContent).toBe(`${plot.name} · E to look`)
      view.interact(plot.id)
      expect(view.isDialogOpen).toBe(false)
      expect(host.querySelector(`.sol-rpg-bubble.is-shown[data-for="${plot.id}"]`)?.textContent).toContain('No shrine stands here yet')
      expect(run.onEntrance).not.toHaveBeenCalled()
      expect(view.model.met.size).toBe(0)
    } finally { view.dispose(); host.remove() }
  })

  it('announces a region once the player has arrived in it, not while brushing its border', () => {
    const run = journey()
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    const title = (): string | null | undefined => host.querySelector('.sol-rpg-world-heading h2')?.textContent
    try {
      view.mount(host)
      expect(title()).toBe('The Sevenfold Valley')
      Object.assign(view.model.player, at('tamsin'))
      view.update(0.25, {})
      expect(title()).toBe('The Sevenfold Valley')
      view.update(0.25, {})
      expect(title()).toBe('Saltmere')
      expect(host.querySelector('.sol-rpg-region')?.classList.contains('is-shown')).toBe(true)
    } finally { view.dispose(); host.remove() }
  })

  it('reads a signpost by walking up to it, without a dialog and without taking E', () => {
    const run = journey()
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    const sign = WORLD_SIGNS[0]
    const shown = (): boolean | undefined => host.querySelector(`.sol-rpg-bubble[data-for="${sign.id}"]`)?.classList.contains('is-shown')
    try {
      view.mount(host)
      expect(shown()).toBe(false)
      Object.assign(view.model.player, at(sign.id)); view.refresh()
      expect(shown()).toBe(true)
      expect(host.querySelector(`.sol-rpg-bubble[data-for="${sign.id}"]`)?.textContent).toBe(sign.text)
      expect(view.model.nearest()?.kind).not.toBe('sign')
      expect(view.isDialogOpen).toBe(false)
      Object.assign(view.model.player, WORLD_START); view.refresh()
      expect(shown()).toBe(false)
    } finally { view.dispose(); host.remove() }
  })
})

describe('the wand on the island', () => {
  const garden = ISLAND_DEF.stamps[0]!
  const stand = (model: RpgOverworld, col: number, row: number, facing: 'up' | 'down' | 'left' | 'right'): void => {
    Object.assign(model.player, { x: garden.col + col + 0.5, y: garden.row + row + 0.5, facing })
  }
  const terrain = (model: RpgOverworld, col: number, row: number): string => model.terrainAt(garden.col + col, garden.row + row)

  it('crumbles the cracked door, and holds the seal open only while every rune plate carries a brick', () => {
    const { model } = journey()
    stand(model, 5, 9, 'up')
    expect(terrain(model, 5, 8)).toBe('crack')
    expect(model.cast().wand).toMatchObject({ terrain: 'rubble', seal: false })
    expect(model.walkable(garden.col + 5.5, garden.row + 8.5)).toBe(true)
    for (const [col, row, facing] of [[3, 4, 'up'], [7, 4, 'up'], [3, 5, 'down'], [7, 5, 'down']] as const) {
      expect(terrain(model, 5, 4)).toBe('seal')
      stand(model, col, row, facing)
      expect(model.cast().ok).toBe(true)
    }
    expect(terrain(model, 5, 4)).toBe('rubble')
    stand(model, 7, 5, 'down')
    expect(model.cast().wand).toMatchObject({ terrain: 'rune', seal: true })
    expect(terrain(model, 5, 4)).toBe('seal')
  })

  it('refuses cells it does not answer and never closes a cell on the player', () => {
    const { model } = journey()
    stand(model, 4, 9, 'up')
    expect(terrain(model, 4, 8)).toBe('brick')
    expect(model.cast().ok).toBe(false)
    stand(model, 5, 9, 'up')
    model.cast()
    Object.assign(model.player, { y: garden.row + 9.1 })
    expect(model.cast().ok).toBe(false)
    expect(terrain(model, 5, 8)).toBe('rubble')
  })

  it('raises stepping stones across the rune pond so the islet chest can be reached on foot', () => {
    const { model } = journey()
    const step = (direction: 'up' | 'right'): void => { model.update(1 / 4.2, { [direction]: true }) }
    stand(model, 12, 7, 'up')
    expect(model.walkable(garden.col + 12.5, garden.row + 6.5)).toBe(false)
    for (const direction of ['up', 'up', 'up', 'right', 'right', 'up'] as const) {
      model.player.facing = direction
      expect(model.cast().wand?.terrain, direction).toBe('stone')
      step(direction)
    }
    step('up')
    const opened = model.interact('pond-cache')
    expect(opened.encounter?.kind).toBe('cache')
    expect(opened.fresh).toBe(true)
    expect(model.interact('pond-cache').fresh).toBe(false)
    expect(model.opened.has('pond-cache')).toBe(true)
    expect(model.journal.has('cache:pond-cache')).toBe(true)
  })

  it('saves wand changes by place, restores them with opened caches, and ignores cells it never answered', () => {
    const { model, hooks } = journey()
    stand(model, 13, 9, 'down')
    model.cast()
    stand(model, 13, 11, 'down')
    model.interact('nook-cache')
    const snapshot = model.exportState()
    expect(snapshot.wand).toEqual(['brick-garden:13,10'])
    expect(snapshot.opened).toEqual(['nook-cache'])
    const restored = new RpgOverworld(hooks)
    restored.restoreState(JSON.parse(JSON.stringify(snapshot)))
    expect(restored.terrainAt(garden.col + 13, garden.row + 10)).toBe('rubble')
    expect(restored.exportState()).toEqual(snapshot)
    restored.restoreState({ ...snapshot, wand: ['brick-garden:4,8', 'nowhere:1,1', 'brick-garden:99,1', 42] })
    expect(restored.exportState().wand).toEqual([])
  })
})
