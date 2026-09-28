import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const { harness } = await import('./harness.js')
const { HarnessQueenBee } = await import('./harness.queen.js')

type Runnable = { execute(args: string): Promise<void> }

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}
const host = globalThis as { localStorage?: unknown }
beforeEach(() => { host.localStorage = memoryStorage() })
afterEach(() => { delete host.localStorage })

const heard = (name: string): unknown[] => {
  const seen: unknown[] = []
  EffectBus.on(name, payload => { seen.push(payload) })
  return seen
}

describe('the harness word', () => {
  it('lists the pool, chooses for the device by name, and marks the open conversation by effect', async () => {
    await harness.seed()
    const quiet = await harness.import({ kind: 'harness@1', name: 'quiet-reader', leg: { rounds: 4 } })
    const queen = new HarnessQueenBee() as unknown as Runnable
    const toasts = heard('toast:show')
    const marks = heard('chat:harness')

    await queen.execute('')
    expect(String((toasts.at(-1) as { message: string }).message)).toContain('quiet-reader')

    await queen.execute('use quiet-reader')
    expect(harness.active.name).toBe('quiet-reader')
    await queen.execute('use default')
    expect(harness.active.name).toBe('default')

    await queen.execute('here quiet-reader')
    expect(marks.at(-1)).toEqual({ sig: quiet, scope: 'conversation' })
    await queen.execute('here default')
    expect(marks.at(-1)).toEqual({ sig: '', scope: 'conversation' })

    await queen.execute('use nobody')
    expect(String((toasts.at(-1) as { message: string }).message)).toContain('No harness called "nobody"')
  })

  it('brings a record in by its bytes and refuses one that widens', async () => {
    const queen = new HarnessQueenBee() as unknown as Runnable
    const toasts = heard('toast:show')
    await queen.execute('import {"kind":"harness@1","name":"researcher","vocabulary":{"deny":["delete"]}}')
    expect(harness.find('researcher')?.record.vocabulary.deny).toEqual(['delete'])
    await queen.execute('import {"kind":"harness@1","name":"bold","review":{"auto":["do"]}}')
    expect(String((toasts.at(-1) as { message: string }).message)).toContain('refused')
    expect(harness.find('bold')).toBeUndefined()
  })

  it('completes the sub-words and the names in the pool', async () => {
    await harness.import({ kind: 'harness@1', name: 'quiet-reader' })
    const queen = new HarnessQueenBee()
    expect(queen.slashComplete('')).toEqual(['use ', 'here ', 'show ', 'import '])
    expect(queen.slashComplete('use q')).toEqual(['use quiet-reader'])
    expect(queen.slashComplete('here d')).toEqual(['here default'])
  })
})
