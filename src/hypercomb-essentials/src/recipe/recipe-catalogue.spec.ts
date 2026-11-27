// recipe/recipe-catalogue.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RECIPE_CATALOGUE_STYLE_ID,
  recipeCatalogue,
  recipeCatalogueGroups,
  type RecipeCatalogueHandle,
  type RecipeCatalogueOptions,
  type RecipeCatalogueRow,
} from './recipe-catalogue.js'
import type { PoolNode } from '../pools/pool-node.js'

const SIG_LASAGNE = 'a'.repeat(64)
const SIG_BREAD = 'b'.repeat(64)
const SIG_SOUP = 'c'.repeat(64)
const SIG_CAKE = 'd'.repeat(64)
const PIC_LASAGNE = '1'.repeat(64)
const PIC_BREAD = '2'.repeat(64)

const YOU: PoolNode = { kind: 'domain', id: 'mine.example', you: true }
const ANA: PoolNode = { kind: 'participant', id: 'e'.repeat(64), name: 'Ana Maria Lopez' }
const BEN: PoolNode = { kind: 'participant', id: 'f'.repeat(64), name: 'Ben Okri' }
const BAKERY: PoolNode = { kind: 'domain', id: 'bakery.example' }
const KITCHEN: PoolNode = { kind: 'domain', id: 'my-kitchen.org' }

const LASAGNE: RecipeCatalogueRow = { sig: SIG_LASAGNE, name: 'Sunday lasagne', cover: PIC_LASAGNE, nodes: [KITCHEN, ANA], at: 10 }
const BREAD: RecipeCatalogueRow = { sig: SIG_BREAD, name: 'Sourdough bread', cover: PIC_BREAD, nodes: [BAKERY], at: 30 }
const SOUP: RecipeCatalogueRow = { sig: SIG_SOUP, name: 'Miso soup', nodes: [YOU] }
const CAKE: RecipeCatalogueRow = { sig: SIG_CAKE, name: 'Lemon cake', nodes: [BAKERY, BEN], at: 20 }
const ROWS: readonly RecipeCatalogueRow[] = [LASAGNE, CAKE, BREAD, SOUP]

const say = (_key: string, fallback: string, params?: Record<string, string | number>): string =>
  fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

const open: RecipeCatalogueHandle[] = []

function mount(over: Partial<RecipeCatalogueOptions> = {}) {
  const spies = { onOpen: vi.fn(), onQuery: vi.fn(), onClose: vi.fn() }
  const catalogue = recipeCatalogue({ say, title: 'Recipes from your nodes', rows: ROWS, pictureUrl: () => '', ...spies, ...over })
  document.body.append(catalogue.element)
  open.push(catalogue)
  return { catalogue, root: catalogue.element, ...spies }
}

const shape = (groups: ReturnType<typeof recipeCatalogueGroups>): [string, string[]][] =>
  groups.map(group => [group.node.id, group.rows.map(row => row.name)])
const heads = (root: HTMLElement): string[] => [...root.querySelectorAll('.hc-recipe-catalogue-from-name')].map(node => node.textContent ?? '')
const names = (root: HTMLElement): string[] => [...root.querySelectorAll('.hc-recipe-catalogue-name')].map(node => node.textContent ?? '')
const cards = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-catalogue-card')]
const cardOf = (root: HTMLElement, sig: string, node: PoolNode): HTMLButtonElement =>
  cards(root).find(card => card.dataset['sig'] === sig && card.dataset['node'] === `${node.kind}:${node.id}`)!
