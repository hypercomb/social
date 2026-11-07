// How big the tile is drawn is the participant's own number: one document in a
// pool of its own, read by the desk synchronously, never written to localStorage.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SCALE_DEFAULT, SCALE_MAX, SCALE_MIN, clampScale, editorScale, parseEditorSize, setEditorScale } from './editor-size.js'

describe('the editor\'s size', () => {
  it('keeps a scale inside the slider\'s range, in whole percent steps', () => {
    expect(clampScale(1)).toBe(SCALE_DEFAULT)
    expect(clampScale(0.1)).toBe(SCALE_MIN)
    expect(clampScale(9)).toBe(SCALE_MAX)
    expect(clampScale(1.12)).toBeCloseTo(1.1, 10)
  })

  it('falls back to the usual size for anything that is not a number', () => {
    for (const value of [undefined, null, 'big', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampScale(value)).toBe(SCALE_DEFAULT)
    }
  })

  it('reads only a record with a number in it, and clamps what it reads', () => {
    expect(parseEditorSize({ scale: 1.2 })).toEqual({ scale: expect.closeTo(1.2, 10) })
    expect(parseEditorSize({ scale: 40 })).toEqual({ scale: SCALE_MAX })
    expect(parseEditorSize({})).toBeNull()
    expect(parseEditorSize({ scale: 'wide' })).toBeNull()
    expect(parseEditorSize(null)).toBeNull()
    expect(parseEditorSize([1])).toBeNull()
  })

  it('starts at the usual size and answers a change at once', () => {
    expect(editorScale()).toBe(SCALE_DEFAULT)
    setEditorScale(0.7)
    expect(editorScale()).toBeCloseTo(0.7, 10)
    setEditorScale(SCALE_DEFAULT)
    expect(editorScale()).toBe(SCALE_DEFAULT)
  })

  it('never writes localStorage', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, 'editor-size.ts'), 'utf8')
    expect(source).not.toMatch(/localStorage\s*\.\s*setItem/)
  })
})
