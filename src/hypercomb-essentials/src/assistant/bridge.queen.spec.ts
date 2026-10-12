// bridge.queen.spec.ts — `bridge`: the sub-words, a code that never rides a
// toast or an event, the clipboard fallback, `add` reading only its prompt,
// and a machine refused every form.

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_CODE_STORE_IOC_KEY, BridgeCodeStore, EffectBus } from '@hypercomb/core'

const services: Record<string, unknown> = {}
vi.hoisted(() => {
  ;(globalThis as unknown as { window: { ioc?: unknown } }).window.ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
    list: () => [],
  }
})
;(window as unknown as { ioc: { get(key: string): unknown } }).ioc.get = (key: string) => services[key]

const { BridgeQueenBee } = await import('./bridge.queen.js')

type Runnable = { execute(args: string): Promise<void> }
const queen = (): Runnable => new BridgeQueenBee() as unknown as Runnable
const nodeHash = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex')

const toasts: { type?: string; message?: string }[] = []
EffectBus.on<{ type?: string; message?: string }>('toast:show', payload => { toasts.push(payload ?? {}) })

let store: BridgeCodeStore
let copied: string[]
let emitted: unknown[]

const clipboard = (writeText: (text: string) => Promise<void>): void => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  store = new BridgeCodeStore()
  services[BRIDGE_CODE_STORE_IOC_KEY] = store
  toasts.length = 0
  copied = []
  emitted = []
  clipboard(async text => { copied.push(text) })
  const emit = EffectBus.emit.bind(EffectBus)
  vi.spyOn(EffectBus, 'emit').mockImplementation(((name: string, payload: unknown) => {
    emitted.push([name, payload])
    return emit(name, payload)
  }) as typeof EffectBus.emit)
})

afterEach(() => { vi.restoreAllMocks() })

describe('bridge — the sub-words', () => {
  it('lists nothing, then says who may connect', async () => {
    await queen().execute('')
    expect(toasts.at(-1)?.message).toBe("No bridge codes — only this machine's own tools can use the bridge")
  })

  it('gives, lists by fingerprint and name, and withdraws', async () => {
    await queen().execute('give susan')
    expect(store.list().map(entry => entry.label)).toEqual(['susan'])
    const [{ fingerprint }] = store.list()
    expect(toasts.at(-1)?.message).toBe(`Bridge code for susan (${fingerprint}) copied — it will not be shown again`)

    await queen().execute('')
    expect(toasts.at(-1)?.message).toBe(`Bridge codes: ${fingerprint} susan`)

    await queen().execute('withdraw susan')
    expect(store.list()).toEqual([])
    expect(toasts.at(-1)?.message).toBe(`Withdrawn: susan (${fingerprint}) can no longer use the bridge`)
  })

  it('withdraws by fingerprint, and says not-found and ambiguous', async () => {
    await queen().execute('give susan')
    const [{ fingerprint }] = store.list()
    await queen().execute('withdraw nobody')
    expect(toasts.at(-1)?.message).toBe('No bridge code is named nobody')

    vi.spyOn(window, 'prompt').mockReturnValue('hcb-other')
    await queen().execute(`add ${fingerprint.slice(0, 4)}`)
    await queen().execute(`withdraw ${fingerprint.slice(0, 4)}`)
    expect(toasts.at(-1)?.message).toBe(`${fingerprint.slice(0, 4)} names 2 bridge codes — say more of the fingerprint`)
    expect(store.list()).toHaveLength(2)

    await queen().execute(`withdraw ${fingerprint}`)
    expect(store.list().map(entry => entry.label)).toEqual([fingerprint.slice(0, 4)])
  })

  it('refuses a name already given', async () => {
    await queen().execute('give susan')
    await queen().execute('give Susan')
    expect(toasts.at(-1)?.message).toBe('Not added — Susan already has a bridge code, or that code is already held')
    expect(store.list()).toHaveLength(1)
  })

  it('says how it is said for an unknown sub-word or a missing name', async () => {
    for (const line of ['lend susan', 'give', 'withdraw']) {
      toasts.length = 0
      await queen().execute(line)
      expect(toasts.at(-1)?.message).toBe('bridge · bridge give <name> · bridge add <name> · bridge withdraw <fingerprint|name>')
    }
    expect(store.list()).toEqual([])
  })

  it('completes the sub-words, then the names and fingerprints after withdraw', async () => {
    const bee = new BridgeQueenBee()
    expect(bee.slashComplete('')).toEqual(['give ', 'add ', 'withdraw '])
    expect(bee.slashComplete('wi')).toEqual(['withdraw '])
    await queen().execute('give susan')
    const [{ fingerprint }] = store.list()
    expect(bee.slashComplete('withdraw ')).toEqual(['susan', fingerprint])
    expect(bee.slashComplete('withdraw su')).toEqual(['susan'])
    expect(bee.slashComplete('give su')).toEqual([])
  })
})