const search = (root: HTMLElement): HTMLInputElement => root.querySelector<HTMLInputElement>('input[type="search"]')!
const none = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('[data-none]')!
const asking = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('[role="status"]')!
const type = (root: HTMLElement, words: string): void => {
  const field = search(root)
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const key = (target: EventTarget, name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
const focused = (): HTMLElement => document.activeElement as HTMLElement

afterEach(() => {
  for (const catalogue of open.splice(0)) catalogue.dispose()
  document.body.replaceChildren()
})

describe('the grouping', () => {
  it('heads a group with each node: you, then participants, then domains, each by name', () => {
    expect(shape(recipeCatalogueGroups(ROWS))).toEqual([
      ['mine.example', ['Miso soup']],
      [ANA.id, ['Sunday lasagne']],
      [BEN.id, ['Lemon cake']],
      ['bakery.example', ['Sourdough bread', 'Lemon cake']],
      ['my-kitchen.org', ['Sunday lasagne']],
    ])
    // Your own node leads whatever kind it is and whatever it is called.
    const me: PoolNode = { kind: 'participant', id: '9'.repeat(64), name: 'Zed', you: true }
    expect(shape(recipeCatalogueGroups([{ ...SOUP, nodes: [me] }, CAKE]))[0]).toEqual([me.id, ['Miso soup']])
    // Names are ordered whatever their case.
    const upper: PoolNode = { kind: 'domain', id: 'Apple.example' }
    expect(recipeCatalogueGroups([{ ...BREAD, nodes: [BAKERY, upper] }]).map(group => group.node.id)).toEqual(['Apple.example', 'bakery.example'])
  })

  it('puts a row two nodes offer under both, and newer rows first', () => {
    const groups = recipeCatalogueGroups(ROWS)
    expect(groups.filter(group => group.rows.some(row => row.sig === SIG_LASAGNE)).map(group => group.node.id)).toEqual([ANA.id, 'my-kitchen.org'])
    // Rows with no date keep the order they came in, after the dated ones.
    const undated = recipeCatalogueGroups([{ ...SOUP, nodes: [BAKERY] }, { ...LASAGNE, nodes: [BAKERY], at: undefined }, BREAD])
    expect(undated[0].rows.map(row => row.name)).toEqual(['Sourdough bread', 'Miso soup', 'Sunday lasagne'])
  })

  it('makes one row of the same signature, and gives a node the fullest name any mention had', () => {
    const bare: PoolNode = { kind: 'participant', id: ANA.id }
    const groups = recipeCatalogueGroups([{ ...LASAGNE, nodes: [bare] }, { ...LASAGNE, nodes: [KITCHEN, ANA] }])
    expect(shape(groups)).toEqual([[ANA.id, ['Sunday lasagne']], ['my-kitchen.org', ['Sunday lasagne']]])
    expect(groups[0].node.name).toBe('Ana Maria Lopez')
    expect(groups[0].rows[0].nodes.map(node => node.name ?? node.id)).toEqual(['Ana Maria Lopez', 'my-kitchen.org'])
    // A row nobody offers stands under nobody.
    expect(recipeCatalogueGroups([{ ...SOUP, nodes: [] }])).toEqual([])
  })

  it('shows only the nodes switched on', () => {
    expect(shape(recipeCatalogueGroups(ROWS, [BAKERY, ANA]))).toEqual([
      [ANA.id, ['Sunday lasagne']],
      ['bakery.example', ['Sourdough bread', 'Lemon cake']],
    ])
    expect(recipeCatalogueGroups(ROWS, [])).toEqual([])
    // A node switched on that offers nothing heads no empty group.
    expect(recipeCatalogueGroups([BREAD], [BAKERY, KITCHEN]).map(group => group.node.id)).toEqual(['bakery.example'])
  })

  it('narrows by every word, in the name or in the name of a node that offers the row', () => {
    expect(shape(recipeCatalogueGroups(ROWS, undefined, '  LEMON   cake '))).toEqual([[BEN.id, ['Lemon cake']], ['bakery.example', ['Lemon cake']]])
    expect(shape(recipeCatalogueGroups(ROWS, undefined, 'ana'))).toEqual([[ANA.id, ['Sunday lasagne']], ['my-kitchen.org', ['Sunday lasagne']]])
    expect(shape(recipeCatalogueGroups(ROWS, undefined, 'bakery bread'))).toEqual([['bakery.example', ['Sourdough bread']]])
    expect(recipeCatalogueGroups(ROWS, undefined, 'bread lemon')).toEqual([])
    expect(recipeCatalogueGroups(ROWS, undefined, '   ')).toHaveLength(5)
  })
})

describe('the catalogue', () => {
  it('is one page: a title, a note, and the rows under the node each comes from', () => {
    const { root } = mount({ note: 'From the domains you follow and your room' })
    expect(document.querySelectorAll(`#${RECIPE_CATALOGUE_STYLE_ID}`)).toHaveLength(1)
    mount()
    expect(document.querySelectorAll(`#${RECIPE_CATALOGUE_STYLE_ID}`)).toHaveLength(1)

    const title = root.querySelector('h1')!
    expect(title.textContent).toBe('Recipes from your nodes')
    expect(root.getAttribute('aria-labelledby')).toBe(title.id)
    expect(root.querySelector('.hc-recipe-catalogue-note')?.textContent).toBe('From the domains you follow and your room')

    expect([...root.querySelectorAll('h1, h2, h3, h4')].map(node => node.tagName)).toEqual(['H1', 'H2', 'H2', 'H2', 'H2', 'H2'])
    expect(heads(root)).toEqual(['You', 'Ana Maria Lopez', 'Ben Okri', 'bakery.example', 'my-kitchen.org'])
    expect([...root.querySelectorAll('.hc-recipe-catalogue-count')].map(node => node.textContent)).toEqual(['1 recipe', '1 recipe', '1 recipe', '2 recipes', '1 recipe'])
    expect(names(root)).toEqual(['Miso soup', 'Sunday lasagne', 'Lemon cake', 'Sourdough bread', 'Lemon cake', 'Sunday lasagne'])

    // The grid is a list of real buttons.
    const grids = [...root.querySelectorAll('ul')]
    expect(grids).toHaveLength(5)
    expect(grids.every(grid => grid.getAttribute('role') === 'list')).toBe(true)
    expect(cards(root).every(card => card.tagName === 'BUTTON' && card.type === 'button' && card.parentElement?.tagName === 'LI')).toBe(true)
  })

  it('shows a node as a chip: initials to the eye, the whole name on hover and to a reader', () => {
    const { root } = mount()
    const chips = [...root.querySelectorAll<HTMLElement>('h2 .hc-recipe-catalogue-chip')]
    expect(chips.map(chip => chip.textContent)).toEqual(['MI', 'AL', 'BO', 'BA', 'MK'])
    expect(chips.map(chip => chip.title)).toEqual(['mine.example', 'Ana Maria Lopez', 'Ben Okri', 'bakery.example', 'my-kitchen.org'])
    expect(chips.map(chip => chip.getAttribute('aria-label'))).toEqual(chips.map(chip => chip.title))
    expect(chips.map(chip => chip.classList.contains('is-person'))).toEqual([false, true, true, false, false])
    expect(chips.map(chip => chip.classList.contains('is-you'))).toEqual([true, false, false, false, false])

    // A heading is read as its words and its count, once.
    const head = root.querySelector('h2')!
    expect(head.getAttribute('aria-labelledby')?.split(' ').map(id => document.getElementById(id)?.textContent)).toEqual(['You', '1 recipe'])
  })

  it('says on a card who else offers the row, and names the card by its words', () => {
    const { root } = mount()
    const card = cardOf(root, SIG_CAKE, BAKERY)
    const also = card.querySelector<HTMLElement>('.hc-recipe-catalogue-also')!
    expect([...also.querySelectorAll<HTMLElement>('.hc-recipe-catalogue-chip')].map(chip => [chip.textContent, chip.title])).toEqual([['BO', 'Ben Okri']])
    expect(also.getAttribute('aria-label')).toBe('Also from Ben Okri')
    expect(card.getAttribute('aria-labelledby')?.split(' ').map(id => document.getElementById(id))).toEqual([card.querySelector('.hc-recipe-catalogue-name'), also])
    // A row one node offers carries no other chip.
    const alone = cardOf(root, SIG_BREAD, BAKERY)
    expect(alone.querySelector('.hc-recipe-catalogue-also')).toBeNull()
    expect(alone.getAttribute('aria-labelledby')).toBe(alone.querySelector('.hc-recipe-catalogue-name')?.id)
  })

  it('shows a few of many other nodes and counts the rest', () => {
    const many: PoolNode[] = Array.from({ length: 8 }, (_, n) => ({ kind: 'domain', id: `host${n}.example` }))
    const { root } = mount({ rows: [{ ...SOUP, nodes: [YOU, ...many] }], nodes: [YOU] })
    const also = root.querySelector<HTMLElement>('.hc-recipe-catalogue-also')!
    expect(also.querySelectorAll('.hc-recipe-catalogue-chip')).toHaveLength(4)
    expect(also.querySelector('.hc-recipe-catalogue-more')?.textContent).toBe('+4')
    expect(also.getAttribute('aria-label')).toContain('host7.example')
  })

  it('shows only the nodes switched on, and says so when they offer nothing', () => {
    const { root, catalogue } = mount({ nodes: [BAKERY] })
    expect(heads(root)).toEqual(['bakery.example'])
    expect(names(root)).toEqual(['Sourdough bread', 'Lemon cake'])
    catalogue.update({ nodes: [] })
    expect(names(root)).toEqual([])
    expect(none(root).hidden).toBe(false)
    expect(none(root).textContent).toBe('The nodes you switched on offer nothing here.')
    // Given as undefined, the narrowing is lifted; left out, it stays.
    catalogue.update({ nodes: [ANA] })
    catalogue.update({ loading: false })
    expect(heads(root)).toEqual(['Ana Maria Lopez'])
    catalogue.update({ nodes: undefined })
    expect(heads(root)).toHaveLength(5)
  })

  it('narrows as words are typed, and takes a query from its caller', () => {
    const { root, catalogue, onQuery } = mount()
    type(root, 'cake')
    expect(onQuery).toHaveBeenLastCalledWith('cake')
    expect(heads(root)).toEqual(['Ben Okri', 'bakery.example'])
    expect(names(root)).toEqual(['Lemon cake', 'Lemon cake'])
    type(root, 'ana lasagne')
    expect(names(root)).toEqual(['Sunday lasagne', 'Sunday lasagne'])
    type(root, '')
    expect(names(root)).toHaveLength(6)

    onQuery.mockClear()
    catalogue.update({ query: 'miso' })
    expect(search(root).value).toBe('miso')
    expect(names(root)).toEqual(['Miso soup'])
    expect(onQuery).not.toHaveBeenCalled()

    const asked = mount({ query: 'bread' })
    expect(search(asked.root).value).toBe('bread')
    expect(names(asked.root)).toEqual(['Sourdough bread'])
  })

  it('says in words that it is asking, that nothing is here, and that nothing matches', () => {
    const { root, catalogue } = mount({ rows: [], loading: true })
    expect(asking(root).hidden).toBe(false)
    expect(asking(root).textContent).toBe('Asking the nodes you draw from')
    // Not said too soon: the nodes have not answered yet.
    expect(none(root).hidden).toBe(true)

    catalogue.update({ loading: false })
    expect(asking(root).hidden).toBe(true)
    expect(none(root).hidden).toBe(false)
    expect(none(root).textContent).toBe('Nothing is published here yet.')

    catalogue.update({ rows: ROWS, loading: true })
    expect(asking(root).hidden).toBe(false)
    expect(names(root)).toHaveLength(6)
    expect(none(root).hidden).toBe(true)

    catalogue.update({ loading: false })
    type(root, 'crumb  jars ')
    expect(names(root)).toEqual([])
    expect(none(root).hidden).toBe(false)
    expect(none(root).textContent).toBe('Nothing matches "crumb  jars".')
    type(root, '')
    expect(none(root).hidden).toBe(true)

    // Nothing at all is said to be nothing, whatever was typed.
    catalogue.update({ rows: [], query: 'bread' })
    expect(none(root).textContent).toBe('Nothing is published here yet.')
  })

  it('does not call itself empty when there is nothing to draw from: the note says how to get some', () => {
    const { root, catalogue } = mount({ rows: [], loading: false, unsourced: true })
    expect(none(root).hidden).toBe(true)
    // Once a source is on, an empty answer is said again.
    catalogue.update({ unsourced: false })
    expect(none(root).hidden).toBe(false)
    expect(none(root).textContent).toBe('Nothing is published here yet.')
  })

  it('falls back to English when the catalogue of words echoes the key or answers nothing', () => {
    const echo = mount({ say: key => key, rows: [], loading: true })
    expect(asking(echo.root).textContent).toBe('Asking the nodes you draw from')
    expect(search(echo.root).placeholder).toBe('Search recipes')
    const silent = mount({ say: () => '' })
    expect(heads(silent.root)[0]).toBe('You')
    expect(silent.root.querySelector('.hc-recipe-catalogue-count')?.textContent).toBe('1 recipe')
  })

  it('renders the words of a stranger as text and makes no element of them', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const person: PoolNode = { kind: 'participant', id: '7'.repeat(64), name: '<b>Mallory</b>' }
    const place: PoolNode = { kind: 'domain', id: '<script>x</script>.example' }
    const { root } = mount({ title: hostile, note: hostile, rows: [{ sig: 'not"a]sig', name: hostile, nodes: [person, place] }] })
    expect(root.querySelector('img, script, b')).toBeNull()
    expect(root.querySelector('h1')?.textContent).toBe(hostile)
    expect(root.querySelector('.hc-recipe-catalogue-note')?.textContent).toBe(hostile)
    expect(heads(root)).toEqual(['<b>Mallory</b>', '<script>x</script>.example'])
    expect(names(root)).toEqual([hostile, hostile])
    const chip = root.querySelector<HTMLElement>('h2 .hc-recipe-catalogue-chip')!
    expect(chip.title).toBe('<b>Mallory</b>')
    expect(chip.getAttribute('aria-label')).toBe('<b>Mallory</b>')
    expect(root.querySelector('.hc-recipe-catalogue-also')?.getAttribute('aria-label')).toBe('Also from <script>x</script>.example')
    // An odd signature is still only data: focus finds its card again without a selector built from it.
    cards(root)[1].focus()
    type(root, 'mallory')
    expect(focused().dataset['sig']).toBe('not"a]sig')
    expect(focused().dataset['node']).toBe('domain:<script>x</script>.example')
  })

  it('makes an image only from an address its caller answers, and a plate otherwise', () => {
    const ready = new Set<string>()
    const pictureUrl = vi.fn((sig: string) => (ready.has(sig) ? `blob:picture-${sig.slice(0, 4)}` : ''))
    const { root, catalogue } = mount({ pictureUrl })
    expect(root.querySelector('img')).toBeNull()
    // Asked by the cover's signature, never the row's, and never for a row with no cover.
    expect(new Set(pictureUrl.mock.calls.map(call => call[0]))).toEqual(new Set([PIC_LASAGNE, PIC_BREAD]))
    const plate = cardOf(root, SIG_LASAGNE, ANA).querySelector<HTMLElement>('.hc-recipe-catalogue-plate')!
    expect(plate.textContent).toBe('SL')
    expect(plate.getAttribute('aria-hidden')).toBe('true')
    expect(cardOf(root, SIG_SOUP, YOU).querySelector('.hc-recipe-catalogue-plate')?.textContent).toBe('MS')

    ready.add(PIC_BREAD)
    catalogue.update({})
    const pictures = [...root.querySelectorAll('img')]
    expect(pictures).toHaveLength(1)
    const picture = pictures[0]
    expect(picture.closest('button')).toBe(cardOf(root, SIG_BREAD, BAKERY))
    expect(picture.getAttribute('src')).toBe('blob:picture-2222')
    expect(picture.getAttribute('loading')).toBe('lazy')
    expect(picture.getAttribute('decoding')).toBe('async')
    expect(picture.alt).toBe('Sourdough bread')
    expect(cardOf(root, SIG_BREAD, BAKERY).querySelector('.hc-recipe-catalogue-plate')).toBeNull()

    // A card that did not change is kept: its picture is not made again.
    ready.add(PIC_LASAGNE)
    catalogue.update({})
    expect(root.querySelectorAll('img')).toHaveLength(3)
    expect(cardOf(root, SIG_BREAD, BAKERY).querySelector('img')).toBe(picture)

    // A picture that does not arrive leaves the plate.
    picture.dispatchEvent(new Event('error'))
    expect(cardOf(root, SIG_BREAD, BAKERY).querySelector('img')).toBeNull()
    expect(cardOf(root, SIG_BREAD, BAKERY).querySelector('.hc-recipe-catalogue-plate')?.textContent).toBe('SB')

    // A resolver that throws is a picture that is not ready.
    const broken = mount({ pictureUrl: () => { throw new Error('no store') } })
    expect(broken.root.querySelector('img')).toBeNull()
    expect(names(broken.root)).toHaveLength(6)
  })

  it('opens a row on a press and on Enter, once each', () => {
    const { root, onOpen } = mount()
    cardOf(root, SIG_BREAD, BAKERY).click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenLastCalledWith(SIG_BREAD)

    const card = cardOf(root, SIG_LASAGNE, KITCHEN)
    card.focus()
    expect(key(card, 'Enter').defaultPrevented).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenLastCalledWith(SIG_LASAGNE)
    // Space is the browser's own press on a button: it is left alone, so it is not doubled.
    expect(key(card, ' ').defaultPrevented).toBe(false)
    // Enter in the search opens nothing.
    search(root).focus()
    expect(key(search(root), 'Enter').defaultPrevented).toBe(false)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('walks the cards with the arrows, to and from the search', () => {
    const { root, catalogue } = mount()
    catalogue.focus()
    expect(focused()).toBe(search(root))
    // Left and right in the field belong to the caret.
    expect(key(search(root), 'ArrowRight').defaultPrevented).toBe(false)
    expect(key(search(root), 'ArrowDown').defaultPrevented).toBe(true)
    expect(focused()).toBe(cards(root)[0])
    key(focused(), 'ArrowRight')
    expect(focused()).toBe(cards(root)[1])
    key(focused(), 'ArrowDown')
    expect(focused()).toBe(cards(root)[2])
    key(focused(), 'ArrowLeft')
    key(focused(), 'ArrowUp')
    expect(focused()).toBe(cards(root)[0])
    expect(key(focused(), 'ArrowLeft').defaultPrevented).toBe(false)
    key(focused(), 'ArrowUp')
    expect(focused()).toBe(search(root))

    const last = cards(root)[5]
    last.focus()
    expect(key(last, 'ArrowRight').defaultPrevented).toBe(false)
    expect(key(last, 'ArrowDown').defaultPrevented).toBe(false)
    expect(focused()).toBe(last)
    // A chord is somebody else's.
    expect(key(last, 'ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(focused()).toBe(last)
  })

  it('moves up and down by where the cards are laid out', () => {
    const rows: RecipeCatalogueRow[] = Array.from({ length: 5 }, (_, n) => ({ sig: String(n).repeat(64), name: `Dish ${n}`, nodes: [BAKERY], at: 10 - n }))
    const { root } = mount({ rows, onQuery: undefined })
    const all = cards(root)
    // Three to a row: 0 1 2 above 3 4.
    all.forEach((card, n) => {
      const left = (n % 3) * 200
      const top = Math.floor(n / 3) * 300
      card.getBoundingClientRect = () => ({ left, top, width: 180, height: 260, right: left + 180, bottom: top + 260, x: left, y: top, toJSON: () => ({}) })
    })
    all[1].focus()
    key(all[1], 'ArrowDown')
    expect(focused()).toBe(all[4])
    key(all[4], 'ArrowUp')
    expect(focused()).toBe(all[1])
    // Nothing below the last row, and with no search nothing above the first.
    expect(key(all[4], 'ArrowDown').defaultPrevented).toBe(false)
    all[2].focus()
    key(all[2], 'ArrowDown')
    expect(focused()).toBe(all[4])
    expect(key(all[0], 'ArrowUp').defaultPrevented).toBe(false)
  })

  it('Escape clears the search first, then closes, and stops there', () => {
    const { root, onQuery, onClose } = mount()
    const behind = vi.fn()
    document.body.addEventListener('keydown', behind)
    type(root, 'bread')
    search(root).focus()
    const first = key(search(root), 'Escape')
    expect(first.defaultPrevented).toBe(true)
    expect(search(root).value).toBe('')
    expect(onQuery).toHaveBeenLastCalledWith('')
    expect(names(root)).toHaveLength(6)
    expect(focused()).toBe(search(root))
    expect(onClose).not.toHaveBeenCalled()

    const second = key(cards(root)[0], 'Escape')
    document.body.removeEventListener('keydown', behind)
    expect(second.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(behind).not.toHaveBeenCalled()

    root.querySelector<HTMLButtonElement>('.hc-recipe-catalogue-bar button')?.click()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('has no search field without onQuery and no Close without onClose', () => {
    const door = mount({ onQuery: undefined, onClose: undefined, query: 'bread' })
    expect(door.root.querySelector('input')).toBeNull()
    expect(door.root.querySelector('.hc-recipe-catalogue-bar button')).toBeNull()
    // A query its caller gave still narrows, and Escape has nothing to do: it is left for whatever is behind.
    expect(names(door.root)).toEqual(['Sourdough bread'])
    expect(key(cards(door.root)[0], 'Escape').defaultPrevented).toBe(false)
    expect(names(door.root)).toEqual(['Sourdough bread'])
    // With no field, focus goes to the first card.
    door.catalogue.focus()
    expect(focused()).toBe(cards(door.root)[0])

    const closing = mount({ onQuery: undefined })
    const close = closing.root.querySelector<HTMLButtonElement>('.hc-recipe-catalogue-bar button')!
    expect(close.getAttribute('aria-label')).toBe('Close')
    expect(close.querySelector('svg')).not.toBeNull()
    expect(key(cards(closing.root)[0], 'Escape').defaultPrevented).toBe(true)
    expect(closing.onClose).toHaveBeenCalledTimes(1)

    // A page with no field and no card still takes focus, so the keys stay with it.
    const bare = mount({ rows: [], onQuery: undefined })
    bare.catalogue.focus()
    expect(focused()).toBe(bare.root)
  })

  it('keeps focus on the search field while typing, whatever is redrawn under it', () => {
    const { root, catalogue } = mount()
    const field = search(root)
    field.focus()
    type(root, 'le')
    expect(focused()).toBe(field)
    catalogue.update({ rows: [...ROWS], loading: true })
    catalogue.update({ query: 'le' })
    expect(focused()).toBe(field)
    expect(field.value).toBe('le')
    expect(root.querySelector('input[type="search"]')).toBe(field)
    catalogue.update({ title: 'Recipes at bakery.example', note: 'Published here' })
    expect(focused()).toBe(field)
    expect(root.querySelector('h1')?.textContent).toBe('Recipes at bakery.example')
    expect(root.querySelector<HTMLElement>('.hc-recipe-catalogue-note')?.hidden).toBe(false)
    catalogue.update({ note: undefined })
    expect(root.querySelector<HTMLElement>('.hc-recipe-catalogue-note')?.hidden).toBe(true)
  })

  it('keeps focus on a card through a redraw, and follows the row when its group goes', () => {
    const ready = new Set<string>()
    const { root, catalogue } = mount({ pictureUrl: sig => (ready.has(sig) ? `blob:${sig.slice(0, 4)}` : '') })
    cardOf(root, SIG_LASAGNE, ANA).focus()
    catalogue.update({ rows: [...ROWS] })
    expect(focused()).toBe(cardOf(root, SIG_LASAGNE, ANA))
    // The card is drawn again with its picture: the new one holds focus.
    ready.add(PIC_LASAGNE)
    catalogue.update({})
    expect(focused()).toBe(cardOf(root, SIG_LASAGNE, ANA))
    expect(focused().querySelector('img')).not.toBeNull()
    // Ana is switched off: the same row is still offered by the kitchen.
    catalogue.update({ nodes: [KITCHEN, BAKERY] })
    expect(focused()).toBe(cardOf(root, SIG_LASAGNE, KITCHEN))
    // The row is gone altogether: focus falls back to the field.
    catalogue.update({ nodes: [BAKERY] })
    expect(focused()).toBe(search(root))
  })

  it('returns focus to the card that was opened', () => {
    const { root, catalogue } = mount()
    cardOf(root, SIG_CAKE, BEN).click()
    ;(document.activeElement as HTMLElement | null)?.blur()
    catalogue.focus()
    expect(focused()).toBe(cardOf(root, SIG_CAKE, BEN))
    // Once: after that it is the search field again.
    catalogue.focus()
    expect(focused()).toBe(search(root))
  })

  it('loads nothing from anywhere and keeps its corners on the ladder', () => {
    mount()
    const sheet = document.getElementById(RECIPE_CATALOGUE_STYLE_ID)?.textContent ?? ''
    expect(sheet).not.toMatch(/url\(|@import|@font-face|https?:/)
    expect([...sheet.matchAll(/border-radius:([^;}]+)/g)].map(found => found[1])).toEqual(['var(--rp-control)', 'var(--rp-control)', '50%', 'var(--hc-radius-card,3px)'])
    expect(sheet).toContain('prefers-reduced-motion:reduce')
  })

  it('takes itself down', () => {
    const { root, catalogue, onClose } = mount()
    const card = cards(root)[0]
    catalogue.dispose()
    expect(root.isConnected).toBe(false)
    key(card, 'Escape')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a press beside a node, and the nodes held back (the leader\'s Hide)', () => {
  it('draws the caller\'s press beside the nodes it names, outside the heading, and runs it on a press', () => {
    const pressed: string[] = []
    const { root } = mount({
      nodeAction: node => node.kind === 'participant' ? { label: 'Hide', title: `Hide ${node.name}`, onPress: () => pressed.push(node.id) } : null,
    })
    const presses = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-catalogue-node-action')]
    expect(presses.map(press => press.dataset['node'])).toEqual([`participant:${ANA.id}`, `participant:${BEN.id}`])
    expect(presses[0].closest('h2')).toBeNull()
    // Named by the words it shows; what it does, to whom, is said beside them.
    expect(presses[0].hasAttribute('aria-label')).toBe(false)
    expect(presses[0].textContent).toBe('Hide')
    expect(presses[0].getAttribute('aria-description')).toBe('Hide Ana Maria Lopez')
    presses[1].click()
    expect(pressed).toEqual([BEN.id])
  })

  it('draws a busy press as one that cannot be pressed', () => {
    const onPress = vi.fn()
    const { root } = mount({ nodeAction: node => node.id === ANA.id ? { label: 'Hide', busy: true, onPress } : null })
    const press = root.querySelector<HTMLButtonElement>('.hc-recipe-catalogue-node-action')!
    expect(press.disabled).toBe(true)
    press.click()
    expect(onPress).not.toHaveBeenCalled()
  })

  it('heads a held-back node\'s own group with no rows, under the others, with its note and press', () => {
    const HIDDEN: PoolNode = { kind: 'participant', id: '9'.repeat(64), name: 'Rude Poster' }
    const { root, catalogue } = mount({
      heldBack: [{ node: HIDDEN, note: 'Hidden from readers.' }],
      nodeAction: node => node.id === HIDDEN.id ? { label: 'Show again', onPress: () => undefined } : null,
    })
    const held = root.querySelector<HTMLElement>('section[data-held]')!
    expect(heads(root).at(-1)).toBe('Rude Poster')
    expect(held.querySelector('.hc-recipe-catalogue-grid')).toBeNull()
    expect(held.textContent).toContain('Hidden from readers.')
    expect(held.querySelector('.hc-recipe-catalogue-node-action')?.textContent).toBe('Show again')
    // A node shown with rows is not drawn twice; an update can take the held-back away.
    catalogue.update({ heldBack: [{ node: ANA, note: 'x' }] })
    expect(root.querySelector('section[data-held]')).toBeNull()
    catalogue.update({ heldBack: [] })
    expect(heads(root)).not.toContain('Rude Poster')
  })
})

describe('a press under a row, and one held-back entry (the leader\'s Hide on one entry)', () => {
  it('draws the caller\'s press under a card in the group of the node it is for, outside the card, and runs it', () => {
    const pressed: string[] = []
    const { root, onOpen } = mount({
      rowAction: (row, node) => node.id === ANA.id ? { label: 'Hide this entry', title: `Hide ${row.name}`, onPress: () => pressed.push(row.sig) } : null,
    })
    const presses = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-catalogue-row-action')]
    expect(presses.map(press => [press.dataset['node'], press.dataset['sig']])).toEqual([[`participant:${ANA.id}`, SIG_LASAGNE]])
    expect(presses[0]!.closest('.hc-recipe-catalogue-card')).toBeNull()
    expect(presses[0]!.closest('li')?.querySelector<HTMLElement>('.hc-recipe-catalogue-card')?.dataset['sig']).toBe(SIG_LASAGNE)
    expect(presses[0]!.hasAttribute('aria-label')).toBe(false)
    expect(presses[0]!.getAttribute('aria-description')).toBe('Hide Sunday lasagne')
    presses[0]!.click()
    expect(pressed).toEqual([SIG_LASAGNE])
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('draws a held-back line with its own press even under a node shown with rows', () => {
    const onPress = vi.fn()
    const { root } = mount({
      heldBack: [{ node: ANA, id: `${ANA.id}:${'1'.repeat(64)}`, note: 'One entry is hidden.', action: { label: 'Show again', onPress } }],
    })
    const held = root.querySelector<HTMLElement>(`section[data-held="${ANA.id}:${'1'.repeat(64)}"]`)!
    expect(held.textContent).toContain('One entry is hidden.')
    expect(names(root)).toContain('Sunday lasagne')
    held.querySelector<HTMLButtonElement>('.hc-recipe-catalogue-node-action')!.click()
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

describe('a node that did not answer', () => {
  it('is said by name, and the page is never called empty while one is', () => {
    const { root, catalogue } = mount({ rows: [], unanswered: ['down.example'] })
    expect([...root.querySelectorAll('[data-unanswered]')].map(line => line.textContent)).toEqual(['down.example did not answer.'])
    expect(none(root).hidden).toBe(true)

    // Beside rows the others offer, it is still said.
    catalogue.update({ rows: ROWS })
    expect(names(root).length).toBeGreaterThan(0)
    expect(root.querySelector('[data-unanswered]')?.textContent).toBe('down.example did not answer.')

    // Once it answers, empty is empty again.
    catalogue.update({ rows: [], unanswered: [] })
    expect(root.querySelector('[data-unanswered]')).toBeNull()
    expect(none(root).hidden).toBe(false)
    expect(none(root).textContent).toBe('Nothing is published here yet.')
  })
})
