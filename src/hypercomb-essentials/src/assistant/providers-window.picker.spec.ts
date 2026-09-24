import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

// Drives the REAL providers console in the test DOM through the flow Jaime
// asked for: search a brand, then its models; each pick lands as one line
// under OpenRouter while the brand's list stays open for more, until Esc or ×;
// OpenRouter's own row is only the endpoint and key.
const services = new Map<string, unknown>()
const g = globalThis as unknown as { window: { ioc?: unknown }; fetch: typeof fetch }
g.window.ioc ??= {
  register: (key: string, value: unknown) => { services.set(key, value) },
  get: <T>(key: string) => services.get(key) as T | undefined,
  whenReady: () => {},
  list: () => [...services.keys()],
}

const CATALOGUE = {
  data: [
    { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'anthropic/claude-haiku-4.5', name: 'Anthropic: Claude Haiku 4.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
    { id: 'deepseek/deepseek-v4-flash-0731', name: 'DeepSeek: DeepSeek V4 Flash 0731', pricing: { prompt: '0.00000005', completion: '0.00000016' } },
  ],
}
const HOSTS = { data: { endpoints: [
  { tag: 'anthropic', provider_name: 'Anthropic', pricing: { prompt: '0.000003', completion: '0.000015' }, uptime_last_30m: 100 },
] } }
g.fetch = vi.fn(async (url: unknown) => ({
  ok: true, status: 200,
  json: async () => (String(url).includes('/endpoints') ? HOSTS : CATALOGUE),
})) as unknown as typeof fetch

const $ = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector)
const $$ = <T extends Element>(selector: string): T[] => [...document.querySelectorAll<T>(selector)]
const search = (): HTMLInputElement => $<HTMLInputElement>('.hc-providers-search')!
const type = (value: string): void => {
  search().value = value
  search().dispatchEvent(new Event('input'))
}
const pickItem = (text: string): HTMLButtonElement | undefined =>
  $$<HTMLButtonElement>('.hc-provider-pick-item').find(el => el.textContent?.includes(text))
const head = (text: string): HTMLElement | undefined =>
  $$<HTMLElement>('.hc-provider-head').find(el => el.textContent?.includes(text))

let choice: { chosen(id: string): string | undefined; saved(id: string): readonly string[] }

beforeAll(async () => {
  localStorage.clear()
  await import('./llm.drone.js')   // the llm bee registers the roster (atomic-modules-plan.md)
  choice = (await import('./llm-model-choice.js')).llmModelChoice
  // Wide stages for the flow tests; the cap has its own test below.
  ;(await import('./providers/openrouter-stages.js')).openRouterStages.set({ fast: 1, balanced: 5, deep: 20 })
  // The console arrives with its first open: the words' door loads it, and
  // the bus's replay of that press opens it.
  EffectBus.emit('providers:open', {})
  await vi.waitFor(() => expect($('.hc-providers')).not.toBeNull(), { timeout: 10_000 })
  $$<HTMLElement>('.hc-providers-tab').find(t => t.textContent?.startsWith('API'))?.click()
})

