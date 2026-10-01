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
const { candidatesFor } = await import('./model-policy.js')
const { ModelQueenBee } = await import('./models.queen.js')
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
afterEach(() => { stopModelRequestLedger(); llmKeyStore.clear('openrouter') })

describe('a model line added for a weight of work', () => {
  it('takes only that weight, and the everyday model stays in use', async () => {
    llmModelChoice.add('openrouter', FLASH)
    await queen().execute(`add ${SONNET} deep`)

    expect(llmModelChoice.saved('openrouter')).toEqual([FLASH, SONNET])
    expect(llmModelChoice.chosen('openrouter')).toBe(FLASH)
    expect(llmModelChoice.tierOf('openrouter', SONNET)).toBe('deep')
    const line = llmProviderRegistry().get(instanceId(SONNET))
    expect(line?.models.map(model => model.tier)).toEqual(['deep'])

    // Everyday work never reaches the strong line first; deep work can.
    const fast = candidatesFor({ tier: 'fast' }).map(provider => provider.id)
    expect(fast.indexOf(instanceId(FLASH))).toBeGreaterThanOrEqual(0)
    expect(fast.indexOf(instanceId(FLASH))).toBeLessThan(fast.indexOf(instanceId(SONNET)) < 0 ? Infinity : fast.indexOf(instanceId(SONNET)))
    expect(candidatesFor({ tier: 'deep' }).map(provider => provider.id)).toContain(instanceId(SONNET))
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

  it('completes its words and the lines it can drop', () => {
    llmModelChoice.add('openrouter', FLASH)
    const bee = new ModelQueenBee()
    expect(bee.slashComplete('')).toEqual(['add ', 'drop ', 'requests', 'request '])
    expect(bee.slashComplete('drop deep')).toEqual([`drop ${FLASH}`])
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
