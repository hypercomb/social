// sharing/recommend.queen.spec.ts — what raise, hold and recommend say goes
// through the I18n provider, and every line they say has an English and a
// Japanese catalog entry. The words themselves are the dialect and stay as
// they are.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

vi.mock('./link-acts.js', async (original) => ({
  ...(await original<typeof import('./link-acts.js')>()),
  resolveLink: async () => ({ kind: 'none' }),
}))

import { EffectBus } from '@hypercomb/core'
import { RecommendQueenBee } from './recommend.queen.js'

const SHARING = join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing')
const I18N = join(process.cwd(), 'hypercomb-shared', 'i18n')

describe('recommend', () => {
  it('says its lines in the reader\'s language, and in English when the catalog has none', async () => {
    const said: string[] = []
    const off = EffectBus.on<{ message: string }>('activity:log', p => { if (p?.message) said.push(p.message) })
    const queen = new RecommendQueenBee() as unknown as { execute(a: string): Promise<void> }

    ;(globalThis as unknown as { ioc: unknown }).ioc = {
      register: () => {}, whenReady: () => {},
      get: (key: string) => key === '@hypercomb.social/I18n'
        ? { t: (k: string, p?: Record<string, unknown>) => k === 'recommend.none' ? `「${p?.['what']}」なし` : k }
        : undefined,
    }
    await queen.execute('nobody cigars')
    expect(said.at(-1)).toBe('「nobody」なし')

    ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, whenReady: () => {}, get: () => undefined }
    await queen.execute('nobody cigars')
    expect(said.at(-1)).toBe('Recommend: nothing published is called "nobody"')
    off()
  })
})

describe('the link words\' catalog', () => {
  const en = JSON.parse(readFileSync(join(I18N, 'en.json'), 'utf8')) as Record<string, string>
  const ja = JSON.parse(readFileSync(join(I18N, 'ja.json'), 'utf8')) as Record<string, string>

  for (const file of ['hold.queen.ts', 'raise.queen.ts', 'recommend.queen.ts']) {
    it(`has en and ja for every line ${file} says, with the same placeholders`, () => {
      const source = readFileSync(join(SHARING, file), 'utf8')
      const lines = [...source.matchAll(/this\.#t\('([^']+)',\s*'((?:[^'\\]|\\.)*)'/g)]
      expect(lines.length).toBeGreaterThan(3)
      for (const [, key, fallback] of lines) {
        const tokens = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
        expect(en[key!], key).toBe(fallback!.replace(/\\'/g, '\''))
        expect(ja[key!], key).toBeTruthy()
        expect(tokens(ja[key!]!), key).toEqual(tokens(en[key!]!))
      }
    })
  }

  it('has the link control\'s word prompt', () => {
    expect(en['domainLinks.asksWord']).toBe('a word')
    expect(ja['domainLinks.asksWord']).toBeTruthy()
  })
})
