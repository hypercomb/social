// inspect-window.typescript.spec.ts — a section's TypeScript: a button only
// where the package names an atom for the file, no read until it is pressed,
// and a late answer never drawn over another step.

import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = { get: (key: string) => registrations.get(key) }
;(window as unknown as { ioc: unknown }).ioc = (globalThis as unknown as { ioc: unknown }).ioc

const { InspectWindowView } = await import('./inspect-window.view.js')

const READER = '@diamondcoreprocessor.com/HypercombHiveTreeReader'
const STORE = '@hypercomb.social/Store'
const sig = (n: number): string => n.toString(16).padStart(64, '0')
const MODULE = sig(1)
const ATOM = sig(2)
const COMPILED = ['// src/assistant/x.ts', 'var x = 1;', '// src/assistant/y.ts', 'var y = 2;', ''].join('\n')
const WRITTEN = 'export const x: number = 1\n'

type Answer = { ok: true; text: string; host: string } | { ok: false; code: string }
let named: boolean
let answer: Answer
let hold: Promise<void> | null
let asks: Array<{ moduleSig: string; section: string }>
let reads: Array<{ atom: string; section: string; signal?: AbortSignal }>

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }
let host: HTMLElement
let view: InstanceType<typeof InspectWindowView>
const q = <T extends Element>(selector: string): T | null => host.querySelector<T>(selector)
const act = (words: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>('.hc-inspect-act')].find(button => button.textContent === words)
const code = (): string => q('.hc-inspect-code')?.textContent ?? ''

const baseReader = () => ({
  codeQuoting: async () => ({ hits: [], more: false }),
  moduleText: async (wanted: string) => wanted === MODULE ? { name: 'assistant/x', text: COMPILED } : undefined,
})
const typescriptReader = () => ({
  ...baseReader(),
  typescriptFor: async (moduleSig: string, section: string) => {
    asks.push({ moduleSig, section })
    return named ? { atom: ATOM, section } : undefined
  },
  typescriptText: async (atom: string, section: string, options?: { signal?: AbortSignal }) => {
    reads.push({ atom, section, signal: options?.signal })
    if (hold) await hold
    return answer
  },
})

const open = async (reader: unknown = typescriptReader()): Promise<void> => {
  registrations.set(READER, reader)
  view.mount(host, { kind: 'section', sig: MODULE, section: 'src/assistant/x.ts' })
  await settle()
}

beforeEach(() => {
  named = true
  answer = { ok: true, text: WRITTEN, host: 'hypercomb.com' }
  hold = null
  asks = []
  reads = []
  registrations.clear()
  host = document.createElement('div')
  document.body.replaceChildren(host)
  view = new InspectWindowView()
})

describe('an atom opened as a resource is never read through the store', () => {
  const ATOM_TEXT = '// @hypercomb/typescript/assistant\n// lazy\n// src/assistant/x.ts\nexport const x: number = 1\n'
  const NOTE = 'It is hosted with the package and not kept on this device'
  let fetched: string[]
  let held: Map<string, string>
  let said: { atom: boolean; known: boolean }
  let asked: string[]

  const openResource = async (reader: unknown): Promise<void> => {
    registrations.set(READER, reader)
    registrations.set(STORE, {
      getResource: async (wanted: string) => {
        fetched.push(wanted)
        const text = held.get(wanted)
        return text === undefined ? null : { type: 'text/plain', arrayBuffer: async () => new TextEncoder().encode(text).buffer }
      },
    })
    view.mount(host, { kind: 'resource', sig: ATOM })
    await settle()
  }
  const saying = () => ({ ...baseReader(), typescriptAtom: async (wanted: string) => { asked.push(wanted); return said } })

  beforeEach(() => {
    fetched = []
    asked = []
    held = new Map([[ATOM, ATOM_TEXT]])
    said = { atom: true, known: true }
  })

  it('asks the reader first, and for an atom asks the store nothing', async () => {
    await openResource(saying())
    expect(asked).toEqual([ATOM])
    // The store would have fetched it and written it to the device.
    expect(fetched).toEqual([])
    expect(host.textContent).toContain(NOTE)
    expect(host.textContent).not.toContain('export const x: number = 1')
  })

  it('reads any other signature from the store as before', async () => {
    said = { atom: false, known: true }
    held.set(ATOM, 'a note a tile holds')
    await openResource(saying())
    expect(fetched).toEqual([ATOM])
    expect(host.textContent).toContain('a note a tile holds')
    expect(host.textContent).not.toContain(NOTE)
  })

  it('where nothing can say, text that opens as an atom is not drawn', async () => {
    // A reader that cannot tell, a reader from before the question, and no selection to read.
    for (const reader of [{ ...saying(), typescriptAtom: async () => ({ atom: false, known: false }) }, baseReader(), { ...baseReader(), typescriptAtom: async () => { throw new Error('not ready') } }]) {
      fetched = []
      await openResource(reader)
      expect(fetched).toEqual([ATOM])
      expect(host.textContent).toContain(NOTE)
      expect(host.textContent).not.toContain('export const x: number = 1')
    }
    // The same shells still draw a resource that is not one.
    held.set(ATOM, 'a note a tile holds')
    await openResource(baseReader())
    expect(host.textContent).toContain('a note a tile holds')
  })

  it('a reader that could tell is believed: text that only looks like an atom is drawn', async () => {
    said = { atom: false, known: true }
    await openResource(saying())
    expect(host.textContent).toContain('export const x: number = 1')
    expect(host.textContent).not.toContain(NOTE)
  })
})

