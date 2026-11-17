// package-typescript.spec.ts — which source atom holds a section's TypeScript,
// decided from the layers alone.

import { describe, expect, it } from 'vitest'
import { TYPESCRIPT_NAME, TYPESCRIPT_SLOT, typescriptAtomFor, typescriptCarries, typescriptPaths, typescriptSlot, type TypescriptNode } from './package-typescript.js'

const sig = (letter: string): string => letter.repeat(64)

describe('typescriptSlot', () => {
  it('reads a bare signature and nothing else', () => {
    expect(TYPESCRIPT_SLOT).toBe('typescript')
    expect(TYPESCRIPT_NAME).toBe('@hypercomb/typescript/')
    expect(typescriptSlot({ name: 'a', typescript: sig('a') })).toBe(sig('a'))
    expect(typescriptSlot({ name: 'a' })).toBeUndefined()
    expect(typescriptSlot({ typescript: 7 })).toBeUndefined()
    expect(typescriptSlot({ typescript: `${sig('a')}.js` })).toBeUndefined()
    expect(typescriptSlot({ typescript: 'abc123' })).toBeUndefined()
    expect(typescriptSlot({ typescript: sig('A') })).toBeUndefined()
    expect(typescriptSlot(null)).toBeUndefined()
    expect(typescriptSlot('text')).toBeUndefined()
  })
})

describe('typescriptPaths', () => {
  it('lists the layer paths deepest first, without the root', () => {
    expect(typescriptPaths('src/assistant/chat-thread.ts')).toEqual(['assistant'])
    expect(typescriptPaths('src/games/solomon/x.ts')).toEqual(['games/solomon', 'games'])
    expect(typescriptPaths('src/preload-effects.ts')).toEqual([])
  })

  it('answers null for anything that is not a TypeScript source path', () => {
    expect(typescriptPaths('src/commands/beehive.words.json')).toBeNull()
    expect(typescriptPaths('lib/a.ts')).toBeNull()
    expect(typescriptPaths('src/a b/c.ts')).toBeNull()
    expect(typescriptPaths('src/')).toBeNull()
    expect(typescriptPaths(`src/${'a'.repeat(194)}.ts`)).toBeNull()
    expect(typescriptPaths(`src/${'a'.repeat(193)}.ts`)).toEqual([])
  })

  it('answers null for a path with a `.` or `..` segment: a layer path never leaves its folder', () => {
    expect(typescriptPaths('src/../x.ts')).toBeNull()
    expect(typescriptPaths('src/a/../../x.ts')).toBeNull()
    expect(typescriptPaths('src/./x.ts')).toBeNull()
    expect(typescriptPaths('src/a/./x.ts')).toBeNull()
    expect(typescriptPaths('src/a/...ts')).toEqual(['a'])
    expect(typescriptPaths('src/a.b/x.ts')).toEqual(['a.b'])
    expect(typescriptAtomFor('src/games/../games/x.ts', [{ path: 'games', layerSig: sig('1'), base: sig('1') }], () => sig('a'))).toBeUndefined()
  })
})

describe('typescriptCarries', () => {
  it('is true for a source file in a folder, at any depth', () => {
    for (const section of ['src/assistant/x.ts', 'src/games/solomon/maze.ts', 'src/move/move.drone.ts', 'src/assistant/reindex.ts']) {
      expect(typescriptCarries(section), section).toBe(true)
    }
  })

  it('is false where the atoms carry nothing', () => {
    for (const section of [
      'src/x.ts', 'src/side-effects.ts', 'src/index.ts',
      'src/assistant/index.ts', 'src/games/solomon/index.ts',
      'src/sharing/essentials-keys.ts', 'src/sharing/host-keys.ts', 'src/sharing/host.keys.ts',
      'src/assistant/x.spec.ts', 'src/assistant/x.test.ts', 'src/games/arkanoid/xselftest.ts',
      'src/assistant/x.d.ts', 'src/assistant/x.entry.ts', 'src/types/global.ts',
      'src/assistant/words.json', 'src/assistant/x.js', 'lib/assistant/x.ts', 'src/assistant/../assistant/x.ts',
    ]) {
      expect(typescriptCarries(section), section).toBe(false)
    }
  })
})

