// keyboard-desk/keyboard-desk.spec.ts
//
// The contract each part keeps, proved on the part alone. A filler for a trait
// has to pass the same questions.

import { describe, expect, it } from 'vitest'
import type { KeyBinding } from '@hypercomb/core'
import { chordFits, sameChord, type Press } from '../keyboard/chord-match.js'
import { listBehaviours, nameOfCmd } from './behaviours/behaviours.js'
import { assignChoice, layerOfChoices, parseChoices, unbindChoice } from './bindings/bindings.js'
import { ansiBoard } from './board/board.js'
import { chordOfPress, pressOfCap, readChord } from './chord/chord.js'
import { bindingOn, bindingsOn, capsOf, legendOf } from './legend/legend.js'
import { commandOf, parseSteps, runSteps, stepOf, stepsOfScript, type RunPorts } from './lineup/lineup.js'
import { LINEUPS_GROUP, NOTHING_HELD, PART_WORDS, fillParts, lineupCmd, lineupOf, partKey, wordCmd, wordOf, type Behaviour, type DeskParts } from './parts.js'

const cap = (code: string) => ansiBoard.caps.find(item => item.code === code)!
const press = (code: string, held = {}) => pressOfCap(cap(code), { ...NOTHING_HELD, ...held })
const behaviour = (id: string): Behaviour => ({ id, name: id, description: `does ${id}`, group: 'Words', locked: false })
const bound = (cmd: string, ...sequence: KeyBinding['sequence']): KeyBinding => ({ cmd, sequence })

describe('board', () => {
  it('every key has its own place on the board', () => {
    const ids = new Set(ansiBoard.caps.map(item => item.id))
    expect(ids.size).toBe(ansiBoard.caps.length)
    for (const item of ansiBoard.caps) {
      expect(item.x + item.w).toBeLessThanOrEqual(ansiBoard.width)
      expect(item.y + item.h).toBeLessThanOrEqual(ansiBoard.height)
    }
  })

  it('no two keys overlap', () => {
    const { caps } = ansiBoard
    for (const a of caps) {
      for (const b of caps) {
        if (a === b) continue
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart, `${a.id} over ${b.id}`).toBe(true)
      }
    }
  })
})

describe('chord', () => {
  it('writes a press with every modifier named, so it fires on that press alone', () => {
    const written = chordOfPress(press('keyk', { ctrl: true }))
    expect(chordFits(press('keyk', { ctrl: true }), written)).toBe(true)
    expect(chordFits(press('keyk'), written)).toBe(false)
    expect(chordFits(press('keyk', { ctrl: true, shift: true }), written)).toBe(false)
  })

  it('reads the same press under either spelling', () => {
    expect(sameChord(chordOfPress(press('keyk', { ctrl: true })), { key: 'k', primary: true })).toBe(true)
    expect(sameChord(chordOfPress(press('keyk')), { key: 'k', primary: true })).toBe(false)
  })

  it('reads a chord step by step', () => {
    const steps = [chordOfPress(press('keyk', { ctrl: true })), chordOfPress(press('keyg'))]
    expect(readChord(steps)).toEqual([['Ctrl', 'K'], ['G']])
  })

  it('a shifted key sends what Shift sends', () => {
    expect(press('digit1', { shift: true }).key).toBe('!')
    expect(press('digit1').key).toBe('1')
  })
})

