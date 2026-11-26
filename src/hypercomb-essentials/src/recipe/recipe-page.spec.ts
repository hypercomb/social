// recipe/recipe-page.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recipePage, recipeSectionKey, splitIngredientLine, splitStepLines, type RecipePageHandle, type RecipePageOptions, type RecipeSettingMenu, type RecipeTileRow } from './recipe-page.js'
import { recipeFloorHolds, recipeReadingFloor, type RecipeSettingDocument, type RecipeSettingPoint } from './recipe-setting.js'
import { RECIPE_STYLE_ID } from './recipe-style.js'
import { RECIPE_DESK } from './recipe-desk.js'
import {
  RECIPE_LIMITS,
  parseRecipe,
  parseRecipeTemplate,
  recipeBytes,
  recipeTemplateBytes,
  type RecipeDocument,
  type RecipeIngredient,
  type RecipeStep,
  type RecipeTemplateDocument,
} from './recipe-template.js'
import { RECIPE_TEMPLATE_FAMILY, RECIPE_TEMPLATE_WEEKNIGHT } from './recipe-defaults.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)
const EN_DASH = String.fromCharCode(0x2013)

const say = (_key: string, fallback: string, params?: Record<string, string | number>): string =>
  fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

const SOUP: RecipeDocument = Object.freeze({
  values: Object.freeze({
    story: { kind: 'text', text: 'My grandmother made this on Sundays.\nAlways too much.' },
    facts: { kind: 'facts', facts: [{ label: 'Serves', value: '6' }] },
    ingredients: { kind: 'ingredients', items: [{ amount: '2', item: 'onions', note: 'sliced thin' }, { item: 'salt' }] },
    steps: { kind: 'steps', steps: [{ text: 'Sweat the onions.', minutes: 10 }, { text: 'Add water and wait.', picture: SIG_B }] },
    pictures: { kind: 'pictures', pictures: [SIG_A] },
    links: { kind: 'links', links: [{ url: 'https://example.org/watch?v=1', label: 'The technique' }] },
  }),
}) as RecipeDocument

const open: RecipePageHandle[] = []

function mount(over: Partial<RecipePageOptions> = {}) {
  const spies = {
    onChange: vi.fn<(recipe: RecipeDocument) => void>(),
    onLayout: vi.fn<(template: RecipeTemplateDocument) => void>(),
    takePictures: vi.fn(async (files: readonly Blob[]): Promise<readonly string[]> => files.map((_, at) => [SIG_C, SIG_B, SIG_A][at] ?? SIG_C)),
    onPickTemplate: vi.fn(),
    onClose: vi.fn(),
    onMode: vi.fn(),
  }
  const page = recipePage({
    title: 'Onion soup',
    recipe: { values: {} },
    template: RECIPE_TEMPLATE_FAMILY,
    say,
    pictureUrl: sig => `blob:local/${sig.slice(0, 4)}`,
    ...spies,
    ...over,
  })
  document.body.append(page.element)
  open.push(page)
  return { page, root: page.element, ...spies }
}

const must = <T extends Element>(found: T | null, what: string): T => {
  if (!found) throw new Error(`no ${what}`)
  return found
}
const part = (root: HTMLElement, key: string): HTMLElement => must(root.querySelector<HTMLElement>(`.hc-recipe-part[data-key="${key}"]`), `part ${key}`)
const tab = (root: HTMLElement, key: string): HTMLButtonElement => must(part(root, key).querySelector<HTMLButtonElement>('.hc-recipe-tab'), `tab ${key}`)
/** The card of a part. It is there whether or not it is open: only one is ever shown. */
const card = (root: HTMLElement, key: string): HTMLElement => must(root.querySelector<HTMLElement>(`.hc-recipe-card[data-key="${key}"]`), `card ${key}`)
/** Press a part's tab, as a cook does, and answer the card it opens. */
const openCard = (root: HTMLElement, key: string): HTMLElement => {
  if (card(root, key).hidden) tab(root, key).click()
  return card(root, key)
}
const shownCards = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('.hc-recipe-card')].filter(node => !node.hidden).map(node => node.dataset['key'] ?? '')
const partKeys = (root: HTMLElement): (string | undefined)[] => [...root.querySelectorAll<HTMLElement>('.hc-recipe-part')].map(node => node.dataset['key'])
const summary = (root: HTMLElement, key: string): string => tab(root, key).querySelector('.hc-recipe-tab-value')?.textContent ?? ''
const callouts = (root: HTMLElement, key = 'ingredients'): HTMLButtonElement[] => [...part(root, key).querySelectorAll<HTMLButtonElement>('.hc-recipe-callout')]
const leads = (root: HTMLElement): string[] => [...root.querySelectorAll('.hc-recipe-leaders .hc-recipe-lead')].map(node => node.getAttribute('data-id') ?? '')
const at = <T extends HTMLElement = HTMLInputElement>(scope: HTMLElement, where: string): T => must(scope.querySelector<T>(`[data-at="${where}"]`), `field ${where}`)
const type = (field: HTMLInputElement | HTMLTextAreaElement, words: string): void => {
  field.focus()
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const key = (target: EventTarget, name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
const paste = (target: EventTarget, data: { text?: string; files?: File[] }) => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: data.files ?? [], items: [], getData: (kind: string) => (kind === 'text/plain' ? data.text ?? '' : '') },
  })
  const stopped = vi.spyOn(event, 'stopPropagation')
  target.dispatchEvent(event)
  return { event, stopped }
}
const drop = (target: EventTarget, files: File[]) => {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, items: [] } })
  const stopped = vi.spyOn(event, 'stopPropagation')
  target.dispatchEvent(event)
  return { event, stopped }
}
const png = (name = 'a.png'): File => new File(['x'], name, { type: 'image/png' })
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const last = <T>(spy: { mock: { calls: T[][] } }): T => spy.mock.calls[spy.mock.calls.length - 1][0]
const accepted = async (page: RecipePageHandle): Promise<boolean> => (await parseRecipe(recipeBytes(page.recipe()))).ok
const stepsOf = (recipe: RecipeDocument): readonly RecipeStep[] => {
  const value = recipe.values['steps']
  return value?.kind === 'steps' ? value.steps : []
}
const itemsOf = (recipe: RecipeDocument): readonly RecipeIngredient[] => {
  const value = recipe.values['ingredients']
  return value?.kind === 'ingredients' ? value.items : []
}
const button = (scope: ParentNode, words: string): HTMLButtonElement | undefined =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find(each => each.textContent === words)
const withIngredients = (n: number): RecipeDocument => ({ values: { ingredients: { kind: 'ingredients', items: Array.from({ length: n }, (_, i) => ({ amount: `${i + 1} g`, item: `thing ${i}` })) } } })

afterEach(() => {
  for (const page of open.splice(0)) page.dispose()
  document.body.replaceChildren()
})

describe('splitIngredientLine', () => {
  it.each([
    ['2 cups flour', '2 cups', 'flour'],
    ['1/2 tsp salt', '1/2 tsp', 'salt'],
    ['200 g butter', '200 g', 'butter'],
    ['200g butter', '200g', 'butter'],
    ['3 eggs', '3', 'eggs'],
    ['1 1/2 cups milk', '1 1/2 cups', 'milk'],
    ['½ cup sugar', '½ cup', 'sugar'],
    ['1½ cups sugar', '1½ cups', 'sugar'],
    ['1 ¾ tsp cumin', '1 ¾ tsp', 'cumin'],
    ['2-3 carrots', '2-3', 'carrots'],
    [`2 ${EN_DASH} 3 tbsp olive oil`, `2 ${EN_DASH} 3 tbsp`, 'olive oil'],
    ['2 to 3 cloves garlic', '2 to 3 cloves', 'garlic'],
    ['1.5 l water', '1.5 l', 'water'],
    ['1,5 dl cream', '1,5 dl', 'cream'],
    ['2 tbsp. sugar', '2 tbsp', 'sugar'],
    ['2 cups of flour', '2 cups', 'flour'],
    ['1 can chickpeas', '1 can', 'chickpeas'],
    ['3 large eggs', '3', 'large eggs'],
    ['2 garlic cloves', '2', 'garlic cloves'],
    ['- 2 cups flour', '2 cups', 'flour'],
    ['• 1 egg', '1', 'egg'],
    ['  4   oz   dark chocolate ', '4 oz', 'dark chocolate'],
    ['8 fl oz stock', '8 fl oz', 'stock'],
  ])('%s', (line, amount, item) => {
    expect(splitIngredientLine(line)).toEqual({ amount, item })
  })

  it.each([
    ['salt', 'salt'],
    ['a pinch of salt', 'a pinch of salt'],
    ['Salt and pepper, to taste', 'Salt and pepper, to taste'],
    ['7up', '7up'],
    ['3eggs', '3eggs'],
    ['2', '2'],
    ['1/2', '1/2'],
    ['2 cups', '2 cups'],
    ['* fresh basil', 'fresh basil'],
    ['', ''],
  ])('leaves a line with no quantity whole: %s', (line, item) => {
    expect(splitIngredientLine(line)).toEqual({ item })
  })
})

describe('splitStepLines', () => {
  it('makes one step a line and takes the numbering off', () => {
    expect(splitStepLines('1. Chop the onions.\n2) Sweat them.\r\n\r\n- Add water\n• Wait\nStep 5: Serve\n(6) Eat')).toEqual([
      'Chop the onions.', 'Sweat them.', 'Add water', 'Wait', 'Serve', 'Eat',
    ])
  })

  it('leaves a line that only starts with a number alone', () => {
    expect(splitStepLines('2 cups of water go in\n1.5 litres of stock follow\nAt 10:30 take it off')).toEqual([
      '2 cups of water go in', '1.5 litres of stock follow', 'At 10:30 take it off',
    ])
  })

  it('answers nothing for nothing, and one for one', () => {
    expect(splitStepLines('  \n \n')).toEqual([])
    expect(splitStepLines('Stir.')).toEqual(['Stir.'])
  })
})

describe('recipeSectionKey', () => {
  it('slugs a label into a key the format accepts, unlike the ones taken', () => {
    expect(recipeSectionKey('At the table', [])).toBe('at-the-table')
    expect(recipeSectionKey('Crème brûlée!', [])).toBe('creme-brulee')
    expect(recipeSectionKey('Notes', ['notes', 'notes-2'])).toBe('notes-3')
    expect(recipeSectionKey('3 ways', [])).toBe('s-3-ways')
    expect(recipeSectionKey('料理', [])).toBe('section')
    expect(recipeSectionKey('constructor', [])).toBe('constructor-2')
    const long = recipeSectionKey('x'.repeat(80), ['x'.repeat(40)])
    expect(long).toMatch(/^[a-z][a-z0-9_-]{0,39}$/)
    expect(long).not.toBe('x'.repeat(40))
  })
})

