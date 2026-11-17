// composed-parts.spec.ts — what a tile is composed of, as the rows the chat's
// code tree draws: the page and what it is made of, the card, the traits,
// then what else is here. Proven with a reader made of maps.

import { describe, expect, it } from 'vitest'
import { sameTraitWord, type TraitResolution } from '@hypercomb/core'
import { SHELL_FILE, assemblePage, moveBlockOut } from '../files/page-parts.js'
import { FRAME_MAX_CARRIED, inlineLinkedCode } from '../history/revision-viewer.model.js'
import { composedParts, type PartNode, type PartsReader, type TileFile } from './composed-parts.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

type Tile = { children?: { name: string; sig?: string }[]; files?: TileFile[] }

const hive = () => {
  const tiles = new Map<string, Tile>()
  const pages = new Map<string, string>()
  const traits = new Map<string, TraitResolution[]>()
  const cards = new Map<string, Record<string, unknown>>()
  const texts = new Map<string, string>()
  const held = new Map<string, { size: number; picture: boolean }>()
  const calls: string[] = []
  const pageAsked: string[] = []
  const reader: PartsReader = {
    tile: async segments => {
      calls.push(`tile:${segments.join('/')}`)
      const tile = tiles.get(segments.join('/'))
      return tile ? { children: tile.children ?? [], files: tile.files ?? [] } : null
    },
    pageSig: async segments => { pageAsked.push(segments.join('/')); return pages.get(segments.join('/')) ?? null },
    traits: async segments => traits.get(segments.join('/')) ?? [],
    card: async segments => {
      const payload = cards.get(segments.join('/'))
      return payload ? { kind: 'card:data', payload } : null
    },
    text: async wanted => { calls.push(`text:${wanted}`); return texts.get(wanted) ?? null },
    held: async sigs => { calls.push(`held:${sigs.length}`); return new Map(sigs.flatMap(s => held.has(s) ? [[s, held.get(s)!] as const] : [])) },
    // The draw's walk: a trait stated inside one that is filled leaves with it.
    stated: (html, fills) => {
      const seen: string[] = []
      const doc = new DOMParser().parseFromString(html, 'text/html')
      for (const el of Array.from(doc.querySelectorAll('[data-hc-trait]'))) {
        if (!doc.documentElement.contains(el)) continue
        const word = el.getAttribute('data-hc-trait')!
        if (!seen.some(have => sameTraitWord(have, word))) seen.push(word)
        if (fills?.(word)) el.remove()
      }
      return seen
    },
  }
  return { tiles, pages, traits, cards, texts, held, calls, pageAsked, reader }
}

const file = (name: string, n: number, size = 100): TileFile => ({ name, sig: sig(n), size })
const labels = (nodes: readonly PartNode[]): string[] => nodes.map(node => `${node.how}:${node.label}`)
const pageOf = (parts: readonly PartNode[]): PartNode => parts.find(node => node.how === 'page')!

// ── a page in parts ──────────────────────────────────────────────────────

const PAGE = '<!doctype html><html><body><script id="anim">run()</script><style id="look">body{color:red}</style></body></html>'
const PAGE_SIG = sig(100), SHELL_SIG = sig(101), SCRIPT_SIG = sig(102), STYLE_SIG = sig(103)
const SHELL = (() => {
  const first = moveBlockOut(PAGE, 'script-1', () => ({ sig: SCRIPT_SIG, name: 'animation.js' }))
  if (!first.ok) throw new Error(first.error)
  const second = moveBlockOut(first.shell, 'style-1', () => ({ sig: STYLE_SIG, name: 'style.css' }))
  if (!second.ok) throw new Error(second.error)
  return second.shell
})()

/** The business card broken apart: a shell on the tile, each part a file on the child of its name. */
const inParts = () => {
  const h = hive()
  h.tiles.set('card', {
    children: [{ name: 'style', sig: sig(202) }, { name: 'back', sig: sig(203) }, { name: 'animation', sig: sig(201) }],
    files: [{ name: SHELL_FILE, sig: SHELL_SIG, size: SHELL.length }],
  })
  h.tiles.set('card/animation', { files: [{ name: 'animation.js', sig: SCRIPT_SIG, size: 5 }] })
  h.tiles.set('card/style', { files: [{ name: 'style.css', sig: STYLE_SIG, size: 15 }] })
  h.tiles.set('card/back', {})
  h.pages.set('card', PAGE_SIG)
  h.texts.set(PAGE_SIG, PAGE).set(SHELL_SIG, SHELL).set(SCRIPT_SIG, 'run()').set(STYLE_SIG, 'body{color:red}')
  // Breaking a block out gives the page's tile the part's name as a trait its child fills.
  h.traits.set('card', [
    { word: 'animation', rung: 'child', sig: sig(201), route: ['card', 'animation'] },
    { word: 'style', rung: 'child', sig: sig(202), route: ['card', 'style'] },
  ])
  return h
}

