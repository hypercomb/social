import { beforeAll, describe, expect, it } from 'vitest'
import { llmKeyStore } from '@hypercomb/core'

// Renders the REAL providers console in the test DOM — no build, no running
// app — to prove the key line folds into the key icon once a key is saved,
// on the one keyed row the API tab now shows: OpenRouter.
const services = new Map<string, unknown>()
const g = globalThis as unknown as { window: { ioc?: unknown } }
g.window.ioc ??= {
  register: (key: string, value: unknown) => { services.set(key, value) },
  get: <T>(key: string) => services.get(key) as T | undefined,
  whenReady: () => {},
  list: () => [...services.keys()],
}

const OPENROUTER_KEY = `sk-or-v1-${'a1'.repeat(32)}`
const $ = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector)
const heads = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hc-provider-head')]
const rowNamed = (label: string): HTMLElement | undefined => heads().find(el => el.textContent?.includes(label))
const openRouterOpen = (): void => {
  const head = rowNamed('OpenRouter')
  if (!head) throw new Error('no OpenRouter row on the API tab')
  if (!$('.hc-provider-detail')) head.click()
}
const button = (scope: string, text: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(b => b.textContent === text)!

beforeAll(async () => {
  localStorage.clear()
  await import('./providers-window.view.js')
  const view = services.get('@diamondcoreprocessor.com/ProvidersWindowView') as { open(): void }
  view.open()
  ;[...document.querySelectorAll<HTMLElement>('.hc-providers-tab')].find(t => t.textContent?.startsWith('API'))?.click()
  openRouterOpen()
})

describe('the API tab', () => {
  it('lists no direct single-vendor rows — models come through OpenRouter', () => {
    const names = heads().map(h => h.querySelector('.hc-provider-name')?.textContent)
    expect(names).toContain('OpenRouter')
    for (const vendor of ['DeepSeek', 'ChatGPT', 'Claude', 'Gemini', 'Grok', 'Mistral']) expect(names).not.toContain(vendor)
  })
})

describe('the key line and the key icon', () => {
  it('puts "Endpoint:" and the address on one line with the key icon', () => {
    const line = $('.hc-provider-endpoint')
    expect(line?.querySelector('.hc-provider-inline-label')?.textContent).toBe('Endpoint:')
    expect(line?.querySelector('.hc-provider-mono')?.textContent).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(line?.querySelector('.hc-provider-keyicon svg')).not.toBeNull()
  })

  it('shows the key line, in one row, while no key is saved', () => {
    const row = $('.hc-provider-keyrow')
    expect(row).not.toBeNull()
    expect(row?.querySelector('.hc-provider-inline-label')?.textContent).toBe('API key:')
    expect(row?.querySelectorAll('input').length).toBe(1)
    expect([...row!.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Save', 'Clear'])
    expect($('.hc-provider-keyicon')?.classList.contains('is-set')).toBe(false)
  })

  it('folds the key line into the icon on Save, reopens it from the icon, and shows it again after Clear', () => {
    $<HTMLInputElement>('.hc-provider-keyrow input')!.value = OPENROUTER_KEY
    button('.hc-provider-keyrow', 'Save').click()
    expect(llmKeyStore.has('openrouter')).toBe(true)
    expect($('.hc-provider-keyrow')).toBeNull()
    expect($('.hc-provider-keyicon')?.classList.contains('is-set')).toBe(true)

    $<HTMLButtonElement>('.hc-provider-keyicon')!.click()
    expect($('.hc-provider-keyrow')).not.toBeNull()
    expect($('.hc-provider-keyicon')?.getAttribute('aria-expanded')).toBe('true')

    button('.hc-provider-keyrow', 'Clear').click()
    expect(llmKeyStore.has('openrouter')).toBe(false)
    expect($('.hc-provider-keyrow')).not.toBeNull()
    expect($('.hc-provider-keyicon')?.classList.contains('is-set')).toBe(false)
  })

  it('refuses a key that belongs to another provider and names that provider', () => {
    $<HTMLInputElement>('.hc-provider-keyrow input')!.value = `xai-${'b2'.repeat(12)}`
    button('.hc-provider-keyrow', 'Save').click()
    expect(llmKeyStore.has('openrouter')).toBe(false)
    expect($('.hc-provider-status')?.textContent).toContain('Grok')
  })
})

describe('removing a provider', () => {
  it('never offers Remove on OpenRouter — it is a configurator, not an item', () => {
    openRouterOpen()
    expect($('.hc-provider-remove')).toBeNull()
  })

  it('removes a hand-added OpenAI-compatible provider, and Restore brings it back', async () => {
    const { llmActivation } = await import('./llm-activation.js')
    const { compileProviderSpec } = await import('./providers/provider-spec.js')
    const { registerLlmProvider } = await import('./llm-provider-registry.js')
    registerLlmProvider(compileProviderSpec({
      format: 'llm-provider@1',
      id: 'my-vllm',
      label: 'My vLLM',
      shape: 'openai',
      endpoint: 'https://vllm.example.com/v1/chat/completions',
      auth: 'bearer',
      models: [{ name: 'qwen', id: 'qwen3-32b', tier: 'balanced' }],
      defaultModel: 'qwen3-32b',
      docsUrl: 'https://vllm.example.com',
    }))
    ;[...document.querySelectorAll<HTMLElement>('.hc-providers-tab')].find(t => t.textContent?.startsWith('API'))?.click()
    rowNamed('My vLLM')!.click()
    $<HTMLButtonElement>('.hc-provider-remove')!.click()
    expect(rowNamed('My vLLM')).toBeUndefined()
    expect(llmActivation.isEnabled('my-vllm')).toBe(false)
    const removed = $('.hc-provider-removed')
    expect(removed?.textContent).toContain('My vLLM')

    removed!.querySelector<HTMLButtonElement>('button')!.click()
    expect(rowNamed('My vLLM')).toBeDefined()
    expect(llmActivation.isEnabled('my-vllm')).toBe(true)
    expect($('.hc-provider-removed')).toBeNull()
  })

  it('brings back a built-in that was removed before this rule, switched on', async () => {
    const { llmActivation } = await import('./llm-activation.js')
    const { llmProviderRemoval } = await import('./llm-provider-removal.js')
    llmProviderRemoval.remove('openrouter')
    llmActivation.setEnabled('openrouter', false)
    ;[...document.querySelectorAll<HTMLElement>('.hc-providers-tab')].find(t => t.textContent?.startsWith('API'))?.click()
    expect(rowNamed('OpenRouter')).toBeDefined()
    expect(llmProviderRemoval.isRemoved('openrouter')).toBe(false)
    expect(llmActivation.isEnabled('openrouter')).toBe(true)
  })
})

describe('the price-stage track on OpenRouter', () => {
  it('shows three stops, and an arrow key moves one without crossing its neighbour', async () => {
    const { openRouterStages } = await import('./providers/openrouter-stages.js')
    openRouterStages.set({ fast: 0.1, balanced: 0.2, deep: 0.3 })
    ;[...document.querySelectorAll<HTMLElement>('.hc-providers-tab')].find(t => t.textContent?.startsWith('API'))?.click()
    openRouterOpen()
    const stops = [...document.querySelectorAll<HTMLButtonElement>('.hc-provider-stage-stop')]
    expect(stops.map(stop => stop.getAttribute('aria-valuetext'))).toEqual(['$0.10', '$0.20', '$0.30'])
    expect($('.hc-provider-stage-legend')?.textContent).toContain('≤ $0.20')

    stops[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(openRouterStages.get().balanced).toBe(0.22)
    for (let i = 0; i < 10; i++) {
      document.querySelectorAll<HTMLButtonElement>('.hc-provider-stage-stop')[1]!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    }
    expect(openRouterStages.get().balanced).toBe(0.3) // stopped at the deep stop
  })
})
