// recipe/recipe-template.spec.ts
import { afterEach, describe, expect, it } from 'vitest'
import { I18N_IOC_KEY } from '@hypercomb/core'
import {
  RECIPE_LIMITS,
  emptyRecipeValue,
  isEmptyRecipeValue,
  parseRecipe,
  parseRecipeEntry,
  parseRecipeTemplate,
  projectRecipe,
  recipeBytes,
  recipeCover,
  recipeEntryBytes,
  recipeKeyWords,
  recipeLinkUrl,
  recipePages,
  recipeSignatures,
  recipeTemplateBytes,
  recipeTemplateFrom,
  recipeTemplateRefusalWords,
  recipeTemplateWords,
  type RecipeDocument,
  type RecipeTemplateDocument,
} from './recipe-template.js'
import { DEFAULT_RECIPE_TEMPLATES, RECIPE_TEMPLATE_FAMILY, RECIPE_TEMPLATE_WEEKNIGHT, recipeDefaultTemplateId, recipeDefaultTemplateShown } from './recipe-defaults.js'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

const template = (over: Record<string, unknown> = {}): Uint8Array => utf8(JSON.stringify({
  'recipe:template': 1,
  name: 'Soup',
  sections: [{ key: 'steps', kind: 'steps', label: 'Method' }],
  ...over,
}))

const reason = async (bytes: Uint8Array): Promise<string> => {
  const parsed = await parseRecipeTemplate(bytes)
  return parsed.ok ? 'ok' : parsed.reason
}

const SOUP: RecipeDocument = {
  values: {
    story: { kind: 'text', text: 'My grandmother made this on Sundays.\nAlways too much.' },
    facts: { kind: 'facts', facts: [{ label: 'Serves', value: '6' }] },
    ingredients: { kind: 'ingredients', items: [{ amount: '2', item: 'onions', note: 'sliced thin' }, { item: 'salt' }] },
    steps: { kind: 'steps', steps: [{ text: 'Sweat the onions.', minutes: 10 }, { text: 'Add water and wait.', picture: SIG_B }] },
    pictures: { kind: 'pictures', pictures: [SIG_A] },
    links: { kind: 'links', links: [{ url: 'https://example.org/watch?v=1', label: 'The technique' }] },
  },
}

describe('a recipe template', () => {
  it('reads back what the writer wrote, under one signature', async () => {
    for (const doc of DEFAULT_RECIPE_TEMPLATES) {
      const bytes = recipeTemplateBytes(doc)
      const parsed = await parseRecipeTemplate(bytes)
      expect(parsed.ok, doc.name).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.template.name).toBe(doc.name)
      expect(parsed.template.sections.map(s => s.key)).toEqual(doc.sections.map(s => s.key))
      // Written again from what was read, it is the same bytes: one template, one signature.
      expect(recipeTemplateBytes(parsed.template)).toEqual(bytes)
      expect((await parseRecipeTemplate(bytes, parsed.sig)).ok).toBe(true)
    }
  })

  it('gives the three defaults three signatures', async () => {
    const sigs = await Promise.all(DEFAULT_RECIPE_TEMPLATES.map(async doc => {
      const parsed = await parseRecipeTemplate(recipeTemplateBytes(doc))
      return parsed.ok ? parsed.sig : ''
    }))
    expect(new Set(sigs).size).toBe(3)
    expect(sigs.every(sig => /^[a-f0-9]{64}$/.test(sig))).toBe(true)
  })

  it('refuses bytes held under another signature', async () => {
    expect((await parseRecipeTemplate(template(), SIG_A)).ok).toBe(false)
  })

  it('refuses what the format does not say, with a reason', async () => {
    expect(await reason(template({ 'recipe:template': 2 }))).toContain('version')
    expect(await reason(template({ extra: true }))).toContain('unknown field')
    expect(await reason(template({ name: '' }))).toContain('empty')
    expect(await reason(template({ name: 'two\nlines' }))).toContain('line break')
    expect(await reason(template({ sections: [] }))).toContain('no sections')
    expect(await reason(template({ sections: [{ key: 'Steps', kind: 'steps', label: 'x' }] }))).toContain('key')
    expect(await reason(template({ sections: [{ key: 'a', kind: 'video', label: 'x' }] }))).toContain('kind')
    expect(await reason(template({ sections: [{ key: 'a', kind: 'text', label: 'x' }, { key: 'a', kind: 'text', label: 'y' }] }))).toContain('share the key')
    expect(await reason(template({ sections: [{ key: 'a', kind: 'text', label: 'x', fields: ['Serves'] }] }))).toContain('facts')
    expect(await reason(template({ sections: [{ key: 'a', kind: 'text', label: 'x', html: '<b>' }] }))).toContain('unknown field')
    expect(await reason(template({ name: 'left‮right' }))).toContain('direction')
    expect(await reason(utf8('[]'))).toContain('not a JSON object')
    expect(await reason(utf8('{'))).toBe('it is not JSON')
    expect(await reason(new Uint8Array([0xff, 0xfe]))).toBe('it is not UTF-8')
    expect(await reason(new Uint8Array(RECIPE_LIMITS.templateBytes + 1))).toContain('larger')
  })

  it('refuses a repeated key and a prototype key', async () => {
    expect(await reason(utf8('{"recipe:template":1,"name":"a","name":"b","sections":[{"key":"s","kind":"steps","label":"M"}]}'))).toContain('repeats')
    expect(await reason(utf8('{"recipe:template":1,"name":"a","__proto__":{},"sections":[{"key":"s","kind":"steps","label":"M"}]}'))).toContain('not allowed')
    // A section may not be NAMED like a member every object already has.
    expect(await reason(template({ sections: [{ key: 'constructor', kind: 'text', label: 'x' }] }))).toContain("section 1's key")
  })

  it('caps its sections', async () => {
    const sections = Array.from({ length: RECIPE_LIMITS.sections + 1 }, (_, i) => ({ key: `s${i}`, kind: 'text', label: `S ${i}` }))
    expect(await reason(template({ sections }))).toContain('more than')
  })

  it('is searched by its name, its purpose and its section labels', () => {
    const words = recipeTemplateWords(RECIPE_TEMPLATE_WEEKNIGHT)
    expect(words).toContain('weeknight')
    expect(words).toContain('swaps and shortcuts')
  })
})

