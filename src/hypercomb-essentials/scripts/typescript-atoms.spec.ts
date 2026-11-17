// @vitest-environment node
//
// typescript-atoms.spec.ts — the package's own TypeScript as text atoms: the
// same tree makes the same bytes on any machine, every file is a section a
// reader can ask for, and the slots a set of layers carries are checked
// before a package is written.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sectionIndex, sectionOf } from '../../hypercomb-core/src/core/module-sections.js'
import { typescriptAtomFor, type TypescriptNode } from '../src/assistant/package-typescript.js'
import { isCarriedSource } from './source-filters.js'
import {
  TYPESCRIPT_STAGING, carriedFiles, foldSource, typescriptAtomText, typescriptAtoms, typescriptDigest, typescriptSlotErrors, unresolvedSections,
} from './typescript-atoms.js'

const LAZY = '// lazy — an atom: it loads through the import map when something imports it'
const sha = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex')
const keep = (rel: string): boolean => isCarriedSource(rel, ['excluded.com'])

const TREE: Record<string, string> = {
  'assistant/chat.ts': 'export const chat = 1\n',
  'assistant/anatomy/codex.ts': 'export type Codex = { tier: number }\n',
  'assistant/chat.spec.ts': 'import { it } from "vitest"\n',
  'assistant/index.ts': 'export * from "./chat.js"\n',
  'games/solomon/labyrinth.ts': '/* a block comment */ export const regex = /\\*\\//\nconst s = "*\\/"\n',
  'games/Zebra.ts': 'export const z = 1',
  'games/a-b.ts': 'export const ab = 1\n\n\n',
  'games/a_b.ts': 'export const a_b = 1\n',
  'loose/only-types.ts': 'export type Loose = string\n',
  'preload-effects.ts': 'export const preload = true\n',
  'essentials-keys.ts': 'export const KEYS = {}\n',
  'types/global.ts': 'declare const x: number\n',
  'excluded.com/a.ts': 'export const no = 1\n',
  'commands/words.json': '{}\n',
}
const CARRIED = [
  'src/assistant/anatomy/codex.ts', 'src/assistant/chat.ts',
  'src/games/Zebra.ts', 'src/games/a-b.ts', 'src/games/a_b.ts', 'src/games/solomon/labyrinth.ts',
  'src/loose/only-types.ts',
]
/** `loose` yields no layer, so its file is carried by name and held by no atom. */
const HELD = CARRIED.filter(path => !path.startsWith('src/loose/'))
const LAYERED = new Set(['assistant', 'games'])

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'typescript-atoms-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const plant = (dir: string, tree: Record<string, string>, order: (names: string[]) => string[] = names => names, eol = '\n'): string => {
  for (const rel of order(Object.keys(tree))) {
    const path = join(dir, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, tree[rel]!.replace(/\n/g, eol))
  }
  return dir
}
const atomsOf = (dir: string) => typescriptAtoms(carriedFiles(dir, keep), LAZY, LAYERED)

describe('carriedFiles', () => {
  it('keeps what the rule keeps, as section paths in code-unit order', () => {
    plant(root, { ...TREE, 'node_modules/pkg/a.ts': 'x', '.hidden/a.ts': 'x', 'games/has space.ts': 'x' })
    expect(carriedFiles(root, keep).map(file => file.path)).toEqual(CARRIED)
  })
})