describe('a tile with no page, card or traits', () => {
  it('is its tiles by name, then its files by name, the newest of each name', async () => {
    const h = hive()
    h.tiles.set('card', {
      children: [{ name: 'front' }, { name: 'back' }],
      files: [file('main.js', 1, 10), file('main.js', 2, 20), file('animation.js', 3)],
    })
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    expect(parts).toEqual([])
    expect(labels(also)).toEqual(['tile:back', 'tile:front', 'file:animation.js', 'file:main.js'])
    expect(also[0]).toEqual({ key: 'tile:/card/back', how: 'tile', label: 'back', opens: { kind: 'tile', segments: ['card', 'back'] }, unfold: { segments: ['card', 'back'] } })
    expect(also[3]).toEqual({
      key: 'tile:/card#main.js', how: 'file', label: 'main.js', sig: sig(2), size: 20,
      opens: { kind: 'resource', sig: sig(2), name: 'main.js', file: { route: ['card'], name: 'main.js' } },
    })
  })

  it('is nothing when the tile cannot be read', async () => {
    expect(await composedParts(hive().reader, { segments: ['nowhere'] })).toEqual({ parts: [], also: [] })
  })

  it('leaves out the files the row above already is', async () => {
    const h = hive()
    h.tiles.set('card/animation', { files: [file('animation.js', 1), file('notes.txt', 2)] })
    const { also } = await composedParts(h.reader, { segments: ['card', 'animation'], claimed: ['animation.js'] })
    expect(labels(also)).toEqual(['file:notes.txt'])
  })
})

