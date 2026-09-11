import { describe, it, expect } from 'vitest'
import {
  FENCE_RE,
  QUESTION_LIMITS,
  splitQuestion,
  questionFence,
  questionProblem,
  questionLine,
  plainQuestionText,
  settleQuestions,
  hostWireText,
  QUESTION_ASKING_INSTRUCTION,
  QUESTION_FENCE_LANG,
  type QuestionTurn,
} from './question-fence.js'

const PROMPT = 'How many pages?'
const OPTIONS = ['One long page', 'Several pages']
const FENCE = '```hypercomb-question\n{"prompt":"How many pages?","options":["One long page","Several pages"]}\n```'

const user = (text: string): QuestionTurn => ({ role: 'user', text })
const ai = (text: string): QuestionTurn => ({ role: 'assistant', text })

describe('QUESTION_ASKING_INSTRUCTION — the one lesson, spelled from the parser\'s constants', () => {
  it('teaches the fence language and the limits the parser enforces', () => {
    expect(QUESTION_ASKING_INSTRUCTION.startsWith('ASKING.')).toBe(true)
    expect(QUESTION_ASKING_INSTRUCTION).toContain('`' + QUESTION_FENCE_LANG + '`')
    expect(QUESTION_ASKING_INSTRUCTION).toContain('ONE fenced code block')
    expect(QUESTION_ASKING_INSTRUCTION).toContain(`the prompt under ${QUESTION_LIMITS.promptMax} characters`)
    expect(QUESTION_ASKING_INSTRUCTION).toContain(`each option under ${QUESTION_LIMITS.optionMax}`)
    expect(QUESTION_ASKING_INSTRUCTION).toContain('LAST in the reply')
    expect(QUESTION_ASKING_INSTRUCTION).toContain('END THE TURN')
    // The option count is written in words; if the limits move, the words
    // must move with them.
    expect(QUESTION_ASKING_INSTRUCTION).toContain('two to four')
    expect([QUESTION_LIMITS.optionsMin, QUESTION_LIMITS.optionsMax]).toEqual([2, 4])
  })
})

describe('FENCE_RE — chat-markdown\'s fence grammar, to the character', () => {
  it('opens on a run of backticks or tildes with up to three spaces of indent', () => {
    expect('```js'.match(FENCE_RE)?.[1]).toBe('```')
    expect('   ~~~~ text'.match(FENCE_RE)?.[1]).toBe('~~~~')
    expect('    ```'.match(FENCE_RE)).toBeNull()   // four spaces is indented code, not a fence
    expect('``'.match(FENCE_RE)).toBeNull()
    expect('``` '.match(FENCE_RE)?.[2]).toBe(' ')
  })

  it('carries no global flag, so sharing one regex between two callers is safe', () => {
    expect(FENCE_RE.global).toBe(false)
    expect(FENCE_RE.sticky).toBe(false)
  })
})

describe('splitQuestion — the happy path', () => {
  it('reads a closed question fence at the end of a reply and hands back the prose', () => {
    const { prose, question } = splitQuestion(`Two ways to lay this out.\n\n${FENCE}`)
    expect(prose).toBe('Two ways to lay this out.')
    expect(question).toEqual({ prompt: PROMPT, options: OPTIONS })
  })

  it('a turn that is only the fence has empty prose', () => {
    expect(splitQuestion(FENCE)).toEqual({ prose: '', question: { prompt: PROMPT, options: OPTIONS } })
  })

  it('accepts a tilde fence and an indented opener, as the renderer does', () => {
    const tilde = '~~~hypercomb-question\n{"prompt":"A?","options":["x","y"]}\n~~~'
    expect(splitQuestion(tilde).question).toEqual({ prompt: 'A?', options: ['x', 'y'] })
    const indented = '  ```hypercomb-question\n{"prompt":"A?","options":["x","y"]}\n  ```'
    expect(splitQuestion(indented).question).toEqual({ prompt: 'A?', options: ['x', 'y'] })
  })

  it('reads a body spread over several lines, since JSON does not care', () => {
    const text = '```hypercomb-question\n{\n  "prompt": "A?",\n  "options": ["x", "y", "z", "w"]\n}\n```'
    expect(splitQuestion(text).question).toEqual({ prompt: 'A?', options: ['x', 'y', 'z', 'w'] })
  })

  it('takes only the first word of the info string, as the renderer labels a block', () => {
    const text = '```hypercomb-question  extra words\n{"prompt":"A?","options":["x","y"]}\n```'
    expect(splitQuestion(text).question).toBeDefined()
  })

  it('trims the prompt and the options in what it returns', () => {
    const text = '```hypercomb-question\n{"prompt":"  A?  ","options":[" x ","y  "]}\n```'
    expect(splitQuestion(text).question).toEqual({ prompt: 'A?', options: ['x', 'y'] })
  })

  it('keeps an ordinary code fence BEFORE the question as prose', () => {
    const text = `Here:\n\n\`\`\`js\nconst a = 1\n\`\`\`\n\n${FENCE}`
    const { prose, question } = splitQuestion(text)
    expect(question).toBeDefined()
    expect(prose).toBe('Here:\n\n```js\nconst a = 1\n```')
  })

  it('leaves text after the fence in place, separated by one blank line', () => {
    const { prose, question } = splitQuestion(`Before.\n${FENCE}\nAfter.`)
    expect(question).toBeDefined()
    expect(prose).toBe('Before.\n\nAfter.')
  })

  it('collapses the blank lines that framed the block', () => {
    const { prose } = splitQuestion(`Before.\n\n\n\n${FENCE}\n\n\n`)
    expect(prose).toBe('Before.')
    expect(splitQuestion(`\n\n${FENCE}\n\nAfter.`).prose).toBe('After.')
  })
})

