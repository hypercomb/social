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
const { SHELL_FILE, moveBlockOut } = await import('../files/page-parts.js')
type PartsReader = import('./composed-parts.js').PartsReader

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

// jwize, 2026-11-16: "It follows the hierarchy of composed parts."
describe('the code tree follows what a tile is composed of', () => {
  const PAGE = '<!doctype html><html><body><script id="anim">run()</script></body></html>'
  const PAGE_SIG = sig(100), SHELL_SIG = sig(101), SCRIPT_SIG = sig(102)
  const moved = moveBlockOut(PAGE, 'script-1', () => ({ sig: SCRIPT_SIG, name: 'animation.js' }))
  const SHELL = moved.ok ? moved.shell : ''

  let files: Record<string, { name: string; sig: string; size: number }[]>
  let composed: string[]

  /** A business card broken apart: its script is a file on the child tile `animation`. */
  const parts = (): PartsReader => ({
    tile: async segments => {
      const route = segments.join('/')
      if (!(route in files)) return null
      return { children: route === 'business-card' ? [{ name: 'animation', sig: sig(201) }, { name: 'back', sig: sig(202) }] : [], files: files[route]! }
    },
    pageSig: async segments => { composed.push(segments.join('/')); return segments.join('/') === 'business-card' ? PAGE_SIG : null },
    traits: async segments => segments.join('/') === 'business-card'
      ? [{ word: 'animation', rung: 'child', sig: sig(201), route: ['business-card', 'animation'] }, { word: 'voice', rung: 'miss' }]
      : [],
    card: async segments => segments.join('/') === 'business-card' ? { kind: 'card:data', payload: { dataSig: sig(41), artSig: sig(42) } } : null,
    text: async wanted => ({ [PAGE_SIG]: PAGE, [SHELL_SIG]: SHELL, [SCRIPT_SIG]: 'run()' })[wanted] ?? null,
    held: async sigs => new Map(sigs.filter(wanted => wanted === sig(42)).map(wanted => [wanted, { size: 4_096, picture: true }] as const)),
    stated: () => [],
  })
  const tail = (name: string): string | undefined => row(name).querySelector('.hc-code-tail')?.textContent ?? undefined
  const wrote = async (): Promise<void> => {
    EffectBus.emit('history:marker-wrote', { lineageSig: 'x' })
    await new Promise(r => setTimeout(r, 480))
    await settle()
  }

  beforeEach(async () => {
    opened.length = 0
    composed = []
    files = {
      'business-card': [{ name: SHELL_FILE, sig: SHELL_SIG, size: SHELL.length }, { name: 'main.js', sig: sig(22), size: 20_480 }],
      'business-card/animation': [{ name: 'animation.js', sig: SCRIPT_SIG, size: 512 }],
      'business-card/back': [{ name: 'links.json', sig: sig(24), size: 300 }],
    }
    view = new CodeTreeView(parts())
    document.body.replaceChildren(view.element)
    view.setTarget(['business-card'])
    await settle()
  })

  it('draws the page and the card open on arrival, their parts under them, then what else is here', () => {
    expect(rows().slice(0, 10)).toEqual([
      '0.4rem|business-card',
      '1.2rem|Page', `2rem|${SHELL_FILE}`, '2rem|animation.js',
      '1.2rem|Card', '2rem|details', '2rem|picture',
      '1.2rem|voice',
      '1.2rem|back', '1.2rem|main.js',
    ])
    expect(row('Page').getAttribute('aria-expanded')).toBe('true')
    expect(tail('picture')).toBe('4 KB')
    expect(tail('main.js')).toBe('20 KB')
  })

  it('says “Also here” only beside parts, and never as a heading', async () => {
    const subs = (): (string | null)[] => [...view.element.querySelectorAll('.hc-code-sub')].map(node => node.textContent)
    expect(subs()).toEqual(['Also here'])
    expect(view.element.querySelector('.hc-code-sub')!.classList.contains('hc-code-head')).toBe(false)
    expect([...view.element.querySelectorAll('.hc-code-head')].map(head => head.textContent)).toEqual(['What this chat is about', 'The running code'])
    // A tile with no parts is its tiles and files, with nothing said above them.
    row('back').click()
    await settle()
    expect(names()).toContain('links.json')
    expect(subs()).toEqual(['Also here'])
  })

  it('folds a page from its own chevron, and opens the page from its row', () => {
    row('Page').querySelector<HTMLButtonElement>('.hc-code-fold')!.click()
    expect(opened).toEqual([])
    expect(names()).not.toContain(SHELL_FILE)
    expect(row('Page').getAttribute('aria-expanded')).toBe('false')
    row('Page').click()
    expect(opened).toEqual([{ kind: 'resource', sig: PAGE_SIG, name: 'page' }])
    expect(names()).not.toContain(SHELL_FILE)
  })

  it('opens a part of the page as the file on the tile that holds it', () => {
    row('animation.js').click()
    expect(opened).toEqual([{ kind: 'resource', sig: SCRIPT_SIG, name: 'animation.js', file: { route: ['business-card', 'animation'], name: 'animation.js' } }])
    expect(row('animation.js').classList.contains('shown')).toBe(true)
  })

  it('composes the tile a part lives on only when its chevron is pressed', async () => {
    expect(composed).toEqual(['business-card'])
    row('animation.js').querySelector<HTMLButtonElement>('.hc-code-fold')!.click()
    await settle()
    expect(composed).toEqual(['business-card', 'business-card/animation'])
    expect(opened).toEqual([])
    expect(row('animation.js').getAttribute('aria-expanded')).toBe('true')
    // Its one file is the row above it.
    expect([...view.element.querySelectorAll('.hc-code-note')].map(note => note.textContent)).toContain('Nothing else here.')
    expect(names().filter(name => name === 'animation.js')).toHaveLength(1)
  })

  it('opens the tile a part lives on from the button on the row of the part', () => {
    row('animation.js').querySelector<HTMLButtonElement>('.hc-code-look')!.click()
    expect(opened).toEqual([{ kind: 'tile', segments: ['business-card', 'animation'] }])
  })

  it('draws a trait nothing fills, and pressing it opens nothing', () => {
    expect(tail('voice')).toBe('empty')
    expect(row('voice').querySelector('.hc-code-fold')).toBeNull()
    row('voice').click()
    expect(opened).toEqual([])
  })

  it('says when a resource a record names is not on this device', () => {
    expect(tail('details')).toBe('not on this device')
    row('details').click()
    expect(opened).toEqual([{ kind: 'resource', sig: sig(41), name: 'dataSig' }])
  })

  it('composes every tile again after a write, and repaints only when one changed', async () => {
    row('animation.js').querySelector<HTMLButtonElement>('.hc-code-fold')!.click()
    await settle()
    const before = row('main.js')
    composed = []
    await wrote()
    // A file on a child tile commits the child alone: nothing above it says so, so both are read.
    expect(composed).toEqual(['business-card', 'business-card/animation'])
    expect(row('main.js')).toBe(before)

    files['business-card/animation']!.push({ name: 'notes.txt', sig: sig(60), size: 90 })
    await wrote()
    expect(row('main.js')).not.toBe(before)
    expect(rows()).toContain('2.8rem|notes.txt')
  })
})

