import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus, llmKeyStore } from '@hypercomb/core'

// A pool in memory, served by the one Store key the ledger asks for.
const memoryDir = () => {
  const files = new Map<string, ArrayBuffer>()
  const fileHandle = (name: string) => ({
    kind: 'file' as const,
    getFile: async () => {
      const bytes = files.get(name)
      if (!bytes) throw new DOMException('gone', 'NotFoundError')
      return { size: bytes.byteLength, text: async () => new TextDecoder().decode(bytes) }
    },
    createWritable: async () => {
      let staged: ArrayBuffer = new ArrayBuffer(0)
      return { write: async (chunk: ArrayBuffer) => { staged = chunk }, close: async () => { files.set(name, staged) } }
    },
  })
  return {
    files,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError')
        files.set(name, new ArrayBuffer(0))
      }
      return fileHandle(name)
    },
    entries: async function* () { for (const name of [...files.keys()]) yield [name, fileHandle(name)] as const },
  }
}

const requests = memoryDir()
const store = { getPool: async (meaning: string) => (meaning === 'agent:model-requests' ? requests : null) }
const g = globalThis as unknown as { window: { ioc?: unknown } }
g.window.ioc = {
  register: () => {},
  get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined),
  whenReady: () => {},
  list: () => [],
}

const { llmModelChoice } = await import('./llm-model-choice.js')
const { llmProviderRegistry } = await import('./llm-provider-registry.js')
;(await import('./providers/builtin-providers.js')).startBuiltinLlmProviders()
const { instanceId } = await import('./providers/openrouter-instances.js')
const { CHAT_NEED, candidatesFor, rankProviders } = await import('./model-policy.js')
const { routeCandidates } = await import('./llm-dispatch.js')
const { clearOpenRouterCatalogCache, fetchOpenRouterCatalog } = await import('./providers/openrouter-catalog.js')
const { ModelQueenBee, catalogueCheck } = await import('./models.queen.js')
const { MODEL_REQUESTS_POOL, listModelRequests, modelRequestRecord, startModelRequestLedger, stopModelRequestLedger } = await import('./model-requests.js')

type Runnable = { execute(args: string): Promise<void> }
const queen = (): Runnable => new ModelQueenBee() as unknown as Runnable

const FLASH = 'deepseek/deepseek-v4-flash-0731'
const SONNET = 'anthropic/claude-sonnet-4.5'
const KEY = `sk-or-v1-${'c3'.repeat(32)}`

const heard = (name: string): unknown[] => {
  const seen: unknown[] = []
  EffectBus.on(name, payload => { seen.push(payload) })
  return seen
}
const lastToast = (toasts: unknown[]): string => String((toasts.at(-1) as { message?: string } | undefined)?.message ?? '')

beforeEach(() => {
  for (const model of llmModelChoice.saved('openrouter')) llmModelChoice.drop('openrouter', model)
  llmKeyStore.set('openrouter', KEY)
  requests.files.clear()
})
afterEach(() => { stopModelRequestLedger(); llmKeyStore.clear('openrouter'); clearOpenRouterCatalogCache() })

/** A priced catalogue, as the providers console loads it. Dollars per token. */
const loadCatalogue = async (rows: readonly { id: string; out: string }[]): Promise<void> => {
  const data = rows.map(row => ({ id: row.id, name: row.id, pricing: { prompt: row.out, completion: row.out }, context_length: 200_000 }))
  ;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200, json: async () => ({ data }) })
  clearOpenRouterCatalogCache()
  await fetchOpenRouterCatalog()
}

