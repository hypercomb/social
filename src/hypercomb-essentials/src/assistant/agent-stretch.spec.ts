import { describe, expect, it } from 'vitest'
import { shippedRouteStep, shippedStretchStep, type StretchChunk } from '@hypercomb/core'

const need = { tier: 'balanced', streaming: true }

describe('route — how the loop asks the router', () => {
  it('the first round may prefer and fall back within; later rounds name the pinned provider and model', () => {
    expect(shippedRouteStep.call({ round: 0, need, preferModel: 'm1', fallbackWithin: 'openrouter', avoid: [] }))
      .toEqual({ preferModel: 'm1', need, fallbackWithin: 'openrouter' })
    expect(shippedRouteStep.call({ round: 2, need, pinned: 'p', continuationModel: 'm2', preferModel: 'm1', fallbackWithin: 'openrouter', avoid: ['q'], namedModel: 'm2' }))
      .toEqual({ providerId: 'p', model: 'm2', need, avoid: ['q'], effort: 'balanced' })
  })

  it('a hand-off avoids the provider that gave up, raises the tier, and asks whether another can take it', () => {
    const asked: [unknown, readonly string[]][] = []
    const moved = shippedRouteStep.handoff({
      avoid: [], providerId: 'flash', need, maxHandoffs: 2,
      ready: (next, tried) => { asked.push([next, tried]); return true },
    })
    expect(moved).toEqual({ avoid: ['flash'], need: { tier: 'deep', streaming: true }, another: true })
    expect(asked).toEqual([[{ tier: 'deep', streaming: true }, ['flash']]])
    expect(shippedRouteStep.handoff({ avoid: ['a', 'b'], providerId: 'c', need, maxHandoffs: 2, ready: () => true }).another).toBe(false)
  })

  it('the provider that answered is pinned; a pin already held stays', () => {
    expect(shippedRouteStep.pin({ providerId: 'p', model: 'm' })).toEqual({ pinned: 'p', continuationModel: 'm' })
    expect(shippedRouteStep.pin({ pinned: 'held', providerId: 'p', model: 'm' })).toEqual({ pinned: 'held', continuationModel: 'm' })
  })
})

const stream = async function* (chunks: readonly StretchChunk[]): AsyncGenerator<StretchChunk> {
  for (const chunk of chunks) yield chunk
}

const collect = async (run: AsyncGenerator<string, unknown, void>): Promise<{ yielded: string[]; result: unknown }> => {
  const yielded: string[] = []
  let step = await run.next()
  while (!step.done) { yielded.push(step.value); step = await run.next() }
  return { yielded, result: step.value }
}

describe('stretch — one streamed round', () => {
  const chunk = (text: string, over: Partial<StretchChunk> = {}): StretchChunk =>
    ({ providerId: 'openrouter:deepseek', model: 'deepseek', providerLabel: 'DeepSeek', text, ...over })

  it('yields the prose as it streams, holds the work block back, and hands the round back split', async () => {
    const seen: [string, boolean][] = []
    const { yielded, result } = await collect(shippedStretchStep.run({
      stream: stream([chunk('I will read it.\n\n'), chunk('```hypercomb-read\nread /a\n```')]),
      lead: '', silent: false,
      onProvider: (c, first) => { seen.push([c.providerId, first]) },
    }))
    expect(yielded.join('')).toBe('I will read it.\n\n')
    expect(result).toMatchObject({ providerId: 'openrouter:deepseek', model: 'deepseek', label: 'DeepSeek', wrote: true })
    expect((result as { work: { request?: { kind: string } } }).work.request?.kind).toBe('read')
    expect(seen).toEqual([['openrouter:deepseek', true], ['openrouter:deepseek', false]])
  })

  it('a lead goes before the first visible text only; silent holds the prose but still returns it', async () => {
    const led = await collect(shippedStretchStep.run({ stream: stream([chunk('one '), chunk('two')]), lead: '\n\n', silent: false }))
    expect(led.yielded).toEqual(['\n\none ', 'two'])
    const held = await collect(shippedStretchStep.run({ stream: stream([chunk('quiet')]), lead: '', silent: true }))
    expect(held.yielded).toEqual([])
    expect(held.result).toMatchObject({ roundText: 'quiet', wrote: false })
  })

  it('a provider changing mid-round, or one other than the pin answering, is an error', async () => {
    await expect(collect(shippedStretchStep.run({
      stream: stream([chunk('a'), chunk('b', { providerId: 'other' })]), lead: '', silent: false,
    }))).rejects.toThrow('a provider changed during one model round')
    await expect(collect(shippedStretchStep.run({
      stream: stream([chunk('a')]), pinned: 'held', lead: '', silent: false,
    }))).rejects.toThrow('a different provider answered')
  })
})
