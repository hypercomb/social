import { beforeEach, describe, expect, it, vi } from 'vitest'

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