describe('bridge — the code is shown once, and never as a toast or an event', () => {
  it('copies the code and keeps it out of every toast and every emitted payload', async () => {
    await queen().execute('give susan')
    expect(copied).toHaveLength(1)
    const [code] = copied
    expect(code).toMatch(/^hcb-[a-z2-7]{32}$/)
    expect(store.hashes()).toEqual([nodeHash(code)])
    expect(emitted.some(entry => (entry as [string])[0] === 'toast:show')).toBe(true)
    expect(JSON.stringify(toasts)).not.toContain(code)
    expect(JSON.stringify(emitted)).not.toContain(code)
    expect(JSON.stringify(emitted)).not.toContain(nodeHash(code))
  })

  it('falls back to a prompt the participant copies from when the clipboard refuses', async () => {
    clipboard(async () => { throw new Error('denied') })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    await queen().execute('give susan')
    expect(prompt).toHaveBeenCalledTimes(1)
    const [message, code] = prompt.mock.calls[0] as [string, string]
    const [{ fingerprint }] = store.list()
    expect(message).toBe(`Copy the bridge code for susan (${fingerprint}) now — it will not be shown again`)
    expect(code).toMatch(/^hcb-[a-z2-7]{32}$/)
    expect(store.hashes()).toEqual([nodeHash(code)])
    expect(toasts.at(-1)?.message).toBe(`susan may use the bridge — code ${fingerprint}`)
    expect(JSON.stringify(toasts)).not.toContain(code)
    expect(JSON.stringify(emitted)).not.toContain(code)
  })
})

describe('bridge add — the code comes from the prompt, never the line', () => {
  it('holds the code typed into the prompt, asked with nothing filled in', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  hcb-typed-in-the-prompt ')
    await queen().execute('add susan')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt.mock.calls[0]).toEqual(['The bridge code susan was given'])
    expect(store.hashes()).toEqual([nodeHash('hcb-typed-in-the-prompt')])
    expect(store.list().map(entry => entry.label)).toEqual(['susan'])
    expect(toasts.at(-1)?.message).toBe(`susan may use the bridge — code ${nodeHash('hcb-typed-in-the-prompt').slice(0, 8)}`)
    expect(JSON.stringify(toasts)).not.toContain('hcb-typed-in-the-prompt')
    expect(JSON.stringify(emitted)).not.toContain('hcb-typed')
  })

  it('refuses a code typed on the line — no prompt, nothing held — and has the history cut back to the name', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('hcb-typed-in-the-prompt')
    const transient: unknown[] = []
    vi.spyOn(EffectBus, 'emitTransient').mockImplementation(((name: string, payload: unknown) => {
      transient.push([name, payload])
    }) as typeof EffectBus.emitTransient)

    await queen().execute('add Susan hcb-typed-on-the-line')

    expect(prompt).not.toHaveBeenCalled()
    expect(store.list()).toEqual([])
    // The history is asked for the line back by its words — never the code,
    // and never as a replayed value a later subscriber would be handed.
    expect(transient).toEqual([['command-history:forget', { words: 'bridge add Susan' }]])
    expect(emitted.some(entry => (entry as [string])[0] === 'command-history:forget')).toBe(false)
    expect(toasts.at(-1)).toEqual({
      type: 'warning',
      message: 'Not added — a bridge code goes in the prompt, never on the line. The command history keeps only "bridge add Susan"; if anyone saw the code, give Susan a new one instead (bridge give Susan)',
    })
    expect(JSON.stringify(toasts)).not.toContain('hcb-typed')
    expect(JSON.stringify(emitted)).not.toContain('hcb-typed')
    expect(JSON.stringify(transient)).not.toContain('hcb-typed')
  })

  it('refuses a give whose name is more than one word, and copies nothing', async () => {
    const transient: unknown[] = []
    vi.spyOn(EffectBus, 'emitTransient').mockImplementation(((name: string, payload: unknown) => {
      transient.push([name, payload])
    }) as typeof EffectBus.emitTransient)

    await queen().execute('give susan smith')

    expect(copied).toEqual([])
    expect(store.list()).toEqual([])
    expect(transient).toEqual([['command-history:forget', { words: 'bridge give susan' }]])
    expect(toasts.at(-1)?.message).toBe('Not given — bridge give takes one word, the name. The command history keeps only "bridge give susan"')
  })

  it('adds nothing when the prompt is cancelled or left empty', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('   ')
    await queen().execute('add susan')
    await queen().execute('add susan')
    expect(store.list()).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('bridge — a machine is refused every form', () => {
  it('refuses the bare word, every sub-word and anything else', () => {
    const refuse = new BridgeQueenBee().machine.refuse!
    for (const line of ['', 'give susan', 'add susan', 'add susan hcb-x', 'withdraw susan', 'withdraw a1b2', 'list', 'anything at all']) {
      expect(refuse(line), line).toBe('Bridge codes decide who may reach this machine — only the participant gives, adds or withdraws one, at the keyboard')
    }
  })
})
