// code-tree.view.spec.ts — the code tree in the chat's left column: what the
// chat is about, then the running code, and a file pressed there opens in
// the chat's main pane.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const opened = vi.hoisted(() => [] as unknown[])
vi.mock('./chat-code.js', () => ({ openChatCode: vi.fn(async (frame: unknown) => { opened.push(frame) }) }))

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = { get: (key: string) => registrations.get(key) }

const { EffectBus } = await import('@hypercomb/core')
const { HIVE_TREE_READER_IOC_KEY } = await import('./hive-tree-reader.js')
const { CodeTreeView } = await import('./code-tree.view.js')

const CORE = ['// src/core/effect-bus.ts', 'export const bus = 1', '// src/index.ts', 'export {}'].join('\n')
let nodes: Record<string, { children: string[]; files: { name: string; sig: string; size: number }[] }>
let reads: string[]

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }
let view: InstanceType<typeof CodeTreeView>
const rows = (): string[] => [...view.element.querySelectorAll('.hc-code-row')]
  .map(row => `${(row as HTMLElement).style.paddingLeft}|${row.querySelector('.hc-code-name')?.textContent}`)
const names = (): string[] => [...view.element.querySelectorAll('.hc-code-name')].map(node => node.textContent ?? '')
const row = (name: string): HTMLElement =>
  [...view.element.querySelectorAll<HTMLElement>('.hc-code-row')].find(node => node.querySelector('.hc-code-name')?.textContent === name)!

beforeEach(async () => {
  EffectBus.clear()
  opened.length = 0
  reads = []
  nodes = {
    'business-card': { children: ['back'], files: [{ name: 'main.js', sig: sig(21), size: 19_029 }, { name: 'main.js', sig: sig(22), size: 20_480 }, { name: 'animation.js', sig: sig(23), size: 512 }] },
    'business-card/back': { children: [], files: [{ name: 'links.json', sig: sig(24), size: 300 }] },
  }
  registrations.clear()
  registrations.set(HIVE_TREE_READER_IOC_KEY, {
    codeIndex: async () => [
      { name: '@hypercomb/essentials/assistant/chat-thread', sig: sig(1) },
      { name: '@hypercomb/essentials/commands/builds.queen', sig: sig(2) },
      { name: '@hypercomb/source/core', sig: sig(5) },
      { name: '@hypercomb/source/shim', sig: sig(6) },
      { name: 'Action Card', sig: sig(7), of: 'bee' },
      { name: sig(8), sig: sig(8), of: 'dependency' },
    ],
    moduleText: async (wanted: string) => wanted === sig(5) ? { name: '@hypercomb/source/core', text: CORE } : undefined,
    readNode: async (segments: readonly string[], options?: { withContent?: boolean }) => {
      // A tile's files come with its content, never without.
      if (!options?.withContent) return { ok: true, children: [], files: [] }
      reads.push(segments.join('/'))
      const node = nodes[segments.join('/')]
      return node ? { ok: true, children: node.children.map(name => ({ name })), files: node.files } : { ok: false }
    },
  })
  view = new CodeTreeView()
  document.body.replaceChildren(view.element)
  view.setTarget(['business-card'])
  await settle()
})

