import { describe, expect, it, vi } from 'vitest'
import {
  callableBehaviours,
  executeHypercombPlan,
  formatHypercombReceipt,
  HYPERCOMB_GRAMMAR_TOOL_NAME,
  HypercombPlanQueue,
  hypercombActionProviderId,
  hypercombContextKey,
  hypercombGrammarInstruction,
  hypercombGrammarTool,
  parseHypercombGrammars,
  parseHypercombToolCalls,
  type HypercombBehaviour,
} from './hypercomb-grammar.js'

const entries: HypercombBehaviour[] = [
  { name: 'create', description: 'Make a tile', aliases: ['make'], options: ['<name>'], examples: [{ input: '/create roadmap', result: 'made' }] },
  { name: 'keyword', description: 'Tag tiles', options: ['<tag>'] },
  { name: 'accent', description: 'Set an accent', options: ['ember'] },
  { name: 'postit', description: 'Add a note', options: ['here <text>'] },
  { name: 'title', description: 'Set a display title', options: ['<text>'] },
  { name: 'remove', description: 'Remove a tile' },
  { name: 'debug', description: 'Debug', hidden: true },
  { name: 'workbench', description: 'Prototype', prototype: true },
]

const call = (grammars: unknown, extra: Record<string, unknown> = {}) => [{
  name: HYPERCOMB_GRAMMAR_TOOL_NAME,
  arguments: JSON.stringify({ grammars, ...extra }),
}]