describe('legend', () => {
  const copy = bound('copy', [{ key: 'c', primary: true }])
  const hex = bound('hex', [{ key: 'h' }])

  it('a binding for the layer is exact, and one that ignores modifiers is loose', () => {
    expect(legendOf(press('keyc', { ctrl: true }), [copy], new Set())[0]).toMatchObject({ cmd: 'copy', fit: 'exact' })
    expect(legendOf(press('keyh'), [hex], new Set())[0]).toMatchObject({ cmd: 'hex', fit: 'exact' })
    expect(legendOf(press('keyh', { ctrl: true }), [hex], new Set())[0]).toMatchObject({ cmd: 'hex', fit: 'loose' })
    expect(legendOf(press('keyc'), [copy], new Set())).toEqual([])
  })

  it('a chosen binding comes first and takes the press from the others', () => {
    const mine = bound('mine', [chordOfPress(press('keyh', { ctrl: true }))])
    const legends = legendOf(press('keyh', { ctrl: true }), [hex, mine], new Set(['mine']))
    expect(legends.map(legend => [legend.cmd, legend.shadowed])).toEqual([['mine', false], ['hex', true]])
  })

  it('marks a key that starts a longer chord', () => {
    const long = bound('long', [{ key: 'g' }], [{ key: 'h' }])
    expect(legendOf(press('keyg'), [long], new Set())[0]?.continues).toBe(true)
  })

  it('finds every binding on a key and every key of a binding', () => {
    expect(bindingsOn(cap('keyc'), [copy, hex]).map(item => item.cmd)).toEqual(['copy'])
    expect(capsOf(copy, ansiBoard)).toEqual([{ cap: cap('keyc'), held: { ...NOTHING_HELD, ctrl: true } }])
  })

  it('leaves out a binding that is switched off', () => {
    expect(bindingsOn(cap('keyc'), [bound('off')])).toEqual([])
    expect(legendOf(press('keyc'), [bound('off')], new Set())).toEqual([])
  })
})

describe('behaviours', () => {
  const say = (_key: string, fallback: string): string => fallback

  it('gathers commands and words, and lists the words last', () => {
    const list = listBehaviours({
      bindings: [{ ...bound('navigation.moveUp'), description: 'Navigate up', category: 'Navigation' }],
      words: [{ name: 'history', description: 'Open history' }],
    }, say)
    expect(list.map(item => [item.id, item.name, item.group])).toEqual([
      ['navigation.moveUp', 'move up', 'Navigation'],
      [wordCmd('history'), 'history', 'Words'],
    ])
  })

  it('a word already on a key is one behaviour, and a hidden word is none', () => {
    const list = listBehaviours({
      bindings: [{ ...bound(wordCmd('history')), description: 'Open history' }],
      words: [{ name: 'history', description: 'Open history' }, { name: 'flatten', description: 'x', hidden: true }],
    }, say)
    expect(list.map(item => item.id)).toEqual([wordCmd('history')])
  })

  it('tells apart two commands that end in the same word', () => {
    const list = listBehaviours({
      bindings: [
        { ...bound('clipboard.toggle'), description: 'Clipboard' },
        { ...bound('mesh.toggle'), description: 'Mesh' },
      ],
      words: [],
    }, say)
    expect(list.map(item => item.name)).toEqual(['clipboard toggle', 'mesh toggle'])
  })

  it('never lets Escape be moved', () => {
    const list = listBehaviours({ bindings: [{ ...bound('global.escape'), description: 'Cancel' }], words: [] }, say)
    expect(list[0]?.locked).toBe(true)
  })

  it('reads a command as words and a word back out of its command', () => {
    expect(nameOfCmd('selection.selectAll')).toBe('select all')
    expect(wordOf(wordCmd('history'))).toBe('history')
    expect(wordOf('selection.selectAll')).toBe(null)
    expect(wordOf(undefined)).toBe(null)
  })
})

describe('bindings', () => {
  const chord = [chordOfPress(press('keyk', { ctrl: true }))]

  it('moves a behaviour to the new chord', () => {
    const first = assignChoice([], behaviour('word:a'), chord)
    const again = assignChoice(first, behaviour('word:a'), [chordOfPress(press('keyj'))])
    expect(again).toHaveLength(1)
    expect(again[0]?.sequence[0]?.[0]?.key).toBe('j')
  })

  it('a chord runs one chosen behaviour: choosing it again moves it', () => {
    const first = assignChoice([], behaviour('word:a'), chord)
    const next = assignChoice(first, behaviour('word:b'), chord)
    expect(next.map(item => item.cmd)).toEqual(['word:b'])
  })

  it('a word keeps what it needs to read, a command takes it from its default', () => {
    expect(assignChoice([], behaviour('word:a'), chord)[0]).toMatchObject({ description: 'does word:a', category: 'Words' })
    expect(assignChoice([], behaviour('navigation.moveUp'), chord)[0]).not.toHaveProperty('description')
  })

  it('taking a word off drops it, taking a default off keeps an empty sequence over it', () => {
    const word = assignChoice([], behaviour('word:a'), chord)
    expect(unbindChoice(word, 'word:a')).toEqual([])
    expect(unbindChoice([], 'navigation.moveUp')).toEqual([{ cmd: 'navigation.moveUp', sequence: [] }])
  })

  it('a chord with a modifier reaches past a text field, a plain key stays typing', () => {
    const layer = layerOfChoices([
      ...assignChoice([], behaviour('word:a'), chord),
      ...assignChoice([], behaviour('word:b'), [chordOfPress(press('keyj'))]),
    ])
    expect(layer.id).toBe('user-overrides')
    expect(layer.bindings.map(item => !!(item as { pierce?: boolean }).pierce)).toEqual([true, false])
  })

  it('reads a saved document back, and a damaged one as nothing', () => {
    const saved = assignChoice([], behaviour('word:a'), chord)
    const bytes = new TextEncoder().encode(JSON.stringify({ bindings: saved })).buffer as ArrayBuffer
    expect(parseChoices(bytes)).toEqual(saved)
    expect(parseChoices(new TextEncoder().encode('{nope').buffer as ArrayBuffer)).toEqual([])
    expect(parseChoices(null)).toEqual([])
  })
})

