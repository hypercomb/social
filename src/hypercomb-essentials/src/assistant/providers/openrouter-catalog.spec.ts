import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOpenRouterCatalogCache, fetchOpenRouterCatalog } from './openrouter-catalog.js'
import { JEV_MODEL } from '../jev-decision.js'

beforeEach(() => clearOpenRouterCatalogCache())
afterEach(() => vi.unstubAllGlobals())
describe('decision model discovery', () => {
  it('resolves Jev through public model metadata when the general list omits it', async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/endpoints')
      ? { data: { id: JEV_MODEL, name: 'TypeSafe: Jev Latest', architecture: { output_modalities: ['decisions'] } } }
      : { data: [{ id: 'example/chat', name: 'Example Chat' }] } }))
    vi.stubGlobal('fetch', fetcher)
    const entries = await fetchOpenRouterCatalog()
    expect(entries).toContainEqual({ id: JEV_MODEL, name: 'TypeSafe: Jev Latest', decisionOnly: true })
    expect(fetcher).toHaveBeenCalledWith(`https://openrouter.ai/api/v1/models/${JEV_MODEL}/endpoints`, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await fetchOpenRouterCatalog()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('keeps chat discovery working when the optional decision lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/endpoints')) throw new Error('unavailable')
      return { ok: true, json: async () => ({ data: [{ id: 'example/chat', name: 'Chat' }] }) }
    }))
    expect((await fetchOpenRouterCatalog()).map(e => e.id)).toEqual(['example/chat'])
  })
  it('never duplicates Jev if OpenRouter begins including it in the general list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/endpoints')
      ? { data: { id: JEV_MODEL, architecture: { output_modalities: ['decisions'] } } }
      : { data: [{ id: JEV_MODEL }] } })))
    expect((await fetchOpenRouterCatalog()).filter(e => e.id === JEV_MODEL)).toHaveLength(1)
    expect((await fetchOpenRouterCatalog())[0].decisionOnly).toBe(true)
  })
})
