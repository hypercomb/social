// @vitest-environment jsdom
// glossary.queen.spec.ts — the word, said: a term answered with no model
// asked, from its tile when one stands and from the shipped glossary when not;
// the whole line is the term; `glossary tiles` lays them out.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
vi.stubGlobal('ioc', { register: () => {}, get: (key: string) => services.get(key) })
const { GlossaryQueenBee } = await import('./glossary.queen.js')

const said: string[] = []
const toasts: { type: string; message: string }[] = []
EffectBus.on<{ message: string }>('activity:log', payload => { said.push(payload.message) })
EffectBus.on<{ type: string; message: string }>('toast:show', payload => { toasts.push(payload) })

beforeEach(() => { said.length = 0; toasts.length = 0; services.clear() })

describe('glossary — the word', () => {
  it('answers a term from the shipped glossary when no tile stands, and says so', async () => {
    await new GlossaryQueenBee().invoke('sigbag')
    expect(said[0]).toMatch(/^history bag \(sigbag\): an append-only sequence/)
    expect(said[1]).toContain('From the glossary this build ships')
  })

  it('answers from the term\'s tile when one stands', async () => {
    const asked: string[] = []
    services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['home'] })
    services.set('@diamondcoreprocessor.com/NotesService', {
      getNotesAtSegments: async (segments: readonly string[]) => {
        asked.push(segments.join('/'))
        return segments.join('/') === 'glossary/glossary-architecture-layer/glossary-drone' ? [{ text: 'drone: our reactive bee' }] : []
      },
      addAtSegments: async () => {},
    })
    await new GlossaryQueenBee().invoke('drone')
    expect(asked).toEqual(['home/glossary/glossary-architecture-layer/glossary-drone', 'glossary/glossary-architecture-layer/glossary-drone'])
    expect(said).toEqual(['drone: our reactive bee', 'From the tile /glossary/glossary-architecture-layer/glossary-drone.'])
  })

  it('takes the whole line as the term, so a behaviour word inside it never runs', async () => {
    expect(new GlossaryQueenBee().rawArgs).toBe(true)
    await new GlossaryQueenBee().invoke('trail capsule')
    expect(said[0]).toMatch(/^trail capsule \(formerly "dna"\):/)
    await new GlossaryQueenBee().invoke('hive clipboard nonsense')
    expect(said.at(-1)).toBe('No term in the glossary is named "hive clipboard nonsense" or holds it.')
  })

  it('alone it says how many terms there are; tiles without notes loaded says why', async () => {
    await new GlossaryQueenBee().invoke('')
    expect(toasts[0]!.message).toMatch(/^The glossary has \d+ terms/)
    await new GlossaryQueenBee().invoke('tiles')
    expect(toasts.at(-1)).toEqual({ type: 'warning', message: 'The notes are not loaded yet; say glossary tiles again in a moment.' })
  })

  it('completes tiles and the terms, once the glossary is read', async () => {
    const queen = new GlossaryQueenBee()
    await queen.invoke('')
    expect(queen.slashComplete('ti')).toEqual(['tiles', 'tile', 'tile selection drone', 'tile editor drone'])
    expect(queen.slashComplete('history')).toEqual(['history bag'])
  })

  it('declares no machine grammar: laying tiles is the participant\'s own act', () => {
    expect(new GlossaryQueenBee().machine).toBeUndefined()
  })
})
