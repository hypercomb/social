import { describe, expect, it } from 'vitest'
import { codeLinks, lineAt, quoteUse, tileHandles } from './tile-code.js'

describe('tileHandles', () => {
  it('names the tile first, then kinds, bindings and its own slots, each word once', () => {
    const handles = tileHandles({
      name: 'solomon-maze-v1',
      layer: { name: 'solomon-maze-v1', children: ['a'], decorations: ['b'], website: ['c'], tutor: [], notes: ['d'] },
      decorationKinds: ['visual:website:page', 'visual:website:page'],
      boundKinds: ['visual:postit:note', 'visual:website:page'],
    })
    expect(handles).toEqual([
      { word: 'solomon-maze-v1', from: 'name' },
      { word: 'visual:website:page', from: 'kind' },
      { word: 'visual:postit:note', from: 'bound' },
      { word: 'website', from: 'slot' },
      { word: 'notes', from: 'slot' },
    ])
  })

  it('never offers a word too short or one a quote could break', () => {
    expect(tileHandles({ name: 'ab', decorationKinds: ["it's"] })).toEqual([])
  })
})

describe('codeLinks', () => {
  const text = [
    "protected override listens: string[] = ['brood:ruled', 'module:changes']",
    "protected override emits = ['module:door', 'toast:show']",
    "EffectBus.emit('doctrine:open', {})",
    "this.onEffect<Payload>('tile:action', handler)",
    "window.ioc.register('@diamondcoreprocessor.com/InspectQueenBee', bee)",
    "const reader = window.ioc.get('@diamondcoreprocessor.com/HypercombHiveTreeReader')",
    "EffectBus.emit('not an effect', 1)",
  ].join('\n')

  it('reads the effects a section publishes and listens for, declared or called', () => {
    const links = codeLinks(text)
    expect(links.emits).toEqual(['doctrine:open', 'module:door', 'toast:show'])
    expect(links.listens).toEqual(['brood:ruled', 'module:changes', 'tile:action'])
  })

  it('tells the keys it registers from the keys it asks for', () => {
    const links = codeLinks(text)
    expect(links.provides).toEqual(['@diamondcoreprocessor.com/InspectQueenBee'])
    expect(links.needs).toEqual(['@diamondcoreprocessor.com/HypercombHiveTreeReader'])
  })
})

describe('quoteUse', () => {
  it('says how one line uses the word it quotes', () => {
    expect(quoteUse("EffectBus.emit('tile:action', x)", 'tile:action')).toBe('emits')
    expect(quoteUse("this.onEffect('tile:action', fn)", 'tile:action')).toBe('listens')
    expect(quoteUse("register('@a.com/B', b)", '@a.com/B')).toBe('provides')
    expect(quoteUse("if (kind === 'visual:website:page')", 'visual:website:page')).toBe('names')
  })
})

describe('lineAt', () => {
  it('counts lines from one', () => {
    expect(lineAt('a\nb\nc', 0)).toBe(1)
    expect(lineAt('a\nb\nc', 2)).toBe(2)
    expect(lineAt('a\nb\nc', 99)).toBe(3)
  })
})
