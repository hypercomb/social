// _chat-reply.spec.ts — the reply script's serializer against the core parser.
//
// The question fence is spelled TWICE by necessity: once in TypeScript
// (hypercomb-core/src/question-fence.ts, the one parser every reader uses)
// and once in CommonJS (the script cannot import the TypeScript). If the two
// drift, the failure is silent and looks like success: the script emits a
// fence, the reply lands, and the chat window draws a code block where the
// radiogroup should be. So the two implementations are compared directly —
// every fence the script emits must come back out of the core parser as the
// question that went in, and every reason core refuses must be the reason the
// script refuses, word for word.
//
// `buildReply` is pure, so the argument grammar is exercised here without a
// broker: a usage problem throws before any socket exists.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import {
  QUESTION_LIMITS,
  questionFence as coreFence,
  questionProblem as coreProblem,
  splitQuestion,
} from '@hypercomb/core'

const require_ = createRequire(import.meta.url)
const script = require_('./_chat-reply.cjs') as {
  questionFence: (prompt: string, options: readonly string[]) => string
  questionProblem: (prompt: unknown, options: unknown) => string | null
  proseProblem: (prose: string) => string | null
  readQuestion: (text: string) => { question?: { prompt: string; options: string[] }; problem?: string }
  buildReply: (argv: readonly string[]) => { convoId: string; text: string; run: unknown }
  QUESTION_LIMITS: typeof QUESTION_LIMITS
  USAGE: string
}

// A signature-shaped string, never a real one (the doctrine ratchet refuses a
// hardcoded 64-hex literal, and rightly: nothing here addresses content).
const ASK = 'a'.repeat(64)
const CONVO = 'chat:example'

describe('the script and core agree on the limits', () => {
  it('spells the same numbers', () => {
    expect(script.QUESTION_LIMITS).toEqual({ ...QUESTION_LIMITS })
  })
})

describe('a fence the script emits is the question core reads', () => {
  const cases: readonly [string, readonly string[]][] = [
    ['How many pages?', ['One long page', 'Several pages']],
    ['  Padded prompt  ', ['  a  ', 'b', ' c ', 'd']],
    ['Unicode — “quotes” · dots?', ['Öl', '日本語', 'emoji 🐝']],
    ['Prompt with "double" and \'single\' quotes', ['x"y', "x'y"]],
    ['Backslash \\ and slash /', ['a\\b', 'a/b']],
    ['x'.repeat(QUESTION_LIMITS.promptMax), ['y'.repeat(QUESTION_LIMITS.optionMax), 'z']],
  ]

  for (const [prompt, options] of cases) {
    it(`round-trips ${JSON.stringify(prompt.slice(0, 24))}`, () => {
      const fence = script.questionFence(prompt, options)
      expect(fence).toBe(coreFence(prompt, options))
      expect(splitQuestion(fence)).toEqual({
        prose: '',
        question: { prompt: prompt.trim(), options: options.map(option => option.trim()) },
      })
    })
  }
})

describe('the script refuses exactly what core refuses', () => {
  const bad: readonly [string, unknown, unknown][] = [
    ['non-string prompt', 42, ['a', 'b']],
    ['empty prompt', '   ', ['a', 'b']],
    ['prompt too long', 'x'.repeat(QUESTION_LIMITS.promptMax + 1), ['a', 'b']],
    ['control character in prompt', 'yes\u0007no', ['a', 'b']],
    ['newline in prompt', 'line\nbreak', ['a', 'b']],
    ['DEL in prompt', 'x\u007Fy', ['a', 'b']],
    ['options not an array', 'p', 'a · b'],
    ['one option', 'p', ['only']],
    ['five options', 'p', ['a', 'b', 'c', 'd', 'e']],
    ['non-string option', 'p', ['a', 2]],
    ['empty option', 'p', ['a', '  ']],
    ['option too long', 'p', ['a', 'y'.repeat(QUESTION_LIMITS.optionMax + 1)]],
    ['control character in option', 'p', ['a', 'b\tc']],
    ['trailing newline in option is refused before trim could hide it', 'p', ['a', 'y\n']],
    ['duplicate options after trimming', 'p', ['a', ' a ']],
  ]

  for (const [name, prompt, options] of bad) {
    it(`${name}: same reason`, () => {
      const reason = coreProblem(prompt, options)
      expect(reason, 'core must refuse this case').not.toBeNull()
      expect(script.questionProblem(prompt, options)).toBe(reason)
      expect(() => script.questionFence(prompt as string, options as string[]))
        .toThrow(`hypercomb-question: ${reason}`)
    })
  }

  it('accepts what core accepts', () => {
    expect(script.questionProblem('p', ['a', 'b'])).toBeNull()
    expect(coreProblem('p', ['a', 'b'])).toBeNull()
  })
})