describe('a recipe', () => {
  it('reads back what was written, values in key order', async () => {
    const bytes = recipeBytes({ ...SOUP, template: SIG_A })
    const parsed = await parseRecipe(bytes)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.recipe.template).toBe(SIG_A)
    expect(Object.keys(parsed.recipe.values)).toEqual(['facts', 'ingredients', 'links', 'pictures', 'steps', 'story'])
    expect(recipeBytes(parsed.recipe)).toEqual(bytes)
  })

  it('is the same signature however its values were typed in', async () => {
    const reversed: RecipeDocument = { values: Object.fromEntries(Object.entries(SOUP.values).reverse()) }
    expect(recipeBytes(reversed)).toEqual(recipeBytes(SOUP))
  })

  it('leaves an unanswered section out of its bytes', async () => {
    const bytes = recipeBytes({ values: { ...SOUP.values, swaps: { kind: 'text', text: '   ' }, more: emptyRecipeValue('links') } })
    expect(bytes).toEqual(recipeBytes(SOUP))
  })

  it('refuses values the format does not say', async () => {
    const bad = async (values: unknown, extra: Record<string, unknown> = {}): Promise<string> => {
      const parsed = await parseRecipe(utf8(JSON.stringify({ recipe: 1, values, ...extra })))
      return parsed.ok ? 'ok' : parsed.reason
    }
    expect(await bad({ a: { kind: 'text', text: 'fine' } })).toBe('ok')
    expect(await bad({ a: { kind: 'text', text: 'fine' } }, { template: 'nope' })).toContain('signature')
    expect(await bad({ a: { kind: 'html', text: '<script>' } })).toContain('kind')
    expect(await bad({ a: { kind: 'text', text: 'x', html: '<b>' } })).toContain('unknown field')
    expect(await bad({ A: { kind: 'text', text: 'x' } })).toContain('key')
    expect(await bad({ a: { kind: 'pictures', pictures: ['not-a-sig'] } })).toContain('signature')
    expect(await bad({ a: { kind: 'steps', steps: [{ text: 'x', picture: 'zz' }] } })).toContain('signature')
    expect(await bad({ a: { kind: 'steps', steps: [{ text: '  ' }] } })).toContain('empty')
    expect(await bad({ a: { kind: 'steps', steps: [{ text: 'x', minutes: -1 }] } })).toContain('minutes')
    expect(await bad({ a: { kind: 'ingredients', items: [{ amount: '1' }] } })).toContain('item')
    expect(await bad({ a: { kind: 'links', links: [{ url: 'javascript:alert(1)' }] } })).toContain('link')
    expect(await bad({ a: { kind: 'links', links: [{ url: 'https://bank@evil.example/' }] } })).toContain('link')
    expect(await bad({ a: { kind: 'facts', facts: [{ label: 'Serves', value: '' }] } })).toContain('empty')
    expect(await bad({ a: { kind: 'text', text: 'x'.repeat(RECIPE_LIMITS.text + 1) } })).toContain('longer')
    expect(await bad([])).toContain('values')
  })

  it('keeps a picture once however often it was added', async () => {
    const parsed = await parseRecipe(utf8(JSON.stringify({ recipe: 1, values: { p: { kind: 'pictures', pictures: [SIG_A, SIG_A, SIG_B] } } })))
    expect(parsed.ok && parsed.recipe.values['p']).toEqual({ kind: 'pictures', pictures: [SIG_A, SIG_B] })
  })

  it('names every signature a reader must hold', () => {
    expect(recipeSignatures({ ...SOUP, template: 'c'.repeat(64) }).sort()).toEqual([SIG_A, SIG_B, 'c'.repeat(64)])
  })
})

