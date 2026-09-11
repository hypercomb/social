import { describe, expect, it, vi } from 'vitest'
import { ScrollDungeonModel, ScrollDungeonView } from './scroll-dungeon.js'

function read(model: ScrollDungeonModel, id: string): void {
  const gate = model.definition.gates.find(gate => gate.id === id)!
  model.x = gate.clue.col + 0.5; model.y = gate.clue.row + 0.5
  model.interact(`clue-${id}`)
  model.x = gate.col - 0.5; model.y = gate.row + 0.5
}

function completed(): ScrollDungeonModel {
  const model = new ScrollDungeonModel(0, () => true)
  for (const gate of model.definition.gates) {
    read(model, gate.id)
    for (const rune of gate.answer) model.choose(gate.id, rune)
  }
  model.x = model.definition.alcove.col + 0.5; model.y = model.definition.alcove.row + 0.5
  model.interact('alcove')
  model.x = model.definition.artifact.col + 0.5; model.y = model.definition.artifact.row + 0.5
  model.interact('artifact')
  return model
}

describe('scrolling dungeon save snapshots', () => {
  it('round-trips a partial rune sequence and can finish it after restoration', () => {
    const model = new ScrollDungeonModel(0)
    read(model, 'cycle'); model.choose('cycle', 'rain')
    const saved = model.exportState()
    const restored = new ScrollDungeonModel(0)
    restored.restoreState(JSON.parse(JSON.stringify(saved)))
    expect(restored.exportState()).toEqual(saved)
    expect(restored.choose('cycle', 'sun').opened).toBe(false)
    expect(restored.choose('cycle', 'bloom').opened).toBe(true)
    expect(restored.walkable(14, 6)).toBe(true)
    expect(model.walkable(14, 6)).toBe(false)
    saved.progress[0][1].push('forged'); saved.player.x = -10
    expect(model.progress.get('cycle')).toEqual(['rain'])
    expect(restored.x).toBe(13.5)
  })

  it('restores open gates before checking an occupied doorway and keeps authored maps and lore', () => {
    const model = completed()
    model.x = 14.5; model.y = 6.5
    const saved = model.exportState()
    saved.discovered = saved.discovered.map(([id]) => [id, '<img src=x onerror=bad()>'])
    const restored = new ScrollDungeonModel(0, () => true)
    const tiles = restored.definition.tiles.slice()
    restored.restoreState({ ...saved, tiles: ['malicious replacement'] })
    expect(restored.definition.tiles).toEqual(tiles)
    expect(restored.x).toBe(14.5)
    expect(restored.complete).toBe(true)
    expect(restored.discovered.get(restored.definition.knowledgeId)).toBe(restored.definition.lore)
    expect([...restored.discovered.values()].some(text => text.includes('<img'))).toBe(false)
    expect(restored.exportState()).toEqual(model.exportState())
  })

  it('rejects unknown gates, unread progress, invalid prefixes and unowned side memories', () => {
    const model = new ScrollDungeonModel(0)
    model.restoreState({
      version: 1, dungeonId: 'wayfarer-cavern', player: { x: 14.5, y: 6.5 },
      readClues: ['cycle', 'unknown'], openGates: ['meaning', 'unknown'],
      progress: [['cycle', ['bloom']], ['meaning', ['circle']], ['unknown', ['rain']]],
      discovered: [['wayfarer-cavern-center-memory', 'forged'], ['unknown', 'forged']], complete: true,
    })
    expect([...model.readClues]).toEqual(['cycle'])
    expect(model.openGates.size).toBe(0)
    expect(model.progress.size).toBe(0)
    expect([...model.discovered.keys()]).toEqual(['wayfarer-cavern-cycle'])
    expect(model.complete).toBe(false)
    expect([model.x, model.y]).toEqual([3.5, 6.5])
  })

  it.each([{ x: 5.5, y: 3.5 }, { x: -1, y: 6.5 }, { x: NaN, y: 6 }, { x: 3, y: Infinity }])('rejects blocked and nonfinite positions %j', player => {
    const model = new ScrollDungeonModel(0)
    model.restoreState({ version: 1, dungeonId: model.definition.id, player })
    expect([model.x, model.y]).toEqual([3.5, 6.5])
  })

  it('clears a previous slot for invalid versions or snapshots from a different dungeon', () => {
    const model = completed()
    model.moving = true
    model.restoreState(new ScrollDungeonModel(2).exportState())
    expect(model.exportState()).toEqual(new ScrollDungeonModel(0).exportState())
    expect(model.moving).toBe(false)
    read(model, 'cycle')
    model.restoreState({ version: 99, dungeonId: model.definition.id })
    expect(model.readClues.size).toBe(0)
  })

  it('restores a mounted view without a dialog or repeating saved discoveries and completion', () => {
    const onComplete = vi.fn(), onKnowledge = vi.fn()
    const host = document.createElement('div')
    const view = new ScrollDungeonView({ index: 0, has: () => true, onComplete, onKnowledge })
    try {
      view.mount(host); view.interact()
      expect(view.isSpeaking).toBe(true)
      view.restoreState(completed().exportState())
      expect(view.isSpeaking).toBe(false)
      expect(view.isDialogOpen).toBe(false)
      expect(host.querySelectorAll('.sd-gate.sd-open')).toHaveLength(2)
      expect(view.model.moving).toBe(false)
      view.interact()
      expect(onComplete).not.toHaveBeenCalled()
      expect(onKnowledge).not.toHaveBeenCalled()
      // A fresh slot can earn the reward again; suppression belongs to its slot.
      view.restoreState(new ScrollDungeonModel(0).exportState())
      view.model.x = view.model.definition.artifact.col + 0.5
      view.model.y = view.model.definition.artifact.row + 0.5
      view.interact()
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onKnowledge).toHaveBeenCalledTimes(1)
    } finally { view.dispose() }
  })
})