describe('lineup', () => {
  const ports = (over: Partial<RunPorts> = {}): RunPorts & { said: string[]; fired: string[] } => {
    const said: string[] = []
    const fired: string[] = []
    return {
      said, fired,
      say: async text => { said.push(text); return { kind: 'ran', actions: [{ command: text, args: '', ok: true }] } },
      fire: cmd => { fired.push(cmd) },
      read: async () => null,
      ...over,
    }
  }

  it('a behaviour is a step: a word is said exactly, a command is fired', () => {
    expect(stepOf(wordCmd('history'))).toEqual({ say: '/history' })
    expect(stepOf('navigation.moveUp')).toEqual({ cmd: 'navigation.moveUp' })
  })

  it('one plain step is a plain binding, and anything more needs a lineup', () => {
    expect(commandOf([{ say: '/history' }])).toBe(wordCmd('history'))
    expect(commandOf([{ cmd: 'navigation.moveUp' }])).toBe('navigation.moveUp')
    expect(commandOf([{ say: '/trait simple organized' }])).toBe(null)
    expect(commandOf([{ say: '/history' }, { say: '/tags' }])).toBe(null)
    expect(commandOf([])).toBe(null)
  })

  it('reads a script a line at a time, keeps the slash lines, and skips the blanks', () => {
    expect(stepsOfScript('/go /\n\n  create presentation  \r\n/trait simple organized\n')).toEqual([
      { say: '/go /' }, { say: 'create presentation' }, { say: '/trait simple organized' },
    ])
  })

  it('reads a saved lineup back, and anything else as nothing', () => {
    const bytes = JSON.stringify({ kind: 'lineup', steps: [{ say: '/go' }, { cmd: 'x' }, { nope: 1 }] })
    expect(parseSteps(bytes)).toEqual([{ say: '/go' }, { cmd: 'x' }])
    expect(parseSteps('{"kind":"other","steps":[]}')).toBe(null)
    expect(parseSteps('{nope')).toBe(null)
  })

  it('runs the steps in order, each waiting for the one before', async () => {
    const order: string[] = []
    const run = ports({
      say: async text => {
        order.push(`${text} start`)
        await Promise.resolve()
        order.push(`${text} end`)
        return { kind: 'ran', actions: [] }
      },
    })
    expect(await runSteps([{ say: 'a' }, { cmd: 'b' }, { say: 'c' }], run)).toBe(null)
    expect(order).toEqual(['a start', 'a end', 'c start', 'c end'])
    expect(run.fired).toEqual(['b'])
  })

  it('stops at the first step that does not run, and says which', async () => {
    const run = ports({ say: async text => (text === 'bad' ? { kind: 'refused', reason: 'no' } : { kind: 'ran', actions: [] }) })
    expect(await runSteps([{ say: 'a' }, { say: 'bad' }, { say: 'c' }], run)).toEqual({ step: 'bad', reason: 'no' })
    const thrown = ports({ say: async () => ({ kind: 'ran', actions: [{ command: 'x', args: '', ok: false, error: 'broke' }] }) })
    expect(await runSteps([{ say: 'x' }], thrown)).toEqual({ step: 'x', reason: 'broke' })
    const ambiguous = ports({ say: async () => ({ kind: 'ambiguous', word: 'x', candidates: ['a', 'b'] }) })
    expect((await runSteps([{ say: 'x' }], ambiguous))?.step).toBe('x')
  })

  it('an unknown outcome is not a failure', async () => {
    const run = ports({ say: async () => ({ kind: 'unknown', reason: 'legacy' }) })
    expect(await runSteps([{ say: 'a' }, { say: 'b' }], run)).toBe(null)
  })

  it('runs a lineup inside a lineup in its place', async () => {
    const run = ports({ read: async () => [{ say: 'inner' }] })
    await runSteps([{ say: 'a' }, { cmd: lineupCmd('sig') }, { say: 'b' }], run)
    expect(run.said).toEqual(['a', 'inner', 'b'])
    expect(run.fired).toEqual([])
  })

  it('says so when a lineup inside a lineup is not here', async () => {
    const stopped = await runSteps([{ cmd: lineupCmd('gone') }], ports())
    expect(stopped?.reason).toBe('that lineup is not here')
  })

  it('a chord finds its binding, the chosen one first', () => {
    const chord = [chordOfPress(press('keyh'))]
    const shipped = bound('hex', [{ key: 'h' }])
    const mine = bound('mine', [chord[0]!])
    expect(bindingOn(chord, [shipped, mine], new Set(['mine']))?.cmd).toBe('mine')
    expect(bindingOn(chord, [shipped], new Set())?.cmd).toBe('hex')
    expect(bindingOn([chordOfPress(press('keyh', { ctrl: true }))], [shipped], new Set())).toBe(null)
    expect(bindingOn([...chord, chord[0]!], [shipped], new Set())).toBe(null)
    expect(bindingOn(chord, [bound('off')], new Set())).toBe(null)
  })

  it('a bound lineup lists under its own group and reads as its steps', () => {
    const cmd = lineupCmd('abc')
    const list = listBehaviours({
      bindings: [{ ...bound(cmd, [{ key: 'g' }]), description: 'history › tags', category: LINEUPS_GROUP }],
      words: [],
    }, (_key, fallback) => fallback)
    expect(list[0]).toMatchObject({ id: cmd, name: 'history › tags', group: LINEUPS_GROUP })
    expect(lineupOf(cmd)).toBe('abc')
  })

  it('two lineups with the same words keep their names', () => {
    const entry = (sig: string) => ({ ...bound(lineupCmd(sig)), description: 'a › b', category: LINEUPS_GROUP })
    const list = listBehaviours({ bindings: [entry('one'), entry('two')], words: [] }, (_key, fallback) => fallback)
    expect(list.map(item => item.name)).toEqual(['a › b', 'a › b'])
  })

  it('taking a lineup off drops it', () => {
    const cmd = lineupCmd('abc')
    const first = assignChoice([], { ...behaviour(cmd), group: LINEUPS_GROUP }, [chordOfPress(press('keyg'))])
    expect(first[0]).toMatchObject({ cmd, category: LINEUPS_GROUP })
    expect(unbindChoice(first, cmd)).toEqual([])
  })
})

describe('parts', () => {
  const own = Object.fromEntries(PART_WORDS.map(word => [word, { own: word }])) as unknown as DeskParts

  it('runs the own version until a filler is registered, and the filler after', () => {
    const filler = { own: 'other' }
    const parts = fillParts(own, key => (key === partKey('strip') ? filler : undefined))
    expect(parts.strip).toBe(filler)
    expect(parts.board).toBe(own.board)
  })
})

describe('chordFits', () => {
  const plain: Press = { key: 'h', code: 'keyh', ctrl: false, shift: false, alt: false, meta: false }

  it('does not look at a modifier the chord does not name', () => {
    expect(chordFits({ ...plain, ctrl: true }, { key: 'h' })).toBe(true)
    expect(chordFits({ ...plain, ctrl: true }, { key: 'h', ctrl: false })).toBe(false)
  })

  it('a code is checked instead of the key', () => {
    expect(chordFits({ ...plain, key: '*', code: 'digit8' }, { key: '8', code: 'digit8' })).toBe(true)
  })
})
