// recipe/recipe-picker.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recipePicker, type RecipePickerGroup, type RecipePickerHandle, type RecipePickerOptions } from './recipe-picker.js'
import { RECIPE_STYLE_ID } from './recipe-style.js'
import { RECIPE_TEMPLATE_FAMILY, RECIPE_TEMPLATE_TASTING, RECIPE_TEMPLATE_WEEKNIGHT } from './recipe-defaults.js'
import type { RecipeTemplateDocument } from './recipe-template.js'

const SIG_FAMILY = 'a'.repeat(64)
const SIG_WEEKNIGHT = 'b'.repeat(64)
const SIG_TASTING = 'c'.repeat(64)
const SIG_MINE = 'd'.repeat(64)
const SIG_THEIRS = 'e'.repeat(64)

const say = (_key: string, fallback: string, params?: Record<string, string | number>): string =>
  fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

const MINE: RecipeTemplateDocument = {
  name: 'Sunday bake',
  description: 'Bread, slowly.',
  sections: [{ key: 'steps', kind: 'steps', label: 'Method' }, { key: 'crumb', kind: 'text', label: 'The crumb', prompt: 'What did the inside look like?' }],
}
const THEIRS: RecipeTemplateDocument = {
  name: 'Fermentation log',
  sections: [{ key: 'facts', kind: 'facts', label: 'Day by day' }, { key: 'pictures', kind: 'pictures', label: 'Jars' }],
}

const GROUPS: readonly RecipePickerGroup[] = [
  { id: 'built-in', label: 'Built in', entries: [
    { sig: SIG_FAMILY, template: RECIPE_TEMPLATE_FAMILY },
    { sig: SIG_WEEKNIGHT, template: RECIPE_TEMPLATE_WEEKNIGHT },
    { sig: SIG_TASTING, template: RECIPE_TEMPLATE_TASTING },
  ] },
  { id: 'yours', label: 'Yours', entries: [{ sig: SIG_MINE, template: MINE, kept: true }] },
  { id: 'kitchen.example', label: 'kitchen.example', note: 'A host you follow', entries: [{ sig: SIG_THEIRS, template: THEIRS }] },
]

const open: RecipePickerHandle[] = []

function mount(over: Partial<RecipePickerOptions> = {}) {
  const spies = { onPick: vi.fn(), onQuery: vi.fn(), onForget: vi.fn(), onClose: vi.fn() }
  const picker = recipePicker({ say, groups: GROUPS, current: SIG_WEEKNIGHT, ...spies, ...over })
  document.body.append(picker.element)
  open.push(picker)
  return { picker, root: picker.element, ...spies }
}

const names = (root: HTMLElement): string[] => [...root.querySelectorAll('.hc-recipe-picker-name > span:first-child')].map(node => node.textContent ?? '')
const groupsShown = (root: HTMLElement): string[] => [...root.querySelectorAll('.hc-recipe-picker-group h3')].map(node => node.textContent ?? '')
const search = (root: HTMLElement): HTMLInputElement => root.querySelector<HTMLInputElement>('input[type="search"]')!
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

afterEach(() => {
  for (const picker of open.splice(0)) picker.dispose()
  document.body.replaceChildren()
})

