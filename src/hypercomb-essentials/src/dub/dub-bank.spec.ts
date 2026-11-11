import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DUB_POOL, asDubRecord, asSoundbank, foldSentence, karaoke, putDub, readDub, readingSeconds, sentenceKey, soundbankOf, wordAt, type DubRecord, type DubStore } from './dub-bank'
import { takeType } from './dub-recorder'

// A DUB IS A VOICE FOR A SENTENCE, RECORDED IN PLACE (jwize, 2026-11-11:
// "replace the sound bites per sentence ... click the text and get a prompt to
// record ... move the cursor with the text like karaoke style").

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const PAGE = readFileSync(join(root, 'scripts', 'bridge', 'living-presentation', 'blocks', 'page.cjs'), 'utf8')
const DRONE = readFileSync(join(here, 'dub.drone.ts'), 'utf8')
const QUEEN = readFileSync(join(here, 'dub.queen.ts'), 'utf8')
const RECORDER = readFileSync(join(here, 'dub-recorder.ts'), 'utf8')

const sig = (character: string): string => character.repeat(64)
const record = (extra: Partial<DubRecord> = {}): DubRecord =>
  ({ kind: 'presentation:dub', v: 1, say: sig('a'), text: 'Hello there.', voice: sig('b'), type: 'audio/webm', seconds: 2, at: 1, ...extra })

