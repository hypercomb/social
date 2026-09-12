import { describe, expect, it, vi } from 'vitest'
import { RpgOverworld, RpgOverworldView, WORLD_SHRINES, WORLD_START, componentKey, valleyPoint, type WorldHooks } from './rpg-overworld.js'

const dawn = { x: WORLD_SHRINES[0].x, y: WORLD_SHRINES[0].y }

function setup(owned = ['triangle:0']) {
  const inventory = new Set(owned)
  const hooks: WorldHooks = {
    has: piece => inventory.has(componentKey(piece)),
    grantRelic: vi.fn(piece => inventory.add(componentKey(piece))), seat: vi.fn(() => true), onEntrance: vi.fn(), onMessage: vi.fn(),
  }
  return { hooks, model: new RpgOverworld(hooks) }
}

describe('world save snapshots', () => {
  it('round-trips the player, conversations, knowledge and individual shrine sockets without replaying rewards', () => {
    const { hooks, model } = setup()
    model.answer('mira', 1)
    Object.assign(model.player, { ...dawn, facing: 'left' })
    model.fillSocket('dawn-shrine', 0)
    const snapshot = model.exportState()
    const restored = new RpgOverworld(hooks)
    restored.restoreState(JSON.parse(JSON.stringify(snapshot)))
    expect(restored.exportState()).toEqual(snapshot)
    expect(hooks.grantRelic).not.toHaveBeenCalled()
    expect(hooks.onEntrance).not.toHaveBeenCalled()
    snapshot.player.x = 999; snapshot.met.push('unknown'); snapshot.filledSockets.length = 0
    expect(restored.player.x).toBe(dawn.x)
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
    expect(model.player).toEqual({ ...WORLD_START, facing: 'down' })
  })

  it('replaces all old slot facts and resets unsupported versions', () => {
    const { model } = setup()
    model.answer('mira', 1)
    Object.assign(model.player, dawn)
    model.fillSocket('dawn-shrine', 0)
    model.restoreState({ version: 1, player: { x: 10, y: 12, facing: 'right' }, met: ['oren'] })
    expect(model.player).toEqual({ ...valleyPoint(10, 12), facing: 'right' })
    expect([...model.met]).toEqual(['oren'])
    expect(model.solved.size).toBe(0)
    expect(model.filledSockets.size).toBe(0)
    model.restoreState({ version: 3, player: { x: 10, y: 12 } })
    expect(model.exportState()).toEqual(new RpgOverworld(model.hooks).exportState())
  })

  it('restores island positions from version 2 saves and keeps version 1 positions inside the valley they were written on', () => {
    const { model } = setup()
    model.restoreState({ version: 2, player: { x: 84, y: 142, facing: 'up' } })
    expect(model.player).toEqual({ x: 84, y: 142, facing: 'up' })
    model.restoreState({ version: 1, player: { x: 84, y: 142, facing: 'up' } })
    expect(model.player).toEqual({ ...WORLD_START, facing: 'up' })
  })

  it('restores the mounted view without a conversation or entry action', () => {
    const { hooks } = setup()
    const host = document.createElement('div')
    const view = new RpgOverworldView(hooks)
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    try {
      view.mount(host); view.interact()
      expect(view.isSpeaking).toBe(true)
      view.restoreState({ version: 1, player: { x: 9, y: 12, facing: 'right' } })
      expect(view.isSpeaking).toBe(false)
      expect(view.isDialogOpen).toBe(false)
      expect(view.exportState().player).toEqual({ ...valleyPoint(9, 12), facing: 'right' })
      expect(host.querySelector('.sol-rpg-cue')?.textContent).toContain('Wayfarer Cavern')
      expect(hooks.onEntrance).not.toHaveBeenCalled()
    } finally { view.dispose(); context.mockRestore() }
  })
})
