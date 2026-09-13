import { beforeAll, describe, expect, it, vi } from 'vitest'

// Drives the REAL providers console in the test DOM through the flow Jaime
// asked for: search a brand, then a model; the search closes into one line
// under OpenRouter; OpenRouter's own row is only the endpoint and key.
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
  await import('./providers-window.view.js')
  choice = (await import('./llm-model-choice.js')).llmModelChoice
  const view = services.get('@diamondcoreprocessor.com/ProvidersWindowView') as { open(): void }
  view.open()
  $$<HTMLElement>('.hc-providers-tab').find(t => t.textContent?.startsWith('API'))?.click()
})

describe('adding a model through the search', () => {
  it('lists brands, then that brand’s models, then closes into one line under OpenRouter', async () => {
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

    expect($('.hc-provider-pick')).toBeNull()
    expect(search().value).toBe('')
    expect(choice.chosen('openrouter')).toBe('anthropic/claude-sonnet-4.5')
    const line = $('.hc-provider-model-row')
    expect(line?.querySelector('.hc-provider-name')?.textContent).toBe('Claude Sonnet 4.5')
    expect(line?.querySelector('.hc-provider-state')?.textContent).toBe('active')
    // one line is not a crowd: no domain search yet
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
    expect(words).toEqual(['Test', 'Hosts', 'Remove']) // no "Use": it is already in use

    $$<HTMLButtonElement>('.hc-provider-model-row .hc-provider-link').find(b => b.textContent === 'Hosts')!.click()
    await vi.waitFor(() => expect($('.hc-provider-host')?.textContent).toContain('Anthropic'))

    $$<HTMLButtonElement>('.hc-provider-model-row .hc-provider-link').find(b => b.textContent === 'Remove')!.click()
    expect($('.hc-provider-model-row')).toBeNull()
    expect(choice.saved('openrouter')).toEqual([])
    expect(choice.chosen('openrouter')).toBeUndefined()
  })
})

describe('a domain is an accordion with its own search', () => {
  it('hides its lines while closed, and past five lines filters them in place as you type', async () => {
    const { llmModelChoice } = await import('./llm-model-choice.js')
    for (const id of ['a/alpha', 'b/beta', 'c/gamma', 'd/delta', 'e/epsilon', 'f/zeta', 'g/haiku-one']) {
      llmModelChoice.add('openrouter', id)
    }
    // close the domain, then open it
    while ($('.hc-provider-domain') || $('.hc-provider-detail')) head('OpenRouter')!.click()
    expect($('.hc-provider-model-row')).toBeNull()
    head('OpenRouter')!.click()

    const box = $('.hc-provider-domain')!
    const input = box.querySelector<HTMLInputElement>('.hc-provider-domain-search')!
    expect(input.placeholder).toBe('Search 7 models')
    input.value = 'haiku'
    input.dispatchEvent(new Event('input'))
    const shown = $$<HTMLElement>('.hc-provider-domain .hc-provider-model-row').filter(row => !row.hidden)
    expect(shown.map(row => row.querySelector('.hc-provider-name')?.textContent)).toEqual(['g/haiku-one'])
    expect(input.isConnected).toBe(true) // filtered in place: no redraw took the box away

    // opening a line keeps the domain open, and the filter survives the redraw
    head('g/haiku-one')!.click()
    expect($<HTMLInputElement>('.hc-provider-domain-search')?.value).toBe('haiku')
    head('g/haiku-one')!.click()
    expect($('.hc-provider-domain')).not.toBeNull()
  })
})