describe('the recipe desk, the drawing', () => {
  it('injects its stylesheet once and draws each section as a tab that says what it holds', () => {
    const { root } = mount({ recipe: SOUP })
    mount()
    expect(document.querySelectorAll(`#${RECIPE_STYLE_ID}`)).toHaveLength(1)
    expect(partKeys(root)).toEqual(['story', 'pictures', 'facts', 'ingredients', 'steps', 'experience', 'links'])
    expect(root.querySelector('.hc-recipe-title')?.textContent).toBe('Onion soup')
    expect([...root.querySelectorAll('.hc-recipe-tab-label')].map(node => node.textContent)).toEqual(
      ['The story', 'Pictures', 'At a glance', 'What you need', 'How it is made', 'At the table', 'Watch and read'],
    )
    expect(summary(root, 'story')).toBe('My grandmother made this on Sundays. Always too…')
    expect(summary(root, 'pictures')).toBe('1 picture')
    expect(summary(root, 'facts')).toBe('Serves 6')
    expect(summary(root, 'ingredients')).toBe('2 ingredients')
    expect(summary(root, 'steps')).toBe('2 steps · 10 min')
    expect(summary(root, 'experience')).toBe('none')
    expect(summary(root, 'links')).toBe('1 link')
    // It is a drawing, not a form: nothing is open until a tab is pressed, and the tabs are the only things beside the plate.
    expect(shownCards(root)).toEqual([])
    expect(root.querySelector('.hc-recipe-stage .hc-recipe-figure')).not.toBeNull()
    expect(root.dataset['mode']).toBe('write')
    for (const each of root.querySelectorAll('.hc-recipe-tab')) expect(each.getAttribute('aria-expanded')).toBe('false')
  })

  it('draws an ingredients section as its ingredients, one label each, amount then item', () => {
    const { root } = mount({ recipe: SOUP })
    const labels = callouts(root)
    expect(labels).toHaveLength(2)
    expect(labels[0].querySelector('.hc-recipe-callout-amount')?.textContent).toBe('2')
    expect(labels[0].querySelector('.hc-recipe-callout-item')?.textContent).toBe('onions')
    // No amount, no empty slot for one.
    expect(labels[1].querySelector('.hc-recipe-callout-amount')).toBeNull()
    expect(labels[1].textContent).toBe('salt')
    // The labels stand under the heading, on its side of the plate, a row each.
    expect(part(root, 'ingredients').dataset['side']).toBe('right')
    expect(part(root, 'story').dataset['side']).toBe('left')
    const rows = [tab(root, 'ingredients'), ...labels].map(node => Number.parseInt(node.style.gridRow, 10))
    expect(rows[1] - rows[0]).toBe(2)
    expect(rows[2] - rows[1]).toBe(2)
  })

  it('counts the ingredients past the cap in a last label', () => {
    const nine = mount({ recipe: withIngredients(9) })
    expect(callouts(nine.root)).toHaveLength(9)
    expect(nine.root.querySelector('.hc-recipe-callout.is-more')).toBeNull()
    // One more than the cap is still drawn whole.
    expect(callouts(mount({ recipe: withIngredients(10) }).root)).toHaveLength(10)
    const { root } = mount({ recipe: withIngredients(13) })
    const labels = callouts(root)
    expect(labels).toHaveLength(10)
    expect(labels[8].textContent).toBe('9 gthing 8')
    expect(labels[9].textContent).toBe('+ 4 more')
    expect(labels[9].classList.contains('is-more')).toBe(true)
    expect(summary(root, 'ingredients')).toBe('13 ingredients')
  })

  it('with no ingredients the heading alone asks for them', () => {
    const { root } = mount()
    expect(callouts(root)).toEqual([])
    expect(summary(root, 'ingredients')).toBe('add ingredients')
    expect(summary(root, 'story')).toBe('none')
    // Empty or not, the section keeps its own side: nothing jumps across when the first ingredient is typed.
    expect(part(root, 'ingredients').dataset['side']).toBe('right')
  })

  it('joins every tab and every ingredient to the plate with one leader, in one overlay', () => {
    const { root } = mount({ recipe: withIngredients(13) })
    expect(root.querySelectorAll('.hc-recipe-leaders')).toHaveLength(1)
    const ids = leads(root)
    const plain = ['story', 'pictures', 'facts', 'steps', 'experience', 'links'].map(each => tab(root, each).dataset['id'])
    const heading = tab(root, 'ingredients').dataset['id']
    // Six section tabs, nine ingredients. The heading of drawn ingredients has none, and neither has the label that counts the rest.
    expect(ids).toHaveLength(15)
    for (const id of plain) expect(ids).toContain(id)
    expect(ids).not.toContain(heading)
    expect(ids).not.toContain(`${heading}#more`)
    expect(ids.filter(id => id.startsWith(`${heading}#`))).toHaveLength(9)
    expect(new Set(ids).size).toBe(15)
    for (const lead of root.querySelectorAll('.hc-recipe-lead')) {
      expect(lead.querySelectorAll('circle')).toHaveLength(1)
      expect(lead.querySelector('path.is-line')?.getAttribute('d')).toMatch(/^M[-\d.]+ [-\d.]+ L/)
    }
    // With nothing in it, the heading is a tab like the others and has a leader of its own.
    const empty = mount()
    expect(leads(empty.root)).toContain(tab(empty.root, 'ingredients').dataset['id'])
    expect(leads(empty.root)).toHaveLength(7)
  })

  it('shows what the template has no section for as tabs too, after a divider', () => {
    const { root } = mount({ recipe: { values: { ...SOUP.values, pairing: { kind: 'text', text: 'A dry cider.' } } } })
    expect(partKeys(root)).toEqual(['story', 'pictures', 'facts', 'ingredients', 'steps', 'experience', 'links', 'pairing'])
    const divider = must(root.querySelector<HTMLElement>('.hc-recipe-also'), 'divider')
    expect(divider.textContent).toBe('Also in this recipe')
    expect(divider.nextElementSibling).toBe(part(root, 'pairing'))
    expect(summary(root, 'pairing')).toBe('A dry cider.')
    expect(tab(root, 'pairing').querySelector('.hc-recipe-tab-label')?.textContent).toBe('pairing')
    expect(mount({ recipe: SOUP }).root.querySelector('.hc-recipe-also')).toBeNull()
  })

  it('pressing a tab opens exactly that part as the one card, and pressing it again closes it', () => {
    const { root } = mount({ recipe: SOUP })
    tab(root, 'steps').click()
    expect(shownCards(root)).toEqual(['steps'])
    expect(tab(root, 'steps').getAttribute('aria-expanded')).toBe('true')
    expect(tab(root, 'steps').getAttribute('aria-controls')).toBe(card(root, 'steps').id)
    expect(tab(root, 'steps').getAttribute('data-lit')).toBe('strong')
    expect(root.dataset['open']).toBe('steps')
    expect(part(root, 'steps').hasAttribute('data-open')).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-veil')?.hidden).toBe(false)
    // The card holds that section and nothing else: its heading, its prompt, its editor, and Done.
    const steps = card(root, 'steps')
    expect(steps.querySelector('.hc-recipe-label')?.textContent).toBe('How it is made')
    expect(steps.querySelector('.hc-recipe-hint')?.textContent).toBe('One thing at a time, the way you would say it standing at the stove.')
    expect(steps.querySelectorAll('.hc-recipe-step')).toHaveLength(2)
    expect(steps.querySelector('.hc-recipe-ingredient, .hc-recipe-fact')).toBeNull()
    expect(document.activeElement).toBe(at(steps, '0:text'))
    // One card at a time: another tab takes its place.
    tab(root, 'story').click()
    expect(shownCards(root)).toEqual(['story'])
    expect(tab(root, 'steps').getAttribute('aria-expanded')).toBe('false')
    expect(tab(root, 'steps').hasAttribute('data-lit')).toBe(false)
    expect(root.dataset['open']).toBe('story')
    expect(document.activeElement).toBe(at(card(root, 'story'), '0:text'))
    tab(root, 'story').click()
    expect(shownCards(root)).toEqual([])
    expect(root.dataset['open']).toBeUndefined()
    expect(root.querySelector<HTMLElement>('.hc-recipe-veil')?.hidden).toBe(true)
  })

  it('Done, Escape and a press on the dimmed stage close the card back to its tab', () => {
    const { root, onClose } = mount({ recipe: SOUP })
    const facts = openCard(root, 'facts')
    button(facts, 'Done')?.click()
    expect(shownCards(root)).toEqual([])
    expect(document.activeElement).toBe(tab(root, 'facts'))

    const story = openCard(root, 'story')
    const escape = key(at(story, '0:text'), 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(shownCards(root)).toEqual([])
    expect(document.activeElement).toBe(tab(root, 'story'))
    expect(onClose).not.toHaveBeenCalled()

    openCard(root, 'links')
    must(root.querySelector<HTMLElement>('.hc-recipe-veil'), 'veil').click()
    expect(shownCards(root)).toEqual([])
    expect(document.activeElement).toBe(tab(root, 'links'))
  })

  it('pressing an ingredient opens the ingredients card on that ingredient', () => {
    const { root } = mount({ recipe: withIngredients(13) })
    const labels = callouts(root)
    labels[3].click()
    expect(shownCards(root)).toEqual(['ingredients'])
    const section = card(root, 'ingredients')
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(13)
    expect(document.activeElement).toBe(at(section, '3:item'))
    // Another label of the open card moves to its row. The card stays open.
    callouts(root)[6].click()
    expect(shownCards(root)).toEqual(['ingredients'])
    expect(document.activeElement).toBe(at(section, '6:item'))
    // The label that counts the rest opens on the first ingredient it hides.
    must(root.querySelector<HTMLButtonElement>('.hc-recipe-callout.is-more'), 'more').click()
    expect(document.activeElement).toBe(at(section, '9:item'))
    // The heading opens the same card, from the top.
    tab(root, 'ingredients').click()
    tab(root, 'ingredients').click()
    expect(document.activeElement).toBe(at(section, '0:amount'))
  })

  it('finds the row of an ingredient past rows a cook has not finished', () => {
    const { root } = mount({ recipe: SOUP })
    const section = openCard(root, 'ingredients')
    // An unfinished row between the two: it is no ingredient yet, so it has no label.
    type(at(section, '1:amount'), 'a pinch')
    type(at(section, '1:item'), '')
    key(at(section, '1:amount'), 'Enter')
    type(at(section, '2:item'), 'salt')
    expect(callouts(root).map(label => label.textContent)).toEqual(['2onions', 'salt'])
    button(section, 'Done')?.click()
    callouts(root)[1].click()
    expect(document.activeElement).toBe(at(section, '2:item'))
  })

  it('keeps the drawing up with what is typed in the card', () => {
    const { root, onChange } = mount()
    const section = openCard(root, 'ingredients')
    expect(document.activeElement).toBe(at(section, '0:amount'))
    type(at(section, '0:amount'), '2 cups')
    // An amount alone is no ingredient yet.
    expect(callouts(root)).toEqual([])
    const item = at(section, '0:item')
    type(item, 'flour')
    expect(callouts(root).map(label => label.textContent)).toEqual(['2 cupsflour'])
    expect(summary(root, 'ingredients')).toBe('1 ingredient')
    expect(leads(root)).toContain(callouts(root)[0].dataset['id'])
    expect(leads(root)).not.toContain(tab(root, 'ingredients').dataset['id'])
    type(item, 'flour, sifted')
    expect(callouts(root)[0].querySelector('.hc-recipe-callout-item')?.textContent).toBe('flour, sifted')
    // The card stays open and the cook stays in the field.
    expect(shownCards(root)).toEqual(['ingredients'])
    expect(at(section, '0:item')).toBe(item)
    expect(document.activeElement).toBe(item)
    expect(onChange).toHaveBeenCalledTimes(2)

    const steps = openCard(root, 'steps')
    type(at<HTMLTextAreaElement>(steps, '0:text'), 'Whisk.')
    expect(summary(root, 'steps')).toBe('1 step')
    type(at(steps, '0:minutes'), '5')
    expect(summary(root, 'steps')).toBe('1 step · 5 min')
    type(at<HTMLTextAreaElement>(openCard(root, 'story'), '0:text'), 'It began with a lemon tree.')
    expect(summary(root, 'story')).toBe('It began with a lemon tree.')
    expect(tab(root, 'story').title).toBe('The story: It began with a lemon tree.')
  })

  it('lights a tab, its ingredients and their leaders together', () => {
    const { root } = mount({ recipe: SOUP })
    const heading = tab(root, 'ingredients')
    const [onions, salt] = callouts(root)
    const leadOf = (node: HTMLElement): Element => must(root.querySelector(`.hc-recipe-lead[data-id="${node.dataset['id']}"]`), 'lead')
    onions.dispatchEvent(new Event('pointerover', { bubbles: true }))
    expect(onions.getAttribute('data-lit')).toBe('soft')
    expect(leadOf(onions).getAttribute('data-lit')).toBe('soft')
    expect(heading.getAttribute('data-lit')).toBe('soft')
    expect(salt.hasAttribute('data-lit')).toBe(false)
    expect(leadOf(salt).hasAttribute('data-lit')).toBe(false)
    // The heading lights every ingredient under it.
    heading.dispatchEvent(new Event('pointerover', { bubbles: true }))
    expect(salt.getAttribute('data-lit')).toBe('soft')
    expect(leadOf(salt).getAttribute('data-lit')).toBe('soft')
    root.querySelector('.hc-recipe-stage')?.dispatchEvent(new Event('pointerleave'))
    expect(root.querySelector('[data-lit]')).toBeNull()
    // Focus lights the same way: nothing is reachable by hovering only.
    tab(root, 'facts').focus()
    expect(tab(root, 'facts').getAttribute('data-lit')).toBe('soft')
    expect(leadOf(tab(root, 'facts')).getAttribute('data-lit')).toBe('soft')
    tab(root, 'facts').blur()
    expect(root.querySelector('[data-lit]')).toBeNull()
    // An open card holds its tab and leader lit, and what belongs to it is never dimmed.
    tab(root, 'facts').click()
    expect(tab(root, 'facts').getAttribute('data-lit')).toBe('strong')
    expect(leadOf(tab(root, 'facts')).getAttribute('data-lit')).toBe('strong')
    expect(leadOf(tab(root, 'facts')).hasAttribute('data-own')).toBe(true)
    expect(leadOf(onions).hasAttribute('data-own')).toBe(false)
  })

  it('a facts card opens on the first label still waiting for its value', () => {
    const { root } = mount({ recipe: { values: { facts: { kind: 'facts', facts: [{ label: 'Serves', value: '6' }] } } } })
    // Every label answered: it opens at the top.
    const facts = openCard(root, 'facts')
    expect(document.activeElement).toBe(at(facts, '0:label'))
    const empty = mount()
    openCard(empty.root, 'facts')
    expect(document.activeElement).toBe(at(card(empty.root, 'facts'), '0:value'))
  })

  it('keys reach the tabs in reading order, and an ingredient label is the pointer\'s shortcut', () => {
    const { root } = mount({ recipe: SOUP })
    const stops = [...root.querySelectorAll<HTMLElement>('.hc-recipe-parts button')].filter(node => node.tabIndex >= 0 && !node.closest('.hc-recipe-card'))
    expect(stops.map(node => node.closest<HTMLElement>('.hc-recipe-part')?.dataset['key'])).toEqual(['story', 'pictures', 'facts', 'ingredients', 'steps', 'experience', 'links'])
    for (const label of callouts(root)) expect(label.tabIndex).toBe(-1)
    // The plate and its tools come before the tabs.
    const figure = must(root.querySelector('.hc-recipe-figure'), 'figure')
    expect(figure.compareDocumentPosition(tab(root, 'story')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the recipe desk, the plate', () => {
  it('draws a plate with an invitation while there is no picture', () => {
    const { root } = mount()
    const figure = must(root.querySelector<HTMLElement>('.hc-recipe-figure'), 'figure')
    expect(figure.dataset['state']).toBe('empty')
    expect(figure.querySelector('svg.hc-recipe-plate')?.hasAttribute('hidden')).toBe(false)
    expect(figure.querySelector<HTMLElement>('.hc-recipe-dish')?.hidden).toBe(true)
    const invite = must(figure.querySelector<HTMLElement>('.hc-recipe-invite'), 'invitation')
    expect(invite.hidden).toBe(false)
    expect(invite.querySelector('p')?.textContent).toBe('drop a picture of the dish, or choose one')
    expect(invite.querySelector('button')?.textContent).toBe('upload')
    expect(root.querySelector<HTMLElement>('.hc-recipe-strip')?.hidden).toBe(true)
  })

  it('shows the first picture as the dish, with a strip to choose the cover and remove one', () => {
    const { root, onChange } = mount({ recipe: { values: { pictures: { kind: 'pictures', pictures: [SIG_A, SIG_B, SIG_C] } } } })
    const figure = must(root.querySelector<HTMLElement>('.hc-recipe-figure'), 'figure')
    expect(figure.dataset['state']).toBe('picture')
    expect(figure.querySelector('svg.hc-recipe-plate')?.hasAttribute('hidden')).toBe(true)
    expect(figure.querySelector<HTMLElement>('.hc-recipe-invite')?.hidden).toBe(true)
    const dish = must(figure.querySelector<HTMLImageElement>('.hc-recipe-dish img'), 'dish')
    expect(dish.getAttribute('src')).toBe('blob:local/aaaa')
    expect(dish.alt).toBe('Cover picture of Onion soup')
    const thumbs = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-strip-thumb')]
    expect(thumbs().map(each => each.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(thumbs().map(each => each.getAttribute('aria-label'))).toEqual(['Picture 1: the cover', 'Make picture 2 the cover', 'Make picture 3 the cover'])

    thumbs()[2].click()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A, SIG_B] })
    expect(dish.getAttribute('src')).toBe('blob:local/cccc')
    expect(thumbs()[0].querySelector('img')?.getAttribute('src')).toBe('blob:local/cccc')
    expect(document.activeElement).toBe(thumbs()[0])
    // Pressing the cover changes nothing.
    thumbs()[0].click()
    expect(onChange).toHaveBeenCalledTimes(1)

    at<HTMLButtonElement>(root, 'strip:0:remove').click()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_A, SIG_B] })
    expect(dish.getAttribute('src')).toBe('blob:local/aaaa')
    expect(summary(root, 'pictures')).toBe('2 pictures')
    at<HTMLButtonElement>(root, 'strip:0:remove').click()
    at<HTMLButtonElement>(root, 'strip:0:remove').click()
    expect(last(onChange).values['pictures']).toBeUndefined()
    expect(figure.dataset['state']).toBe('empty')
    expect(root.querySelector<HTMLElement>('.hc-recipe-strip')?.hidden).toBe(true)
  })

  it('a press on the dish opens the pictures card', () => {
    const { root } = mount({ recipe: SOUP })
    must(root.querySelector<HTMLElement>('.hc-recipe-dish'), 'dish').click()
    expect(shownCards(root)).toEqual(['pictures'])
    expect(tab(root, 'pictures').getAttribute('data-lit')).toBe('strong')
  })

  it('a picture pasted on the stage becomes the cover', async () => {
    const { root, onChange, takePictures } = mount({ recipe: SOUP })
    const file = png()
    const { event, stopped } = paste(document.body, { files: [file] })
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).toHaveBeenCalled()
    expect(takePictures).toHaveBeenCalledWith([file])
    // While it is stored the plate says so.
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure-note')?.hidden).toBe(false)
    await settle()
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure-note')?.hidden).toBe(true)
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A] })
    expect(root.querySelector('.hc-recipe-dish img')?.getAttribute('src')).toBe('blob:local/cccc')
    expect(summary(root, 'pictures')).toBe('2 pictures')
    // A tab holding focus is still the stage: only a card's own fields keep a picture off the plate.
    tab(root, 'story').focus()
    paste(tab(root, 'story'), { files: [png('b.png')] })
    await settle()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A] })
  })

  it('a picture dropped on the plate becomes the cover, and the first of several leads', async () => {
    const { root, onChange } = mount({ recipe: SOUP })
    const figure = must(root.querySelector('.hc-recipe-figure'), 'figure')
    const over = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'] } })
    figure.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(root.classList.contains('is-dropping')).toBe(true)
    const { event, stopped } = drop(figure, [png('one.png'), png('two.png')])
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).toHaveBeenCalled()
    expect(root.classList.contains('is-dropping')).toBe(false)
    await settle()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_B, SIG_A] })
    expect(root.querySelector('.hc-recipe-dish img')?.getAttribute('src')).toBe('blob:local/cccc')
  })

  it('"Paste picture" is there only when the caller can read the clipboard, and "Choose files" is a file input', async () => {
    const without = mount()
    expect(button(without.root, 'Paste picture')).toBeUndefined()
    const chooser = without.root.querySelector<HTMLInputElement>('input[type="file"]')
    expect(chooser?.accept).toBe('image/*')
    expect(chooser?.multiple).toBe(true)
    expect(chooser?.hidden).toBe(true)
    const pressed = vi.spyOn(must(chooser, 'chooser'), 'click').mockImplementation(() => {})
    button(must(without.root.querySelector('.hc-recipe-tools'), 'tools'), 'Choose files')?.click()
    button(must(without.root.querySelector('.hc-recipe-invite'), 'invitation'), 'upload')?.click()
    expect(pressed).toHaveBeenCalledTimes(2)

    const clipboardPictures = vi.fn(async () => [png()])
    const withIt = mount({ clipboardPictures, recipe: SOUP })
    button(must(withIt.root.querySelector('.hc-recipe-tools'), 'tools'), 'Paste picture')?.click()
    await settle()
    await settle()
    expect(clipboardPictures).toHaveBeenCalledTimes(1)
    // Under the plate it is the dish: the pasted picture leads.
    expect(last(withIt.onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A] })
    // In the pictures card it joins the others.
    button(openCard(withIt.root, 'pictures'), 'Paste picture')?.click()
    await settle()
    await settle()
    expect(clipboardPictures).toHaveBeenCalledTimes(2)
    expect(last(withIt.onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A] })
  })

  it('says so when the clipboard holds no picture, or cannot be read', async () => {
    const none = mount({ clipboardPictures: vi.fn(async () => []) })
    button(none.root, 'Paste picture')?.click()
    await settle()
    expect(none.root.querySelector('.hc-recipe-status')?.textContent).toBe('There is no picture on the clipboard.')
    const refused = mount({ clipboardPictures: vi.fn(async () => { throw new Error('denied') }) })
    button(refused.root, 'Paste picture')?.click()
    await settle()
    expect(refused.root.querySelector('.hc-recipe-status')?.textContent).toBe('The clipboard could not be read.')
    expect(refused.onChange).not.toHaveBeenCalled()
  })
})

