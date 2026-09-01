import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { ActiveGenomeRecord } from '../history/active-genome.js'

vi.useFakeTimers()

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let GenomeQueenBee: typeof import('./genome.queen.js').GenomeQueenBee
let ACTIVE_GENOME_KEY: typeof import('../history/active-genome.service.js').ACTIVE_GENOME_KEY

beforeAll(async () => {
  ;({ ACTIVE_GENOME_KEY } = await import('../history/active-genome.service.js'))
  ;({ GenomeQueenBee } = await import('./genome.queen.js'))
})

beforeEach(() => {
  EffectBus.clear()
  registrations.clear()
})

const record = (complete = true): ActiveGenomeRecord => ({
  version: 1,
  seal: 'a'.repeat(64),
  complete,
  heads: [],
  objects: [],
  missing: complete ? [] : [{ kind: 'resource', sig: 'b'.repeat(64) }],
  totals: {
    lineages: 2,
    virtualHeads: 0,
    objects: 3,
    markerBytes: 20,
    contentBytes: 1004,
    knownBytes: 1024,
    activeBytes: complete ? 1024 : null,
  },
})

describe('/genome active-genome reporting', () => {
  it('answers only its canonical name — aliases are the participant\'s to give, never code\'s', () => {
    expect(new GenomeQueenBee().matches('genome')).toBe(true)
    expect(new GenomeQueenBee().matches('weight')).toBe(false)
  })

  it('reports a pending census without claiming content would be lost', async () => {
    registrations.set(ACTIVE_GENOME_KEY, {
      dirty: true,
      current: vi.fn(async () => null),
    })
    const toasts: Array<{ title: string; message: string }> = []
    EffectBus.on('toast:show', toast => toasts.push(toast as { title: string; message: string }))

    await new GenomeQueenBee().invoke('')

    expect(toasts.at(-1)).toEqual({
      title: 'Genome initializing',
      message: 'No history root is readable yet; the passive update remains queued.',
      type: 'info',
    })
    expect(toasts.at(-1)?.message).not.toContain('coherent seal')
    expect(toasts.at(-1)?.message).not.toContain('losing content')
  })

  it('labels a cached dirty census as last coherent rather than active', async () => {
    registrations.set(ACTIVE_GENOME_KEY, {
      dirty: true,
      current: vi.fn(async () => record()),
    })
    const toasts: Array<{ message: string }> = []
    EffectBus.on('toast:show', toast => toasts.push(toast as { message: string }))

    await new GenomeQueenBee().invoke('')

    expect(toasts.at(-1)?.message).toContain('last coherent · updating')
    expect(toasts.at(-1)?.message).not.toContain(' active ')
  })

  it('passes refresh through and calls only a stable complete census active', async () => {
    const current = vi.fn(async () => record())
    registrations.set(ACTIVE_GENOME_KEY, { dirty: false, current })
    const toasts: Array<{ message: string; type: string }> = []
    EffectBus.on('toast:show', toast => toasts.push(toast as { message: string; type: string }))

    await new GenomeQueenBee().invoke('refresh')

    expect(current).toHaveBeenCalledWith(true)
    expect(toasts.at(-1)?.message).toContain('1.0 KiB active')
    expect(toasts.at(-1)?.type).toBe('success')
  })
})