// ── a hive made of maps, for the rules of drawing and unfolding ──────────

type Resolution = import('@hypercomb/core').TraitResolution
type Held = { children?: { name: string; sig?: string }[]; files?: { name: string; sig: string; size: number }[] }
type Hive = {
  tiles: Record<string, Held>
  traits?: Record<string, Resolution[]>
  pages?: Record<string, string>
  texts?: Record<string, string>
  held?: Record<string, { size: number; picture: boolean }>
}

/** A reader over a hive a case may change afterwards; `read` is every tile it was asked for. */
const reading = (hive: Hive, read: string[] = []): PartsReader => ({
  tile: async segments => {
    const route = segments.join('/')
    read.push(route)
    const tile = hive.tiles[route]
    return tile ? { children: tile.children ?? [], files: tile.files ?? [] } : null
  },
  pageSig: async segments => hive.pages?.[segments.join('/')] ?? null,
  traits: async segments => hive.traits?.[segments.join('/')] ?? [],
  card: async () => null,
  text: async wanted => hive.texts?.[wanted] ?? null,
  held: async sigs => new Map(sigs.flatMap(wanted => hive.held?.[wanted] ? [[wanted, hive.held[wanted]!] as const] : [])),
  stated: () => [],
})

const show = async (reader: PartsReader, target: readonly string[]): Promise<void> => {
  opened.length = 0
  view = new CodeTreeView(reader)
  document.body.replaceChildren(view.element)
  view.setTarget(target)
  await settle()
}
const wrote = async (): Promise<void> => {
  EffectBus.emit('history:marker-wrote', { lineageSig: 'x' })
  await new Promise(r => setTimeout(r, 480))
  await settle()
}
const notes = (): (string | null)[] => [...view.element.querySelectorAll('.hc-code-note')].map(note => note.textContent)
const heads = (): (string | null)[] => [...view.element.querySelectorAll('.hc-code-head')].map(head => head.textContent)
/** The rows of that name that are a part's row, not a tile's folder row. */
const partRowsNamed = (name: string): HTMLElement[] =>
  [...view.element.querySelectorAll<HTMLElement>('.hc-code-row.hc-code-file')].filter(node => node.querySelector('.hc-code-name')?.textContent === name)