describe('splitQuestion — every rejection hands the text back untouched', () => {
  const unchanged = (text: string): void => {
    expect(splitQuestion(text)).toEqual({ prose: text })
  }

  it('no fence at all', () => {
    unchanged('Just prose.')
    unchanged('')
  })

  it('an unterminated question fence is not a question (a stream cut mid-fence)', () => {
    unchanged('Two ways.\n\n```hypercomb-question\n{"prompt":"A?","options":["x","y"]}')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x","y"]}\n``')
  })

  it('two question fences → none', () => {
    unchanged(`${FENCE}\n\n${FENCE}`)
  })

  it('the question fence must be the LAST fence in the turn', () => {
    unchanged(`${FENCE}\n\n\`\`\`js\nlater()\n\`\`\``)
    // An unterminated fence after it is still a later fence.
    unchanged(`${FENCE}\n\n\`\`\`js\nnever closed`)
  })

  it('the info string is exact and case-sensitive', () => {
    unchanged('```Hypercomb-Question\n{"prompt":"A?","options":["x","y"]}\n```')
    unchanged('```hypercomb-questions\n{"prompt":"A?","options":["x","y"]}\n```')
    unchanged('```question\n{"prompt":"A?","options":["x","y"]}\n```')
  })

  it('a closer of the other character does not close the fence', () => {
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x","y"]}\n~~~')
  })

  it('a shorter run of the same character is body, not a closer', () => {
    // The renderer would draw this as one open block running to EOF.
    unchanged('````hypercomb-question\n{"prompt":"A?","options":["x","y"]}\n```')
  })

  it('a longer run of the same character closes it', () => {
    const text = '```hypercomb-question\n{"prompt":"A?","options":["x","y"]}\n`````'
    expect(splitQuestion(text).question).toBeDefined()
  })

  it('a question fence swallowed by an earlier open fence is not a fence', () => {
    // The js fence is still open when the question opener arrives, so the
    // question line is code and the question "closer" closes the js block.
    unchanged(`\`\`\`js\n${FENCE}`)
  })

  it('a CRLF line ending is not a fence — chat-markdown splits on \\n only', () => {
    unchanged('```hypercomb-question\r\n{"prompt":"A?","options":["x","y"]}\r\n```\r\n')
  })

  it('a body that is not JSON', () => {
    unchanged('```hypercomb-question\nprompt: A?\n```')
    unchanged('```hypercomb-question\n\n```')
  })

  it('a body that is JSON but not the shape', () => {
    unchanged('```hypercomb-question\n["A?","x","y"]\n```')
    unchanged('```hypercomb-question\nnull\n```')
    unchanged('```hypercomb-question\n"A?"\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?"}\n```')
    unchanged('```hypercomb-question\n{"options":["x","y"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x","y"],"other":true}\n```')
  })

  it('prompt limits: a string, 1–280 characters after trimming', () => {
    unchanged('```hypercomb-question\n{"prompt":"","options":["x","y"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"   ","options":["x","y"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":7,"options":["x","y"]}\n```')
    const long = 'p'.repeat(QUESTION_LIMITS.promptMax + 1)
    unchanged(`\`\`\`hypercomb-question\n{"prompt":"${long}","options":["x","y"]}\n\`\`\``)
    const max = 'p'.repeat(QUESTION_LIMITS.promptMax)
    expect(splitQuestion(`\`\`\`hypercomb-question\n{"prompt":"${max}","options":["x","y"]}\n\`\`\``).question?.prompt).toBe(max)
  })

  it('option limits: 2–4 strings, 1–80 characters each, distinct after trimming', () => {
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":[]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["a","b","c","d","e"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":"x"}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x",2]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x",""]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x","  "]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x"," x "]}\n```')
    const long = 'o'.repeat(QUESTION_LIMITS.optionMax + 1)
    unchanged(`\`\`\`hypercomb-question\n{"prompt":"A?","options":["x","${long}"]}\n\`\`\``)
  })

  it('distinctness is exact — case differs, so they are distinct', () => {
    const text = '```hypercomb-question\n{"prompt":"A?","options":["Yes","yes"]}\n```'
    expect(splitQuestion(text).question?.options).toEqual(['Yes', 'yes'])
  })

  it('a control character anywhere in the prompt or an option, even escaped', () => {
    unchanged('```hypercomb-question\n{"prompt":"A\\u0007?","options":["x","y"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x","y\\n"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?","options":["x\\t","y"]}\n```')
    unchanged('```hypercomb-question\n{"prompt":"A?\\u007f","options":["x","y"]}\n```')
  })

  it('never throws, whatever it is handed', () => {
    expect(() => splitQuestion(undefined as unknown as string)).not.toThrow()
    expect(() => splitQuestion('```hypercomb-question\n{"prompt":\n```')).not.toThrow()
  })
})

