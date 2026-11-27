// recipe/recipe-post.spec.ts : the form a phone posts from. The rules that turn
// what was typed into an entry, the changes a poster has left, and the page as
// DOM (jsdom). No network and no IoC.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RECIPE_POST_CHANGES,
  recipePostChanges,
  recipePostDocument,
  recipePostPage,
  recipePostRecipe,
  recipePostSections,
  type RecipePostPageOptions,
} from './recipe-post.js'
import { parseRecipe, recipeBytes, recipeSignatures, type RecipeTemplateDocument } from './recipe-template.js'

const say = (_key: string, fallback: string): string => fallback
const SIG = 'c'.repeat(64)

const LAYOUT: RecipeTemplateDocument = {
  name: 'Class',
  sections: [
    { key: 'story', kind: 'text', label: 'The story' },
    { key: 'look', kind: 'pictures', label: 'How it looks' },
    { key: 'facts', kind: 'facts', label: 'At a glance', fields: ['Serves', 'Time'] },
    { key: 'ingredients', kind: 'ingredients', label: 'What you need' },
    { key: 'steps', kind: 'steps', label: 'How it is made' },
    { key: 'links', kind: 'links', label: 'Watch' },
  ],
}
const TEMPLATE = { ...LAYOUT, sig: SIG }

const fields = (values: Record<string, string>, name = 'Ana', title = 'Sunday soup') => ({ name, title, values })

describe('the sections a poster fills', () => {
  it('leaves pictures out, and says which', () => {
    const { asked, leftOut } = recipePostSections(LAYOUT)
    expect(asked.map(section => section.key)).toEqual(['story', 'facts', 'ingredients', 'steps', 'links'])
    expect(leftOut.map(section => section.key)).toEqual(['look'])
  })
})

describe('what was typed, as a recipe', () => {
  it('reads each kind from plain lines, and names the template and nothing else', async () => {
    const made = recipePostDocument(TEMPLATE, fields({
      story: '  Grandmother made it.\r\nOn Sundays.  ',
      facts: 'Serves: 4\nTime:\n',
      ingredients: '2 cups flour\nsalt',
      steps: '1. Boil water\n2) Add salt',
      links: 'https://example.com/v A video of it\n\nhttps://example.org',
    }), say)
    expect(made.problem).toBeUndefined()
    expect(made.recipe.template).toBe(SIG)
    expect(made.recipe.values).toEqual({
      story: { kind: 'text', text: 'Grandmother made it.\nOn Sundays.' },
      // A suggested name with nothing after it was not answered.
      facts: { kind: 'facts', facts: [{ label: 'Serves', value: '4' }] },
      ingredients: { kind: 'ingredients', items: [{ amount: '2 cups', item: 'flour' }, { item: 'salt' }] },
      steps: { kind: 'steps', steps: [{ text: 'Boil water' }, { text: 'Add salt' }] },
      links: { kind: 'links', links: [{ url: 'https://example.com/v', label: 'A video of it' }, { url: 'https://example.org/' }] },
    })
    expect(recipeSignatures(made.recipe)).toEqual([SIG])
  })

  it('leaves an empty section out', () => {
    const made = recipePostDocument(TEMPLATE, fields({ story: 'Hi', ingredients: '  \n ' }), say)
    expect(Object.keys(made.recipe.values)).toEqual(['story'])
  })

  it('names the line of a link section that is not a link, and keeps the rest to measure', () => {
    const made = recipePostDocument(TEMPLATE, fields({ story: 'Hi', links: 'https://example.com\njust words' }), say)
    expect(made.problem).toBe('In Watch, line 2 is not a link. A link begins with https://.')
    expect(Object.keys(made.recipe.values)).toEqual(['story'])
  })

  it('names the line of a facts section with no colon', () => {
    expect(recipePostDocument(TEMPLATE, fields({ facts: 'Serves four' }), say).problem)
      .toBe('In At a glance, write line 1 as a name, a colon and its value, like "Serves: 4".')
  })
})

