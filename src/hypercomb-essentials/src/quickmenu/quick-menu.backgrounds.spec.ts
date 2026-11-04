// quick-menu.backgrounds.spec.ts — the ten crafted backgrounds as wired:
// quick-menu.backgrounds.ts hands them over in order, each keeps the contract
// (quick-menu.honey-art.ts honeyBackgroundProblems), and no two share an id or
// a picture, so all ten can live in one document and every ring is ten-way.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HONEY_BACKGROUNDS } from './quick-menu.backgrounds.js'
import { HONEY_BACKGROUND_COUNT } from './quick-menu.honey.js'
import { honeyBackgroundProblems } from './quick-menu.honey-art.js'

describe('quick-menu.backgrounds.ts', () => {
  it('hands over ten, in order honey-01 to honey-10', () => {
    expect(HONEY_BACKGROUNDS).toHaveLength(HONEY_BACKGROUND_COUNT)
    expect(HONEY_BACKGROUNDS.map(b => b.id)).toEqual(
      Array.from({ length: HONEY_BACKGROUND_COUNT }, (_, i) => `honey-${String(i + 1).padStart(2, '0')}`),
    )
  })

  it('names every variation file in backgrounds/, each once', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const files = readdirSync(join(here, 'backgrounds')).filter(f => /^honey-\d\d-.+\.ts$/.test(f) && !f.endsWith('.spec.ts')).sort()
    expect(files).toHaveLength(HONEY_BACKGROUND_COUNT)
    const list = readFileSync(join(here, 'quick-menu.backgrounds.ts'), 'utf8')
    for (const f of files) {
      const nn = f.slice(6, 8)
      expect(list, f).toContain(`import { HONEY_BACKGROUND_${nn} } from './backgrounds/${f.replace(/\.ts$/, '.js')}'`)
    }
  })

  it('every one keeps the contract', () => {
    HONEY_BACKGROUNDS.forEach((background, i) => {
      expect(honeyBackgroundProblems(background, i + 1), background.id).toEqual([])
    })
  })

  it('no two share a name, an element id or a picture', () => {
    expect(new Set(HONEY_BACKGROUNDS.map(b => b.name)).size).toBe(HONEY_BACKGROUND_COUNT)
    expect(new Set(HONEY_BACKGROUNDS.map(b => b.svg)).size).toBe(HONEY_BACKGROUND_COUNT)
    const ids = HONEY_BACKGROUNDS.flatMap(b => [...b.svg.matchAll(/\sid\s*=\s*"([^"]*)"/g)].map(m => m[1]))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