describe('questionFence — the serializer round-trips through the parser', () => {
  it('serializes the fence the parser reads', () => {
    expect(questionFence(PROMPT, OPTIONS)).toBe(FENCE)
  })

  it('round-trips, trimming as the parser does', () => {
    const fence = questionFence('  A?  ', [' x', 'y ', 'z'])
    expect(splitQuestion(fence)).toEqual({ prose: '', question: { prompt: 'A?', options: ['x', 'y', 'z'] } })
  })

  it('round-trips with prose before it, the way the reply script writes a turn', () => {
    const text = `Two ways.\n\n${questionFence(PROMPT, OPTIONS)}`
    expect(splitQuestion(text)).toEqual({ prose: 'Two ways.', question: { prompt: PROMPT, options: OPTIONS } })
  })

  it('an option that looks like a fence opener cannot break out of the block', () => {
    const fence = questionFence('A?', ['```', '~~~ b'])
    expect(splitQuestion(fence).question?.options).toEqual(['```', '~~~ b'])
  })

  it('carries non-ASCII text through', () => {
    const fence = questionFence('¿Cuántas páginas?', ['一つ', 'いくつか', 'émoji 🐝'])
    expect(splitQuestion(fence).question).toEqual({ prompt: '¿Cuántas páginas?', options: ['一つ', 'いくつか', 'émoji 🐝'] })
  })

  it('counts characters as code points, so 80 emoji is 80 characters', () => {
    const eighty = '🐝'.repeat(QUESTION_LIMITS.optionMax)
    expect(() => questionFence('A?', ['x', eighty])).not.toThrow()
    expect(() => questionFence('A?', ['x', eighty + '🐝'])).toThrow()
  })

  it('throws on everything the parser would refuse', () => {
    expect(() => questionFence('', ['x', 'y'])).toThrow(/prompt is empty/)
    expect(() => questionFence('p'.repeat(281), ['x', 'y'])).toThrow(/longer than 280/)
    expect(() => questionFence('A?', ['x'])).toThrow(/fewer than 2/)
    expect(() => questionFence('A?', ['a', 'b', 'c', 'd', 'e'])).toThrow(/more than 4/)
    expect(() => questionFence('A?', ['x', 'x'])).toThrow(/same/)
    expect(() => questionFence('A?', ['x', ' x'])).toThrow(/same/)
    expect(() => questionFence('A?', ['x', ''])).toThrow(/empty/)
    expect(() => questionFence('A?', ['x', 'o'.repeat(81)])).toThrow(/longer than 80/)
    expect(() => questionFence('A\u0000?', ['x', 'y'])).toThrow(/control/)
    expect(() => questionFence('A?', ['x', 'y\u001f'])).toThrow(/control/)
    expect(() => questionFence('A?', ['x', 'y\u007f'])).toThrow(/control/)
    expect(() => questionFence(7 as unknown as string, ['x', 'y'])).toThrow(/string/)
    expect(() => questionFence('A?', 'x' as unknown as string[])).toThrow(/array/)
  })

  it('questionProblem is the validator behind both, answering null for a good question', () => {
    expect(questionProblem(PROMPT, OPTIONS)).toBeNull()
    expect(questionProblem('A?', ['x', 'y', 'z', 'w'])).toBeNull()
  })
})

