import { describe, expect, it, vi } from 'vitest'
import {
  RpgOverworld, RpgOverworldView, WORLD_ENCOUNTERS, WORLD_PEOPLE, WORLD_SHRINES,
  WORLD_COLS, WORLD_ROWS, componentKey, worldTerrain,
  type ShrineComponent, type WorldHooks, type WorldRelic,
} from './rpg-overworld.js'

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
    Object.assign(run.model.player, { x: 8, y: 4 })
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
    Object.assign(run.model.player, { x: 16, y: 4 })
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
    Object.assign(run.model.player, { x: 20, y: 8 })
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
    Object.assign(run.model.player, { x: 9, y: 12 })
    expect(run.model.enterDungeon('wayfarer-cavern').ok).toBe(true)
    expect(run.onDungeon).toHaveBeenCalledWith(0)
  })

  it('lets the player walk over an entrance and wait there until they explicitly enter', () => {
    const run = journey()
    Object.assign(run.model.player, { x: 8, y: 12 })
    run.model.update(0.25, { right: true })
    expect(run.model.nearest()?.id).toBe('wayfarer-cavern')
    expect(run.onDungeon).not.toHaveBeenCalled()
    expect(run.model.interact('wayfarer-cavern')).toMatchObject({ ok: true })
    expect(run.onDungeon).toHaveBeenCalledTimes(1)
    // Returning at the same coordinates never causes another entry.
    for (let frame = 0; frame < 20; frame++) run.model.update(0.05, {})
    expect(run.onDungeon).toHaveBeenCalledTimes(1)
  })

  it('keeps every encounter reachable by walking from the starting clearing', () => {
    const visited = new Set<string>(), queue = [[4, 12]]
    while (queue.length) {
      const [x, y] = queue.shift()!
      const key = `${x},${y}`
      if (visited.has(key)) continue
      const terrain = worldTerrain(x, y)
      if (terrain !== 'grass' && terrain !== 'path') continue
      visited.add(key)
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) queue.push([x + dx, y + dy])
    }
    for (const encounter of WORLD_ENCOUNTERS) expect(visited.has(`${encounter.x},${encounter.y}`), encounter.name).toBe(true)
  })

  it('respects the finite boundaries and lake collision even with long or invalid frames', () => {
    const { model } = journey()
    Object.assign(model.player, { x: 4.5, y: 7.5 })
    for (let i = 0; i < 100; i++) model.update(10, { up: true })
    expect(model.player.y).toBeGreaterThanOrEqual(7.2)
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
  it('freezes movement during a conversation, permits a corrected answer, and resumes on close', () => {
    const { hooks, inventory } = journey()
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(hooks)
    try {
      view.mount(host); view.interact()
      expect(view.isDialogOpen).toBe(true)
      const before = { ...view.model.player }
      view.update(1, { right: true })
      expect(view.model.player).toEqual(before)
      let choices = host.querySelectorAll<HTMLButtonElement>('.sol-rpg-choices button')
      choices[0].click()
      expect(host.textContent).toContain('Try again')
      choices = host.querySelectorAll<HTMLButtonElement>('.sol-rpg-choices button')
      choices[1].click()
      expect(inventory.has('triangle:0')).toBe(true)
      expect(host.textContent).toContain('Take the Dawn triangle')
      view.closeDialog(); view.update(0.1, { right: true })
      expect(view.model.player.x).toBeGreaterThan(before.x)
    } finally { view.dispose(); host.remove() }
  })

  it('closes completed shrine assembly and enters from the compact prompt', () => {
    const run = journey([{ kind: 'triangle', point: 0 }])
    const host = document.createElement('div'); document.body.append(host)
    const view = new RpgOverworldView(run.hooks)
    try {
      view.mount(host); Object.assign(view.model.player, { x: 8, y: 4 }); view.interact('dawn-shrine')
      expect(host.querySelectorAll('.sol-rpg-shrine-pattern svg polygon')).toHaveLength(7)
      expect(host.querySelectorAll('.sol-rpg-socket')).toHaveLength(1)
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-socket')?.style.clipPath).toContain('polygon(')
      expect(host.querySelector<HTMLButtonElement>('.sol-rpg-socket')?.getAttribute('aria-label')).toContain('Dawn triangle: Place piece')
      expect(view.isDialogOpen).toBe(true)
      expect(run.onEnter).not.toHaveBeenCalled()
      host.querySelector<HTMLButtonElement>('.sol-rpg-socket')!.click()
      expect(view.isDialogOpen).toBe(false)
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
      view.mount(host); Object.assign(view.model.player, { x: 8, y: 12 })
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
      view.mount(host); Object.assign(view.model.player, { x: 8, y: 4 })
      view.interact('dawn-shrine')
      expect(view.isDialogOpen).toBe(true)
      expect(run.onEnter).not.toHaveBeenCalled()
      view.closeDialog(); view.model.fillSocket('dawn-shrine', 0)
      view.interact('dawn-shrine')
      expect(run.onEnter).toHaveBeenCalledWith('sunseed')
      expect(view.isDialogOpen).toBe(false)
    } finally { view.dispose(); host.remove() }
  })
})