describe('a model line added for a weight of work', () => {
  it('takes only that weight, and the everyday model stays in use', async () => {
    llmModelChoice.add('openrouter', FLASH)
    await queen().execute(`add ${SONNET} deep`)

    expect(llmModelChoice.saved('openrouter')).toEqual([FLASH, SONNET])
    expect(llmModelChoice.chosen('openrouter')).toBe(FLASH)
    expect(llmModelChoice.tierOf('openrouter', SONNET)).toBe('deep')
    const line = llmProviderRegistry().get(instanceId(SONNET))
    expect(line?.models.map(model => model.tier)).toEqual(['deep'])

    // Everyday work never reaches the strong line at all; deep work can. The
    // said tier is a requirement, not a rank: fast, balanced and work that
    // states no weight (balanced) are never the strong line's to take.
    expect(line?.onlyTier).toBe('deep')
    for (const need of [{ tier: 'fast' as const }, { tier: 'balanced' as const }, {}, CHAT_NEED]) {
      const ids = candidatesFor(need).map(provider => provider.id)
      expect(ids).toContain(instanceId(FLASH))
      expect(ids).not.toContain(instanceId(SONNET))
    }
    expect(candidatesFor({ tier: 'deep' }).map(provider => provider.id)).toContain(instanceId(SONNET))
  })

  it('never wins everyday work on price, and is still reached by name', async () => {
    // One cheap line and one strong line said deep, both priced: the state in
    // which the strong line used to be the middle price, and so the balanced pick.
    await loadCatalogue([{ id: FLASH, out: '0.00000008' }, { id: SONNET, out: '0.000015' }])
    llmModelChoice.add('openrouter', FLASH)
    await queen().execute(`add ${SONNET} deep`)
    expect(llmProviderRegistry().get(instanceId(FLASH))?.models.map(model => model.tier)).toEqual(['fast'])

    const lines = (need: Parameters<typeof rankProviders>[0]): string[] =>
      rankProviders(need).filter(provider => provider.credentialsFrom === 'openrouter').map(provider => provider.id)
    for (const need of [{}, { tier: 'balanced' as const }, { tier: 'fast' as const }, CHAT_NEED]) {
      expect(lines(need)).toEqual([instanceId(FLASH)])
    }
    expect(lines({ tier: 'deep' })[0]).toBe(instanceId(SONNET))
    // The last model does not keep its place for lighter work either…
    expect(routeCandidates({ need: { tier: 'balanced' }, preferModel: SONNET, fallbackWithin: 'openrouter' }).map(provider => provider.id)).toEqual([instanceId(FLASH)])
    // …but the participant saying its name is not the policy picking it.
    expect(routeCandidates({ model: SONNET, need: { tier: 'balanced' } }).map(provider => provider.id)).toEqual([instanceId(SONNET)])
    expect(routeCandidates({ providerId: instanceId(SONNET), need: {} }).map(provider => provider.id)).toEqual([instanceId(SONNET)])
  })

  it('is confined even when its price already placed it in the tier it was said for', async () => {
    const { openRouterStages } = await import('./providers/openrouter-stages.js')
    await loadCatalogue([{ id: FLASH, out: '0.00000008' }, { id: SONNET, out: '0.000015' }])
    openRouterStages.set({ fast: 0.1, balanced: 1, deep: 20 }) // Sonnet's price is the deep stage
    try {
      llmModelChoice.add('openrouter', FLASH)
      llmModelChoice.add('openrouter', SONNET, false)
      expect(llmProviderRegistry().get(instanceId(SONNET))?.onlyTier).toBeUndefined()
      expect(candidatesFor({}).map(provider => provider.id)).toContain(instanceId(SONNET))
      // Saying the tier changes no model on the line — only what it may take.
      await queen().execute(`add ${SONNET} deep`)
      expect(llmProviderRegistry().get(instanceId(SONNET))?.onlyTier).toBe('deep')
      expect(candidatesFor({}).map(provider => provider.id)).not.toContain(instanceId(SONNET))
    } finally {
      localStorage.removeItem('hc:llm:openrouter:stages')
    }
  })

  it('goes with its said tier when it is dropped', async () => {
    await queen().execute(`add ${SONNET} deep`)
    await queen().execute(`drop ${SONNET}`)
    expect(llmModelChoice.saved('openrouter')).toEqual([])
    expect(llmModelChoice.tierOf('openrouter', SONNET)).toBeUndefined()
    expect(llmProviderRegistry().get(instanceId(SONNET))).toBeUndefined()
  })

  it('a line added with no tier is placed as it always was', async () => {
    await queen().execute(`add ${SONNET}`)
    expect(llmModelChoice.tierOf('openrouter', SONNET)).toBeUndefined()
    expect(llmProviderRegistry().get(instanceId(SONNET))?.models.map(model => model.tier).sort()).toEqual(['balanced', 'deep', 'fast'])
  })
})

