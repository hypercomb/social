import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'tile-properties.ts'), 'utf8')

describe('tile properties Life Primitive boundary', () => {
  it('types nested artifact properties at the canonical writer', () => {
    expect(SRC).toMatch(/canonicalPropertyLifeReferences\(/)
    expect(SRC).toMatch(/ensureArtifactMeta!\('resource', sig, \{ relation \}\)/)
    expect(SRC).toMatch(/JSON\.stringify\(canonical\)/)
  })

  it('seeds the derived index with the committed properties incidence', () => {
    const commit = SRC.indexOf("commitSlotSet!(cellSegments, TILE_PROPERTIES_SLOT, [propSig])")
    const canonicalRead = SRC.indexOf('readTilePropsSigAt(parentSegments, cellName)', commit)
    const seed = SRC.indexOf('seedLayerKeyedTileProps(lockKey, canonicalPropRef ?? propSig)', canonicalRead)
    expect(commit).toBeGreaterThan(-1)
    expect(canonicalRead).toBeGreaterThan(commit)
    expect(seed).toBeGreaterThan(canonicalRead)
  })
})
