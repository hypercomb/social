// answer-room.spec.ts — thought is not charged against the answer.
//
// jwize's card page, 2026-11-15: 14 of 186 asks came back with nothing
// written because the model spent its whole 4096-token allowance thinking,
// and the retry asked the same thing with the same allowance.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => { if (!iocMap.has(key)) iocMap.set(key, value) },
    get: (key: string) => iocMap.get(key),
  },
}

const { llmProviderRegistry } = await import('./llm-provider-registry.js')
const { streamRoutedModel } = await import('./llm-dispatch.js')
const { ANSWER_TOKENS, THINKING_ROOM, allThought, answerRoom, forgetAnswerRoom, noteThinking, refuseAnswerRoom } = await import('./answer-room.js')

type Descriptor = import('./providers/llm-provider.types.js').LlmProviderDescriptor
type Result = import('./providers/llm-provider.types.js').LlmCallResult

const registry = llmProviderRegistry()

/** A provider whose answers come from `answers` in order (the last repeats),
 *  recording the allowance each ask was sent with. The allowance also rides
 *  in the URL so a fetch stub can refuse it. */
const thinker = (id: string, answers: readonly Partial<Result>[]): { descriptor: Descriptor; sent: (number | undefined)[]; efforts: (string | undefined)[] } => {
  const sent: (number | undefined)[] = []
  const efforts: (string | undefined)[] = []
  let asked = 0
  return {
    sent,
    efforts,
    descriptor: {
      id,
      label: id,
      vendor: 'local',
      transport: 'browser-http',
      requiresKey: false,
      models: [{ name: id, id: `${id}-model`, tier: 'fast' }],
      defaultModel: `${id}-model`,
      docsUrl: 'https://example.test',
      toRequest: request => {
        sent.push(request.maxTokens)
        efforts.push(request.effort)
        return { url: `https://${id}.example.test/allowance-${request.maxTokens ?? 'plain'}`, init: { method: 'POST' } }
      },
      fromResponse: () => ({
        text: '', stopReason: 'stop', inputTokens: 10, outputTokens: 1, model: `${id}-model`,
        ...answers[Math.min(asked++, answers.length - 1)],
      }),
    },
  }
}

const allThoughtAnswer: Partial<Result> = {
  text: '', stopReason: 'length', outputTokens: ANSWER_TOKENS,
  usage: { inputTokens: 10, outputTokens: ANSWER_TOKENS, reasoningTokens: ANSWER_TOKENS },
}
const thoughtfulAnswer = (text: string): Partial<Result> => ({
  text, outputTokens: 900, usage: { inputTokens: 10, outputTokens: 900, reasoningTokens: 700 },
})

const ask = async (providerId: string, maxTokens?: number, room?: number): Promise<string> => {
  let text = ''
  for await (const chunk of streamRoutedModel({
    providerId, messages: [{ role: 'user', content: 'change the stylesheet' }],
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(room !== undefined ? { room } : {}),
  })) text += chunk.text
  return text
}