describe('a page in parts', () => {
  it('lists the shell, then each part in shell order, as the file a save rebuilds the page from', async () => {
    const h = inParts()
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    expect(labels(parts)).toEqual(['page:'])
    const page = pageOf(parts)
    expect(page.sig).toBe(PAGE_SIG)
    expect(page.state).toBeUndefined()
    expect(page.opens).toEqual({ kind: 'resource', sig: PAGE_SIG, name: 'page' })
    expect(labels(page.children!)).toEqual([`shell:${SHELL_FILE}`, 'script:animation.js', 'style:style.css'])
    const [shell, script, style] = page.children!
    expect(shell!.opens).toEqual({ kind: 'resource', sig: SHELL_SIG, name: SHELL_FILE, file: { route: ['card'], name: SHELL_FILE } })
    expect(script!.opens).toEqual({ kind: 'resource', sig: SCRIPT_SIG, name: 'animation.js', file: { route: ['card', 'animation'], name: 'animation.js' } })
    expect(script!.unfold).toEqual({ segments: ['card', 'animation'], claimed: ['animation.js'] })
    expect(style!.opens).toEqual({ kind: 'resource', sig: STYLE_SIG, name: 'style.css', file: { route: ['card', 'style'], name: 'style.css' } })
    expect(style!.unfold).toEqual({ segments: ['card', 'style'], claimed: ['style.css'] })
    // The traits of those names are the part rows already; the holders and the shell are not listed again.
    expect(labels(also)).toEqual(['tile:back'])
  })

  it('reads only the tile, and the children that hold a shell part', async () => {
    const h = inParts()
    await composedParts(h.reader, { segments: ['card'] })
    expect(h.calls.filter(call => call.startsWith('tile:'))).toEqual(['tile:card', 'tile:card/animation', 'tile:card/style'])
  })

  it('keeps a part that is a file on the page\'s own tile as that file', async () => {
    const h = inParts()
    h.tiles.get('card')!.files!.push({ name: 'animation.js', sig: SCRIPT_SIG, size: 5 })
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    const script = pageOf(parts).children![1]!
    expect(script.opens).toEqual({ kind: 'resource', sig: SCRIPT_SIG, name: 'animation.js', file: { route: ['card'], name: 'animation.js' } })
    expect(script.unfold).toBeUndefined()
    // The child of that name is then its trait's row, and the file is not listed again.
    expect(labels(parts)).toEqual(['page:', 'trait:animation'])
    expect(labels(also)).toEqual(['tile:back'])
  })

  it('opens a part by the shell\'s signature when the child\'s file has another', async () => {
    const h = inParts()
    h.tiles.set('card/animation', { files: [{ name: 'animation.js', sig: sig(900), size: 9 }] })
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    const script = pageOf(parts).children![1]!
    expect(script).toEqual({
      key: 'tile:/card>part:script-1', how: 'script', label: 'animation.js', sig: SCRIPT_SIG,
      opens: { kind: 'resource', sig: SCRIPT_SIG, name: 'animation.js' },
    })
    // The child is still reached, once: as the trait it fills.
    expect(parts[1]).toEqual({
      key: 'tile:/card>trait:animation', how: 'trait', label: 'animation', state: 'filled',
      opens: { kind: 'tile', segments: ['card', 'animation'] }, unfold: { segments: ['card', 'animation'] },
    })
    expect(labels(also)).toEqual(['tile:back'])
  })

  it('is the file of the child only when the newest file of that name there has the signature the shell names', async () => {
    const h = inParts()
    // An older record of the name has the shell's signature; the file is the newer one.
    h.tiles.set('card/animation', { files: [{ name: 'animation.js', sig: SCRIPT_SIG, size: 5 }, { name: 'animation.js', sig: sig(900), size: 9 }] })
    const { parts } = await composedParts(h.reader, { segments: ['card'] })
    expect(pageOf(parts).children![1]).toEqual({
      key: 'tile:/card>part:script-1', how: 'script', label: 'animation.js', sig: SCRIPT_SIG,
      opens: { kind: 'resource', sig: SCRIPT_SIG, name: 'animation.js' },
    })
    expect(labels(parts)).toEqual(['page:', 'trait:animation'])
  })

  // breakBlockOut does not refuse a name a block already took: two blocks
  // moved out as `lib` are two references named lib.js.
  describe('two blocks moved out under one name', () => {
    const TWO = '<!doctype html><html><body><script>one()</script><script>two()</script></body></html>'
    const twice = (page: string, first: string, second: string): string => {
      const a = moveBlockOut(page, 'script-1', () => ({ sig: first, name: 'lib.js' }))
      if (!a.ok) throw new Error(a.error)
      const b = moveBlockOut(a.shell, 'script-2', () => ({ sig: second, name: 'lib.js' }))
      if (!b.ok) throw new Error(b.error)
      return b.shell
    }
    const libs = (shell: string, page: string, onChild: TileFile[]) => {
      const h = hive()
      h.tiles.set('card', { children: [{ name: 'lib', sig: sig(210) }], files: [{ name: SHELL_FILE, sig: SHELL_SIG, size: shell.length }] })
      h.tiles.set('card/lib', { files: onChild })
      h.pages.set('card', PAGE_SIG)
      h.texts.set(PAGE_SIG, page).set(SHELL_SIG, shell)
      return h
    }

    it('are two rows with two keys when their texts differ', async () => {
      const ONE = sig(0x301), OTHER = sig(0x302)
      const shell = twice(TWO, ONE, OTHER)
      // The second move replaced the first file on the child.
      const h = libs(shell, TWO, [{ name: 'lib.js', sig: OTHER, size: 5 }])
      h.texts.set(ONE, 'one()').set(OTHER, 'two()')
      expect(assemblePage(shell, wanted => h.texts.get(wanted))).toMatchObject({ ok: true, html: TWO })
      const kids = pageOf((await composedParts(h.reader, { segments: ['card'] })).parts).children!
      expect(kids.map(node => [node.key, node.label, node.sig, !!node.unfold])).toEqual([
        ['tile:/card>shell', SHELL_FILE, SHELL_SIG, false],
        ['tile:/card>part:script-1', 'lib.js', ONE, false],
        ['tile:/card>part:script-2', 'lib.js', OTHER, true],
      ])
    })

    it('are two rows with two keys when their texts are the same', async () => {
      const SAME = sig(0x303)
      const page = TWO.replace('two()', 'one()')
      const h = libs(twice(page, SAME, SAME), page, [{ name: 'lib.js', sig: SAME, size: 5 }])
      h.texts.set(SAME, 'one()')
      const kids = pageOf((await composedParts(h.reader, { segments: ['card'] })).parts).children!
      expect(kids.map(node => node.key)).toEqual(['tile:/card>shell', 'tile:/card>part:script-1', 'tile:/card>part:script-2'])
      expect(kids[1]!.unfold).toEqual({ segments: ['card', 'lib'], claimed: ['lib.js'] })
      expect(kids[2]!.unfold).toEqual({ segments: ['card', 'lib'], claimed: ['lib.js'] })
    })
  })

  it('two parts that live on one child are not listed again under each other', async () => {
    // `/part /card script-1 theme` then `/part /card style-1 theme`: both files are on /card/theme.
    const first = moveBlockOut(PAGE, 'script-1', () => ({ sig: SCRIPT_SIG, name: 'theme.js' }))
    const second = first.ok ? moveBlockOut(first.shell, 'style-1', () => ({ sig: STYLE_SIG, name: 'theme.css' })) : first
    if (!second.ok) throw new Error(second.error)
    const h = hive()
    h.tiles.set('card', { children: [{ name: 'theme', sig: sig(220) }], files: [{ name: SHELL_FILE, sig: SHELL_SIG, size: second.shell.length }] })
    h.tiles.set('card/theme', { files: [{ name: 'theme.css', sig: STYLE_SIG, size: 15 }, { name: 'theme.js', sig: SCRIPT_SIG, size: 5 }, file('notes.txt', 9)] })
    h.pages.set('card', PAGE_SIG)
    h.texts.set(PAGE_SIG, PAGE).set(SHELL_SIG, second.shell).set(SCRIPT_SIG, 'run()').set(STYLE_SIG, 'body{color:red}')
    h.traits.set('card', [{ word: 'theme', rung: 'child', sig: sig(220), route: ['card', 'theme'] }])
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    expect(labels(parts)).toEqual(['page:'])
    expect(also).toEqual([])
    const [, script, style] = pageOf(parts).children!
    expect(script!.unfold).toEqual({ segments: ['card', 'theme'], claimed: ['theme.js', 'theme.css'] })
    expect(style!.unfold).toEqual({ segments: ['card', 'theme'], claimed: ['theme.js', 'theme.css'] })
    // Under either row: only what no part row is.
    for (const row of [script!, style!]) {
      const under = await composedParts(h.reader, row.unfold!)
      expect(under.parts).toEqual([])
      expect(labels(under.also)).toEqual(['file:notes.txt'])
    }
    h.tiles.set('card/theme', { files: [{ name: 'theme.css', sig: STYLE_SIG, size: 15 }, { name: 'theme.js', sig: SCRIPT_SIG, size: 5 }] })
    expect((await composedParts(h.reader, script!.unfold!)).also).toEqual([])
    expect((await composedParts(h.reader, style!.unfold!)).also).toEqual([])
  })

  it('lists a part whose text is not here in its place, and the page is still in parts', async () => {
    const h = inParts()
    h.texts.delete(SCRIPT_SIG)
    const page = pageOf((await composedParts(h.reader, { segments: ['card'] })).parts)
    expect(labels(page.children!)).toEqual([`shell:${SHELL_FILE}`, 'script:animation.js', 'style:style.css'])
    expect(page.children![1]!.state).toBe('absent')
    expect(page.children![1]!.opens).toMatchObject({ file: { route: ['card', 'animation'], name: 'animation.js' } })
    expect(page.children![2]!.state).toBeUndefined()
  })

  it('sets a stale shell aside, read only: the page was written whole since', async () => {
    const h = inParts()
    h.texts.set(PAGE_SIG, PAGE.replace('run()', 'run(2)'))
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    expect(pageOf(parts).children).toEqual([])
    // Its former part tiles are the traits they fill, and still unfold.
    expect(labels(parts)).toEqual(['page:', 'trait:animation', 'trait:style'])
    expect(parts[1]!.unfold).toEqual({ segments: ['card', 'animation'] })
    expect(labels(also)).toEqual(['tile:back', `file:${SHELL_FILE}`])
    expect(also[1]).toEqual({
      key: `tile:/card#${SHELL_FILE}`, how: 'file', label: SHELL_FILE, sig: SHELL_SIG, size: SHELL.length, state: 'stale',
      opens: { kind: 'resource', sig: SHELL_SIG, name: SHELL_FILE },
    })
  })

  it('still lists the shell\'s parts when the page\'s own text is not here', async () => {
    const h = inParts()
    h.texts.delete(PAGE_SIG)
    const page = pageOf((await composedParts(h.reader, { segments: ['card'] })).parts)
    expect(page.state).toBe('absent')
    expect(labels(page.children!)).toEqual([`shell:${SHELL_FILE}`, 'script:animation.js', 'style:style.css'])
  })

  it('shows a page whole when the tile has no shell', async () => {
    const h = hive()
    h.tiles.set('card', {})
    h.pages.set('card', PAGE_SIG)
    h.texts.set(PAGE_SIG, PAGE)
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    expect(parts).toEqual([{ key: 'tile:/card>page', how: 'page', label: '', sig: PAGE_SIG, opens: { kind: 'resource', sig: PAGE_SIG, name: 'page' }, children: [] }])
    expect(also).toEqual([])
  })
})

