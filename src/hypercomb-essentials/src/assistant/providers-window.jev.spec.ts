import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { llmKeyStore } from '@hypercomb/core'
import { JEV_MODEL } from './jev-decision.js'

const services = new Map<string, unknown>()
window.ioc ??= {
  register: (key: string, value: unknown) => { services.set(key, value) },
  get: <T>(key: string) => services.get(key) as T | undefined,
  whenReady: () => {}, list: () => [...services.keys()],
} as typeof window.ioc
const buttons = (selector: string): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(selector)]
const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => {
  if (url.endsWith('/endpoints')) return { data: { id: JEV_MODEL, name: 'TypeSafe: Jev Latest', architecture: { output_modalities: ['decisions'] } } }
  if (url.endsWith('/decisions')) return { model: 'jev-test-resolved',
    answers: { blue_toward: { type: 'noul', noul: 1 }, blue_beyond: { type: 'noul', noul: 0 }, blue_grounded: { type: 'noul', noul: 1 }, blue_rule0: { type: 'noul', noul: 0 },
      red_toward: { type: 'noul', noul: 0 }, red_beyond: { type: 'noul', noul: 0 }, red_grounded: { type: 'noul', noul: 1 }, red_rule0: { type: 'noul', noul: 0 },
      next: { type: 'choice', choice: 'blue', confidence: 0.99, probabilities: { blue: 0.99, red: 0.01, none: 0 } } },
    usage: { input_tokens: 48, output_tokens: 0, cost: 0.000002016 },
  }
  return { data: [] }
} }))
beforeAll(async () => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetcher)
  await import('./providers-window.view.js')
  llmKeyStore.set('openrouter', `sk-or-v1-${'a1'.repeat(32)}`)
  ;(services.get('@diamondcoreprocessor.com/ProvidersWindowView') as { open(): void }).open()
  buttons('.hc-providers-tab').find(b => b.textContent?.startsWith('API'))!.click()
})
afterAll(() => vi.unstubAllGlobals())
describe('Jev in the existing provider console', () => {
  it('discovers, adds, toggles and tests Jev without sending chat completions', async () => {
    const search = document.querySelector<HTMLInputElement>('.hc-providers-search input, input.hc-providers-search, .hc-providers-search')!
    expect(search).not.toBeNull()
    search.value = 'jev'
    search.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(buttons('.hc-provider-pick-item').some(b => b.textContent?.includes('TypeSafe'))).toBe(true))
    buttons('.hc-provider-pick-item').find(b => b.textContent?.includes('TypeSafe'))!.click()
    buttons('.hc-provider-pick-item').find(b => b.textContent?.includes('Jev Latest'))!.click()
    const { llmModelChoice } = await import('./llm-model-choice.js')
    expect(llmModelChoice.saved('openrouter')).toContain(JEV_MODEL)
    expect(llmModelChoice.chosen('openrouter')).toBeUndefined()
    buttons('.hc-provider-head').find(b => b.textContent?.includes('Jev Latest'))!.click()
    expect(document.body.textContent).toContain('Decisions · evaluates directions and actions')
    expect(document.body.textContent).toContain('Jev mode for chat: off — let OpenRouter read the hive')
    const { llmHiveAccess } = await import('./llm-hive-access.js')
    llmHiveAccess.setMayRead('openrouter', true)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Jev mode for chat: on'))
    llmHiveAccess.setMayRead('openrouter', false)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Jev mode for chat: off'))
    const row = document.querySelector('.hc-provider-model-row .hc-provider-detail')!
    const toggle = row.querySelector<HTMLInputElement>('input[type=checkbox]')!
    expect(toggle.checked).toBe(true)
    const stateWord = () => row.querySelector('.hc-provider-model-line .hc-provider-state')?.textContent
    expect(stateWord()).toBe('active')
    toggle.checked = false; toggle.dispatchEvent(new Event('change'))
    const { jevDecision } = await import('./jev-decision.service.js')
    expect(jevDecision.enabled()).toBe(false)
    expect(document.querySelector('.hc-provider-model-row .hc-provider-model-line .hc-provider-state')?.textContent).toBe('off')
    expect(document.body.textContent).toContain('Jev mode for chat: off — switch it on above')
    const enabled = document.querySelector<HTMLInputElement>('.hc-provider-model-row input[type=checkbox]')!
    enabled.checked = true; enabled.dispatchEvent(new Event('change'))
    buttons('.hc-provider-model-row .hc-provider-link').find(b => b.textContent === 'Test')!.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('48 input / 0 output tokens'))
    expect(document.body.textContent).toContain('$0.000002016')
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/chat/completions'))).toBe(false)
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/decisions'))).toBe(true)
  })
})