describe('buildReply — prose, question, or both', () => {
  it('prose alone is the text, untouched but for trimming', () => {
    const built = script.buildReply([CONVO, '  Hello there.  '])
    expect(built.convoId).toBe(CONVO)
    expect(built.text).toBe('Hello there.')
    expect(splitQuestion(built.text)).toEqual({ prose: 'Hello there.' })
  })

  it('a question alone is the fence alone', () => {
    const built = script.buildReply(
      [CONVO, '--question', 'How many pages?', '--option', 'One', '--option', 'Several'])
    expect(built.text).toBe(coreFence('How many pages?', ['One', 'Several']))
    expect(splitQuestion(built.text)).toEqual({
      prose: '',
      question: { prompt: 'How many pages?', options: ['One', 'Several'] },
    })
  })

  it('prose then the fence, one blank line between — and core hands the prose back', () => {
    const built = script.buildReply(
      [CONVO, 'Two ways to lay this out.', '--question', 'How many pages?', '--option', 'One', '--option', 'Several'])
    expect(built.text).toBe('Two ways to lay this out.\n\n' + coreFence('How many pages?', ['One', 'Several']))
    expect(splitQuestion(built.text)).toEqual({
      prose: 'Two ways to lay this out.',
      question: { prompt: 'How many pages?', options: ['One', 'Several'] },
    })
  })

  it('takes four options', () => {
    const built = script.buildReply(
      [CONVO, '--question', 'Which?', '--option', 'a', '--option', 'b', '--option', 'c', '--option', 'd'])
    expect(splitQuestion(built.text).question?.options).toEqual(['a', 'b', 'c', 'd'])
  })

  it('flags first: the positionals may come after them', () => {
    const built = script.buildReply(['--ask', ASK, CONVO, 'Hi'])
    expect(built).toEqual({ convoId: CONVO, text: 'Hi', run: { ask: ASK } })
  })

  it('multi-paragraph prose survives as one positional', () => {
    const built = script.buildReply([CONVO, 'First.\n\nSecond.'])
    expect(built.text).toBe('First.\n\nSecond.')
  })
})

describe('buildReply — the run', () => {
  it('--ask attaches { ask } and nothing else: the renderer resolves the bucket', () => {
    expect(script.buildReply([CONVO, 'Hi', '--ask', ASK]).run).toEqual({ ask: ASK })
  })

  it('never reads the environment — a stale HYPERCOMB_RUN_ASK files nothing (chat-route.md §7)', () => {
    // A persistent shell keeps an older ask's variable; honouring it would
    // file THIS conversation's reply under that ask's run. Unrecorded beats
    // misfiled, so only --ask attaches a run.
    const held = process.env['HYPERCOMB_RUN_ASK']
    process.env['HYPERCOMB_RUN_ASK'] = 'b'.repeat(64)
    try {
      expect(script.buildReply([CONVO, 'Hi']).run).toBeNull()
      expect(script.buildReply([CONVO, 'Hi', '--ask', ASK]).run).toEqual({ ask: ASK })
    } finally {
      if (held === undefined) delete process.env['HYPERCOMB_RUN_ASK']
      else process.env['HYPERCOMB_RUN_ASK'] = held
    }
  })

  it('with neither, nothing is recorded — as before', () => {
    expect(script.buildReply([CONVO, 'Hi']).run).toBeNull()
  })
})