describe('the soundbank', () => {
  it('names a sentence by its words, spaces folded — the same name the page builder bakes', async () => {
    const say = '  Read across,  they make\n a sentence.  '
    expect(foldSentence(say)).toBe('Read across, they make a sentence.')
    const key = await sentenceKey(say)
    expect(key).toBe(createHash('sha256').update('Read across, they make a sentence.', 'utf8').digest('hex'))
    expect(await sentenceKey('Read across, they make a sentence.')).toBe(key)
    // Reworded is a new sentence: no stale voice over new words.
    expect(await sentenceKey('Read across, they make one sentence.')).not.toBe(key)
    // The page builder spells the same fold and hands the name to every step.
    expect(PAGE).toMatch(/const sentenceKey = \(say\) => require\('crypto'\)\.createHash\('sha256'\)\.update\(String\(say \?\? ''\)\.trim\(\)\.replace\(\/\\s\+\/g, ' '\), 'utf8'\)\.digest\('hex'\)/)
    expect(PAGE).toContain('key: sentenceKey(s.say)')
  })

  it('reads back only a record it wrote, and an empty voice means the original', () => {
    expect(asDubRecord(record())?.voice).toBe(sig('b'))
    expect(asDubRecord(record({ voice: '' }))?.voice).toBe('')
    expect(asDubRecord({ ...record(), kind: 'other' })).toBeNull()
    expect(asDubRecord({ ...record(), say: 'short' })).toBeNull()
    expect(asDubRecord({ ...record(), voice: 'not-a-signature' })).toBeNull()
    expect(asDubRecord(null)).toBeNull()
  })

  it('keeps one current record per sentence in the presentation:dubs pool, earlier takes as versions', async () => {
    const pool = {} as FileSystemDirectoryHandle
    const docs = new Map<string, ArrayBuffer>()
    const asked: Array<{ meaning?: string; subKey?: string; keep?: string }> = []
    const store: DubStore = {
      getPool: async meaning => { asked.push({ meaning }); return pool },
      putPoolDoc: async (_pool, bytes, subKey, options) => { asked.push({ subKey, keep: options?.keep }); docs.set(subKey ?? '', bytes); return sig('c') },
      getPoolDoc: async (_pool, subKey) => docs.get(subKey ?? '') ?? null,
    }
    expect(await readDub(store, sig('a'))).toBeNull()
    expect(await putDub(store, record())).toBe(true)
    expect(asked.some(ask => ask.meaning === DUB_POOL)).toBe(true)
    expect(asked.find(ask => ask.subKey)).toEqual({ subKey: sig('a'), keep: 'versions' })
    expect((await readDub(store, sig('a')))?.voice).toBe(sig('b'))
    // No store, nothing kept, and nothing thrown.
    expect(await putDub(undefined, record())).toBe(false)
    expect(DUB_POOL).toContain(':')
  })

  it('a bank is every sentence that has a take: the newest take wins, a take put down leaves it', () => {
    const bank = soundbankOf([
      record({ at: 1 }),
      record({ voice: sig('d'), at: 3 }),
      record({ say: sig('e'), voice: sig('f'), at: 2 }),
      record({ say: sig('e'), voice: '', at: 4 }),
    ], 'jwize', 9)
    expect(Object.keys(bank.voices)).toEqual([sig('a')])
    expect(bank.voices[sig('a')]!.voice).toBe(sig('d'))
    // What a host offers is read the same way, and an entry naming no take is dropped.
    const read = asSoundbank({ ...bank, voices: { ...bank.voices, [sig('1')]: { voice: 'nope', type: '', seconds: 0 }, junk: { voice: sig('2') } } })
    expect(Object.keys(read!.voices)).toEqual([sig('a')])
    expect(asSoundbank({ kind: 'presentation:soundbank', v: 2, voices: {} })).toBeNull()
  })

  it('edited words ride the same record: shown in place of the words the page was built with, with or without a take', () => {
    // jwize, 2026-11-11: "we should also be able to edit the text inline".
    expect(asDubRecord(record({ text: 'New words.', reworded: true }))?.reworded).toBe(true)
    // Reworded to nothing is not reworded.
    expect(asDubRecord(record({ text: '  ', reworded: true }))?.reworded).toBeUndefined()
    const bank = soundbankOf([
      record({ voice: '', text: 'Only the words changed.', reworded: true, at: 1 }),
      record({ say: sig('e'), text: 'Words and a take.', reworded: true, at: 2 }),
    ], 'jwize', 3)
    expect(bank.voices[sig('a')]).toEqual({ voice: '', type: 'audio/webm', seconds: 2, text: 'Only the words changed.' })
    expect(bank.voices[sig('e')]!.text).toBe('Words and a take.')
    const read = asSoundbank(bank)!
    expect(read.voices[sig('a')]!.text).toBe('Only the words changed.')
    // An entry is a take, new words, or both — never neither.
    expect(asSoundbank({ ...bank, voices: { [sig('1')]: { voice: '', type: '', seconds: 0 } } })!.voices).toEqual({})
    // The page shows the bank's words, and tells the hive both versions.
    expect(PAGE).toContain("typeof b.textOf === 'function' && b.textOf(s.key)) || s.say")
    expect(PAGE).toContain('detail: { key: s.key, say: sayOf(s), original: s.say,')
    expect(DRONE).toMatch(/const reworded = !!words && words !== foldSentence\(sentence\.say\)/)
    // New words, no take in hand: a take belongs to the words it was read from.
    expect(RECORDER).toMatch(/save\(\(\) => ask\.reword\(folded\), \(\) => \{\s+text = folded\s+dropTake\(\)/)
  })
})

describe('the karaoke cursor', () => {
  it('walks every word in order, across exactly the take, longer words and stops taking longer', () => {
    const words = karaoke('Hypercomb is simple, organized and collaborative.', 6)
    expect(words.map(word => word.word)).toEqual(['Hypercomb', 'is', 'simple,', 'organized', 'and', 'collaborative.'])
    expect(words[0]!.from).toBe(0)
    expect(words[words.length - 1]!.to).toBeCloseTo(6, 6)
    for (let i = 1; i < words.length; i++) expect(words[i]!.from).toBeCloseTo(words[i - 1]!.to, 9)
    const length = (index: number): number => words[index]!.to - words[index]!.from
    expect(length(0)).toBeGreaterThan(length(1))   // Hypercomb > is
    expect(length(2)).toBeGreaterThan(length(4))   // "simple," holds a beat; "and" does not
    expect(karaoke('   ', 3)).toEqual([])
  })

  it('the cursor is on the word that is due, and rests on the last one after the end', () => {
    const words = karaoke('one two three', 3)
    expect(wordAt(words, 0)).toBe(0)
    expect(wordAt(words, words[0]!.to + 0.01)).toBe(1)
    expect(wordAt(words, 99)).toBe(2)
    expect(wordAt([], 1)).toBe(-1)
    // The guide pace before a take exists: the tour's reading speed, never rushed.
    expect(readingSeconds('one two')).toBe(1.6)
    expect(readingSeconds(Array(26).fill('word').join(' '))).toBeCloseTo(10, 6)
  })

  it('records into the first container the browser offers', () => {
    expect(takeType(type => type === 'audio/mp4')).toBe('audio/mp4')
    expect(takeType(() => true)).toBe('audio/webm;codecs=opus')
    expect(takeType(() => false)).toBe('')
  })
})

describe('point and click to dub', () => {
  it('the page asks the hive by the sentence, plays a take over the baked voice, and says when a sentence is pressed', () => {
    // The bank is found through IoC, never a new global, and a page alone has none.
    expect(PAGE).toContain("i.get('@diamondcoreprocessor.com/DubBank')")
    expect(DRONE).toContain("export const DUB_BANK_KEY = '@diamondcoreprocessor.com/DubBank'")
    // A take outranks the voice the page was built with, start to end.
    expect(PAGE).toContain("const keyOf = (s) => dubOf(s) ? 'dub:' + s.key : (s && s.voice ? s.voice : '')")
    expect(PAGE).toContain('const from = dub ? 0 : (s.from ?? 0)')
    expect(PAGE).toContain('if (!dub && s.to != null) {')
    // A press on the sentence holds the scene and hands the sentence to the hive.
    expect(PAGE).toMatch(/cap\.addEventListener\('click'[\s\S]{0,400}if \(playing\) play\(false\)[\s\S]{0,200}new CustomEvent\('hc-sentence', \{ bubbles: true/)
    expect(DRONE).toContain("document.addEventListener('hc-sentence', this.#onSentence)")
    // The page lets go of takes it holds when the bank changes.
    expect(PAGE).toContain("addEventListener('hc-dubs-changed', dubsChanged)")
    expect(DRONE).toContain("new CustomEvent('hc-dubs-changed')")
  })

  it('the audio editor is off until the word turns it on, never kept on, never on a visitor page', () => {
    // jwize, 2026-11-11: "the audio editor is not for publish use and you have
    // to turn it off by default".
    expect(DRONE).toContain('  editing = false')
    expect(DRONE).toMatch(/get canRecord\(\): boolean \{\s+if \(!this\.editing\) return false/)
    expect(QUEEN).toContain("readonly command = 'dub'")
    expect(QUEEN).toContain("EffectBus.emit('dub:editing', word ? { on: word === 'on' } : { toggle: true })")
    // Session only: nothing about the switch is written anywhere.
    for (const source of [DRONE, QUEEN, RECORDER]) expect(source).not.toMatch(/localStorage|sessionStorage/)
    expect(DRONE).toMatch(/const next = on && !visitor/)
  })

  it('the editor sits above the viewer and never over it', () => {
    // jwize, 2026-11-11: "this is in the way of the presentation ... when a host
    // is editing it should be centered above the viewer".
    expect(DRONE).toContain("above: event.target instanceof Element ? event.target.querySelector('.scene') : null")
    expect(RECORDER).toContain('if (above) above.before(root)')
    expect(RECORDER).toContain('.hc-dub{display:flex;justify-content:center;')
    // No backdrop, no modal, and it takes no key that was not pressed inside it.
    expect(RECORDER).not.toMatch(/aria-modal|inset:0|window\.addEventListener\('keydown'/)
    expect(RECORDER).toContain("root.addEventListener('keydown', keys)")
  })

  it('a visitor plays and never records; the bee lets go while the hive runs', () => {
    expect(DRONE).toMatch(/get canRecord\(\): boolean \{[\s\S]{0,200}hypercombMode'\] === 'visitor'\) return false/)
    expect(DRONE).toMatch(/dispose\(\): void \{[\s\S]{0,200}removeEventListener\('hc-sentence'/)
    // The recorder arrives with the first press, never at boot.
    expect(DRONE).not.toMatch(/^import .*dub-recorder/m)
    expect(DRONE).toContain("await import('./dub-recorder.js')")
  })

  it('the page script still parses with the dub hooks in it', () => {
    const require = createRequire(import.meta.url)
    const page = require(join(root, 'scripts', 'bridge', 'living-presentation', 'blocks', 'page.cjs')) as { render?: unknown }
    expect(typeof page.render).toBe('function')
    const script = /const SCRIPT = `((?:[^`\\]|\\[\s\S])*)`/.exec(PAGE)
    expect(script).toBeTruthy()
    // The template's own escapes, resolved the way the builder resolves them.
    const text = new Function('return `' + script![1] + '`')() as string
    expect(() => new Function(text)).not.toThrow()
  })
})
