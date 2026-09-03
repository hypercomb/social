import { beforeEach, describe, expect, it, vi } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { EffectBus } = await import('@hypercomb/core')
const { CreateQueenBee } = await import('./create.queen.js')

type CreateRequest = {
  name: string
  accept(): void
  complete(error?: unknown): void
}

beforeEach(() => {
  EffectBus.clear()
  vi.restoreAllMocks()
})

describe('/create completion contract', () => {
  it('does not resolve until the native create path completes', async () => {
    let request: CreateRequest | undefined
    EffectBus.on<CreateRequest>('command:create-cells', payload => {
      request = payload
      payload.accept()
    })
    let settled = false
    const running = new CreateQueenBee().invoke('roadmap').then(() => { settled = true })

    await Promise.resolve()
    expect(request?.name).toBe('roadmap')
    expect(settled).toBe(false)
    request?.complete()
    await running
    expect(settled).toBe(true)
  })

  it('propagates commit failure to an ordered grammar executor', async () => {
    EffectBus.on<CreateRequest>('command:create-cells', payload => {
      payload.accept()
      payload.complete(new Error('commit failed'))
    })
    await expect(new CreateQueenBee().invoke('roadmap')).rejects.toThrow('commit failed')
  })

  it('fails rather than reporting success when no create path is mounted', async () => {
    await expect(new CreateQueenBee().invoke('roadmap')).rejects.toThrow('command line is unavailable')
  })
})