describe('buildReply — usage problems throw, so no socket is ever opened for them', () => {
  const usage: readonly [string, readonly string[]][] = [
    ['no arguments', []],
    ['convoId only', [CONVO]],
    ['blank convoId', ['   ', 'Hi']],
    ['blank prose and no question', [CONVO, '   ']],
    ['--question without options', [CONVO, '--question', 'Which?']],
    ['--question with one option', [CONVO, '--question', 'Which?', '--option', 'a']],
    ['--question with five options',
      [CONVO, '--question', 'Which?', '--option', 'a', '--option', 'b', '--option', 'c', '--option', 'd', '--option', 'e']],
    ['--option without a question', [CONVO, 'Hi', '--option', 'a', '--option', 'b']],
    ['two questions in one reply',
      [CONVO, '--question', 'A?', '--option', 'a', '--option', 'b', '--question', 'B?']],
    ['--ask that is not a signature', [CONVO, 'Hi', '--ask', 'not-a-sig']],
    ['--ask given twice', [CONVO, 'Hi', '--ask', ASK, '--ask', ASK]],
    ['a flag with no value', [CONVO, 'Hi', '--ask']],
    ['an unknown flag', [CONVO, 'Hi', '--other']],
    ['three positionals (unquoted prose)', [CONVO, 'two', 'words']],
    ['duplicate options', [CONVO, '--question', 'Which?', '--option', 'a', '--option', 'a']],
    ['a control character in an option', [CONVO, '--question', 'Which?', '--option', 'a', '--option', 'b\nc']],
  ]

  for (const [name, argv] of usage) {
    it(name, () => {
      expect(() => script.buildReply(argv)).toThrow()
    })
  }

  it('the usage text names the flags', () => {
    for (const flag of ['--ask', '--question', '--option']) expect(script.USAGE).toContain(flag)
  })
})

const Q = ['--question', 'How many pages?', '--option', 'One', '--option', 'Several'] as const
const QUESTION = { prompt: 'How many pages?', options: ['One', 'Several'] }

describe('buildReply — the question it sends is the question core reads, or nothing is sent', () => {
  it('refuses prose that leaves a fence open — the question would be swallowed into it', () => {
    expect(() => script.buildReply([CONVO, 'Here is the start:\n```js\nconst x = 1', ...Q])).toThrow(/fence open/)
  })

  it('refuses prose that already quotes a hypercomb-question fence — two parse as none', () => {
    const quoted = 'Earlier I asked:\n\n' + coreFence('Which?', ['a', 'b'])
    expect(() => script.buildReply([CONVO, quoted, ...Q])).toThrow(/hypercomb-question/)
    // …and without --question too: a hand-written fence skips validation.
    expect(() => script.buildReply([CONVO, quoted])).toThrow(/hypercomb-question/)
  })

  const fine: readonly [string, string][] = [
    ['backticks inside a line', 'Wrap code in ``` fences when you paste it.'],
    ['a closed code block', 'Like this:\n\n```js\nconst x = 1\n```\n\nThen choose.'],
    ['a four-space indent, which is not a fence', 'Before.\n    ```hypercomb-question\nAfter.'],
    ['a longer fence whose BODY quotes a question fence',
      'The convention looks like:\n\n~~~~markdown\n' + coreFence('Which?', ['a', 'b']) + '\n~~~~'],
    ['the language named in prose', 'I will ask with a `hypercomb-question` block.'],
    ['a tilde block closed by a longer run', '~~~\ntext\n~~~~~'],
  ]
  for (const [name, prose] of fine) {
    it(`sends fence-like prose that is fine: ${name}`, () => {
      const built = script.buildReply([CONVO, prose, ...Q])
      expect(splitQuestion(built.text).question).toEqual(QUESTION)
      expect(script.readQuestion(built.text)).toEqual({ question: QUESTION })
    })
  }
})

