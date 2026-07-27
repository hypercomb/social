import { describe, expect, it } from 'vitest'
import {
  inWaggleArea,
  kindFor,
  waggleFor,
  waggleOffset,
  wagglePath,
  type AgentKind,
} from './agent-waggle.js'
import { MODEL_BEHAVIORS } from './agent-model.js'

const KINDS: AgentKind[] = ['model', 'script', 'system', 'orchestrator']

describe('kindFor', () => {
  it('takes a declared kind over any guess', () => {
    expect(kindFor({ kind: 'system', behavior: 'opus' })).toBe('system')
  })

  it('reads every model behaviour as a model', () => {
    for (const behavior of MODEL_BEHAVIORS) expect(kindFor({ behavior })).toBe('model')
  })

  it('reads an ask carrying a model hint as a model, whatever the behaviour is called', () => {
    expect(kindFor({ behavior: 'ask', model: 'sonnet' })).toBe('model')
  })

  it('reads the sync lane as system', () => {
    expect(kindFor({ behavior: 'sync' })).toBe('system')
    expect(kindFor({ behavior: 'bundled', id: 'sync:bundled' })).toBe('system')
  })

  it('reads the orchestrator as itself', () => {
    expect(kindFor({ behavior: 'orchestrator' })).toBe('orchestrator')
  })

  it('falls back to script — anything not an AI is a script, not a model', () => {
    expect(kindFor({ behavior: 'website' })).toBe('script')
    expect(kindFor({})).toBe('script')
  })

  it('ignores a kind it does not recognise rather than trusting it', () => {
    expect(kindFor({ kind: 'nonsense', behavior: 'haiku' })).toBe('model')
  })
})

describe('waggle patterns', () => {
  it('keeps the tutorial figure-8 for models — 30 across, 11 down, 1:2', () => {
    // The dance Jaime picked. If this changes, it was changed on purpose.
    expect(waggleOffset('model', 0, 0, 1)).toEqual({ x: 0, y: 0 })
    const quarter = waggleOffset('model', Math.PI / 2 / 7.4, 0, 1)
    expect(quarter.x).toBeCloseTo(30, 5)
    // Twice the frequency vertically is what makes it an 8 and not an ellipse.
    expect(Math.abs(quarter.y)).toBeLessThan(1e-6)
  })

  it('scales the whole dance by intensity — a waiting bee barely moves', () => {
    const full = waggleOffset('model', 0.3, 0, 1)
    const quiet = waggleOffset('model', 0.3, 0, 0.25)
    expect(quiet.x).toBeCloseTo(full.x * 0.25, 6)
    expect(quiet.y).toBeCloseTo(full.y * 0.25, 6)
  })

  it('clamps intensity so a caller cannot inflate the dance off screen', () => {
    expect(waggleOffset('model', 0.3, 0, 9)).toEqual(waggleOffset('model', 0.3, 0, 1))
    const stopped = waggleOffset('model', 0.3, 0, -3)
    expect(Math.abs(stopped.x)).toBe(0)
    expect(Math.abs(stopped.y)).toBe(0)
  })

  it('gives every kind its own shape, and none of them a still one', () => {
    for (const kind of KINDS) {
      const samples = [0, 0.1, 0.2, 0.3, 0.4].map(t => waggleOffset(kind, t, 0, 1))
      const spread = Math.max(...samples.map(s => s.x)) - Math.min(...samples.map(s => s.x))
      expect(spread).toBeGreaterThan(1)
    }
    const shapes = KINDS.map(k => JSON.stringify(waggleFor(k).reach))
    expect(new Set(shapes).size).toBe(KINDS.length)
  })

  it('the orchestrator dances the same figure-8, wider and slower', () => {
    expect(waggleFor('orchestrator').reach.x).toBeGreaterThan(waggleFor('model').reach.x * 2)
    // Slower: at the model's quarter-turn the orchestrator is nowhere near its own.
    const t = Math.PI / 2 / 7.4
    expect(Math.abs(waggleOffset('orchestrator', t, 0, 1).x)).toBeLessThan(waggleFor('orchestrator').reach.x * 0.6)
  })

  it('never leaves its own reach', () => {
    for (const kind of KINDS) {
      const { reach } = waggleFor(kind)
      for (let t = 0; t < 12; t += 0.01) {
        const point = waggleOffset(kind, t, 1.3, 1)
        expect(Math.abs(point.x)).toBeLessThanOrEqual(reach.x + 1e-6)
        expect(Math.abs(point.y)).toBeLessThanOrEqual(reach.y + 1e-6)
      }
    }
  })
})

describe('wagglePath', () => {
  it('traces a closed loop for every kind', () => {
    for (const kind of KINDS) {
      const path = wagglePath(kind, 64)
      expect(path).toHaveLength(64)
      const first = path[0]
      const last = path[path.length - 1]
      const gap = Math.hypot(last.x - first.x, last.y - first.y)
      const { reach } = waggleFor(kind)
      // The last sample sits one step short of closing — within a step of the
      // start, not halfway across the figure.
      expect(gap).toBeLessThan(Math.max(reach.x, reach.y) * 0.5)
    }
  })

  it('stays inside the area the hit test uses', () => {
    for (const kind of KINDS) {
      for (const point of wagglePath(kind, 96)) {
        expect(inWaggleArea(kind, point.x, point.y)).toBe(true)
      }
    }
  })
})

describe('inWaggleArea', () => {
  it('accepts the centre and a near miss, rejects a far one', () => {
    expect(inWaggleArea('model', 0, 0)).toBe(true)
    expect(inWaggleArea('model', 38, 0)).toBe(true)   // within reach + margin
    expect(inWaggleArea('model', 90, 0)).toBe(false)
  })

  it('gives the orchestrator the widest target — it is the least urgent to hit precisely', () => {
    expect(inWaggleArea('orchestrator', 80, 0)).toBe(true)
    expect(inWaggleArea('script', 80, 0)).toBe(false)
  })
})
