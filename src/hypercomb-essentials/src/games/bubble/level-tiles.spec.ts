// A level in words and pictures must be the SAME level the DOS data decodes to:
// every cell byte, every enemy field, for all 100 rounds.

import { describe, it, expect } from 'vitest'
import { BUILTIN_LEVELS } from './levels.js'
import {
  GROUP_ABOVE, decodeLevel, encodeLevel, levelName, placeEnemies, validEnemy, validLevel,
} from './level-tiles.js'

const SHA = 'a'.repeat(64)

describe('level tiles', () => {
  it('names a level by its round number', () => {
    expect(levelName(0)).toBe('level-001')
    expect(levelName(99)).toBe('level-100')
  })

  it('round-trips every one of the 100 rounds without losing a byte', () => {
    BUILTIN_LEVELS.forEach((seed, index) => {
      const { level, enemies } = encodeLevel(seed, index, SHA)
      expect(validLevel(level), `round ${index + 1} level record`).toBe(true)
      expect(enemies.every(validEnemy), `round ${index + 1} enemy records`).toBe(true)
      const back = decodeLevel(level, enemies)
      expect(back.nativeCells, `round ${index + 1} cells`).toEqual(seed.nativeCells)
      expect(back.tiles, `round ${index + 1} terrain`).toEqual(seed.tiles)
      expect(back.enemies, `round ${index + 1} enemies`).toEqual(seed.enemies)
      expect(back.spawn, `round ${index + 1} player`).toEqual(seed.spawn)
      expect(back.airflowSettings, `round ${index + 1} airflow`).toEqual(seed.airflowSettings)
    })
  })

  it('reads as a picture: walls, platforms and air, with the drift beside it', () => {
    const { level } = encodeLevel(BUILTIN_LEVELS[0], 0, SHA)
    expect(level.map).toHaveLength(25)
    expect(level.map.every(row => row.length === 32)).toBe(true)
    expect(level.map[0].startsWith('##')).toBe(true)
    expect(level.flow.every(row => /^[\^>v<]{32}$/.test(row))).toBe(true)
  })

  it('lets a person turn an enemy by editing `faces`, and keeps the rest of its native code', () => {
    const { level, enemies } = encodeLevel(BUILTIN_LEVELS[0], 0, SHA)
    const turned = enemies.map((enemy, i) => i === 0 ? { ...enemy, faces: enemy.faces === 'right' ? 'left' as const : 'right' as const } : enemy)
    const first = decodeLevel(level, turned).enemies[0]
    const was = BUILTIN_LEVELS[0].enemies[0].headingCode!
    expect(first.headingCode! & 1).toBe(was & 1 ? 0 : 1)
    expect(first.headingCode! >> 1).toBe(was >> 1)
  })

  it('refuses a malformed level or enemy', () => {
    const { level, enemies } = encodeLevel(BUILTIN_LEVELS[0], 0, SHA)
    expect(() => decodeLevel({ ...level, map: level.map.slice(1) }, enemies)).toThrow(/not a compatible/)
    expect(() => decodeLevel(level, [{ ...enemies[0], kind: 'dragon' }])).toThrow(/enemy tile/)
    expect(() => decodeLevel(level, [enemies[0], enemies[0]])).toThrow(/duplicate/)
  })

  it('keeps a small level flat and groups a big one by kind', () => {
    const base = encodeLevel(BUILTIN_LEVELS[0], 0, SHA).enemies[0]
    const few = Array.from({ length: GROUP_ABOVE }, (_, order) => ({ ...base, order }))
    expect(placeEnemies(few).every(place => place.path.length === 1 && place.record)).toBe(true)

    const many = Array.from({ length: GROUP_ABOVE + 1 }, (_, order) => ({ ...base, order }))
    const placed = placeEnemies(many)
    expect(placed.filter(place => place.group)).toEqual([{ path: [base.kind], group: base.kind }])
    expect(placed.filter(place => place.record).every(place => place.path.length === 2 && place.path[0] === base.kind)).toBe(true)
    expect(placed.filter(place => place.record).map(place => place.path[1])).toEqual(
      many.map((_, i) => `${base.kind}-${i + 1}`))
  })
})
