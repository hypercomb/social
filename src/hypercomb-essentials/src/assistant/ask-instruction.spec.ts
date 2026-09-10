// ask-instruction.spec.ts — the vocabulary travels with the question.
//
// A bridged CLI receives a hive question over the broker and, before this
// field existed, received NO instructions with it: the material (prompt,
// transcript, context signatures) and nothing about what the hive can do.
// Claude Code coped only because a skill file happens to sit in this repo; a
// freshly announced Codex or Gemini had to guess. These tests pin the fix:
// every ask carries a signature naming the live, grant-filtered census.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hive globals llm.queen reads. Registered before the import so the
// module's own side-effect registration finds a map to land in.
const iocMap = new Map<string, unknown>()
const ioc = {
  register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
  unregister: (k: string) => { iocMap.delete(k) },
  get: (k: string) => iocMap.get(k),
  has: (k: string) => iocMap.has(k),
  list: () => [...iocMap.keys()],
  onRegister: () => () => {},
  whenReady: () => {},
  graph: () => ({}),
}
;(globalThis as unknown as { window: unknown }).window = { ioc }
;(globalThis as unknown as { ioc: unknown }).ioc = ioc
;(globalThis as unknown as { get: (k: string) => unknown }).get =
  (k: string) => iocMap.get(k)
;(globalThis as unknown as { register: (k: string, v: unknown) => void }).register =
  (k: string, v: unknown) => ioc.register(k, v)

// `submitChat`/`submitAsk` refuse outright unless this tab opted into the
// bridge — the guard that stops an unconfigured hive accumulating requests
// nobody will ever drain. A loopback hostname plus the stored flag is what a
// real bridged tab looks like.
const { CLAUDE_BRIDGE_ENABLED_STORAGE_KEY } = await import('@hypercomb/core')
;(globalThis as unknown as { location: unknown }).location =
  { hostname: 'localhost', search: '' }
localStorage.setItem(CLAUDE_BRIDGE_ENABLED_STORAGE_KEY, 'true')

