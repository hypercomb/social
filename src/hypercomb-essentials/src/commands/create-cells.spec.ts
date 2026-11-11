// create-cells.spec.ts — the commit a create performs, as a module. It was
// the body of the Angular command line's create path; the first run of the
// chat on a debugger page (2026-11-11) showed a behaviour could not make a
// tile there, because nothing else answered `command:create-cells`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const services = new Map<string, unknown>()
vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => { (globalThis as { __services?: Map<string, unknown> }).__services?.set(key, value) },
    get: (key: string) => (globalThis as { __services?: Map<string, unknown> }).__services?.get(key),
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})
;(globalThis as { __services?: Map<string, unknown> }).__services = services

const { EffectBus, CANONICAL_REFERENCE_SERVICE_KEY } = await import('@hypercomb/core')
const { createCells, answerCreateRequest, CREATE_CELLS_IOC_KEY, COMMAND_LINE_IOC_KEY } = await import('./create-cells.js')
// The create word's bee subscribes the answer; here the spec stands in for it.
EffectBus.on('command:create-cells', answerCreateRequest)

type Update = { segments: readonly string[]; layer: { name?: string } }

let committed: Update[][]
let heard: string[]
let offs: (() => void)[]

beforeEach(() => {
  services.clear()
  committed = []
  heard = []
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['work'] })
  services.set('@diamondcoreprocessor.com/LayerCommitter', { importTree: async (updates: Update[]) => { committed.push(updates) } })
  offs = [
    EffectBus.on<{ cell?: string; segments?: string[]; viaUpdate?: boolean }>('cell:added', payload => {
      if (payload?.cell) heard.push(`added ${[...(payload.segments ?? []), payload.cell].join('/')}${payload.viaUpdate ? ' (via update)' : ''}`)
    }),
    EffectBus.on<{ cell?: string }>('cell:committed', payload => { if (payload?.cell) heard.push(`committed ${payload.cell}`) }),
    EffectBus.on<{ cell?: string; largeSig?: string; segments?: string[] }>('cell:attach-resource', payload => {
      if (payload?.cell) heard.push(`attach ${payload.cell} ${payload.largeSig}${payload.segments ? ` at ${payload.segments.join('/')}` : ''}`)
    }),
  ]
  heard.length = 0
})

afterEach(() => { for (const off of offs) off() })

describe('the commit a create performs', () => {
  it('is named by the key the command line asks for', () => {
    expect(CREATE_CELLS_IOC_KEY).toBe('@diamondcoreprocessor.com/CreateCells')
  })

  it('makes one tile on the page stood on: announced first, then one cascade, then committed', async () => {
    const outcome = await createCells({ parts: ['roadmap'] })
    expect(outcome).toEqual({ made: true, base: ['work'], parts: ['roadmap'], moved: false })
    expect(committed).toEqual([[{ segments: ['work', 'roadmap'], layer: { name: 'roadmap' } }]])
    expect(heard).toEqual(['added work/roadmap (via update)', 'committed roadmap'])
  })

  it('a nested name gains a child at every level in ONE cascade', async () => {
    await createCells({ parts: ['meals', 'breakfast', 'pastries'] })
    expect(committed).toHaveLength(1)
    expect(committed[0].map(update => update.segments.join('/'))).toEqual(['work/meals', 'work/meals/breakfast', 'work/meals/breakfast/pastries'])
  })

  it('refuses a reserved pool word and a saved root\'s name before anything is made', async () => {
    expect(await createCells({ parts: ['notes', 'bees'] })).toEqual({ made: false, why: 'reserved', word: 'bees' })
    services.set('@diamondcoreprocessor.com/SavedRoots', { isSaved: (name: string) => name === 'spring' })
    expect(await createCells({ parts: ['spring'] })).toEqual({ made: false, why: 'saved', word: 'spring' })
    expect(await createCells({ parts: [] })).toEqual({ made: false, why: 'empty' })
    expect(committed).toEqual([])
    expect(heard).toEqual([])
  })

  it('a caller that needs the commit is refused when nothing can commit', async () => {
    services.delete('@diamondcoreprocessor.com/LayerCommitter')
    await expect(createCells({ parts: ['roadmap'], requireCommitter: true })).rejects.toThrow('Create layer committer is unavailable')
    expect(heard).toEqual([])
  })

  it('a caller that needs the commit is refused where the page does not know where it stands', async () => {
    // The committer returns without writing when there is no lineage, and says
    // nothing — the first debugger run called that "ran".
    services.delete('@hypercomb.social/Lineage')
    await expect(createCells({ parts: ['roadmap'], requireCommitter: true })).rejects.toThrow('does not know where it stands')
    expect(committed).toEqual([])
    expect(heard).toEqual([])
  })

  it('an armed picture is asked to attach to the leaf, and its holder is told', async () => {
    let taken = 0
    await createCells({
      parts: ['album', 'cover'],
      armed: { largeSig: 'a'.repeat(64), smallPointSig: null, smallFlatSig: null, url: null, type: 'image' },
      armedTaken: () => { taken++ },
    })
    expect(heard).toContain(`attach cover ${'a'.repeat(64)}`)
    expect(taken).toBe(1)
  })

  it('behind a doorway the tile is made where the landing says, and announced only once it exists', async () => {
    services.set(CANONICAL_REFERENCE_SERVICE_KEY, {
      landing: async (_standing: readonly string[], parts: readonly string[]) => ({ base: ['people'], parts, gather: null }),
    })
    const outcome = await createCells({ parts: ['bob'] })
    expect(outcome).toEqual({ made: true, base: ['people'], parts: ['bob'], moved: true })
    expect(committed[0][0].segments).toEqual(['people', 'bob'])
    expect(heard).toEqual(['committed bob', 'added people/bob (via update)'])
  })
})

describe('a request with no command line to answer it', () => {
  const ask = (name: string): { accepted: boolean; done: Promise<void> } => {
    let accepted = false
    let finish!: (error?: unknown) => void
    const done = new Promise<void>((resolve, reject) => { finish = error => error === undefined ? resolve() : reject(error) })
    EffectBus.emitTransient('command:create-cells', { name, accept: () => { accepted = true }, complete: finish })
    return { accepted, done }
  }

  it('is answered here with the same commit, the name read as a name', async () => {
    const request = ask('/Road Map/')
    expect(request.accepted).toBe(true)
    await request.done
    expect(committed[0].map(update => update.segments.join('/'))).toHaveLength(1)
    expect(committed[0][0].segments[0]).toBe('work')
  })

  it('stays out where the command line is mounted — one request, one creator', async () => {
    services.set(COMMAND_LINE_IOC_KEY, { mounted: true })
    const request = ask('roadmap')
    expect(request.accepted).toBe(false)
    expect(committed).toEqual([])
  })

  it('a refused name is an error the asker hears, never a quiet success', async () => {
    const request = ask('bees')
    expect(request.accepted).toBe(true)
    await expect(request.done).rejects.toThrow('"bees" cannot be a tile name here')
  })
})
