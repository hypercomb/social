import { describe, expect, it, vi } from 'vitest'
import { RpgOverworld, RpgOverworldView, componentKey, type WorldHooks } from './rpg-overworld.js'

function setup(owned = ['triangle:0']) {
  const inventory = new Set(owned)
  const hooks: WorldHooks = {
    has: piece => inventory.has(componentKey(piece)),
    grantRelic: vi.fn(piece => inventory.add(componentKey(piece))), onEnter: vi.fn(), onDungeon: vi.fn(), onMessage: vi.fn(),
  }
  return { hooks, model: new RpgOverworld(hooks) }
}

describe('world save snapshots', () => {
  it('round-trips the player, conversations, knowledge and individual shrine sockets without replaying rewards', () => {
    const { hooks, model } = setup()
    model.answer('mira', 1)
    Object.assign(model.player, { x: 8, y: 4, facing: 'left' })
    model.fillSocket('dawn-shrine', 0)
    const snapshot = model.exportState()
    const restored = new RpgOverworld(hooks)
    restored.restoreState(JSON.parse(JSON.stringify(snapshot)))
    expect(restored.exportState()).toEqual(snapshot)
    expect(hooks.grantRelic).not.toHaveBeenCalled()
    expect(hooks.onEnter).not.toHaveBeenCalled()
    snapshot.player.x = 999; snapshot.met.push('unknown'); snapshot.filledSockets.length = 0
    expect(restored.player.x).toBe(8)
    expect(model.filledSockets.has('dawn-shrine:0')).toBe(true)
    expect(model.met.has('unknown')).toBe(false)
  })

  it('validates owned pieces and known IDs while preserving an available first-reward conversation', () => {
    const { model } = setup([])
    model.restoreState({
      version: 1, player: { x: 5, y: 11, facing: 'up' },
      met: ['mira', '<script>bad()</script>'], solved: ['mira', 'invented'],
      journal: ['person:mira', 'triangle:0', 'star', '<img onerror=bad()>'],
      filledSockets: ['dawn-shrine:0', 'pyramid-shrine:6', 'invented:0'],
    })
    expect([...model.met]).toEqual(['mira'])
    expect([...model.solved]).toEqual([])
    expect([...model.journal]).toEqual(['person:mira'])
    expect([...model.filledSockets]).toEqual([])
    expect(model.answer('mira', 1).ok).toBe(true)
  })

  it.each([{ x: 4.5, y: 4.5 }, { x: -1, y: 12 }, { x: NaN, y: 8 }, { x: Infinity, y: 12 }])('rejects invalid or blocked world positions %j', player => {
    const { model } = setup()
    model.restoreState({ version: 1, player: { ...player, facing: 'diagonal' } })
    expect(model.player).toEqual({ x: 4, y: 12, facing: 'down' })
  })

  it('replaces all old slot facts and resets unsupported versions', () => {
    const { model } = setup()
    model.answer('mira', 1)
    Object.assign(model.player, { x: 8, y: 4 })
    model.fillSocket('dawn-shrine', 0)
    model.restoreState({ version: 1, player: { x: 10, y: 12, facing: 'right' }, met: ['oren'] })
    expect(model.player).toEqual({ x: 10, y: 12, facing: 'right' })
    expect([...model.met]).toEqual(['oren'])
    expect(model.solved.size).toBe(0)
    expect(model.filledSockets.size).toBe(0)
    model.restoreState({ version: 2, player: { x: 10, y: 12 } })
    expect(model.exportState()).toEqual(new RpgOverworld(model.hooks).exportState())
  })

  it('restores the mounted view without a conversation or entry action', () => {
    const { hooks } = setup()
    const host = document.createElement('div')
    const view = new RpgOverworldView(hooks)
    try {
      view.mount(host); view.interact()
      expect(view.isDialogOpen).toBe(true)
      view.restoreState({ version: 1, player: { x: 9, y: 12, facing: 'right' } })
      expect(view.isDialogOpen).toBe(false)
      expect(view.exportState().player).toEqual({ x: 9, y: 12, facing: 'right' })
      expect(host.querySelector('.sol-rpg-world-prompt')?.textContent).toContain('Wayfarer Cavern')
      expect(hooks.onDungeon).not.toHaveBeenCalled()
    } finally { view.dispose() }
  })
})