describe('typescriptAtomFor', () => {
  const node = (path: string, layerSig: string, base = layerSig): TypescriptNode => ({ path, layerSig, base })
  const slots = (table: Record<string, string>) => (layerSig: string): string | undefined => table[layerSig]

  it('the top-level layer\'s slot answers for every file beneath it', () => {
    const nodes = [node('games', sig('1')), node('games/solomon', sig('2'))]
    const slotOf = slots({ [sig('1')]: sig('a') })
    expect(typescriptAtomFor('src/games/solomon/x.ts', nodes, slotOf)).toEqual({ atom: sig('a'), layer: sig('1') })
    expect(typescriptAtomFor('src/games/y.ts', nodes, slotOf)).toEqual({ atom: sig('a'), layer: sig('1') })
  })

  it('a deeper layer carrying its own slot wins', () => {
    const nodes = [node('games', sig('1')), node('games/solomon', sig('2'))]
    const slotOf = slots({ [sig('1')]: sig('a'), [sig('2')]: sig('b') })
    expect(typescriptAtomFor('src/games/solomon/x.ts', nodes, slotOf)).toEqual({ atom: sig('b'), layer: sig('2') })
  })

  it('a picked deeper layer with no slot answers nothing, although its parent has one', () => {
    const nodes = [node('games', sig('1')), node('games/solomon', sig('3'), sig('2'))]
    expect(typescriptAtomFor('src/games/solomon/x.ts', nodes, slots({ [sig('1')]: sig('a') }))).toBeUndefined()
  })

  it('a picked top-level layer with its own slot answers with that slot', () => {
    const nodes = [node('games', sig('3'), sig('1'))]
    expect(typescriptAtomFor('src/games/x.ts', nodes, slots({ [sig('3')]: sig('c'), [sig('1')]: sig('a') }))).toEqual({ atom: sig('c'), layer: sig('3') })
  })

  it('there is no root atom: a file in no folder, or in a folder that is no layer, answers nothing whatever carries a slot', () => {
    // Every layer answers a slot here, the root's among them: none is asked.
    const every = (): string => sig('f')
    expect(typescriptAtomFor('src/preload-effects.ts', [node('games', sig('1'))], every)).toBeUndefined()
    expect(typescriptAtomFor('src/loose/x.ts', [node('games', sig('1'))], every)).toBeUndefined()
    expect(typescriptAtomFor('src/x.ts', [node('', sig('0'))], every)).toBeUndefined()
    expect(typescriptAtomFor.length).toBe(3)
  })

  it('a top folder that is a layer without a slot answers nothing', () => {
    expect(typescriptAtomFor('src/games/x.ts', [node('games', sig('1'))], slots({ [sig('0')]: sig('f') }))).toBeUndefined()
  })

  it('a file the atoms never carry answers nothing, although its folder has a slot', () => {
    const nodes = [node('games', sig('1'))]
    const slotOf = slots({ [sig('1')]: sig('a') })
    for (const section of ['src/games/index.ts', 'src/games/games-keys.ts', 'src/games/x.spec.ts', 'src/games/x.json']) {
      expect(typescriptAtomFor(section, nodes, slotOf), section).toBeUndefined()
    }
    expect(typescriptAtomFor('src/games/x.ts', nodes, slotOf)).toEqual({ atom: sig('a'), layer: sig('1') })
  })

  it('no slots anywhere answers nothing', () => {
    expect(typescriptAtomFor('src/games/x.ts', [node('games', sig('1'))], slots({}))).toBeUndefined()
  })
})