describe('readQuestion is core\'s strict rule, text for text', () => {
  const fence = coreFence('How many pages?', ['One', 'Several'])
  const corpus: readonly [string, string][] = [
    ['a bare question', fence],
    ['prose then the question', 'Two ways.\n\n' + fence],
    ['no fence at all', 'Just words.'],
    ['a code block only', '```js\nx\n```'],
    ['two question fences', fence + '\n\n' + fence],
    ['a fence after the question', fence + '\n\n```js\nx\n```'],
    ['the question left open', '```hypercomb-question\n{"prompt":"p","options":["a","b"]}'],
    ['an open fence before the question swallows it', '```js\n\n' + fence],
    ['a body that is not JSON', '```hypercomb-question\nnot json\n```'],
    ['a body with an extra key', '```hypercomb-question\n{"prompt":"p","options":["a","b"],"x":1}\n```'],
    ['a body that fails validation', '```hypercomb-question\n{"prompt":"p","options":["a"]}\n```'],
    ['a question quoted inside a longer fence, then the question', '~~~~\n' + fence + '\n~~~~\n\n' + fence],
    ['trailing words on the info string', '```hypercomb-question extra\n{"prompt":"p","options":["a","b"]}\n```'],
    ['a tilde question fence', '~~~hypercomb-question\n{"prompt":"p","options":["a","b"]}\n~~~'],
  ]
  for (const [name, text] of corpus) {
    it(name, () => {
      const core = splitQuestion(text).question
      const read = script.readQuestion(text)
      expect(read.question).toEqual(core)
      expect(read.problem === undefined).toBe(core !== undefined)
    })
  }
})

describe('the script, run: a refusal exits 1 and never connects', () => {
  /** Run the real script against a local broker that counts connections and
   *  answers every request ok, so a refusal and a delivery are told apart by
   *  what reached the socket. */
  const run = async (argv: readonly string[]) => {
    const { execFile } = await import('node:child_process')
    const { WebSocketServer } = await import('ws')
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    let connections = 0
    const received: Record<string, unknown>[] = []
    server.on('connection', socket => {
      connections++
      socket.on('message', raw => {
        const req = JSON.parse(String(raw)) as Record<string, unknown>
        received.push(req)
        socket.send(JSON.stringify({ id: req['id'], ok: true, data: {} }))
      })
    })
    await new Promise<void>(resolve => server.on('listening', resolve))
    const { port } = server.address() as { port: number }
    // Resolved through the same require the module was loaded with — this
    // environment's import.meta.url is not a file: URL.
    const script_ = require_.resolve('./_chat-reply.cjs')
    const child = await new Promise<{ code: number; stderr: string }>(resolve => {
      execFile(process.execPath, [script_, ...argv], {
        env: { ...process.env, BRIDGE_URL: `ws://127.0.0.1:${port}`, HYPERCOMB_BRIDGE_TOKEN: '' },
      }, (err, _stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stderr: String(stderr) })
      })
    })
    await new Promise<void>(resolve => server.close(() => resolve()))
    return { ...child, connections, received }
  }

  it('control: a sound reply connects and delivers exactly that question', async () => {
    const result = await run([CONVO, 'Two ways.', ...Q, '--ask', ASK])
    expect(result.code).toBe(0)
    expect(result.connections).toBe(1)
    expect(result.received[0]?.['op']).toBe('chat-reply')
    expect(result.received[0]?.['run']).toEqual({ ask: ASK })
    expect(splitQuestion(String(result.received[0]?.['text'])).question).toEqual(QUESTION)
  }, 20_000)

  const refused: readonly [string, readonly string[], RegExp][] = [
    ['prose that leaves a fence open', [CONVO, 'Start:\n```js\nconst x = 1', ...Q], /fence open/],
    ['prose that quotes a question fence', [CONVO, 'Before:\n\n' + coreFence('Which?', ['a', 'b']), ...Q], /hypercomb-question/],
    ['no arguments', [], /convoId is required/],
  ]
  for (const [name, argv, reason] of refused) {
    it(`refused: ${name}`, async () => {
      const result = await run(argv)
      expect(result.code).toBe(1)
      expect(result.connections).toBe(0)
      expect(result.stderr).toMatch(reason)
    }, 20_000)
  }
})