describe('Hypercomb model grammar contract', () => {
  it('grants action transport only to an automatic or explicitly local route', () => {
    expect(hypercombActionProviderId(true, undefined, undefined, true)).toBe('local')
    expect(hypercombActionProviderId(true, 'qwen3:8b', 'local', true)).toBe('local')
    expect(hypercombActionProviderId(true, 'gpt-5', 'openai', true)).toBeUndefined()
    expect(hypercombActionProviderId(false, undefined, undefined, true)).toBeUndefined()
    expect(hypercombActionProviderId(true, undefined, undefined, false)).toBeUndefined()
  })

  it('keys relative grammar to its page and selection, independent of selection order', () => {
    expect(hypercombContextKey(['projects'], ['b', 'a']))
      .toBe(hypercombContextKey(['projects'], ['a', 'b']))
    expect(hypercombContextKey(['projects'], ['a']))
      .not.toBe(hypercombContextKey(['archive'], ['a']))
  })

  it('publishes one grammar-sequence tool from the live, default-deny census', () => {
    expect(callableBehaviours(entries).map(entry => entry.name)).toEqual([
      'create', 'keyword', 'accent', 'postit', 'title',
    ])

    const tool = hypercombGrammarTool(entries)
    expect(tool.function.name).toBe('hypercomb_act')
    expect(tool.function.strict).toBe(true)
    const body = JSON.stringify(tool)
    expect(body).toContain('/create')
    expect(body).not.toContain('/remove')
    expect(body).not.toContain('/debug')
    expect(hypercombGrammarInstruction(entries)).toContain('cannot use a shell')
  })

  it('parses a fully valid ordered sequence from JSON or object arguments', () => {
    const fromJson = parseHypercombToolCalls(call(['/create roadmap', '/title roadmap = Road map']), entries)
    expect(fromJson.actions).toEqual([
      { grammar: '/create roadmap', command: 'create', args: 'roadmap' },
      { grammar: '/title roadmap = Road map', command: 'title', args: 'roadmap = Road map' },
    ])

    const fromObject = parseHypercombToolCalls([{
      name: HYPERCOMB_GRAMMAR_TOOL_NAME,
      arguments: { grammars: ['/postit here First draft'] },
    }], entries)
    expect(fromObject.actions[0]?.args).toBe('here First draft')

    const fromProvider = parseHypercombToolCalls([{
      type: 'function',
      function: {
        name: HYPERCOMB_GRAMMAR_TOOL_NAME,
        arguments: '{"grammars":["/accent ember"]}',
      },
    }], entries)
    expect(fromProvider.actions[0]?.command).toBe('accent')
  })

  it.each([
    ['bad JSON', [{ name: HYPERCOMB_GRAMMAR_TOOL_NAME, arguments: '{' }]],
    ['wrong tool', [{ name: 'shell', arguments: '{}' }]],
    ['multiple calls', [...call(['/create a']), ...call(['/create b'])]],
    ['extra property', call(['/create a'], { cwd: '/' })],
    ['empty sequence', call([])],
    ['too many lines', call(Array.from({ length: 13 }, (_, i) => `/create ${i}`))],
    ['non-string grammar', call([42])],
    ['control character', call(['/create a\u0000'])],
    ['overlong grammar', call([`/create ${'a'.repeat(1_001)}`])],
    ['non-slash prose', call(['create a'])],
    ['multiline grammar', call(['/create a\n/remove b'])],
    ['alias', call(['/make a'])],
    ['unknown command', call(['/invent a'])],
    ['default-denied destructive command', call(['/remove a'])],
    ['missing explicit args', call(['/create'])],
    ['invalid create path', call(['/create \\'])],
    ['broad postit operation', call(['/postit remove'])],
    ['tag removal subform', call(['/keyword ~urgent'])],
    ['invalid keyword colour', call(['/keyword urgent(red)'])],
    ['accent removal subform', call(['/accent ~education'])],
    ['unknown accent', call(['/accent ultraviolet'])],
    ['title without a target', call(['/title = Something'])],
    ['title path target', call(['/title child/path = Something'])],
    ['title clear subform', call(['/title roadmap ='])],
  ])('rejects %s before execution', (_label, calls) => {
    expect(() => parseHypercombToolCalls(calls, entries)).toThrow()
  })

  it('also rejects a callable command when its live entry becomes hidden or prototype', () => {
    expect(() => parseHypercombToolCalls(call(['/create a']), [
      { name: 'create', hidden: true },
    ])).toThrow('/create is not available')
    expect(() => parseHypercombToolCalls(call(['/title a']), [
      { name: 'title', prototype: true },
    ])).toThrow('/title is not available')
  })

  it('validates the whole batch before any executor is involved', () => {
    expect(() => parseHypercombToolCalls(call(['/create good', '/remove bad']), entries)).toThrow('/remove')
  })

  it('exposes raw grammar sequences as the contract beneath the tool envelope', () => {
    expect(parseHypercombGrammars(['/create roadmap'], entries).actions[0])
      .toEqual({ grammar: '/create roadmap', command: 'create', args: 'roadmap' })
  })

  it('awaits actions in order and returns a visible receipt', async () => {
    const states: string[] = []
    const executor = {
      execute: vi.fn(async (command: string) => {
        states.push(`start:${command}`)
        await Promise.resolve()
        states.push(`end:${command}`)
      }),
    }
    const plan = parseHypercombToolCalls(call(['/create roadmap', '/title roadmap = Road map']), entries)
    const receipt = await executeHypercombPlan(plan, executor)

    expect(states).toEqual(['start:create', 'end:create', 'start:title', 'end:title'])
    expect(formatHypercombReceipt(receipt)).toContain('Ran 2 Hypercomb grammars')
  })

  it('does not begin another grammar after the participant stops the run', async () => {
    const controller = new AbortController()
    const executor = {
      execute: vi.fn(async () => { controller.abort() }),
    }
    const plan = parseHypercombToolCalls(call(['/create roadmap', '/title roadmap = Road map']), entries)

    await expect(executeHypercombPlan(plan, executor, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(executor.execute).toHaveBeenCalledTimes(1)
  })

  it('serializes whole plans so conversations cannot interleave grammars', async () => {
    const queue = new HypercombPlanQueue()
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve })
    const order: string[] = []
    const executor = {
      execute: vi.fn(async (_command: string, args: string) => {
        order.push(`start:${args}`)
        if (args === 'one') {
          markFirstStarted()
          await firstGate
        }
        order.push(`end:${args}`)
      }),
    }
    const first = queue.run(parseHypercombGrammars(['/create one'], entries), executor)
    const second = queue.run(parseHypercombGrammars(['/create two'], entries), executor)
    await firstStarted
    expect(order).toEqual(['start:one'])

    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['start:one', 'end:one', 'start:two', 'end:two'])
  })

  it('returns an aborted queued plan promptly without opening its queue slot early', async () => {
    const queue = new HypercombPlanQueue()
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve })
    const order: string[] = []
    const executor = {
      execute: vi.fn(async (_command: string, args: string) => {
        order.push(`start:${args}`)
        if (args === 'one') {
          markFirstStarted()
          await firstGate
        }
        order.push(`end:${args}`)
      }),
    }
    const first = queue.run(parseHypercombGrammars(['/create one'], entries), executor)
    const controller = new AbortController()
    const stopped = queue.run(
      parseHypercombGrammars(['/create stopped'], entries), executor, controller.signal,
    )
    const third = queue.run(parseHypercombGrammars(['/create three'], entries), executor)
    await firstStarted
    controller.abort()

    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' })
    expect(order).toEqual(['start:one'])
    releaseFirst()
    await Promise.all([first, third])
    expect(order).toEqual(['start:one', 'end:one', 'start:three', 'end:three'])
  })

  it('stops waiting for an in-flight action but holds the lane until that action settles', async () => {
    const queue = new HypercombPlanQueue()
    const controller = new AbortController()
    let markStarted!: () => void
    let finishAction!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const actionGate = new Promise<void>(resolve => { finishAction = resolve })
    const order: string[] = []
    const executor = {
      execute: vi.fn(async (command: string, args: string) => {
        order.push(`start:${command}:${args}`)
        if (command === 'create' && args === 'one') {
          markStarted()
          await actionGate
        }
        order.push(`end:${command}:${args}`)
      }),
    }
    const running = queue.run(parseHypercombGrammars([
      '/create one', '/title one = One',
    ], entries), executor, controller.signal)
    await started
    controller.abort()
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })

    const later = queue.run(parseHypercombGrammars(['/create later'], entries), executor)
    await Promise.resolve()
    expect(order).toEqual(['start:create:one'])
    finishAction()
    await later
    expect(order).toEqual([
      'start:create:one', 'end:create:one',
      'start:create:later', 'end:create:later',
    ])
  })

  it('stops on the first runtime failure and reports the completed prefix', async () => {
    const executor = {
      execute: vi.fn(async (command: string) => {
        if (command === 'keyword') throw new Error('failed')
      }),
    }
    const plan = parseHypercombToolCalls(call([
      '/create roadmap', '/keyword urgent', '/title roadmap = Road map',
    ]), entries)

    await expect(executeHypercombPlan(plan, executor)).rejects.toMatchObject({
      completed: ['/create roadmap'],
      grammar: '/keyword urgent',
    })
    expect(executor.execute).toHaveBeenCalledTimes(2)
  })
})