// ── traits ───────────────────────────────────────────────────────────────

const SITE = '<!doctype html><html><body><header data-hc-trait="header">mine</header><main data-hc-trait="hero"></main><footer data-hc-trait="Header"></footer></body></html>'

const site = (resolutions: TraitResolution[], children: { name: string; sig?: string }[] = []) => {
  const h = hive()
  h.tiles.set('site', { children })
  h.pages.set('site', PAGE_SIG)
  h.texts.set(PAGE_SIG, SITE)
  h.traits.set('site', resolutions)
  return h
}
const traitRows = async (h: ReturnType<typeof hive>) => {
  const made = await composedParts(h.reader, { segments: ['site'] })
  return { ...made, stated: pageOf(made.parts).children!.filter(node => node.how === 'trait') }
}

describe('the traits a page states', () => {
  it('are rows of the page, in document order, one per word', async () => {
    const { stated } = await traitRows(site([]))
    expect(labels(stated)).toEqual(['trait:header', 'trait:hero'])
  })

  it('filled by a child: opens the tile, unfolds it, and the child is not listed again', async () => {
    const h = site([{ word: 'header', rung: 'child', sig: sig(7), route: ['site', 'header'] }], [{ name: 'header', sig: sig(7) }, { name: 'notes' }])
    const { stated, also } = await traitRows(h)
    expect(stated[0]).toEqual({
      key: 'tile:/site>trait:header', how: 'trait', label: 'header', state: 'filled',
      opens: { kind: 'tile', segments: ['site', 'header'] }, unfold: { segments: ['site', 'header'] },
    })
    expect(labels(also)).toEqual(['tile:notes'])
  })

  it('the page\'s own version stands: stated with nothing said, or resolved as its own; it opens the page', async () => {
    const { stated } = await traitRows(site([{ word: 'hero', rung: 'own', offers: [] }]))
    const whole = { kind: 'resource', sig: PAGE_SIG, name: 'page' }
    expect(stated.map(node => [node.label, node.state, node.opens])).toEqual([['header', 'own', whole], ['hero', 'own', whole]])
  })

  it('the page\'s own version opens the shell when the page is in parts', async () => {
    const h = inParts()
    const stating = PAGE.replace('<body>', '<body><header data-hc-trait="header"></header>')
    const first = moveBlockOut(stating, 'script-1', () => ({ sig: SCRIPT_SIG, name: 'animation.js' }))
    const second = first.ok ? moveBlockOut(first.shell, 'style-1', () => ({ sig: STYLE_SIG, name: 'style.css' })) : first
    if (!second.ok) throw new Error(second.error)
    h.texts.set(PAGE_SIG, stating).set(SHELL_SIG, second.shell)
    const page = pageOf((await composedParts(h.reader, { segments: ['card'] })).parts)
    const header = page.children!.find(node => node.how === 'trait')!
    expect(header.state).toBe('own')
    expect(header.opens).toEqual({ kind: 'resource', sig: SHELL_SIG, name: SHELL_FILE, file: { route: ['card'], name: SHELL_FILE } })
  })

  it('says empty when nothing fills it and offered when several could', async () => {
    const { stated } = await traitRows(site([
      { word: 'header', rung: 'miss' },
      { word: 'hero', rung: 'choose', candidates: [{ sig: sig(1), route: ['a', 'hero'] }, { sig: sig(2), route: ['b', 'hero'] }] },
    ]))
    expect(stated.map(node => [node.label, node.state, node.unfold])).toEqual([['header', 'empty', undefined], ['hero', 'offered', undefined]])
  })

  it('a chosen filler is the child that still has that head', async () => {
    const h = site([{ word: 'header', rung: 'fill', sig: sig(7) }], [{ name: 'tall-header', sig: sig(7) }])
    const { stated, also } = await traitRows(h)
    expect(stated[0]).toMatchObject({ state: 'chosen', opens: { kind: 'tile', segments: ['site', 'tall-header'] }, unfold: { segments: ['site', 'tall-header'] } })
    expect(also).toEqual([])
  })

  it('a chosen filler no child has any more is read by its signature, and does not unfold', async () => {
    const h = site([{ word: 'header', rung: 'fill', sig: sig(8) }], [{ name: 'tall-header', sig: sig(7) }])
    const { stated, also } = await traitRows(h)
    expect(stated[0]).toEqual({ key: 'tile:/site>trait:header', how: 'trait', label: 'header', state: 'chosen', sig: sig(8), opens: { kind: 'resource', sig: sig(8), name: 'header' } })
    expect(labels(also)).toEqual(['tile:tall-header'])
  })

  it('filled from elsewhere in the hive unfolds, but never the tile itself or one above it', async () => {
    const elsewhere = await traitRows(site([{ word: 'header', rung: 'hive', sig: sig(7), route: ['shared', 'header'] }]))
    expect(elsewhere.stated[0]).toMatchObject({ state: 'filled', opens: { kind: 'tile', segments: ['shared', 'header'] }, unfold: { segments: ['shared', 'header'] } })
    const h = hive()
    h.tiles.set('header/site', {})
    h.traits.set('header/site', [{ word: 'header', rung: 'hive', sig: sig(7), route: ['header'] }, { word: 'site', rung: 'hive', sig: sig(8), route: ['header', 'site'] }])
    const { parts } = await composedParts(h.reader, { segments: ['header', 'site'] })
    expect(parts.map(node => [node.label, node.opens, node.unfold])).toEqual([
      ['header', { kind: 'tile', segments: ['header'] }, undefined],
      ['site', { kind: 'tile', segments: ['header', 'site'] }, undefined],
    ])
  })
})

