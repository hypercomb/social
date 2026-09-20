import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ key: 'test-key', enabled: true, granted: true, saved: true, jevEnabled: true }))
vi.mock('@hypercomb/core', () => ({ llmKeyStore: { get: () => state.key } }))
vi.mock('./llm-activation.js', () => ({ llmActivation: { isEnabled: (id: string) => state.enabled && (!id.includes('jev') || state.jevEnabled) } }))
vi.mock('./llm-model-choice.js', () => ({ llmModelChoice: { saved: () => state.saved ? ['~typesafe/jev-latest'] : [] } }))
vi.mock('./llm-hive-access.js', () => ({ llmHiveAccess: { mayRead: () => state.granted, budget: () => 24_000 } }))
vi.mock('./llm-provider-registry.js', () => ({ publishService: () => {}, llmProviderRegistry: () => ({ get: (id: string) => ({ id, credentialsFrom: id === 'worker' ? 'openrouter' : id }) }) }))
vi.mock('./providers/openrouter-routing.js', () => ({ openRouterRouting: { get: () => ({}) }, providerBlock: () => ({ data_collection: 'deny' }) }))
const { JevDecisionService } = await import('./jev-decision.service.js')
const input = { request: 'Organize notes', doctrine: 'Preserve history.', evidence: 'These notes exist.', proposals: [{ id: 'a', label: 'Group', plan: 'Group notes.' }] }
const source = { providerId: 'worker', system: input.doctrine, messages: [{ content: input.request }, { content: input.evidence }, { content: input.proposals[0].plan }] }
const body = { model: 'resolved-jev', answers: { a_fit: { type: 'noul', noul: 1 }, a_rules: { type: 'noul', noul: 1 }, a_evidence: { type: 'noul', noul: 1 } } }
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  state.key = 'test-key'; state.enabled = true; state.granted = true; state.saved = true; state.jevEnabled = true
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('Jev OpenRouter boundary', () => {
  it('requires Jev itself to be explicitly added and enabled', async () => {
    const service = new JevDecisionService()
    state.saved = false
    expect(service.ready('worker')).toBe(false)
    await expect(service.evaluate(input, source)).rejects.toThrow()
    state.saved = true; state.jevEnabled = false
    expect(service.ready('worker')).toBe(false)
    await expect(service.test()).rejects.toThrow('Add and enable')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('tests the decision endpoint with public synthetic data and reports usage without a hive grant', async () => {
    state.granted = false
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ model: 'resolved-jev',
      answers: { blue_fit: { type: 'noul', noul: 1 }, blue_rules: { type: 'noul', noul: 1 }, blue_evidence: { type: 'noul', noul: 1 },
        red_fit: { type: 'noul', noul: 0 }, red_rules: { type: 'noul', noul: 1 }, red_evidence: { type: 'noul', noul: 1 },
        direction: { type: 'choice', choice: 'blue', confidence: 0.99, probabilities: { blue: 0.99, red: 0.01, none: 0 } } },
      usage: { input_tokens: 42, output_tokens: 0, cost: 0.000001764 },
    }) })
    const result = await new JevDecisionService().test()
    expect(result).toMatchObject({ outcome: 'selected', selected: 'blue' })
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 0, cost: 0.000001764 })
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key')
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request.state.request).toBe('Choose the blue circle.')
    expect(request.questions.direction.type).toBe('choice')
  })
  it('uses the latest alias, decisions endpoint and existing routing controls', async () => {
    expect((await new JevDecisionService().evaluate(input, source)).outcome).toBe('selected')
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: '~typesafe/jev-latest', provider: { data_collection: 'deny' }, state: input })
  })
  it('never sends another provider context or newly fetched private material', async () => {
    const service = new JevDecisionService()
    await expect(service.evaluate(input, { ...source, providerId: 'local' })).rejects.toThrow()
    await expect(service.evaluate({ ...input, evidence: 'Unshared secret' }, source)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('requires both the read grant and activation, even with a key', async () => {
    state.granted = false
    await expect(new JevDecisionService().evaluate(input, source)).rejects.toThrow()
    state.granted = true; state.enabled = false
    await expect(new JevDecisionService().evaluate(input, source)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('discards a result after access is revoked', async () => {
    fetchMock.mockImplementation(async () => { state.granted = false; return { ok: true, json: async () => body } })
    await expect(new JevDecisionService().evaluate(input, source)).rejects.toThrow('access changed')
  })
  it('does not retry a failed or malformed reply', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'OpenRouter account limit' } }) })
    await expect(new JevDecisionService().evaluate(input, source)).rejects.toThrow('HTTP 429): OpenRouter account limit')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ answers: {} }) })
    await expect(new JevDecisionService().evaluate(input, source)).rejects.toThrow()
  })
  it.each([
    [401, 'User not found.'],
    [404, 'No allowed providers are available'],
  ])('reports OpenRouter HTTP %i without retrying or treating it as a model response', async (status, message) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error: { message } }) })
    await expect(new JevDecisionService().test()).rejects.toThrow(`HTTP ${status}): ${message}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('preserves the HTTP status when OpenRouter returns a non-JSON error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('not JSON') } })
    await expect(new JevDecisionService().test()).rejects.toThrow('HTTP 502)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('honors cancellation before and during a request', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(new JevDecisionService().evaluate(input, source, controller.signal)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    const active = new AbortController()
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')))))
    const pending = new JevDecisionService().evaluate(input, source, active.signal)
    active.abort()
    await expect(pending).rejects.toThrow('Stopped')
  })
})