describe('the model word', () => {
  it('lists the lines, and says how to add when asked for nothing or a batch model', async () => {
    const toasts = heard('toast:show')
    llmModelChoice.add('openrouter', FLASH)
    await queen().execute(`add ${SONNET} deep`)
    await queen().execute('')
    expect(lastToast(toasts)).toContain(FLASH)
    expect(lastToast(toasts)).toContain(`${SONNET} (deep, said`)

    await queen().execute('add')
    expect(lastToast(toasts)).toContain('Say which')
    await queen().execute('add openai/gpt-4.1-nano:batch')
    expect(lastToast(toasts)).toContain('batch model')
    await queen().execute('drop nobody/nothing')
    expect(lastToast(toasts)).toContain('not on the list')
  })

  it('completes its words, the lines it can drop, the catalogue and the tiers — each offer the word being typed', async () => {
    const THINKING = `${SONNET}:thinking`
    await loadCatalogue([{ id: FLASH, out: '0.00000008' }, { id: SONNET, out: '0.000015' }, { id: THINKING, out: '0.000015' }])
    llmModelChoice.add('openrouter', FLASH)
    llmModelChoice.add('openrouter', SONNET, false)
    llmModelChoice.add('openrouter', THINKING, false)
    const bee = new ModelQueenBee()
    expect(bee.slashComplete('')).toEqual(['add ', 'drop ', 'requests', 'request '])
    expect(bee.slashComplete('dr')).toEqual(['drop '])
    // The command line writes an offer over the last word of the line, so an
    // offer is the id alone — whole, dots and all — never `drop <id>`.
    expect(bee.slashComplete('drop deep')).toEqual([FLASH])
    expect(bee.slashComplete('drop anth')).toEqual([SONNET, THINKING])
    expect(bee.slashComplete('drop ')).toEqual([FLASH, SONNET, THINKING])
    expect(bee.slashComplete('add sonnet')).toEqual([SONNET, THINKING])
    // An id typed whole is finished: Enter must not turn it into its variant.
    expect(bee.slashComplete(`drop ${SONNET}`)).toEqual([])
    expect(bee.slashComplete(`add ${SONNET}`)).toEqual([])
    expect(bee.slashComplete(`add ${SONNET} de`)).toEqual(['deep'])
    expect(bee.slashComplete('request a planner that can drop a')).toEqual([])
  })

  it('keeps everything after the word verbatim', () => {
    expect(new ModelQueenBee().rawArgs).toBe(true)
  })
})