describe('the template picker', () => {
  it('lists the groups, and says what each template is in its own words', () => {
    const { root } = mount()
    expect(document.querySelectorAll(`#${RECIPE_STYLE_ID}`)).toHaveLength(1)
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    expect(groupsShown(root)).toEqual(['Built in', 'Yours', 'kitchen.example'])
    expect(names(root)).toEqual(['Family recipe', 'Weeknight', 'Tasting journey', 'Sunday bake', 'Fermentation log'])
    const family = root.querySelector<HTMLElement>(`[data-sig="${SIG_FAMILY}"]`)!
    expect(family.tagName).toBe('BUTTON')
    expect(family.querySelector('.hc-recipe-picker-about')?.textContent).toBe(RECIPE_TEMPLATE_FAMILY.description)
    expect([...family.querySelectorAll('.hc-recipe-chips span')].map(chip => chip.textContent)).toEqual(
      ['The story', 'Pictures', 'At a glance', 'What you need', 'How it is made', 'At the table', 'Watch and read'],
    )
    expect(root.querySelector('[data-group="kitchen.example"] .hc-recipe-picker-quiet')?.textContent).toBe('A host you follow')
    // A template with no description shows none.
    expect(root.querySelector(`[data-sig="${SIG_THEIRS}"] .hc-recipe-picker-about`)).toBeNull()
  })

  it('marks the template in use', () => {
    const { root, picker } = mount()
    const marked = [...root.querySelectorAll<HTMLElement>('[aria-current="true"]')]
    expect(marked.map(node => node.dataset['sig'])).toEqual([SIG_WEEKNIGHT])
    expect(marked[0].querySelector('.hc-recipe-tag')?.textContent).toBe('In use')
    picker.update({ groups: GROUPS, current: SIG_MINE })
    expect([...root.querySelectorAll<HTMLElement>('[aria-current="true"]')].map(node => node.dataset['sig'])).toEqual([SIG_MINE])
    // A field left out keeps what it had.
    picker.update({ groups: GROUPS })
    expect(root.querySelector('[aria-current="true"]')?.getAttribute('data-sig')).toBe(SIG_MINE)
  })

  it('narrows by every word asked for, whatever the caller passed in', () => {
    const { root, onQuery } = mount()
    type(root, 'scene')
    expect(onQuery).toHaveBeenLastCalledWith('scene')
    expect(names(root)).toEqual(['Tasting journey'])
    // A group with nothing left shows nothing, not an empty heading.
    expect(groupsShown(root)).toEqual(['Built in'])

    type(root, '  PICTURES   glance ')
    expect(names(root)).toEqual(['Family recipe', 'Weeknight', 'Tasting journey'])
    // It reads the prompt and the description too, and every word must be there.
    type(root, 'inside crumb')
    expect(names(root)).toEqual(['Sunday bake'])
    type(root, 'crumb jars')
    expect(names(root)).toEqual([])
    expect(root.querySelector<HTMLElement>('[data-none]')?.hidden).toBe(false)
    expect(root.querySelector('[data-none]')?.textContent).toBe('No template matches "crumb jars".')

    type(root, '')
    expect(names(root)).toHaveLength(5)
    expect(root.querySelector<HTMLElement>('[data-none]')?.hidden).toBe(true)
  })

  it('takes a query from the caller and still narrows by it', () => {
    const { root, picker, onQuery } = mount({ query: 'weeknight' })
    expect(search(root).value).toBe('weeknight')
    expect(names(root)).toEqual(['Weeknight'])
    picker.update({ groups: GROUPS, query: 'ferment' })
    expect(search(root).value).toBe('ferment')
    expect(names(root)).toEqual(['Fermentation log'])
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('says it is still asking, and says when there is nothing at all', () => {
    const { root, picker } = mount({ groups: [], loading: true })
    const asking = root.querySelector<HTMLElement>('[role="status"]')!
    expect(asking.hidden).toBe(false)
    expect(asking.textContent).toBe('Asking the domains you follow')
    expect(root.querySelector('[data-none]')?.textContent).toBe('There are no templates here yet.')
    picker.update({ groups: GROUPS, loading: false })
    expect(asking.isConnected).toBe(true)
    expect(asking.hidden).toBe(true)
    expect(names(root)).toHaveLength(5)
  })

  it('a press picks, and only a kept entry can be taken off the list', () => {
    const { root, onPick, onForget } = mount()
    root.querySelector<HTMLButtonElement>(`[data-sig="${SIG_TASTING}"]`)?.click()
    expect(onPick).toHaveBeenCalledWith(SIG_TASTING)
    const forget = [...root.querySelectorAll<HTMLButtonElement>('[data-forget]')]
    expect(forget.map(button => button.dataset['forget'])).toEqual([SIG_MINE])
    expect(forget[0].textContent).toBe('Take off my list')
    expect(forget[0].getAttribute('aria-label')).toBe('Take Sunday bake off my list')
    forget[0].click()
    expect(onForget).toHaveBeenCalledWith(SIG_MINE)
    expect(onPick).toHaveBeenCalledTimes(1)

    const without = mount({ onForget: undefined })
    expect(without.root.querySelector('[data-forget]')).toBeNull()
  })

  it('arrows walk the entries, Enter picks, and focus survives a redraw', () => {
    const { root, picker, onPick } = mount()
    picker.focus()
    expect(document.activeElement).toBe(search(root))
    const down = key(search(root), 'ArrowDown')
    expect(down.defaultPrevented).toBe(true)
    expect((document.activeElement as HTMLElement).dataset['sig']).toBe(SIG_FAMILY)
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, 'ArrowDown')
    expect((document.activeElement as HTMLElement).dataset['sig']).toBe(SIG_MINE)
    // The lists are rebuilt under it: the same entry keeps focus.
    picker.update({ groups: GROUPS, loading: true })
    expect((document.activeElement as HTMLElement).dataset['sig']).toBe(SIG_MINE)
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, 'ArrowDown')
    expect((document.activeElement as HTMLElement).dataset['sig']).toBe(SIG_THEIRS)
    key(document.activeElement!, 'ArrowUp')
    expect((document.activeElement as HTMLElement).dataset['sig']).toBe(SIG_MINE)
    for (let n = 0; n < 4; n++) key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(search(root))

    // Enter in the search picks the first match, once something was asked for.
    key(search(root), 'Enter')
    expect(onPick).not.toHaveBeenCalled()
    type(root, 'journey')
    expect(key(search(root), 'Enter').defaultPrevented).toBe(true)
    expect(onPick).toHaveBeenCalledWith(SIG_TASTING)
  })

  it('Escape closes it and stops there; so does a press beside the panel', () => {
    const { root, onClose } = mount()
    const behind = vi.fn()
    document.body.addEventListener('keydown', behind)
    const inside = key(search(root), 'Escape')
    expect(inside.defaultPrevented).toBe(true)
    expect(behind).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    // With nothing focused the key lands on the document, and the panel on top still takes it.
    const nowhere = key(document.body, 'Escape')
    document.body.removeEventListener('keydown', behind)
    expect(nowhere.defaultPrevented).toBe(true)
    expect(behind).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(2)

    root.click()
    expect(onClose).toHaveBeenCalledTimes(3)
    root.querySelector<HTMLElement>('.hc-recipe-picker-panel')?.click()
    expect(onClose).toHaveBeenCalledTimes(3)
    root.querySelector<HTMLButtonElement>('.hc-recipe-picker-head button')?.click()
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('Tab stays inside the panel', () => {
    const { root } = mount()
    const stops = [...root.querySelectorAll<HTMLElement>('.hc-recipe-picker-panel button, .hc-recipe-picker-panel input')]
    const first = stops[0]
    const last = stops[stops.length - 1]
    last.focus()
    expect(key(last, 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    expect(key(first, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    stops[1].focus()
    expect(key(stops[1], 'Tab').defaultPrevented).toBe(false)
  })

  it('renders the words of a stranger as text and makes no element of them', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const { root } = mount({ groups: [{
      id: hostile,
      label: hostile,
      note: hostile,
      entries: [{ sig: 'not"a]sig', kept: true, template: { name: hostile, description: hostile, sections: [{ key: 'a', kind: 'text', label: hostile }] } }],
    }] })
    expect(root.querySelector('img, script')).toBeNull()
    expect(groupsShown(root)).toEqual([hostile])
    expect(names(root)).toEqual([hostile])
    expect(root.querySelector('.hc-recipe-chips span')?.textContent).toBe(hostile)
    // An odd signature is still only data: focus finds its entry again without a selector built from it.
    const entry = root.querySelector<HTMLButtonElement>('.hc-recipe-picker-entry')!
    entry.focus()
    type(root, 'img')
    expect((document.activeElement as HTMLElement).dataset['sig']).toBe('not"a]sig')
  })

  it('takes itself down', () => {
    const { root, picker, onClose } = mount()
    picker.dispose()
    expect(root.isConnected).toBe(false)
    key(document.body, 'Escape')
    expect(onClose).not.toHaveBeenCalled()
  })
})