describe('typescriptAtoms', () => {
  it('makes the same bytes whatever order the files were created in, and twice', () => {
    const forward = atomsOf(plant(join(root, 'forward'), TREE))
    const backward = atomsOf(plant(join(root, 'backward'), TREE, names => [...names].reverse()))
    expect(backward).toEqual(forward)
    expect(atomsOf(join(root, 'forward'))).toEqual(forward)
  })

  it('makes the same bytes from a CRLF checkout and an LF one', () => {
    expect(atomsOf(plant(join(root, 'crlf'), TREE, names => names, '\r\n'))).toEqual(atomsOf(plant(join(root, 'lf'), TREE)))
  })

  it('names one atom per layered folder, and none for the root or a folder that is no layer', () => {
    const atoms = atomsOf(plant(root, TREE))
    expect(atoms.map(atom => [atom.key, atom.name, atom.files])).toEqual([
      ['assistant', '@hypercomb/typescript/assistant', 2],
      ['games', '@hypercomb/typescript/games', 4],
    ])
    const text = atoms.map(atom => atom.text).join('')
    // A barrel directly in src/ is rewritten by prepare.ts and compiled by no
    // unit: carried, it would move the root from one checkout to the next.
    expect(text).not.toContain('preload')
    expect(text).not.toContain('only-types')
    // Even handed a root-level file, no atom takes it.
    const stray = [{ path: 'src/preload-effects.ts', abs: join(root, 'preload-effects.ts') }]
    expect(typescriptAtoms(stray, LAZY, LAYERED)).toEqual([])
    expect(typescriptAtoms(stray, LAZY, new Set(['']))).toEqual([])
  })

  it('every file is a section, in code-unit order, holding the file as written', () => {
    const atoms = atomsOf(plant(root, TREE))
    expect(atoms.flatMap(atom => sectionIndex(atom.text).map(section => section.path)).sort()).toEqual([...HELD].sort())
    const games = atoms.find(atom => atom.key === 'games')!
    expect(sectionIndex(games.text).map(section => section.path)).toEqual(['src/games/Zebra.ts', 'src/games/a-b.ts', 'src/games/a_b.ts', 'src/games/solomon/labyrinth.ts'])
    const section = sectionOf(games.text, 'src/games/solomon/labyrinth.ts')!
    // Not the knowledge atom's wrapper: `*/` and `*\/` survive byte for byte.
    expect(games.text.slice(section.from, section.to)).toBe(`// src/games/solomon/labyrinth.ts\n${TREE['games/solomon/labyrinth.ts']}`)
    // A file ends in exactly one newline, however it ended on disk.
    expect(games.text).toContain('// src/games/Zebra.ts\nexport const z = 1\n// src/games/a-b.ts\nexport const ab = 1\n// src/games/a_b.ts\n')
    expect(games.text.endsWith(TREE['games/solomon/labyrinth.ts']!)).toBe(true)
  })

  it('line 1 is the name, line 2 the lazy marker, line 3 no header', () => {
    for (const atom of atomsOf(plant(root, TREE))) {
      const lines = atom.text.split('\n')
      expect(lines[0]).toBe(`// ${atom.name}`)
      expect(lines[1]).toBe(LAZY)
      expect(lines[2]).toMatch(/^\/\/ TypeScript as written, never run: hypercomb-essentials\/src/)
      expect(sectionIndex(lines.slice(0, 3).join('\n'))).toEqual([])
    }
  })

  it('a source line that looks like a header is set off by one space and adds no section', () => {
    const text = typescriptAtomText('a', LAZY, [{ path: 'src/a/x.ts', text: 'const one = 1\n// src/a/fake.ts\nconst two = 2\n' }])
    expect(sectionIndex(text).map(section => section.path)).toEqual(['src/a/x.ts'])
    expect(text).toContain('\n // src/a/fake.ts\n')
    expect(foldSource('a\r\nb\rc')).toBe('a\nb\nc\n')
    expect(foldSource('')).toBe('\n')
  })

  it('refuses a duplicate path, a path that is no section, a missing lazy line and an atom of no folder', () => {
    const one = { path: 'src/a/x.ts', text: '' }
    expect(() => typescriptAtomText('a', LAZY, [one, one])).toThrow(/two sources at one path/)
    expect(() => typescriptAtomText('a', LAZY, [{ path: 'src/a/x.json', text: '' }])).toThrow(/not a section path/)
    expect(() => typescriptAtomText('a', LAZY, [{ path: 'lib/x.ts', text: '' }])).toThrow(/not a section path/)
    expect(() => typescriptAtomText('a', '// eager', [one])).toThrow(/lazy marker/)
    expect(() => typescriptAtomText('', LAZY, [one])).toThrow(/one top-level folder/)
  })

  it('the staging folder is not a signature', () => {
    expect(TYPESCRIPT_STAGING).toBe('.typescript')
    expect(/^[0-9a-f]{64}$/i.test(TYPESCRIPT_STAGING)).toBe(false)
  })
})

describe('conformance with the reader\'s lookup', () => {
  it('for every carried file, the layers lead to the atom that holds its section', () => {
    const atoms = atomsOf(plant(root, TREE))
    const sigOf = new Map(atoms.map(atom => [atom.key, sha(atom.text)]))
    const textOf = new Map(atoms.map(atom => [sha(atom.text), atom.text]))
    const layerOf = (key: string): string => sha(`layer:${key}`)
    const nodes: TypescriptNode[] = [
      ...[...LAYERED].map(key => ({ path: key, layerSig: layerOf(key), base: layerOf(key) })),
      { path: 'games/solomon', layerSig: layerOf('games/solomon'), base: layerOf('games/solomon') },
      { path: 'assistant/anatomy', layerSig: layerOf('assistant/anatomy'), base: layerOf('assistant/anatomy') },
    ]
    const slotOf = (layerSig: string): string | undefined => {
      for (const [key, sig] of sigOf) if (layerOf(key) === layerSig) return sig
      return undefined
    }
    for (const path of HELD) {
      const found = typescriptAtomFor(path, nodes, slotOf)
      expect(found, path).toBeDefined()
      expect(sectionOf(textOf.get(found!.atom)!, path), path).not.toBeNull()
    }
    // What no atom holds, the lookup offers nothing for.
    for (const path of ['src/loose/only-types.ts', 'src/preload-effects.ts', 'src/assistant/index.ts']) {
      expect(typescriptAtomFor(path, nodes, slotOf), path).toBeUndefined()
    }
  })
})