describe('the recipe desk, writing in a card', () => {
  it('holds each section in its own editor, behind its tab', () => {
    const { root } = mount({ recipe: SOUP })
    expect(root.querySelectorAll('.hc-recipe-card')).toHaveLength(7)
    expect(at<HTMLTextAreaElement>(card(root, 'story'), '0:text').value).toContain('grandmother')
    expect(at(card(root, 'facts'), '0:label').value).toBe('Serves')
    expect(at(card(root, 'facts'), '0:value').value).toBe('6')
    expect(at(card(root, 'ingredients'), '0:amount').value).toBe('2')
    expect(at(card(root, 'ingredients'), '0:item').value).toBe('onions')
    expect(at(card(root, 'ingredients'), '0:note').value).toBe('sliced thin')
    expect(at(card(root, 'ingredients'), '1:item').value).toBe('salt')
    expect(at<HTMLTextAreaElement>(card(root, 'steps'), '1:text').value).toBe('Add water and wait.')
    expect(at(card(root, 'steps'), '0:minutes').value).toBe('10')
    expect(card(root, 'steps').querySelector('img')?.getAttribute('src')).toBe('blob:local/bbbb')
    const thumbs = card(root, 'pictures').querySelectorAll('img')
    expect(thumbs).toHaveLength(1)
    expect(thumbs[0].alt).toBe('Pictures: picture 1 of 1')
    expect(card(root, 'pictures').querySelector('.hc-recipe-tag')?.textContent).toBe('Cover')
    expect(at(card(root, 'links'), '0:url').value).toBe('https://example.org/watch?v=1')
    expect(at(card(root, 'links'), '0:label').value).toBe('The technique')
    // A text section asks through its placeholder; the others in a quiet line under the heading.
    expect(at<HTMLTextAreaElement>(card(root, 'experience'), '0:text').placeholder).toBe('How is it served, and what does it go with?')
    expect(card(root, 'experience').querySelector('.hc-recipe-hint')).toBeNull()
    expect(card(root, 'links').querySelector('.hc-recipe-hint')?.textContent).toBe('A video of the technique, or where the recipe came from.')
    expect(card(root, 'ingredients').querySelector('.hc-recipe-hint')).toBeNull()
    for (const each of root.querySelectorAll<HTMLElement>('.hc-recipe-card')) {
      expect(each.querySelector('.hc-recipe-card-foot button')?.textContent).toBe('Done')
      expect(document.getElementById(each.getAttribute('aria-labelledby') ?? '')?.textContent).toBeTruthy()
    }
  })

  it('an edit announces a new document and leaves the old one as it was', () => {
    const { root, page, onChange } = mount({ recipe: SOUP })
    const before = page.recipe()
    type(at<HTMLTextAreaElement>(openCard(root, 'story'), '0:text'), 'A new story.')
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = last(onChange)
    expect(next.values['story']).toEqual({ kind: 'text', text: 'A new story.' })
    expect(next).not.toBe(before)
    expect(next.values).not.toBe(before.values)
    expect(before.values['story']).toEqual(SOUP.values['story'])
    expect(SOUP.values['story']).toEqual({ kind: 'text', text: 'My grandmother made this on Sundays.\nAlways too much.' })
    expect(next.values['ingredients']).toBe(SOUP.values['ingredients'])
    expect(page.recipe()).toBe(next)
    // The field was edited in place: the cook is still in it.
    expect(document.activeElement).toBe(at(card(root, 'story'), '0:text'))
  })

  it('keeps an unfinished ingredient in its fields and out of the document', async () => {
    const { root, page, onChange } = mount()
    const section = openCard(root, 'ingredients')
    type(at(section, '0:amount'), '2 cups')
    expect(onChange).not.toHaveBeenCalled()
    type(at(section, '0:item'), 'flour')
    expect(last(onChange).values['ingredients']).toEqual({ kind: 'ingredients', items: [{ amount: '2 cups', item: 'flour' }] })
    type(at(section, '0:note'), ' sifted ')
    expect(last(onChange).values['ingredients']).toEqual({ kind: 'ingredients', items: [{ amount: '2 cups', item: 'flour', note: 'sifted' }] })
    expect(await accepted(page)).toBe(true)
    type(at(section, '0:item'), '   ')
    expect(last(onChange).values['ingredients']).toBeUndefined()
    expect(callouts(root)).toEqual([])
    expect(summary(root, 'ingredients')).toBe('add ingredients')
    expect(await accepted(page)).toBe(true)
  })

  it('Enter in the last ingredient adds a row, and Backspace in an empty row removes it', () => {
    const { root } = mount()
    const section = openCard(root, 'ingredients')
    type(at(section, '0:item'), 'flour')
    const enter = key(at(section, '0:item'), 'Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(2)
    expect(document.activeElement).toBe(at(section, '1:amount'))
    // A second Enter in a row with nothing in it adds nothing.
    key(at(section, '1:amount'), 'Enter')
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(2)
    const back = key(at(section, '1:amount'), 'Backspace')
    expect(back.defaultPrevented).toBe(true)
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(1)
    expect(document.activeElement).toBe(at(section, '0:amount'))
    // Backspace in a row with words in it is only a backspace.
    expect(key(at(section, '0:item'), 'Backspace').defaultPrevented).toBe(false)
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(1)
  })

  it('adds a row at the bottom and removes one on each row', () => {
    const { root, onChange } = mount({ recipe: SOUP })
    const section = openCard(root, 'ingredients')
    button(section, 'Add an ingredient')?.click()
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(3)
    expect(document.activeElement).toBe(at(section, '2:amount'))
    expect(at<HTMLButtonElement>(section, '0:remove').getAttribute('aria-label')).toBe('Remove ingredient 1')
    at<HTMLButtonElement>(section, '0:remove').click()
    expect(itemsOf(last(onChange))).toEqual([{ item: 'salt' }])
    expect(callouts(root).map(label => label.textContent)).toEqual(['salt'])
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(2)
  })

  it('several pasted lines become ingredients, the quantity split from the item', () => {
    const { root, onChange } = mount()
    const section = openCard(root, 'ingredients')
    const { event } = paste(at(section, '0:item'), { text: '2 cups flour\n1/2 tsp salt\r\n\n3 eggs\nbutter' })
    expect(event.defaultPrevented).toBe(true)
    expect(last(onChange).values['ingredients']).toEqual({
      kind: 'ingredients',
      items: [{ amount: '2 cups', item: 'flour' }, { amount: '1/2 tsp', item: 'salt' }, { amount: '3', item: 'eggs' }, { item: 'butter' }],
    })
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(4)
    expect(document.activeElement).toBe(at(section, '3:item'))
    // The drawing has them at once.
    expect(callouts(root).map(label => label.textContent)).toEqual(['2 cupsflour', '1/2 tspsalt', '3eggs', 'butter'])
    // One pasted line is the field's own business.
    expect(paste(at(section, '3:item'), { text: 'one line' }).event.defaultPrevented).toBe(false)
  })

  it('pasting lines into a row that holds something adds them after it', () => {
    const { root, onChange } = mount()
    const section = openCard(root, 'ingredients')
    type(at(section, '0:item'), 'onions')
    paste(at(section, '0:item'), { text: '1 carrot\n2 leeks' })
    expect(itemsOf(last(onChange))).toEqual([
      { item: 'onions' }, { amount: '1', item: 'carrot' }, { amount: '2', item: 'leeks' },
    ])
  })

  it('steps are prose: Enter adds nothing, the button does, and lines pasted into an empty step split', () => {
    const { root, onChange } = mount()
    const section = openCard(root, 'steps')
    expect(key(at(section, '0:text'), 'Enter').defaultPrevented).toBe(false)
    expect(section.querySelectorAll('.hc-recipe-step')).toHaveLength(1)
    const { event } = paste(at(section, '0:text'), { text: '1. Chop.\n2. Sweat.\n3. Simmer.' })
    expect(event.defaultPrevented).toBe(true)
    expect(last(onChange).values['steps']).toEqual({ kind: 'steps', steps: [{ text: 'Chop.' }, { text: 'Sweat.' }, { text: 'Simmer.' }] })
    expect(document.activeElement).toBe(at(section, '2:text'))
    expect(summary(root, 'steps')).toBe('3 steps')
    // Into a step that already has words, pasted lines are that step's words.
    expect(paste(at(section, '2:text'), { text: 'a\nb' }).event.defaultPrevented).toBe(false)
    button(section, 'Add a step')?.click()
    expect(section.querySelectorAll('.hc-recipe-step')).toHaveLength(4)
    expect(document.activeElement).toBe(at(section, '3:text'))
    // The step with no words yet is not in the document.
    expect(stepsOf(last(onChange))).toHaveLength(3)
  })

  it('a step takes minutes, moves earlier and later, and is removed', async () => {
    const { root, page, onChange } = mount({ recipe: SOUP })
    const section = openCard(root, 'steps')
    type(at(section, '1:minutes'), '4x5')
    expect(at(section, '1:minutes').value).toBe('45')
    expect(stepsOf(last(onChange))[1]).toEqual({ text: 'Add water and wait.', picture: SIG_B, minutes: 45 })
    at<HTMLButtonElement>(section, '1:earlier').click()
    expect(stepsOf(last(onChange)).map(step => step.text)).toEqual(['Add water and wait.', 'Sweat the onions.'])
    expect(at<HTMLButtonElement>(section, '0:earlier').disabled).toBe(true)
    at<HTMLButtonElement>(section, '0:remove').click()
    expect(stepsOf(last(onChange)).map(step => step.text)).toEqual(['Sweat the onions.'])
    type(at(section, '0:minutes'), '99999')
    expect(stepsOf(last(onChange))[0]).toEqual({ text: 'Sweat the onions.' })
    expect(await accepted(page)).toBe(true)
  })

  it('a facts section starts with the labels its template suggests, waiting for values', async () => {
    const { root, page, onChange } = mount()
    const section = openCard(root, 'facts')
    expect([...section.querySelectorAll<HTMLInputElement>('[data-at$=":label"]')].map(field => field.value)).toEqual(['Serves', 'Time', 'From'])
    expect(page.recipe().values['facts']).toBeUndefined()
    type(at(section, '1:value'), '40 minutes')
    expect(last(onChange).values['facts']).toEqual({ kind: 'facts', facts: [{ label: 'Time', value: '40 minutes' }] })
    expect(summary(root, 'facts')).toBe('40 minutes')
    button(section, 'Add a fact')?.click()
    expect(section.querySelectorAll('.hc-recipe-fact')).toHaveLength(4)
    at<HTMLButtonElement>(section, '1:remove').click()
    expect(last(onChange).values['facts']).toBeUndefined()
    expect(summary(root, 'facts')).toBe('none')
    expect(await accepted(page)).toBe(true)
  })

  it('a link is normalised and kept, a video is tagged, and what is not a link is refused', async () => {
    const { root, page, onChange } = mount()
    const section = openCard(root, 'links')
    const address = at(section, '0:url')
    type(address, 'youtube.com/watch?v=abc')
    expect(last(onChange).values['links']).toEqual({ kind: 'links', links: [{ url: 'https://youtube.com/watch?v=abc' }] })
    expect(summary(root, 'links')).toBe('1 video')
    expect(section.querySelector('.hc-recipe-tag')?.hasAttribute('hidden')).toBe(false)
    expect(section.querySelector('.hc-recipe-note')?.hasAttribute('hidden')).toBe(true)
    address.dispatchEvent(new Event('change', { bubbles: true }))
    expect(address.value).toBe('https://youtube.com/watch?v=abc')
    type(at(section, '0:label'), 'The technique')
    expect(last(onChange).values['links']).toEqual({ kind: 'links', links: [{ url: 'https://youtube.com/watch?v=abc', label: 'The technique' }] })

    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'not a link', 'https://user:pass@example.org/', 'ftp://example.org/x']) {
      type(address, bad)
      expect(last(onChange).values['links'], bad).toBeUndefined()
      expect(section.querySelector('.hc-recipe-note')?.hasAttribute('hidden'), bad).toBe(false)
      expect(section.querySelector('.hc-recipe-tag')?.hasAttribute('hidden'), bad).toBe(true)
      expect(summary(root, 'links'), bad).toBe('none')
    }
    expect(await accepted(page)).toBe(true)
    type(address, 'https://example.org/soup')
    expect(last(onChange).values['links']).toEqual({ kind: 'links', links: [{ url: 'https://example.org/soup', label: 'The technique' }] })
    expect(section.querySelector('.hc-recipe-tag')?.hasAttribute('hidden')).toBe(true)
    // Nothing is embedded for a link: no frame, no player, no picture of it.
    expect(root.querySelector('iframe, video, embed, object')).toBeNull()
  })

  it('pictures are reordered and removed in their card, and the plate follows the first', () => {
    const { root, onChange } = mount({ recipe: { values: { pictures: { kind: 'pictures', pictures: [SIG_A, SIG_B, SIG_C] } } } })
    const section = openCard(root, 'pictures')
    expect(section.querySelectorAll('.hc-recipe-tag')).toHaveLength(1)
    expect(section.querySelector('figure .hc-recipe-tag')?.textContent).toBe('Cover')
    at<HTMLButtonElement>(section, '2:earlier').click()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_A, SIG_C, SIG_B] })
    at<HTMLButtonElement>(section, '0:later').click()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A, SIG_B] })
    expect(section.querySelector('figure img')?.getAttribute('src')).toBe('blob:local/cccc')
    expect(root.querySelector('.hc-recipe-dish img')?.getAttribute('src')).toBe('blob:local/cccc')
    at<HTMLButtonElement>(section, '1:remove').click()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_B] })
    expect(at<HTMLButtonElement>(section, '0:earlier').disabled).toBe(true)
    expect(at<HTMLButtonElement>(section, '1:later').disabled).toBe(true)
    expect(root.querySelectorAll('.hc-recipe-strip-thumb')).toHaveLength(2)
  })

  it('enforces the limits where things are entered', () => {
    const many = Array.from({ length: RECIPE_LIMITS.ingredients }, (_, n) => ({ item: `thing ${n}` }))
    const { root } = mount({ recipe: { values: { ingredients: { kind: 'ingredients', items: many } } } })
    const section = openCard(root, 'ingredients')
    expect(at(section, '0:amount').maxLength).toBe(RECIPE_LIMITS.amount)
    expect(at(section, '0:item').maxLength).toBe(RECIPE_LIMITS.item)
    expect(at(section, '0:note').maxLength).toBe(RECIPE_LIMITS.note)
    expect(at<HTMLTextAreaElement>(card(root, 'story'), '0:text').maxLength).toBe(RECIPE_LIMITS.text)
    expect(at<HTMLTextAreaElement>(card(root, 'steps'), '0:text').maxLength).toBe(RECIPE_LIMITS.step)
    expect(button(section, 'Add an ingredient')?.disabled).toBe(true)
    key(at(section, `${RECIPE_LIMITS.ingredients - 1}:item`), 'Enter')
    expect(section.querySelectorAll('.hc-recipe-ingredient')).toHaveLength(RECIPE_LIMITS.ingredients)
    // The drawing never grows with them: nine labels, and the rest counted.
    expect(callouts(root)).toHaveLength(10)
    expect(callouts(root)[9].textContent).toBe(`+ ${RECIPE_LIMITS.ingredients - 9} more`)
  })

  it('says a section is full when a paste brings more than it holds', () => {
    const many = Array.from({ length: RECIPE_LIMITS.ingredients - 1 }, (_, n) => ({ item: `thing ${n}` }))
    const { root, onChange } = mount({ recipe: { values: { ingredients: { kind: 'ingredients', items: many } } } })
    const section = openCard(root, 'ingredients')
    paste(at(section, `${RECIPE_LIMITS.ingredients - 2}:item`), { text: 'one\ntwo\nthree' })
    expect(itemsOf(last(onChange))).toHaveLength(RECIPE_LIMITS.ingredients)
    expect(root.querySelector('.hc-recipe-status')?.textContent).toBe(`This section is full: it holds at most ${RECIPE_LIMITS.ingredients}.`)
    expect(root.querySelector('.hc-recipe-status')?.classList.contains('is-bad')).toBe(true)
  })

  it('whatever is typed, the document is one the reader accepts', async () => {
    const { root, page } = mount()
    type(at<HTMLTextAreaElement>(openCard(root, 'story'), '0:text'), `Line one\r\nline two${String.fromCharCode(7)} with a bell${String.fromCharCode(0x202e)} and an override`)
    type(at(openCard(root, 'ingredients'), '0:item'), `onions${String.fromCharCode(0)}`)
    type(at(card(root, 'ingredients'), '0:amount'), '  2  ')
    type(at<HTMLTextAreaElement>(openCard(root, 'steps'), '0:text'), '   ')
    type(at(openCard(root, 'facts'), '0:value'), '6')
    type(at(openCard(root, 'links'), '0:url'), 'example.org/a b')
    const parsed = await parseRecipe(recipeBytes(page.recipe()))
    expect(parsed.ok, parsed.ok ? '' : parsed.reason).toBe(true)
    expect(page.recipe().values['story']).toEqual({ kind: 'text', text: 'Line one\nline two with a bell and an override' })
    expect(page.recipe().values['ingredients']).toEqual({ kind: 'ingredients', items: [{ amount: '2', item: 'onions' }] })
    expect(page.recipe().values['steps']).toBeUndefined()
    expect(page.recipe().values['links']).toBeUndefined()
  })

  it('renders hostile words as text and makes no element of them', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const { root, page } = mount({
      title: hostile,
      address: hostile,
      tiles: [{ label: hostile, hasRecipe: true, current: true }],
      shared: { lit: true, words: hostile },
      template: { name: hostile, sections: [
        { key: 'story', kind: 'text', label: hostile, prompt: hostile },
        { key: 'ingredients', kind: 'ingredients', label: hostile, prompt: hostile },
        { key: 'facts', kind: 'facts', label: 'Facts', fields: [hostile] },
      ] },
      recipe: { values: {
        story: { kind: 'text', text: hostile },
        ingredients: { kind: 'ingredients', items: [{ amount: hostile, item: hostile, note: hostile }] },
        facts: { kind: 'facts', facts: [{ label: hostile, value: hostile }] },
        extra: { kind: 'links', links: [{ url: 'https://example.org/', label: hostile }] },
      } },
    })
    const made = (): number => root.querySelectorAll('img[src="x"], img[onerror], script, [onerror]').length
    // The one picture element on the desk is the plate's own, waiting for a cover.
    expect(root.querySelectorAll('img')).toHaveLength(1)
    expect(made()).toBe(0)
    expect(root.querySelector('.hc-recipe-title')?.textContent).toBe(hostile)
    expect(root.querySelector('.hc-recipe-address')?.textContent).toBe(hostile)
    expect(root.querySelector('.hc-recipe-template')?.textContent).toBe(hostile)
    expect(root.querySelector('.hc-recipe-shared-words')?.textContent).toBe(hostile)
    expect(root.querySelector('.hc-recipe-list-name')?.textContent).toBe(hostile)
    expect(tab(root, 'story').querySelector('.hc-recipe-tab-label')?.textContent).toBe(hostile)
    expect(summary(root, 'story')).toBe(hostile)
    expect(summary(root, 'facts')).toBe(hostile)
    expect(callouts(root)[0].querySelector('.hc-recipe-callout-amount')?.textContent).toBe(hostile)
    expect(callouts(root)[0].querySelector('.hc-recipe-callout-item')?.textContent).toBe(hostile)
    expect(card(root, 'story').querySelector('.hc-recipe-label')?.textContent).toBe(hostile)
    expect(card(root, 'ingredients').querySelector('.hc-recipe-hint')?.textContent).toBe(hostile)
    expect(at(card(root, 'ingredients'), '0:item').value).toBe(hostile)
    button(root, 'Arrange')?.click()
    expect(root.querySelectorAll('img')).toHaveLength(1)
    expect(made()).toBe(0)
    page.setMode('read')
    for (let turn = 0; turn < 6; turn++) {
      expect(root.querySelectorAll('img'), `page ${turn}`).toHaveLength(1)
      expect(made()).toBe(0)
      key(document.body, 'ArrowRight')
    }
    page.setStatus(hostile)
    expect(root.querySelector('.hc-recipe-status')?.textContent).toBe(hostile)
    expect(made()).toBe(0)
    const visitor = mount({ readOnly: true, title: hostile, primaryAction: { label: hostile, onPress: () => {} } })
    expect(visitor.root.querySelector('.hc-recipe-action')?.textContent).toBe(hostile)
    expect(visitor.root.querySelectorAll('img[src="x"], img[onerror], script')).toHaveLength(0)
  })
})