const fold = (node: HTMLElement): HTMLButtonElement | null => node.querySelector<HTMLButtonElement>('.hc-code-fold')
const look = (node: HTMLElement): HTMLButtonElement | null => node.querySelector<HTMLButtonElement>('.hc-code-look')
const tailOf = (node: HTMLElement): string | undefined => node.querySelector('.hc-code-tail')?.textContent ?? undefined

describe('no tile is unfolded under itself', () => {
  it('two tiles that fill each other from the hive: the inner row has no chevron, and the tree stays whole', async () => {
    const read: string[] = []
    await show(reading({
      tiles: { header: {}, footer: {} },
      traits: {
        header: [{ word: 'footer', rung: 'hive', sig: sig(2), route: ['footer'] }],
        footer: [{ word: 'header', rung: 'hive', sig: sig(1), route: ['header'] }],
      },
    }, read), ['header'])
    fold(row('footer'))!.click()
    await settle()
    expect(rows().slice(0, 3)).toEqual(['0.4rem|header', '1.2rem|footer', '2rem|header'])
    expect(names().slice(3)).toEqual(['Behaviours', '@hypercomb', 'essentials', 'source', 'Unnamed'])
    const inner = partRowsNamed('header')[0]!
    expect(fold(inner)).toBeNull()
    expect(inner.hasAttribute('aria-expanded')).toBe(false)
    expect(tailOf(inner)).toBe('filled')
    // The tile is still opened in the pane from the button on its row.
    look(inner)!.click()
    expect(opened).toEqual([{ kind: 'tile', segments: ['header'] }])
    expect(heads()).toEqual(['What this chat is about', 'The running code'])
    expect(() => view.paint()).not.toThrow()
    expect(read).toEqual(['header', 'footer'])
  })

  it('a tile met again as a tile inside another is a row with no level', async () => {
    // /a/b is filled by /z, /z by /a, and /a holds /a/b.
    await show(reading({
      tiles: { a: { children: [{ name: 'b' }] }, 'a/b': {}, z: {} },
      traits: {
        'a/b': [{ word: 'z', rung: 'hive', sig: sig(3), route: ['z'] }],
        z: [{ word: 'a', rung: 'hive', sig: sig(4), route: ['a'] }],
      },
    }), ['a', 'b'])
    fold(row('z'))!.click()
    await settle()
    fold(row('a'))!.click()
    await settle()
    expect(rows().slice(0, 4)).toEqual(['0.4rem|b', '1.2rem|z', '2rem|a', '2.8rem|b'])
    expect(names().slice(4)).toEqual(['Behaviours', '@hypercomb', 'essentials', 'source', 'Unnamed'])
    const inner = partRowsNamed('b')[0]!
    expect(inner.hasAttribute('aria-expanded')).toBe(false)
    expect(fold(inner)).toBeNull()
    look(inner)!.click()
    expect(opened).toEqual([{ kind: 'tile', segments: ['a', 'b'] }])
    expect(heads()).toEqual(['What this chat is about', 'The running code'])
  })
})

