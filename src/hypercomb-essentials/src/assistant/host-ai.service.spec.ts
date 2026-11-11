import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: { register(): void } }).ioc = { register: () => { /* noop */ } }
})

import { AI_HOST_DEFAULT, AI_HOST_STORAGE_KEY, HostAiService } from './host-ai.service.js'

describe('HostAiService participant configuration', () => {
  beforeEach(() => localStorage.removeItem(AI_HOST_STORAGE_KEY))

  it('does not treat the bundled fallback endpoint as participant setup', () => {
    const service = new HostAiService()
    expect(service.host).toBe(AI_HOST_DEFAULT)
    expect(service.configured).toBe(false)
  })

  it('becomes configured only after a host is explicitly stored', () => {
    const service = new HostAiService()
    service.setHost('https://ai.example.com/')
    expect(service.host).toBe('ai.example.com')
    expect(service.configured).toBe(true)

    service.setHost('')
    expect(service.host).toBe(AI_HOST_DEFAULT)
    expect(service.configured).toBe(false)
  })
})

// A try- door holds no key and signs nothing: its host is the door itself,
// asked unsigned at the door's own origin.
describe('HostAiService at a try- door', () => {
  const sse = (text: string): Response => new Response(
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  )

  beforeEach(() => {
    localStorage.removeItem(AI_HOST_STORAGE_KEY)
    vi.stubGlobal('location', {
      hostname: 'try-fresh-rooms.hypercomb.com', host: 'try-fresh-rooms.hypercomb.com',
      origin: 'https://try-fresh-rooms.hypercomb.com',
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is configured with nothing stored, and its host is the door', () => {
    const service = new HostAiService()
    expect(service.configured).toBe(true)
    expect(service.host).toBe('try-fresh-rooms.hypercomb.com')
  })

  it('keeps no host a visitor names there', () => {
    new HostAiService().setHost('ai.example.com')
    expect(localStorage.getItem(AI_HOST_STORAGE_KEY)).toBeNull()
  })

  it('asks the door it was served from, with no signer and no Authorization', async () => {
    const fetched = vi.fn(async (_url: string, _init: RequestInit) => sse('rooms'))
    vi.stubGlobal('fetch', fetched)
    expect(await new HostAiService().askText('what does this trial change?')).toBe('rooms')
    const [url, init] = fetched.mock.calls[0]
    expect(url).toBe('https://try-fresh-rooms.hypercomb.com/ai/ask')
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['Content-Type'])
  })

  it('says the door’s refusal when the allowance is spent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'x-reason': 'this door has used its AI allowance for today' } })))
    await expect(new HostAiService().askText('again')).rejects.toThrow(/this door has used its AI allowance/)
  })
})
