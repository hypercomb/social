// recipe/recipe.queen.spec.ts : what the recipe word's file says to the rest
// of the hive at load (its pool contributions and its entry form), and the
// word's `posts`.

import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { services.set(key, value) },
  whenReady: (key: string, ready: (value: unknown) => void) => { if (services.has(key)) ready(services.get(key)) },
  onRegister: () => () => void 0,
}

const { poolContributions } = await import('../pools/pool-contributions.js')
const { ENTRY_POSTS_WANTED, entryForms } = await import('../pools/open-entries-forms.js')
const { RECIPE_SETTING_MEANING } = await import('./recipe-setting-pool.js')
const { defaultRecipeTemplates } = await import('./recipe-pool.js')
await import('./recipe.queen.js')

type Queen = { invoke(args: string): Promise<void>; slashComplete(args: string): readonly string[]; options?: readonly string[] }
const queen = services.get('@diamondcoreprocessor.com/RecipeQueenBee') as Queen

describe('what a lit recipe tile leaves in the pools', () => {
  it('registers its template, its table setting and itself as an entry', () => {
    const meanings = poolContributions().map(one => one.meaning)
    expect(meanings).toContain('recipe:template')
    expect(meanings).toContain(RECIPE_SETTING_MEANING)
    expect(meanings).toContain('recipe:entry')
  })
})

describe('the entry form a pool opened for posts asks a phone to fill', () => {
  it('is registered for recipe entries, offering the three templates every hive starts with, by their own bytes', async () => {
    const form = entryForms().find(one => one.meaning === 'recipe:entry')
    expect(form?.bring).toBeTypeOf('function')
    const templates = await form!.templates()
    const defaults = await defaultRecipeTemplates()
    expect(templates.map(one => one.sig).slice(0, defaults.length)).toEqual(defaults.map(one => one.sig))
    for (const one of templates) {
      const sig = await crypto.subtle.digest('SHA-256', one.bytes.slice().buffer as ArrayBuffer)
      expect([...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')).toBe(one.sig)
    }
  })
})

describe('recipe posts', () => {
  it('asks for the "Collect from phones" card and nothing else: no pools mode under it', async () => {
    const heard: string[] = []
    const offs = [
      EffectBus.on(ENTRY_POSTS_WANTED, () => heard.push('posts')),
      EffectBus.on('view:open-for-tile', () => heard.push('open')),
    ]
    heard.length = 0
    await queen.invoke('posts')
    for (const off of offs) off()
    expect(heard).toEqual(['posts'])
  })

  it('offers posts as its one word, and posts is no behaviour word of its own', () => {
    expect(queen.options).toEqual(['posts'])
    expect(queen.slashComplete('po')).toEqual(['posts'])
    expect(queen.slashComplete('posts')).toEqual([])
    // The command line runs every behaviour word on a line as its own act: no queen in the package may be `posts`.
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? sources(join(dir, entry.name)) : /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name) ? [join(dir, entry.name)] : [])
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const words = sources(root).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/readonly command = '([^']+)'/g)].map(m => m[1]))
    expect(words).toContain('recipe')
    expect(words).not.toContain('posts')
  })
})

describe('bringing posted entries home', () => {
  it('skips an entry whose recipe this hive already holds, so a second press makes no second tile', async () => {
    const { generateSecretKey } = await import('nostr-tools/pure')
    const { signEntryMember } = await import('../pools/open-entries.js')
    const { recipeBytes } = await import('./recipe-template.js')
    const hex = async (bytes: Uint8Array): Promise<string> =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))].map(b => b.toString(16).padStart(2, '0')).join('')
    const pool = 'a'.repeat(64)
    const template = 'b'.repeat(64)
    const secret = generateSecretKey()
    const rowOf = async (text: string, page: string) => {
      const words = recipeBytes({ template, values: { story: { kind: 'text', text } } })
      const content = new TextDecoder().decode(words)
      const signed = await signEntryMember({ pool, page, name: 'Ana', title: text, content, createdAt: 1_800_000_000 }, secret)
      if (!signed.ok) throw new Error(signed.reason)
      return { row: { signer: signed.event.pubkey, label: 'Ana', title: text, page, at: 1_800_000_000, content, member: signed.name, bytes: signed.body }, recipe: await hex(words) }
    }
    const home = await rowOf('Already home', 'c'.repeat(64))
    const away = await rowOf('Not yet', 'd'.repeat(64))
    const held = new Set([home.recipe])
    const kept: string[] = []
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['kitchen'] })
    services.set('@hypercomb.social/Store', {
      getResourceLocal: async (sig: string) => held.has(sig) ? new Blob(['held']) : null,
      // What is offered to be kept, by its size: an entry brought home starts by keeping its words.
      putResource: async (blob: Blob) => { kept.push(String(blob.size)); return '' },
    })
    services.set('@diamondcoreprocessor.com/LayerCommitter', { importTree: async () => undefined })
    try {
      const form = entryForms().find(one => one.meaning === 'recipe:entry')!
      const none = await form.bring!([home.row], { pool, page: 'https://example.com', template, title: 'Tuesday class' })
      expect(none.brought).toBe(0)
      expect(kept).toEqual([])
      // The other entry is not home: it is kept (its tile is the history's to make, not here).
      await form.bring!([home.row, away.row], { pool, page: 'https://example.com', template, title: 'Tuesday class' })
      expect(kept).toEqual([String(new TextEncoder().encode(away.row.content).byteLength)])
    } finally {
      services.delete('@hypercomb.social/Lineage')
      services.delete('@hypercomb.social/Store')
      services.delete('@diamondcoreprocessor.com/LayerCommitter')
    }
  })
})