describe('the recipe desk, pictures by paste', () => {
  it('a pasted picture is stored, stopped here, and lands on the focused step', async () => {
    const { root, onChange, takePictures } = mount({ recipe: SOUP })
    const outside = vi.fn()
    document.addEventListener('paste', outside)
    const section = openCard(root, 'steps')
    const words = at<HTMLTextAreaElement>(section, '0:text')
    words.focus()
    const file = png()
    const { event, stopped } = paste(words, { files: [file] })
    document.removeEventListener('paste', outside)
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).toHaveBeenCalled()
    // The hive's own paste handler listens on the document: it never hears of this one.
    expect(outside).not.toHaveBeenCalled()
    expect(takePictures).toHaveBeenCalledWith([file])
    // While it is stored the step shows a placeholder, and the cook is still in the field.
    expect(section.querySelector('.is-storing')).not.toBeNull()
    await settle()
    expect(section.querySelector('.is-storing')).toBeNull()
    expect(stepsOf(last(onChange))[0]).toEqual({ text: 'Sweat the onions.', picture: SIG_C, minutes: 10 })
    expect(last(onChange).values['pictures']).toEqual(SOUP.values['pictures'])
    expect(document.activeElement).toBe(words)
    expect(section.querySelectorAll('img')).toHaveLength(2)
    // The plate keeps its cover: a step's picture is the step's.
    expect(root.querySelector('.hc-recipe-dish img')?.getAttribute('src')).toBe('blob:local/aaaa')
  })

  it('a picture pasted into another card joins the pictures, after the cover', async () => {
    const { root, onChange, takePictures } = mount({ recipe: SOUP })
    const story = at<HTMLTextAreaElement>(openCard(root, 'story'), '0:text')
    story.focus()
    const { event, stopped } = paste(story, { files: [png('one.png'), png('two.png')] })
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).toHaveBeenCalled()
    expect(card(root, 'pictures').querySelectorAll('.is-storing')).toHaveLength(2)
    await settle()
    expect(takePictures).toHaveBeenCalledTimes(1)
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_A, SIG_C, SIG_B] })
    expect(card(root, 'pictures').querySelectorAll('img')).toHaveLength(3)
    expect(card(root, 'pictures').querySelector('.is-storing')).toBeNull()
    expect(summary(root, 'pictures')).toBe('3 pictures')
    expect(root.querySelectorAll('.hc-recipe-strip-thumb')).toHaveLength(3)
    // The card the cook was in stays open, and they stay in it.
    expect(shownCards(root)).toEqual(['story'])
    expect(document.activeElement).toBe(story)
  })

  it('a paste with nothing focused still belongs to the desk while it is up', async () => {
    const { root, onChange } = mount()
    const { event, stopped } = paste(document.body, { files: [png()] })
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).toHaveBeenCalled()
    await settle()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C] })
    expect(card(root, 'pictures').querySelectorAll('img')).toHaveLength(1)
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure')?.dataset['state']).toBe('picture')
  })

  it('with no pictures section, a pasted picture is kept under "pictures" and joins the drawing as a tab', async () => {
    const template: RecipeTemplateDocument = { name: 'Bare', sections: [{ key: 'method', kind: 'text', label: 'Method' }] }
    const { root, onChange } = mount({ template })
    const method = at<HTMLTextAreaElement>(openCard(root, 'method'), '0:text')
    type(method, 'Stir.')
    paste(method, { files: [png()] })
    await settle()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C] })
    expect(root.querySelector('.hc-recipe-also')?.textContent).toBe('Also in this recipe')
    expect(partKeys(root)).toEqual(['method', 'pictures'])
    expect(summary(root, 'pictures')).toBe('1 picture')
    expect(leads(root)).toContain(tab(root, 'pictures').dataset['id'])
    expect(card(root, 'pictures').querySelectorAll('img')).toHaveLength(1)
    expect(root.querySelector('.hc-recipe-dish img')?.getAttribute('src')).toBe('blob:local/cccc')
    // The card the cook was typing in was not rebuilt.
    expect(at(card(root, 'method'), '0:text')).toBe(method)
    expect(document.activeElement).toBe(method)
    expect(shownCards(root)).toEqual(['method'])
  })

  it('words pasted into a field stay words, and a paste of words is left alone', () => {
    const { root, takePictures } = mount()
    const story = at<HTMLTextAreaElement>(openCard(root, 'story'), '0:text')
    story.focus()
    const mixed = paste(story, { text: 'copied from a document', files: [png()] })
    expect(mixed.event.defaultPrevented).toBe(false)
    expect(mixed.stopped).not.toHaveBeenCalled()
    const plain = paste(story, { text: 'just words' })
    expect(plain.event.defaultPrevented).toBe(false)
    expect(plain.stopped).not.toHaveBeenCalled()
    expect(takePictures).not.toHaveBeenCalled()
  })

  it('says so when a picture could not be stored', async () => {
    const { root, onChange } = mount({ takePictures: vi.fn(async () => { throw new Error('quota') }) })
    paste(document.body, { files: [png()] })
    expect(root.querySelector('.hc-recipe-status')?.textContent).toBe('Adding pictures')
    await settle()
    expect(root.querySelector('.hc-recipe-status')?.textContent).toBe('A picture could not be stored.')
    expect(root.querySelector('.hc-recipe-status')?.classList.contains('is-bad')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(root.querySelector('.is-storing')).toBeNull()
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure-note')?.hidden).toBe(true)
  })

  it('takes fewer signatures than files, and nothing that is not a signature', async () => {
    const { root, onChange } = mount({ takePictures: vi.fn(async () => [SIG_A, 'not-a-signature']) })
    paste(document.body, { files: [png(), png('b.png')] })
    await settle()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_A] })
    expect(root.querySelector('.hc-recipe-status')?.textContent).toBe('A picture could not be stored.')
  })

  it('a dropped file lands on the step it was dropped on', async () => {
    const { root, onChange } = mount({ recipe: SOUP })
    const target = at<HTMLTextAreaElement>(openCard(root, 'steps'), '0:text')
    const { event, stopped } = drop(target, [png()])
    expect(event.defaultPrevented).toBe(true)
    expect(stopped).toHaveBeenCalled()
    await settle()
    expect(stepsOf(last(onChange))[0].picture).toBe(SIG_C)
    expect(last(onChange).values['pictures']).toEqual(SOUP.values['pictures'])
  })

  it('a step with a picture and no words says why the picture is not kept yet', async () => {
    const { root, page, onChange } = mount()
    const section = openCard(root, 'steps')
    const words = at<HTMLTextAreaElement>(section, '0:text')
    words.focus()
    paste(words, { files: [png()] })
    await settle()
    expect(section.querySelector('img')).not.toBeNull()
    expect(section.querySelector('.hc-recipe-note')?.hasAttribute('hidden')).toBe(false)
    expect(page.recipe().values['steps']).toBeUndefined()
    type(words, 'Brown the butter.')
    expect(section.querySelector('.hc-recipe-note')?.hasAttribute('hidden')).toBe(true)
    expect(last(onChange).values['steps']).toEqual({ kind: 'steps', steps: [{ text: 'Brown the butter.', picture: SIG_C }] })
  })
})

describe('the recipe desk, through another template', () => {
  it('switching the template keeps every value and shows what it has no section for', () => {
    const { root, page, onChange } = mount({ recipe: SOUP })
    page.setTemplate(RECIPE_TEMPLATE_WEEKNIGHT)
    expect(root.querySelector('.hc-recipe-template')?.textContent).toBe('Weeknight')
    expect(partKeys(root)).toEqual(['facts', 'ingredients', 'steps', 'swaps', 'pictures', 'links', 'story'])
    expect(tab(root, 'ingredients').querySelector('.hc-recipe-tab-label')?.textContent).toBe('Ingredients')
    expect(root.querySelector('.hc-recipe-also')?.textContent).toBe('Also in this recipe')
    expect(page.recipe().values).toEqual(SOUP.values)
    expect(onChange).not.toHaveBeenCalled()
    expect(callouts(root).map(label => label.textContent)).toEqual(['2onions', 'salt'])
    // What was kept is still fully editable.
    type(at<HTMLTextAreaElement>(openCard(root, 'story'), '0:text'), 'Still mine.')
    expect(last(onChange).values['story']).toEqual({ kind: 'text', text: 'Still mine.' })
    page.setTemplate(RECIPE_TEMPLATE_FAMILY)
    expect(root.querySelector('.hc-recipe-also')).toBeNull()
    expect(at<HTMLTextAreaElement>(card(root, 'story'), '0:text').value).toBe('Still mine.')
    // The card that was open is open through the new layout too.
    expect(shownCards(root)).toEqual(['story'])
  })

  it('never writes over a value of another kind held under the same key', async () => {
    const template: RecipeTemplateDocument = { name: 'Odd', sections: [{ key: 'story', kind: 'facts', label: 'Story facts', fields: ['Year'] }] }
    const { root, page, onChange } = mount({ template, recipe: { values: { story: { kind: 'text', text: 'Kept words.' } } } })
    const cards = [...root.querySelectorAll<HTMLElement>('.hc-recipe-card')]
    expect(cards.map(node => node.dataset['kind'])).toEqual(['facts', 'text'])
    // Two parts of one key are two tabs with a leader each.
    expect(leads(root)).toHaveLength(2)
    expect(new Set(leads(root)).size).toBe(2)
    type(at(cards[0], '0:value'), '1962')
    const values = last(onChange).values
    expect(values['story']).toEqual({ kind: 'facts', facts: [{ label: 'Year', value: '1962' }] })
    expect(values['story-text']).toEqual({ kind: 'text', text: 'Kept words.' })
    // The kept part now writes under the key its words moved to, and says so on its tab.
    expect(partKeys(root)).toEqual(['story', 'story-text'])
    expect(tab(root, 'story-text').querySelector('.hc-recipe-tab-label')?.textContent).toBe('story text')
    type(at<HTMLTextAreaElement>(cards[1], '0:text'), 'Kept words, edited.')
    expect(last(onChange).values['story-text']).toEqual({ kind: 'text', text: 'Kept words, edited.' })
    expect(last(onChange).values['story']).toEqual({ kind: 'facts', facts: [{ label: 'Year', value: '1962' }] })
    expect(await accepted(page)).toBe(true)
  })

  it('a save echoed back touches nothing; an undo is shown and the cook keeps their place', () => {
    const { root, page } = mount({ recipe: SOUP })
    const section = openCard(root, 'ingredients')
    key(at(section, '1:item'), 'Enter')
    type(at(section, '2:amount'), 'a pinch')
    const amount = at(section, '2:amount')
    page.setRecipe(page.recipe())
    // The unfinished row is still there, and it is the same field.
    expect(at(section, '2:amount')).toBe(amount)
    expect(document.activeElement).toBe(amount)
    expect(shownCards(root)).toEqual(['ingredients'])

    const undone: RecipeDocument = { values: { ...SOUP.values, ingredients: { kind: 'ingredients', items: [{ item: 'onions' }, { item: 'salt' }, { item: 'thyme' }] } } }
    page.setRecipe(undone)
    expect(at(section, '2:item').value).toBe('thyme')
    expect(at(section, '0:amount').value).toBe('')
    expect(document.activeElement).toBe(at(section, '2:amount'))
    expect(page.recipe().values).toEqual(undone.values)
    // The drawing shows the undone recipe too.
    expect(callouts(root).map(label => label.textContent)).toEqual(['onions', 'salt', 'thyme'])
    expect(summary(root, 'ingredients')).toBe('3 ingredients')

    // A value the desk was not showing arrives: the parts are redrawn around it, the same card open.
    page.setRecipe({ values: { ...undone.values, pairing: { kind: 'text', text: 'Cider.' } } })
    expect(at<HTMLTextAreaElement>(card(root, 'pairing'), '0:text').value).toBe('Cider.')
    expect(summary(root, 'pairing')).toBe('Cider.')
    expect(shownCards(root)).toEqual(['ingredients'])
    expect(document.activeElement).toBe(at(card(root, 'ingredients'), '2:amount'))
  })

  it('a recipe set from outside redraws the plate and the tabs', () => {
    const { root, page, onChange } = mount()
    page.setRecipe(SOUP)
    expect(onChange).not.toHaveBeenCalled()
    expect(summary(root, 'facts')).toBe('Serves 6')
    expect(callouts(root)).toHaveLength(2)
    expect(root.querySelector('.hc-recipe-dish img')?.getAttribute('src')).toBe('blob:local/aaaa')
    expect(root.querySelectorAll('.hc-recipe-strip-thumb')).toHaveLength(1)
    page.setRecipe({ values: {} })
    expect(callouts(root)).toEqual([])
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure')?.dataset['state']).toBe('empty')
  })
})

