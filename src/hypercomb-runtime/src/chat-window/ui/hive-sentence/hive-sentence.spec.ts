import { describe, expect, it } from 'vitest'
import { bareSentence, hiveSentenceHtml, hiveSentenceParts, safeColor, type SentenceReader } from './hive-sentence'

/** A reader shaped like the command line's: `copy` and `create` are behaviours. */
const reader: SentenceReader = {
  read: text => {
    const spans: { start: number; end: number; role: 'action' | 'argument'; color?: string }[] = []
    for (const match of text.matchAll(/\S+/g)) {
      const word = match[0]
      const start = match.index!
      const known = word === 'copy' ? '#4fb3e8' : word === 'create' ? 'rgb(120, 200, 90)' : undefined
      spans.push(known ? { start, end: start + word.length, role: 'action', color: known } : { start, end: start + word.length, role: 'argument' })
    }
    return { spans }
  },
}
const verbs = new Set(['list', 'find'])
const sig = 'a'.repeat(64)

describe('the hive sentence', () => {
  it('drops the slash from the display, never from the line that runs', () => {
    expect(bareSentence('/copy drafts')).toBe('copy drafts')
    expect(bareSentence('copy drafts')).toBe('copy drafts')
    expect(bareSentence('/ alone')).toBe('/ alone')
  })

  it('colours each behaviour word with its own colour, arguments in plain ink', () => {
    expect(hiveSentenceParts('/copy drafts', reader)).toEqual([
      { text: 'copy', role: 'verb', color: '#4fb3e8' },
      { text: ' ', role: 'arg' },
      { text: 'drafts', role: 'arg' },
    ])
    expect(hiveSentenceParts('create jev-proof', reader)?.[0]).toEqual({ text: 'create', role: 'verb', color: 'rgb(120, 200, 90)' })
  })

  it('is not a sentence unless its first word is a behaviour or a read verb', () => {
    expect(hiveSentenceParts('npm run build', reader, { verbs })).toBeNull()
    expect(hiveSentenceParts('/dolphin/site', reader, { verbs })).toBeNull()
    expect(hiveSentenceParts('/list /', reader, { verbs })).toEqual([{ text: 'list', role: 'verb' }, { text: ' /', role: 'arg' }])
    expect(hiveSentenceParts('npm run build', reader, { force: true })?.[0]).toEqual({ text: 'npm', role: 'verb' })
  })

  it('reads the first word as the verb when there is no reader', () => {
    expect(hiveSentenceParts('/create jev-proof', undefined, { force: true })).toEqual([
      { text: 'create', role: 'verb' },
      { text: ' jev-proof', role: 'arg' },
    ])
  })

  it('shrinks signatures in arguments and keeps the full one', () => {
    const parts = hiveSentenceParts(`read ${sig}`, undefined, { force: true })!
    expect(parts.find(part => part.signature)).toEqual({ text: `${'a'.repeat(12)}…`, role: 'arg', signature: sig })
  })

  it('lets only plain colour syntax reach a style attribute', () => {
    expect(safeColor('#ecbc57')).toBe('#ecbc57')
    expect(safeColor('hsl(40 80% 60%)')).toBe('hsl(40 80% 60%)')
    expect(safeColor('red;background:url(x)')).toBeUndefined()
    expect(safeColor('url(javascript:x)')).toBeUndefined()
    const hostile: SentenceReader = { read: () => ({ spans: [{ start: 0, end: 4, role: 'action', color: '#fff;position:fixed' }] }) }
    expect(hiveSentenceParts('copy x', hostile)?.[0]).toEqual({ text: 'copy', role: 'verb' })
  })

  it('renders escaped markup with one class per role', () => {
    const html = hiveSentenceHtml(hiveSentenceParts('copy <b>', reader)!)
    expect(html).toBe('<span class="hc-sentence" style="--hc-sentence-accent:#4fb3e8"><span class="hc-sentence-verb" style="color:#4fb3e8">copy</span><span class="hc-sentence-arg"> </span><span class="hc-sentence-arg">&lt;b&gt;</span></span>')
  })

  it('lets path separators and the step dot recede, but never the root', () => {
    const roles = (line: string) => hiveSentenceParts(line, undefined, { force: true })!.map(part => `${part.role}:${part.text}`)
    expect(roles('create jev-proof/beta/gamma')).toEqual(['verb:create', 'arg: jev-proof', 'sep:/', 'arg:beta', 'sep:/', 'arg:gamma'])
    expect(roles('list /people')).toEqual(['verb:list', 'arg: ', 'sep:/', 'arg:people'])
    expect(roles('list /')).toEqual(['verb:list', 'arg: /'])
    expect(roles('create a · create b')).toEqual(['verb:create', 'arg: a', 'sep: · ', 'arg:create b'])
  })
})