// This environment's Blob is a stub with no readable body — neither `.text()`
// nor Response can get the bytes back out. The queen only ever constructs one
// from a single string part, so a Blob that simply remembers its parts is a
// faithful stand-in and makes the assertions deterministic.
class TextBlob {
  readonly #text: string
  readonly type: string
  constructor(parts: readonly unknown[] = [], options: { type?: string } = {}) {
    this.#text = parts.map(part => String(part)).join('')
    this.type = options.type ?? ''
  }
  text(): Promise<string> { return Promise.resolve(this.#text) }
}
;(globalThis as unknown as { Blob: unknown }).Blob = TextBlob

const { LlmQueenBee } = await import('./llm.queen.js')

/** Resources and optimizations the queen minted, by signature. */
const resources = new Map<string, string>()
const optimizations: string[] = []
let counter = 0

const readBlob = (blob: Blob): Promise<string> => blob.text()

const store = {
  putResource: async (blob: Blob) => {
    const text = await readBlob(blob)
    // Content-addressed in spirit: same bytes, same handle, so the dedup
    // claim is actually exercised rather than asserted.
    for (const [sig, held] of resources) if (held === text) return sig
    const sig = `res${++counter}`.padEnd(64, '0')
    resources.set(sig, text)
    return sig
  },
  putOptimization: async (blob: Blob) => {
    optimizations.push(await readBlob(blob))
    return `opt${++counter}`.padEnd(64, '0')
  },
}

/** One behaviour that offered itself to machines, and one that did not. */
const behaviours = {
  entries: () => [
    {
      name: 'postit',
      description: 'Pin a tile as an asset',
      machine: { forms: '<tile>', example: '/postit drafts', reach: 'editing', scope: 'tile' },
    },
    { name: 'annotate', description: 'Draw on the screen' },
  ],
}

const lastPayload = (): Record<string, unknown> =>
  JSON.parse(optimizations[optimizations.length - 1]).payload

beforeEach(() => {
  iocMap.clear()
  resources.clear()
  optimizations.length = 0
  counter = 0
  ioc.register('@hypercomb.social/Store', store)
  ioc.register('@hypercomb.social/Lineage', { explorerSegments: () => ['people'] })
  ioc.register('@diamondcoreprocessor.com/SlashBehaviourDrone', behaviours)
})

describe('an ask carries what this hive can do', () => {
  it('names the instruction by SIGNATURE, never inline', async () => {
    const queen = new LlmQueenBee()
    await queen.submitChat('c1', 'what is here?', [], [])

    const payload = lastPayload()
    expect(payload['instructionSig']).toMatch(/^res/)
    // The catalogue itself must NOT be in the record: an ask is a stored
    // resource, and inlining a multi-kilobyte census would re-store it on
    // every turn.
    expect(JSON.stringify(payload)).not.toContain('/postit <tile>')
  })

  it('the signature expands to the live, grant-filtered census', async () => {
    const queen = new LlmQueenBee()
    await queen.submitChat('c1', 'what is here?', [], [])

    const text = resources.get(String(lastPayload()['instructionSig'])) ?? ''
    // The behaviour that declared itself is taught, with its worked example.
    expect(text).toContain('/postit <tile> - Pin a tile as an asset. Example: /postit drafts')
    // The one that never declared a machine grammar is not — default-deny.
    expect(text).not.toContain('/annotate')
    // And the reading half: a bridged model is told how to expand a signature.
    expect(text).toContain('get-resource')
    expect(text).toContain('behaviors-list')
  })

  it('teaches the responder how to ask the participant a direction', async () => {
    const { QUESTION_FENCE_LANG, QUESTION_LIMITS } = await import('@hypercomb/core')
    const queen = new LlmQueenBee()
    await queen.submitChat('c1', 'how should this be laid out?', [], [])

    const text = resources.get(String(lastPayload()['instructionSig'])) ?? ''
    const asking = text.slice(text.indexOf('ASKING.'))
    expect(asking.startsWith('ASKING.')).toBe(true)
    // The convention, as the parser reads it: ONE fence, that language, at
    // the END, two to four options, and the turn ends there.
    expect(asking).toContain('`' + QUESTION_FENCE_LANG + '`')
    expect(asking).toContain('ONE fenced code block')
    expect(asking).toContain('two to four')
    expect(asking).toContain('LAST in the reply')
    expect(asking).toContain('END THE TURN')
    expect(asking).toContain(`under ${QUESTION_LIMITS.promptMax} characters`)
    expect(asking).toContain(`under ${QUESTION_LIMITS.optionMax}`)
    // And the other half: the answer is the next turn, and the composer is
    // always the other answer.
    expect(asking).toContain('arrives as the next turn')
    expect(asking).toContain('their own words')
  })

  it('rides on a note-bound ask too, not just a chat turn', async () => {
    const queen = new LlmQueenBee()
    await queen.submitAsk('summarise this', ['dylan'])
    expect(lastPayload()['instructionSig']).toMatch(/^res/)
  })

  it('dedups across turns — one stored census, many asks pointing at it', async () => {
    const queen = new LlmQueenBee()
    await queen.submitChat('c1', 'first', [], [])
    const first = lastPayload()['instructionSig']
    await queen.submitChat('c1', 'second', [], [])
    expect(lastPayload()['instructionSig']).toBe(first)
    expect(resources.size).toBe(1)
  })

  // A question that cannot state the vocabulary is degraded; a question that
  // never leaves is lost. The send must survive a store that cannot mint.
  it('still sends when the instruction cannot be minted', async () => {
    iocMap.set('@hypercomb.social/Store', {
      putOptimization: store.putOptimization,
      putResource: () => Promise.reject(new Error('disk full')),
    })
    const queen = new LlmQueenBee()
    const sig = await queen.submitChat('c1', 'still asks', [], [])

    expect(sig).toBeTruthy()
    expect(lastPayload()).not.toHaveProperty('instructionSig')
    expect(lastPayload()['prompt']).toBe('still asks')
  })
})
