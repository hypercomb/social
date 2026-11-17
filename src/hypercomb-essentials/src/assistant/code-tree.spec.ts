// code-tree.spec.ts — the running code folded into folders and files, from
// nothing but the names the modules already carry and the paths the source
// files inside a bundle are marked with.

import { describe, expect, it } from 'vitest'
import { findModules, moduleTree, sectionTree, type CodeNode } from './code-tree.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** A tree as indented lines: `folder/` and `file`, a bundle as `bundle*`. */
const drawn = (nodes: readonly CodeNode[], depth = 0): string[] =>
  nodes.flatMap(node => [
    `${'  '.repeat(depth)}${node.label}${node.bundle ? '*' : node.opens ? '' : '/'}`,
    ...drawn(node.children, depth + 1),
  ])

const entries = [
  { name: '@hypercomb/essentials/assistant/chat-thread', sig: sig(1) },
  { name: '@hypercomb/essentials/assistant/providers/key-owner', sig: sig(2) },
  { name: '@hypercomb/essentials/assistant', sig: sig(3) },
  { name: '@hypercomb/essentials/commands/builds.queen', sig: sig(4) },
  { name: '@hypercomb/source/core', sig: sig(5) },
  { name: '@hypercomb/source/shim', sig: sig(6) },
  { name: 'pixi.js', sig: sig(7) },
]

describe('the running modules as a tree', () => {
  it('makes a folder of every slash, folders before files, each by name', () => {
    expect(drawn(moduleTree(entries))).toEqual([
      '@hypercomb/',
      '  essentials/',
      '    assistant/',
      '      providers/',
      '        key-owner',
      '      assistant',
      '      chat-thread',
      '    commands/',
      '      builds.queen',
      '  source/',
      '    core*',
      '    shim*',
      'pixi.js',
    ])
  })

  it('reads a lone chain of folders as one row', () => {
    const tree = moduleTree(entries.filter(entry => entry.name.includes('/essentials/')))
    expect(tree.map(node => node.label)).toEqual(['@hypercomb/essentials'])
    expect(tree[0]!.path).toBe('@hypercomb/essentials')
    // A folder holding one file stays a folder.
    expect(drawn(moduleTree([{ name: 'a/b/only', sig: sig(9) }]))).toEqual(['a/b/', '  only'])
  })

  it('a module others are under is the file of its own name inside that folder', () => {
    const tree = moduleTree(entries)
    const assistant = tree[0]!.children[0]!.children[0]!
    expect(assistant.label).toBe('assistant')
    expect(assistant.opens).toBeUndefined()
    const own = assistant.children.find(child => child.label === 'assistant')!
    expect(own.opens).toEqual({ kind: 'module', sig: sig(3), name: '@hypercomb/essentials/assistant' })
    expect(own.path).not.toBe(assistant.path)
  })

  it('a file opens its module by signature, and a platform source is a folder filled on demand', () => {
    const tree = moduleTree(entries)
    const source = tree[0]!.children[1]!
    expect(source.children.map(child => [child.label, child.bundle?.sig, child.opens])).toEqual([
      ['core', sig(5), undefined], ['shim', sig(6), undefined],
    ])
    expect(tree[1]).toEqual({ label: 'pixi.js', path: 'pixi.js', children: [], opens: { kind: 'module', sig: sig(7), name: 'pixi.js' } })
  })

  it('gives every node its own path', () => {
    const paths: string[] = []
    const walk = (nodes: readonly CodeNode[]): void => nodes.forEach(node => { paths.push(node.path); walk(node.children) })
    walk(moduleTree(entries))
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('names that are not paths', () => {
  const mixed = [
    ...entries,
    { name: 'Tile Editor', sig: sig(0x21), of: 'bee' as const },
    { name: 'Action Card', sig: sig(0x22), of: 'bee' as const },
    { name: 'a1b2c3d4e5f6', sig: sig(0x23), of: 'dependency' as const },
    { name: sig(0x24), sig: sig(0x24), of: 'bee' as const },
  ]

  it('gathers the behaviours first and the unnamed last, each in one folder', () => {
    const tree = moduleTree(mixed)
    expect(tree.map(node => node.label)).toEqual(['Behaviours', '@hypercomb', 'pixi.js', 'Unnamed'])
    expect(tree[0]!.children.map(child => child.label)).toEqual(['Action Card', 'Tile Editor'])
    expect(tree[0]!.children[0]!.opens).toEqual({ kind: 'module', sig: sig(0x22), name: 'Action Card' })
    // A signature is said by its first twelve digits.
    expect(tree.at(-1)!.children.map(child => child.label)).toEqual(['000000000000', 'a1b2c3d4e5f6'])
  })

  it('says the two folders in the words it is given, and makes neither when it would be empty', () => {
    expect(moduleTree(mixed, { behaviours: 'ビヘイビア', unnamed: '名前なし' }).map(node => node.label))
      .toEqual(['ビヘイビア', '@hypercomb', 'pixi.js', '名前なし'])
    expect(moduleTree(entries).map(node => node.label)).toEqual(['@hypercomb', 'pixi.js'])
  })
})

describe('the source files one module ships', () => {
  const paths = ['src/core/effect-bus.ts', 'src/core/panels/window-session.ts', 'src/index.ts', 'src/core/ioc.ts']

  it('are a tree without the src every path shares, each file opening its own section', () => {
    const tree = sectionTree(sig(5), paths, '@hypercomb/source/core')
    expect(drawn(tree)).toEqual([
      'core/',
      '  panels/',
      '    window-session.ts',
      '  effect-bus.ts',
      '  ioc.ts',
      'index.ts',
    ])
    const bus = tree[0]!.children[1]!
    expect(bus.opens).toEqual({ kind: 'section', sig: sig(5), path: 'src/core/effect-bus.ts' })
    expect(bus.path).toBe('@hypercomb/source/core/core/effect-bus.ts')
  })

  it('is empty for a module that marks no files', () => {
    expect(sectionTree(sig(5), [], 'x')).toEqual([])
  })
})

describe('finding code by name', () => {
  it('keeps the modules whose name holds every word, in any order', () => {
    expect(findModules(entries, 'thread chat').map(entry => entry.name)).toEqual(['@hypercomb/essentials/assistant/chat-thread'])
    expect(findModules(entries, 'SOURCE').map(entry => entry.name)).toEqual(['@hypercomb/source/core', '@hypercomb/source/shim'])
    expect(findModules(entries, '  ')).toEqual([])
    expect(findModules(entries, 'hypercomb', 2)).toHaveLength(2)
  })
})
