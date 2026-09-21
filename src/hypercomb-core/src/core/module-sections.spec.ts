// module-sections.spec.ts — a bundle's `// src/…` headers slice it into
// sections a source path can name, read, and replace.

import { describe, expect, it } from 'vitest'
import { isSectionPath, replaceSection, sectionIndex, sectionOf } from './module-sections'

const MODULE = [
  'import { Drone } from "@hypercomb/core";',
  '',
  '// src/games/solomon/labyrinth.ts',
  'var LabyrinthJourney = class {',
  '  leave() {}',
  '};',
  '',
  '// src/games/solomon/labyrinth-view.ts',
  'var view = 1;',
  '  // src/not/a/header.ts',
  '// src/games/solomon/solomon.drone.ts',
  'export { SolomonDrone };',
].join('\n')

describe('module sections', () => {
  it('indexes every column-0 header in file order, with offsets that tile the text', () => {
    const index = sectionIndex(MODULE)
    expect(index.map(section => section.path)).toEqual([
      'src/games/solomon/labyrinth.ts', 'src/games/solomon/labyrinth-view.ts', 'src/games/solomon/solomon.drone.ts',
    ])
    expect(index[0].lines).toBe(5)
    expect(index[1].lines).toBe(3)
    expect(index[2].to).toBe(MODULE.length)
    for (let i = 1; i < index.length; i++) expect(index[i].from).toBe(index[i - 1].to)
    expect(sectionIndex('no headers here')).toEqual([])
  })

  it('reads one section by its source path, header included', () => {
    const section = sectionOf(MODULE, 'src/games/solomon/labyrinth-view.ts')!
    expect(MODULE.slice(section.from, section.to)).toBe('// src/games/solomon/labyrinth-view.ts\nvar view = 1;\n  // src/not/a/header.ts\n')
    expect(sectionOf(MODULE, 'src/nowhere.ts')).toBeNull()
  })

  it('replaces a section body and leaves every other byte where it was', () => {
    const next = replaceSection(MODULE, 'src/games/solomon/labyrinth.ts', 'var LabyrinthJourney = class {\n  leave() { this.fresh = true }\n};\n\n\n')!
    expect(next).toBe([
      'import { Drone } from "@hypercomb/core";',
      '',
      '// src/games/solomon/labyrinth.ts',
      'var LabyrinthJourney = class {',
      '  leave() { this.fresh = true }',
      '};',
      '// src/games/solomon/labyrinth-view.ts',
      'var view = 1;',
      '  // src/not/a/header.ts',
      '// src/games/solomon/solomon.drone.ts',
      'export { SolomonDrone };',
    ].join('\n'))
    expect(sectionIndex(next).map(section => section.path)).toEqual(sectionIndex(MODULE).map(section => section.path))
    // The last section, and an empty body, both keep the header.
    expect(replaceSection(MODULE, 'src/games/solomon/solomon.drone.ts', '')).toBe(MODULE.replace('export { SolomonDrone };', ''))
    expect(replaceSection(MODULE, 'src/nowhere.ts', 'x')).toBeNull()
  })

  it('accepts only bounded source paths', () => {
    expect(isSectionPath('src/games/solomon/labyrinth.ts')).toBe(true)
    expect(isSectionPath('src/a')).toBe(true)
    expect(isSectionPath('games/solomon/labyrinth.ts')).toBe(false)
    expect(isSectionPath('src/../x.ts')).toBe(true) // dots are legal in names; a header simply never carries it
    expect(isSectionPath('src/a b.ts')).toBe(false)
    expect(isSectionPath('src/')).toBe(false)
    expect(isSectionPath(42)).toBe(false)
  })
})