describe('the entry a press posts', () => {
  it('is the canonical recipe as text, which the reader accepts', async () => {
    const built = await recipePostRecipe(TEMPLATE, fields({ story: 'Hi', ingredients: '1 egg' }, '  Ana  ', ' Soup '), say)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.name).toBe('Ana')
    expect(built.title).toBe('Soup')
    const bytes = new TextEncoder().encode(built.content)
    expect(bytes).toEqual(recipeBytes(built.recipe))
    expect((await parseRecipe(bytes)).ok).toBe(true)
  })

  it('refuses a name or a title out of the reader\'s one-line rule', async () => {
    expect(await recipePostRecipe(TEMPLATE, fields({ story: 'Hi' }, '   '), say)).toMatchObject({ ok: false, reason: expect.stringContaining('name you go by') })
    expect(await recipePostRecipe(TEMPLATE, fields({ story: 'Hi' }, 'a'.repeat(49)), say)).toMatchObject({ ok: false })
    expect(await recipePostRecipe(TEMPLATE, fields({ story: 'Hi' }, 'Ana‮'), say)).toMatchObject({ ok: false })
    expect(await recipePostRecipe(TEMPLATE, fields({ story: 'Hi' }, 'Ana', ''), say)).toMatchObject({ ok: false, reason: expect.stringContaining('title') })
    expect(await recipePostRecipe(TEMPLATE, fields({ story: 'Hi' }, 'Ana', 't'.repeat(121)), say)).toMatchObject({ ok: false })
  })

  it('refuses an entry with nothing written, and a line that is not right', async () => {
    expect(await recipePostRecipe(TEMPLATE, fields({}), say)).toEqual({ ok: false, reason: 'Write something in your entry before you post it.' })
    expect(await recipePostRecipe(TEMPLATE, fields({ story: 'Hi', links: 'nope' }), say)).toMatchObject({ ok: false, reason: expect.stringContaining('line 1 is not a link') })
  })

  it('refuses what the reader would refuse', async () => {
    const built = await recipePostRecipe(TEMPLATE, fields({ ingredients: 'x'.repeat(201) }), say)
    expect(built).toMatchObject({ ok: false, reason: expect.stringContaining('cannot be posted') })
  })
})

describe('the changes a poster has left', () => {
  it('spends one of 8 a press, and keeps the last for a take-back', () => {
    expect(RECIPE_POST_CHANGES).toBe(8)
    expect(recipePostChanges(0, 'none')).toEqual({ left: 8, post: true, takeBack: false })
    expect(recipePostChanges(6, 'posted')).toEqual({ left: 2, post: true, takeBack: true })
    expect(recipePostChanges(7, 'posted')).toEqual({ left: 1, post: false, takeBack: true })
    expect(recipePostChanges(8, 'posted')).toEqual({ left: 0, post: false, takeBack: false })
  })

  it('takes back only an entry that is posted', () => {
    expect(recipePostChanges(2, 'gone').takeBack).toBe(false)
    expect(recipePostChanges(2, 'none').takeBack).toBe(false)
  })
})

