import { describe, expect, it } from 'vitest'
import {
  doFailedMessage,
  identityInstruction,
  splitWork,
  transcriptForModel,
  workInstruction,
  workLineGrammar,
  WorkStreamGuard,
} from './hypercomb-work-fence'

describe('the work fence', () => {
  it('finds a read block at the end of a reply and turns its lines into grammar', () => {
    const split = splitWork('Let me look.\n\n```hypercomb-read\nread here\nlist /business/people\n```')
    expect(split.prose).toBe('Let me look.')
    expect(split.request).toEqual({ kind: 'read', lines: ['/read', '/list /business/people'] })
    expect(split.heldDo).toBeUndefined()
  })

  it('keeps change sentences in order — slash optional, list markers and case dropped', () => {
    const split = splitWork('```hypercomb-do\n- Title domains = Aggregated\n/keyword domains travel\n```')
    expect(split.request).toEqual({ kind: 'do', lines: ['/title domains = Aggregated', '/keyword domains travel'] })
  })

  it('reads win over changes in one reply, and the change is marked held', () => {
    const split = splitWork('```hypercomb-read\nread here\n```\n```hypercomb-do\ntitle x = y\n```')
    expect(split.request?.kind).toBe('read')
    expect(split.heldDo).toBe(true)
  })

  it('leaves an ordinary code block alone', () => {
    const text = 'Here:\n```ts\nconst a = 1\n```'
    expect(splitWork(text)).toEqual({ prose: text })
  })

  it('never reads a work block inside another fence', () => {
    const text = '````md\n```hypercomb-read\nread here\n```\n````'
    expect(splitWork(text).request).toBeUndefined()
  })

  it('counts an unclosed block at the end of a reply', () => {
    expect(splitWork('ok\n```hypercomb-read\nfind cigar').request).toEqual({ kind: 'read', lines: ['/find cigar'] })
  })

  it('"here" is the current page only for reads', () => {
    expect(workLineGrammar('Tree here', 'read')).toBe('/tree')
    expect(workLineGrammar('`read /a/b`', 'read')).toBe('/read /a/b')
    expect(workLineGrammar('note here', 'do')).toBe('/note here')
    expect(workLineGrammar('   ', 'do')).toBe('')
  })
})

describe('the stream guard', () => {
  const run = (pieces: readonly string[]): { shown: string; guard: WorkStreamGuard } => {
    const guard = new WorkStreamGuard()
    let shown = ''
    for (const piece of pieces) shown += guard.push(piece)
    shown += guard.end()
    return { shown, guard }
  }

  it('streams prose and holds everything from a work block on', () => {
    const { shown, guard } = run(['Let me ', 'look.\n', '``', '`hypercomb-read\nread here\n', '```'])
    expect(shown).toBe('Let me look.\n')
    expect(guard.holding).toBe(true)
  })

  it('passes an ordinary code block through whole', () => {
    const text = '```ts\nconst a = 1\n```\ndone'
    const { shown, guard } = run([text.slice(0, 7), text.slice(7)])
    expect(shown).toBe(text)
    expect(guard.holding).toBe(false)
  })

  it('releases a line the moment it cannot become a fence', () => {
    expect(new WorkStreamGuard().push('Hel')).toBe('Hel')
    expect(new WorkStreamGuard().push('``')).toBe('')
  })

  it('holds a block that opens on the last, unterminated line', () => {
    const { shown, guard } = run(['done\n', '```hypercomb-do'])
    expect(shown).toBe('done\n')
    expect(guard.holding).toBe(true)
  })
})

describe('what the model is told', () => {
  it('names the model and the route', () => {
    expect(identityInstruction('deepseek/deepseek-v4-flash', 'OpenRouter'))
      .toContain('You are the model deepseek/deepseek-v4-flash, reached through OpenRouter')
    expect(identityInstruction(undefined, 'OpenRouter')).toBe('')
  })

  it('says reads wait for approval when the provider may not read freely', () => {
    const text = workInstruction({ canRead: true, readsRunFreely: false, readsPerBlock: 2, canChange: true, vocabulary: '/x <name>' })
    expect(text).toContain('approves each read')
    expect(text).toContain('hypercomb-read')
    expect(text).toContain('/x <name>')
  })

  it('never teaches a door that is shut', () => {
    const text = workInstruction({ canRead: true, readsRunFreely: true, readsPerBlock: 2, canChange: false, vocabulary: '' })
    expect(text).not.toContain('hypercomb-do')
    expect(workInstruction({ canRead: false, readsRunFreely: false, readsPerBlock: 2, canChange: false, vocabulary: '' }))
      .not.toContain('hypercomb-read')
  })

  it('marks another model\'s reply as that model\'s', () => {
    const turns = [
      { role: 'user' as const, text: 'make a tile' },
      { role: 'assistant' as const, text: 'Ran 1 grammar', model: 'qwen3:8b' },
      { role: 'assistant' as const, text: 'Hello', model: 'deepseek/deepseek-v4-flash' },
    ]
    expect(transcriptForModel(turns, 'deepseek/deepseek-v4-flash').map(t => t.content))
      .toEqual(['make a tile', '[answered by qwen3:8b]\nRan 1 grammar', 'Hello'])
  })

  it('a failure says what ran before it stopped', () => {
    expect(doFailedMessage(['/a b'], '/c d', 'no such tile', 'q')).toContain('It ran before stopping:\n- /a b')
    expect(doFailedMessage([], '/c d', 'no such tile', 'q')).toContain('Nothing ran.')
  })
})