describe('a trait filled from elsewhere in the hive', () => {
  it('does not take the child of that name the tile has: the child is still listed', async () => {
    const h = site(
      [{ word: 'header', rung: 'hive', sig: sig(7), route: ['shared', 'header'] }],
      [{ name: 'header', sig: sig(9) }, { name: 'notes' }],
    )
    const { stated, also } = await traitRows(h)
    expect(stated[0]).toMatchObject({ state: 'filled', opens: { kind: 'tile', segments: ['shared', 'header'] }, unfold: { segments: ['shared', 'header'] } })
    expect(labels(also)).toEqual(['tile:header', 'tile:notes'])
  })
})

// The renderer replaces the element of a filled trait and never asks for a
// trait stated inside it (website/trait-seat.ts seatFillers).
describe('a trait stated inside another stated trait', () => {
  const NESTED = '<!doctype html><html><body><header data-hc-trait="header"><img data-hc-trait="logo"></header></body></html>'
  const nested = (headerPage: string | null) => {
    const h = hive()
    h.tiles.set('site', { children: [{ name: 'header', sig: sig(7) }, { name: 'logo', sig: sig(8) }] })
    h.pages.set('site', PAGE_SIG)
    if (headerPage) h.pages.set('site/header', headerPage)
    h.pages.set('site/logo', sig(0x72))
    h.texts.set(PAGE_SIG, NESTED)
    h.traits.set('site', [
      { word: 'header', rung: 'child', sig: sig(7), route: ['site', 'header'] },
      { word: 'logo', rung: 'child', sig: sig(8), route: ['site', 'logo'] },
    ])
    return h
  }

  it('is not a row of the page when the outer one is filled: the drawn page never asks for it', async () => {
    const { parts, also } = await composedParts(nested(sig(0x71)).reader, { segments: ['site'] })
    expect(labels(pageOf(parts).children!)).toEqual(['trait:header'])
    // The tile that would fill it is not lost: it is a trait of the tile, and still unfolds.
    expect(labels(parts)).toEqual(['page:', 'trait:logo'])
    expect(parts[1]).toMatchObject({ state: 'filled', unfold: { segments: ['site', 'logo'] } })
    expect(parts[1]!.opens).toEqual({ kind: 'tile', segments: ['site', 'logo'] })
    expect(also).toEqual([])
  })

  it('is still a row of the page when the outer filler wears no page: the version the page has stands', async () => {
    const { parts } = await composedParts(nested(null).reader, { segments: ['site'] })
    expect(labels(pageOf(parts).children!)).toEqual(['trait:header', 'trait:logo'])
    expect(labels(parts)).toEqual(['page:'])
  })

  it('asks no filler for its page when the page states one trait, or nothing fills', async () => {
    const one = site([{ word: 'header', rung: 'child', sig: sig(7), route: ['site', 'header'] }], [{ name: 'header', sig: sig(7) }])
    one.texts.set(PAGE_SIG, '<!doctype html><html><body><header data-hc-trait="header"></header></body></html>')
    await composedParts(one.reader, { segments: ['site'] })
    expect(one.pageAsked).toEqual(['site'])
    const unfilled = site([{ word: 'header', rung: 'miss' }, { word: 'hero', rung: 'own', offers: [] }])
    await composedParts(unfilled.reader, { segments: ['site'] })
    expect(unfilled.pageAsked).toEqual(['site'])
  })
})

