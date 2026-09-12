import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isWalkableTerrain } from './island.js'
import {
  ISLAND_DEF, RpgOverworld, RpgOverworldView, WORLD_CACHES, WORLD_ENCOUNTERS, WORLD_PEOPLE, WORLD_PLOTS, WORLD_RESIDENTS, WORLD_SHRINES, WORLD_SIGNS,
  WORLD_COLS, WORLD_ROWS, WORLD_START, componentKey, valleyPoint, worldTerrain,
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
  const onEnter = vi.fn(), onDungeon = vi.fn()
  const hooks: WorldHooks = { has: piece => inventory.has(componentKey(piece)), grantRelic, onEnter, onDungeon }
  return { model: new RpgOverworld(hooks), hooks, inventory, grantRelic, onEnter, onDungeon }
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
    expect(run.model.answer('mira', 1).ok).toBe(true)
    expect(run.grantRelic).toHaveBeenCalledTimes(1)
  })

  it('requires walking to conversations and entrances, including direct calls from map buttons', () => {
    const run = journey([{ kind: 'star' }])
    const before = { ...run.model.player }
    expect(run.model.interact('pyramid-shrine').ok).toBe(false)
    expect(run.model.answer('sela', 1).ok).toBe(false)
    expect(run.model.fillSocket('pyramid-shrine', 0).ok).toBe(false)
    expect(run.model.enter('pyramid-shrine').ok).toBe(false)
    expect(run.model.enterDungeon('highland-cavern').ok).toBe(false)
    expect(run.model.player).toEqual(before)
    expect(run.onEnter).not.toHaveBeenCalled()
    expect(run.onDungeon).not.toHaveBeenCalled()
  })

  it('requires actual placement before entering and preserves the piece for later use', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    Object.assign(run.model.player, at('dawn-shrine'))
    expect(run.model.shrineStatus('dawn-shrine')).toBe('ready')
    expect(run.model.enter('dawn-shrine').ok).toBe(false)
    expect(run.model.fillSocket('dawn-shrine', 0).ok).toBe(true)
    expect(run.model.shrineStatus('dawn-shrine')).toBe('open')
    expect(run.model.enter('dawn-shrine').ok).toBe(true)
    expect(run.onEnter).toHaveBeenCalledWith('sunseed')
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
    expect(run.onEnter).toHaveBeenCalledWith('tideglass')
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
    expect(run.onEnter).toHaveBeenCalledWith('starbloom')
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
    expect(run.model.enterDungeon('wayfarer-cavern').ok).toBe(true)
    expect(run.onDungeon).toHaveBeenCalledWith(0)
  })

  it('lets the player walk over an entrance and wait there until they explicitly enter', () => {
    const run = journey()
    Object.assign(run.model.player, valleyPoint(8, 12))
    run.model.update(0.25, { right: true })
    expect(run.model.nearest()?.id).toBe('wayfarer-cavern')
    expect(run.onDungeon).not.toHaveBeenCalled()
    expect(run.model.interact('wayfarer-cavern')).toMatchObject({ ok: true })
    expect(run.onDungeon).toHaveBeenCalledTimes(1)
    // Returning at the same coordinates never causes another entry.
    for (let frame = 0; frame < 20; frame++) run.model.update(0.05, {})
    expect(run.onDungeon).toHaveBeenCalledTimes(1)
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

  it('closes completed shrine assembly and enters from the compact prompt', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    try {
      view.mount(host); Object.assign(view.model.player, at('dawn-shrine')); view.interact('dawn-shrine')
      expect(host.querySelectorAll('.sol-rpg-shrine-pattern svg polygon')).toHaveLength(7)
      expect(host.querySelectorAll('.sol-rpg-socket')).toHaveLength(1)
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-socket')?.style.clipPath).toContain('polygon(')
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-socket')?.getAttribute('aria-label')).toContain('Dawn triangle: Place piece')
      expect(view.isDialogOpen).toBe(false)
      expect(view.isSpeaking).toBe(true)
      expect(run.onEnter).not.toHaveBeenCalled()
      host.querySelector<HTMLButtonElement>('.sol-rpg-socket')!.click()
      expect(view.isSpeaking).toBe(false)
      expect(host.querySelector('.sol-rpg-bubble.is-shown[data-for="dawn-shrine"]')?.textContent).toContain('walk in')
      expect(run.onEnter).not.toHaveBeenCalled()
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-world-prompt')?.textContent).toContain('click to enter')
      host.querySelector<HTMLButtonElement>('.sol-rpg-world-prompt')!.click()
      expect(run.onEnter).toHaveBeenCalledWith('sunseed')
      expect(view.isDialogOpen).toBe(false)
      expect(run.inventory.has('triangle:0')).toBe(true)
    } finally { view.dispose(); host.remove() }
    expect(host.childElementCount).toBe(0)
  })

  it('offers nearby dungeons in a small prompt and enters directly without a confirmation dialog', () => {
    const run = journey()
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    try {
      view.mount(host); Object.assign(view.model.player, valleyPoint(8, 12))
      view.update(0.25, { right: true })
      expect(view.isDialogOpen).toBe(false)
      expect(run.onDungeon).not.toHaveBeenCalled()
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-world-prompt')?.textContent).toContain('Wayfarer Cavern')
      host.querySelector<HTMLButtonElement>('.sol-rpg-world-prompt')!.click()
      expect(run.onDungeon).toHaveBeenCalledWith(0)
      expect(view.isDialogOpen).toBe(false)
      view.refresh(); view.update(0.1, {})
      expect(run.onDungeon).toHaveBeenCalledTimes(1)
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-world-prompt')?.textContent).toContain('click to enter')
    } finally { view.dispose(); host.remove() }
  })

  it('opens incomplete shrines for assembly and directly enters completed shrines on interact', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    try {
      view.mount(host); Object.assign(view.model.player, at('dawn-shrine'))
      view.interact('dawn-shrine')
      expect(view.isSpeaking).toBe(true)
      expect(run.onEnter).not.toHaveBeenCalled()
      expect(view.dismiss()).toBe(true); view.model.fillSocket('dawn-shrine', 0)
      view.interact('dawn-shrine')
      expect(run.onEnter).toHaveBeenCalledWith('sunseed')
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
      expect(host.querySelector('.sol-rpg-world-prompt')?.textContent).toBe(`${plot.name} · Enter / E or click to look`)
      view.interact(plot.id)
      expect(view.isDialogOpen).toBe(false)
      expect(host.querySelector(`.sol-rpg-bubble.is-shown[data-for="${plot.id}"]`)?.textContent).toContain('No shrine stands here yet')
      expect(run.onEnter).not.toHaveBeenCalled()
      expect(run.onDungeon).not.toHaveBeenCalled()
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
