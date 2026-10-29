import { describe, expect, it } from 'vitest'
import {
  bootGrid, bootSpriteMaterial, bootSpriteSignature, spriteSliceStyle,
} from './boot-sprite.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

describe('boot sprite', () => {
  it('keys a screen by its pictures, independent of order and duplicates', async () => {
    expect(bootSpriteMaterial([SIG_B, SIG_A, SIG_A, 'nope'])).toBe(`${SIG_A}\n${SIG_B}`)
    expect(bootSpriteMaterial([])).toBe('')
    const first = await bootSpriteSignature([SIG_B, SIG_A])
    const second = await bootSpriteSignature([SIG_A, SIG_B, SIG_A])
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await bootSpriteSignature([])).toBeNull()
    expect(await bootSpriteSignature([SIG_A])).not.toBe(first)
  })

  it('slices the sheet so one cell fills the plate', () => {
    expect(bootGrid(0)).toEqual({ cols: 1, rows: 1, cell: 64 })
    expect(bootGrid(3)).toEqual({ cols: 3, rows: 1, cell: 64 })
    expect(bootGrid(10)).toEqual({ cols: 8, rows: 2, cell: 64 })
    expect(spriteSliceStyle(0, 1)).toEqual({ size: '100% 100%', position: '0% 0%' })
    expect(spriteSliceStyle(1, 3)).toEqual({ size: '300% 100%', position: '50% 0%' })
    expect(spriteSliceStyle(8, 10).position.endsWith('100%')).toBe(true)
  })
})