describe('the traits a tile has that its page does not state', () => {
  it('are rows of the tile, with or without a page, and their child is not lost', async () => {
    const h = hive()
    h.tiles.set('profile', { children: [{ name: 'portrait', sig: sig(7) }, { name: 'notes' }] })
    h.traits.set('profile', [{ word: 'portrait', rung: 'child', sig: sig(7), route: ['profile', 'portrait'] }, { word: 'voice', rung: 'miss' }])
    const { parts, also } = await composedParts(h.reader, { segments: ['profile'] })
    expect(parts).toEqual([
      { key: 'tile:/profile>trait:portrait', how: 'trait', label: 'portrait', state: 'filled', opens: { kind: 'tile', segments: ['profile', 'portrait'] }, unfold: { segments: ['profile', 'portrait'] } },
      { key: 'tile:/profile>trait:voice', how: 'trait', label: 'voice', state: 'empty' },
    ])
    expect(labels(also)).toEqual(['tile:notes'])
  })

  it('come after the page, and a stated word is not said twice', async () => {
    const h = site([{ word: 'Hero', rung: 'miss' }, { word: 'portrait', rung: 'own', offers: [] }])
    const { parts, stated } = await traitRows(h)
    expect(labels(stated)).toEqual(['trait:header', 'trait:hero'])
    expect(labels(parts)).toEqual(['page:', 'trait:portrait'])
    expect(parts[1]!.opens).toBeUndefined()
  })
})

