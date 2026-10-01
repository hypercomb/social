// ui/command-line/raw-args.spec.ts — a word that keeps its arguments verbatim
// is asked about BEFORE the line is read as anything else.
//
// `QueenBee.rawArgs` ("everything after my word is mine") only means something
// if the command line honours it ahead of its own readings, because both of
// them run before the behaviour is handed a thing:
//   - the tag extractor took `/models add x/y:free` for `label:tag`, persisted
//     a junk tag and dropped the slash, so the queen was never called;
//   - the utterance reader took `models request … forty files` for a sentence,
//     filed half the need and ran `files`.
// The census answers the question (SlashBehaviourDrone.rawArgs, and
// rawArgsAwake where a sleeping queen can be waited for — its own spec is
// essentials' commands/slash-raw-args.spec.ts); this guards the order, at
// every door a line comes in by: the keyboard, a whole-line arrival, the
// remote door.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(process.cwd(), 'hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts'), 'utf8')

/** The source from `start` up to (not including) `end`. */
const between = (start: string, end: string): string => {
  const from = src.indexOf(start)
  expect(from).toBeGreaterThan(-1)
  const to = src.indexOf(end, from + start.length)
  expect(to).toBeGreaterThan(from)
  return src.slice(from, to)
}

describe('a word that keeps its arguments verbatim', () => {
  it('is asked of the census, by the first word of the line, slash or no slash', () => {
    const body = between('#keepsRawArgs(line: string): boolean {', '\n  }\n')
    expect(body).toContain("get('@diamondcoreprocessor.com/SlashBehaviourDrone')")
    expect(body).toContain('drone?.rawArgs?.(word)')
    // The same first word the slash executor will split off: up to a space or '('.
    const word = (line: string): string => line.trimStart().replace(/^\//, '').split(/[\s(\[]/, 1)[0]
    expect(body).toContain("line.trimStart().replace(/^\\//, '').split(/[\\s(\\[]/, 1)[0]")
    expect(word('/models add deepseek/deepseek-r1:free deep')).toBe('models')
    expect(word('models request a planner that holds forty files')).toBe('models')
    expect(word('  /move(3)')).toBe('move')
    expect(word('/select[a,b]')).toBe('select')
    expect(word('')).toBe('')
  })

  it('waits for a queen still asleep, where the answer can be waited for', () => {
    // A line that arrives whole (add sheet, bridge, recall) woke nobody, and a
    // stand-in may not know its queen keeps her arguments — so the census is
    // asked the awaited question, by the same first word, and a census that
    // cannot wait (or a wake that throws) answers the plain one.
    const body = between('async #keepsRawArgsAwake(line: string): Promise<boolean> {', '\n  }\n')
    expect(body).toContain("line.trimStart().replace(/^\\//, '').split(/[\\s(\\[]/, 1)[0]")
    expect(body).toContain('await drone.rawArgsAwake(word)')
    expect(body).toContain('if (!drone?.rawArgsAwake) return this.#keepsRawArgs(line)')
    expect(body).toContain('catch { return this.#keepsRawArgs(line) }')
  })

  it('keeps a slash line out of the tag extractor, and still reaches slash dispatch', () => {
    const body = between('async #preprocessTagsThenExecute(original: string): Promise<void> {', '\n  // create cell in place')
    // The AWAITED question: the sync one answered "no" for a sleeping queen
    // on the first whole-line arrival of every session.
    const asked = body.indexOf("original.trimStart().startsWith('/') && await this.#keepsRawArgsAwake(original)")
    expect(body).not.toContain('this.#keepsRawArgs(original)')
    const extract = body.indexOf('await this.#extractAndPersistTags(original)')
    const dispatch = body.indexOf('void this.#executeSlashBehaviour(v)')
    expect(asked).toBeGreaterThan(-1)
    expect(asked).toBeLessThan(extract)
    expect(extract).toBeLessThan(dispatch)
    // One extractor call in the pipeline, and it is the guarded one.
    expect(body.split('#extractAndPersistTags(').length - 1).toBe(1)
  })

  it('is not read as a sentence: the reading does not own the commit', () => {
    const body = between('#commitUtterance(text: string): boolean {', '\n  }\n')
    const asked = body.indexOf('if (this.#keepsRawArgs(text)) return false')
    const read = body.indexOf('this.#utteranceReader()?.read(')
    expect(asked).toBeGreaterThan(-1)
    expect(asked).toBeLessThan(read)
  })

  it('is not read as a sentence at the remote door either, which enters the reader directly', () => {
    const body = between('EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, ({ text, accept, complete }) => {', '\n    // voice active state sync')
    const asked = body.indexOf("const keeps = !trimmed.startsWith('/') && this.#keepsRawArgs(text)")
    const slashed = body.indexOf("const line = keeps ? '/' + trimmed : text")
    const fork = body.indexOf("const prose = !line.trimStart().startsWith('/')")
    const read = body.indexOf('this.#utteranceReader()?.read(lowered(text))')
    expect(asked).toBeGreaterThan(-1)
    expect(asked).toBeLessThan(slashed)
    expect(slashed).toBeLessThan(fork)
    expect(fork).toBeLessThan(read)
    // The slashed line is what is judged and what is run — `models`, and only
    // `models`, whatever behaviour words its prose happens to say.
    expect(body).toContain('canonicalVerbOf(keeps ? lowered(line) : line)')
    expect(body).toContain('void this.#preprocessTagsThenExecute(line)')
    expect(body).not.toContain('this.#preprocessTagsThenExecute(text)')
  })

  it('lights nothing in its prose while it is typed', () => {
    const body = between('public readonly utteranceReading = computed<UtteranceReadingLike | null>(() => {', '\n  })\n')
    const asked = body.indexOf('if (this.#keepsRawArgs(raw)) return null')
    const read = body.indexOf('this.#utteranceReader()?.read(')
    expect(asked).toBeGreaterThan(-1)
    expect(asked).toBeLessThan(read)
  })
})