describe('a section’s TypeScript, fetched only on a press', () => {
  it('shows no button with a reader that cannot say, or a package that names no atom', async () => {
    await open(baseReader())
    expect(code()).toContain('var x = 1;')
    expect(act('TypeScript')).toBeUndefined()
    named = false
    await open()
    expect(asks).toEqual([{ moduleSig: MODULE, section: 'src/assistant/x.ts' }])
    expect(act('TypeScript')).toBeUndefined()
    expect(code()).toContain('var x = 1;')
    expect(reads).toEqual([])
  })

  it('offers the button and reads nothing until it is pressed', async () => {
    await open()
    expect(act('TypeScript')).toBeTruthy()
    expect(act('As shipped')).toBeUndefined()
    expect(code()).toContain('var x = 1;')
    expect(reads).toEqual([])
  })

  it('does not ask on a module’s list of files', async () => {
    registrations.set(READER, typescriptReader())
    view.mount(host, { kind: 'section', sig: MODULE })
    await settle()
    expect(asks).toEqual([])
    expect(act('TypeScript')).toBeUndefined()
  })

  it('reads once on a press, draws the TypeScript, names the host, and goes back without a read', async () => {
    await open()
    act('TypeScript')!.click()
    await settle()
    expect(reads.map(({ atom, section }) => ({ atom, section }))).toEqual([{ atom: ATOM, section: 'src/assistant/x.ts' }])
    expect(reads[0]!.signal).toBeInstanceOf(AbortSignal)
    expect(code()).toContain('export const x: number = 1')
    expect(code()).not.toContain('var x = 1;')
    expect(host.textContent).toContain('read from hypercomb.com')
    expect(act('As shipped')).toBeTruthy()
    expect(act('TypeScript')).toBeUndefined()
    // No line marked: an offset into the compiled text is not a place in this text.
    expect(q('.hc-inspect-mark')).toBeNull()

    act('As shipped')!.click()
    await settle()
    expect(code()).toContain('var x = 1;')
    expect(host.textContent).not.toContain('read from hypercomb.com')
    expect(act('TypeScript')).toBeTruthy()
    expect(reads).toHaveLength(1)
  })

  it('opens every other step as shipped: a push, a step back and a crumb ask nothing', async () => {
    await open()
    act('TypeScript')!.click()
    await settle()
    expect(reads).toHaveLength(1)
    view.push({ kind: 'section', sig: MODULE, section: 'src/assistant/y.ts' })
    await settle()
    expect(code()).toContain('var y = 2;')
    expect(act('TypeScript')).toBeTruthy()
    view.back()
    await settle()
    expect(code()).toContain('var x = 1;')
    expect(act('TypeScript')).toBeTruthy()
    // Pressed on one step, then left by its crumb: the step come to shows compiled code.
    view.push({ kind: 'section', sig: MODULE, section: 'src/assistant/y.ts' })
    await settle()
    act('TypeScript')!.click()
    await settle()
    expect(reads).toHaveLength(2)
    host.querySelector<HTMLButtonElement>('.hc-inspect-crumb')!.click()
    await settle()
    expect(code()).toContain('var x = 1;')
    expect(reads).toHaveLength(2)
  })

  it('says when the hosts do not hold it, and draws the compiled code', async () => {
    answer = { ok: false, code: 'not-hosted' }
    await open()
    act('TypeScript')!.click()
    await settle()
    expect(host.textContent).toContain('is not on the hosts this hive reads it from')
    expect(code()).toContain('var x = 1;')
    answer = { ok: false, code: 'no-section' }
    act('As shipped')!.click()
    await settle()
    act('TypeScript')!.click()
    await settle()
    expect(host.textContent).toContain('No TypeScript is hosted for this file.')
    expect(code()).toContain('var x = 1;')
  })

  it('never draws an answer that arrives after the step was left, and ends its read', async () => {
    let release: () => void = () => {}
    await open()
    view.push({ kind: 'section', sig: MODULE, section: 'src/assistant/y.ts' })
    await settle()
    hold = new Promise<void>(resolve => { release = resolve })
    act('TypeScript')!.click()
    await settle()
    expect(reads).toHaveLength(1)
    expect(reads[0]!.signal?.aborted).toBe(false)
    view.back()
    await settle()
    expect(reads[0]!.signal?.aborted).toBe(true)
    release()
    await settle()
    expect(code()).toContain('var x = 1;')
    expect(code()).not.toContain('export const x')
    expect(host.textContent).not.toContain('read from hypercomb.com')
    expect(reads).toHaveLength(1)
  })
})