// ── the resources a page names ───────────────────────────────────────────

describe('the resources a page names', () => {
  const A = sig(0xa1), B = sig(0xb1), PICTURE = sig(0xc1), UNHELD = sig(0xd1), ON_TILE = sig(0xe1)
  const naming = () => {
    const h = hive()
    h.tiles.set('cafe', { files: [{ name: 'menu.json', sig: ON_TILE, size: 40 }, file('other.txt', 5)] })
    h.pages.set('cafe', PAGE_SIG)
    h.texts.set(PAGE_SIG, [
      '<!doctype html><html><head>',
      `<link rel="stylesheet" href="resource:${A}/type.css">`,
      `<script src="resource:${B}/x.js"></script>`,
      '</head><body>',
      `<img src="resource:${PICTURE}">`,
      `<a href="resource:${UNHELD}/terms.pdf">terms</a>`,
      `<a href="resource:${ON_TILE}">menu</a>`,
      `<a href="resource:${PAGE_SIG}">this page</a>`,
      `<img src="resource:${PICTURE}">`,
      '</body></html>',
    ].join('\n'))
    h.held.set(A, { size: 300, picture: false }).set(B, { size: 200, picture: false }).set(PICTURE, { size: 9_000, picture: true })
    return h
  }

  it('are rows of the page in page order: a sheet, a script, a picture, a name', async () => {
    const page = pageOf((await composedParts(naming().reader, { segments: ['cafe'] })).parts)
    expect(page.children!.map(node => [node.how, node.label, node.sig, node.size, node.state])).toEqual([
      ['style', 'type.css', A, 300, undefined],
      ['script', 'x.js', B, 200, undefined],
      ['picture', '', PICTURE, 9_000, undefined],
      ['named', 'terms.pdf', UNHELD, undefined, 'absent'],
      ['file', 'menu.json', ON_TILE, 40, undefined],
    ])
    expect(page.children![0]!.opens).toEqual({ kind: 'resource', sig: A, name: 'type.css' })
    expect(page.children![2]!.opens).toEqual({ kind: 'resource', sig: PICTURE, name: PICTURE.slice(0, 12) })
  })

  it('a signature that is a file on the tile is one row, with the file reference', async () => {
    const { parts, also } = await composedParts(naming().reader, { segments: ['cafe'] })
    const row = pageOf(parts).children![4]!
    expect(row.opens).toEqual({ kind: 'resource', sig: ON_TILE, name: 'menu.json', file: { route: ['cafe'], name: 'menu.json' } })
    expect(labels(also)).toEqual(['file:other.txt'])
  })

  it('does not repeat the signatures of a shell\'s parts', async () => {
    const h = inParts()
    h.texts.delete(PAGE_SIG)
    // Read from the shell, whose tags name each part by resource:<signature>.
    const page = pageOf((await composedParts(h.reader, { segments: ['card'] })).parts)
    expect(page.children!.filter(node => node.key.includes('>ref:'))).toEqual([])
  })

  it('reads the shell for what the page names when the text of the page is not here', async () => {
    const h = inParts()
    const X = sig(0xf1)
    h.texts.set(SHELL_SIG, SHELL.replace('<body>', `<body><link rel="stylesheet" href="resource:${X}/x.css">`))
    h.texts.delete(PAGE_SIG)
    h.held.set(X, { size: 77, picture: false })
    const page = pageOf((await composedParts(h.reader, { segments: ['card'] })).parts)
    expect(page.state).toBe('absent')
    // The sheet the shell links is listed; the parts of the shell are not said again.
    expect(page.children!.filter(node => node.key.includes('>ref:')).map(node => [node.how, node.label, node.sig, node.size])).toEqual([['style', 'x.css', X, 77]])
  })

  it('lists a former part the page links, when its shell is stale and no part row is drawn', async () => {
    const h = inParts()
    // Written whole since it was broken apart: the page now links the script it used to hold.
    h.texts.set(PAGE_SIG, `<!doctype html><html><body><script src="resource:${SCRIPT_SIG}/animation.js"></script></body></html>`)
    h.held.set(SCRIPT_SIG, { size: 5, picture: false })
    const { parts, also } = await composedParts(h.reader, { segments: ['card'] })
    expect(pageOf(parts).children!.map(node => [node.key, node.how, node.label, node.sig, node.size])).toEqual([
      [`tile:/card>ref:${SCRIPT_SIG}`, 'script', 'animation.js', SCRIPT_SIG, 5],
    ])
    expect(also.find(node => node.label === SHELL_FILE)!.state).toBe('stale')
  })

  it('a linked sheet or script that is a file on the tile is that file, typed by its link', async () => {
    const h = hive()
    h.tiles.set('cafe', { files: [{ name: 'type.css', sig: A, size: 300 }, { name: 'x.js', sig: B, size: 200 }] })
    h.pages.set('cafe', PAGE_SIG)
    h.texts.set(PAGE_SIG, `<!doctype html><html><head><link rel="stylesheet" href="resource:${A}/type.css"><script src="resource:${B}/x.js"></script></head><body></body></html>`)
    const { parts, also } = await composedParts(h.reader, { segments: ['cafe'] })
    expect(pageOf(parts).children!.map(node => [node.how, node.label, node.opens])).toEqual([
      ['style', 'type.css', { kind: 'resource', sig: A, name: 'type.css', file: { route: ['cafe'], name: 'type.css' } }],
      ['script', 'x.js', { kind: 'resource', sig: B, name: 'x.js', file: { route: ['cafe'], name: 'x.js' } }],
    ])
    expect(also).toEqual([])
  })

  it(`lists at most ${FRAME_MAX_CARRIED}, then says how many more`, async () => {
    const h = hive()
    h.tiles.set('wall', {})
    h.pages.set('wall', PAGE_SIG)
    h.texts.set(PAGE_SIG, Array.from({ length: FRAME_MAX_CARRIED + 1 }, (_, i) => `<img src="resource:${sig(0x1000 + i)}">`).join(''))
    const kids = pageOf((await composedParts(h.reader, { segments: ['wall'] })).parts).children!
    expect(kids).toHaveLength(FRAME_MAX_CARRIED + 1)
    expect(kids[FRAME_MAX_CARRIED]).toEqual({ key: 'tile:/wall>more', how: 'more', label: '', count: 1 })
  })

  // The sheet-or-script answer is the frame's own rule, asked with each
  // signature standing in as its text. This is the output that asking relies on.
  it('relies on how the frame writes a linked sheet and script into a page', async () => {
    const probed = await inlineLinkedCode(
      `<link rel="stylesheet" href="resource:${A}/type.css"><script src="resource:${B}/x.js"></script>`,
      async wanted => new TextEncoder().encode(wanted),
    )
    expect(probed).toBe(`<style data-hc-sheet="${A}">${A}</style><script data-hc-script="${B}">${B}</script>`)
  })
})