describe('a trait row whose filler moved', () => {
  it('shows the level of the tile that fills it now, and its files are on that tile', async () => {
    const read: string[] = []
    const hive: Hive = {
      tiles: {
        site: {},
        'shared/header': { files: [{ name: 'shared.css', sig: sig(71), size: 40 }] },
        'site/header': { files: [{ name: 'local.css', sig: sig(72), size: 50 }] },
      },
      traits: { site: [{ word: 'header', rung: 'hive', sig: sig(7), route: ['shared', 'header'] }] },
    }
    await show(reading(hive, read), ['site'])
    fold(row('header'))!.click()
    await settle()
    expect(names().slice(0, 3)).toEqual(['site', 'header', 'shared.css'])

    // A child tile named as the trait is made: the child rung comes before the hive's.
    hive.tiles['site']!.children = [{ name: 'header', sig: sig(9) }]
    hive.traits!['site'] = [{ word: 'header', rung: 'child', sig: sig(9), route: ['site', 'header'] }]
    read.length = 0
    await wrote()
    expect(names().slice(0, 3)).toEqual(['site', 'header', 'local.css'])
    expect(names()).not.toContain('shared.css')
    expect(read).toContain('site/header')
    look(row('header'))!.click()
    row('local.css').click()
    expect(opened).toEqual([
      { kind: 'tile', segments: ['site', 'header'] },
      { kind: 'resource', sig: sig(72), name: 'local.css', file: { route: ['site', 'header'], name: 'local.css' } },
    ])

    // From then on the tile that fills it now is the one read again.
    read.length = 0
    await wrote()
    expect(read).toEqual(['site', 'site/header'])
  })
})

describe('a tile with very many tiles inside', () => {
  it('still shows its files, and says how many tiles are not listed', async () => {
    await show(reading({
      tiles: {
        big: {
          children: Array.from({ length: 401 }, (_, i) => ({ name: `t${String(i).padStart(3, '0')}` })),
          files: [{ name: 'main.js', sig: sig(81), size: 2_048 }],
        },
      },
    }), ['big'])
    expect(names()).toContain('t399')
    expect(names()).not.toContain('t400')
    expect(names()).toContain('main.js')
    expect(notes()).toContain('1 more are not listed.')
  })
})

describe('how a part is drawn', () => {
  const PAGE_SIG = sig(400), STALE_SHELL = sig(401)
  beforeEach(async () => {
    await show(reading({
      tiles: {
        card: {
          children: [{ name: 'hero', sig: sig(301) }, { name: 'pick', sig: sig(303) }],
          files: [{ name: SHELL_FILE, sig: STALE_SHELL, size: 51 }],
        },
        'card/hero': {},
        'card/pick': {},
      },
      pages: { card: PAGE_SIG },
      texts: {
        // Sixty-five resources named with no file name after the signature.
        [PAGE_SIG]: Array.from({ length: 65 }, (_, i) => `<img src="resource:${sig(500 + i)}">`).join(''),
        // A shell that assembles to something other than the page.
        [STALE_SHELL]: '<!doctype html><html><body><p>old</p></body></html>',
      },
      traits: {
        card: [
          { word: 'hero', rung: 'child', sig: sig(301), route: ['card', 'hero'] },
          { word: 'pick', rung: 'fill', sig: sig(303) },
          { word: 'menu', rung: 'choose', candidates: [] },
          { word: 'crest', rung: 'own', offers: [] },
        ],
      },
      held: { [sig(500)]: { size: 2_048, picture: true } },
    }), ['card'])
  })

  it('names a resource the page names without a name by its kind and twelve digits', () => {
    expect(names()).toContain(`picture · ${sig(500).slice(0, 12)}`)
    expect(names()).toContain(`resource · ${sig(501).slice(0, 12)}`)
    expect(names()).not.toContain('')
  })

  it('says how many resources were left out', () => {
    expect(notes()).toContain('1 more are not listed.')
  })

  it('says how a trait stands, and when a shell is older than the page', () => {
    expect(tailOf(row('hero'))).toBe('filled')
    expect(tailOf(row('pick'))).toBe('chosen version')
    expect(tailOf(row('menu'))).toBe('several offered')
    expect(tailOf(row('crest'))).toBe('the page’s own')
    expect(tailOf(row(SHELL_FILE))).toBe('older than the page')
  })

  it('keeps the tile button on a trait row that unfolds a tile', () => {
    expect(fold(row('hero'))).not.toBeNull()
    look(row('hero'))!.click()
    expect(opened).toEqual([{ kind: 'tile', segments: ['card', 'hero'] }])
  })
})