describe('adding a model through the search', () => {
  it('lists brands, then that brand’s models, adds several in one go, and × closes the list', async () => {
    type('anthropic')
    await vi.waitFor(() => expect(pickItem('Anthropic')).toBeDefined())
    expect(pickItem('Anthropic')!.textContent).toContain('2 models')

    pickItem('Anthropic')!.click()
    expect(search().value).toBe('')
    expect(search().placeholder).toBe('Search Anthropic models')
    expect($('.hc-provider-pick-chip')?.textContent).toContain('Anthropic')

    type('sonnet')
    expect(pickItem('Claude Sonnet 4.5')!.textContent).toContain('$3 in · $15 out /M')
    pickItem('Claude Sonnet 4.5')!.click()

    // the brand's list stays open, the pick is marked, and its line is already in the list
    expect($('.hc-provider-pick-chip')?.textContent).toContain('Anthropic')
    expect(search().value).toBe('sonnet')
    expect(pickItem('Claude Sonnet 4.5')!.textContent).toContain('added')
    expect(choice.chosen('openrouter')).toBe('anthropic/claude-sonnet-4.5')
    const line = $('.hc-provider-model-row')
    expect(line?.querySelector('.hc-provider-name')?.textContent).toBe('Claude Sonnet 4.5')
    // the line is a provider of its own, paying with OpenRouter's key
    const { llmProviderRegistry } = await import('./llm-provider-registry.js')
    expect(llmProviderRegistry().get('openrouter:anthropic/claude-sonnet-4.5')?.credentialsFrom).toBe('openrouter')

    // clicking an added model again adds nothing
    pickItem('Claude Sonnet 4.5')!.click()
    expect(choice.saved('openrouter')).toEqual(['anthropic/claude-sonnet-4.5'])

    // a second model of the same brand, without searching for the brand again
    type('haiku')
    pickItem('Claude Haiku 4.5')!.click()
    expect($$('.hc-provider-model-row').map(row => row.querySelector('.hc-provider-name')?.textContent))
      .toEqual(['Claude Sonnet 4.5', 'Claude Haiku 4.5'])
    expect(choice.saved('openrouter')).toEqual(['anthropic/claude-sonnet-4.5', 'anthropic/claude-haiku-4.5'])
    // one divider labels the company, above both of its lines
    expect($$('.hc-provider-domain > .hc-provider-company').map(d => d.textContent)).toEqual(['Anthropic'])
    expect($('.hc-provider-domain')!.firstElementChild?.classList.contains('hc-provider-company')).toBe(true)
    expect(llmProviderRegistry().get('openrouter:anthropic/claude-haiku-4.5')?.credentialsFrom).toBe('openrouter')

    // × closes the list; the lines stay
    $$<HTMLButtonElement>('.hc-provider-pick-chip .hc-provider-link')[0]!.click()
    expect($('.hc-provider-pick')).toBeNull()
    expect(search().value).toBe('')
    expect($$('.hc-provider-model-row')).toHaveLength(2)
    // two lines are not a crowd: no domain search yet
    expect($('.hc-provider-domain-search')).toBeNull()
  })

  it('keeps the OpenRouter row to the endpoint and key — no guide, no catalogue, no roster chips', () => {
    head('OpenRouter')!.click()
    const detail = head('OpenRouter')!.parentElement!.querySelector('.hc-provider-detail')!
    expect(detail.querySelector('.hc-provider-endpoint')).not.toBeNull()
    expect(detail.querySelector('.hc-provider-keyrow')).not.toBeNull()
    expect(detail.querySelector('.hc-provider-pick, .hc-provider-catalog, .hc-provider-models, ol')).toBeNull()
  })

  it('opens a model line to words — Test, Hosts, Remove — with a host checklist, and Remove takes the line away', async () => {
    head('Claude Sonnet 4.5')!.click()
    const words = $$<HTMLButtonElement>('.hc-provider-model-row .hc-provider-links .hc-provider-link').map(b => b.textContent)
    expect(words).toEqual(['Test', 'Hosts', 'Remove']) // no "Use": every added model is usable at once
    // like every provider, a model line can be taken out of what the orchestrator may pick
    expect($('.hc-provider-model-row .hc-provider-toggle')?.textContent).toContain('Available to the orchestrator')

    $$<HTMLButtonElement>('.hc-provider-model-row .hc-provider-link').find(b => b.textContent === 'Hosts')!.click()
    await vi.waitFor(() => expect($('.hc-provider-host')?.textContent).toContain('Anthropic'))

    $$<HTMLButtonElement>('.hc-provider-model-row .hc-provider-link').find(b => b.textContent === 'Remove')!.click()
    expect($$('.hc-provider-model-row').map(row => row.querySelector('.hc-provider-name')?.textContent))
      .toEqual(['Claude Haiku 4.5'])
    expect(choice.saved('openrouter')).toEqual(['anthropic/claude-haiku-4.5'])

    head('Claude Haiku 4.5')!.click()
    $$<HTMLButtonElement>('.hc-provider-model-row .hc-provider-link').find(b => b.textContent === 'Remove')!.click()
    expect($('.hc-provider-model-row')).toBeNull()
    expect(choice.saved('openrouter')).toEqual([])
    expect(choice.chosen('openrouter')).toBeUndefined()
  })
})

describe('the added models are one flat list under company headers', () => {
  it('shows every line without opening OpenRouter, and past five lines filters them in place as you type', async () => {
    const { llmModelChoice } = await import('./llm-model-choice.js')
    for (const id of ['a/alpha', 'b/beta', 'c/gamma', 'd/delta', 'e/epsilon', 'f/zeta', 'g/haiku-one']) {
      llmModelChoice.add('openrouter', id)
    }
    // open OpenRouter and close it again: nothing is open, and every line is still in view
    head('OpenRouter')!.click()
    head('OpenRouter')!.click()
    expect($('.hc-provider-detail')).toBeNull()
    expect($$('.hc-provider-model-row')).toHaveLength(7)
    expect($$('.hc-provider-company')).toHaveLength(7)

    const box = $('.hc-provider-domain')!
    // not nested under OpenRouter: the list stands before its row
    expect(box.compareDocumentPosition(head('OpenRouter')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const input = box.querySelector<HTMLInputElement>('.hc-provider-domain-search')!
    expect(input.placeholder).toBe('Search 7 models')
    input.value = 'haiku'
    input.dispatchEvent(new Event('input'))
    const shown = $$<HTMLElement>('.hc-provider-domain .hc-provider-model-row').filter(row => !row.hidden)
    expect(shown.map(row => row.querySelector('.hc-provider-name')?.textContent)).toEqual(['g/haiku-one'])
    // a company whose lines are all filtered out loses its divider too
    expect($$<HTMLElement>('.hc-provider-domain .hc-provider-company').filter(d => !d.hidden).map(d => d.textContent)).toEqual(['g'])
    expect(input.isConnected).toBe(true) // filtered in place: no redraw took the box away

    // opening a line keeps the domain open, and the filter survives the redraw
    head('g/haiku-one')!.click()
    expect($<HTMLInputElement>('.hc-provider-domain-search')?.value).toBe('haiku')
    head('g/haiku-one')!.click()
    expect($('.hc-provider-domain')).not.toBeNull()
  })
})

describe('price stages cap the list', () => {
  it('leaves models above the last stop out of the search, and says how many', async () => {
    const { openRouterStages } = await import('./providers/openrouter-stages.js')
    openRouterStages.set({ fast: 1, balanced: 5, deep: 10 }) // Sonnet ($15) is now above the cap
    type('anthropic')
    await vi.waitFor(() => expect(pickItem('Anthropic')).toBeDefined())
    expect(pickItem('Anthropic')!.textContent).toContain('1 model')
    expect($('.hc-provider-pick')?.textContent).toContain('1 more above your price stages')
    pickItem('Anthropic')!.click()
    expect(pickItem('Claude Haiku 4.5')).toBeDefined()
    expect(pickItem('Claude Sonnet 4.5')).toBeUndefined()
    $$<HTMLButtonElement>('.hc-provider-pick-chip .hc-provider-link')[0]?.click()
    openRouterStages.set({ fast: 1, balanced: 5, deep: 20 })
  })
})