describe('the recipe desk, arranging', () => {
  const arrange = (root: HTMLElement): void => { button(must(root.querySelector('.hc-recipe-menu'), 'menu'), 'Arrange')?.click() }
  const valid = async (template: RecipeTemplateDocument): Promise<boolean> => (await parseRecipeTemplate(recipeTemplateBytes(template))).ok
  const sectionRows = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.hc-recipe-arrange-row[data-key]:not(.hc-recipe-kept-row)')]

  it('draws the layout in the same language: each tab its name as a field, with earlier, later and remove', () => {
    const { root } = mount({ recipe: SOUP })
    openCard(root, 'story')
    arrange(root)
    expect(root.classList.contains('is-arranging')).toBe(true)
    // No card is open while the layout is arranged, and the plate keeps its picture.
    expect(root.querySelector('.hc-recipe-card')).toBeNull()
    expect(root.dataset['open']).toBeUndefined()
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure')?.dataset['state']).toBe('picture')
    const rows = sectionRows(root)
    expect(rows.map(row => row.dataset['key'])).toEqual(['story', 'pictures', 'facts', 'ingredients', 'steps', 'experience', 'links'])
    expect(rows.map(row => row.querySelector('.hc-recipe-tag')?.textContent)).toEqual(['Text', 'Pictures', 'Facts', 'Ingredients', 'Steps', 'Text', 'Links'])
    for (const row of rows) {
      expect(row.classList.contains('hc-recipe-tab')).toBe(true)
      expect(row.querySelectorAll('input')).toHaveLength(1)
      expect(row.querySelectorAll('button')).toHaveLength(3)
    }
    expect(at(root, '3:label').value).toBe('What you need')
    expect(at<HTMLButtonElement>(root, '0:earlier').disabled).toBe(true)
    expect(at<HTMLButtonElement>(root, '6:later').disabled).toBe(true)
    // An "add a part" tab asks for a kind and a name.
    const adding = must(root.querySelector<HTMLElement>('.hc-recipe-arrange-add'), 'add row')
    expect(adding.querySelectorAll('select option')).toHaveLength(6)
    expect(at(root, 'add:label').placeholder).toBe('add a part')
    // Every row has its leader to the plate, and the two sides share them.
    expect(leads(root)).toHaveLength(8)
    expect(new Set(rows.map(row => row.parentElement?.dataset['side']))).toEqual(new Set(['left', 'right']))
    // The template's name is a field in the header, and the filled button ends the arranging.
    const name = at(root, 'name')
    expect(name.closest('.hc-recipe-head')).not.toBeNull()
    expect(name.hidden).toBe(false)
    expect(name.value).toBe('Family recipe')
    expect(document.activeElement).toBe(name)
    expect(root.querySelector<HTMLElement>('.hc-recipe-template')?.hidden).toBe(true)
    expect(root.querySelector('.hc-recipe-done')?.textContent).toBe('Done arranging')
    expect(root.querySelector('.hc-recipe-tools-note')?.textContent).toContain('Nothing you wrote is deleted')
  })

  it('renames, moves, adds and removes sections, each time a valid template, never losing a value', async () => {
    const { root, page, onLayout, onChange, onClose } = mount({ recipe: SOUP })
    arrange(root)
    expect(sectionRows(root)).toHaveLength(7)

    type(at(root, '0:label'), 'Where it began')
    expect(last(onLayout).sections[0]).toEqual({ ...RECIPE_TEMPLATE_FAMILY.sections[0], label: 'Where it began' })
    expect(await valid(last(onLayout))).toBe(true)
    // An empty label is never announced, and the field takes its name back.
    const calls = onLayout.mock.calls.length
    type(at(root, '0:label'), '   ')
    expect(onLayout).toHaveBeenCalledTimes(calls)
    at(root, '0:label').dispatchEvent(new Event('blur'))
    expect(at(root, '0:label').value).toBe('Where it began')

    at<HTMLButtonElement>(root, '0:later').click()
    expect(last(onLayout).sections.map(section => section.key).slice(0, 3)).toEqual(['pictures', 'story', 'facts'])
    expect(document.activeElement).toBe(at(root, '1:later'))
    at<HTMLButtonElement>(root, '1:earlier').click()
    expect(last(onLayout).sections[0].key).toBe('story')
    // It reached the top: its earlier button is off, so focus goes to the other one.
    expect(document.activeElement).toBe(at(root, '0:later'))

    at<HTMLSelectElement>(root, 'add:kind').value = 'ingredients'
    type(at(root, 'add:label'), 'For the Table!')
    at<HTMLButtonElement>(root, 'add:go').click()
    expect(last(onLayout).sections).toHaveLength(8)
    expect(last(onLayout).sections[7]).toEqual({ key: 'for-the-table', kind: 'ingredients', label: 'For the Table!' })
    expect(document.activeElement).toBe(at(root, '7:label'))
    // The same label again makes another key.
    type(at(root, 'add:label'), 'For the table')
    key(at(root, 'add:label'), 'Enter')
    expect(last(onLayout).sections[8].key).toBe('for-the-table-2')
    expect(await valid(last(onLayout))).toBe(true)

    type(at(root, 'name'), 'Sunday soup')
    expect(last(onLayout).name).toBe('Sunday soup')
    expect(last(onLayout).description).toBe(RECIPE_TEMPLATE_FAMILY.description)
    expect(root.querySelector('.hc-recipe-template')?.textContent).toBe('Sunday soup')
    // An empty name is never announced, and the field takes the name back.
    const named = onLayout.mock.calls.length
    type(at(root, 'name'), '  ')
    expect(onLayout).toHaveBeenCalledTimes(named)
    at(root, 'name').dispatchEvent(new Event('blur'))
    expect(at(root, 'name').value).toBe('Sunday soup')

    // Removing a section removes it from the layout only.
    at<HTMLButtonElement>(root, '0:remove').click()
    expect(last(onLayout).sections.some(section => section.key === 'story')).toBe(false)
    expect(await valid(last(onLayout))).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(page.recipe().values).toEqual(SOUP.values)
    expect(root.querySelector('.hc-recipe-also')).not.toBeNull()
    expect(root.querySelector('.hc-recipe-kept-name')?.textContent).toBe('story')

    // The filled button ends the arranging. It does not close the desk.
    must(root.querySelector<HTMLButtonElement>('.hc-recipe-done'), 'done').click()
    expect(root.classList.contains('is-arranging')).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    expect(root.querySelector('.hc-recipe-done')?.textContent).toBe('Done')
    expect(at(root, 'name').hidden).toBe(true)
    const keys = partKeys(root)
    expect(keys[keys.length - 1]).toBe('story')
    expect(at<HTMLTextAreaElement>(card(root, 'story'), '0:text').value).toContain('grandmother')
    expect(summary(root, 'story')).toContain('grandmother')
  })

  it('gives a kept value its section back, and never removes the last section', async () => {
    const template: RecipeTemplateDocument = { name: 'One', sections: [{ key: 'method', kind: 'steps', label: 'Method' }] }
    const { root, onLayout } = mount({ template, recipe: SOUP })
    arrange(root)
    expect(at<HTMLButtonElement>(root, '0:remove').disabled).toBe(true)
    const give = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-kept-row button')]
    expect(give).toHaveLength(6)
    expect(give[0].textContent).toBe('Make it a section')
    give[0].click()
    expect(last(onLayout).sections[1]).toEqual({ key: 'facts', kind: 'facts', label: 'Facts' })
    expect(root.querySelectorAll('.hc-recipe-kept-row')).toHaveLength(5)
    expect(await valid(last(onLayout))).toBe(true)
  })

  it('stops adding at the most sections a template holds', () => {
    const sections = Array.from({ length: RECIPE_LIMITS.sections }, (_, n) => ({ key: `s${n}`, kind: 'text' as const, label: `Section ${n}` }))
    const { root, onLayout } = mount({ template: { name: 'Full', sections } })
    arrange(root)
    expect(at<HTMLButtonElement>(root, 'add:go').disabled).toBe(true)
    expect(at(root, 'add:label').disabled).toBe(true)
    at<HTMLButtonElement>(root, 'add:go').click()
    expect(onLayout).not.toHaveBeenCalled()
    expect(root.querySelector('.hc-recipe-tools-note')?.textContent).toBe(`A layout holds at most ${RECIPE_LIMITS.sections} sections.`)
  })
})

describe('the recipe desk, reading along', () => {
  const pageKind = (root: HTMLElement): string | undefined => root.querySelector<HTMLElement>('.hc-recipe-page')?.dataset['page']

  it('shows one page at a time and turns with the keys and the buttons', () => {
    const { root, page } = mount({ recipe: SOUP, mode: 'read' })
    expect(page.mode()).toBe('read')
    expect(root.dataset['mode']).toBe('read')
    // The stage steps aside: reading is its own face of the same desk.
    expect(root.querySelector<HTMLElement>('.hc-recipe-stage')?.hidden).toBe(true)
    expect(root.querySelector('.hc-recipe-part')).toBeNull()
    expect(root.querySelectorAll('.hc-recipe-page')).toHaveLength(1)
    expect(pageKind(root)).toBe('cover')
    expect(root.querySelector('.hc-recipe-cover-title')?.textContent).toBe('Onion soup')
    expect(root.querySelector('.hc-recipe-picture img')?.getAttribute('src')).toBe('blob:local/aaaa')
    expect(root.querySelector('.hc-recipe-facts')?.textContent).toBe('Serves6')
    expect(root.querySelector('.hc-recipe-position')?.textContent).toBe('1 of 6')
    const [previous, next] = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-nav button')]
    expect(previous.disabled).toBe(true)

    const right = key(document.body, 'ArrowRight')
    expect(right.defaultPrevented).toBe(true)
    expect(pageKind(root)).toBe('text')
    expect(root.querySelector('.hc-recipe-prose')?.textContent).toBe('My grandmother made this on Sundays.\nAlways too much.')
    expect(root.querySelector('br')).toBeNull()

    key(document.body, 'PageDown')
    expect(pageKind(root)).toBe('ingredients')
    const boxes = root.querySelectorAll<HTMLInputElement>('.hc-recipe-check input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(root.querySelector('.hc-recipe-check li')?.textContent).toBe('2onionssliced thin')

    key(document.body, ' ')
    expect(pageKind(root)).toBe('step')
    expect(root.querySelector('.hc-recipe-page')?.textContent).toContain('Step 1 of 2')
    expect(root.querySelector('.hc-recipe-page')?.textContent).toContain('10 min')
    next.click()
    expect(root.querySelector('.hc-recipe-page')?.textContent).toContain('Step 2 of 2')
    expect(root.querySelector('.hc-recipe-picture img')?.getAttribute('alt')).toBe('Picture of step 2')

    key(document.body, 'ArrowRight')
    expect(pageKind(root)).toBe('links')
    const anchor = root.querySelector<HTMLAnchorElement>('.hc-recipe-links a')
    expect(anchor?.getAttribute('href')).toBe('https://example.org/watch?v=1')
    expect(anchor?.target).toBe('_blank')
    expect(anchor?.rel).toBe('noopener noreferrer')
    expect(anchor?.textContent).toBe('The technique')
    expect(next.disabled).toBe(true)
    expect(root.querySelector('.hc-recipe-position')?.textContent).toBe('6 of 6')
    expect(root.querySelector('.hc-recipe-progress')?.getAttribute('aria-valuenow')).toBe('6')
    key(document.body, 'ArrowRight')
    expect(pageKind(root)).toBe('links')

    key(document.body, 'ArrowLeft')
    key(document.body, 'PageUp')
    key(document.body, ' ', { shiftKey: true })
    expect(pageKind(root)).toBe('ingredients')
    previous.click()
    expect(pageKind(root)).toBe('text')
  })

  it('ticks are for this sitting only, and a key in a control belongs to the control', () => {
    const { root, page, onChange } = mount({ recipe: SOUP, mode: 'read' })
    key(document.body, 'ArrowRight')
    key(document.body, 'ArrowRight')
    const box = root.querySelector<HTMLInputElement>('.hc-recipe-check input')!
    box.click()
    expect(box.checked).toBe(true)
    // Space on the box ticks it; it does not turn the page.
    expect(key(box, ' ').defaultPrevented).toBe(false)
    expect(pageKind(root)).toBe('ingredients')
    key(document.body, 'ArrowRight')
    key(document.body, 'ArrowLeft')
    expect(root.querySelector<HTMLInputElement>('.hc-recipe-check input')?.checked).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(page.recipe().values).toEqual(SOUP.values)
    // Keys with a modifier are the browser's.
    expect(key(document.body, 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false)
    expect(pageKind(root)).toBe('ingredients')
  })

  it('keeps the place through a visit to write mode, and tells the caller when the cook switches', () => {
    const { root, page, onMode } = mount({ recipe: SOUP })
    const [write, read] = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-switch button')]
    expect(write.getAttribute('aria-pressed')).toBe('true')
    read.click()
    expect(onMode).toHaveBeenLastCalledWith('read')
    expect(read.getAttribute('aria-pressed')).toBe('true')
    key(document.body, 'ArrowRight')
    key(document.body, 'ArrowRight')
    expect(pageKind(root)).toBe('ingredients')
    write.click()
    expect(onMode).toHaveBeenLastCalledWith('write')
    expect(root.querySelector('.hc-recipe-page')).toBeNull()
    expect(root.querySelector<HTMLElement>('.hc-recipe-stage')?.hidden).toBe(false)
    expect(partKeys(root)).toHaveLength(7)
    // In write mode the arrows belong to the fields.
    expect(key(document.body, 'ArrowRight').defaultPrevented).toBe(false)
    read.click()
    expect(pageKind(root)).toBe('ingredients')
    // Set by the caller, the mode changes without an echo.
    onMode.mockClear()
    page.setMode('write')
    expect(page.mode()).toBe('write')
    expect(onMode).not.toHaveBeenCalled()
  })

  it('an empty recipe says so kindly, with a way back to writing', () => {
    const { root, page, onMode } = mount({ mode: 'read' })
    expect(pageKind(root)).toBe('empty')
    expect(root.querySelector('.hc-recipe-prose')?.textContent).toBe('Nothing is written here yet.')
    expect(root.querySelector('.hc-recipe-nav')?.hasAttribute('hidden')).toBe(true)
    button(must(root.querySelector('.hc-recipe-page'), 'page'), 'Start writing')?.click()
    expect(page.mode()).toBe('write')
    expect(onMode).toHaveBeenCalledWith('write')
  })

  it('makes an anchor of an http or https link only, whatever the document says', () => {
    const recipe = { values: { links: { kind: 'links', links: [
      { url: 'javascript:alert(1)', label: 'Click me' },
      { url: 'https://vimeo.com/1' },
    ] } } } as RecipeDocument
    const { root } = mount({ recipe, mode: 'read' })
    key(document.body, 'ArrowRight')
    const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a')]
    expect(anchors).toHaveLength(1)
    expect(anchors[0].getAttribute('href')).toBe('https://vimeo.com/1')
    expect(root.querySelector('.hc-recipe-links')?.textContent).toContain('Click me')
    expect(root.querySelector('.hc-recipe-links .hc-recipe-tag')?.textContent).toBe('video')
    expect(root.querySelector('iframe, video, embed, object')).toBeNull()
  })

  it('a visitor reads and cannot edit: no editing chrome at all', async () => {
    const onToggleShared = vi.fn()
    const tiles: RecipeTileRow[] = [{ label: 'onion-soup', hasRecipe: true, current: true }]
    const { root, page, onChange, takePictures } = mount({ recipe: SOUP, readOnly: true, mode: 'write', tiles, shared: { lit: true, words: 'Lit' }, onToggleShared })
    expect(page.mode()).toBe('read')
    expect(root.querySelector('.hc-recipe-switch')?.hasAttribute('hidden')).toBe(true)
    expect(root.querySelector('.hc-recipe-more')?.hasAttribute('hidden')).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-done')?.hidden).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-shared')?.hidden).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-list')?.hidden).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-stage')?.hidden).toBe(true)
    expect(root.querySelector('.hc-recipe-action')).toBeNull()
    page.setMode('write')
    expect(page.mode()).toBe('read')
    expect(root.querySelector('textarea, .hc-recipe-card, .hc-recipe-tab')).toBeNull()
    page.setTiles(tiles)
    expect(root.querySelector('.hc-recipe-list-row')).toBeNull()
    // A pasted picture is swallowed, so no tile is made behind the desk, and nothing is stored.
    const { event } = paste(document.body, { files: [png()] })
    expect(event.defaultPrevented).toBe(true)
    await settle()
    expect(takePictures).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a picture pasted while reading joins the pictures and the page is shown again', async () => {
    const { root, onChange } = mount({ recipe: SOUP, mode: 'read' })
    paste(document.body, { files: [png()] })
    await settle()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_A, SIG_C] })
    expect(root.querySelector('.hc-recipe-position')?.textContent).toBe('1 of 7')
  })
})