// ── the card ─────────────────────────────────────────────────────────────

describe('a tile\'s card', () => {
  it('is the resources its record names, in the record\'s order; one not here says so', async () => {
    const h = hive()
    h.tiles.set('card', {})
    h.cards.set('card', { themeSig: sig(2), title: 'Jaime', dataSig: sig(1), artSig: sig(3) })
    h.held.set(sig(2), { size: 120, picture: false }).set(sig(3), { size: 4_000, picture: true })
    const { parts } = await composedParts(h.reader, { segments: ['card'] })
    expect(labels(parts)).toEqual(['card:'])
    expect(parts[0]!.opens).toBeUndefined()
    expect(parts[0]!.children!.map(node => [node.how, node.label, node.sig, node.size, node.state, node.opens])).toEqual([
      ['field', 'themeSig', sig(2), 120, undefined, { kind: 'resource', sig: sig(2), name: 'themeSig' }],
      ['field', 'dataSig', sig(1), undefined, 'absent', { kind: 'resource', sig: sig(1), name: 'dataSig' }],
      ['field', 'artSig', sig(3), 4_000, undefined, { kind: 'resource', sig: sig(3), name: 'artSig' }],
    ])
  })

  it('is not a row when the tile has no card, or the card names nothing', async () => {
    const h = hive()
    h.tiles.set('plain', {})
    h.tiles.set('named', {})
    h.cards.set('named', { title: 'no signatures here' })
    expect((await composedParts(h.reader, { segments: ['plain'] })).parts).toEqual([])
    expect((await composedParts(h.reader, { segments: ['named'] })).parts).toEqual([])
  })
})