describe('an entry', () => {
  it('reads back what was offered, under one signature', async () => {
    const bytes = recipeEntryBytes({ name: 'Sunday soup', recipe: SIG_A, cover: SIG_B })
    const parsed = await parseRecipeEntry(bytes)
    expect(parsed.ok && parsed.entry).toMatchObject({ name: 'Sunday soup', recipe: SIG_A, cover: SIG_B })
    expect(parsed.ok && recipeEntryBytes(parsed.entry)).toEqual(bytes)
    expect((await parseRecipeEntry(bytes, SIG_A)).ok).toBe(false)
  })

  it('refuses what the format does not say', async () => {
    const bad = async (doc: Record<string, unknown>): Promise<string> => {
      const parsed = await parseRecipeEntry(utf8(JSON.stringify({ 'recipe:entry': 1, name: 'Soup', recipe: SIG_A, ...doc })))
      return parsed.ok ? 'ok' : parsed.reason
    }
    expect(await bad({})).toBe('ok')
    expect(await bad({ recipe: 'soup' })).toContain('signature')
    expect(await bad({ cover: 'x' })).toContain('signature')
    expect(await bad({ name: '' })).toContain('empty')
    expect(await bad({ name: 'two\nlines' })).toContain('line break')
    expect(await bad({ author: 'me' })).toContain('unknown field')
    expect(await bad({ 'recipe:entry': 2 })).toContain('version')
    expect(await bad({ name: 'x'.repeat(RECIPE_LIMITS.entryBytes) })).toContain('larger')
  })

  it('is known by its first picture, else a step picture', () => {
    expect(recipeCover(SOUP)).toBe(SIG_A)
    expect(recipeCover({ values: { steps: SOUP.values['steps']! } })).toBe(SIG_B)
    expect(recipeCover({ values: {} })).toBeUndefined()
  })
})

describe('a link', () => {
  it('is http or https, with no credentials', () => {
    expect(recipeLinkUrl(' https://example.org/a b')).toBeNull()
    expect(recipeLinkUrl('https://example.org/a')).toBe('https://example.org/a')
    expect(recipeLinkUrl('http://example.org')).toBe('http://example.org/')
    expect(recipeLinkUrl('mailto:a@example.org')).toBeNull()
    expect(recipeLinkUrl('data:text/html,hi')).toBeNull()
    expect(recipeLinkUrl('https://user:pass@example.org/')).toBeNull()
    expect(recipeLinkUrl('')).toBeNull()
  })
})