describe('plainQuestionText — one line for the one-line readers', () => {
  it('replaces the fence with Q: prompt — options', () => {
    expect(plainQuestionText(`Two ways.\n\n${FENCE}`))
      .toBe('Two ways.\n\nQ: How many pages? — One long page · Several pages')
  })

  it('puts the line where the fence stood', () => {
    expect(plainQuestionText(`Before.\n${FENCE}\nAfter.`))
      .toBe('Before.\n\nQ: How many pages? — One long page · Several pages\n\nAfter.')
    expect(plainQuestionText(FENCE)).toBe('Q: How many pages? — One long page · Several pages')
  })

  it('leaves text without a valid question untouched, fence and all', () => {
    const noQuestion = '```hypercomb-question\n{"prompt":"A?","options":["x"]}\n```'
    expect(plainQuestionText(noQuestion)).toBe(noQuestion)
    expect(plainQuestionText('plain')).toBe('plain')
  })

  it('questionLine is the same rendering, for a question already split', () => {
    expect(questionLine({ prompt: PROMPT, options: OPTIONS })).toBe('Q: How many pages? — One long page · Several pages')
  })
})

describe('settleQuestions — which turn answers which question', () => {
  const asked = `Two ways.\n\n${FENCE}`

  it('returns one slot per turn, null where there is no question', () => {
    const result = settleQuestions([user('Build a site'), ai('Sure.'), ai(asked)])
    expect(result).toHaveLength(3)
    expect(result[0]).toBeNull()
    expect(result[1]).toBeNull()
    expect(result[2]).toMatchObject({ index: 2, prompt: PROMPT, options: OPTIONS })
  })

  it('a question nothing follows is open', () => {
    const [, q] = settleQuestions([user('Build a site'), ai(asked)])
    expect(q).toEqual({ index: 1, prompt: PROMPT, options: OPTIONS, state: 'open' })
  })

  it('a user turn equal to an option label settles it through that outlet', () => {
    const result = settleQuestions([user('Build a site'), ai(asked), user('Several pages')])
    expect(result[1]).toEqual({ index: 1, prompt: PROMPT, options: OPTIONS, state: 'settled', answeredBy: 2, outlet: 1 })
  })

  it('label matching trims but is otherwise exact', () => {
    expect(settleQuestions([ai(asked), user('  One long page \n')])[0]?.outlet).toBe(0)
    expect(settleQuestions([ai(asked), user('one long page')])[0]?.outlet).toBe('own')
    expect(settleQuestions([ai(asked), user('Several pages please')])[0]?.outlet).toBe('own')
  })

  it('any other user turn settles it in the participant\'s own words', () => {
    const result = settleQuestions([user('Build a site'), ai(asked), user('Three, actually'), ai('Done.')])
    expect(result[1]).toEqual({ index: 1, prompt: PROMPT, options: OPTIONS, state: 'settled', answeredBy: 2, outlet: 'own' })
  })

  it('an assistant turn before any user turn supersedes it', () => {
    const result = settleQuestions([user('Build a site'), ai(asked), ai('Never mind, I picked one.'), user('ok')])
    expect(result[1]).toEqual({ index: 1, prompt: PROMPT, options: OPTIONS, state: 'superseded' })
    expect(result[2]).toBeNull()
  })

  it('a later user turn settles only the last question before it', () => {
    const other = questionFence('Which colour?', ['Red', 'Blue'])
    const result = settleQuestions([user('Go'), ai(asked), ai(`Actually:\n\n${other}`), user('Blue')])
    expect(result[1]?.state).toBe('superseded')
    expect(result[2]).toEqual({ index: 2, prompt: 'Which colour?', options: ['Red', 'Blue'], state: 'settled', answeredBy: 3, outlet: 1 })
  })

  it('only the last assistant turn can hold an open question', () => {
    const result = settleQuestions([ai(asked), user('Several pages'), ai(asked)])
    expect(result[0]?.state).toBe('settled')
    expect(result[2]?.state).toBe('open')
    const states = settleQuestions([ai(asked), ai(asked), ai(asked)]).map(q => q?.state)
    expect(states).toEqual(['superseded', 'superseded', 'open'])
  })

  it('the retry exception: resending the message before the question is not an answer', () => {
    const result = settleQuestions([user('Build a site'), ai(asked), user('Build a site')])
    expect(result[1]).toEqual({ index: 1, prompt: PROMPT, options: OPTIONS, state: 'open' })
  })

  it('the retry compares trimmed text and looks back to the nearest user turn', () => {
    // Two replies in a row before the question: the retry resends the last
    // user message, which is what #questionFor walks back to.
    const result = settleQuestions([user('Build a site'), ai('Thinking.'), ai(asked), user('  Build a site  ')])
    expect(result[2]?.state).toBe('open')
  })

  it('after a retry, the next non-retry turn decides', () => {
    const answered = settleQuestions([user('Build a site'), ai(asked), user('Build a site'), user('One long page')])
    expect(answered[1]).toEqual({ index: 1, prompt: PROMPT, options: OPTIONS, state: 'settled', answeredBy: 3, outlet: 0 })
    const superseded = settleQuestions([user('Build a site'), ai(asked), user('Build a site'), ai(asked)])
    expect(superseded[1]?.state).toBe('superseded')
    expect(superseded[3]?.state).toBe('open')
  })

  it('with no user turn before the question there is no retry to except', () => {
    const result = settleQuestions([ai(asked), user('Build a site')])
    expect(result[0]).toMatchObject({ state: 'settled', answeredBy: 1, outlet: 'own' })
  })

  it('a reply with an invalid fence holds no question and can supersede', () => {
    const broken = '```hypercomb-question\n{"prompt":"A?","options":["x"]}\n```'
    const result = settleQuestions([ai(asked), ai(broken)])
    expect(result[0]?.state).toBe('superseded')
    expect(result[1]).toBeNull()
  })

  it('an empty thread settles nothing', () => {
    expect(settleQuestions([])).toEqual([])
  })
})

