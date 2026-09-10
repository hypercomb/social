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
    const built = script.buildReply([CONVO, '  Hello there.  '], {})
    expect(built.convoId).toBe(CONVO)
    expect(built.text).toBe('Hello there.')
    expect(splitQuestion(built.text)).toEqual({ prose: 'Hello there.' })
  })

  it('a question alone is the fence alone', () => {
    const built = script.buildReply(
      [CONVO, '--question', 'How many pages?', '--option', 'One', '--option', 'Several'], {})
    expect(built.text).toBe(coreFence('How many pages?', ['One', 'Several']))
    expect(splitQuestion(built.text)).toEqual({
      prose: '',
      question: { prompt: 'How many pages?', options: ['One', 'Several'] },
    })
  })

  it('prose then the fence, one blank line between — and core hands the prose back', () => {
    const built = script.buildReply(
      [CONVO, 'Two ways to lay this out.', '--question', 'How many pages?', '--option', 'One', '--option', 'Several'], {})
    expect(built.text).toBe('Two ways to lay this out.\n\n' + coreFence('How many pages?', ['One', 'Several']))
    expect(splitQuestion(built.text)).toEqual({
      prose: 'Two ways to lay this out.',
      question: { prompt: 'How many pages?', options: ['One', 'Several'] },
    })
  })

  it('takes four options', () => {
    const built = script.buildReply(
      [CONVO, '--question', 'Which?', '--option', 'a', '--option', 'b', '--option', 'c', '--option', 'd'], {})
    expect(splitQuestion(built.text).question?.options).toEqual(['a', 'b', 'c', 'd'])
  })

  it('flags first: the positionals may come after them', () => {
    const built = script.buildReply(['--ask', ASK, CONVO, 'Hi'], {})
    expect(built).toEqual({ convoId: CONVO, text: 'Hi', run: { ask: ASK } })
  })

  it('multi-paragraph prose survives as one positional', () => {
    const built = script.buildReply([CONVO, 'First.\n\nSecond.'], {})
    expect(built.text).toBe('First.\n\nSecond.')
  })
})

describe('buildReply — the run', () => {
  it('--ask attaches { ask } and nothing else: the renderer resolves the bucket', () => {
    expect(script.buildReply([CONVO, 'Hi', '--ask', ASK], {}).run).toEqual({ ask: ASK })
  })

  it('without --ask, the environment is the fallback, exactly as loop-run reads it', () => {
    const env = { HYPERCOMB_RUN_ASK: ASK }
    expect(script.buildReply([CONVO, 'Hi'], env).run).toEqual(loop.runFromEnv(env))
    expect(script.buildReply([CONVO, 'Hi'], env).run).not.toBeNull()
  })

  it('--ask wins over the environment', () => {
    const other = 'b'.repeat(64)
    expect(script.buildReply([CONVO, 'Hi', '--ask', ASK], { HYPERCOMB_RUN_ASK: other }).run)
      .toEqual({ ask: ASK })
  })

  it('with neither, nothing is recorded — as before', () => {
    expect(script.buildReply([CONVO, 'Hi'], {}).run).toBeNull()
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
      expect(() => script.buildReply(argv, {})).toThrow()
    })
  }

  it('the usage text names the flags', () => {
    for (const flag of ['--ask', '--question', '--option']) expect(script.USAGE).toContain(flag)
  })
})