describe('a spelling the catalogue forgives', () => {
  const OPUS = 'anthropic/claude-opus-4.1'
  const LATEST = '~anthropic/claude-opus-latest'

  it('is saved as the catalogue spells it, so its price still places the line', async () => {
    await loadCatalogue([{ id: OPUS, out: '0.000075' }, { id: LATEST, out: '0.000075' }])
    expect(catalogueCheck(OPUS)).toEqual({ known: true, loaded: true, near: [], id: OPUS })
    expect(catalogueCheck('Anthropic/Claude-Opus-4.1').id).toBe(OPUS)
    expect(catalogueCheck('anthropic/claude-opus-latest').id).toBe(LATEST)
    expect(catalogueCheck('anthropic/claude-nothing')).toMatchObject({ known: false, loaded: true })
    expect(catalogueCheck('anthropic/claude-nothing').id).toBeUndefined()

    const added = heard('model:added')
    await queen().execute('add Anthropic/Claude-Opus-4.1')
    await queen().execute('add anthropic/claude-opus-latest')
    expect(llmModelChoice.saved('openrouter')).toEqual([OPUS, LATEST])
    // (The bus replays its last value to a late listener, hence the tail.)
    expect(added.slice(-2)).toEqual([{ model: OPUS }, { model: LATEST }])
    // Priced above the last stage: held back exactly as the exact id is,
    // where the typed spelling was an unpriced line offering every tier.
    expect(llmProviderRegistry().get(instanceId(OPUS))).toBeUndefined()
    expect(llmProviderRegistry().get(instanceId(LATEST))).toBeUndefined()
    expect(llmProviderRegistry().get(instanceId('Anthropic/Claude-Opus-4.1'))).toBeUndefined()

    // Said for a tier, the same spelling carries the tier to the saved id.
    await queen().execute('add Anthropic/Claude-Opus-4.1 deep')
    expect(llmModelChoice.tierOf('openrouter', OPUS)).toBe('deep')
    const held = llmProviderRegistry().get(instanceId(OPUS))?.models[0]
    expect(held).toMatchObject({ id: OPUS, tier: 'deep' })
    expect(held?.outputPerMillion).toBeCloseTo(75)
  })

  it('drops the line by the same spelling', async () => {
    await loadCatalogue([{ id: LATEST, out: '0.000075' }])
    await queen().execute('add anthropic/claude-opus-latest')
    expect(llmModelChoice.saved('openrouter')).toEqual([LATEST])
    await queen().execute('drop Anthropic/Claude-Opus-Latest')
    expect(llmModelChoice.saved('openrouter')).toEqual([])
  })

  it('keeps the id as typed when there is no catalogue to ask', async () => {
    expect(catalogueCheck(SONNET)).toEqual({ known: false, loaded: false, near: [] })
    await queen().execute(`add ${SONNET}`)
    expect(llmModelChoice.saved('openrouter')).toEqual([SONNET])
  })
})

describe('work that asks for a stronger model', () => {
  it('is filed off the bus, once, and read back newest first', async () => {
    startModelRequestLedger()
    EffectBus.emit('agent:model-request', { id: 'b', convoId: 'chat:a', leg: 1, at: 1_000, from: 'deepseek-v4-flash', needs: 'a  proof over\nthree files', tier: 'deep', harness: 'h'.repeat(64) })
    EffectBus.emit('agent:model-request', { id: 'b', convoId: 'chat:b', leg: 1, at: 2_000, from: 'deepseek-v4-flash', needs: 'long planning', tier: 'deep' })
    await new Promise(resolve => setTimeout(resolve, 20))
    const listed = await listModelRequests()
    expect(listed.map(request => request.needs)).toEqual(['long planning', 'a proof over three files'])
    expect(listed[1]).toEqual(modelRequestRecord({ convoId: 'chat:a', at: 1_000, from: 'deepseek-v4-flash', needs: 'a proof over three files', tier: 'deep', harness: 'h'.repeat(64) }))
    expect(MODEL_REQUESTS_POOL).toBe('agent:model-requests')
  })

  it('the word files one by hand and reads them', async () => {
    startModelRequestLedger()
    const toasts = heard('toast:show')
    await queen().execute('requests')
    expect(lastToast(toasts)).toContain('No work has asked')
    await queen().execute('request the level editor needs a planner that holds forty files')
    await new Promise(resolve => setTimeout(resolve, 20))
    await queen().execute('requests')
    expect(lastToast(toasts)).toContain('the participant: the level editor needs a planner that holds forty files')
    expect(lastToast(toasts)).toContain('models add <model id> deep')
    await queen().execute('')
    // The bus replays the last request to a late ledger, so the count is not one.
    expect(lastToast(toasts)).toMatch(/[0-9]+ requests for a stronger model/)
  })
})