describe('a recipe seen through a template', () => {
  it('follows the template order and fills what it holds', () => {
    const projected = projectRecipe(RECIPE_TEMPLATE_FAMILY, SOUP)
    expect(projected.slice(0, 7).map(p => p.section.key)).toEqual(['story', 'pictures', 'facts', 'ingredients', 'steps', 'experience', 'links'])
    expect(isEmptyRecipeValue(projected[5]!.value)).toBe(true)
    expect(projected.every(p => !p.kept)).toBe(true)
  })

  it('keeps what another template has no section for, after its own', () => {
    const projected = projectRecipe(RECIPE_TEMPLATE_WEEKNIGHT, SOUP)
    const own = projected.filter(p => !p.kept).map(p => p.section.key)
    const kept = projected.filter(p => p.kept).map(p => p.section.key)
    expect(own).toEqual(['facts', 'ingredients', 'steps', 'swaps', 'pictures'])
    expect(kept).toEqual(['links', 'story'])
    expect(projected.find(p => p.section.key === 'story')?.value).toEqual(SOUP.values['story'])
  })

  it('does not put a value into a section of another kind', () => {
    const odd: RecipeTemplateDocument = { name: 'Odd', sections: [{ key: 'story', kind: 'steps', label: 'Story as steps' }] }
    const projected = projectRecipe(odd, SOUP)
    expect(projected[0]!.value).toEqual({ kind: 'steps', steps: [] })
    // The cook's story is still there, kept under its own key.
    expect(projected.some(p => p.kept && p.section.key === 'story' && p.value.kind === 'text')).toBe(true)
  })

  it('saves its layout as a template without the words', async () => {
    const projected = projectRecipe(RECIPE_TEMPLATE_WEEKNIGHT, SOUP)
    const doc = recipeTemplateFrom('Sunday soup layout', projected.map(p => p.section), 'From my soup')
    const parsed = await parseRecipeTemplate(recipeTemplateBytes(doc))
    expect(parsed.ok).toBe(true)
    expect(JSON.stringify(doc)).not.toContain('grandmother')
    expect(doc.sections.map(s => s.key)).toEqual(['facts', 'ingredients', 'steps', 'swaps', 'pictures', 'links', 'story'])
  })
})

describe('the read-along', () => {
  it('opens on a cover and gives every step its own page', () => {
    const pages = recipePages(projectRecipe(RECIPE_TEMPLATE_FAMILY, SOUP))
    expect(pages[0]).toEqual({ kind: 'cover', picture: SIG_A, facts: [{ label: 'Serves', value: '6' }] })
    expect(pages.map(p => p.kind)).toEqual(['cover', 'text', 'ingredients', 'step', 'step', 'links'])
    const steps = pages.filter(p => p.kind === 'step')
    expect(steps.map(p => p.kind === 'step' && [p.at, p.of])).toEqual([[0, 2], [1, 2]])
  })

  it('makes no page for an empty section, and shows a second picture', () => {
    const more: RecipeDocument = { values: { ...SOUP.values, pictures: { kind: 'pictures', pictures: [SIG_A, SIG_B] } } }
    const pages = recipePages(projectRecipe(RECIPE_TEMPLATE_FAMILY, more))
    expect(pages.filter(p => p.kind === 'pictures')).toHaveLength(1)
    expect(recipePages(projectRecipe(RECIPE_TEMPLATE_FAMILY, { values: {} }))).toEqual([{ kind: 'cover', facts: [] }])
  })
})