describe('typescriptDigest', () => {
  it('moves with a carried file\'s content and not with an excluded file\'s', () => {
    plant(root, TREE)
    const digest = () => typescriptDigest(carriedFiles(root, keep), abs => sha(readFileSync(abs)))
    const before = digest()
    expect(digest()).toBe(before)
    writeFileSync(join(root, 'assistant/chat.spec.ts'), 'changed\n')
    writeFileSync(join(root, 'assistant/index.ts'), 'changed\n')
    expect(digest()).toBe(before)
    writeFileSync(join(root, 'loose/only-types.ts'), 'export type Loose = number\n')
    expect(digest()).not.toBe(before)
  })
})

describe('typescriptSlotErrors', () => {
  const layer = (name: string, slot?: unknown): [string, string] => {
    const json = JSON.stringify({ name, cells: [], bees: [], dependencies: [], ...(slot === undefined ? {} : { typescript: slot }) })
    return [sha(json), json]
  }
  const A = sha('atom a')
  const B = sha('atom b')

  it('passes when each atom is named by exactly one layer', () => {
    expect(typescriptSlotErrors(new Map([layer('root', A), layer('games', B), layer('plain')]), new Set([A, B]), new Set())).toEqual([])
    expect(typescriptSlotErrors(new Map([layer('plain')]), new Set(), new Set())).toEqual([])
  })

  it('flags a slot that is not a bare signature', () => {
    expect(typescriptSlotErrors(new Map([layer('games', `${A}.js`)]), new Set(), new Set()).join('\n')).toMatch(/layer "games" .* not a bare signature/)
    expect(typescriptSlotErrors(new Map([layer('games', 7)]), new Set(), new Set())).toHaveLength(1)
  })

  it('flags a slot naming no atom the build wrote', () => {
    expect(typescriptSlotErrors(new Map([layer('games', A)]), new Set(), new Set()).join('\n')).toMatch(/names no source atom/)
  })

  it('flags a slot naming a layer, bee or dependency', () => {
    expect(typescriptSlotErrors(new Map([layer('games', A)]), new Set([A]), new Set([A])).join('\n')).toMatch(/never installed/)
  })

  it('flags an atom no layer names', () => {
    expect(typescriptSlotErrors(new Map([layer('games', A)]), new Set([A, B]), new Set()).join('\n')).toMatch(new RegExp(`source atom ${B.slice(0, 12)} is named by no layer`))
  })

  it('flags an atom two layers name', () => {
    expect(typescriptSlotErrors(new Map([layer('games', A), layer('other', A)]), new Set([A]), new Set()).join('\n')).toMatch(/named by 2 layers/)
  })
})

describe('unresolvedSections', () => {
  it('reports a carried file with no section apart from a header the package does not carry', () => {
    const atoms = atomsOf(plant(root, TREE))
    const carried = new Set(CARRIED)
    const compiled = [
      '// @hypercomb/essentials/games\n// src/games/Zebra.ts\nvar z = 1;\n// src/games/index.ts\nexport { z };\n// node_modules/pkg/a.js\n',
      '// src/preload-effects.ts\nvar preload = true;\n// src/commands/words.json\n// src/loose/only-types.ts\n',
    ]
    // A root-level barrel and a file of a folder that is no layer are in no atom: outside, never missing.
    const outside = ['src/games/index.ts', 'src/loose/only-types.ts', 'src/preload-effects.ts']
    expect(unresolvedSections(compiled, atoms, LAYERED, carried)).toEqual({ missing: [], outside })
    // A carried path whose atom lacks it is the bug the build stops on.
    const without = atoms.filter(atom => atom.key !== 'games')
    expect(unresolvedSections(compiled, without, LAYERED, carried)).toEqual({ missing: ['src/games/Zebra.ts'], outside })
  })
})