describe('the code tree', () => {
  it('shows what the chat is about, then the running code', () => {
    expect([...view.element.querySelectorAll('.hc-code-head')].map(head => head.textContent)).toEqual(['What this chat is about', 'The running code'])
    // The tile in hand is unfolded: its tiles, then its files, the newest of each name.
    expect(names().slice(0, 4)).toEqual(['business-card', 'back', 'animation.js', 'main.js'])
    expect(row('main.js').querySelector('.hc-code-tail')?.textContent).toBe('20 KB')
    // The behaviours and the unnamed are folders, folded; the folders that
    // are paths are unfolded one level.
    expect(names().slice(4)).toEqual(['Behaviours', '@hypercomb', 'essentials', 'source', 'Unnamed'])
  })

  it('keeps the behaviours in one folder, each opened by its signature', () => {
    row('Behaviours').click()
    expect(names()).toContain('Action Card')
    row('Action Card').click()
    expect(opened).toEqual([{ kind: 'section', sig: sig(7), name: 'Action Card' }])
  })

  it('reads a tile inside only when it is unfolded, and indents what it holds', async () => {
    expect(reads).toEqual(['business-card'])
    row('back').click()
    await settle()
    expect(reads).toEqual(['business-card', 'business-card/back'])
    expect(rows().slice(0, 3)).toEqual(['0.4rem|business-card', '1.2rem|back', '2rem|links.json'])
  })

  it('opens a file of the tile in the main pane, as the resource it is', () => {
    row('main.js').click()
    // It says which tile's file it is: that is what lets the pane edit it and save it back.
    expect(opened).toEqual([{ kind: 'resource', sig: sig(22), name: 'main.js', file: { route: ['business-card'], name: 'main.js' } }])
    expect(row('main.js').classList.contains('shown')).toBe(true)
  })

  it('opens the tile itself from the button on its row, without folding it', () => {
    row('business-card').querySelector<HTMLButtonElement>('.hc-code-look')!.click()
    expect(opened).toEqual([{ kind: 'tile', segments: ['business-card'] }])
    expect(names()).toContain('main.js')
  })

  it('unfolds the running code folder by folder, and opens a module by its signature', async () => {
    row('essentials').click()
    row('assistant').click()
    expect(names()).toContain('chat-thread')
    row('chat-thread').click()
    expect(opened).toEqual([{ kind: 'section', sig: sig(1), name: '@hypercomb/essentials/assistant/chat-thread' }])
  })

  it('fills a platform source from the files it ships, and opens one as its own section', async () => {
    row('source').click()
    row('core').click()
    await settle()
    // The files it ships, as their own folders: core/effect-bus.ts and index.ts.
    expect(names().slice(-6, -1)).toEqual(['source', 'core', 'core', 'index.ts', 'shim'])
    const inner = [...view.element.querySelectorAll<HTMLElement>('.hc-code-row')].filter(node => node.querySelector('.hc-code-name')?.textContent === 'core')[1]!
    inner.click()
    expect(names().slice(-6, -1)).toEqual(['core', 'core', 'effect-bus.ts', 'index.ts', 'shim'])
    row('effect-bus.ts').click()
    expect(opened).toEqual([{ kind: 'section', sig: sig(5), section: 'src/core/effect-bus.ts' }])
  })

  it('keeps a folder the participant folded, and unfolds only a new target', async () => {
    row('business-card').click()
    expect(names()).not.toContain('main.js')
    view.setTarget(['business-card'])
    expect(names()).not.toContain('main.js')
    view.setTarget(['business-card', 'back'])
    await settle()
    expect(names().slice(0, 2)).toEqual(['back', 'links.json'])
  })

  it('lists the code whose name holds what is typed, and opens it', () => {
    view.setQuery('queen')
    expect(view.element.querySelector('.hc-code-head')?.textContent).toBe('Code named “queen”')
    expect(names()).toEqual(['@hypercomb/essentials/commands/builds.queen'])
    row('@hypercomb/essentials/commands/builds.queen').click()
    expect(opened).toEqual([{ kind: 'section', sig: sig(2), name: '@hypercomb/essentials/commands/builds.queen' }])
    view.setQuery('nothing like this')
    expect(view.element.querySelector('.hc-code-note')?.textContent).toBe('No running code has that in its name.')
  })

  it('shows a file written on the tile a moment after it lands', async () => {
    nodes['business-card']!.files.push({ name: 'style.css', sig: sig(30), size: 90 })
    EffectBus.emit('history:marker-wrote', { lineageSig: 'x' })
    await new Promise(r => setTimeout(r, 480))
    await settle()
    expect(names()).toContain('style.css')
  })

  it('is pressed from the keyboard like a button', () => {
    row('main.js').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(opened).toHaveLength(1)
  })
})
