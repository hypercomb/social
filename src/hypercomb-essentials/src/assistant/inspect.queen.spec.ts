import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { ioc: { register: vi.fn(), get: vi.fn() } })
const { inspectTarget } = await import('./inspect.queen.js')

const sig = 'a'.repeat(64)

describe('inspectTarget', () => {
  it('alone, opens the one selected tile, else the page you stand on', () => {
    expect(inspectTarget('', ['games'], ['solomon'])).toEqual({ kind: 'tile', segments: ['games', 'solomon'] })
    expect(inspectTarget('', ['games'], ['a', 'b'])).toEqual({ kind: 'tile', segments: ['games'] })
    expect(inspectTarget('  ', [], [])).toEqual({ kind: 'tile', segments: [] })
  })

  it('reads a bare name on this page, and a leading slash from the root', () => {
    expect(inspectTarget('solomon', ['games'], [])).toEqual({ kind: 'tile', segments: ['games', 'solomon'] })
    expect(inspectTarget('/revolucion/journal', ['games'], [])).toEqual({ kind: 'tile', segments: ['revolucion', 'journal'] })
  })

  it('follows a word with code, and opens a module or one of its files by signature', () => {
    expect(inspectTarget('code tile:action', [], [])).toEqual({ kind: 'word', word: 'tile:action' })
    expect(inspectTarget(sig, [], [])).toEqual({ kind: 'section', sig })
    expect(inspectTarget(`${sig.toUpperCase()} games/solomon/labyrinth.ts`, [], [])).toEqual({ kind: 'section', sig, section: 'src/games/solomon/labyrinth.ts' })
  })

  it('reads "code" alone as a tile named code', () => {
    expect(inspectTarget('code', ['x'], [])).toEqual({ kind: 'tile', segments: ['x', 'code'] })
  })
})