describe("a refusal, in the participant's language", () => {
  /** A catalog that knows a few keys and echoes the rest back, as the shell's does. */
  const speak = (words: Record<string, string>): void => {
    (globalThis as { ioc?: unknown }).ioc = {
      get: (key: string) => (key === I18N_IOC_KEY ? { t: (name: string) => words[name] ?? name } : undefined),
    }
  }
  afterEach(() => { delete (globalThis as { ioc?: unknown }).ioc })

  it('carries a code, its key and what fills its holes, and says it in English with no catalogue', async () => {
    const parsed = await parseRecipeTemplate(template({ sections: [{ key: 'a', kind: 'text', label: 'x' }, { key: 'a', kind: 'text', label: 'y' }] }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.refusal).toEqual({ code: 'sharedKey', key: 'recipe.template.refusal.sharedKey', params: { key: 'a' } })
    expect(parsed.reason).toBe('two sections share the key "a"')
  })

  it("says the reason in the catalog's words, its holes filled, for a template, a recipe and an entry", async () => {
    speak({
      'recipe.template.refusal.notJson': 'JSON ではありません',
      'recipe.template.refusal.tooLong': '「{field}」が {max} 文字を超えています',
      'recipe.template.refusal.notSignature': '「{field}」は署名ではありません',
    })
    expect(await reason(utf8('not json'))).toBe('JSON ではありません')
    expect(await reason(template({ name: 'x'.repeat(RECIPE_LIMITS.name + 1) }))).toBe(`「name」が ${RECIPE_LIMITS.name} 文字を超えています`)
    const recipe = await parseRecipe(utf8(JSON.stringify({ recipe: 1, template: 'nope', values: {} })))
    expect(recipe.ok ? 'ok' : recipe.reason).toBe('「template」は署名ではありません')
    const entry = await parseRecipeEntry(utf8(JSON.stringify({ 'recipe:entry': 1, name: 'Soup', recipe: 'nope' })))
    expect(entry.ok ? 'ok' : entry.reason).toBe('「recipe」は署名ではありません')
    // A key the catalog does not know is said in English.
    expect(await reason(template({ sections: [] }))).toBe('it has no sections: a template arranges at least one')
  })

  it('is said again in any language through a reader’s own words', async () => {
    const parsed = await parseRecipe(utf8(JSON.stringify({ recipe: 1, values: { soup: { kind: 'video' } } })))
    if (parsed.ok) throw new Error('read a value of no kind')
    expect(parsed.refusal.code).toBe('valueKind')
    const said = recipeTemplateRefusalWords(parsed.refusal, (key, fallback, params) => (key === parsed.refusal.key ? `${params?.['key']} : genre inconnu` : fallback))
    expect(said).toBe('soup : genre inconnu')
    expect(recipeTemplateRefusalWords(parsed.refusal, key => key)).toBe(parsed.reason)
  })
})

describe('a key said as words', () => {
  it('is what a value no section names is labelled by', () => {
    expect(recipeKeyWords('swaps')).toBe('Swaps')
    expect(recipeKeyWords('make-ahead')).toBe('Make ahead')
    expect(recipeKeyWords('make_ahead')).toBe('Make ahead')
    expect(recipeKeyWords('makeAhead')).toBe('Make ahead')
    const kept = projectRecipe(RECIPE_TEMPLATE_WEEKNIGHT, { values: { pairing_notes: { kind: 'text', text: 'Cider.' } } }).find(p => p.kept)
    expect(kept?.section.label).toBe('Pairing notes')
  })
})

describe("a built-in template, shown in the reader's language", () => {
  const words: Record<string, string> = {
    'recipe.default.weeknight.name': '平日',
    'recipe.default.weeknight.description': '短いもの',
    'recipe.default.weeknight.swaps.label': '代わりに',
    'recipe.default.weeknight.swaps.prompt': '何を省けますか？',
    'recipe.default.weeknight.facts.fields.effort': '手間',
  }
  const say = (key: string, fallback: string): string => words[key] ?? key

  it('translates its name, description, labels, prompts and fact fields, and leaves its bytes and signature as they were', async () => {
    const before = recipeTemplateBytes(RECIPE_TEMPLATE_WEEKNIGHT)
    const shown = recipeDefaultTemplateShown(RECIPE_TEMPLATE_WEEKNIGHT, say)
    expect(shown.name).toBe('平日')
    expect(shown.description).toBe('短いもの')
    const swaps = shown.sections.find(section => section.key === 'swaps')
    expect([swaps?.label, swaps?.prompt]).toEqual(['代わりに', '何を省けますか？'])
    expect(shown.sections.find(section => section.key === 'facts')?.fields).toEqual(['Serves', 'Time', '手間'])
    // The keys and kinds are the built-in's: a recipe's values still land in the same holes.
    expect(shown.sections.map(section => [section.key, section.kind])).toEqual(RECIPE_TEMPLATE_WEEKNIGHT.sections.map(section => [section.key, section.kind]))
    expect(recipeTemplateBytes(RECIPE_TEMPLATE_WEEKNIGHT)).toEqual(before)
    const held = await parseRecipeTemplate(before)
    expect(held.ok && held.template.name).toBe('Weeknight')
  })

  it('knows a built-in by its bytes, and leaves every other template as its author wrote it', () => {
    const copy = JSON.parse(JSON.stringify(RECIPE_TEMPLATE_FAMILY)) as RecipeTemplateDocument
    expect(recipeDefaultTemplateId(copy)).toBe('family')
    const edited: RecipeTemplateDocument = { ...RECIPE_TEMPLATE_FAMILY, description: 'Mine now.' }
    expect(recipeDefaultTemplateId(edited)).toBe('')
    expect(recipeDefaultTemplateShown(edited, say)).toBe(edited)
  })
})
