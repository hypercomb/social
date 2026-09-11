import { describe, expect, it } from 'vitest'
import { DOOR_SHAPES, doorHue, doorShape } from './labyrinth-view.js'
import { ROOMS } from './labyrinth.js'

describe('doors', () => {
  it('gives every room a hue and a shape of its own, the same from either side', () => {
    for (const room of ROOMS) {
      const hue = doorHue(room.id)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(doorHue(room.id)).toBe(hue)
      expect(DOOR_SHAPES).toContain(doorShape(room.id))
    }
    // Within one labyrinth, no two rooms look alike: siblings differ in hue by
    // a clear step, or in shape.
    for (const labyrinth of ['sunseed', 'tideglass', 'starbloom']) {
      const rooms = ROOMS.filter(room => room.labyrinthId === labyrinth)
      for (const a of rooms) for (const b of rooms) {
        if (a === b) continue
        const gap = Math.abs(doorHue(a.id) - doorHue(b.id))
        expect(Math.min(gap, 360 - gap) >= 20 || doorShape(a.id) !== doorShape(b.id), `${a.id} vs ${b.id}`).toBe(true)
      }
    }
    // A room the authored set does not know still gets a stable hue.
    expect(doorHue('someone-elses-shrine')).toBe(doorHue('someone-elses-shrine'))
  })
})
