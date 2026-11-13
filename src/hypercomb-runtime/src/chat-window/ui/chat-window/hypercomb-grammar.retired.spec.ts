// ui/chat-window/hypercomb-grammar.retired.spec.ts — the model channel tells a
// model what a retired word became, in the gate's words.
//
// A model working from an older vocabulary says `/delete`. Told only "not a
// behaviour in this hive" it tries a synonym, and there are none; told
// "/delete was retired — /remove does this now" it can correct itself. The
// census (SlashBehaviourDrone `retired`) is asked only after the model's own
// primary-name lookup missed, so a live word is never answered as retired.

import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MACHINE_GRANT } from '@hypercomb/core'
import { parseHypercombGrammars, type HypercombBehaviour } from './hypercomb-grammar'

const entries: readonly HypercombBehaviour[] = [
  {
    name: 'create',
    machine: { forms: '<name>', example: '/create roadmap', reach: 'additive', scope: 'page' },
  },
]

const retiredWords: Record<string, { by?: string; note?: string }> = {
  delete: { by: 'remove' },
  flatten: { note: 'archiving the middle of a history publishes less than you had' },
  create: { note: 'a record for a live word, which must never be read' },
}

const withCensus = (): void => {
  ;(globalThis as { ioc?: unknown }).ioc = {
    get: (key: string) => key === '@diamondcoreprocessor.com/SlashBehaviourDrone'
      ? { retired: (name: string) => retiredWords[name.toLowerCase().trim()] }
      : undefined,
  }
}

const refusalOf = (line: string): string => {
  try {
    parseHypercombGrammars([line], entries, DEFAULT_MACHINE_GRANT)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return 'accepted'
}

afterEach(() => { delete (globalThis as { ioc?: unknown }).ioc })

describe('a retired word said by a model', () => {
  it('is refused with what to say instead', () => {
    withCensus()
    expect(refusalOf('/delete drafts')).toBe('/delete was retired — /remove does this now')
    expect(refusalOf('/flatten')).toBe('/flatten was retired — archiving the middle of a history publishes less than you had')
  })

  it('a live word is never answered as retired', () => {
    withCensus()
    expect(refusalOf('/create roadmap')).toBe('accepted')
  })

  it('and with no census to ask, a missing word is simply not a behaviour', () => {
    expect(refusalOf('/delete drafts')).toBe('/delete is not a behaviour in this hive')
  })
})