describe('the recipe desk, its header and its list', () => {
  it('Escape closes the desk, and stops there', () => {
    const { onClose } = mount()
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    const event = key(document.body, 'Escape')
    window.removeEventListener('keydown', behind)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(behind).not.toHaveBeenCalled()
  })

  it('Escape is a ladder: the card, then the arranging, then the desk', () => {
    const { root, onClose } = mount({ recipe: SOUP })
    const story = openCard(root, 'story')
    key(at(story, '0:text'), 'Escape')
    expect(shownCards(root)).toEqual([])
    expect(onClose).not.toHaveBeenCalled()

    button(must(root.querySelector('.hc-recipe-menu'), 'menu'), 'Arrange')?.click()
    expect(root.classList.contains('is-arranging')).toBe(true)
    key(at(root, 'name'), 'Escape')
    expect(root.classList.contains('is-arranging')).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    // Focus was in the field that left with the arranging: it goes back to the button that opened it.
    expect(document.activeElement).toBe(root.querySelector('.hc-recipe-more > button'))

    key(tab(root, 'story'), 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape leaves the menu and the drawer before anything else', () => {
    const { root, page, onClose } = mount({ tiles: [{ label: 'soup', hasRecipe: true, current: true }, { label: 'cake', hasRecipe: false, current: false }] })
    const more = must(root.querySelector<HTMLButtonElement>('.hc-recipe-more > button'), 'more')
    const menu = must(root.querySelector<HTMLElement>('.hc-recipe-menu'), 'menu')
    openCard(root, 'story')
    more.click()
    expect(menu.hidden).toBe(false)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    key(must(menu.querySelector('button'), 'item'), 'Escape')
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(more)
    // The card behind the menu is still open: one rung a press.
    expect(shownCards(root)).toEqual(['story'])

    const toggle = must(root.querySelector<HTMLButtonElement>('.hc-recipe-drawer-toggle'), 'drawer toggle')
    toggle.click()
    expect(root.hasAttribute('data-drawer')).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(root.querySelector('.hc-recipe-list-row[aria-current="true"]'))
    key(document.activeElement ?? document.body, 'Escape')
    expect(root.hasAttribute('data-drawer')).toBe(false)
    expect(document.activeElement).toBe(toggle)
    expect(shownCards(root)).toEqual(['story'])
    expect(onClose).not.toHaveBeenCalled()
    // A press outside the menu closes it.
    more.click()
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.hidden).toBe(true)
    page.setTiles([])
    expect(toggle.hidden).toBe(true)
  })

  it('leaves Escape and pastes alone while the picker is over it', () => {
    const { onClose, takePictures } = mount()
    const picker = document.createElement('div')
    picker.className = 'hc-recipe-picker'
    document.body.append(picker)
    expect(key(document.body, 'Escape').defaultPrevented).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    expect(paste(document.body, { files: [png()] }).event.defaultPrevented).toBe(false)
    expect(takePictures).not.toHaveBeenCalled()
  })

  it('its buttons ask the caller, and the quiet actions are there only when they can do something', () => {
    const onKeepTemplate = vi.fn()
    const onEditTile = vi.fn()
    const { root, onPickTemplate, onClose } = mount({ onKeepTemplate, onEditTile })
    root.querySelector<HTMLButtonElement>('.hc-recipe-template')?.click()
    expect(onPickTemplate).toHaveBeenCalledTimes(1)
    expect(root.querySelector('.hc-recipe-template')?.getAttribute('aria-label')).toBe('Template: Family recipe. Choose another')
    const names = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-menu button')].map(each => each.textContent)
    expect(names).toEqual(['Arrange', 'Keep as a template', 'Edit tile'])
    const menu = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-menu button')]
    menu[1].click()
    menu[2].click()
    expect(onKeepTemplate).toHaveBeenCalledTimes(1)
    expect(onEditTile).toHaveBeenCalledTimes(1)
    // One filled button, and it closes the desk.
    const filled = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-head .hc-recipe-btn.is-solid')].filter(each => !each.hidden)
    expect(filled.map(each => each.textContent)).toEqual(['Done'])
    filled[0].click()
    expect(onClose).toHaveBeenCalledTimes(1)

    const plain = mount()
    expect([...plain.root.querySelectorAll('.hc-recipe-menu button')].map(each => each.textContent)).toEqual(['Arrange'])
    expect(plain.root.querySelector<HTMLElement>('.hc-recipe-browse')?.hidden).toBe(true)
    expect(plain.root.querySelector<HTMLElement>('.hc-recipe-shared')?.hidden).toBe(true)
    expect(plain.root.querySelector<HTMLElement>('.hc-recipe-list')?.hidden).toBe(true)
    expect(plain.root.querySelector<HTMLElement>('.hc-recipe-address')?.hidden).toBe(true)
  })

  it('the light bulb says where the recipe is offered, and asks the caller to light or unlight it', () => {
    const onToggleShared = vi.fn()
    const { root, page } = mount({ shared: { lit: false, words: 'Only you' }, onToggleShared })
    const bulb = must(root.querySelector<HTMLButtonElement>('.hc-recipe-bulb'), 'bulb')
    const words = must(root.querySelector<HTMLElement>('.hc-recipe-shared-words'), 'words')
    expect(root.querySelector<HTMLElement>('.hc-recipe-shared')?.hidden).toBe(false)
    expect(bulb.getAttribute('aria-pressed')).toBe('false')
    expect(bulb.getAttribute('aria-label')).toBe('Offer this recipe')
    expect(bulb.getAttribute('aria-describedby')).toBe(words.id)
    expect(bulb.querySelector('svg')).not.toBeNull()
    expect(words.textContent).toBe('Only you')
    expect(words.dataset['tone']).toBe('plain')
    bulb.click()
    expect(onToggleShared).toHaveBeenCalledTimes(1)
    // The desk shows what it is told: the press alone lights nothing.
    expect(bulb.getAttribute('aria-pressed')).toBe('false')
    page.setShared({ lit: true, words: 'Lit: offered at example.org', tone: 'good' })
    expect(bulb.getAttribute('aria-pressed')).toBe('true')
    expect(words.textContent).toBe('Lit: offered at example.org')
    expect(words.dataset['tone']).toBe('good')
    page.setShared({ lit: true, words: 'No host answers', tone: 'warn' })
    expect(words.dataset['tone']).toBe('warn')
    page.setShared(undefined)
    expect(root.querySelector<HTMLElement>('.hc-recipe-shared')?.hidden).toBe(true)
    // With nobody to ask, the bulb only shows.
    expect(must(mount({ shared: { lit: true, words: 'Lit' } }).root.querySelector<HTMLButtonElement>('.hc-recipe-bulb'), 'bulb').disabled).toBe(true)
  })

  it('"Browse" asks the caller, from the header and from the menu', () => {
    const onBrowse = vi.fn()
    const { root } = mount({ onBrowse })
    const browse = must(root.querySelector<HTMLButtonElement>('.hc-recipe-browse'), 'browse')
    expect(browse.hidden).toBe(false)
    expect(browse.textContent).toBe('Browse')
    browse.click()
    expect(onBrowse).toHaveBeenCalledTimes(1)
    // On a narrow desk the same word is offered in the menu.
    const item = must(root.querySelector<HTMLButtonElement>('.hc-recipe-menu .is-narrow-only'), 'menu item')
    expect(item.textContent).toBe('Browse')
    item.click()
    expect(onBrowse).toHaveBeenCalledTimes(2)
    // A visitor may browse too: it changes nothing.
    const visitor = mount({ readOnly: true, onBrowse })
    expect(visitor.root.querySelector<HTMLElement>('.hc-recipe-browse')?.hidden).toBe(false)
  })

  it('lists the tiles of the page, marks the current one and the ones holding a recipe, and asks for the one chosen', () => {
    const onPickTile = vi.fn()
    const tiles: RecipeTileRow[] = [
      { label: 'sunday-soup', hasRecipe: true, current: true },
      { label: 'flatbread', hasRecipe: false, current: false },
      { label: 'lemon-cake', hasRecipe: true, current: false },
    ]
    const { root, page } = mount({ tiles, onPickTile })
    const list = must(root.querySelector<HTMLElement>('.hc-recipe-list'), 'list')
    expect(list.hidden).toBe(false)
    expect(list.querySelector('.hc-recipe-list-head')?.textContent).toBe('Hive')
    const rows = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-list-row')]
    expect(rows().map(row => row.querySelector('.hc-recipe-list-name')?.textContent)).toEqual(['sunday-soup', 'flatbread', 'lemon-cake'])
    expect(rows().map(row => row.querySelector('.hc-recipe-list-plate')?.textContent)).toEqual(['s', 'f', 'l'])
    expect(rows().map(row => row.getAttribute('aria-current'))).toEqual(['true', null, null])
    expect(rows().map(row => row.querySelector('.hc-recipe-list-mark') !== null)).toEqual([true, false, true])
    expect(rows()[2].getAttribute('aria-label')).toBe('lemon-cake: holds a recipe')
    rows()[1].click()
    expect(onPickTile).toHaveBeenCalledWith('flatbread')
    // The row the cook is on is where they are: choosing it asks for nothing.
    rows()[0].click()
    expect(onPickTile).toHaveBeenCalledTimes(1)

    rows()[2].focus()
    page.setTiles([{ label: 'flatbread', hasRecipe: true, current: false }, { label: 'lemon-cake', hasRecipe: true, current: true }])
    expect(rows().map(row => row.dataset['label'])).toEqual(['flatbread', 'lemon-cake'])
    expect(rows()[1].getAttribute('aria-current')).toBe('true')
    expect(rows()[0].querySelector('.hc-recipe-list-mark')).not.toBeNull()
    // The rows were redrawn: focus is on the same tile.
    expect(document.activeElement).toBe(rows()[1])
    page.setTiles([])
    expect(list.hidden).toBe(true)
    expect(rows()).toEqual([])
  })

  it('shows the address after the title, and takes another', () => {
    const { root, page } = mount({ address: '/recipes/onion-soup' })
    const address = must(root.querySelector<HTMLElement>('.hc-recipe-address'), 'address')
    expect(address.hidden).toBe(false)
    expect(address.textContent).toBe('/recipes/onion-soup')
    expect(root.querySelector('.hc-recipe-title')?.nextElementSibling).toBe(address)
    page.setAddress('/soups/onion')
    expect(address.textContent).toBe('/soups/onion')
    page.setAddress('')
    expect(address.hidden).toBe(true)
  })

  it('a read-only page offers one filled action, and a way out', () => {
    const onPress = vi.fn()
    const { root, onClose } = mount({ recipe: SOUP, readOnly: true, primaryAction: { label: 'Bring it to my hive', onPress } })
    const filled = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-head .hc-recipe-btn.is-solid')].filter(each => !each.hidden)
    expect(filled.map(each => each.textContent)).toEqual(['Bring it to my hive'])
    filled[0].click()
    expect(onPress).toHaveBeenCalledTimes(1)
    const close = must(root.querySelector<HTMLButtonElement>('.hc-recipe-close'), 'close')
    expect(close.hidden).toBe(false)
    expect(close.getAttribute('aria-label')).toBe('Close the recipe')
    close.click()
    expect(onClose).toHaveBeenCalledTimes(1)
    // A cook's page has no such action, even when one is handed in, and no second way out.
    const cook = mount({ primaryAction: { label: 'Bring it to my hive', onPress } })
    expect(cook.root.querySelector('.hc-recipe-action')).toBeNull()
    expect(cook.root.querySelector<HTMLElement>('.hc-recipe-close')?.hidden).toBe(true)
  })

  it('every button that shows only a mark says what it does', () => {
    const tiles: RecipeTileRow[] = [{ label: 'onion-soup', hasRecipe: true, current: true }]
    const { root, page } = mount({ recipe: SOUP, tiles, shared: { lit: true, words: 'Lit' }, onToggleShared: () => {}, clipboardPictures: async () => [] })
    const unnamed = (): Element[] => [...root.querySelectorAll('button')].filter(each => !each.textContent?.trim() && !each.getAttribute('aria-label'))
    expect(unnamed()).toEqual([])
    openCard(root, 'steps')
    expect(unnamed()).toEqual([])
    button(root, 'Arrange')?.click()
    expect(unnamed()).toEqual([])
    page.setMode('read')
    expect(unnamed()).toEqual([])
    for (const img of root.querySelectorAll('img')) expect(img.getAttribute('alt')).toBeTruthy()
    // Everything drawn is hidden from a reader: the controls name themselves.
    for (const svg of root.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows a status, a title and the words its caller gives, and takes itself down', () => {
    const words = vi.fn((wanted: string, fallback: string) => (wanted === 'recipe.write' ? 'Schreiben' : wanted === 'recipe.read' ? wanted : fallback))
    const { root, page, onClose } = mount({ say: words, recipe: SOUP })
    const [write, read] = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-switch button')]
    expect(write.textContent).toBe('Schreiben')
    // A catalogue that echoes the key back gets the English.
    expect(read.textContent).toBe('Read along')
    page.setStatus('Saved', 'good')
    expect(root.querySelector('.hc-recipe-status')?.textContent).toBe('Saved')
    expect(root.querySelector('.hc-recipe-status')?.classList.contains('is-good')).toBe(true)
    page.setStatus('Could not save: the disk is full', 'bad')
    expect(root.querySelector('.hc-recipe-status')?.className).toBe('hc-recipe-status is-bad')
    page.setTitle('French onion soup')
    expect(root.querySelector('.hc-recipe-title')?.textContent).toBe('French onion soup')
    expect(root.querySelector<HTMLImageElement>('.hc-recipe-dish img')?.alt).toBe('Cover picture of French onion soup')
    page.dispose()
    expect(root.isConnected).toBe(false)
    // Taken down, it no longer listens on the document.
    key(document.body, 'Escape')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('the recipe desk, another recipe on the same desk', () => {
  const OTHER: RecipeDocument = {
    values: {
      story: { kind: 'text', text: 'Another dish altogether.' },
      ingredients: { kind: 'ingredients', items: [{ amount: '2', item: 'onions' }] },
      steps: { kind: 'steps', steps: [{ text: 'Knead.' }, { text: 'Rest.' }] },
    },
  }
  const status = (root: HTMLElement): HTMLElement => must(root.querySelector<HTMLElement>('.hc-recipe-status'), 'status')
  const pageKind = (root: HTMLElement): string | undefined => root.querySelector<HTMLElement>('.hc-recipe-page')?.dataset['page']
  /** A store that answers when the spec says so: the cook can do something else while it works. */
  const slowStore = () => {
    const waiting: ((sigs: readonly string[]) => void)[] = []
    const takePictures = vi.fn((_files: readonly Blob[]) => new Promise<readonly string[]>(resolve => { waiting.push(resolve) }))
    /** Answer the oldest intake still being stored. */
    return { takePictures, answer: (sigs: readonly string[]): void => { waiting.shift()?.(sigs) } }
  }

  it('pictures still being stored when another recipe takes the desk are not put in it, and the desk says so', async () => {
    const store = slowStore()
    const { root, page, onChange } = mount({ recipe: SOUP, takePictures: store.takePictures })
    paste(root, { files: [png()] })
    expect(status(root).textContent).toBe('Adding pictures')
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure-note')?.hidden).toBe(false)

    page.setRecipe(OTHER, { fresh: true })
    // Nothing is being added to the recipe now shown.
    expect(status(root).textContent).toBe('')
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure-note')?.hidden).toBe(true)
    expect(root.querySelector('.is-storing')).toBeNull()

    store.answer([SIG_C])
    await settle()
    expect(page.recipe().values).toEqual(OTHER.values)
    expect(onChange).not.toHaveBeenCalled()
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure')?.dataset['state']).toBe('empty')
    expect(status(root).textContent).toBe('The picture you were adding to the recipe you left was not added to it. Add it again there.')
    expect(status(root).classList.contains('is-bad')).toBe(true)
  })

  it('a picture being stored for a step of the recipe that left lands on no step and with no pictures', async () => {
    const store = slowStore()
    const { root, page, onChange } = mount({ recipe: SOUP, takePictures: store.takePictures })
    const steps = openCard(root, 'steps')
    at<HTMLTextAreaElement>(steps, '0:text').focus()
    paste(at(steps, '0:text'), { files: [png(), png('b.png')] })
    page.setRecipe(OTHER, { fresh: true })
    store.answer([SIG_C, SIG_B])
    await settle()
    expect(page.recipe().values).toEqual(OTHER.values)
    expect(onChange).not.toHaveBeenCalled()
    expect(status(root).textContent).toBe('The pictures you were adding to the recipe you left were not added to it. Add them again there.')
  })

  it('the same recipe shown again keeps the pictures being stored for it', async () => {
    const store = slowStore()
    const { root, page, onChange } = mount({ recipe: SOUP, takePictures: store.takePictures })
    paste(root, { files: [png()] })
    // A save echoed back while the store works: the same recipe, so the pictures are still its own.
    page.setRecipe(page.recipe())
    store.answer([SIG_C])
    await settle()
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A] })
    expect(status(root).textContent).toBe('')
  })

  it('pictures chosen for the recipe now shown are its own, whatever was dropped before', async () => {
    const store = slowStore()
    const { root, page, onChange } = mount({ recipe: SOUP, takePictures: store.takePictures })
    paste(root, { files: [png()] })
    page.setRecipe(OTHER, { fresh: true })
    paste(root, { files: [png('b.png')] })
    // The one chosen for the recipe that left answers first, then the one chosen here.
    store.answer([SIG_C])
    store.answer([SIG_B])
    await settle()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(page.recipe().values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_B] })
  })

  it('says when every picture has landed, so a caller can wait before the desk is handed on', async () => {
    const store = slowStore()
    const { root, page, onChange } = mount({ recipe: SOUP, takePictures: store.takePictures })
    await page.settled()
    paste(root, { files: [png()] })
    let landed = false
    const waited = page.settled().then(() => { landed = true })
    await settle()
    expect(landed).toBe(false)
    store.answer([SIG_C])
    await waited
    expect(last(onChange).values['pictures']).toEqual({ kind: 'pictures', pictures: [SIG_C, SIG_A] })
  })

  it('another recipe is read along from its first page, with nothing ticked', () => {
    const { root, page } = mount({ recipe: SOUP, mode: 'read' })
    key(document.body, 'ArrowRight')
    key(document.body, 'ArrowRight')
    expect(pageKind(root)).toBe('ingredients')
    must(root.querySelector<HTMLInputElement>('.hc-recipe-check input'), 'tick').click()
    // The same recipe shown again: the cook keeps the page and the ticks.
    page.setRecipe(page.recipe())
    expect(pageKind(root)).toBe('ingredients')
    expect(root.querySelector<HTMLInputElement>('.hc-recipe-check input')?.checked).toBe(true)

    const scroll = must(root.querySelector<HTMLElement>('.hc-recipe-scroll'), 'scroll')
    scroll.scrollTop = 120
    page.setRecipe(OTHER, { fresh: true })
    expect(pageKind(root)).toBe('cover')
    expect(root.querySelector('.hc-recipe-position')?.textContent).toBe('1 of 5')
    expect(button(root, 'Previous')?.disabled).toBe(true)
    expect(scroll.scrollTop).toBe(0)
    key(document.body, 'ArrowRight')
    key(document.body, 'ArrowRight')
    // The same ingredient at the same place in another recipe is not ticked off.
    expect(pageKind(root)).toBe('ingredients')
    expect(root.querySelector<HTMLInputElement>('.hc-recipe-check input')?.checked).toBe(false)
  })

  it('another recipe opens as the drawing: the card that was open belonged to the one that left', () => {
    const { root, page, onChange } = mount({ recipe: SOUP })
    openCard(root, 'story')
    page.setRecipe(OTHER, { fresh: true })
    expect(shownCards(root)).toEqual([])
    expect(root.dataset['open']).toBeUndefined()
    expect(root.querySelector<HTMLElement>('.hc-recipe-veil')?.hidden).toBe(true)
    expect(summary(root, 'story')).toBe('Another dish altogether.')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('the recipe desk, measuring itself', () => {
  type Watch = () => void
  const watchers: Watch[] = []

  /**
   * A desk as a browser lays it out: its own box is what it is given, and the
   * room under its header follows the layout drawn, because the header is
   * taller in one layout than in the other.
   */
  const measured = (over: Partial<RecipePageOptions>, size: { width: number; height: number; head: { wide: number; narrow: number } }) => {
    vi.stubGlobal('ResizeObserver', class {
      readonly #heard: Watch
      constructor(heard: Watch) { this.#heard = heard; watchers.push(heard) }
      observe(): void { /* the spec delivers */ }
      disconnect(): void { watchers.splice(watchers.indexOf(this.#heard), 1) }
    })
    const made = mount(over)
    const body = must(made.root.querySelector<HTMLElement>('.hc-recipe-body'), 'body')
    Object.defineProperty(made.root, 'clientWidth', { configurable: true, get: () => size.width })
    Object.defineProperty(made.root, 'clientHeight', { configurable: true, get: () => size.height })
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => size.height - size.head[made.root.dataset['layout'] === 'narrow' ? 'narrow' : 'wide'] })
    /** Deliver as a browser does: again for as long as the last callback changed a box it watches. Answers the layout after each. */
    const deliver = (most = 12): (string | undefined)[] => {
      const seen: (string | undefined)[] = []
      let before = Number.NaN
      while (seen.length < most && body.clientHeight !== before) {
        before = body.clientHeight
        for (const heard of [...watchers]) heard()
        seen.push(made.root.dataset['layout'])
      }
      return seen
    }
    return { ...made, size, deliver }
  }

  afterEach(() => {
    watchers.length = 0
    vi.unstubAllGlobals()
  })

  // The sizes a real desk was seen turning at, sixty times a second: a header of two lines when wide, of one when narrow.
  const WRAPPING = { wide: 72, narrow: 56 }
  const tiles: RecipeTileRow[] = [{ label: 'sunday-chicken-soup', hasRecipe: true, current: true }]

  it('settles within two callbacks where the plate rests on its least size', () => {
    const { root, deliver } = measured({ recipe: SOUP, tiles }, { width: 1000, height: 487, head: WRAPPING })
    const seen = deliver()
    expect(seen.length).toBeLessThanOrEqual(2)
    expect(root.dataset['layout']).toBe('wide')
    // Asked again, it answers the same.
    expect(deliver()).toEqual(['wide'])
  })

  it('settles within two callbacks where a column rests on the last row the height holds', () => {
    const { root, deliver } = measured({ recipe: withIngredients(12), tiles }, { width: 1000, height: 526, head: WRAPPING })
    expect(root.style.getPropertyValue('--hc-recipe-rows')).toBe('22')
    const seen = deliver()
    expect(seen.length).toBeLessThanOrEqual(2)
    expect(deliver()).toEqual([seen[seen.length - 1]])
  })

  it('settles at every height around both thresholds, whichever header is the taller', () => {
    for (const head of [WRAPPING, { wide: 44, narrow: 96 }]) {
      const { page, size, deliver } = measured({ recipe: withIngredients(12), tiles }, { width: 1000, height: 460, head })
      // A window dragged taller through both thresholds, then shorter again.
      const heights = Array.from({ length: 41 }, (_, n) => 460 + n * 2)
      for (const height of [...heights, ...heights.reverse()]) {
        size.height = height
        expect(deliver().length, `height ${height}, header ${head.wide}/${head.narrow}`).toBeLessThanOrEqual(2)
      }
      page.dispose()
    }
  })

  it('still follows the desk across the threshold, and turns wide again only with room to spare', () => {
    const { root, size, deliver } = measured({ recipe: SOUP }, { width: 1000, height: 600, head: WRAPPING })
    const at = (height: number): string | undefined => {
      size.height = height
      // The desk's own box changed: the browser delivers at least once.
      for (const heard of [...watchers]) heard()
      deliver()
      return root.dataset['layout']
    }
    expect(at(600)).toBe('wide')
    expect(at(460)).toBe('narrow')
    // 470 has the room for a wide desk, barely: a narrow desk stays as it is.
    expect(at(470)).toBe('narrow')
    expect(at(490)).toBe('wide')
    // And a wide desk keeps to wide at the same 470.
    expect(at(470)).toBe('wide')
    expect(at(460)).toBe('narrow')
  })

  it('the wide header is one line: only the narrow one wraps', () => {
    mount()
    const css = document.getElementById(RECIPE_STYLE_ID)?.textContent ?? ''
    const rule = (selector: string): string => css.split('\n').find(line => line.startsWith(`${selector}{`)) ?? ''
    // Its one line is the header the desk's arithmetic takes off the desk's height.
    expect(rule('.hc-recipe-head')).toContain(`min-height:${RECIPE_DESK.headEm}em;`)
    expect(rule('.hc-recipe-head')).not.toContain('flex-wrap')
    expect(rule('.hc-recipe[data-layout="narrow"] .hc-recipe-head')).toContain('flex-wrap:wrap')
  })
})

describe('the recipe desk, a page that only reads', () => {
  const reading = (over: { onPickTemplate?: () => void } = {}): { page: RecipePageHandle; root: HTMLElement; onClose: ReturnType<typeof vi.fn<() => void>> } => {
    const onClose = vi.fn<() => void>()
    // No onChange, no onLayout, no takePictures: a page that only reads asks for none of them.
    const page = recipePage({
      title: 'Onion soup',
      recipe: SOUP,
      template: RECIPE_TEMPLATE_FAMILY,
      readOnly: true,
      say,
      pictureUrl: sig => `blob:local/${sig.slice(0, 4)}`,
      onClose,
      ...over,
    })
    document.body.append(page.element)
    open.push(page)
    return { page, root: page.element, onClose }
  }

  it('is made without the callbacks of a page that is written on, and reads along all the same', async () => {
    const { page, root, onClose } = reading()
    expect(page.mode()).toBe('read')
    expect(root.querySelector('.hc-recipe-cover-title')?.textContent).toBe('Onion soup')
    key(document.body, 'ArrowRight')
    expect(root.querySelector('.hc-recipe-position')?.textContent).toBe('2 of 6')
    // A picture pasted or dropped on it is swallowed and stored nowhere.
    expect(paste(document.body, { files: [png()] }).event.defaultPrevented).toBe(true)
    drop(root, [png()])
    await settle()
    expect(page.recipe().values).toEqual(SOUP.values)
    page.setTemplate(RECIPE_TEMPLATE_WEEKNIGHT)
    page.setRecipe({ values: {} }, { fresh: true })
    expect(root.querySelector('.hc-recipe-prose')?.textContent).toBe('Nothing is written here yet.')
    must(root.querySelector<HTMLButtonElement>('.hc-recipe-close'), 'close').click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('draws no template button when there is nothing to pick', () => {
    expect(reading().root.querySelector('.hc-recipe-template')).toBeNull()
    // Handed a way to pick, a page that only reads still offers it.
    const onPickTemplate = vi.fn()
    const picking = reading({ onPickTemplate })
    must(picking.root.querySelector<HTMLButtonElement>('.hc-recipe-template'), 'template').click()
    expect(onPickTemplate).toHaveBeenCalledTimes(1)
  })

  it('a page that is written on draws no template button either, without a way to pick', () => {
    const page = recipePage({
      title: 'Onion soup',
      recipe: { values: {} },
      template: RECIPE_TEMPLATE_FAMILY,
      say,
      pictureUrl: () => '',
      onChange: () => undefined,
      onLayout: () => undefined,
      takePictures: async () => [],
      onClose: () => undefined,
    })
    open.push(page)
    expect(page.element.querySelector('.hc-recipe-template')).toBeNull()
    expect(page.element.querySelector('.hc-recipe-switch')).not.toBeNull()
    // Arranging still names the layout: the field is the arrangement's own.
    button(page.element, 'Arrange')?.click()
    expect(page.element.querySelector<HTMLElement>('[data-at="name"]')?.hidden).toBe(false)
  })

  it('a page that is written on must still be given its callbacks', () => {
    const shared = { title: 'Onion soup', recipe: SOUP, template: RECIPE_TEMPLATE_FAMILY, say, pictureUrl: () => '', onClose: () => undefined }
    // @ts-expect-error a page that is written on needs onChange, onLayout and takePictures
    const writing: RecipePageOptions = { ...shared }
    // @ts-expect-error leaving them out is for `readOnly: true` only, never for a page that may be written on
    const either: RecipePageOptions = { ...shared, readOnly: false }
    const only: RecipePageOptions = { ...shared, readOnly: true }
    expect([writing, either, only]).toHaveLength(3)
  })
})

describe('the recipe desk on a table set', () => {
  /** The set rendered on 2026-11-25 (tableware/setting.py), its pictures under signatures of their own. */
  const SET: RecipeSettingDocument = {
    name: 'Slate, four plates',
    size: [1800, 1200],
    table: '1'.repeat(64),
    utensils: '6'.repeat(64),
    plates: [
      { id: 'ash', glaze: 'ash', layer: '2'.repeat(64), floor: recipeReadingFloor([[646.1, 206.4], [1007.1, 438.0], [1139.0, 306.0], [781.5, 87.6]]), centre: [889.7, 255.6] },
      { id: 'shino', glaze: 'shino', layer: '3'.repeat(64), floor: recipeReadingFloor([[1159.2, 616.7], [1632.5, 759.1], [1673.1, 612.0], [1212.9, 478.2]]), centre: [1416.3, 614.3] },
      { id: 'kuro', glaze: 'kuro', layer: '4'.repeat(64), floor: recipeReadingFloor([[211.8, 402.0], [498.6, 685.8], [641.1, 581.7], [351.8, 310.1]]), centre: [422.1, 490.1] },
      { id: 'tenmoku', glaze: 'tenmoku', layer: '5'.repeat(64), floor: recipeReadingFloor([[727.1, 778.6], [1042.2, 1143.0], [1215.8, 1016.0], [895.9, 668.8]]), centre: [965.5, 894.4] },
    ],
  }
  const table = () => ({ open: vi.fn(), choose: vi.fn(), add: vi.fn(), remove: vi.fn() })
  const onSet = (over: Partial<RecipePageOptions> = {}) => mount({ setting: SET, ...over })
  const cards = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.hc-recipe-placecard')]
  const plate = (root: HTMLElement, id: string): SVGPolygonElement => must(root.querySelector<SVGPolygonElement>(`.hc-recipe-set-plate[data-plate="${id}"]`), `plate ${id}`)
  const layers = (root: HTMLElement): string[] => [...root.querySelectorAll<Element>('.hc-recipe-set-canvas > *')].map(node => node.getAttribute('class') ?? '')
  /** The figure where a browser would lay it: its top-left at (100, 50) of the stage, drawn at half the picture's size. */
  const placed = (root: HTMLElement): void => {
    const figure = must(root.querySelector<HTMLElement>('.hc-recipe-figure'), 'figure')
    for (const [name, value] of [['offsetLeft', 100], ['offsetTop', 50], ['offsetWidth', 900], ['offsetHeight', 600]] as const) {
      Object.defineProperty(figure, name, { configurable: true, get: () => value })
    }
  }
  /** A leader's dot, back in the picture's own px. */
  const dotOf = (root: HTMLElement, id: string): RecipeSettingPoint => {
    const circle = must(root.querySelector(`.hc-recipe-lead[data-id="${id}"] circle`), `the dot of ${id}`)
    return [(Number(circle.getAttribute('cx')) - 100) / 0.5, (Number(circle.getAttribute('cy')) - 50) / 0.5]
  }

  it('draws the set where the plate was: the table, each plate, the place cards, the utensils, and the plates to press', () => {
    const { root } = onSet()
    expect(root.hasAttribute('data-set')).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure')?.dataset['state']).toBe('set')
    expect(root.querySelector('.hc-recipe-set')?.hasAttribute('hidden')).toBe(false)
    expect(root.querySelector('.hc-recipe-plate')?.hasAttribute('hidden')).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-invite')?.hidden).toBe(true)
    expect(layers(root)).toEqual([
      'hc-recipe-set-layer is-table', 'hc-recipe-set-layer is-plate', 'hc-recipe-set-layer is-plate', 'hc-recipe-set-layer is-plate', 'hc-recipe-set-layer is-plate',
      'hc-recipe-set-cards', 'hc-recipe-set-layer is-utensils', 'hc-recipe-set-hits',
    ])
    // Every picture is the caller's to resolve, by signature: nothing is fetched from anywhere else.
    const srcs = [...root.querySelectorAll<HTMLImageElement>('.hc-recipe-set-layer')].map(img => img.getAttribute('src'))
    expect(srcs).toEqual(['1111', '2222', '3333', '4444', '5555', '6666'].map(head => `blob:local/${head}`))
    const canvas = must(root.querySelector<HTMLElement>('.hc-recipe-set-canvas'), 'canvas')
    expect([canvas.style.width, canvas.style.height]).toEqual(['1800px', '1200px'])
    expect(root.querySelector('.hc-recipe-set-hits')?.getAttribute('viewBox')).toBe('0 0 1800 1200')
  })

  it('sits the template\'s sections on the plates in order, each plate wearing a place card laid flat onto its floor', () => {
    const { root } = onSet({ recipe: SOUP })
    const ids = ['story', 'pictures', 'facts', 'ingredients'].map(key => tab(root, key).dataset['id'])
    expect(cards(root).map(card => [card.dataset['id'], card.dataset['plate']])).toEqual(ids.map((id, at) => [id, SET.plates[at].id]))
    const [story] = cards(root)
    expect(story.querySelector('.hc-recipe-placecard-label')?.textContent).toBe('The story')
    expect(story.querySelector('.hc-recipe-placecard-said')?.textContent).toBe(summary(root, 'story'))
    expect(story.style.transform).toMatch(/^matrix3d\(/)
    // The sections beyond the plates keep their tabs, and wear no card.
    for (const key of ['steps', 'experience', 'links']) expect(tab(root, key).isConnected).toBe(true)
    expect(cards(root)).toHaveLength(4)
  })

  it('a place card says what its section holds as it is typed', () => {
    const { root } = onSet()
    const field = must(openCard(root, 'story').querySelector<HTMLTextAreaElement>('textarea'), 'story field')
    type(field, 'Sundays at the long table.')
    expect(cards(root)[0].querySelector('.hc-recipe-placecard-said')?.textContent).toBe('Sundays at the long table.')
  })

  it('pressing a plate opens its section\'s card down the middle, as its tab does, and pressing it again closes it', () => {
    const { root } = onSet()
    plate(root, 'kuro').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(shownCards(root)).toEqual(['facts'])
    expect(tab(root, 'facts').getAttribute('aria-expanded')).toBe('true')
    plate(root, 'kuro').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(shownCards(root)).toEqual([])
  })

  it('hovering a plate lights it, its card, its tab and its leader together', () => {
    const { root, page } = onSet()
    placed(root)
    page.setTiles([])
    plate(root, 'ash').dispatchEvent(new Event('pointerover', { bubbles: true }))
    const id = tab(root, 'story').dataset['id'] ?? ''
    expect(tab(root, 'story').getAttribute('data-lit')).toBe('soft')
    expect(plate(root, 'ash').getAttribute('data-lit')).toBe('soft')
    expect(cards(root)[0].getAttribute('data-lit')).toBe('soft')
    expect(root.querySelector(`.hc-recipe-lead[data-id="${id}"]`)?.getAttribute('data-lit')).toBe('soft')
    expect(plate(root, 'shino').hasAttribute('data-lit')).toBe(false)
    // Focus on the tab lights the same things.
    root.querySelector('.hc-recipe-stage')?.dispatchEvent(new Event('pointerleave'))
    tab(root, 'pictures').focus()
    expect(plate(root, 'shino').getAttribute('data-lit')).toBe('soft')
  })

  it('runs a tab\'s leader to its plate\'s floor centre, and draws none for a section on no plate', () => {
    const { root, page } = onSet()
    placed(root)
    page.setTiles([])
    ;['story', 'pictures', 'facts', 'ingredients'].forEach((key, at) => {
      const [x, y] = dotOf(root, tab(root, key).dataset['id'] ?? '')
      expect(x).toBeCloseTo(SET.plates[at].centre[0], 0)
      expect(y).toBeCloseTo(SET.plates[at].centre[1], 0)
    })
    for (const key of ['steps', 'experience', 'links']) expect(leads(root)).not.toContain(tab(root, key).dataset['id'])
  })

  it('runs the ingredients\' labels to points spread over the ingredients\' own plate', () => {
    const { root, page } = onSet({ recipe: withIngredients(6) })
    placed(root)
    page.setTiles([])
    const heading = tab(root, 'ingredients').dataset['id'] ?? ''
    const labels = leads(root).filter(id => id.startsWith(`${heading}#`))
    expect(labels).toHaveLength(6)
    const dots = labels.map(id => dotOf(root, id))
    for (const dot of dots) expect(recipeFloorHolds(SET.plates[3].floor, dot)).toBe(true)
    expect(new Set(dots.map(dot => dot.map(Math.round).join(','))).size).toBe(6)
    // The heading of drawn ingredients has no leader of its own, as on the plate.
    expect(leads(root)).not.toContain(heading)
  })

  it('stands the drawn plate in again when a picture of the set does not arrive', () => {
    const { root } = onSet({ recipe: SOUP })
    root.querySelectorAll<HTMLImageElement>('.hc-recipe-set-layer')[2]?.dispatchEvent(new Event('error'))
    expect(root.hasAttribute('data-set')).toBe(false)
    expect(root.querySelector('.hc-recipe-set')?.hasAttribute('hidden')).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-figure')?.dataset['state']).toBe('picture')
    expect(cards(root)).toEqual([])
    // The plate's own leaders are back: every tab has one.
    expect(leads(root)).toContain(tab(root, 'links').dataset['id'])
  })

  it('says so in one sentence when a picture of the set does not arrive, and the Table control says the drawn plate stands in', () => {
    const { root } = onSet({ recipe: SOUP, table: table(), settings: { current: '9'.repeat(64), choices: [{ sig: '9'.repeat(64), name: SET.name, from: 'kept' }] } })
    const control = must(root.querySelector<HTMLButtonElement>('.hc-recipe-table'), 'the Table control')
    expect(control.getAttribute('aria-label')).toBe('Table set: Slate, four plates. Choose another')
    const layer = root.querySelectorAll<HTMLImageElement>('.hc-recipe-set-layer')
    layer[1]?.dispatchEvent(new Event('error'))
    // A second picture failing says nothing more.
    layer[3]?.dispatchEvent(new Event('error'))
    const status = must(root.querySelector<HTMLElement>('.hc-recipe-status'), 'status')
    expect(status.textContent).toBe('The pictures of the table set Slate, four plates did not arrive, so the drawn plate is shown.')
    expect(status.classList.contains('is-bad')).toBe(true)
    expect(control.getAttribute('aria-label')).toBe('Table set: Slate, four plates, its pictures did not arrive, so the drawn plate stands in. Choose it again to try again')
    expect(control.hasAttribute('data-broken')).toBe(true)
  })

  it("tries the set's pictures again when it is chosen again, and when the desk opens again", () => {
    const actions = table()
    const { root, page } = onSet({ recipe: SOUP, table: actions, settings: { current: '9'.repeat(64), choices: [{ sig: '9'.repeat(64), name: SET.name, from: 'kept' }] } })
    const control = must(root.querySelector<HTMLButtonElement>('.hc-recipe-table'), 'the Table control')
    const status = (): string => root.querySelector('.hc-recipe-status')?.textContent ?? ''
    const fail = (): void => { root.querySelectorAll<HTMLImageElement>('.hc-recipe-set-layer')[2]?.dispatchEvent(new Event('error')) }
    fail()
    expect(root.hasAttribute('data-set')).toBe(false)
    // Chosen again from the Table control: the same set, tried again here, so nothing is chosen anew.
    control.click()
    button(must(root.querySelector('.hc-recipe-table-menu'), 'menu'), SET.name)?.click()
    expect(actions.choose).not.toHaveBeenCalled()
    expect(root.hasAttribute('data-set')).toBe(true)
    expect(cards(root)).toHaveLength(4)
    expect(status()).toBe('')
    expect(control.getAttribute('aria-label')).toBe('Table set: Slate, four plates. Choose another')
    // A picture of the last try that fails late is not this try's.
    const stale = root.querySelectorAll<HTMLImageElement>('.hc-recipe-set-layer')[0]
    fail()
    expect(root.hasAttribute('data-set')).toBe(false)
    // The desk opens again on another recipe: the set is tried once more.
    page.setRecipe(SOUP, { fresh: true })
    expect(root.hasAttribute('data-set')).toBe(true)
    expect(status()).toBe('')
    stale?.dispatchEvent(new Event('error'))
    expect(root.hasAttribute('data-set')).toBe(true)
  })

  it('is the drawn plate as before when no set is chosen, and again when the set is taken away', () => {
    const plain = mount()
    expect(plain.root.hasAttribute('data-set')).toBe(false)
    expect(plain.root.querySelector('.hc-recipe-set')?.hasAttribute('hidden')).toBe(true)
    expect(plain.root.querySelector('.hc-recipe-table-wrap')).toBeNull()
    const { root, page } = onSet()
    page.setSetting(null)
    expect(root.hasAttribute('data-set')).toBe(false)
    expect(root.querySelector('.hc-recipe-plate')?.hasAttribute('hidden')).toBe(false)
    expect(cards(root)).toEqual([])
    page.setSetting(SET)
    expect(root.hasAttribute('data-set')).toBe(true)
    expect(cards(root)).toHaveLength(4)
  })

  it('fits the set where the plate was, and on a phone at full width with the tabs under it', () => {
    const { root, page } = onSet()
    const sized = (width: number, height: number): void => {
      Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => width })
      Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => height })
      page.setTiles([])
    }
    sized(1400, 760)
    expect(root.dataset['layout']).toBe('wide')
    expect(root.style.getPropertyValue('--hc-recipe-figure-w')).toBe(`${RECIPE_DESK.setMax}px`)
    expect(root.querySelector<HTMLElement>('.hc-recipe-set-canvas')?.style.transform).toBe(`scale(${RECIPE_DESK.setMax / 1800})`)
    sized(390, 700)
    expect(root.dataset['layout']).toBe('narrow')
    expect(root.style.getPropertyValue('--hc-recipe-figure-w')).toBe('357px')
    expect(root.style.getPropertyValue('--hc-recipe-figure-h')).toBe('238px')
    // Narrow: no leaders, and the tabs are rows under the set, the cards still laid on its plates.
    expect(leads(root)).toEqual([])
    expect(cards(root)).toHaveLength(4)
    const rule = (selector: string): string => {
      const text = document.getElementById(RECIPE_STYLE_ID)?.textContent ?? ''
      const at = text.indexOf(`${selector}{`)
      return at < 0 ? '' : text.slice(at, text.indexOf('}', at))
    }
    expect(rule('.hc-recipe[data-set] .hc-recipe-figure')).toContain('width:var(--hc-recipe-figure-w')
  })

  it('leaves reading along as it is', () => {
    const { root, page } = onSet({ recipe: SOUP })
    page.setMode('read')
    expect(root.querySelector<HTMLElement>('.hc-recipe-stage')?.hidden).toBe(true)
    expect(root.querySelector<HTMLElement>('.hc-recipe-reader')?.hidden).toBe(false)
    expect(root.querySelector('.hc-recipe-reader .hc-recipe-placecard')).toBeNull()
    const visitor = mount({ readOnly: true, setting: SET, table: table() })
    expect(visitor.root.querySelector('.hc-recipe-table-wrap')).toBeNull()
  })

  describe('the Table control', () => {
    const MENU: RecipeSettingMenu = {
      current: '9'.repeat(64),
      choices: [
        { sig: '9'.repeat(64), name: 'Slate, four plates', from: 'kept' },
        { sig: '8'.repeat(64), name: 'Cedar, two bowls', from: 'community', host: 'friend.example' },
      ],
    }
    const control = (root: HTMLElement): HTMLButtonElement => must(root.querySelector<HTMLButtonElement>('.hc-recipe-table'), 'the Table control')
    const items = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('.hc-recipe-table-menu > *')].map(node => node.textContent ?? '')

    it('sits beside the template button and names the set the desk sits on', () => {
      const { root } = onSet({ table: table(), settings: MENU })
      expect(control(root).previousElementSibling?.classList.contains('hc-recipe-template') || control(root).parentElement?.previousElementSibling?.classList.contains('hc-recipe-template')).toBe(true)
      expect(control(root).getAttribute('aria-label')).toBe('Table set: Slate, four plates. Choose another')
      const plain = mount({ table: table() })
      expect(control(plain.root).getAttribute('aria-label')).toBe('Table set: none, the drawn plate. Choose one')
    })

    it('opens on the kept sets, what the domains offer, bringing one in, and the drawn plate, and asks its caller when it opens', () => {
      const actions = table()
      const { root } = onSet({ table: actions, settings: MENU })
      control(root).click()
      expect(actions.open).toHaveBeenCalledTimes(1)
      expect(items(root)).toEqual(['Your table sets', 'Slate, four plates', 'From your domains', 'Cedar, two bowlsfriend.example', '', 'Add a table set', 'The drawn plate'])
      expect(root.querySelector('.hc-recipe-table-menu [aria-checked="true"]')?.textContent).toBe('Slate, four plates')
      expect(document.activeElement?.textContent).toBe('Slate, four plates')
    })

    it('hands back the set chosen, or none for the drawn plate, and closes', () => {
      const actions = table()
      const { root } = onSet({ table: actions, settings: MENU })
      control(root).click()
      button(must(root.querySelector('.hc-recipe-table-menu'), 'menu'), 'Cedar, two bowlsfriend.example')?.click()
      expect(actions.choose).toHaveBeenLastCalledWith(MENU.choices[1])
      expect(root.querySelector<HTMLElement>('.hc-recipe-table-menu')?.hidden).toBe(true)
      control(root).click()
      button(must(root.querySelector('.hc-recipe-table-menu'), 'menu'), 'The drawn plate')?.click()
      expect(actions.choose).toHaveBeenLastCalledWith(null)
    })

    it('every kept set wears a remove press that hands it back to be taken off the list, and the offered ones wear none', () => {
      const actions = table()
      const { root } = onSet({ table: actions, settings: MENU })
      control(root).click()
      const forgets = [...root.querySelectorAll<HTMLButtonElement>('.hc-recipe-table-forget')]
      expect(forgets.map(each => each.getAttribute('aria-label'))).toEqual(['Take Slate, four plates off your table sets'])
      forgets[0]?.click()
      expect(actions.remove).toHaveBeenCalledWith(MENU.choices[0])
      expect(actions.choose).not.toHaveBeenCalled()
      expect(root.querySelector<HTMLElement>('.hc-recipe-table-menu')?.hidden).toBe(true)
      // A caller that cannot take sets off the list gets no remove press.
      const { choose, add } = table()
      const plain = onSet({ table: { choose, add }, settings: MENU })
      control(plain.root).click()
      expect(plain.root.querySelector('.hc-recipe-table-forget')).toBeNull()
    })

    it('"Add a table set" is a file chooser for the setting.json and its pictures, handed back as chosen', () => {
      const actions = table()
      const { root } = onSet({ table: actions })
      const chooser = must(root.querySelectorAll<HTMLInputElement>('input[type="file"]')[1] ?? null, 'the set chooser')
      expect(chooser.multiple).toBe(true)
      expect(chooser.accept).toContain('.json')
      expect(chooser.accept).toContain('image/webp')
      const picked = vi.spyOn(chooser, 'click').mockImplementation(() => undefined)
      control(root).click()
      button(must(root.querySelector('.hc-recipe-table-menu'), 'menu'), 'Add a table set')?.click()
      expect(picked).toHaveBeenCalledTimes(1)
      const files = [new File(['{}'], 'setting.json'), png('table.png')]
      Object.defineProperty(chooser, 'files', { configurable: true, value: files })
      chooser.dispatchEvent(new Event('change'))
      expect(actions.add).toHaveBeenCalledWith(files)
    })

    it('Escape closes the list before anything else, and the list keeps up while it is open', () => {
      const { root, page, onClose } = onSet({ table: table(), settings: { current: '', choices: [], asking: true } })
      control(root).click()
      expect(items(root)).toContain('Asking your domains')
      page.setSettings(MENU)
      expect(items(root)).not.toContain('Asking your domains')
      expect(items(root)).toContain('Cedar, two bowlsfriend.example')
      key(must(root.querySelector('.hc-recipe-table-menu button'), 'item'), 'Escape')
      expect(root.querySelector<HTMLElement>('.hc-recipe-table-menu')?.hidden).toBe(true)
      expect(document.activeElement).toBe(control(root))
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
