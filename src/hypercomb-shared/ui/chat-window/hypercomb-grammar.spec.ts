import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MACHINE_GRANT } from '@hypercomb/core'
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

// A CENSUS, NOT A COPY OF THE APP'S RULES. Each behaviour here declares its
// own machine grammar exactly as a shipped one does; the rules themselves are
// deliberately toy. This module's contract is that it READS declarations
// faithfully — what the shipped behaviours actually declare is asserted where
// those behaviours live (machine-grammar.spec.ts in essentials), so neither
// spec can pass by agreeing with a stale copy of the other.
const entries: HypercombBehaviour[] = [
  { name: 'create', description: 'Make a tile', aliases: ['make'], options: ['<name>'],
    examples: [{ input: '/create roadmap', result: 'made' }],
    machine: {
      forms: '<name>',
      example: '/create roadmap',
      reach: 'additive',
      refuse: args => args.includes('\\') ? 'no backslashes' : undefined,
    } },
  { name: 'keyword', description: 'Tag tiles', options: ['<tag>'],
    machine: { forms: '<tag> | ~<tag>', example: '/keyword urgent', reach: 'editing' } },
  { name: 'accent', description: 'Set an accent', options: ['ember'],
    machine: {
      forms: '<preset>',
      example: '/accent ember',
      reach: 'editing',
      refuse: args => args.trim() === 'ember' ? undefined : 'unknown preset',
    } },
  { name: 'postit', description: 'Add a note', options: ['here <text>'],
    machine: { forms: 'here <text>', example: '/postit here First draft', reach: 'additive' } },
  { name: 'title', description: 'Set a display title', options: ['<text>'],
    machine: { forms: '<text>', example: '/title Road map', reach: 'editing' } },
  { name: 'remove', description: 'Remove a tile',
    machine: {
      forms: '<tile>', example: '/remove drafts', reach: 'destructive',
      consequence: 'Takes it off this page; /undo restores it.',
    } },
  { name: 'undo', description: 'Step back',
    machine: { forms: '| <steps>', example: '/undo', bare: true, reach: 'editing' } },
  // Declares nothing: the default, and the majority of the live census.
  { name: 'files', description: 'Open the file explorer' },
  { name: 'debug', description: 'Debug', hidden: true, machine: { forms: '<flag>', example: '/debug on' } },
  { name: 'workbench', description: 'Prototype', prototype: true, machine: { forms: '<x>', example: '/workbench x' } },
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
    // TWO GATES, AND THEY ARE DIFFERENT QUESTIONS. Membership starts with the
    // declaration — `files` declares none and is out — and then the
    // participant's ceiling decides how much of what declared itself may
    // actually be said. `remove` declares one, and is out under the STANDING
    // DEFAULT because it is destructive; it comes back the moment the hive
    // grants that far.
    expect(callableBehaviours(entries, DEFAULT_MACHINE_GRANT).map(entry => entry.name)).toEqual([
      'create', 'keyword', 'accent', 'postit', 'title', 'undo',
    ])
    expect(callableBehaviours(entries, { reach: 'destructive', scope: 'network' })
      .map(entry => entry.name)).toEqual([
      'create', 'keyword', 'accent', 'postit', 'title', 'remove', 'undo',
    ])
    // A ceiling of 'none' is the off switch, and it empties the vocabulary —
    // which is what makes `canAct` false and takes the tool away entirely.
    expect(callableBehaviours(entries, { reach: 'none', scope: 'network' })).toEqual([])

    const tool = hypercombGrammarTool(entries, { reach: 'destructive', scope: 'network' })
    expect(tool.function.name).toBe('hypercomb_act')
    expect(tool.function.strict).toBe(true)
    const body = JSON.stringify(tool)
    expect(body).toContain('/create')
    expect(body).toContain('/remove')
    expect(body).not.toContain('/files')
    // WHAT IS REFUSED IS NEVER TAUGHT. Under the default the catalogue does not
    // name the verb it would go on to refuse — the difference between a
    // boundary and a trap.
    expect(JSON.stringify(hypercombGrammarTool(entries, DEFAULT_MACHINE_GRANT)))
      .not.toContain('/remove')
    expect(body).not.toContain('/debug')
    expect(hypercombGrammarInstruction(entries)).toContain('cannot use a shell')
  })

  it("quotes the behaviour's own consequence, and invents none of its own", () => {
    // Granted destructive on purpose: this asserts the catalogue's WORDING, and
    // the only entry carrying a consequence is the one the default ceiling
    // would otherwise hide.
    const catalogue = hypercombGrammarInstruction(entries, { reach: 'destructive', scope: 'network' })
    // The consequence rides through VERBATIM. This module knows how far a verb
    // reaches but not what reaching there does — it printed a fixed sentence
    // per reach value once, and that sentence promised a confirmation /remove
    // does not perform for a leaf tile.
    expect(catalogue).toContain(
      '/remove <tile> - Remove a tile. Takes it off this page; /undo restores it. Example: /remove drafts')
    // Declaring no consequence buys silence, not a default.
    expect(catalogue).toContain('/create <name> - Make a tile. Example: /create roadmap')
  })

  it('never composes a consequence from the reach value alone', () => {
    const silent = hypercombGrammarInstruction([
      { name: 'remove', description: 'Remove a tile',
        machine: { forms: '<tile>', example: '/remove drafts', reach: 'destructive' } },
    ], { reach: 'destructive', scope: 'network' })
    expect(silent).toContain('/remove <tile> - Remove a tile. Example: /remove drafts')
    expect(silent).not.toContain('confirm')
  })

  it('admits a bare verb only where the behaviour said a bare verb means something', () => {
    expect(parseHypercombGrammars(['/undo'], entries).actions[0])
      .toEqual({ grammar: '/undo', command: 'undo', args: '' })
    expect(() => parseHypercombGrammars(['/create'], entries)).toThrow('needs an explicit argument')
  })

  it("refuses through the behaviour's own rule, in the behaviour's own words", () => {
    expect(() => parseHypercombGrammars(['/accent ultraviolet'], entries)).toThrow('unknown preset')
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
    ['multiline grammar', call(['/create a\n/create b'])],
    ['alias', call(['/make a'])],
    ['unknown command', call(['/invent a'])],
    ['an undeclared behaviour', call(['/files here'])],
    ['missing explicit args', call(['/create'])],
    ['a refusal from the behaviour itself', call(['/create \\'])],
    ['an unknown accent preset', call(['/accent ultraviolet'])],
  ])('rejects %s before execution', (_label, calls) => {
    expect(() => parseHypercombToolCalls(calls, entries)).toThrow()
  })

  it('also rejects a declared command when its live entry becomes hidden or prototype', () => {
    // A declaration is not an override: concealment is checked independently,
    // so a behaviour that leaves the palette leaves the machine census with it.
    const declared = { forms: '<x>', example: '/create x' } as const
    // AND IT SAYS WHICH RULE APPLIED. A flat "not available" sends a model
    // looking for a synonym; naming concealment tells it there is nothing to
    // look for. Same for a ceiling, below.
    expect(() => parseHypercombToolCalls(call(['/create a']), [
      { name: 'create', hidden: true, machine: declared },
    ])).toThrow('/create is not offered to a caller that is not typing it')
    expect(() => parseHypercombToolCalls(call(['/title a']), [
      { name: 'title', prototype: true, machine: declared },
    ])).toThrow('/title is not offered to a caller that is not typing it')
  })

  it('refuses a verb above the ceiling in words a model can act on', () => {
    // The audit's blunt question was whether a model could delete a tile
    // unattended. It could: one hypercomb_act call carrying /remove <leaf> ran
    // to a committed layer with no dialog, because this door had no reach gate
    // at all. Under the standing default it is refused, and told what it may
    // have instead.
    expect(() => parseHypercombToolCalls(call(['/remove drafts']), entries, DEFAULT_MACHINE_GRANT))
      .toThrow('/remove is destructive, and this hive grants a machine no further than editing')
    // A tightened scope refuses on the other axis, independently.
    expect(() => parseHypercombToolCalls(call(['/create a']), entries, { reach: 'editing', scope: 'local' }))
      .toThrow('/create has not declared how far it travels')
  })

  it('validates the whole batch before any executor is involved', () => {
    expect(() => parseHypercombToolCalls(call(['/create good', '/files bad']), entries)).toThrow('/files')
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
