// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ScrollDungeonModel, ScrollDungeonView, type DungeonInput } from './scroll-dungeon.js'

const idle: DungeonInput = { up: false, down: false, left: false, right: false }
const wait = (model: ScrollDungeonModel, seconds: number, input: Partial<DungeonInput>) => {
  for (let time = 0; time < seconds; time += 1 / 60) model.update(1 / 60, { ...idle, ...input })
}
const beside = (model: ScrollDungeonModel, col: number, row: number) => { model.x = col - 0.5; model.y = row + 0.5 }

function reachesArtifact(model: ScrollDungeonModel): boolean {
  const def = model.definition
  const queue = [def.spawn]
  const seen = new Set([`${def.spawn.col},${def.spawn.row}`])
  for (let index = 0; index < queue.length; index++) {
    const here = queue[index]
    if (here.col === def.artifact.col && here.row === def.artifact.row) return true
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const col = here.col + dx, row = here.row + dy
      const key = `${col},${row}`
      if (!seen.has(key) && model.walkable(col, row)) { seen.add(key); queue.push({ col, row }) }
    }
  }
  return false
}

describe('scrolling inscription dungeons', () => {
  it('walks on both axes, has no gravity, and cannot cross a closed rune gate even after a long frame', () => {
    const model = new ScrollDungeonModel(0)
    const startY = model.y
    wait(model, 1, { right: true })
    expect(model.x).toBeGreaterThan(7)
    expect(model.y).toBe(startY)
    wait(model, 0.5, { down: true })
    expect(model.y).toBeGreaterThan(startY + 1)
    beside(model, 14, 6)
    wait(model, 4, { right: true })
    model.update(50, { ...idle, right: true })
    expect(model.x).toBeLessThanOrEqual(13.75)
    expect(model.y).toBe(6.5)
    expect(model.openGates.size).toBe(0)
  })

  it('requires nearby reading, resets a wrong sequence, and opens the garden gate only in the taught order', () => {
    const model = new ScrollDungeonModel(0)
    const gate = model.definition.gates[0]
    beside(model, gate.col, gate.row)
    expect(model.interact(gate.id).kind).toBe('hint')
    expect(model.choose(gate.id, 'rain').opened).toBe(false)
    beside(model, gate.clue.col, gate.clue.row)
    expect(model.interact(`clue-${gate.id}`).kind).toBe('clue')
    expect(model.readClues.has(gate.id)).toBe(true)
    beside(model, gate.col, gate.row)
    expect(model.interact(gate.id).kind).toBe('gate')
    model.choose(gate.id, 'rain')
    expect(model.choose(gate.id, 'bloom').opened).toBe(false)
    expect(model.progress.get(gate.id)).toEqual([])
    for (const rune of gate.answer.slice(0, -1)) expect(model.choose(gate.id, rune).opened).toBe(false)
    expect(model.choose(gate.id, gate.answer.at(-1)!).opened).toBe(true)
    expect(model.walkable(gate.col, gate.row)).toBe(true)
    wait(model, 0.5, { right: true })
    expect(model.x).toBeGreaterThan(14.5)
  })

  it.each([0, 2])('keeps the %i artifact behind both puzzles and makes it reachable after their clue solutions', index => {
    const model = new ScrollDungeonModel(index)
    expect(reachesArtifact(model)).toBe(false)
    for (const gate of model.definition.gates) {
      beside(model, gate.clue.col, gate.clue.row)
      model.interact(`clue-${gate.id}`)
      beside(model, gate.col, gate.row)
      for (const answer of gate.answer) model.choose(gate.id, answer)
    }
    expect(reachesArtifact(model)).toBe(true)
    expect(model.discovered.size).toBe(2)
    // Every clue is itself reachable before its corresponding closed gate.
    const first = model.definition.gates[0]
    expect(first.clue.col).toBeLessThan(first.col)
    expect(model.definition.gates[1].clue.col).toBeLessThan(model.definition.gates[1].col)
  })

  it('uses the permanent hexagon to reveal a side memory without consuming it', () => {
    const has = vi.fn(() => true)
    const model = new ScrollDungeonModel(2, has)
    beside(model, model.definition.alcove.col, model.definition.alcove.row)
    const once = model.interact('alcove')
    const twice = model.interact('alcove')
    expect(once).toEqual(twice)
    expect(has).toHaveBeenCalledWith({ kind: 'hexagon' })
    expect(model.discovered.size).toBe(1)
  })

  it('notifies artifact completion once, blocks interaction at a distance, and tears down its DOM', () => {
    const onComplete = vi.fn(), onKnowledge = vi.fn()
    const host = document.createElement('div')
    const view = new ScrollDungeonView({ index: 0, has: () => false, onComplete, onKnowledge })
    view.mount(host)
    expect(host.querySelector('canvas.sd-ground')).not.toBeNull()
    expect(host.querySelectorAll('.sd-feature')).toHaveLength(7)
    const artifact = host.querySelector<HTMLButtonElement>('[aria-label="Knowledge artifact"]')!
    artifact.click()
    expect(onComplete).not.toHaveBeenCalled()
    view.closeDialog()
    beside(view.model, view.model.definition.artifact.col, view.model.definition.artifact.row)
    view.interact()
    expect(view.isDialogOpen).toBe(true)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onKnowledge).toHaveBeenCalledWith('wayfarer-spring', view.model.definition.lore)
    view.closeDialog()
    view.interact()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onKnowledge).toHaveBeenCalledTimes(1)
    view.dispose()
    expect(host.children).toHaveLength(0)
  })

  it('lets the adventure return to the world from completion without recreating a hidden dialog', () => {
    const host = document.createElement('div')
    const view = new ScrollDungeonView({
      index: 2, has: () => false,
      onComplete: () => view.closeDialog(),
    })
    view.mount(host)
    beside(view.model, view.model.definition.artifact.col, view.model.definition.artifact.row)
    view.interact()
    expect(view.isDialogOpen).toBe(false)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    view.dispose()
  })
})
