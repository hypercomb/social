// commands/aliases/participant-aliases.spec.ts
//
// The ledger of participant-given names: sanitizing, refusal reasons, the
// newer-entry-wins merge, and the in-place queen seam. No literal is ever
// assigned to a field named after the seam — the doctrine ratchet watches
// this file like any other.

import { beforeEach, describe, expect, it } from 'vitest'
import { ParticipantAliases } from './participant-aliases.js'

type IocShape = {
  get?: (k: string) => unknown
  list?: () => string[]
  register?: (k: string, v: unknown) => void
  whenReady?: (k: string, cb: (v: unknown) => void) => void
  onRegister?: (cb: (key: string, value: unknown) => void) => void
}

const installIoc = (held: Record<string, unknown>): void => {
  const ioc: IocShape = {
    get: (k) => held[k],
    list: () => Object.keys(held),
    register: (k, v) => { held[k] = v },
    whenReady: () => { /* never fires in the spec */ },
    onRegister: () => { /* never fires in the spec */ },
  }
  ;(window as unknown as { ioc?: IocShape }).ioc = ioc
}

describe('ParticipantAliases', () => {
  beforeEach(() => {
    localStorage.clear()
    installIoc({})
  })

  it('keeps sane names and refuses the rest, each with its reason', () => {
    const held = new ParticipantAliases()
    const result = held.set('present', ['Slides', '/deck', 'two words', 'present'], 1000)
    expect(result.kept).toEqual(['slides', 'deck'])
    expect(result.refused).toEqual([
      { name: 'two words', reason: 'not-a-name' },
      { name: 'present', reason: 'is-the-command' },
    ])
    expect(held.aliasesFor('present')).toEqual(['slides', 'deck'])
  })

  it('refuses a name that shadows another canonical command', () => {
    installIoc({ '@x/GameQueenBee': { command: 'game', invoke: () => { /* queen */ } } })
    const held = new ParticipantAliases()
    const result = held.set('solomon', ['game', 'dana'], 1000)
    expect(result.kept).toEqual(['dana'])
    expect(result.refused).toEqual([{ name: 'game', reason: 'is-another-command' }])
  })

  it('refuses a name already given to a different behaviour', () => {
    const held = new ParticipantAliases()
    held.set('present', ['deck'], 1000)
    const result = held.set('lightbox', ['deck'], 2000)
    expect(result.refused).toEqual([{ name: 'deck', reason: 'taken' }])
    expect(held.aliasesFor('lightbox')).toEqual([])
  })

  it('an empty set is a real decision — it takes every given name away', () => {
    const held = new ParticipantAliases()
    held.set('present', ['slides'], 1000)
    held.set('present', [], 2000)
    expect(held.aliasesFor('present')).toEqual([])
    expect(held.all().size).toBe(0)
  })

  it('survives a reload through the boot cache', () => {
    new ParticipantAliases().set('present', ['slides'], 1000)
    const reloaded = new ParticipantAliases()
    expect(reloaded.aliasesFor('present')).toEqual(['slides'])
  })

  it('merges the pooled doc with newer-entry-wins, then writes the union back', async () => {
    let written: string | null = null
    const pooled = {
      entries: {
        present: { names: ['old-name'], at: 1000 },
        tree: { names: ['mindmap'], at: 500 },
      },
    }
    const fakeStore = {
      getPool: async () => ({}) as FileSystemDirectoryHandle,
      getPoolDoc: async () =>
        new TextEncoder().encode(JSON.stringify(pooled)).buffer as ArrayBuffer,
      putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer) => {
        written = new TextDecoder().decode(bytes)
        return 'sig'
      },
    }
    installIoc({ '@hypercomb.social/Store': fakeStore })

    const held = new ParticipantAliases()
    held.set('present', ['slides'], 2000)
    await held.hydrate()

    // My later decision beats the pool's older one; the pool's tree entry
    // arrives untouched.
    expect(held.aliasesFor('present')).toEqual(['slides'])
    expect(held.aliasesFor('tree')).toEqual(['mindmap'])
    expect(held.hydrated).toBe(true)
    expect(written).toContain('slides')
    expect(written).toContain('mindmap')
  })

  it('rewrites the queen seam in place — same array, new contents', () => {
    const seam: string[] = []
    const queen = { command: 'present', aliases: seam, invoke: () => { /* queen */ } }
    installIoc({ '@x/PresentQueenBee': queen })
    const held = new ParticipantAliases()
    held.set('present', ['slides'], 1000)
    expect(queen.aliases).toBe(seam)
    expect(seam).toEqual(['slides'])
    held.set('present', [], 2000)
    expect(seam).toEqual([])
  })
})