describe('the page', () => {
  const made: { dispose(): void }[] = []
  afterEach(() => { for (const page of made.splice(0)) page.dispose() })

  const page = (over: Partial<RecipePostPageOptions> = {}) => {
    const calls = { close: 0, input: 0, post: 0, back: 0, opened: [] as string[] }
    const handle = recipePostPage({
      say, title: 'Tuesday class',
      onClose: () => { calls.close++ }, onInput: () => { calls.input++ }, onPost: () => { calls.post++ },
      onTakeBack: () => { calls.back++ }, onOpen: sig => { calls.opened.push(sig) },
      ...over,
    })
    document.body.append(handle.element)
    made.push(handle)
    return { handle, calls, root: handle.element }
  }

  it('adds no listener when its module loads: only a page made listens', async () => {
    // A fresh copy, its imports loaded first, so only this module's own top level runs under the spy.
    vi.resetModules()
    await Promise.all([
      import('@hypercomb/core'), import('../pools/open-entries.js'), import('./recipe-catalogue.js'), import('./recipe-page.js'),
      import('./recipe-post-style.js'), import('./recipe-style.js'), import('./recipe-template.js'),
    ])
    // jsdom's window holds its own copy of the method, so it is watched beside the prototype.
    const spies = [vi.spyOn(EventTarget.prototype, 'addEventListener'), vi.spyOn(window, 'addEventListener'), vi.spyOn(document, 'addEventListener')]
    try {
      const again = await import('./recipe-post.js')
      expect(typeof again.recipePostPage).toBe('function')
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally { for (const spy of spies) spy.mockRestore() }
  })

  it('draws one part per section, says pictures are left out, and keeps what was typed for the same template', () => {
    const { handle, root, calls } = page()
    handle.setForm(LAYOUT)
    const areas = [...root.querySelectorAll('textarea')]
    expect(areas.map(area => area.dataset['kind'])).toEqual(['text', 'facts', 'ingredients', 'steps', 'links'])
    expect(root.textContent).toContain('Pictures cannot be posted from this page, so How it looks is left out.')
    expect(root.textContent).toContain('can be read by anyone with this code')
    const facts = areas[1] as HTMLTextAreaElement
    expect(facts.placeholder).toBe('Serves: \nTime: ')
    const story = areas[0] as HTMLTextAreaElement
    story.value = 'Hi'
    story.dispatchEvent(new Event('input'))
    expect(calls.input).toBe(1)
    handle.setForm(LAYOUT)
    expect(handle.fields().values['story']).toBe('Hi')
    handle.setForm(null)
    expect((root.querySelector('[role="form"]') as HTMLElement).hidden).toBe(true)
  })

  it('says the state and when it ends, and presses only what is open', () => {
    const { handle, root, calls } = page()
    handle.setState('This one is open.', 'Open until Tuesday.')
    expect(root.querySelector('.hc-recipe-post-state')?.textContent).toBe('This one is open.')
    expect(root.textContent).toContain('Open until Tuesday.')
    handle.setForm(LAYOUT)
    const [post, back] = [...root.querySelectorAll('.hc-recipe-post-actions button')] as HTMLButtonElement[]
    handle.setActions({ post: false, takeBack: false, posted: false })
    post!.click()
    expect(calls.post).toBe(0)
    expect(back!.hidden).toBe(true)
    handle.setActions({ post: true, takeBack: true, posted: true })
    expect(post!.textContent).toBe('Post the change')
    post!.click()
    back!.click()
    expect(calls).toMatchObject({ post: 1, back: 1 })
  })

  it('lists what was posted with the catalogue\'s cards, and opens one in the read-along over the page', () => {
    const { handle, root, calls } = page()
    handle.setPosted([{ sig: 'e'.repeat(64), name: 'Soup', nodes: [{ kind: 'participant', id: 'a'.repeat(64), name: 'Ana' }] }])
    const card = root.querySelector('.hc-recipe-catalogue-card') as HTMLButtonElement
    expect(card.textContent).toContain('Soup')
    card.click()
    expect(calls.opened).toEqual(['e'.repeat(64)])
    handle.showRecipe({ title: 'Soup', recipe: { values: { story: { kind: 'text', text: 'Hi' } } }, template: LAYOUT })
    expect((root.querySelector('.hc-recipe-post-scroll') as HTMLElement).inert).toBe(true)
    expect(root.querySelectorAll(':scope > .hc-recipe').length).toBe(1)
    handle.closeRecipe()
    expect(root.querySelectorAll(':scope > .hc-recipe').length).toBe(0)
    expect((root.querySelector('.hc-recipe-post-scroll') as HTMLElement).inert).toBe(false)
    handle.setPosted(null)
    expect((root.querySelector('.hc-recipe-post-posted') as HTMLElement).hidden).toBe(true)
  })

  it('lets go of everything when it is disposed', () => {
    const { handle, root, calls } = page()
    handle.setForm(LAYOUT)
    handle.setActions({ post: true, takeBack: false, posted: false })
    const post = root.querySelector('.hc-recipe-post-actions button') as HTMLButtonElement
    handle.dispose()
    post.click()
    expect(calls.post).toBe(0)
    expect(root.isConnected).toBe(false)
  })
})