describe('hostWireText — the stateless host hears the question restated', () => {
  const asked = `Two ways.\n\n${FENCE}`
  const WIRE = 'Question: How many pages?\nOptions: One long page · Several pages\nAnswer: Several pages'

  it('ignores the trailing user turn send() already appended and restates the question', () => {
    const turns = [user('Build a site'), ai(asked), user('Several pages')]
    expect(hostWireText(turns, 'Several pages')).toBe(WIRE)
  })

  it('works the same when the caller passes turns without the answer appended', () => {
    expect(hostWireText([user('Build a site'), ai(asked)], 'Several pages')).toBe(WIRE)
  })

  it('a typed answer is restated as well — the composer is always the other answer', () => {
    expect(hostWireText([ai(asked)], 'Three, actually'))
      .toBe('Question: How many pages?\nOptions: One long page · Several pages\nAnswer: Three, actually')
  })

  it('trims the message it restates', () => {
    expect(hostWireText([ai(asked), user('Several pages')], '  Several pages\n')).toBe(WIRE)
  })

  it('null when there is no open question to answer', () => {
    expect(hostWireText([user('Build a site'), ai('Sure.'), user('Go on')], 'Go on')).toBeNull()
    expect(hostWireText([], 'Hello')).toBeNull()
  })

  it('null when the question was already settled by an earlier turn', () => {
    const turns = [ai(asked), user('Several pages'), ai('Done.'), user('Thanks')]
    expect(hostWireText(turns, 'Thanks')).toBeNull()
  })

  it('null when the question was superseded', () => {
    expect(hostWireText([ai(asked), ai('Never mind.'), user('ok')], 'ok')).toBeNull()
  })

  it('null for a retry — resending the previous message answers nothing', () => {
    expect(hostWireText([user('Build a site'), ai(asked), user('Build a site')], 'Build a site')).toBeNull()
  })

  it('a trailing user turn that is NOT the message is a stored turn, not the answer', () => {
    // The message answers nothing here: the earlier user turn already settled it.
    const turns = [ai(asked), user('One long page')]
    expect(hostWireText(turns, 'Another thing')).toBeNull()
  })
})