beforeEach(() => {
  localStorage.clear()
  for (const provider of registry.all()) registry.unregister(provider.id)
  vi.restoreAllMocks()
  forgetAnswerRoom()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

describe('room for the answer', () => {
  it('is asked for only once a model is seen to think, and never over a caller\'s own allowance', () => {
    expect(answerRoom('p', 'm', undefined)).toBeUndefined()
    noteThinking('p', 'm', { outputTokens: 40 })
    expect(answerRoom('p', 'm', undefined)).toBeUndefined()
    noteThinking('p', 'm', { outputTokens: 900, reasoningTokens: 700 })
    expect(answerRoom('p', 'm', undefined)).toBe(THINKING_ROOM)
    expect(answerRoom('p', 'm', 300)).toBeUndefined()
    expect(answerRoom('p', 'other', undefined)).toBeUndefined()
    refuseAnswerRoom('p', 'm')
    expect(answerRoom('p', 'm', undefined)).toBeUndefined()
  })

  it('gives a call the room it wants, but never over its own allowance or a host that refused', () => {
    const WORK = 16_384
    expect(answerRoom('p', 'm', undefined, WORK)).toBe(WORK)
    expect(answerRoom('p', 'm', undefined, ANSWER_TOKENS)).toBeUndefined()
    expect(answerRoom('p', 'm', 300, WORK)).toBeUndefined()
    noteThinking('p', 'm', { outputTokens: 900, reasoningTokens: 700 })
    expect(answerRoom('p', 'm', undefined, 8_000)).toBe(THINKING_ROOM)
    expect(answerRoom('p', 'm', undefined, 32_000)).toBe(32_000)
    refuseAnswerRoom('p', 'm')
    expect(answerRoom('p', 'm', undefined, WORK)).toBeUndefined()
  })

  it('knows an answer that was all thought, counted inside the output or beside it', () => {
    expect(allThought({ outputTokens: 4096, reasoningTokens: 4096 })).toBe(true)
    expect(allThought({ outputTokens: 0, reasoningTokens: 2000 })).toBe(true)
    expect(allThought({ outputTokens: 900, reasoningTokens: 700 })).toBe(false)
    expect(allThought({ outputTokens: 1 })).toBe(false)
    expect(allThought(undefined)).toBe(false)
  })
})

describe('a model that thought its answer away', () => {
  it('is asked again with room for the thought and told to think less, and answers', async () => {
    const { descriptor, sent, efforts } = thinker('thinks', [allThoughtAnswer, thoughtfulAnswer('the stylesheet is changed')])
    registry.register(descriptor)

    expect(await ask('thinks')).toBe('the stylesheet is changed')
    expect(sent).toEqual([undefined, THINKING_ROOM])
    expect(efforts).toEqual([undefined, 'fast'])

    // From then on it starts with the room: no blank answer to wait out.
    // The effort is the model's own again: thinking less was for that retry.
    expect(await ask('thinks')).toBe('the stylesheet is changed')
    expect(sent).toEqual([undefined, THINKING_ROOM, THINKING_ROOM])
    expect(efforts).toEqual([undefined, 'fast', undefined])
  })

  it('is told to think less when the room itself was thought away', async () => {
    const roomThoughtAway: Partial<Result> = {
      text: '', stopReason: 'length', outputTokens: THINKING_ROOM,
      usage: { inputTokens: 10, outputTokens: THINKING_ROOM, reasoningTokens: THINKING_ROOM },
    }
    const { descriptor, sent, efforts } = thinker('runaway', [thoughtfulAnswer('first'), roomThoughtAway, thoughtfulAnswer('second')])
    registry.register(descriptor)
    await ask('runaway')
    expect(await ask('runaway')).toBe('second')
    expect(sent).toEqual([undefined, THINKING_ROOM, THINKING_ROOM])
    expect(efforts).toEqual([undefined, undefined, 'fast'])
  })

  it('starts with the room after any answer that reported thought', async () => {
    const { descriptor, sent } = thinker('thoughtful', [thoughtfulAnswer('done')])
    registry.register(descriptor)
    await ask('thoughtful')
    await ask('thoughtful')
    expect(sent).toEqual([undefined, THINKING_ROOM])
  })

  it('says where the allowance went when it stays blank', async () => {
    const { descriptor, sent } = thinker('lost-in-thought', [allThoughtAnswer])
    registry.register(descriptor)
    await expect(ask('lost-in-thought')).rejects.toThrow(
      /lost-in-thought thought for 4096 tokens, which used up its answer of 16384, and returned no visible text$/,
    )
    expect(sent).toEqual([undefined, THINKING_ROOM])
  })

  it('leaves a caller\'s own allowance alone', async () => {
    const { descriptor, sent } = thinker('capped', [thoughtfulAnswer('short')])
    registry.register(descriptor)
    await ask('capped', 300)
    await ask('capped', 300)
    expect(sent).toEqual([300, 300])
  })

  it('asks plainly when the host refuses the room, and stops asking for it', async () => {
    const { descriptor, sent } = thinker('small-host', [thoughtfulAnswer('done')])
    registry.register(descriptor)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes(`allowance-${THINKING_ROOM}`)
      ? new Response('{"error":{"message":"max_tokens is too large"}}', { status: 400 })
      : new Response('{}', { status: 200 })))

    expect(await ask('small-host')).toBe('done')
    expect(await ask('small-host')).toBe('done')
    expect(sent).toEqual([undefined, THINKING_ROOM, undefined])
    expect(await ask('small-host')).toBe('done')
    expect(sent).toEqual([undefined, THINKING_ROOM, undefined, undefined])
  })

  // ROOM FOR THE WORK: a work round that may write six files asks for room,
  // and a host that cannot give it answers the same round plainly.
  it('asks a work round with the room it wants, and plainly when the host refuses it', async () => {
    const WORK = 16_384
    const roomy = thinker('roomy-host', [{ text: 'six files' }])
    registry.register(roomy.descriptor)
    expect(await ask('roomy-host', undefined, WORK)).toBe('six files')
    expect(roomy.sent).toEqual([WORK])

    const small = thinker('eight-k-host', [{ text: 'done' }])
    registry.register(small.descriptor)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes(`allowance-${WORK}`)
      ? new Response('{"error":{"message":"max_tokens is too large"}}', { status: 400 })
      : new Response('{}', { status: 200 })))
    expect(await ask('eight-k-host', undefined, WORK)).toBe('done')
    expect(await ask('eight-k-host', undefined, WORK)).toBe('done')
    expect(small.sent).toEqual([WORK, undefined, undefined])
  })
})
