// commands/translation.write-surface.spec.ts
//
// A translation lands on the TILE'S LAYER through the one canonical props
// writer — never as a props blob whose only pointer is the device-local
// index (write-conformance checks 1 and 3). The service's dependencies are
// live LLM calls, so this is a mechanical guard on the write shape.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(
  join(process.cwd(), 'hypercomb-essentials', 'src', 'commands', 'translation.service.ts'), 'utf8',
)
const code = src.split(/\r?\n/).filter(l => !l.trimStart().startsWith('//')).join('\n')

describe('translation writes', () => {
  it('go through writeTilePropertiesAt — the layer, the cascade, the marker', () => {
    expect(code.includes("writeTilePropertiesAt(sweepSegments, tileName, { translations: props['translations'] })")).toBe(true)
  })

  it('never mint a props blob of their own, and never write the device-local index', () => {
    // the only putResource calls left store the translated TEXT itself — the
    // single-string path and the batch path — which IS content
    const puts = code.match(/store\.putResource\(/g) ?? []
    expect(puts.length).toBe(2)
    expect(code.includes('localStorage.setItem(PROPS_INDEX_KEY')).toBe(false)
    expect(code.includes('lookupTilePropsSig')).toBe(false)
  })

  it('read the tile\'s effective properties from its layer, not from the index', () => {
    expect(code.includes('readTilePropertiesAt(')).toBe(true)
  })
})
